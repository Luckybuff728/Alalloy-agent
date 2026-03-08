# Alalloy Agent 服务器部署手册

> 服务器：`42.121.165.182`（阿里云）  
> 管理面板：1Panel（访问地址见服务器配置，默认端口通常为 `7878`）

---

## 一、服务器目录结构

| 项目 | 服务器路径 | 说明 |
|------|-----------|------|
| Alalloy Agent | `/opt/alalloy/` | 前后端主服务 |
| TopMat-LLM-Server (MCP) | `/opt/topmat/` | 热力学 MCP 服务 |

### Alalloy Agent 目录（`/opt/alalloy/`）

```
/opt/alalloy/
├── docker-compose.yml        # 服务编排（前端/后端/网络）
├── Dockerfile.backend        # 后端镜像构建（含 pip mirror）
├── Dockerfile.frontend       # 前端镜像构建（服务器版，无 build 段）
├── nginx.conf                # nginx 站点配置
├── nginx-main.conf           # nginx 主配置
├── .env                      # 后端环境变量（MCP_URL、DASHSCOPE_API_KEY 等）
├── backend/                  # 后端 Python 源码
│   └── app/
│       ├── agents/
│       │   ├── builder.py
│       │   ├── nodes.py
│       │   └── prompts/      # analysisExpert.md 等提示词
│       └── infra/
│           └── mcp_service.py
├── frontend_static/          # 前端静态文件（volume 挂载源）
│   └── public/               # ⚠️ nginx 实际读取此目录！
│       ├── index.html
│       ├── _nuxt/
│       └── ...
└── requirements.txt          # Python 依赖（含 langchain-mcp-adapters==0.1.14）
```

### 服务器 docker-compose.yml 说明

```yaml
# 后端：从 Dockerfile.backend 构建，挂载 logs/reports
# 前端：image: nginx:1.25-alpine，volume 挂载 ./frontend_static/public:/usr/share/nginx/html:ro
# ⚠️ 服务器前端无 build 段，静态文件直接放 volume，不需要重建镜像
```

---

## 二、容器状态

| 容器名 | 镜像 | 说明 |
|--------|------|------|
| `alalloy-backend` | `alalloy-backend` | FastAPI 后端，端口 8001 |
| `alalloy-frontend` | `nginx:1.25-alpine` | nginx 静态服务，端口 8080 |
| `topmat-mcp` | `topmat-mcp:latest` | Rust MCP 服务，端口 3000 |
| `topmat-postgres` | `postgres:16-alpine` | 数据库，端口 5432 |

查看容器状态：
```bash
cd /opt/alalloy && docker compose ps
```

---

## 三、前端部署流程

> 适用场景：修改了 `frontend/` 下任何文件

### 步骤 1：本地构建

```powershell
cd D:\DCKJ\Alalloy_agent\frontend
npm run generate
```

- 输出目录：`frontend/.output/public/`
- 若出现 `EBUSY: resource busy or locked` 错误可忽略，build 已完成
- 构建前会自动使用 `frontend/.env.production`（`VITE_BACKEND_HOST=` 为空），确保生产包使用相对路径

### 步骤 2：打包

```powershell
tar -czf "D:\DCKJ\Alalloy_agent\frontend_static.tar.gz" -C "D:\DCKJ\Alalloy_agent\frontend\.output\public" .
```

打包文件位于 `D:\DCKJ\Alalloy_agent\frontend_static.tar.gz`（约 38 MB）

### 步骤 3：上传到服务器

**推荐：通过 1Panel 文件管理器上传**

1. 浏览器打开 1Panel 管理页面登录
2. 进入 **文件** → 导航到 `/opt/alalloy/`
3. 上传 `frontend_static.tar.gz`

> ⚠️ **不要用 Windows SCP 上传大文件**，网络不稳定容易卡住。

### 步骤 4：服务器解压（在 1Panel 终端或 SSH 执行）

```bash
tar xzf /opt/alalloy/frontend_static.tar.gz -C /opt/alalloy/frontend_static/public/ && \
rm /opt/alalloy/frontend_static.tar.gz && \
echo "前端部署完成"
```

> ⚠️ **关键**：必须解压到 `frontend_static/public/`，不是 `frontend_static/`！
> nginx volume 挂载的是 `./frontend_static/public`。

### 步骤 5：验证

```bash
grep -o 'backendHost:"[^"]*"' /opt/alalloy/frontend_static/public/index.html
```

应输出 `backendHost:""` 才正确（空字符串，使用相对路径）。

> ⚠️ 若输出 `backendHost:"localhost"` 则是上传的是错误版本（本地开发包），需重新构建。

---

## 四、后端部署流程

> 适用场景：修改了 `backend/` 下的 Python 文件或 `requirements.txt`

### 步骤 1：上传修改的文件

**通过 1Panel 或 SCP 上传到服务器对应路径：**

