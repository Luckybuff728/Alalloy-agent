# Alalloy Agent — 一键部署指南

镜像仓库：`192.168.7.102:5000`

> MCP 计算服务（热力学 / ONNX）单独部署，本文档仅覆盖 Alalloy Agent 主服务。

---

## 一、部署前：修改 `.env`（只改这 4 行）

```bash
cp .env.example .env   # 首次部署
# 或直接编辑已有的 .env
```

**必须修改（用实际服务器 IP 替换）：**

```ini
# ── 服务器地址（影响 FerrisKey SSO 回调 + CORS）──────────
FRONTEND_URL=http://192.168.x.x:8080
FRONTEND_CALLBACK_URL=http://192.168.x.x:8080/callback
BACKEND_CALLBACK_URL=http://192.168.x.x:8001/api/auth/callback

# ── MCP 计算服务（待公司 MCP 服务部署后填入）────────────
# 公司服务器地址：  http://192.168.x.x:端口/mcp
# 若宿主机运行 MCP：http://host.docker.internal:端口/mcp
# 暂未部署时留空或填任意值（后端会打印警告但不崩溃）
MCP_URL=http://111.22.21.99:10001/mcp
```

> **其余字段无需改动**：Supabase 密钥、DashScope API Key、IDME、Supabase DB 等
> 均已在 `.env` 中正确配置，直接构建即可。

---

## 二、本地构建 & 推送（开发机执行）

```bash
# 一键构建两个镜像（前端含 Nuxt 静态构建，约 3-5 分钟）
docker compose build

# 推送到公司 Registry
docker compose push
```

**构建时自动完成的事：**
- 前端 `VITE_BACKEND_HOST=""` → 所有 API/WebSocket 使用相对路径 `/api/` `/ws/`，由容器内 Nginx 代理，无硬编码地址
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` 从 `.env` 读取，烧入 SPA bundle
- `NUXT_PUBLIC_AUTH_PROVIDER=both` → 同时显示 Supabase 邮箱登录 + FerrisKey SSO 按钮

---

## 三、服务器部署（服务器执行）

### 服务器只需要两个文件

```
/opt/alalloy/
├── docker-compose.yml   ← 从项目直接复制
└── .env                 ← 改好 4 行后复制过来
```

### 一键启动

```bash
cd /opt/alalloy

docker compose pull          # 拉取最新镜像
docker compose up -d         # 后台启动

# 查看状态（backend 需约 60 秒健康检查通过后 frontend 才启动）
docker compose ps
```

### 验证

```bash
curl http://localhost:8001/health        # 后端：{"status":"ok"}
curl -o /dev/null -w "%{http_code}" http://localhost:8080/   # 前端：200
```

浏览器访问 `http://SERVER_IP:8080` 即可登录使用。

---

## 四、端口说明

| 端口 | 容器 | 用途 | 公网是否暴露 |
|------|------|------|------------|
| `8080` | 前端 Nginx | 静态页面 + `/api/` + `/ws/` 代理 | ✅ 直接暴露 |
| `8001` | 后端 FastAPI | 健康检查 / API 文档 `/docs` | 可选（调试用）|

**无需宿主机 Nginx** 即可直接通过 `http://IP:8080` 访问。

如需绑定 80 端口或域名（HTTPS），使用项目中的 `nginx-host.conf`：
```bash
cp nginx-host.conf /etc/nginx/conf.d/alalloy.conf
nginx -t && systemctl reload nginx
```
同时将 `docker-compose.yml` 端口改为 `127.0.0.1:8080:80`（只绑本地）。

---

## 五、各配置文件检查结论

### ✅ 均已正确，无需修改

| 文件 | 关键配置 | 说明 |
|------|---------|------|
| `Dockerfile.backend` | 两阶段构建，安装 `curl` 健康检查 | 正确 |
| `Dockerfile.frontend` | `VITE_BACKEND_HOST=""` 空字符串，Node OOM 防护 3GB | 正确 |
| `nginx.conf`（容器内） | `/api/` 和 `/ws/` 代理到 `backend:8001`，`Connection "upgrade"` | 容器间直接代理，无问题 |
| `nginx-main.conf` | `user appuser` | 与 Dockerfile 创建的用户一致 |
| `nginx-host.conf` | `map $http_upgrade $connection_upgrade` | WebSocket 头正确传递 |
| `docker-compose.yml` | `extra_hosts: host.docker.internal:host-gateway` | 容器可访问宿主机服务（如 MCP） |
| `docker-compose.yml` | Supabase build args 从 `.env` 自动读取 | 正确 |

### ⚠️ 了解即可，不影响运行

| 项目 | 现状 | 建议 |
|------|------|------|
| `VERIFY_SSL=false` | 开发环境默认值 | 生产改为 `true` |
| `DEV_JWT_SECRET=...dev-secret` | 弱密钥 | `DEV_MODE=false` 时不用该 key，风险低 |
| MCP 暂未部署 | 后端打印警告，MCP 工具 = 0 | 应用正常启动，待 MCP 上线后更新 `MCP_URL` 重新 push |

---

## 六、Supabase Dashboard 配置（首次部署后执行一次）

登录 [Supabase Dashboard → Authentication → URL Configuration](https://supabase.com/dashboard/project/fyonyyermialezvlvamv/auth/url-configuration)

**Redirect URLs** 中添加（将 IP 替换为实际服务器）：

```
http://192.168.x.x:8080/**
http://192.168.x.x:8080/callback
http://192.168.x.x:8080/reset-password
```

> 不配置此项，**密码重置邮件的链接**将指向错误地址，无法跳回页面。登录本身不受影响。

---

## 七、更新部署

```bash
# 本地：代码改完后
docker compose build && docker compose push

# 服务器：
docker compose pull && docker compose up -d
```

只更新后端（不重新构建前端）：
```bash
docker compose build backend && docker compose push backend
# 服务器：
docker compose pull backend && docker compose up -d backend
```

---

## 八、常用运维命令

```bash
docker compose logs -f              # 实时日志
docker compose logs -f backend      # 只看后端
docker compose restart backend      # 重启单个服务
docker compose down                 # 停止所有
docker image prune -f               # 清理旧镜像
```

---

## 九、常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| MCP 工具 0 个 | `MCP_URL` 指向未部署的服务，或 `127.0.0.1` 在容器内不可达 | 改为 `http://host.docker.internal:端口/mcp` 或公司 IP |
| WebSocket 连接失败（用了宿主机 Nginx）| Nginx 未正确传递 Upgrade 头 | 必须用 `nginx-host.conf`（含 `map $connection_upgrade`）|
| 前端图片无法加载 / 页面空白 | 构建时 `VITE_BACKEND_HOST` 非空 | `Dockerfile.frontend` 已修复为空字符串，重新 build |
| 密码重置邮件链接无效 | Supabase 未配置服务器 Redirect URL | 按第六节添加 |
| 后端健康检查一直 `starting` | LangGraph 初始化慢 | 正常现象，`start_period: 60s`，等待即可 |
| 前端镜像构建 OOM | Docker Desktop 内存不足 | Settings → Resources → Memory 调到 4GB 以上 |
