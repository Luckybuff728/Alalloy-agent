# Alalloy Agent v2.0 - 铝合金智能设计系统

基于 **LangChain 1.x + LangGraph 1.x** 官方最佳实践重构的铝合金智能设计系统。
采用 **Supervisor Loop** 架构，集成 IDME 知识图谱、ONNX 性能预测和 Calphad 热力学计算。

## 核心特性

- **Supervisor Loop 架构** — Thinker 路由 + 多专家协作（data_expert / analyst / report_writer）
- **structured_output 路由** — Pydantic Model 替代正则解析，类型安全
- **AgentMiddleware 体系** — GenericContextMiddleware + GenericHITLMiddleware
- **HITL 人机协同** — interrupt() + Command(resume) 官方机制
- **ReAct 循环显示** — 通过 tool_calls 区分推理步骤和最终回复
- **MCP 工具集成** — ONNX 性能预测 + Calphad 热力学计算
- **MessagesState 最小化** — 只存控制字段，业务数据留在 ToolMessage 中

## 项目结构

```
Alalloy_agent/
├── backend/
│   └── app/
│       ├── core/              # 核心配置（LLM, 日志）
│       │   ├── llm.py         # DashScope 通义千问配置
│       │   └── logger.py      # Loguru 日志
│       ├── agents/            # Agent 层（严格按官方文档）
│       │   ├── state.py       # AlalloyState（MessagesState 最小化）
│       │   ├── nodes.py       # Thinker + Expert 节点
│       │   ├── middleware.py   # GenericContext + GenericHITL 中间件
│       │   ├── context.py     # 上下文构建器
│       │   ├── hitl.py        # HITL payload 构建器
│       │   └── prompts/       # Markdown 提示词模板
│       ├── graph/             # 图构建层
│       │   └── builder.py     # StateGraph Supervisor Loop
│       ├── infra/             # 基础设施层
│       │   ├── idme_service.py  # 华为云 IDME API
│       │   └── mcp_service.py   # MCP 客户端（ONNX + Calphad）
│       ├── tools/             # @tool 定义（纯业务逻辑）
│       │   ├── idme_tool.py   # IDME 数据查询
│       │   ├── onnx_tool.py   # ONNX 性能预测
│       │   ├── calphad_tool.py  # Calphad 计算
│       │   └── composition_tool.py  # 成分解析
│       ├── api/               # API 层
│       │   ├── rest.py        # REST API（会话管理）
│       │   └── websocket/     # WebSocket 通信
│       │       ├── manager.py # ConnectionManager
│       │       ├── stream.py  # StreamHandler（stream_mode）
│       │       └── routes.py  # WS 路由（chat + resume）
│       ├── utils/             # 工具函数
│       │   └── composition.py # 成分解析/转换
│       └── main.py            # FastAPI 入口
├── web/                       # Nuxt 前端（Phase 2）
├── run.py                     # 启动脚本
├── requirements.txt           # Python 依赖
└── .env.example               # 环境变量模板
```

## 系统架构

### Supervisor Loop 拓扑

```
START → Thinker ──┬──→ data_expert ──→ ToolNode ──→ data_expert ──→ Thinker
                  │                                                    │
                  ├──→ analyst ──→ ToolNode ──→ analyst ──→ Thinker   │
                  │                                                    │
                  ├──→ report_writer ──→ Thinker                      │
                  │                                                    │
                  └──→ END ◄──────────────────────────────────────────┘
```

### WebSocket 通信协议

```
Frontend (Nuxt)              Backend (FastAPI + LangGraph)
     │                                    │
     │──── {type:"chat", message:"..."}──►│
     │                                    │
     │◄─── {type:"agent_update"}─────────│  Thinker 决策
     │◄─── {type:"react_step"}───────────│  Expert 推理（含 tool_calls）
     │◄─── {type:"tool_result"}──────────│  工具执行结果
     │◄─── {type:"token"}───────────────│  最终回复
     │◄─── {type:"interrupt"}────────────│  HITL 确认请求
     │                                    │
     │──── {type:"resume", ...}─────────►│  用户确认/取消
     │                                    │
     │◄─── {type:"chat_complete"}────────│  对话完成
```

---

## 快速开始

### 环境要求

- **Python**: 3.10+
- **Conda**: agent 环境

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入真实的 API 密钥
```

### 2. 安装依赖 + 启动

```bash
conda activate agent
pip install -r requirements.txt
python run.py
```

- 后端 API: `http://localhost:8001`
- API 文档: `http://localhost:8001/docs`
- WebSocket: `ws://localhost:8001/ws/chat/{session_id}`

## 官方文档对照

每个模块都有明确的官方文档依据：

| 模块 | 官方文档 | 说明 |
|------|---------|------|
| Agent 创建 | `langchain/agents.mdx` | create_agent + middleware |
| Middleware | `langchain/middleware/custom.mdx` | wrap_model_call / wrap_tool_call |
| HITL | `langchain/human-in-the-loop.mdx` | interrupt() + Command(resume) |
| structured_output | `langchain/structured-output.mdx` | Pydantic 路由 |
| State | `langgraph/use-graph-api.mdx` | MessagesState 最小化 |
| 流式 | `langgraph/streaming.mdx` | stream_mode=["updates"] |
| Interrupts | `langgraph/interrupts.mdx` | HITL interrupt 检测 |
| 编排 | `langgraph/multi-agent/router.mdx` | Supervisor Loop |

## 技术栈

| 技术 | 用途 |
|------|------|
| **LangChain 1.x** | Agent + Middleware + Tools |
| **LangGraph 1.x** | StateGraph + Checkpointer + Interrupts |
| **FastAPI** | Web 框架 + WebSocket |
| **DashScope** | 通义千问 LLM（qwen-plus） |
| **MCP** | ONNX + Calphad 工具服务 |
| **Supabase** | 会话持久化（后续启用） |
| **Nuxt 4** | 前端（后续启用） |

## 许可证

内部项目，仅供授权使用。
