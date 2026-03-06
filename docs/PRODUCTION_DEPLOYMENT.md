# 铝合金智能设计系统 v2.0 — 公网生产部署文档

> **适用版本**：Alalloy Agent v2.0（Multi-Auth：Supabase + FerrisKey + DEV_MODE）  
> **部署方式**：Docker Compose + 宿主机 Nginx 反向代理  
> **最低服务器配置**：4 核 8 GB RAM / 50 GB SSD / Ubuntu 22.04 LTS

---

## 目录

1. [架构概览](#1-架构概览)
2. [服务器准备](#2-服务器准备)
3. [部署前提条件清单](#3-部署前提条件清单)
4. [环境变量配置](#4-环境变量配置)
5. [Supabase 生产配置](#5-supabase-生产配置)
6. [SMTP 邮件配置](#6-smtp-邮件配置)
7. [Docker 镜像构建与部署](#7-docker-镜像构建与部署)
8. [Nginx 反向代理配置（HTTPS）](#8-nginx-反向代理配置https)
9. [SSL 证书申请（Let's Encrypt）](#9-ssl-证书申请lets-encrypt)
10. [FerrisKey 生产回调配置](#10-ferriskey-生产回调配置)
11. [防火墙配置](#11-防火墙配置)
12. [健康检查与监控](#12-健康检查与监控)
13. [登录入口控制（甲方 vs 内部）](#13-登录入口控制甲方-vs-内部)
14. [回滚与维护](#14-回滚与维护)
15. [常见问题排查](#15-常见问题排查)

---

## 1. 架构概览

```
互联网用户
     │  HTTPS (443)
     ▼
┌─────────────────────────────────┐
│  宿主机 Nginx（SSL 终结 + 反代）  │  宿主机端口：80/443
└────────────────┬────────────────┘
                 │ Docker 内网
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────┐   ┌──────────────┐
│  前端容器     │   │  后端容器     │
│  (nginx:80)  │   │  (uvicorn:   │
│  静态 SPA    │   │   8001)      │
│  nginx反代   │──►│  FastAPI     │
│  /api /ws    │   │  LangGraph   │
└──────────────┘   └──────┬───────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ Supabase │ │FerrisKey │ │ MCP 服务  │
      │  (云端)  │ │  (云端)  │ │ (内网/云) │
      └──────────┘ └──────────┘ └──────────┘
```

**请求路径**：
- `https://你的域名/` → Nginx → 前端容器（静态文件）
- `https://你的域名/api/*` → Nginx → 前端容器 Nginx → 后端容器 8001
- `wss://你的域名/ws/*` → Nginx → 前端容器 Nginx → 后端容器 8001（WebSocket）

> **关键设计**：前端容器内的 Nginx 负责容器内 `/api` 和 `/ws` 的代理，宿主机 Nginx 只负责 SSL 终结和 HTTP→HTTPS 重定向。

---

## 2. 服务器准备

### 2.1 安装基础依赖

```bash
# 更新系统
apt-get update && apt-get upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# 安装 Docker Compose v2
apt-get install -y docker-compose-plugin

# 安装 Nginx（宿主机）
apt-get install -y nginx

# 安装 Certbot（Let's Encrypt）
apt-get install -y certbot python3-certbot-nginx

# 安装常用工具
apt-get install -y git curl wget vim htop
```

### 2.2 创建部署目录

```bash
# 选择部署目录（本文以 /opt/alalloy 为例）
mkdir -p /opt/alalloy
cd /opt/alalloy

# 拉取代码（或上传代码包）
git clone https://your-git-repo/alalloy-agent.git .
# 或：scp -r ./Alalloy_agent root@服务器IP:/opt/alalloy
```

### 2.3 创建日志和报告目录

```bash
mkdir -p /opt/alalloy/logs
mkdir -p /opt/alalloy/backend/reports
chmod 755 /opt/alalloy/logs /opt/alalloy/backend/reports
```

---

## 3. 部署前提条件清单

在开始配置之前，请确保以下信息已准备好：

| 项目 | 说明 | 是否已就绪 |
|------|------|-----------|
| 域名 | 例如 `alalloy.yourdomain.com` | ☐ |
| 域名 DNS A 记录 | 指向服务器公网 IP | ☐ |
| SSL 证书 | Let's Encrypt 自动申请，或自备 | ☐ |
| Supabase 项目 | `fyonyyermialezvlvamv` 已创建 | ☑ |
| Supabase 重定向 URL | 需添加生产域名 | ☐ |
| Supabase SMTP | 需配置自定义 SMTP | ☐ |
| QQ 邮箱授权码 | 或其他 SMTP 服务凭据 | ☐ |
| 阿里云 DashScope API Key | LLM 调用 | ☑ |
| FerrisKey Client Secret | 生产 OIDC 认证 | ☐ |
| MCP 服务地址 | 热力学计算服务 URL | ☑ |

---

## 4. 环境变量配置

### 4.1 后端环境变量（`/opt/alalloy/.env`）

```bash
# 复制并编辑
cp .env.example .env
vim .env
```

**完整生产配置如下**（替换 `<<>>` 内容）：

```ini
# =================================================================
# 生产环境配置 — 请勿提交到 Git
# =================================================================

# -----------------------------------------------------------------
# 1. LLM 配置
# -----------------------------------------------------------------
DASHSCOPE_API_KEY=<<你的阿里云百炼 API Key>>
DASHSCOPE_MODEL_NAME=qwen3.5-plus

# -----------------------------------------------------------------
# 2. 认证配置
# -----------------------------------------------------------------
# FerrisKey OIDC（生产 realm）
FERRISKEY_URL=https://ferriskey-api.topmatdev.com
FERRISKEY_REALM=topmat-public
FERRISKEY_CLIENT_ID=alalloy-agent
FERRISKEY_CLIENT_SECRET=<<从 FerrisKey 管理后台获取>>

# ★ 生产关键：替换为实际域名
FRONTEND_CALLBACK_URL=https://alalloy.yourdomain.com/callback
BACKEND_CALLBACK_URL=https://alalloy.yourdomain.com/api/auth/callback
FRONTEND_URL=https://alalloy.yourdomain.com

# SSL 验证（生产必须开启）
VERIFY_SSL=true

# DEV_MODE 关闭（生产必须为 false）
DEV_MODE=false

# JWT 签名密钥（生成强密钥：openssl rand -hex 32）
DEV_JWT_SECRET=<<openssl rand -hex 32 生成的随机字符串>>

# DEV_MODE 测试用户（生产环境可保留，但 DEV_MODE=false 时不会使用）
DEV_USER_ID=dev-user-0001
DEV_USER_EMAIL=dev@yourdomain.com
DEV_USER_NAME=开发测试用户

# -----------------------------------------------------------------
# 3. 服务器配置
# -----------------------------------------------------------------
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8001

# -----------------------------------------------------------------
# 4. MCP 服务
# -----------------------------------------------------------------
MCP_URL=<<MCP 服务地址，生产环境地址>>
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

# -----------------------------------------------------------------
# 6. Supabase
# -----------------------------------------------------------------
SUPABASE_AUTH_ENABLED=true
SUPABASE_URL=https://fyonyyermialezvlvamv.supabase.co
SUPABASE_SERVICE_KEY=<<Supabase Service Role Key>>
SUPABASE_ANON_KEY=<<Supabase Anon Key>>
SUPABASE_JWT_SECRET=<<Supabase JWT Secret>>
SUPABASE_DB_URL=postgresql://postgres.fyonyyermialezvlvamv:<<密码>>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

> **生成强随机密钥**：
> ```bash
> openssl rand -hex 32   # DEV_JWT_SECRET 用
> ```

### 4.2 前端构建参数（Docker Compose 的 build args）

前端是**构建时注入**部分变量（VITE_ 前缀），**运行时可覆盖**部分变量（NUXT_PUBLIC_ 前缀）。

生产环境最关键的构建参数：

```yaml
# docker-compose.yml 的 frontend.build.args 部分
args:
  VITE_BACKEND_HOST: backend          # 容器内网名称，不要改
  VITE_BACKEND_PORT: "8001"           # 容器内后端端口，不要改
  VITE_API_BASE_URL: ""               # 留空，由 nginx 代理处理
  VITE_WS_BASE_URL: ""                # 留空，由 nginx 代理处理
  DEV_MODE: "false"
```

> **注意**：`VITE_API_BASE_URL` 和 `VITE_WS_BASE_URL` 留空，因为前端部署在同域 Nginx 下，`/api` 和 `/ws` 的代理完全由 Nginx 处理，无需显式指定后端地址。

---

## 5. Supabase 生产配置

### 5.1 设置 Site URL

打开：[Supabase Dashboard → Authentication → URL Configuration](https://supabase.com/dashboard/project/fyonyyermialezvlvamv/auth/url-configuration)

| 字段 | 值 |
|------|-----|
| **Site URL** | `https://alalloy.yourdomain.com` |

### 5.2 添加允许的重定向 URL

在 **Redirect URLs** 中添加（每行一个）：

```
https://alalloy.yourdomain.com/**
https://alalloy.yourdomain.com/callback
https://alalloy.yourdomain.com/reset-password
```

> **开发环境也需要加**（如果需要本地测试）：
> ```
> http://localhost:5174/**
> http://localhost:5174/callback
> http://localhost:5174/reset-password
> ```

### 5.3 配置自定义 SMTP

打开：[Supabase Dashboard → Authentication → SMTP Settings](https://supabase.com/dashboard/project/fyonyyermialezvlvamv/auth/smtp)

**使用 QQ 邮箱（最简单，无需注册额外服务）**：

| 字段 | 值 |
|------|-----|
| Enable Custom SMTP | ✅ 开启 |
| Sender email | `你的QQ号@qq.com` |
| Sender name | `铝合金智能设计系统` |
| Host | `smtp.qq.com` |
| Port | `587` |
| Username | `你的QQ号@qq.com` |
| Password | `QQ邮箱授权码`（在 mail.qq.com → 设置 → 账户 → 生成授权码）|

**使用 Resend（国际服务，免费 3000 封/月）**：

| 字段 | 值 |
|------|-----|
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | `re_xxxx`（Resend API Key） |
| Sender email | `no-reply@yourdomain.com` |

### 5.4 启用安全功能（生产推荐）

打开：[Supabase Dashboard → Authentication → Providers → Email](https://supabase.com/dashboard/project/fyonyyermialezvlvamv/auth/providers)

- ☑ **Enable Email Signup**（启用邮箱注册）
- ☑ **Confirm email**（要求邮箱验证，甲方交付可视情况关闭）

打开：[Supabase Dashboard → Authentication → Security](https://supabase.com/dashboard/project/fyonyyermialezvlvamv/auth/providers)

- ☑ **Leaked Password Protection**（检查 HaveIBeenPwned，防泄露密码）

---

## 6. SMTP 邮件配置

邮件功能依赖 Supabase 的 SMTP 配置（见第 5 节）。配置完成后，以下功能将正常工作：
- 密码重置邮件（`/reset-password` 页面）
- 注册确认邮件（如果开启了 Email Confirm）
- 邮箱更改通知

---

## 7. Docker 镜像构建与部署

### 7.1 修改 docker-compose.yml（生产版本）

在服务器上，将 `docker-compose.yml` 修改为生产配置：

```bash
cd /opt/alalloy
vim docker-compose.yml
```

**生产 docker-compose.yml 完整版**：

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: alalloy-backend
    restart: always
    ports:
      - "127.0.0.1:8001:8001"    # ★ 只绑定本地，不暴露到公网
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
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        VITE_BACKEND_HOST: backend
        VITE_BACKEND_PORT: "8001"
        VITE_API_BASE_URL: ""
        VITE_WS_BASE_URL: ""
        DEV_MODE: "false"
    container_name: alalloy-frontend
    restart: always
    ports:
      - "127.0.0.1:8080:80"      # ★ 只绑定本地，由宿主机 Nginx 反代
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - alalloy-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 15s

networks:
  alalloy-network:
    driver: bridge
```

> **安全关键**：`127.0.0.1:8001:8001` 和 `127.0.0.1:8080:80` 将端口只绑定到本地回环，防止直接通过公网 IP 绕过 Nginx 访问。

### 7.2 构建并启动

```bash
cd /opt/alalloy

# 首次部署：构建并后台启动
docker compose up --build -d

# 查看启动日志
docker compose logs -f

# 等待 healthy 状态
docker compose ps
```

### 7.3 验证容器内部正常

```bash
# 检查后端健康
curl http://127.0.0.1:8001/health

# 检查前端可访问
curl -I http://127.0.0.1:8080/

# 检查 API 代理
curl http://127.0.0.1:8080/api/auth/me
# 应返回 401（说明代理正常，鉴权生效）
```

---

## 8. Nginx 反向代理配置（HTTPS）

### 8.1 先临时配置 HTTP（用于申请证书）

```bash
vim /etc/nginx/sites-available/alalloy
```

```nginx
server {
    listen 80;
    server_name alalloy.yourdomain.com;

    # Let's Encrypt 验证路径
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 其余请求临时代理到前端
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/alalloy /etc/nginx/sites-enabled/alalloy
nginx -t && systemctl reload nginx
```

### 8.2 申请 SSL 证书

```bash
mkdir -p /var/www/certbot
certbot certonly --webroot -w /var/www/certbot -d alalloy.yourdomain.com
```

### 8.3 完整 HTTPS 配置

证书申请成功后，替换 Nginx 配置：

```bash
vim /etc/nginx/sites-available/alalloy
```

```nginx
# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name alalloy.yourdomain.com;
    return 301 https://$host$request_uri;
}

# HTTPS 主站
server {
    listen 443 ssl http2;
    server_name alalloy.yourdomain.com;

    # SSL 证书
    ssl_certificate     /etc/letsencrypt/live/alalloy.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/alalloy.yourdomain.com/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    # 安全响应头
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    # 日志
    access_log /var/log/nginx/alalloy_access.log;
    error_log  /var/log/nginx/alalloy_error.log;

    # 前端静态文件 + API/WS 代理（全部转发到前端容器，由容器内 Nginx 再代理后端）
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 普通请求超时
        proxy_connect_timeout 30s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
    }

    # ★ WebSocket（wss://）专用 location
    # 必须在 / 之前，Nginx location 匹配优先级：精确 > 前缀最长
    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # WebSocket 升级协议头（核心，缺少会导致 101 升级失败）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # LLM 长任务超时（24 小时）
        proxy_connect_timeout 86400s;
        proxy_send_timeout    86400s;
        proxy_read_timeout    86400s;
        send_timeout          86400s;

        proxy_buffering off;
        proxy_socket_keepalive on;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

### 8.4 配置证书自动续期

```bash
# 测试续期（不实际续期）
certbot renew --dry-run

# 添加定时任务（每天检查两次）
echo "0 0,12 * * * root certbot renew --quiet && systemctl reload nginx" >> /etc/crontab
```

---

## 9. SSL 证书申请（Let's Encrypt）

> 已在第 8 节中包含，此节仅作补充说明。

**前提**：域名 DNS A 记录已指向服务器 IP，且 80 端口可以从公网访问。

```bash
# 验证 DNS 解析是否正确
dig alalloy.yourdomain.com +short
# 应输出服务器公网 IP

# 申请证书
certbot certonly --webroot -w /var/www/certbot -d alalloy.yourdomain.com

# 证书位置
ls /etc/letsencrypt/live/alalloy.yourdomain.com/
# fullchain.pem  privkey.pem  cert.pem  chain.pem
```

---

## 10. FerrisKey 生产回调配置

如果使用 FerrisKey SSO 登录，需要在 FerrisKey 管理后台（`https://ferriskey-api.topmatdev.com`）为 `alalloy-agent` 客户端添加生产环境的回调 URL：

| 配置项 | 值 |
|--------|-----|
| Valid redirect URIs | `https://alalloy.yourdomain.com/api/auth/callback` |
| Web origins | `https://alalloy.yourdomain.com` |

同时更新后端 `.env`：

```ini
BACKEND_CALLBACK_URL=https://alalloy.yourdomain.com/api/auth/callback
FRONTEND_CALLBACK_URL=https://alalloy.yourdomain.com/callback
FRONTEND_URL=https://alalloy.yourdomain.com
```

---

## 11. 防火墙配置

```bash
# 使用 UFW（Ubuntu Firewall）
ufw default deny incoming
ufw default allow outgoing

# 允许 SSH（重要：先设置，否则断连）
ufw allow 22/tcp

# 允许 HTTP 和 HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# 不要开放 8001 和 8080（由 Docker 绑定到 127.0.0.1，Nginx 反代）

ufw enable
ufw status
```

**验证端口不暴露**：

```bash
# 从外部扫描（应只看到 22/80/443）
nmap -p 8001,8080 你的服务器IP
# 预期：8001/filtered, 8080/filtered
```

---

## 12. 健康检查与监控

### 12.1 服务状态检查脚本

创建 `/opt/alalloy/check-health.sh`：

```bash
#!/bin/bash
echo "=== $(date) ==="

# Docker 容器状态
echo "--- 容器状态 ---"
docker compose -f /opt/alalloy/docker-compose.yml ps

# 后端健康
echo "--- 后端健康 ---"
curl -sf http://127.0.0.1:8001/health && echo " ✅ 后端正常" || echo " ❌ 后端异常"

# 前端健康
echo "--- 前端健康 ---"
curl -sf -I http://127.0.0.1:8080/ | head -1

# HTTPS 访问
echo "--- HTTPS 访问 ---"
curl -sf -I https://alalloy.yourdomain.com/ | head -1

echo ""
```

```bash
chmod +x /opt/alalloy/check-health.sh
/opt/alalloy/check-health.sh
```

### 12.2 查看日志

```bash
# 实时查看所有容器日志
docker compose logs -f

# 只看后端日志
docker compose logs -f backend

# 查看 Nginx 访问日志
tail -f /var/log/nginx/alalloy_access.log

# 查看 Nginx 错误日志
tail -f /var/log/nginx/alalloy_error.log
```

### 12.3 设置定时健康检查

```bash
# 每 5 分钟检查一次，异常写入日志
echo "*/5 * * * * root /opt/alalloy/check-health.sh >> /var/log/alalloy-health.log 2>&1" >> /etc/crontab
```

---

## 13. 登录入口控制（甲方 vs 内部）

系统支持通过单个环境变量控制登录页面显示，**无需重新构建镜像**：

| 场景 | `NUXT_PUBLIC_AUTH_PROVIDER` | 效果 |
|------|---------------------------|------|
| 甲方交付环境 | `supabase` | 只显示邮箱/密码登录 |
| 内部管理环境 | `ferriskey` | 只显示 FerrisKey SSO |
| 同时支持 | `both`（默认） | 两种入口都显示 |

**如何在已部署的容器上动态切换**：

该变量是 `NUXT_PUBLIC_` 前缀，属于 Nuxt 运行时配置，可通过 Docker 环境变量注入，**无需重新打包前端**：

```yaml
# docker-compose.yml 前端 service 添加 environment
frontend:
  environment:
    - NUXT_PUBLIC_AUTH_PROVIDER=supabase   # 甲方部署
```

```bash
# 修改后重启前端容器即可
docker compose restart frontend
```

---

## 14. 回滚与维护

### 14.1 更新部署

```bash
cd /opt/alalloy

# 拉取最新代码
git pull origin main

# 重新构建并重启
docker compose up --build -d

# 验证更新
docker compose ps
/opt/alalloy/check-health.sh
```

### 14.2 仅重启后端

```bash
# 后端代码更新（不需要重新构建前端）
docker compose up --build -d backend
```

### 14.3 回滚到上一版本

```bash
# Git 回滚
git log --oneline -5     # 查看最近提交
git checkout <commit-id>  # 回滚到指定版本

# 重新构建
docker compose up --build -d
```

### 14.4 维护模式

```bash
# 停止服务
docker compose stop

# 在宿主机 Nginx 返回 503 维护提示
# 临时修改 nginx 配置
nginx -t && systemctl reload nginx

# 恢复服务
docker compose start
```

### 14.5 完整重置

```bash
# 停止并删除容器、网络（保留数据卷）
docker compose down

# 清理未使用的镜像
docker image prune -f

# 重新部署
docker compose up --build -d
```

---

## 15. 常见问题排查

### 问题 1：Supabase 密码重置 400 "Unable to validate email address"

**原因**：`redirectTo` URL 不在 Supabase 允许的重定向 URL 白名单中。

**解决**：Supabase Dashboard → Authentication → URL Configuration → 添加：
```
https://alalloy.yourdomain.com/**
```

---

### 问题 2：WebSocket 连接失败（wss 升级失败）

**原因**：Nginx 缺少 WebSocket 升级头，或 `location /ws/` 配置有误。

**检查**：
```bash
# 查看 Nginx 错误日志
grep -i websocket /var/log/nginx/alalloy_error.log

# 测试 WebSocket 连接（需要安装 wscat）
wscat -c wss://alalloy.yourdomain.com/ws/chat?token=test&session_id=test
```

**确认 Nginx 配置**：`location /ws/` 中必须有 `Upgrade` 和 `Connection` 头。

---

### 问题 3：登录后跳回登录页（CORS 报错）

**原因**：后端 `FRONTEND_URL` 未配置为生产域名，CORS 拦截了请求。

**解决**：检查 `.env` 中 `FRONTEND_URL=https://alalloy.yourdomain.com`，并重启后端容器。

```bash
docker compose restart backend
```

---

### 问题 4：FerrisKey SSO 回调失败

**原因**：FerrisKey 的 Valid Redirect URIs 未添加生产回调地址。

**解决**：在 FerrisKey 管理后台添加 `https://alalloy.yourdomain.com/api/auth/callback`，并确认 `.env` 中 `BACKEND_CALLBACK_URL` 已更新。

---

### 问题 5：后端 JWKS 预热失败警告

```
⚠️ FerrisKey JWKS 预热失败（仅影响 SSO 登录，不影响 Supabase）
```

**说明**：如果 FerrisKey 服务暂时不可达，此警告是预期的非致命错误。Supabase 登录不受影响。当 FerrisKey 恢复后，JWKS 会在首次 SSO 请求时自动刷新。

---

### 问题 6：`exec format error`（架构不匹配）

**原因**：镜像在 x86_64 上构建，服务器是 ARM（如阿里云 ARM 实例）。

**解决**：在服务器上直接构建，不要跨架构推送镜像。

```bash
docker compose up --build -d   # 在服务器上直接构建
```

---

## 附录：环境变量速查表

### 后端 `.env` 生产必改项

| 变量 | 本地开发值 | 生产值 |
|------|-----------|--------|
| `FRONTEND_CALLBACK_URL` | `http://localhost:5174/callback` | `https://你的域名/callback` |
| `BACKEND_CALLBACK_URL` | `http://localhost:8001/api/auth/callback` | `https://你的域名/api/auth/callback` |
| `FRONTEND_URL` | `http://localhost:5174` | `https://你的域名` |
| `VERIFY_SSL` | `false` | `true` |
| `DEV_MODE` | `true` 或 `false` | `false` |
| `DEV_JWT_SECRET` | `alalloy-dev-secret-...` | `openssl rand -hex 32` |

### Supabase Dashboard 生产必配项

| 配置位置 | 配置项 | 生产值 |
|---------|--------|--------|
| URL Configuration | Site URL | `https://你的域名` |
| URL Configuration | Redirect URLs | `https://你的域名/**` |
| SMTP Settings | 启用自定义 SMTP | ✅ QQ 邮箱 或 Resend |
| Email Providers | Leaked Password Protection | ✅ 开启 |

### FerrisKey 生产必配项

| 配置位置 | 配置项 | 生产值 |
|---------|--------|--------|
| Client → Settings | Valid Redirect URIs | `https://你的域名/api/auth/callback` |
| Client → Settings | Web Origins | `https://你的域名` |

---

*文档版本：v2.1 | 最后更新：2026-03-06 | Alalloy Agent Multi-Auth 版本*
