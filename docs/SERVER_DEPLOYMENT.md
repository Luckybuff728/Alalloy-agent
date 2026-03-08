# Alalloy Agent 服务器部署手册

> 服务器：`42.121.165.182`（阿里云 ECS）  
> 管理面板：1Panel（浏览器访问）  
> SSH 别名：`alalloy-aliyun`（已配置密钥）

---

## 一、架构总览

```
本地 Windows 开发机
│
├─ D:\DCKJ\Alalloy_agent\       ← 前端 + 后端源码
└─ D:\DCKJ\TopMat-LLM-Server\  ← Rust MCP 服务源码

服务器 /opt/alalloy/
├─ docker-compose.yml
├─ Dockerfile.backend
├─ .env
├─ backend/app/                 ← Python 后端（SCP 直接覆盖）
├─ frontend_static/
│   └─ public/                  ← nginx 静态文件目录（⚠️ 必须含 /public）
├─ nginx.conf
└─ nginx-main.conf

服务器 /opt/topmat/
├─ docker-compose.yml
├─ Dockerfile
├─ TopMat-LLM                   ← Rust 二进制（本地交叉编译后上传）
└─ .env
```

### 容器列表

| 容器 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `alalloy-backend` | `alalloy-backend` | 8001 | FastAPI 后端 |
| `alalloy-frontend` | `nginx:1.25-alpine` | 8080→80 | nginx 静态服务 |
| `topmat-mcp` | `topmat-mcp:latest` | 3000 | Rust MCP 服务 |
| `topmat-postgres` | `postgres:16-alpine` | 5432 | 数据库 |

---

## 二、SSH 连接配置

本地 `~/.ssh/config` 已配置：

```
Host alalloy-aliyun
  HostName 42.121.165.182
  Port 22
  User root
  IdentityFile ~/.ssh/alalloy_aliyun
  ServerAliveInterval 60
  ServerAliveCountMax 3
  ConnectTimeout 10
```

**使用方式（PowerShell）：**
```powershell
# SSH 登录
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun

# SCP 上传文件
& "C:\Windows\System32\OpenSSH\scp.exe" localfile.py alalloy-aliyun:/opt/alalloy/path/
```

> ⚠️ **不要**用 `root@42.121.165.182`（无密钥会挂起等待密码），**必须**用 `alalloy-aliyun` 别名。  
> ⚠️ GitHub 在阿里云服务器上 **443 端口被封**，服务器端 `git pull` 永远超时。

---

## 三、部署流程一览

```mermaid
flowchart TD
    A([开始部署]) --> B{改了什么?}
    B -->|frontend/ 有改动| C[前端部署]
    B -->|backend/ 有改动| D[后端部署]
    B -->|TopMat-LLM-Server 有改动| E[MCP 部署]
    B -->|都改了| C & D

    subgraph C[前端部署]
        C1[npm run generate] --> C2{验证 backendHost 为空?}
        C2 -->|否| C3[❌ 检查 .env.production]
        C2 -->|是| C4[tar 管道 ssh 上传]
        C4 --> C5[解压到 frontend_static/public/]
        C5 --> C6[nginx 自动生效]
    end

    subgraph D[后端部署]
        D1[SCP 上传 .py 和 .md 文件] --> D2[docker compose build backend]
        D2 --> D3[docker compose up -d backend]
        D3 --> D4{等待 healthy}
        D4 -->|90s 内 healthy| D5[✅ 验证版本]
        D4 -->|超时| D6[查看 docker logs]
    end

    subgraph E[MCP 部署]
        E1[本地 Docker 交叉编译] --> E2[SCP 上传 TopMat-LLM 二进制]
        E2 --> E3[服务器 docker build + up]
    end
```

---

## 四、一键部署脚本

> 脚本路径：`scripts/deploy.ps1`

```powershell
cd D:\DCKJ\Alalloy_agent

.\scripts\deploy.ps1              # 自动检测 git 变更
.\scripts\deploy.ps1 -Frontend    # 仅前端
.\scripts\deploy.ps1 -Backend     # 仅后端
.\scripts\deploy.ps1 -All         # 前端 + 后端
```

---

## 五、前端详细部署流程

```mermaid
flowchart LR
    A[修改 frontend/ 代码] --> B[.\scripts\deploy.ps1 -Frontend]
    B --> C{.env.production 存在?}
    C -->|否| D[自动创建]
    C -->|是| E
    D --> E[npm run generate]
    E --> F{index.html 中\nbackendHost 为空?}
    F -->|backendHost=localhost| G[❌ 构建包有问题\n重新构建]
    F -->|backendHost=空字符串| H[tar 管道 ssh 上传\n到 frontend_static/public/]
    H --> I[验证服务器文件]
    I --> J[✅ 刷新浏览器 Ctrl+Shift+R]
```

### 手动操作步骤

```powershell
# 1. 构建（自动读取 .env.production）
cd D:\DCKJ\Alalloy_agent\frontend
npm run generate

# 2. 验证（backendHost 必须为空字符串）
$c = Get-Content ".output\public\index.html" -Raw
if ($c -match 'backendHost:"([^"]*)"') { Write-Host "backendHost='$($Matches[1])'" }

# 3. 上传（tar|ssh 管道，不卡死）
# 通过脚本执行: .\scripts\deploy.ps1 -Frontend
```

