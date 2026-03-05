# Docker 部署指南 — Alalloy Agent

镜像仓库地址：`192.168.6.104:5000`

---

## 快速部署

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填写必需的密钥
```

最少需要配置的字段：

```env
DASHSCOPE_API_KEY=你的阿里云百炼API密钥
MCP_URL=http://你的MCP服务地址/mcp
MCP_TOKEN=你的MCP访问令牌
SUPABASE_URL=你的Supabase地址
SUPABASE_SERVICE_ROLE_KEY=你的Supabase密钥
```

---

### 2. 构建镜像

```bash
# 构建后端镜像
docker build -f Dockerfile.backend -t 192.168.6.104:5000/alalloy-agent-backend:latest .

# 构建前端镜像
docker build -f Dockerfile.frontend -t 192.168.6.104:5000/alalloy-agent-frontend:latest .
```

---

### 3. 推送镜像

```bash
docker push 192.168.6.104:5000/alalloy-agent-backend:latest
docker push 192.168.6.104:5000/alalloy-agent-frontend:latest
```

---

### 4. 启动服务

```bash
# 拉取最新镜像并启动
docker compose pull
docker compose up -d

# 查看运行状态
docker compose ps

# 查看实时日志
docker compose logs -f
```

---

### 5. 访问应用

- 前端界面：`http://服务器IP:8080`
- 后端 API 文档：`http://服务器IP:8001/docs`
- WebSocket：`ws://服务器IP:8001/ws/chat/{session_id}`

---

## 常用命令

```bash
# 停止服务
docker compose down

# 重启服务
docker compose restart

# 仅重新构建后端（不影响前端）
docker compose build --no-cache backend
docker compose up -d backend

# 清理未使用的镜像
docker image prune -a
```

---

## 故障排查

```bash
# 查看后端日志
docker compose logs backend

# 查看前端日志
docker compose logs frontend

# 进入后端容器调试
docker compose exec backend /bin/bash

# 进入前端容器调试
docker compose exec frontend /bin/sh
```

**常见问题**：

| 现象 | 排查方向 |
|------|---------|
| 后端健康检查失败 | 检查 `.env` 中 `DASHSCOPE_API_KEY` 是否正确 |
| 前端无法连接后端 | 检查 `nginx.conf` 中 `proxy_pass` 地址是否为 `backend:8001` |
| MCP 工具不可用 | 检查 `MCP_URL` 和 `MCP_TOKEN` 配置 |
| Calphad 任务失败 | 检查 `TOPMAT_TOKEN` 和 `TOPMAT_API_URL` 配置 |
| 端口冲突 | 修改 `docker-compose.yml` 中的端口映射（如 `"8080:80"`） |
