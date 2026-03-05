"""
WebSocket 连接管理器

管理多个 WebSocket 连接的生命周期。
"""

from typing import Dict, Optional
from fastapi import WebSocket

from ...core.logger import logger


class ConnectionManager:
    """
    WebSocket 连接管理器

    管理活跃的 WebSocket 连接，支持按 session_id 索引。
    """

    def __init__(self):
        """初始化连接管理器"""
        # session_id → WebSocket 映射
        self._connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        """
        接受 WebSocket 连接

        参数:
            websocket: WebSocket 实例
            session_id: 会话 ID
        """
        await websocket.accept()
        self._connections[session_id] = websocket
        logger.info(f"WS 连接建立: session={session_id}")

    def disconnect(self, session_id: str):
        """
        断开 WebSocket 连接

        参数:
            session_id: 会话 ID
        """
        if session_id in self._connections:
            del self._connections[session_id]
            logger.info(f"WS 连接断开: session={session_id}")

    async def send_json(self, session_id: str, data: dict):
        """
        向指定会话发送 JSON 消息

        参数:
            session_id: 会话 ID
            data: JSON 数据
        """
        ws = self._connections.get(session_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.error(f"WS 发送失败: session={session_id}, error={e}")
                self.disconnect(session_id)

    def get_connection(self, session_id: str) -> Optional[WebSocket]:
        """
        获取指定会话的 WebSocket 连接

        参数:
            session_id: 会话 ID

        返回:
            WebSocket 实例，不存在返回 None
        """
        return self._connections.get(session_id)

    @property
    def active_count(self) -> int:
        """当前活跃连接数"""
        return len(self._connections)


# 全局单例
connection_manager = ConnectionManager()
