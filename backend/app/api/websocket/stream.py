"""StreamHandler — 后端事件 → 前端 WS JSON 映射

使用 subgraphs=True 流式输出子图内部的 LLM token 与工具调用。
双通道模式：messages（LLM token）+ updates（状态变化/interrupt）。
中断检测仅通过 updates 通道的 __interrupt__ 字段（官方推荐模式）。
"""

from typing import AsyncIterator, Dict, Any, Optional

from langchain_core.messages import AIMessageChunk, ToolMessage
from langgraph.types import Command

from ...core.logger import logger


AGENT_DISPLAY_NAMES = {
    "thinker": "思维规划",
    "dataExpert": "数据专家",
    "analysisExpert": "分析专家",
    "reportWriter": "报告撰写",
}

_SUBGRAPH_INTERNAL_NODES = {"agent", "tools"}


def _resolve_agent_display(node_name: str, parent_node: Optional[str]) -> str:
    """将节点名映射到前端显示名。子图内部节点使用父节点名。"""
    if node_name in _SUBGRAPH_INTERNAL_NODES and parent_node:
        return AGENT_DISPLAY_NAMES.get(parent_node, parent_node)
    return AGENT_DISPLAY_NAMES.get(node_name, node_name)


def _format_interrupt_event(intr) -> Dict[str, Any]:
    """
    将 interrupt 对象映射为前端 WS 事件。

    支持两种 interrupt 来源：

    1. show_guidance_widget 内置 interrupt()（新规范）
       payload = {"interrupt_type": "guidance_widget", "widget": {...}}
       → 直接转发为 guidance_widget 事件

    2. HumanInTheLoopMiddleware（Calphad 提交类工具）
       payload = {"action_requests": [...], "review_configs": [...]}
       → 转发为 hitl_review 事件
    """
    v = getattr(intr, "value", intr) if not isinstance(intr, dict) else intr

    if not isinstance(v, dict):
        return {"type": "interrupt", "interrupt_type": "generic", "payload": {"value": str(v)}}

    # ── 路径 1：show_guidance_widget 内置 interrupt() ──────────────────────
    # interrupt() 的 payload 直接包含 interrupt_type + widget 字段
    if v.get("interrupt_type") == "guidance_widget":
        return {
            "type": "interrupt",
            "interrupt_type": "guidance_widget",
            "payload": v,  # 直接转发，包含 interrupt_type 和 widget
        }

    # ── 路径 2：HumanInTheLoopMiddleware（Calphad 等工具）────────────────────
    if "action_requests" in v:
        return {"type": "interrupt", "interrupt_type": "hitl_review", "payload": v}

    # ── 路径 3：其他原生 interrupt() ─────────────────────────────────────────
    return {"type": "interrupt", "interrupt_type": "generic", "payload": v}


