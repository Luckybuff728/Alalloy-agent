"""
铝合金智能设计系统 v2.0

基于 LangChain 1.x + LangGraph 1.x 官方最佳实践重构。

模块结构:
- core/: 核心配置（LLM, 日志）
- agents/: Agent 层（state, nodes, middleware, prompts）
- graph/: 图构建层（builder）
- infra/: 基础设施层（IDME, MCP 服务）
- tools/: @tool 定义（纯业务逻辑）
- api/: API 层（WebSocket, REST）
- utils/: 工具函数（成分解析）
"""

__version__ = "2.0.0"
