# Alalloy Agent — 快速部署指南

> 适用场景：在有 Docker 环境的 Linux 服务器上部署，服务器前置 Nginx 做反向代理。  
> MCP 和外部计算服务地址在 `.env` 中配置，本文仅覆盖 Alalloy Agent 本身。

---

## 目录结构

```
Alalloy_agent/
├── backend/             # FastAPI 后端
├── frontend/            # Nuxt 前端（本地构建后上传静态文件）
├── frontend_static/     # ★ 前端构建产物（手动生成，见下）
│   └── public/
├── Dockerfile.backend   # 后端镜像
├── docker-compose.yml   # 服务编排
├── nginx.conf           # 前端容器内部 Nginx（/api, /ws 代理）
├── nginx-main.conf      # 前端容器 Nginx 主配置
├── nginx-host.conf      # ★ 宿主机 Nginx 配置（需手动放到服务器）
├── .env                 # 后端环境变量（不提交 git）
└── frontend/.env        # 前端构建变量（不提交 git）
```

---

## 一、关键配置文件

### 1. `docker-compose.yml`

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: alalloy-backend
    restart: always
    ports:
      - "127.0.0.1:8001:8001"     # 只绑本地，不暴露到公网
    env_file:
      - .env
    environment:
      - BACKEND_HOST=0.0.0.0
      - BACKEND_PORT=8001
    volumes:
      - ./logs:/app/logs
      - ./backend/reports:/app/reports
    networks:
      - alalloy-network
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  frontend:
    image: nginx:1.25-alpine
    container_name: alalloy-frontend
    restart: always
    ports:
      - "127.0.0.1:8080:80"       # 只绑本地，由宿主机 Nginx 反代
    volumes:
      - ./frontend_static/public:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx-main.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - alalloy-network

networks:
  alalloy-network:
    driver: bridge
```

---

### 2. `Dockerfile.backend`（支持国内服务器）

```dockerfile
FROM python:3.11-slim AS builder
WORKDIR /app

# 换阿里云 apt 源（解决 deb.debian.org 不可达）
RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' \
    /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    (echo "deb http://mirrors.aliyun.com/debian/ bookworm main contrib non-free" \
    > /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian-security bookworm-security main" \
    >> /etc/apt/sources.list)

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements-root.txt
COPY backend/requirements.txt ./requirements-backend.txt

# 换阿里云 PyPI 源
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip install --no-cache-dir --user --timeout 300 -r requirements-root.txt && \
    pip install --no-cache-dir --user --timeout 300 -r requirements-backend.txt

FROM python:3.11-slim
WORKDIR /app

RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' \
    /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    (echo "deb http://mirrors.aliyun.com/debian/ bookworm main" > /etc/apt/sources.list && \
    echo "deb http://mirrors.aliyun.com/debian-security bookworm-security main" \
    >> /etc/apt/sources.list)

RUN useradd -m -u 1000 alalloy && \
    apt-get update && apt-get install -y --no-install-recommends libpq5 curl && \
    chown -R alalloy:alalloy /app && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /home/alalloy/.local
COPY --chown=alalloy:alalloy backend/app ./app
COPY --chown=alalloy:alalloy .env.example .

ENV PATH=/home/alalloy/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8001

USER alalloy

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -sf http://localhost:8001/health || exit 1

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
```

---

### 3. `nginx.conf`（前端容器内部，代理 /api 和 /ws）

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    absolute_redirect off;

    # 静态资源长缓存
    location ~* \.(js|css|png|jpg|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 代理 → 后端容器
    location /api/ {
        proxy_pass http://backend:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
        client_max_body_size  100M;
    }

    # WebSocket 代理 → 后端容器（LLM 流式输出）
    location /ws/ {
        proxy_pass http://backend:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_connect_timeout 86400s;
        proxy_send_timeout    86400s;
        proxy_read_timeout    86400s;
        proxy_buffering off;
        proxy_socket_keepalive on;
    }

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

### 4. `nginx-main.conf`（前端容器 Nginx 主配置）

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';

    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml image/svg+xml;

    include /etc/nginx/conf.d/*.conf;
}
```

---

### 5. 宿主机 Nginx 配置（放到 `/etc/nginx/conf.d/alalloy.conf`）

⚠️ **关键**：必须使用 `map` + `$connection_upgrade` 变量来正确传递 WebSocket Upgrade 头，直接写死 `Connection: upgrade` 会导致 WebSocket 握手失败。

```nginx
# ★ 必须定义此 map，保证 WebSocket 升级头正确传递
map $http_upgrade $connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 80;
    server_name your-domain.com;   # 或服务器 IP

    access_log /var/log/nginx/alalloy_access.log;
    error_log  /var/log/nginx/alalloy_error.log;

    # WebSocket（必须在 / 之前定义）
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;        # ← 变量形式
        proxy_set_header Connection $connection_upgrade;  # ← 变量形式
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 86400s;
        proxy_send_timeout    86400s;
        proxy_read_timeout    86400s;
        proxy_buffering off;
        proxy_socket_keepalive on;
    }

    # 其余请求（前端静态 + /api）
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host             $host;
        proxy_set_header X-Real-IP        $remote_addr;
        proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
    }
}
```

---

### 6. 后端 `.env`

