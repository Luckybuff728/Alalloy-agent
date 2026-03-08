"""
WebSocket 路由

处理 WebSocket 连接和消息分发。

前端连接格式：
    ws://host:port/ws/chat?token=xxx&session_id=xxx
    token 和 session_id 均通过 query 参数传递。

消息类型（前端 → 后端）：
    chat_message      用户文本输入。若图处于 interrupt 挂起，自动转为 Command(resume=...)；
                      否则作为新轮次 HumanMessage 发起 invoke。
    resume_interrupt  交互挂件（guidance_widget / Calphad 审批）的结构化选择结果，
                      直接转为 Command(resume={"decisions": [...]})。
    stop_generate     取消当前正在运行的流式任务。
    save_ui_snapshot  保存前端 UI 快照到 Supabase。
    ping              心跳，返回 pong。

LangGraph 中断/恢复规范（interrupts.mdx / human-in-the-loop.mdx）：
    - interrupt() 挂起后，必须用同一 thread_id + Command(resume=...) 恢复。
    - 不能在挂起状态下发起新的 invoke，否则子图消息不提交到父图 state，
      导致 thinker 看不到已有上下文，产生重复执行循环。
    - resume 值透传给 interrupt() 作为返回值；HITL middleware 要求
      {"decisions": [...]} 格式，每个 decision 为 approve / edit / reject。

防御性处理：
    1. 会话恢复时的消息序列化/反序列化
    2. 空状态处理（新会话）
    3. 工具结果的结构化提取
    4. 大消息列表的截断处理
    5. 消息链完整性修复（缺失 ToolMessage 时自动补占位符）
"""

import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, BaseMessage
from langgraph.types import Command

from .manager import connection_manager
from .stream import stream_graph_events
from ...core.logger import logger
from ..dependencies import verify_token_sync, extract_user_from_token_sync

router = APIRouter()

# 全局图实例（在 main.py 中初始化后注入）
_compiled_graph = None

# 开发模式配置
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

# ★ 每个会话对应一个后台流式任务（用于支持真正的 stop_generate）
_active_stream_tasks: Dict[str, asyncio.Task] = {}


async def _persist_session_title(session_id: str, title: str) -> None:
    """直接从后端将会话标题写入 Supabase（asyncio.to_thread 非阻塞）。
    
    作为前端 REST 调用的双保险：即使前端在 AI 回复结束时已断开，标题依然能持久化。
    """
    from ...infra.supabase_client import get_supabase_client, is_fallback_mode
    from ..rest import _fallback_sessions

    client = get_supabase_client()
    if client and not is_fallback_mode():
        def _write():
            client.table("sessions").update({"title": title}).eq("id", session_id).execute()
        try:
            await asyncio.to_thread(_write)
            logger.info(f"标题已持久化(后端): session={session_id}, title={title}")
        except Exception as e:
            logger.warning(f"后端持久化标题失败: session={session_id}, err={e}")
    else:
        session = _fallback_sessions.get(session_id)
        if session:
            session["title"] = title


