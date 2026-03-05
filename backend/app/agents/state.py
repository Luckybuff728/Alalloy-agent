"""
State 设计

父图状态（AlalloyState）用于 Thinker 路由与控制。
子图直接使用 AgentState（create_agent 默认），无需自定义扩展。
"""

from typing import Optional
from langgraph.graph import MessagesState


class AlalloyState(MessagesState):
    """
    父图全局状态

    字段说明:
        messages: 对话消息列表（MessagesState 内置，含 add_messages reducer）
        current_agent: 当前执行的 Agent 名称（用于前端显示）
        remaining_steps: 剩余步数（防无限循环）

    路由说明:
        Thinker 通过 Command(goto=...) 直接控制路由，不再写入 next 字段。
    """
    current_agent: Optional[str] = None
    remaining_steps: int = 50