### 关键路径

| 本地 | 服务器 |
|------|--------|
| `frontend/.output/public/` | `/opt/alalloy/frontend_static/public/` |

> ⚠️ **nginx volume 挂载的是 `frontend_static/public/`**（有 `/public` 子目录），  
> 解压到 `frontend_static/` 根目录时 nginx 读不到！

---

## 六、后端详细部署流程

```mermaid
flowchart LR
    A[修改 backend/ 代码] --> B[.\scripts\deploy.ps1 -Backend]
    B --> C[SCP 上传各 .py 和 .md 文件\n到服务器对应路径]
    C --> D[docker compose build backend]
    D --> E[docker compose up -d backend]
    E --> F{等待 healthy\n最多 90s}
    F --> G[验证 langchain-mcp-adapters==0.1.14]
    G --> H[✅ 后端更新完成]
```

### 上传文件映射

| 本地路径 | 服务器路径 |
|---------|-----------|
| `backend/app/agents/builder.py` | `/opt/alalloy/backend/app/agents/` |
| `backend/app/agents/nodes.py` | `/opt/alalloy/backend/app/agents/` |
| `backend/app/agents/prompts/*.md` | `/opt/alalloy/backend/app/agents/prompts/` |
| `backend/app/infra/mcp_service.py` | `/opt/alalloy/backend/app/infra/` |
| `backend/app/api/websocket/stream.py` | `/opt/alalloy/backend/app/api/websocket/` |
| `requirements.txt` | `/opt/alalloy/` |

---

## 七、MCP 服务（TopMat-LLM-Server）部署

```mermaid
flowchart LR
    A[修改 Rust 源码] --> B[本地 Docker 交叉编译\nDockerfile.server]
    B --> C[提取 linux/amd64 二进制\nTopMat-LLM]
    C --> D[SCP 上传到服务器\n/opt/topmat/TopMat-LLM]
    D --> E[docker build -t topmat-mcp:latest .]
    E --> F[docker compose up -d topmat-mcp]
    F --> G[✅ MCP 服务更新完成]
```

### 本地交叉编译命令

```powershell
cd D:\DCKJ\TopMat-LLM-Server
docker build --platform linux/amd64 -f Dockerfile.server -t topmat-build .
docker create --name tmp-build topmat-build
docker cp tmp-build:/app/target/x86_64-unknown-linux-musl/release/TopMat-LLM .
docker rm tmp-build

# 上传到服务器
& "C:\Windows\System32\OpenSSH\scp.exe" TopMat-LLM alalloy-aliyun:/opt/topmat/TopMat-LLM

# 服务器端重建
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "cd /opt/topmat; docker build -t topmat-mcp:latest .; docker compose up -d topmat-mcp"
```

---

## 八、环境变量

### 前端构建环境变量

| 文件 | 用途 | `VITE_BACKEND_HOST` |
|------|------|---------------------|
| `frontend/.env` | 本地开发 | `localhost`（直连 8001） |
| `frontend/.env.production` | **生产构建** | `""`（空值，使用 nginx 相对路径） |

`npm run generate` 自动优先读 `.env.production`，两套环境互不干扰。

### 服务器后端（`/opt/alalloy/.env`）

```ini
MCP_URL=http://topmat-mcp:3000/mcp
DASHSCOPE_API_KEY=sk-xxx
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

## 九、常见问题

### 前端页面报 `localhost:8001` CORS 错误

**原因**：`index.html` 中 `backendHost:"localhost"` — 构建包是用开发环境变量构建的。

```bash
# 服务器验证
grep -c "localhost" /opt/alalloy/frontend_static/public/index.html
# 输出 0 才正确
```

**修复**：重新执行 `.\scripts\deploy.ps1 -Frontend`，确保 `frontend/.env.production` 存在。

---

### SSH 连接挂起不返回

**原因**：用了 `root@42.121.165.182` 裸地址，没有指定密钥，等待密码输入。

**修复**：始终使用别名 `alalloy-aliyun`：
```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "your command"
```

---

### 服务器 `git pull` 超时

**原因**：GitHub `443` 端口在阿里云服务器上被封。

**正确做法**：在本地 `git push github master`，然后通过 SCP 上传变更文件到服务器，无需 `git pull`。

---

### `docker compose build` 太快（全缓存）

```bash
cd /opt/alalloy
docker compose build --no-cache backend
docker compose up -d backend
```

---

### MCP 结果卡片为空 / 显示异常

```bash
docker exec alalloy-backend pip show langchain-mcp-adapters | grep Version
# 必须为 0.1.14
```

若版本不对，修改 `requirements.txt` 固定版本后重建后端镜像。

---

## 十、快速命令参考

```powershell
# ── 部署 ──────────────────────────────────────────────
.\scripts\deploy.ps1 -Backend     # 后端
.\scripts\deploy.ps1 -Frontend    # 前端
.\scripts\deploy.ps1 -All         # 全部

# ── 服务器状态 ─────────────────────────────────────────
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "docker ps --format 'table {{.Names}}\t{{.Status}}'"

# ── 查看日志 ───────────────────────────────────────────
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "docker logs alalloy-backend --tail 30"
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "docker logs topmat-mcp --tail 30"

# ── 重启容器 ───────────────────────────────────────────
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "cd /opt/alalloy; docker compose restart backend"
```