| 本地路径 | 服务器路径 |
|---------|-----------|
| `backend/app/agents/builder.py` | `/opt/alalloy/backend/app/agents/builder.py` |
| `backend/app/agents/nodes.py` | `/opt/alalloy/backend/app/agents/nodes.py` |
| `backend/app/agents/prompts/*.md` | `/opt/alalloy/backend/app/agents/prompts/` |
| `backend/app/infra/mcp_service.py` | `/opt/alalloy/backend/app/infra/mcp_service.py` |
| `requirements.txt` | `/opt/alalloy/requirements.txt` |

SCP 单文件上传示例（若网络可用）：
```powershell
& "C:\Windows\System32\OpenSSH\scp.exe" "D:\DCKJ\Alalloy_agent\backend\app\agents\nodes.py" root@42.121.165.182:/opt/alalloy/backend/app/agents/nodes.py
```

### 步骤 2：重建并重启后端容器

```bash
cd /opt/alalloy && docker compose build backend && docker compose up -d backend
```

- Dockerfile.backend 已配置阿里云 PyPI 镜像，pip install 速度快
- `requirements.txt` 中 `langchain-mcp-adapters==0.1.14` 为固定版本，不可升级

### 步骤 3：验证

```bash
docker ps | grep alalloy-backend
docker logs alalloy-backend --tail 20
```

---

## 五、MCP 服务（TopMat-LLM-Server）部署流程

> MCP 服务使用 Rust 编写，需本地 Docker 交叉编译 Linux 二进制

### 编译（本地 Windows，需要 Docker Desktop）

```powershell
cd D:\DCKJ\TopMat-LLM-Server
docker build --platform linux/amd64 -f Dockerfile.server -t topmat-build .
docker create --name tmp-topmat-build topmat-build
docker cp tmp-topmat-build:/app/target/x86_64-unknown-linux-musl/release/TopMat-LLM .
docker rm tmp-topmat-build
```

### 上传二进制到服务器

通过 1Panel 上传 `TopMat-LLM` 到 `/opt/topmat/`

### 服务器重建镜像并重启

```bash
cd /opt/topmat && docker build -t topmat-mcp:latest . && docker compose up -d topmat-mcp
```

---

## 六、环境变量说明

### 本地前端（`frontend/.env`）—— 仅开发用

```ini
VITE_BACKEND_HOST=localhost       # 本地开发直连后端
NUXT_PUBLIC_API_URL=http://localhost:8001
NUXT_PUBLIC_WS_URL=ws://localhost:8001
```

### 生产前端（`frontend/.env.production`）—— 构建时自动覆盖

```ini
VITE_BACKEND_HOST=                # 空值 → 使用相对路径 /api /ws
NUXT_PUBLIC_API_URL=
NUXT_PUBLIC_WS_URL=
```

> `npm run generate` 自动优先读 `.env.production`，两套环境互不干扰。

### 服务器后端（`/opt/alalloy/.env`）

```ini
MCP_URL=http://topmat-mcp:3000/mcp    # Docker 内网访问 MCP 服务
DASHSCOPE_API_KEY=sk-xxx              # 通义千问 API Key
DATABASE_URL=...                      # 若有数据库连接
DEV_MODE=false
```

### 服务器 MCP（`/opt/topmat/.env`）

```ini
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
DATABASE_URL=postgresql://topmat:topmat2026!@postgres:5432/topmat?sslmode=disable
DASHSCOPE_API_KEY=sk-xxx
MCP_TOKEN=tk_xxx
MCP_API_KEY=tk_xxx
```

---

## 七、常见问题排查

### 问题：前端页面报 `localhost:8001` CORS 错误

**原因**：`frontend_static/public/index.html` 中 `backendHost:"localhost"`  
**检查**：
```bash
grep -o 'backendHost:"[^"]*"' /opt/alalloy/frontend_static/public/index.html
```
**修复**：重新用 `npm run generate`（会读 `.env.production`）打包并重新上传解压

### 问题：`cp` 命令需要逐个确认（cp is aliased to cp -i）

使用 `\cp` 绕过别名：
```bash
\cp source destination
```

### 问题：后端 pip install 超时

`Dockerfile.backend` 已配置阿里云 PyPI 镜像，若仍超时检查网络，或手动加参数：
```bash
-i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
```

### 问题：`npm run generate` 报 EBUSY 错误

打包目录 `.output/` 被锁定，忽略该错误，检查 `.output/public/index.html` 是否生成正常即可。若需彻底重新构建，先关闭所有占用 `.output/` 的文件管理器窗口。

### 问题：docker compose build 太快（全命中缓存）

加 `--no-cache` 强制完整重建：
```bash
docker compose build --no-cache backend
```

### 问题：MCP 服务调用结果卡片为空

检查 `langchain-mcp-adapters` 版本：
```bash
docker exec alalloy-backend pip show langchain-mcp-adapters | grep Version
```
必须为 `0.1.14`，若非此版本需重建后端镜像。

---

## 八、SSH 连接

```bash
ssh root@42.121.165.182
```

Windows PowerShell：
```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" root@42.121.165.182
```

> SSH 从本地 Windows 到服务器延迟较高，建议操作尽量在 1Panel 终端执行。
