# Alalloy Agent v2.0 — 铝合金智能设计系统

基于 **LangChain 1.x + LangGraph 1.x** 官方最佳实践构建的铝合金智能设计系统。  
采用 **Supervisor Loop** 多智能体架构，集成 IDME 历史数据库、ONNX 性能预测和 Calphad 热力学计算，  
通过自然语言交互实现从需求分析到候选成分推荐、性能验证、热力学分析、报告生成的全流程自动化。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **Supervisor Loop 架构** | Thinker 路由 + 四专家协作（thinker / dataExpert / analysisExpert / reportWriter） |
| **结构化路由** | Pydantic Model 替代正则解析，类型安全，避免 LLM 幻觉路由 |
| **AgentMiddleware 体系** | ContextEditingMiddleware + HumanInTheLoopMiddleware + ModelCallLimitMiddleware |
| **HITL 人机协同** | `interrupt()` + `Command(resume)` 官方机制，show_guidance_widget 引导决策 |
| **MCP 工具集成** | ONNX 性能预测 + Calphad 热力学计算（点/线/Scheil 三种任务） |
| **流式响应** | WebSocket 实时推送 token、工具状态、HITL 请求 |
| **会话持久化** | LangGraph Checkpointer + Supabase PostgreSQL |

---

## 系统架构

### 智能体拓扑（Supervisor Loop）

```
START → thinker ──┬──→ dataExpert     → thinker
                  ├──→ analysisExpert → thinker
                  ├──→ reportWriter   → thinker
                  └──→ END
```

每个专家节点均为独立的 `create_agent` 子图，完成当前阶段后回到 thinker 重新路由。

### 专家职责

| 专家 | 职责 |
|------|------|
| **thinker** | 分析对话上下文，路由至合适专家或结束 |
| **dataExpert** | IDME 数据库查询、候选成分推荐、引导挂件 |
| **analysisExpert** | ONNX 批量性能预测、Calphad 热力学计算（默认三种类型） |
| **reportWriter** | 汇总所有阶段数据，生成结构化 Markdown 报告 |

### WebSocket 通信协议

```
前端 (Nuxt)                   后端 (FastAPI + LangGraph)
  │                                       │
  │──── {type:"chat", message:"..."}────►│
  │◄─── {type:"agent_update"}────────────│  thinker 决策
  │◄─── {type:"tool_result"}─────────────│  工具执行结果
  │◄─── {type:"token"}───────────────────│  流式 token
  │◄─── {type:"interrupt"}───────────────│  HITL 引导挂件
  │──── {type:"resume", decisions:[...]}►│  用户选择
  │◄─── {type:"chat_complete"}───────────│  对话完成
```

---

## 项目结构

```
Alalloy_agent/
├── Dockerfile.backend          # 后端镜像构建文件
├── Dockerfile.frontend         # 前端镜像构建文件
├── docker-compose.yml          # Docker Compose 编排
├── nginx.conf                  # Nginx 站点配置
├── nginx-main.conf             # Nginx 主配置
├── DOCKER_DEPLOY.md            # Docker 部署指南
├── run.py                      # 本地开发启动入口
├── requirements.txt            # 根依赖（核心框架）
├── .env.example                # 环境变量模板
├── backend/
│   ├── requirements.txt        # 后端补充依赖
│   └── app/
│       ├── main.py             # FastAPI 入口
│       ├── core/               # 核心配置
│       │   ├── llm.py          # DashScope 通义千问配置
│       │   └── logger.py       # Loguru 日志
│       ├── agents/             # LangGraph 智能体层
│       │   ├── state.py        # AlalloyState
│       │   ├── nodes.py        # thinker + 专家节点构建
│       │   ├── builder.py      # StateGraph 图构建
│       │   └── prompts/        # Markdown 提示词
│       │       ├── thinker.md
│       │       ├── dataExpert.md
│       │       ├── analysisExpert.md
│       │       └── reportWriter.md
│       ├── api/                # API 层
│       │   ├── rest.py         # REST 接口（会话管理）
│       │   ├── auth.py         # OIDC 认证
│       │   └── websocket/      # WebSocket
│       │       ├── routes.py   # WS 路由（chat / resume）
│       │       ├── stream.py   # 流式事件处理
│       │       └── manager.py  # 连接管理
│       ├── infra/              # 基础设施层
│       │   ├── mcp_service.py  # MCP 工具（ONNX + Calphad）
│       │   ├── idme_service.py # IDME 华为云 API
│       │   ├── calphad_service.py  # Calphad 异步计算
│       │   └── supabase_client.py  # 会话持久化
│       ├── tools/              # LangChain @tool 定义
│       │   ├── idme_tool.py
│       │   ├── guidance_tool.py
│       │   └── composition_tool.py
│       └── utils/
│           └── composition.py  # 成分解析 / 原子分数转换
└── frontend/                   # Nuxt 4 前端
    ├── app/
    │   ├── components/         # Vue 组件
    │   │   ├── chat/           # 对话界面
    │   │   └── results/charts/ # 性能图表、热力学图表
    │   ├── composables/        # useMultiAgent / useWebSocket 等
    │   ├── stores/             # Pinia 状态管理
    │   └── utils/              # toolResultHandler / markdown-lite
    ├── nuxt.config.ts
    └── package.json
```

