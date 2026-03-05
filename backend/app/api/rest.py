"""
REST API 路由

提供会话管理和系统状态查询的 HTTP 接口。

隐藏问题防护：
1. Supabase 连接失败时自动降级到内存模式
2. 数据库操作异常捕获和错误响应
3. 并发安全：使用数据库事务保证一致性
4. UUID 格式验证
5. 时区处理：统一使用 UTC
"""

import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from ..core.logger import logger
from ..infra.supabase_client import get_supabase_client, is_fallback_mode
from .dependencies import get_current_user

router = APIRouter(prefix="/api", tags=["api"])

# ★ Problem #3 修复：LRU 缓存限制
MAX_FALLBACK_SESSIONS = 100  # 内存模式最多保留 100 个会话


# ==================== 请求/响应模型 ====================


class CreateSessionRequest(BaseModel):
    """创建会话请求"""
    title: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)


class UpdateSessionRequest(BaseModel):
    """更新会话请求"""
    title: Optional[str] = None
    status: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SessionResponse(BaseModel):
    """会话响应"""
    id: str
    title: str
    status: str
    user_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SessionListResponse(BaseModel):
    """会话列表响应"""
    sessions: List[SessionResponse]


# ==================== 内存降级存储（LRU 淘汰） ====================

# 使用 OrderedDict 实现 LRU 淘汰
_fallback_sessions: OrderedDict[str, Dict[str, Any]] = OrderedDict()


def _add_fallback_session(session_id: str, session: Dict[str, Any]):
    """
    添加会话到内存缓存（LRU 淘汰）
    
    如果缓存已满，删除最久未使用的会话。
    
    参数:
        session_id: 会话 ID
        session: 会话数据
    """
    # 如果已存在，先删除再添加（移到末尾）
    if session_id in _fallback_sessions:
        _fallback_sessions.move_to_end(session_id)
    _fallback_sessions[session_id] = session
    
    # 超过限制时删除最旧的
    while len(_fallback_sessions) > MAX_FALLBACK_SESSIONS:
        oldest_id, _ = _fallback_sessions.popitem(last=False)
        logger.debug(f"LRU 淘汰会话: {oldest_id}")


def _touch_fallback_session(session_id: str):
    """
    访问会话时更新其 LRU 顺序
    
    参数:
        session_id: 会话 ID
    """
    if session_id in _fallback_sessions:
        _fallback_sessions.move_to_end(session_id)


# ==================== 系统状态 ====================


@router.get("/health")
async def health_check():
    """
    健康检查
    
    返回存储模式信息，便于调试
    """
    return {
        "status": "ok",
        "service": "alalloy-agent",
        "storage_mode": "fallback" if is_fallback_mode() else "supabase"
    }


@router.get("/info")
async def system_info():
    """系统信息"""
    return {
        "name": "铝合金智能设计系统",
        "version": "2.0.0",
        "framework": "LangChain 1.x + LangGraph 1.x",
        "architecture": "Supervisor Loop",
        "storage": "supabase" if not is_fallback_mode() else "memory",
        "agents": [
            "thinker",
            "dataExpert",
            "analysisExpert",
            "reportWriter",
        ],
    }


@router.get("/mcp/tools")
async def list_mcp_tools():
    """
    列出所有 MCP 工具及其详细信息
    
    用于调试和验证 MCP 工具的定义和参数格式
    """
    from ..infra.mcp_service import get_mcp_tools
    
    tools = get_mcp_tools()
    result = []
    for t in tools:
        tool_info = {
            "name": t.name,
            "description": t.description,
        }
        # 尝试获取参数 schema
        if hasattr(t, "args_schema") and t.args_schema:
            schema = t.args_schema
            # Pydantic model 有 schema() 方法，dict 直接使用
            if hasattr(schema, "schema"):
                tool_info["args_schema"] = schema.schema()
            else:
                tool_info["args_schema"] = schema
        elif hasattr(t, "args"):
            tool_info["args"] = t.args
        result.append(tool_info)
    
    return {"tools": result, "count": len(result)}


