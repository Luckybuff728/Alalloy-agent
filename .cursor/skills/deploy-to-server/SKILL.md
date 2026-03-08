---
name: deploy-to-server
description: 将 Alalloy Agent 项目部署到阿里云服务器（42.121.165.182）。当用户说"部署到服务器"、"推送部署"、"更新服务器"、"deploy"、"前端/后端有改动需要部署"时使用此 Skill。自动判断前端/后端哪些文件变化，通过 PowerShell 脚本全自动完成，无需手动操作。
---

# Alalloy Agent 服务器部署

## 一键部署（标准流程）

所有部署通过 `scripts/deploy.ps1` 完成，**无需手动操作任何文件**。

```powershell
# 自动检测 git 变更，按需部署
.\scripts\deploy.ps1

# 强制部署前端
.\scripts\deploy.ps1 -Frontend

# 强制部署后端
.\scripts\deploy.ps1 -Backend

# 前端+后端全部部署
.\scripts\deploy.ps1 -All
```

在 Cursor 中执行时，从项目根目录运行：
```powershell
Set-Location "D:\DCKJ\Alalloy_agent"
.\scripts\deploy.ps1 -All
```

---

## 关键配置

| 项目 | 值 |
|------|-----|
| 服务器 | `root@42.121.165.182` |
| Alalloy 路径 | `/opt/alalloy/` |
| **前端静态文件** | `/opt/alalloy/frontend_static/public/` ⚠️ 必须含 `/public` |
| 上传方式 | `tar \| ssh` 管道（非 SCP，不会卡死） |

---

## 脚本工作原理

### 前端流程
1. 检查/创建 `frontend/.env.production`（确保 `VITE_BACKEND_HOST=` 为空）
2. `npm run generate` 构建静态文件
3. 验证 `index.html` 中 `backendHost:""` 为空字符串
4. **通过临时 bat 文件执行 `tar|ssh` 管道**上传（避免 PowerShell 破坏二进制流）
5. SSH 验证服务器端 `backendHost` 正确

### 后端流程
1. SCP 上传各个小文件（`builder.py`、`nodes.py`、`prompts/*.md` 等）
2. SSH 执行 `docker compose build backend`
3. SSH 执行 `docker compose up -d backend`
4. 轮询等待容器变为 `healthy`
5. 验证 `langchain-mcp-adapters==0.1.14`

---

## 常见问题

### 前端部署后浏览器仍报 localhost CORS 错误
- 强制刷新：`Ctrl+Shift+R`
- 检查 `frontend/.env.production` 是否存在且 `VITE_BACKEND_HOST=` 为空值
- 重新运行 `.\scripts\deploy.ps1 -Frontend`

### tar|ssh 管道失败
检查 SSH 连接是否正常：
```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" -o ConnectTimeout=10 root@42.121.165.182 "echo ok"
```

### 后端 docker compose build 太快（全命中缓存）
在脚本中改为 `--no-cache`，或在 1Panel 终端手动执行：
```bash
cd /opt/alalloy && docker compose build --no-cache backend && docker compose up -d backend
```

### MCP 服务部署（Rust，需手动）
MCP 服务需要 Docker 交叉编译，暂不在自动脚本中，参见：
[docs/SERVER_DEPLOYMENT.md](../../docs/SERVER_DEPLOYMENT.md) 第五节

---

## 环境变量说明

| 文件 | 用途 | backendHost |
|------|------|-------------|
| `frontend/.env` | 本地开发 | `localhost`（直连 8001） |
| `frontend/.env.production` | 生产构建 | `""`（nginx 相对路径） |

`npm run generate` 自动优先读 `.env.production`，两套环境互不干扰。
