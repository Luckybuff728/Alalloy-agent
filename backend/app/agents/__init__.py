"""
Agent 层 — 原生子图节点架构

create_agent() 生成的 CompiledGraph 直接注册为父图节点（graph.add_node）。
LangGraph 自动处理：共享键状态映射、interrupt 传播、checkpointer 继承。
Thinker 保持 structured_output 路由。
"""