---

## 快速开始

### 环境要求

- Python 3.10+（推荐使用 Conda `agent` 环境）
- Node.js 20+
- 阿里云百炼 API Key（通义千问模型）

### 1. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填写以下必需项：

```env
# LLM（必需）
DASHSCOPE_API_KEY=你的阿里云百炼API密钥

# MCP 工具服务（ONNX + Calphad）
MCP_URL=http://你的MCP服务器地址/mcp
MCP_TOKEN=你的MCP访问令牌

# 华为云 IDME 数据库
HUAWEI_USER_NAME=你的账号
HUAWEI_PASSWORD=你的密码

# Supabase 会话持久化
SUPABASE_URL=你的Supabase项目URL
SUPABASE_SERVICE_KEY=你的Service Role Key
SUPABASE_DB_URL=你的PostgreSQL连接字符串
```

---

### 2. 创建并激活 Python 环境

**方式 A：使用 Conda（推荐）**

```bash
# 创建专用环境（仅首次）
conda create -n agent python=3.11 -y

# 激活环境
conda activate agent
```

**方式 B：使用 Python venv**

```bash
# 创建虚拟环境（仅首次）
python -m venv .venv

# 激活（Windows PowerShell）
.venv\Scripts\Activate.ps1

# 激活（macOS / Linux）
source .venv/bin/activate
```

---

### 3. 启动后端

```bash
# 确保已激活上面创建的 Python 环境，然后安装依赖
pip install -r requirements.txt
pip install -r backend/requirements.txt

# 初始化数据库表（首次运行）
# 在 Supabase 控制台 SQL 编辑器中依次执行：
#   backend/migrations/001_create_sessions.sql
#   backend/migrations/002_create_checkpoints.sql

# 启动后端服务
python run.py
```

后端地址：
- API 文档：`http://localhost:8001/docs`
- WebSocket：`ws://localhost:8001/ws/chat/{session_id}`

---

### 3. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 开发模式启动
npm run dev
```

前端地址：`http://localhost:5174`

> **开发模式**：在 `.env` 中设置 `DEV_MODE=true` 可跳过 IAM 认证，直接访问系统。

---

## Docker 部署

参见 [DOCKER_DEPLOY.md](./DOCKER_DEPLOY.md) 获取完整的 Docker 构建与部署说明。

简要步骤：

```bash
# 构建镜像
docker build -f Dockerfile.backend -t 192.168.6.104:5000/alalloy-agent-backend:latest .
docker build -f Dockerfile.frontend -t 192.168.6.104:5000/alalloy-agent-frontend:latest .

# 推送镜像
docker push 192.168.6.104:5000/alalloy-agent-backend:latest
docker push 192.168.6.104:5000/alalloy-agent-frontend:latest

# 启动服务
docker compose up -d
```

访问地址：
- 前端界面：`http://服务器IP:8080`
- 后端 API 文档：`http://服务器IP:8001/docs`

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **LangChain** | 1.x | create_agent + Middleware |
| **LangGraph** | 1.x | StateGraph + Checkpointer + Interrupts |
| **FastAPI** | 0.115+ | Web 框架 + WebSocket |
| **DashScope** | — | 通义千问 LLM（qwen-plus） |
| **MCP** | — | ONNX 性能预测 + Calphad 热力学 |
| **Supabase** | 2.x | 会话持久化（PostgreSQL） |
| **Nuxt** | 4.x | 前端框架（SPA 静态模式） |
| **Element Plus** | — | UI 组件库 |

---

## 许可证

内部项目，仅供授权使用。