```ini
# ===== 模式 =====
DEV_MODE=false
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8001

# ===== 对外 URL（替换为实际地址）=====
FRONTEND_URL=http://your-server-ip
FRONTEND_CALLBACK_URL=http://your-server-ip/callback
BACKEND_CALLBACK_URL=http://your-server-ip/api/auth/callback

# ===== LLM =====
DASHSCOPE_API_KEY=sk-xxx
DASHSCOPE_MODEL_NAME=qwen3.5-plus

# ===== MCP（替换为公司服务器地址）=====
MCP_URL=http://公司MCP服务地址:端口/mcp
MCP_TOKEN=xxx
MCP_TRANSPORT=streamable_http

# ===== 认证 =====
FERRISKEY_URL=https://ferriskey-api.topmatdev.com
FERRISKEY_REALM=topmat-public
FERRISKEY_CLIENT_ID=alalloy-agent
FERRISKEY_CLIENT_SECRET=xxx
VERIFY_SSL=true

DEV_JWT_SECRET=生产环境替换为随机字符串

# ===== Supabase =====
SUPABASE_AUTH_ENABLED=true
SUPABASE_URL=https://fyonyyermialezvlvamv.supabase.co
SUPABASE_SERVICE_KEY=xxx
SUPABASE_ANON_KEY=xxx
SUPABASE_JWT_SECRET=xxx
SUPABASE_DB_URL=postgresql://postgres.xxx:密码@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

---

## 二、前端构建（本地执行）

> 前端因内存需求大（≥2GB）在本地构建，上传静态产物到服务器。

**前提**：本地已安装 Node.js 18+，且 `frontend/.env` 的 `VITE_BACKEND_HOST` 必须为**空**（使用相对路径）。

检查 `frontend/.env`，确保：
```ini
# 生产构建时注释掉，或留空
# VITE_BACKEND_HOST=localhost
VITE_DEV_MODE=false
NUXT_PUBLIC_AUTH_PROVIDER=both    # 或 supabase / ferriskey
NUXT_PUBLIC_SUPABASE_URL=https://fyonyyermialezvlvamv.supabase.co
NUXT_PUBLIC_SUPABASE_ANON_KEY=xxx
```

```bash
# 在 frontend/ 目录执行
cd frontend
npm install
npm run generate
# 产物在 frontend/.output/public/
```

打包产物（约 2-3 MB）：
```bash
tar -czf frontend_dist.tar.gz -C frontend/.output public
```

---

## 三、部署流程

### Step 1：上传代码和配置

```bash
# 上传项目（排除 node_modules 和 .nuxt）
rsync -avz --exclude='node_modules' --exclude='.nuxt' --exclude='.output' \
    ./Alalloy_agent/ user@server:/opt/alalloy/

# 单独上传前端静态产物
scp frontend_dist.tar.gz user@server:/tmp/
```

### Step 2：服务器准备

```bash
ssh user@server

# 解压前端静态文件
mkdir -p /opt/alalloy/frontend_static
tar -xzf /tmp/frontend_dist.tar.gz -C /opt/alalloy/frontend_static/

# 创建运行时目录
mkdir -p /opt/alalloy/logs /opt/alalloy/backend/reports
chmod 777 /opt/alalloy/logs /opt/alalloy/backend/reports

# 放置宿主机 Nginx 配置
cp /opt/alalloy/nginx-host.conf /etc/nginx/conf.d/alalloy.conf
nginx -t && systemctl reload nginx
```

### Step 3：构建并启动

```bash
cd /opt/alalloy

# 首次构建（约 5-10 分钟，依赖 pip 下载速度）
docker compose build --no-cache

# 后台启动
docker compose up -d

# 等待后端健康（约 60 秒）
docker compose ps
```

### Step 4：验证

```bash
# 后端健康
curl http://127.0.0.1:8001/health

# 前端可访问
curl -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/

# 公网访问（替换为实际 IP/域名）
curl -o /dev/null -w "%{http_code}" http://your-server-ip/
```

---

## 四、日常运维

```bash
cd /opt/alalloy

# 查看日志
docker compose logs -f backend
docker compose logs -f frontend

# 重启服务
docker compose restart backend

# 更新后端代码
git pull
docker compose up -d --build backend

# 更新前端（本地重新构建后上传）
tar -xzf /tmp/frontend_dist.tar.gz -C /opt/alalloy/frontend_static/
docker compose restart frontend

# 停止所有服务
docker compose down
```

---

## 五、常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| 后端构建 `apt-get` 失败 | `deb.debian.org` 在国内不可达 | 确认使用支持国内镜像的 Dockerfile（见本文第 2 节）|
| 前端构建 OOM 被杀 | 服务器内存 < 2GB | 在本地构建，上传静态文件（本文方案）|
| WebSocket 连接失败 | 宿主机 Nginx 未正确传递 Upgrade 头 | 确认宿主机 Nginx 使用 `map $http_upgrade $connection_upgrade`（见本文第 5 节）|
| API 请求到 `backend:8001` | 前端构建时 `VITE_BACKEND_HOST=backend` 被烧进 bundle | 构建前注释掉 `frontend/.env` 中的 `VITE_BACKEND_HOST` |
| 后端日志乱码 | 终端编码问题 | 加 `PYTHONIOENCODING=utf-8` 环境变量 |
| 后端 MCP 工具 0 个 | 网络不通 | 确认 `MCP_URL` 可达，后端与 MCP 容器在同一 Docker 网络 |

---

## 六、Supabase 配置（认证相关）

首次部署后，在 [Supabase Dashboard](https://supabase.com/dashboard) 完成：

1. **URL Configuration** → Site URL 和 Redirect URLs 添加服务器地址：
   ```
   http://your-server-ip/**
   http://your-server-ip/callback
   http://your-server-ip/reset-password
   ```

2. **SMTP**（可选，用于密码重置邮件）→ 配置 QQ 邮箱或 Resend

---

*文档版本：v2.1 | Alalloy Agent Multi-Auth 版本*