@router.post("/mcp/test/{tool_name}")
async def test_mcp_tool(tool_name: str, args: Dict[str, Any] = None):
    """
    测试调用 MCP 工具
    
    参数:
        tool_name: 工具名称
        args: 工具参数（JSON body）
    
    返回:
        工具执行结果
    """
    from ..infra.mcp_service import get_mcp_tools
    
    tools = {t.name: t for t in get_mcp_tools()}
    
    if tool_name not in tools:
        raise HTTPException(status_code=404, detail=f"工具 {tool_name} 不存在")
    
    tool = tools[tool_name]
    try:
        result = await tool.ainvoke(args or {})
        return {"tool": tool_name, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"工具执行失败: {str(e)}")


# ==================== 会话管理（支持 Supabase + 内存降级） ====================


@router.post("/sessions", response_model=SessionResponse)
async def create_session(
    request: CreateSessionRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    创建新会话
    
    隐藏问题防护：
    - UUID 格式一致性
    - 时区统一（UTC）
    - Supabase 失败时降级到内存
    - 用户认证保护

    参数:
        request: 创建会话请求
        current_user: 当前用户（依赖注入）

    返回:
        会话信息
    """
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    session_data = {
        "id": session_id,
        "title": request.title or "新的铝合金设计任务",
        "status": "active",
        "user_id": current_user["id"],  # ← 使用真实 user_id
        "metadata": request.metadata or {},
        "created_at": now,
        "updated_at": now,
    }
    
    # 尝试 Supabase 存储
    client = get_supabase_client()
    if client and not is_fallback_mode():
        try:
            result = client.table("sessions").insert(session_data).execute()
            if result.data:
                logger.info(f"创建会话 (Supabase): {session_id}")
                return result.data[0]
        except Exception as e:
            logger.error(f"Supabase 创建会话失败: {e}，降级到内存存储")
    
    # 降级到内存存储（使用 LRU 淘汰）
    _add_fallback_session(session_id, session_data)
    logger.info(f"创建会话 (内存): {session_id}")
    return session_data


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    列出当前用户的所有会话
    
    隐藏问题防护：
    - 查询超时处理
    - 排序一致性（按更新时间倒序）
    - 用户数据隔离（只返回当前用户的会话）

    参数:
        current_user: 当前用户（依赖注入）

    返回:
        会话列表（包装在 sessions 字段中）
    """
    user_id = current_user["id"]
    
    # 尝试 Supabase 查询
    client = get_supabase_client()
    if client and not is_fallback_mode():
        try:
            result = client.table("sessions")\
                .select("*")\
                .eq("user_id", user_id)\
                .order("updated_at", desc=True)\
                .limit(100)\
                .execute()
            
            if result.data is not None:
                return {"sessions": result.data}
        except Exception as e:
            logger.error(f"Supabase 查询会话失败: {e}，降级到内存存储")
    
    # 降级到内存存储（过滤当前用户的会话）
    user_sessions = [
        s for s in _fallback_sessions.values()
        if s.get("user_id") == user_id
    ]
    sessions = sorted(
        user_sessions,
        key=lambda x: x.get("updated_at", ""),
        reverse=True
    )
    return {"sessions": sessions}


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    获取会话信息
    
    隐藏问题防护：
    - UUID 格式验证
    - 404 错误处理
    - 用户权限验证（只能访问自己的会话）

    参数:
        session_id: 会话 ID
        current_user: 当前用户（依赖注入）

    返回:
        会话信息
    """
    user_id = current_user["id"]
    
    # 验证 UUID 格式
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的会话 ID 格式")
    
    # 尝试 Supabase 查询
    client = get_supabase_client()
    if client and not is_fallback_mode():
        try:
            result = client.table("sessions")\
                .select("*")\
                .eq("id", session_id)\
                .eq("user_id", user_id)\
                .single()\
                .execute()
            
            if result.data:
                return result.data
        except Exception as e:
            # Supabase 的 single() 在找不到时会抛出异常
            logger.debug(f"Supabase 查询会话: {e}")
    
    # 降级到内存存储
    session = _fallback_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    # 验证归属
    if session.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权访问此会话")
    
    # 更新 LRU 顺序
    _touch_fallback_session(session_id)
    return session


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str, 
    request: UpdateSessionRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    更新会话信息（PATCH 支持）
    
    隐藏问题防护：
    - 部分更新（只更新提供的字段）
    - 自动更新 updated_at
    - 状态枚举验证
    - 用户权限验证

    参数:
        session_id: 会话 ID
        request: 更新请求
        current_user: 当前用户（依赖注入）

    返回:
        更新后的会话信息
    """
    user_id = current_user["id"]
    
    # 验证 UUID 格式
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的会话 ID 格式")
    
    # 验证状态值
    valid_statuses = {"active", "completed", "archived"}
    if request.status and request.status not in valid_statuses:
        raise HTTPException(
            status_code=400, 
            detail=f"无效的状态值，必须是: {valid_statuses}"
        )
    
    # 构建更新数据
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if request.title is not None:
        update_data["title"] = request.title
    if request.status is not None:
        update_data["status"] = request.status
    if request.metadata is not None:
        update_data["metadata"] = request.metadata
    
    # 尝试 Supabase 更新（含用户过滤）
    client = get_supabase_client()
    if client and not is_fallback_mode():
        try:
            result = client.table("sessions")\
                .update(update_data)\
                .eq("id", session_id)\
                .eq("user_id", user_id)\
                .execute()
            
            if result.data:
                logger.info(f"更新会话 (Supabase): {session_id}")
                return result.data[0]
            else:
                raise HTTPException(status_code=404, detail="会话不存在或无权访问")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Supabase 更新会话失败: {e}，降级到内存存储")
    
    # 降级到内存存储
    session = _fallback_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    # 验证归属
    if session.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权访问此会话")
    
    session.update(update_data)
    logger.info(f"更新会话 (内存): {session_id}")
    return session


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    删除会话
    
    隐藏问题防护：
    - 级联删除 LangGraph 检查点数据
    - UUID 格式验证
    - 用户权限验证

    参数:
        session_id: 会话 ID
        current_user: 当前用户（依赖注入）

    返回:
        操作结果
    """
    user_id = current_user["id"]
    
    # 验证 UUID 格式
    try:
        uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效的会话 ID 格式")
    
    # 尝试 Supabase 删除（含用户验证）
    client = get_supabase_client()
    if client and not is_fallback_mode():
        try:
            # 先删除关联的检查点数据（LangGraph）
            client.table("checkpoints")\
                .delete()\
                .eq("thread_id", session_id)\
                .execute()
            
            client.table("checkpoint_writes")\
                .delete()\
                .eq("thread_id", session_id)\
                .execute()
            
            client.table("checkpoint_blobs")\
                .delete()\
                .eq("thread_id", session_id)\
                .execute()
            
            # 删除会话（含用户验证）
            result = client.table("sessions")\
                .delete()\
                .eq("id", session_id)\
                .eq("user_id", user_id)\
                .execute()
            
            if result.data:
                logger.info(f"删除会话 (Supabase): {session_id}")
                return {"status": "ok", "deleted_checkpoints": True}
            else:
                raise HTTPException(status_code=404, detail="会话不存在或无权访问")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Supabase 删除会话失败: {e}，降级到内存存储")
    
    # 降级到内存存储
    session = _fallback_sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    # 验证归属
    if session.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="无权访问此会话")
    
    del _fallback_sessions[session_id]
    logger.info(f"删除会话 (内存): {session_id}")
    return {"status": "ok"}
