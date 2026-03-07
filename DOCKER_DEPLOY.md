# Alalloy Agent — 一键部署指南

镜像仓库：`192.168.7.102:5000`

---

## 前提

- 本地：Docker Desktop 已安装，已添加 insecure registry  
  → Docker Desktop → Settings → Docker Engine → 加入：  
  `"insecure-registries": ["192.168.7.102:5000"]`
- 服务器：Docker 和 Docker Compose 已安装

---

## 一、本地构建 & 推送（开发机执行）

### 1. 配置 `.env`

```bash
cp .env.example .env
```

**必须修改的字段（用实际 IP 替换 `SERVER_IP`）：**

```ini
FRONTEND_URL=http://SERVER_IP:8080
FRONTEND_CALLBACK_URL=http://SERVER_IP:8080/callback
BACKEND_CALLBACK_URL=http://SERVER_IP:8001/api/auth/callback

DASHSCOPE_API_KEY=sk-你的阿里云密钥

# MCP：宿主机服务用 host.docker.internal，公司服务器直接填 IP
MCP_URL=http://host.docker.internal:3000/mcp   # 或 http://192.168.x.x:端口/mcp
MCP_TOKEN=你的Token

# Supabase（已填好，一般不用动）
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
SUPABASE_ANON_KEY=...
SUPABASE_JWT_SECRET=...
SUPABASE_DB_URL=...
```

> FerrisKey SSO 的 `FERRISKEY_CLIENT_SECRET` 只在使用企业 SSO 登录时才需要，Supabase 邮箱登录不需要。

### 2. 构建 & 推送

```bash
# 一键构建两个镜像（前端含 Nuxt 静态构建，约 3-5 分钟）
docker compose build

# 推送到公司 Registry
docker compose push
```

---

## 二、服务器部署（服务器执行）

### 服务器只需要两个文件

```
/opt/alalloy/
├── docker-compose.yml   ← 从项目复制
└── .env                 ← 从 .env.example 填写
```

### 部署命令

```bash
cd /opt/alalloy

# 拉取最新镜像
docker compose pull

# 启动（后台运行）
docker compose up -d

# 查看状态
docker compose ps
```

### 验证

```bash
# 后端健康
curl http://localhost:8001/health

# 前端可访问
curl -o /dev/null -w "%{http_code}" http://localhost:8080/
```

浏览器访问：`http://SERVER_IP:8080`

---

## 三、Supabase Dashboard 配置（首次部署后执行一次）

登录 [Supabase Dashboard](https://supabase.com/dashboard/project/fyonyyermialezvlvamv)

**Authentication → URL Configuration → Redirect URLs** 添加：

```
http://SERVER_IP:8080/**
http://SERVER_IP:8080/callback
http://SERVER_IP:8080/reset-password
```

> 这一步不做，密码重置邮件的链接无法跳回正确页面。登录本身不受影响。

---

## 四、端口说明

| 端口 | 用途 | 浏览器访问 |
|------|------|-----------|
| `8080` | 前端（Nginx + 静态文件 + API代理）| ✅ 直接访问 |
| `8001` | 后端 FastAPI（含健康检查/API文档）| 可选，调试用 |

> 所有 `/api/` 和 `/ws/` 请求由前端 Nginx 容器内部代理到后端，浏览器无感知。  
> 无需宿主机 Nginx 即可运行；如需绑定 80 端口或域名，使用项目中的 `nginx-host.conf`。

---

## 五、更新部署

```bash
# 本地（重新构建并推送）
docker compose build && docker compose push

# 服务器
docker compose pull && docker compose up -d
```

---

## 六、常用运维命令

```bash
# 实时日志
docker compose logs -f

# 只看后端日志
docker compose logs -f backend

# 重启单个服务
docker compose restart backend

# 停止所有
docker compose down

# 清理旧镜像
docker image prune -f
```

---

## 七、常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| 登录后 API 请求 403 | CORS 或 Token 问题 | 检查 `FRONTEND_URL` 是否填了服务器 IP |
| WebSocket 连接失败 | Nginx 未转发 Upgrade 头 | 如用宿主机 Nginx，必须用 `nginx-host.conf`（含 map 配置）|
| MCP 工具 0 个 | 容器内 `127.0.0.1` 不通 | `MCP_URL` 改用 `host.docker.internal` 或服务器 IP |
| 前端构建 OOM | Docker 内存不足 | Docker Desktop 设置 Memory ≥ 4GB |
| 密码重置邮件链接打不开 | Supabase 未配置 Redirect URL | 按第三节添加服务器地址 |
| 健康检查一直 starting | 后端启动慢（加载 LangGraph）| 正常，等 60 秒左右 |
