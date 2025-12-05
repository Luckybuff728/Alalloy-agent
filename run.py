"""
Al-IDME 后端服务入口

基于 FastAPI 的铝合金智能设计系统后端服务。
从根目录启动: python run.py
"""

import os
import sys

# 获取项目根目录
root_path = os.path.dirname(os.path.abspath(__file__))

# 将 backend 目录添加到 Python 路径
backend_path = os.path.join(root_path, "backend")
sys.path.insert(0, backend_path)

# 加载环境变量（从根目录的 .env 文件）
from dotenv import load_dotenv
load_dotenv(os.path.join(root_path, ".env"))

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.logger import logger
from app.services.mcp_service import setup_mcp_tools
from app.api.websocket import router as websocket_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用生命周期管理。
    
    启动时初始化 MCP 工具，关闭时执行清理。
    """
    # 启动时执行
    logger.info("正在初始化 MCP 工具...")
    await setup_mcp_tools()
    logger.info("MCP 工具初始化完成")
    
    yield
    
    # 关闭时执行
    logger.info("应用正在关闭...")


def create_app() -> FastAPI:
    """
    创建并配置 FastAPI 应用实例。
    
    返回:
        FastAPI: 配置好的应用实例
    """
    # 获取前端 URL 用于 CORS 配置
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5174")
    
    app = FastAPI(
        title="Al-IDME API",
        description="铝合金智能设计系统后端服务",
        version="1.0.0",
        lifespan=lifespan
    )

    # 配置 CORS 中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[frontend_url, "*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # 注册路由
    app.include_router(websocket_router)
    
    return app


# 创建应用实例
app = create_app()


if __name__ == "__main__":
    # 从环境变量读取配置
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    port = int(os.getenv("BACKEND_PORT", "8001"))
    
    logger.info(f"启动后端服务: http://{host}:{port}")
    logger.info(f"前端地址: {os.getenv('FRONTEND_URL', 'http://localhost:5174')}")
    
    uvicorn.run("run:app", host=host, port=port, reload=True)
