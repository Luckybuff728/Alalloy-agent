"""
API 路由模块

包含 WebSocket 和 REST API 路由定义。
"""

from .websocket import router as websocket_router

__all__ = ["websocket_router"]
