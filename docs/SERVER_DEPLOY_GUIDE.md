# 铝合金智能设计系统 — 服务器部署操作手册

> **当前部署服务器**：阿里云 ECS `42.121.165.182`（华东1·杭州）  
> **规格**：2 vCPU / 2 GB RAM / 40 GB SSD / Alibaba Cloud Linux 3  
> **访问地址**：`http://42.121.165.182/`  
> **文档版本**：v2.1（Multi-Auth：Supabase + FerrisKey）

---

## 目录

1. [架构说明](#1-架构说明)
2. [服务器初始化（首次）](#2-服务器初始化首次)
3. [SSH 密钥配置](#3-ssh-密钥配置)
4. [代码部署](#4-代码部署)
5. [环境变量配置](#5-环境变量配置)
6. [前端构建与上传](#6-前端构建与上传)
7. [启动服务](#7-启动服务)
8. [Nginx 反向代理配置](#8-nginx-反向代理配置)
9. [验证与检查](#9-验证与检查)
10. [更新部署流程](#10-更新部署流程)
11. [故障排查](#11-故障排查)

---

## 1. 架构说明

```
用户浏览器（公网）
      │ HTTP/WebSocket :80
      ▼
┌─────────────────────┐
│   宿主机 Nginx       │  ← 处理 WebSocket 升级、反向代理
│   /etc/nginx/       │
└────────┬────────────┘
         │ :8080（Docker 内网）
         ▼
┌─────────────────────┐
│  前端容器            │  ← nginx:1.25-alpine + 静态 SPA 文件
│  alalloy-frontend   │    内部代理 /api/ /ws/ → backend:8001
└────────┬────────────┘
         │ backend:8001（Docker 内网）
         ▼
┌─────────────────────┐
│  后端容器            │  ← FastAPI + LangGraph Agent
│  alalloy-backend    │    连接 Supabase（会话存储）+ MCP 服务
└─────────────────────┘
```

**关键点**：
- 所有容器端口只绑定 `127.0.0.1`，不直接暴露公网
- 宿主机 Nginx 处理 HTTP→WebSocket 升级（`map $http_upgrade $connection_upgrade`）
- 前端 SPA 使用相对路径（无 `http://` 前缀），由 Nginx 代理
- MCP 服务地址通过 `.env` 配置，后续可替换为公司服务器地址

---

## 2. 服务器初始化（首次）

> 已配置好的服务器可跳过此节，直接从第 4 节开始。

```bash
# 更新系统
apt-get update && apt-get upgrade -y

# 安装 Docker（已预装在当前服务器，跳过）
# curl -fsSL https://get.docker.com | sh
# systemctl enable docker && systemctl start docker

# 安装 Nginx 和 git
yum install -y git nginx    # Alibaba Cloud Linux 用 yum

# 创建部署目录
mkdir -p /opt/alalloy/logs /opt/alalloy/backend/reports

# 创建 Swap（2GB RAM 服务器必须）
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 验证
free -h   # Swap 应显示 2.0 GiB
```

---

## 3. SSH 密钥配置

**本地（Windows）操作**，用于免密登录服务器：

```powershell
# 生成 ED25519 密钥对（一次性操作）
& "C:\Windows\System32\OpenSSH\ssh-keygen.exe" -t ed25519 -C "alalloy-server" -f "$HOME\.ssh\alalloy_aliyun"

# 将公钥上传到服务器（需要输一次密码）
ssh root@42.121.165.182 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys" < "$HOME\.ssh\alalloy_aliyun.pub"

# 配置 SSH 别名（~/.ssh/config）
# 追加以下内容：
```

```
Host alalloy-aliyun
  HostName 42.121.165.182
  Port 22
  User root
  IdentityFile ~/.ssh/alalloy_aliyun
  ServerAliveInterval 60
  ServerAliveCountMax 3
```

```powershell
# 之后连接只需：
ssh alalloy-aliyun
```

---

## 4. 代码部署

### 4.1 首次克隆（服务器上执行）

```bash
# 清空并克隆（如果目录已存在）
rm -rf /opt/alalloy
git clone https://github.com/Luckybuff728/Alalloy-agent.git /opt/alalloy

# 创建必要目录
mkdir -p /opt/alalloy/logs /opt/alalloy/backend/reports
chmod 777 /opt/alalloy/logs /opt/alalloy/backend/reports
```

### 4.2 更新代码（已部署后）

```bash
cd /opt/alalloy
git pull origin master
```

---

## 5. 环境变量配置

### 5.1 创建后端 `.env`

```bash
vim /opt/alalloy/.env
```

复制以下模板，填入真实值（`<<>>` 部分）：

```ini
# =================================================================
# Alalloy Agent v2.0 — 生产环境配置
# =================================================================

# -----------------------------------------------------------------
# 1. LLM 配置（必填）
# -----------------------------------------------------------------
DASHSCOPE_API_KEY=<<阿里云百炼 API Key>>
DASHSCOPE_MODEL_NAME=qwen3.5-plus

# -----------------------------------------------------------------
# 2. 认证配置
# -----------------------------------------------------------------
# FerrisKey OIDC
FERRISKEY_URL=https://ferriskey-api.topmatdev.com
FERRISKEY_REALM=topmat-public
FERRISKEY_CLIENT_ID=alalloy-agent
FERRISKEY_CLIENT_SECRET=<<FerrisKey Client Secret>>

# ★ 生产关键：替换为实际 IP 或域名
FRONTEND_CALLBACK_URL=http://42.121.165.182/callback
BACKEND_CALLBACK_URL=http://42.121.165.182/api/auth/callback
FRONTEND_URL=http://42.121.165.182

# Supabase（鉴权 + 会话存储）
SUPABASE_AUTH_ENABLED=true
SUPABASE_URL=https://fyonyyermialezvlvamv.supabase.co
SUPABASE_SERVICE_KEY=<<Supabase Service Role Key>>
SUPABASE_ANON_KEY=<<Supabase Anon Key>>
SUPABASE_JWT_SECRET=<<Supabase JWT Secret>>
SUPABASE_DB_URL=postgresql://postgres.fyonyyermialezvlvamv:<<DB密码>>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

# SSL 验证（生产建议 true，当前使用 HTTP 暂设 false）
VERIFY_SSL=false

# -----------------------------------------------------------------
# 3. 服务器配置
# -----------------------------------------------------------------
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8001
DEV_MODE=false
DEV_JWT_SECRET=<<openssl rand -hex 32 生成>>

# -----------------------------------------------------------------
# 4. MCP 服务（后续替换为公司服务器地址）
# -----------------------------------------------------------------
# 当前指向本机 TopMat-MCP 服务
MCP_URL=http://topmat-mcp:3000/mcp
MCP_TOKEN=<<MCP Token>>
MCP_TRANSPORT=streamable_http

# -----------------------------------------------------------------
# 5. 外部 API
# -----------------------------------------------------------------
HUAWEI_IAM_URL=https://iam.cn-north-4.myhuaweicloud.com/v3/auth/tokens
HUAWEI_DOMAIN_NAME=Topmaterial_Tech
HUAWEI_USER_NAME=Topmaterial_Tech
HUAWEI_PASSWORD=<<华为云密码>>
IDME_API_URL=https://idme.cn-southwest-2.huaweicloud.com/...
IDME_TENANT_ID=44
TOPMAT_API_URL=https://api.topmaterial-tech.com
TOPMAT_TOKEN=Authorization=Bearer <<Token>>
```

> **⚠️ MCP 服务替换说明**  
> 当公司内部服务器就绪后，只需修改 `.env` 中 `MCP_URL` 为新地址，重启后端容器即可：
> ```bash
> # 替换为公司服务器地址后：
> docker compose restart backend
> ```

### 5.2 配置 `docker-compose.yml`

当前服务器使用的 `/opt/alalloy/docker-compose.yml`：

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: alalloy-backend
    restart: always
    ports:
      - "127.0.0.1:8001:8001"      # 只绑定本地，不对公网暴露
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
      - topmat-network              # 接入 MCP 服务网络（替换公司地址后可删除）
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  frontend:
    image: nginx:1.25-alpine        # 使用官方 nginx，挂载预构建静态文件
    container_name: alalloy-frontend
    restart: always
    ports:
      - "127.0.0.1:8080:80"        # 只绑定本地，由宿主 nginx 反代
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
  topmat-network:
    external: true
    name: topmat_topmat-network    # MCP 服务替换后可移除此网络
```

> **MCP 替换后的简化 docker-compose.yml**（公司服务器就绪时使用）：
> ```yaml
> # 只需删除 topmat-network 相关配置：
> # 1. backend.networks 中删除 - topmat-network
> # 2. 删除底部 topmat-network 外部网络声明
> # 3. MCP_URL 改为公司服务器地址
> ```

---

## 6. 前端构建与上传

> **⚠️ 重要**：服务器 2GB RAM 不足以在服务器上直接构建 Nuxt，**必须在本地构建后上传静态文件**。

### 6.1 本地构建（Windows + PowerShell）

```powershell
cd D:\DCKJ\Alalloy_agent\frontend

# 注释掉 .env 中的 VITE_BACKEND_HOST（让 backendHost 为空字符串，使用相对路径）
(Get-Content .env) -replace '^VITE_BACKEND_HOST=localhost', '#VITE_BACKEND_HOST=localhost' | Set-Content .env

# 构建
npm run generate

# 恢复 .env（开发用）
(Get-Content .env) -replace '^#VITE_BACKEND_HOST=localhost', 'VITE_BACKEND_HOST=localhost' | Set-Content .env
```

> **为什么要注释 VITE_BACKEND_HOST？**  
> 生产环境所有 API 请求通过 Nginx 代理（相对路径 `/api/...`），不需要显式指定后端地址。  
> 如果 `backendHost` 不为空，前端会直接请求 `http://backend:8001`（Docker 内网域名），浏览器无法解析。

### 6.2 打包并上传

```powershell
# 打包静态文件（约 2.5 MB）
conda run -n agent python -c "
import os, tarfile
os.chdir(r'D:\DCKJ\Alalloy_agent\frontend')
tf = tarfile.open(r'D:\DCKJ\Alalloy_agent\frontend_dist.tar.gz', 'w:gz')
tf.add('.output/public', arcname='public')
tf.close()
print('打包完成')
"

# 上传到服务器
scp -i "$HOME\.ssh\alalloy_aliyun" "D:\DCKJ\Alalloy_agent\frontend_dist.tar.gz" root@42.121.165.182:/tmp/frontend_dist.tar.gz
```

### 6.3 服务器端解压部署

```bash
# 解压到静态文件目录（覆盖旧版本）
tar -xzf /tmp/frontend_dist.tar.gz -C /opt/alalloy/frontend_static/

# 清理临时文件
rm /tmp/frontend_dist.tar.gz

# 重启前端容器
docker restart alalloy-frontend
```

---

## 7. 启动服务

### 7.1 后端 Docker 镜像构建（首次或代码变更后）

后端 Dockerfile 已适配国内镜像（阿里云 apt + pip 源）：

```bash
cd /opt/alalloy

# 首次构建（约 5-8 分钟）
docker compose build backend

# 启动后端
docker compose up -d backend

# 等待后端健康（约 60 秒）
docker compose ps   # STATUS 显示 (healthy) 后继续
```

### 7.2 启动前端容器

```bash
# 前端使用官方 nginx 镜像，无需构建
docker compose up -d frontend
```

### 7.3 一键启动所有服务

```bash
cd /opt/alalloy
docker compose up -d
```

### 7.4 启动宿主机 Nginx

```bash
systemctl start nginx
systemctl enable nginx    # 开机自启
systemctl status nginx    # 确认 active (running)
```

---

## 8. Nginx 反向代理配置

宿主机 Nginx 配置文件路径：`/etc/nginx/conf.d/alalloy.conf`

```nginx
# WebSocket Upgrade 头映射（必须在 http{} 块内，nginx.conf include 会自动加载）
map $http_upgrade $connection_upgrade {
    default upgrade;
    "" close;
}

server {
    listen 80;
    server_name 42.121.165.182;    # 替换为实际 IP 或域名

    access_log /var/log/nginx/alalloy_access.log;
    error_log  /var/log/nginx/alalloy_error.log;

    # ★ WebSocket 路由（必须在 / 之前定义，优先级更高）
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        # 关键：使用变量传递 Upgrade 头，不能用字面字符串
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 86400s;    # LLM 长任务，超时设为 24 小时
        proxy_send_timeout 86400s;
        proxy_read_timeout 86400s;
        proxy_buffering off;
        proxy_socket_keepalive on;
    }

    # 普通 HTTP 请求（前端页面 + API 代理）
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

**写入配置**（直接 scp 上传，避免 PowerShell 变量转义问题）：

```powershell
# 本地编辑好配置文件后直接上传
scp -i "$HOME\.ssh\alalloy_aliyun" nginx_alalloy.conf root@42.121.165.182:/etc/nginx/conf.d/alalloy.conf

# 在服务器上验证并重载
ssh alalloy-aliyun "nginx -t && systemctl reload nginx"
```

> **⚠️ 关键陷阱**：不要在 SSH 命令中用 PowerShell 字符串写入 nginx 配置，`\$http_upgrade` 会被写成字面量字符串，导致 WebSocket 握手失败（表现为连接 404 而非预期的 403/101）。

---

## 9. 验证与检查

### 9.1 服务状态

```bash
# 查看所有容器
docker ps

# 后端健康
curl -sf http://127.0.0.1:8001/health
# 期望输出：{"status":"ok"}

# 前端响应
curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/
# 期望输出：200

# 公网访问
curl -sf http://42.121.165.182/ | grep -o '<title>.*</title>'
# 期望输出：<title>铝合金智能设计系统</title>
```

### 9.2 WebSocket 连通性

```bash
# 测试 WebSocket 握手（返回 403 表示握手成功，令牌无效）
curl -o /dev/null -w '%{http_code}' \
  -H 'Upgrade: websocket' \
  -H 'Connection: Upgrade' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Version: 13' \
  'http://42.121.165.182/ws/chat?token=test&session_id=test'
# 期望输出：403（说明 WebSocket 握手层通过，后端拒绝无效 token）
# 如果返回 404：Nginx 没有正确传递 Upgrade 头
```

### 9.3 前端构建验证

```bash
# 确认前端 JS bundle 中 backendHost 为空（相对路径模式）
curl -sf http://42.121.165.182/ | grep -o 'backendHost[^,]*'
# 期望输出：backendHost:""
# 如果显示 backendHost:"localhost" 或 backendHost:"backend"：需要重新构建前端
```

### 9.4 日志查看

```bash
# 后端实时日志
docker logs alalloy-backend -f

# 查看 MCP 工具加载情况
docker logs alalloy-backend 2>&1 | grep -E "MCP|工具分配"
# 期望：MCP 初始化成功: 9/39 个工具，工具分配: analysisExpert=10个

# Nginx 访问日志
tail -f /var/log/nginx/alalloy_access.log

# Nginx 错误日志
tail -f /var/log/nginx/alalloy_error.log
```

---

## 10. 更新部署流程

### 10.1 后端代码更新

```bash
# 1. 拉取新代码
cd /opt/alalloy && git pull origin master

# 2. 重新构建后端镜像
docker compose build backend

# 3. 重启后端（不影响前端）
docker compose up -d --force-recreate backend

# 4. 验证
docker compose ps
curl -sf http://127.0.0.1:8001/health
```

### 10.2 前端更新

```powershell
# 本地（Windows）：
# 1. 修改前端代码
# 2. 构建
cd D:\DCKJ\Alalloy_agent\frontend
(Get-Content .env) -replace '^VITE_BACKEND_HOST=localhost', '#VITE_BACKEND_HOST=localhost' | Set-Content .env
npm run generate
(Get-Content .env) -replace '^#VITE_BACKEND_HOST=localhost', 'VITE_BACKEND_HOST=localhost' | Set-Content .env

# 3. 打包
conda run -n agent python -c "
import os,tarfile
os.chdir(r'D:\DCKJ\Alalloy_agent\frontend')
tf=tarfile.open(r'D:\DCKJ\frontend_dist.tar.gz','w:gz')
tf.add('.output/public',arcname='public')
tf.close()
"

# 4. 上传
scp -i "$HOME\.ssh\alalloy_aliyun" "D:\DCKJ\frontend_dist.tar.gz" root@42.121.165.182:/tmp/frontend_dist.tar.gz
```

```bash
# 服务器端：
tar -xzf /tmp/frontend_dist.tar.gz -C /opt/alalloy/frontend_static/
rm /tmp/frontend_dist.tar.gz
docker restart alalloy-frontend
```

### 10.3 仅更新 `.env` 配置

```bash
# 编辑配置
vim /opt/alalloy/.env

# 重启后端让配置生效（必须用 force-recreate 让 env_file 重新加载）
cd /opt/alalloy && docker compose up -d --force-recreate backend
```

### 10.4 MCP 服务地址替换（切换到公司服务器时）

```bash
# 1. 修改 .env 中的 MCP_URL
sed -i 's|MCP_URL=.*|MCP_URL=http://公司服务器地址/mcp|' /opt/alalloy/.env

# 2. 更新 docker-compose.yml（移除 topmat-network 依赖）
vim /opt/alalloy/docker-compose.yml
# 删除 backend.networks 中的 - topmat-network
# 删除底部 topmat-network 外部网络声明

# 3. 重建后端
docker compose up -d --force-recreate backend

# 4. 验证 MCP 工具加载
docker logs alalloy-backend 2>&1 | grep "MCP 初始化"
```

---

## 11. 故障排查

### 问题 1：后端容器 unhealthy / 启动失败

```bash
# 查看错误日志
docker logs alalloy-backend --tail 50
```

| 常见错误 | 原因 | 解决 |
|---------|------|------|
| `Permission denied: '/app/logs/app_XXX.log'` | logs 目录权限不足 | `chmod 777 /opt/alalloy/logs` |
| `DATABASE_URL` 连接错误 | Supabase DB URL 配置错误 | 检查 `.env` 中 `SUPABASE_DB_URL` |
| `MCP 初始化失败` | MCP 服务不可达 | 检查 `MCP_URL` 和网络连通性 |

### 问题 2：前端页面空白 / API 请求失败

```bash
# 检查前端 bundle 中的 backendHost
curl -sf http://42.121.165.182/ | grep -o 'backendHost[^,]*'
```

- 如果显示 `backendHost:"localhost"` 或 `backendHost:"backend"` → 前端构建时环境变量没清空，需要重新构建（见第 6 节）
- 如果 `backendHost:""` 但 API 仍失败 → 检查 Nginx 代理是否正确

### 问题 3：WebSocket 连接失败（显示 404）

```bash
# 测试握手
curl -o /dev/null -w '%{http_code}' \
  -H 'Upgrade: websocket' -H 'Connection: Upgrade' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' \
  'http://42.121.165.182/ws/chat?token=test&session_id=test'
```

- 返回 `404`：宿主 Nginx 的 `Upgrade $http_upgrade` 是字面字符串（有 `\`）→ 用 `scp` 重新上传 nginx 配置
- 返回 `403`：WebSocket 握手成功，只是 token 无效（正常）
- 返回 `101`：WebSocket 建立成功（最佳）

### 问题 4：服务器重启后容器没有自动启动

```bash
# 确认 docker-compose 服务设置了 restart: always
grep 'restart' /opt/alalloy/docker-compose.yml

# 手动启动
cd /opt/alalloy && docker compose up -d
systemctl start nginx
```

建议配置 systemd 服务，开机自动启动：

```bash
cat > /etc/systemd/system/alalloy.service << 'EOF'
[Unit]
Description=Alalloy Agent Docker Compose
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/alalloy
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable alalloy
```

---

## 附录：当前服务器关键路径

| 路径 | 说明 |
|------|------|
| `/opt/alalloy/` | 项目根目录 |
| `/opt/alalloy/.env` | 后端环境变量（包含所有密钥，**不提交 git**）|
| `/opt/alalloy/docker-compose.yml` | Docker 服务编排 |
| `/opt/alalloy/Dockerfile.backend` | 后端镜像构建（含国内 apt/pip 镜像）|
| `/opt/alalloy/frontend_static/public/` | 前端静态文件（本地构建后上传）|
| `/opt/alalloy/nginx.conf` | 前端容器内 nginx 站点配置 |
| `/opt/alalloy/nginx-main.conf` | 前端容器内 nginx 主配置 |
| `/opt/alalloy/logs/` | 后端运行日志 |
| `/etc/nginx/conf.d/alalloy.conf` | 宿主机 nginx 反代配置（**用 scp 上传，不用 echo 写入**）|
| `~/.ssh/alalloy_aliyun` | 本地 SSH 私钥 |

## 附录：登录账号

| 账号类型 | 登录入口 | 说明 |
|---------|---------|------|
| Supabase 邮箱账号 | 首页登录表单 | `986451618@qq.com` |
| FerrisKey SSO | 首页 "使用 TopMaterial 企业 SSO 登录" | 公司内网统一认证 |
| 管理员注册接口 | `POST /api/auth/supabase/register` | 后端代理注册，跳过邮件验证 |

---

*文档维护：TopMaterial Technology Co., Ltd*  
*最后更新：2026-03-07*
