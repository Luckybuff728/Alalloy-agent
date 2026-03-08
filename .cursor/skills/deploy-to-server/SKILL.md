---
name: deploy-to-server
description: 将 Alalloy Agent 部署到阿里云服务器（42.121.165.182）。当用户说"部署"、"推送部署"、"更新服务器"、"deploy"、"前端/后端有改动需要上线"时使用此 Skill。通过 scripts/deploy.ps1 一键完成，SSH 使用 alalloy-aliyun 别名（密钥认证），无需手动操作。
---

# Alalloy Agent 服务器部署

## 前置知识（必须记住）

| 项目 | 值 | 备注 |
|------|-----|------|
| SSH 别名 | `alalloy-aliyun` | **必须用别名，不能用裸 IP** |
| SSH 密钥 | `~/.ssh/alalloy_aliyun` | config 已配置 |
| 服务器 IP | `42.121.165.182` | |
| GitHub 可达性 | ❌ 服务器访问 GitHub 被封 | 不能在服务器上 `git pull` |
| 前端静态目录 | `/opt/alalloy/frontend_static/public/` | **含 `/public` 子目录** |
| 后端源码目录 | `/opt/alalloy/backend/app/` | SCP 直接覆盖 |

---

## 标准部署命令

```powershell
cd D:\DCKJ\Alalloy_agent
.\scripts\deploy.ps1              # 自动检测 git 变更
.\scripts\deploy.ps1 -Frontend    # 仅前端
.\scripts\deploy.ps1 -Backend     # 仅后端
.\scripts\deploy.ps1 -All         # 全部
```

脚本自动完成所有步骤，无需手动操作。

---

## 脚本内部流程

### 后端流程（-Backend）
1. SCP 上传 `backend/**/*.py`、`backend/**/*.md`、`requirements.txt` 到服务器
2. SSH 执行 `docker compose build backend`
3. SSH 执行 `docker compose up -d backend`
4. 轮询等待容器状态变为 `healthy`（最多 90s）
5. 验证 `langchain-mcp-adapters==0.1.14`

### 前端流程（-Frontend）
1. 检查/创建 `frontend/.env.production`（`VITE_BACKEND_HOST=` 为空）
2. 本地 `npm run generate` 构建静态文件
3. 验证 `index.html` 中 `backendHost:""` 为空字符串
4. 通过临时 `.bat` 文件执行 `tar | ssh` 管道上传到 `frontend_static/public/`
5. SSH 验证服务器 `index.html` 不含 `localhost`

---

## 手动 SSH / SCP（脚本外单独使用）

```powershell
$SSH = "C:\Windows\System32\OpenSSH\ssh.exe"
$SCP = "C:\Windows\System32\OpenSSH\scp.exe"

# SSH 执行命令
& $SSH alalloy-aliyun "docker ps"

# SCP 上传单个文件
& $SCP "D:\DCKJ\Alalloy_agent\backend\app\agents\nodes.py" "alalloy-aliyun:/opt/alalloy/backend/app/agents/nodes.py"

# 查看后端日志
& $SSH alalloy-aliyun "docker logs alalloy-backend --tail 30"

# 重建后端（手动）
& $SSH alalloy-aliyun "cd /opt/alalloy; docker compose build backend; docker compose up -d backend"
```

---

## 常见问题快速处理

### 前端报 localhost CORS 错误
```powershell
.\scripts\deploy.ps1 -Frontend
# 然后浏览器 Ctrl+Shift+R 强制刷新
```

### SSH 挂起不返回
原因：用了裸 IP 没有密钥。改用别名：
```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "echo ok"
```

### docker build 命中全缓存太快
在 1Panel 终端手动执行：
```bash
cd /opt/alalloy && docker compose build --no-cache backend && docker compose up -d backend
```

### MCP 结果卡片为空
```powershell
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "docker exec alalloy-backend pip show langchain-mcp-adapters | grep Version"
# 必须输出 0.1.14
```

---

## MCP 服务部署（Rust，需手动）

```powershell
cd D:\DCKJ\TopMat-LLM-Server
docker build --platform linux/amd64 -f Dockerfile.server -t topmat-build .
docker create --name tmp topmat-build
docker cp tmp:/app/target/x86_64-unknown-linux-musl/release/TopMat-LLM .
docker rm tmp
& "C:\Windows\System32\OpenSSH\scp.exe" TopMat-LLM alalloy-aliyun:/opt/topmat/TopMat-LLM
& "C:\Windows\System32\OpenSSH\ssh.exe" alalloy-aliyun "cd /opt/topmat; docker build -t topmat-mcp:latest .; docker compose up -d topmat-mcp"
```

---

## 完整文档

参见 [docs/SERVER_DEPLOYMENT.md](../../docs/SERVER_DEPLOYMENT.md)