async def _run_stream(
    websocket: WebSocket,
    graph,
    input_data,
    config: dict,
    session_id: str,
) -> None:
    """
    在后台 asyncio.Task 中运行图流式处理，向 WebSocket 发送事件。
    支持通过 task.cancel() 真正中断正在运行的 LangGraph 流。
    """
    try:
        async for event in stream_graph_events(graph, input_data, config):
            await websocket.send_json(event)
            # 收到 LLM 精炼标题后，后端同步持久化（双保险，前端同步走 REST 路径）
            if event.get("type") == "session_title_updated" and event.get("title"):
                asyncio.create_task(_persist_session_title(session_id, event["title"]))
    except asyncio.CancelledError:
        logger.info(f"[WS] 流式任务已取消: session={session_id}")
        raise
    except Exception as e:
        logger.error(f"[WS] 流式任务异常: session={session_id}, error={e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        _active_stream_tasks.pop(session_id, None)


async def _cancel_active_stream(session_id: str) -> bool:
    """取消指定会话的后台流式任务，返回是否确实取消了正在运行的任务。"""
    task = _active_stream_tasks.pop(session_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return True
    return False


def set_graph(graph):
    """
    设置全局图实例（由 main.py 调用）

    参数:
        graph: 编译后的 CompiledGraph
    """
    global _compiled_graph
    _compiled_graph = graph
    logger.info("WebSocket 路由: 图实例已注入")


def _adapt_resume_value(value, chat_text: str = None, pending_interrupts: list = None):
    """
    将前端 resume 值适配为 LangGraph Command(resume=...) 所需的格式。

    两种中断机制使用不同的 resume 格式（LangGraph 官方规范）：

    ┌─────────────────────────────┬──────────────────────────────────────┐
    │ 中断来源                    │ resume 格式                          │
    ├─────────────────────────────┼──────────────────────────────────────┤
    │ show_guidance_widget        │ 直接透传给 interrupt() 返回值        │
    │  （工具内 interrupt()）     │                                      │
    ├─────────────────────────────┼──────────────────────────────────────┤
    │ HumanInTheLoopMiddleware    │ {"decisions": [{type, ...}]}         │
    │ （Calphad 提交类工具）      │                                      │
    └─────────────────────────────┴──────────────────────────────────────┘
    """
    if pending_interrupts is None:
        pending_interrupts = []

    is_guidance_widget = any(i.get("type") == "guidance_widget" for i in pending_interrupts)

    # ── guidance_widget 中断：值直接透传给 interrupt() ────────────────────
    if is_guidance_widget:
        if chat_text is not None:
            logger.info(f"Resume: guidance_widget ← chat_text={chat_text[:50]}")
            return {"text": chat_text}
        logger.info(f"Resume: guidance_widget ← value={str(value)[:80]}")
        return value

    # ── HITL 中断（Calphad 等）：需要 decisions 包装 ─────────────────────
    if chat_text is not None:
        logger.info(f"Resume: HITL ← reject(chat_text={chat_text[:50]})")
        return {"decisions": [{"type": "reject", "message": f"用户发送消息：{chat_text}"}]}

    if isinstance(value, dict) and "decisions" in value:
        return value

    if isinstance(value, list):
        return {"decisions": value}

    # ── dict 值但 pending_interrupts 未能识别中断类型 ─────────────────────
    # 前端 guidance_widget 选择结果（如 {'type':'option','id':'...','label':'...'}）
    # 不含 "decisions" 键，而 HITL 的 resume 始终携带 "decisions" 包装。
    # 因此对不含 "decisions" 的 dict 直接透传，避免竞态窗口下丢失用户选择。
    if isinstance(value, dict):
        logger.info(f"Resume: 未分类中断, dict 值直接透传 ← value={str(value)[:80]}")
        return value

    # 兜底（非 dict 的极端情况）
    logger.warning(f"Resume: 未识别格式, value={str(value)[:80]}")
    return {"decisions": [{"type": "approve"}]}


async def _verify_session_ownership(session_id: str, user_id: str) -> tuple[bool, bool]:
    """
    验证会话是否属于指定用户（异步，Supabase 调用通过 asyncio.to_thread 非阻塞）

    返回:
        (session_exists, belongs_to_user)
        - (False, False): 会话不存在
        - (True, True):   存在且属于该用户
        - (True, False):  存在但不属于该用户
    
    注意：Supabase 网络/超时异常 → fail-open (True, True)，
    避免因服务抖动将合法用户锁出；明确无结果 → (False, False)。
    """
    from ...infra.supabase_client import get_supabase_client, is_fallback_mode
    from ..rest import _fallback_sessions

    client = get_supabase_client()
    if client and not is_fallback_mode():
        def _query():
            # maybe_single() 在 0 行时返回 None，不抛 PGRST116
            return (
                client.table("sessions")
                .select("user_id")
                .eq("id", session_id)
                .maybe_single()
                .execute()
            )
        try:
            result = await asyncio.to_thread(_query)
            if result and result.data:
                belongs = result.data.get("user_id") == user_id
                return (True, belongs)
            # 0 行 → 会话不存在
            return (False, False)
        except Exception as e:
            # 网络/超时等基础设施错误 → fail-open，记录警告但允许访问
            logger.warning(f"Supabase 会话归属查询异常（允许访问）: session={session_id}, err={e}")
            return (True, True)

    # 内存降级模式
    session = _fallback_sessions.get(session_id)
    if session:
        belongs = session.get("user_id") == user_id
        return (True, belongs)
    return (False, False)


def _extract_pending_interrupts(state) -> List[Dict[str, Any]]:
    """
    提取待确认的 interrupt（用于判断当前图是否处于挂起状态）。

    LangGraph 官方规范（interrupts.mdx）：
    - interrupt() 挂起后，state.tasks 中的任务会携带 .interrupts 列表。
    - 每个 Interrupt 对象有 .value（JSON-serializable payload）和 .id。
    - 只要 tasks 中存在未完成的 interrupt，图就处于"挂起等待 resume"状态。
    - 恢复必须用同一 thread_id + Command(resume=...) —— 不能发起新 invoke。

    支持三种 payload 类型：
    1. HumanInTheLoopMiddleware：{"action_requests": [...], "review_configs": [...]}
    2. guidance_widget（旧格式）：{"interrupt_type": "guidance_widget", ...}
    3. 原生 interrupt()：任意 JSON 值（直接存储在 .value 中）
    """
    interrupts = []

    if not hasattr(state, "tasks") or not state.tasks:
        logger.debug("_extract_pending_interrupts: state.tasks 为空")
        return interrupts

    for task in state.tasks:
        if not hasattr(task, "interrupts") or not task.interrupts:
            continue

        for intr in task.interrupts:
            v = intr.value
            intr_id = getattr(intr, "id", None)

            if isinstance(v, dict):
                if "action_requests" in v:
                    # HumanInTheLoopMiddleware 标准格式
                    interrupts.append({"type": "hitl_review", "id": intr_id, "payload": v})
                elif v.get("interrupt_type") == "guidance_widget":
                    # guidance_widget（向后兼容）
                    interrupts.append({"type": "guidance_widget", "id": intr_id, "payload": v})
                else:
                    # 原生 interrupt() 自定义 dict payload
                    interrupts.append({"type": "generic", "id": intr_id, "payload": v})
            else:
                # 原生 interrupt() 非 dict 值（字符串、布尔等）
                interrupts.append({"type": "generic", "id": intr_id, "payload": v})

    return interrupts


async def _fix_message_chain_if_needed(graph, config: Dict[str, Any]) -> None:
    """
    修复消息链完整性（会话恢复后的防御性修复）
    
    场景：会话在 interrupt 后异常终止，导致 AIMessage 有 tool_calls 但缺少 ToolMessage
    修复：为缺失的 tool_call_id 补充占位 ToolMessage
    
    参数:
        graph: 编译后的图
        config: LangGraph 配置（包含 thread_id）
    """
    try:
        state = await graph.aget_state(config)
        if not state or not state.values:
            return
        
        messages = state.values.get("messages", [])
        if not messages:
            return
        
        # 检查最后一条消息
        last_message = messages[-1]
        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            return
        
        # 收集所有 tool_call_id
        expected_tool_call_ids = {tc.get("id") for tc in last_message.tool_calls if isinstance(tc, dict)}
        if not expected_tool_call_ids:
            return
        
        # 检查后续是否有对应的 ToolMessage
        found_tool_call_ids = set()
        for msg in messages[messages.index(last_message) + 1:]:
            if isinstance(msg, ToolMessage) and hasattr(msg, 'tool_call_id'):
                found_tool_call_ids.add(msg.tool_call_id)
        
        # 找出缺失的 tool_call_id
        missing_ids = expected_tool_call_ids - found_tool_call_ids
        if not missing_ids:
            return
        
        logger.warning(
            f"检测到消息链不完整，缺少 {len(missing_ids)} 个 ToolMessage，自动修复中..."
        )
        
        # 为缺失的 tool_call_id 补充占位 ToolMessage
        fix_messages = []
        for tool_call in last_message.tool_calls:
            if isinstance(tool_call, dict) and tool_call.get("id") in missing_ids:
                tool_name = tool_call.get("name", "unknown")
                fix_messages.append(
                    ToolMessage(
                        content=f"[会话恢复] 工具 {tool_name} 执行被中断，已跳过",
                        tool_call_id=tool_call["id"],
                        name=tool_name,
                    )
                )
        
        if fix_messages:
            # 更新图状态
            await graph.aupdate_state(
                config,
                {"messages": fix_messages}
            )
            logger.info(f"消息链已修复，添加了 {len(fix_messages)} 条占位 ToolMessage")
    
    except Exception as e:
        logger.error(f"修复消息链失败: {e}")


async def _save_ui_snapshot(session_id: str, ui_snapshot: Dict[str, Any]) -> bool:
    """
    保存 UI 快照到 Supabase sessions.metadata（asyncio.to_thread 避免阻塞事件循环）
    """
    from ...infra.supabase_client import get_supabase_client, is_fallback_mode
    from ..rest import _fallback_sessions

    client = get_supabase_client()
    if client and not is_fallback_mode():
        def _write():
            # maybe_single() 在 0 行时返回 None（不抛 PGRST116）
            r = client.table("sessions").select("metadata").eq("id", session_id).maybe_single().execute()
            existing = {}
            if r and r.data:
                existing = r.data.get("metadata") or {}
            existing["ui_snapshot"] = ui_snapshot
            existing["ui_snapshot_updated_at"] = datetime.now(timezone.utc).isoformat()
            client.table("sessions").update({"metadata": existing}).eq("id", session_id).execute()

        try:
            await asyncio.to_thread(_write)
            logger.info(f"UI 快照已保存: session={session_id}, messages={len(ui_snapshot.get('messages', []))}")
            return True
        except Exception as e:
            logger.warning(f"保存 UI 快照失败: session={session_id}, err={e}")
            return False

    # 内存降级
    session = _fallback_sessions.get(session_id)
    if session:
        session.setdefault("metadata", {})
        session["metadata"]["ui_snapshot"] = ui_snapshot
        session["metadata"]["ui_snapshot_updated_at"] = datetime.now(timezone.utc).isoformat()
        return True
    return False


async def _get_ui_snapshot(session_id: str) -> Optional[Dict[str, Any]]:
    """
    从 Supabase sessions.metadata 获取 UI 快照（asyncio.to_thread 避免阻塞事件循环）
    """
    from ...infra.supabase_client import get_supabase_client, is_fallback_mode
    from ..rest import _fallback_sessions

    client = get_supabase_client()
    if client and not is_fallback_mode():
        def _read():
            return client.table("sessions").select("metadata").eq("id", session_id).maybe_single().execute()

        try:
            result = await asyncio.to_thread(_read)
            if result and result.data:
                return (result.data.get("metadata") or {}).get("ui_snapshot")
        except Exception as e:
            logger.debug(f"获取 UI 快照失败: session={session_id}, err={e}")
        return None

    # 内存降级
    session = _fallback_sessions.get(session_id)
    if session:
        return session.get("metadata", {}).get("ui_snapshot")
    return None


async def _restore_session_state(graph, config: Dict[str, Any], session_id: str = None) -> Optional[Dict[str, Any]]:
    """
    从 Checkpointer 恢复会话状态
    
    隐藏问题防护：
    1. 空状态处理（新会话返回 None）
    2. ★ 优先使用 UI 快照（完美恢复前端状态）
    3. 消息序列化（LangChain Message → JSON）作为降级方案
    4. 大消息列表截断（最多 50 条）
    5. 工具结果提取（用于前端显示）
    6. 待确认 interrupt 提取（用于恢复 HITL 挂件）
    
    参数:
        graph: 编译后的图
        config: LangGraph 配置（包含 thread_id）
        session_id: 会话 ID（用于获取 UI 快照）
    
    返回:
        会话状态字典，或 None（新会话/无状态）
    """
    try:
        # 获取图状态
        state = await graph.aget_state(config)
        
        if state is None or state.values is None:
            return None
        
        values = state.values
        messages = values.get("messages", [])
        
        if not messages:
            return None
        
        # 序列化消息列表（最多 50 条，防止过大）
        serialized_messages = []
        max_messages = 50
        
        for msg in messages[-max_messages:]:
            serialized_msg = _serialize_message(msg)
            if serialized_msg:
                serialized_messages.append(serialized_msg)
        
        # ★ 优先尝试获取 UI 快照（完美恢复）
        if session_id:
            ui_snapshot = await _get_ui_snapshot(session_id)
            if ui_snapshot and ui_snapshot.get("messages"):
                logger.info(f"使用 UI 快照恢复: session={session_id}, snapshot_messages={len(ui_snapshot.get('messages', []))}")
                return {
                    "ui_snapshot": ui_snapshot,
                    "messages": serialized_messages,
                    "tool_results": _extract_tool_results(messages),
                    "pending_interrupts": _extract_pending_interrupts(state),
                    "has_more": len(messages) > max_messages
                }
        
        # 提取工具结果（用于前端 Results 面板）
        tool_results = _extract_tool_results(messages)
        
        pending_interrupts = _extract_pending_interrupts(state)
        
        return {
            "ui_snapshot": None,  # 无快照，前端使用降级方案
            "messages": serialized_messages,
            "tool_results": tool_results,
            "pending_interrupts": pending_interrupts,
            "has_more": len(messages) > max_messages
        }
        
    except Exception as e:
        logger.error(f"恢复会话状态失败: {e}")
        return None


def _serialize_message(msg: BaseMessage) -> Optional[Dict[str, Any]]:
    """
    序列化单条 LangChain 消息为 JSON
    
    隐藏问题防护：
    1. 不同消息类型的处理
    2. content 可能是 str 或 list
    3. tool_calls 的序列化
    """
    try:
        if isinstance(msg, HumanMessage):
            return {
                "type": "user",
                "content": _get_message_content(msg),
                "timestamp": None
            }
        elif isinstance(msg, AIMessage):
            result = {
                "type": "agent",
                "agent": msg.name or "Assistant",
                "content": _get_message_content(msg),
                "timestamp": None
            }
            # 包含工具调用信息
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                result["tool_calls"] = [
                    {
                        "name": tc.get("name", ""),
                        "args": tc.get("args", {}),
                        "id": tc.get("id", "")
                    }
                    for tc in msg.tool_calls
                ]
            return result
        elif isinstance(msg, ToolMessage):
            return {
                "type": "tool_result",
                "tool_name": msg.name or "unknown",
                "content": _get_message_content(msg),
                "tool_call_id": getattr(msg, 'tool_call_id', None)
            }
        else:
            # 其他类型消息
            return {
                "type": "system",
                "content": _get_message_content(msg)
            }
    except Exception as e:
        logger.warning(f"消息序列化失败: {e}")
        return None


def _get_message_content(msg: BaseMessage) -> str:
    """
    提取消息内容（处理 str 和 list 两种格式）
    """
    content = msg.content
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        # 多模态消息，提取文本部分
        text_parts = []
        for part in content:
            if isinstance(part, str):
                text_parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text":
                text_parts.append(part.get("text", ""))
        return "\n".join(text_parts)
    return str(content)


def _extract_tool_results(messages: List[BaseMessage]) -> List[Dict[str, Any]]:
    """
    从消息列表中提取工具结果（用于前端 Results 面板）
    
    隐藏问题防护：
    1. 只提取特定工具的结果（ONNX、Calphad 等）
    2. 结果去重
    3. JSON 解析（保留原始字符串作为备份）
    """
    results = []
    seen_ids = set()
    
    # 需要提取结果的工具（MCP 原生名称 + 本地工具名称）
    result_tools = {
        # MCP: ONNX 性能预测
        "onnx_model_inference": "performance_prediction",
        # MCP: Calphad 热力学结果（submit/status/list 不应进入结果面板）
        "calphamesh_get_task_result": "calphad_task",
        # 本地: IDME 数据查询
        "query_idme": "idme_data",
    }
    
    for msg in messages:
        if isinstance(msg, ToolMessage):
            tool_call_id = getattr(msg, 'tool_call_id', None)
            tool_name = msg.name or ""
            
            # 去重
            if tool_call_id and tool_call_id in seen_ids:
                continue
            if tool_call_id:
                seen_ids.add(tool_call_id)
            
            # 检查是否是需要提取的工具
            result_type = result_tools.get(tool_name)
            if result_type:
                content = _get_message_content(msg)
                
                # ★ 尝试解析 JSON（用于前端直接使用）
                parsed_content = content
                if isinstance(content, str):
                    try:
                        import json
                        parsed_content = json.loads(content)
                    except:
                        # 保持字符串格式（前端会再次尝试解析）
                        pass
                
                results.append({
                    "type": result_type,
                    "tool_name": tool_name,
                    "content": parsed_content,  # 可能是对象或字符串
                    "tool_call_id": tool_call_id
                })
    
    return results




@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """
    WebSocket 聊天端点

    连接格式：ws://host:port/ws/chat?token=xxx&session_id=xxx

    支持两种消息类型：
    - chat: 正常对话（发送 HumanMessage）
    - resume: HITL 恢复（发送 Command(resume=...)）
    
    隐藏问题防护：
    - Token 验证使用统一的 verify_token_sync
    - 提取用户信息用于会话归属验证
    """
    # 从 query 参数提取 token 和 session_id
    token = websocket.query_params.get("token")
    session_id = websocket.query_params.get("session_id")

    # 参数校验（必须在 accept 之前完成基础检查）
    if not session_id:
        logger.warning("WS 拒绝: 缺少 session_id")
        await websocket.close(code=4001, reason="Missing session_id")
        return

    # Token 验证（使用统一的验证函数）
    if not verify_token_sync(token):
        logger.warning(f"WS 拒绝: session={session_id}, token 无效")
        await websocket.close(code=4003, reason="Invalid token")
        return
    
    # 提取用户信息（用于后续会话归属验证）
    current_user = extract_user_from_token_sync(token)
    if not current_user:
        logger.warning(f"WS 拒绝: session={session_id}, 无法提取用户信息")
        await websocket.close(code=4003, reason="Invalid user")
        return

    # ★ 处理并发会话冲突：先取消旧流式任务，再关闭旧 WebSocket
    # 顺序很重要：必须先 cancel task，再 close WS；
    # 否则旧 task 会向已关闭的 WS 发送数据并抛出异常，
    # 导致 _active_stream_tasks.pop() 在 finally 中提前移除任务，
    # 而新连接的会话状态基于旧快照，丢失进行中的工具更新。
    await _cancel_active_stream(session_id)

    existing_ws = connection_manager._connections.get(session_id)
    if existing_ws:
        try:
            await existing_ws.send_json({
                "type": "connection_replaced",
                "message": "此会话已在其他位置打开，当前连接已断开"
            })
            await existing_ws.close(code=4008, reason="Connection replaced")
            logger.info(f"WS 关闭旧连接: session={session_id}")
        except Exception as e:
            # ★ 旧连接可能已断开，这是正常情况
            error_msg = str(e) if e else "连接已关闭"
            logger.debug(f"关闭旧连接时出错（可忽略）: {error_msg}")
    
    # 接受新连接
    await websocket.accept()
    connection_manager._connections[session_id] = websocket
    logger.info(f"WS 已连接: session={session_id}, dev_mode={DEV_MODE}")

    # LangGraph 配置（thread_id 用于 Checkpointer 持久化）
    config = {"configurable": {"thread_id": session_id}}

    # ★ 初始化阶段保护：accept() 后至 while True 之前，客户端可能因快速刷新/
    #   网络抖动已断开连接，此时所有 send_json 均会抛出 WebSocketDisconnect /
    #   ClientDisconnected，必须整体捕获，否则 uvicorn 会输出无意义的 ERROR traceback
    try:
        # 发送 connection 事件（前端依赖此事件确认 session_id）
        await websocket.send_json({
            "type": "connection",
            "session_id": session_id,
            "client_id": session_id[:8],
            "mode": "chat",
            "message": "连接成功"
        })

        # ★ 会话恢复：尝试从 Checkpointer 恢复历史状态
        # 隐藏问题防护：验证会话归属
        if _compiled_graph is not None:
            try:
                # 验证会话归属（从 Supabase 或内存中查询）
                # ★ 返回 (session_exists, belongs_to_user) 元组
                session_exists, session_belongs_to_user = await _verify_session_ownership(session_id, current_user["id"])
                
                if session_exists and not session_belongs_to_user:
                    # ★ 会话存在但不属于该用户 → 拒绝访问
                    logger.warning(f"WS 会话恢复拒绝: session={session_id}, user={current_user['id']}, 会话不属于该用户")
                    await websocket.send_json({
                        "type": "error",
                        "message": "无权访问此会话"
                    })
                elif not session_exists:
                    # ★ 新会话，跳过恢复逻辑
                    logger.info(f"WS 新会话（无历史记录）: session={session_id}")
                else:
                    session_state = await _restore_session_state(_compiled_graph, config, session_id)
                    if session_state:
                        await websocket.send_json({
                            "type": "session_state",
                            "state": session_state
                        })
                        logger.info(f"WS 会话恢复: session={session_id}, messages={len(session_state.get('messages', []))}")
                    else:
                        # ★ 无历史状态（新会话或状态丢失）
                        await websocket.send_json({
                            "type": "session_state",
                            "state": None,
                            "is_new": True
                        })
                        logger.info(f"WS 新会话/无历史: session={session_id}")
            except WebSocketDisconnect:
                # 会话归属查询或恢复期间客户端断开，重新抛出由外层统一处理
                raise
            except Exception as e:
                logger.warning(f"会话恢复失败: session={session_id}, error={e}")
                # ★ 发送恢复失败事件给前端（若此时还连着）
                await websocket.send_json({
                    "type": "session_restore_failed",
                    "session_id": session_id,
                    "error": str(e),
                    "message": "无法加载历史对话，将作为新会话继续"
                })

    except WebSocketDisconnect:
        # 客户端在初始化阶段（connection 事件 / 会话恢复）期间断开
        # 这是正常的竞态场景（快速刷新、网络抖动），静默处理即可
        logger.info(f"WS 初始化阶段断开（快速刷新/网络抖动）: session={session_id}")
        connection_manager.disconnect(session_id)
        return
    except Exception as e:
        logger.warning(f"WS 初始化阶段异常: session={session_id}, error={e}")
        connection_manager.disconnect(session_id)
        return

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            # ---- ping/pong 心跳 ----
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            logger.info(f"WS 收到消息: session={session_id}, type={msg_type}")

            # ---- 图未初始化保护 ----
            if _compiled_graph is None:
                await websocket.send_json(
                    {"type": "error", "message": "Agent 图未初始化"}
                )
                continue

            # ---- 用户聊天消息（前端发送 type=chat_message, content=...）----
            if msg_type in ("chat_message", "chat"):
                user_message = data.get("content") or data.get("message", "")
                if not user_message:
                    continue

                logger.info(f"WS 对话: session={session_id}, msg={user_message[:50]}...")

                # 若有正在运行的流式任务，先取消（防止并发冲突）
                await _cancel_active_stream(session_id)

                # ── 官方规范（interrupts.mdx）────────────────────────────────────
                # 图处于 interrupt 挂起时，必须用同一 thread_id + Command(resume=...)
                # 恢复，不能发起新的 invoke（否则子图消息不会提交到父图 state，
                # thinker 看不到已有上下文，产生重复执行循环）。
                #
                # 当用户通过文本输入而不是交互挂件恢复时，把文字消息作为 reject
                # decision 的 message 传递，让 HITL 中间件把用户意图注入对话历史。
                # ─────────────────────────────────────────────────────────────────
                try:
                    graph_state = await _compiled_graph.aget_state(config)
                    pending_interrupts = _extract_pending_interrupts(graph_state)
                except Exception as e:
                    logger.warning(f"WS 获取图状态失败，按无中断处理: {e}")
                    pending_interrupts = []

                if pending_interrupts:
                    is_guidance = any(i.get("type") == "guidance_widget" for i in pending_interrupts)
                    resume_value = _adapt_resume_value(
                        None, chat_text=user_message, pending_interrupts=pending_interrupts
                    )
                    if is_guidance:
                        # guidance_widget 中断 + 用户文字：
                        # resume 解除中断（show_guidance_widget 返回 Command 结束子图），
                        # 同时 update 注入 HumanMessage，thinker 拿到用户最新指令做路由决策。
                        input_data = Command(
                            resume=resume_value,
                            update={"messages": [HumanMessage(content=user_message)]},
                        )
                    else:
                        # HITL 中断（Calphad 等）→ 仅 resume，用 reject decision 传递意图
                        input_data = Command(resume=resume_value)
                    logger.info(
                        f"WS 图挂起({len(pending_interrupts)} 个中断, "
                        f"guidance={is_guidance})，"
                        f"chat_message → Command(resume): session={session_id}"
                    )
                else:
                    # 图空闲 → 新轮次 invoke，附带完整 HumanMessage
                    await _fix_message_chain_if_needed(_compiled_graph, config)
                    input_data = {"messages": [HumanMessage(content=user_message)]}
                    logger.info(f"WS 图空闲，新轮次 invoke: session={session_id}")

                task = asyncio.create_task(
                    _run_stream(websocket, _compiled_graph, input_data, config, session_id)
                )
                _active_stream_tasks[session_id] = task

            # ---- HITL 恢复（前端发送 type=resume_interrupt，来自交互挂件）----
            elif msg_type in ("resume_interrupt", "resume"):
                # 交互挂件（guidance_widget / Calphad 审批）的结构化选择结果
                resume_value = data.get("value") or data.get("resume_value")

                logger.info(
                    f"WS resume_interrupt: session={session_id}, value={str(resume_value)[:80]}"
                )

                await _cancel_active_stream(session_id)

                # 获取当前挂起中断，以便 _adapt_resume_value 构建正确的 edit/reject decision
                try:
                    graph_state = await _compiled_graph.aget_state(config)
                    pending_interrupts = _extract_pending_interrupts(graph_state)
                except Exception as e:
                    logger.warning(f"WS resume_interrupt 获取图状态失败: {e}")
                    pending_interrupts = []

                logger.debug(
                    f"WS resume_interrupt 中断检测: session={session_id}, "
                    f"interrupts={[i.get('type') for i in pending_interrupts]}"
                )
                resume_value = _adapt_resume_value(resume_value, pending_interrupts=pending_interrupts)
                resume_command = Command(resume=resume_value)

                task = asyncio.create_task(
                    _run_stream(websocket, _compiled_graph, resume_command, config, session_id)
                )
                _active_stream_tasks[session_id] = task

            # ---- 停止生成 ----
            elif msg_type == "stop_generate":
                logger.info(f"WS 停止生成: session={session_id}")
                # ★ 真正取消正在运行的 LangGraph 流式任务
                was_running = await _cancel_active_stream(session_id)
                logger.info(f"WS 停止结果: session={session_id}, was_running={was_running}")
                await websocket.send_json({"type": "generate_stopped"})

            # ---- 保存 UI 快照（前端在 chat_complete 时发送）----
            elif msg_type == "save_ui_snapshot":
                ui_snapshot = data.get("snapshot")
                if ui_snapshot:
                    success = await _save_ui_snapshot(session_id, ui_snapshot)
                    await websocket.send_json({
                        "type": "ui_snapshot_saved",
                        "success": success,
                        "session_id": session_id
                    })
                    logger.info(f"WS UI 快照保存: session={session_id}, success={success}")
                else:
                    logger.warning(f"WS 保存 UI 快照失败: session={session_id}, 无快照数据")

            # ---- 其他消息静默忽略（set_parameters, clear_session 等）----
            else:
                logger.debug(f"WS 忽略消息: session={session_id}, type={msg_type}")

    except WebSocketDisconnect:
        await _cancel_active_stream(session_id)
        connection_manager.disconnect(session_id)
        logger.info(f"WS 断开: session={session_id}")

    except Exception as e:
        await _cancel_active_stream(session_id)
        logger.error(f"WS 异常: session={session_id}, error={e}")
        connection_manager.disconnect(session_id)
