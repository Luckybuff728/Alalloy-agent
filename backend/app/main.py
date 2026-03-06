"""
铝合金智能设计系统 — FastAPI 入口

基于 LangChain 1.x + LangGraph 1.x 官方最佳实践重构。
架构：Supervisor Loop（Thinker → Expert → Thinker → ... → END）

启动方式:
    uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from .core.logger import logger
from .agents.builder import (
    build_graph_with_checkpointer, 
    get_postgres_checkpointer_context,
    set_global_checkpointer,
    build_graph  # 同步版本作为降级方案
)
from .infra.mcp_service import init_mcp_client, cleanup_mcp_client
from .api.websocket.routes import router as ws_router, set_graph
from .api.rest import router as rest_router
from .api.auth import router as auth_router

# 加载环境变量
load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用生命周期管理

    启动时:
    1. 初始化 MCP 客户端（连接 ONNX/Calphad 服务）
    2. 构建 Agent 图（Supervisor Loop）
    3. 注入图实例到 WebSocket 路由

    关闭时:
    1. 清理 MCP 客户端资源
    """
    logger.info("=" * 60)
    logger.info("铝合金智能设计系统 v2.0 启动中...")
    logger.info("架构: LangChain 1.x + LangGraph 1.x (Supervisor Loop)")
    
    # 显示环境模式
    dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"
    mode_str = "🔧 开发模式 (DEV_MODE=true)" if dev_mode else "🔐 生产模式 (DEV_MODE=false)"
    logger.info(f"运行模式: {mode_str}")
    logger.info("=" * 60)

    # ★ 生产模式：预热 JWKS 缓存（确保 WebSocket 同步验证可用）
    if not dev_mode:
        from .core.security import (
            _get_ferriskey_jwks, _get_supabase_jwks,
            SUPABASE_AUTH_ENABLED, SUPABASE_URL
        )
        # Supabase JWKS（ES256 用户 Token 验签必需）
        if SUPABASE_AUTH_ENABLED and SUPABASE_URL:
            try:
                sb_jwks = await _get_supabase_jwks()
                if sb_jwks:
                    keys = sb_jwks.get("keys", [])
                    logger.info(f"✅ Supabase JWKS 预热成功: {len(keys)} 个公钥")
                else:
                    logger.warning("⚠️ Supabase JWKS 预热失败，Supabase 登录将不可用")
            except Exception as e:
                logger.warning(f"⚠️ Supabase JWKS 预热异常: {e}")

        # FerrisKey JWKS（RS256，FerrisKey 不可达时仅影响 SSO 登录，不影响 Supabase）
        try:
            fk_jwks = await _get_ferriskey_jwks()
            if fk_jwks:
                logger.info("✅ FerrisKey JWKS 预热成功")
            else:
                logger.warning("⚠️ FerrisKey JWKS 预热失败（仅影响 SSO 登录，不影响 Supabase）")
        except Exception as e:
            logger.warning(f"⚠️ FerrisKey JWKS 预热异常: {e}")

    # 1. 初始化 MCP 客户端（mcp.mdx 最佳实践：工具直接传递给 Agent）
    mcp_tools = []
    try:
        mcp_tools = await init_mcp_client()
        logger.info(f"MCP 工具初始化完成: {len(mcp_tools)} 个工具")
    except Exception as e:
        logger.warning(f"MCP 初始化失败（将使用降级模式）: {e}")

    # 2. 构建 Agent 图（支持 PostgreSQL Checkpointer）
    checkpointer_ctx = get_postgres_checkpointer_context()
    use_postgres = False
    
    if checkpointer_ctx is not None:
        try:
            # ★ 使用 async with 正确初始化 AsyncPostgresSaver（参考官方文档）
            async with checkpointer_ctx as checkpointer:
                logger.info("AsyncPostgresSaver 上下文已进入")
                
                # ★ 在上下文内部调用 setup() 创建表结构
                await checkpointer.setup()
                logger.info("AsyncPostgresSaver 表结构已初始化")
                use_postgres = True
                
                try:
                    compiled_graph = await build_graph_with_checkpointer(checkpointer, mcp_tools=mcp_tools)
                    logger.info("Agent 图构建完成 (PostgreSQL)")
                    
                    if hasattr(compiled_graph, 'checkpointer') and compiled_graph.checkpointer:
                        set_global_checkpointer(compiled_graph.checkpointer)
                except Exception as e:
                    logger.error(f"Agent 图构建失败: {e}")
                    compiled_graph = None

                # 注入图实例到 WebSocket 路由
                if compiled_graph:
                    set_graph(compiled_graph)
                    logger.info("图实例已注入到 WebSocket 路由")

                logger.info("=" * 60)
                logger.info("系统启动完成！")
                logger.info("=" * 60)

                yield

                # 清理资源（在 async with 内部，确保 checkpointer 连接正确关闭）
                logger.info("系统关闭中...")
                await cleanup_mcp_client()
                logger.info("资源清理完成")
                return  # 正常退出
                
        except Exception as e:
            # ★ 连接失败（如 DNS 解析失败），降级到 MemorySaver
            logger.warning(f"PostgreSQL 连接失败: {e}")
            logger.warning("将降级使用 MemorySaver")
    
    # 降级到 MemorySaver（无需上下文管理）
    try:
        compiled_graph = await build_graph_with_checkpointer(None, mcp_tools=mcp_tools)
        logger.info("Agent 图构建完成 (MemorySaver)")
        
        if hasattr(compiled_graph, 'checkpointer') and compiled_graph.checkpointer:
            set_global_checkpointer(compiled_graph.checkpointer)
    except Exception as e:
        logger.error(f"Agent 图构建失败: {e}")
        compiled_graph = None

    if compiled_graph:
        set_graph(compiled_graph)
        logger.info("图实例已注入到 WebSocket 路由")

    logger.info("=" * 60)
    logger.info("系统启动完成！")
    logger.info("=" * 60)

    yield

    logger.info("系统关闭中...")
    await cleanup_mcp_client()
    logger.info("资源清理完成")


# ==================== 创建 FastAPI 应用 ====================

app = FastAPI(
    title="铝合金智能设计系统",
    description="基于 LangChain 1.x + LangGraph 1.x 的多 Agent 铝合金设计助手",
    version="2.0.0",
    lifespan=lifespan,
)

# ==================== CORS 配置 ====================

DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

# 开发模式：允许所有来源（支持局域网 IP 访问）
# 生产模式：仅允许指定的前端 URL
if DEV_MODE:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # 开发模式允许所有来源
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5174")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            frontend_url,
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ==================== 注册路由 ====================

# REST API
app.include_router(rest_router)

# 认证路由
app.include_router(auth_router)

# WebSocket
app.include_router(ws_router)


# ==================== 根路由 ====================


@app.get("/")
async def root():
    """根路由 — 系统信息"""
    return {
        "name": "铝合金智能设计系统",
        "version": "2.0.0",
        "docs": "/docs",
        "ws_endpoint": "/ws/chat/{session_id}",
    }


@app.get("/health")
async def health():
    """健康检查接口（供 Docker / 负载均衡器使用）"""
    return {"status": "ok"}