async def stream_graph_events(
    graph,
    input_data,
    config: dict,
) -> AsyncIterator[Dict[str, Any]]:
    """流式处理图事件，映射为前端期望的 WS JSON 格式。"""
    logger.info(f"开始流式处理: config={config.get('configurable', {})}")

    is_resume = isinstance(input_data, Command)
    yield {"type": "resume_start"} if is_resume else {"type": "chat_start"}

    try:
        last_node = None
        current_parent_node = None
        interrupt_yielded = False

        async for event in graph.astream(
            input_data,
            config,
            stream_mode=["messages", "updates"],
            subgraphs=True,
        ):
            if len(event) == 3:
                namespace, channel, data = event
            elif len(event) == 2:
                namespace = ()
                channel, data = event
            else:
                continue

            is_subgraph = bool(namespace)
            if is_subgraph and namespace:
                parent_candidate = str(namespace[0]).split(":")[0]
                if parent_candidate in AGENT_DISPLAY_NAMES:
                    current_parent_node = parent_candidate

            # ==== messages 通道 ====
            if channel == "messages":
                if not isinstance(data, tuple) or len(data) != 2:
                    continue
                chunk, metadata = data
                if not isinstance(chunk, AIMessageChunk):
                    continue
                if not isinstance(metadata, dict):
                    metadata = {}
                node_name = metadata.get("langgraph_node", "unknown")

                if node_name == "thinker":
                    continue

                display_name = _resolve_agent_display(node_name, current_parent_node)

                if chunk.content and isinstance(chunk.content, str):
                    yield {"type": "chat_token", "content": chunk.content, "agent": display_name}

                tool_chunks = getattr(chunk, "tool_call_chunks", None)
                if tool_chunks:
                    for tc in tool_chunks:
                        if isinstance(tc, dict):
                            tool_name = tc.get("name")
                            tool_args = tc.get("args")
                            tc_id = tc.get("id", "")
                            tc_index = tc.get("index", 0)
                        else:
                            tool_name = getattr(tc, "name", None)
                            tool_args = getattr(tc, "args", None)
                            tc_id = getattr(tc, "id", "") or ""
                            tc_index = getattr(tc, "index", 0) or 0

                        if tool_name:
                            logger.info(f"发送 tool_call_start: {tool_name}")
                            yield {"type": "tool_call_start", "tool": tool_name, "id": tc_id, "agent": display_name}
                        if tool_args:
                            yield {"type": "tool_call_args", "args": tool_args, "id": tc_id, "index": tc_index, "agent": display_name}

            # ==== updates 通道 ====
            elif channel == "updates":
                if not isinstance(data, dict):
                    continue

                # __interrupt__ 检测（子图和父图均检测，仅首次触发）
                if "__interrupt__" in data and not interrupt_yielded:
                    interrupt_values = data["__interrupt__"]
                    logger.info(
                        f"检测到 __interrupt__: {len(interrupt_values)} 个中断"
                        f" (subgraph={is_subgraph})"
                    )
                    for intr in interrupt_values:
                        yield _format_interrupt_event(intr)
                    interrupt_yielded = True
                    continue

                for node_name, update in data.items():
                    if node_name.startswith("__") or node_name == "thinker":
                        continue

                    display_name = _resolve_agent_display(node_name, current_parent_node)

                    if not is_subgraph and node_name in AGENT_DISPLAY_NAMES and node_name != last_node:
                        if last_node is not None and last_node != "thinker":
                            yield {"type": "agent_end", "agent": last_node}
                        yield {"type": "agent_start", "agent": node_name, "display_name": AGENT_DISPLAY_NAMES.get(node_name, node_name)}
                        last_node = node_name

                    if not isinstance(update, dict):
                        continue
                    messages = update.get("messages", [])

                    for msg in messages:
                        if isinstance(msg, ToolMessage):
                            tool_name = msg.name or "unknown"
                            tool_call_id = msg.tool_call_id or ""
                            yield {"type": "tool_end", "tool": tool_name, "tool_call_id": tool_call_id, "agent": display_name}
                            yield {"type": "tool_result", "tool": tool_name, "result": msg.content or "", "tool_call_id": tool_call_id, "agent": display_name}
                        elif hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                if isinstance(tc, dict):
                                    t_name = tc.get("name", "")
                                    t_input = tc.get("args", {})
                                    t_id = tc.get("id", "")
                                else:
                                    t_name = getattr(tc, "name", "") or ""
                                    t_input = getattr(tc, "args", {}) or {}
                                    t_id = getattr(tc, "id", "") or ""
                                yield {"type": "tool_ready", "tool": t_name, "input": t_input, "id": t_id, "agent": display_name}

        if last_node is not None and last_node != "thinker":
            yield {"type": "agent_end", "agent": last_node}

        if interrupt_yielded:
            return

        yield {"type": "chat_complete"}

        title_event = await _try_generate_title(graph, config)
        if title_event:
            yield title_event

    except Exception as e:
        logger.error(f"流式处理异常: {e}")
        yield {"type": "error", "message": str(e)}


async def _try_generate_title(graph, config: dict):
    """
    LLM 精炼标题（仅在首次对话完成后触发一次）。

    前端在发送消息时已立即用用户消息内容设置临时标题；
    此处用 LLM 生成更语义化的标题，覆盖临时标题，提升标题质量。

    触发条件：首轮对话（human_count == 1）且 AI 已有回复（ai_count >= 1）。
    """
    try:
        from ...utils.title_generator import generate_session_title
        from langchain_core.messages import HumanMessage as HM, AIMessage as AM

        state = await graph.aget_state(config)
        if not state or not hasattr(state, "values"):
            return

        messages = state.values.get("messages", [])
        human_count = sum(1 for m in messages if isinstance(m, HM))
        ai_count    = sum(1 for m in messages if isinstance(m, AM))

        # 仅在首轮且 AI 已回复时执行，防止多轮重复触发或 AI 尚未写入时空跑
        if human_count != 1 or ai_count < 1:
            return

        title = await generate_session_title(messages)
        if not title:
            return

        session_id = config.get("configurable", {}).get("thread_id")
        if not session_id:
            return

        logger.info(f"LLM 精炼标题: session={session_id} -> {title}")
        return {
            "type": "session_title_updated",
            "session_id": session_id,
            "title": title,
        }
    except Exception as e:
        logger.debug(f"标题精炼跳过: {e}")


