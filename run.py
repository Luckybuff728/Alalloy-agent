"""
铝合金智能设计系统 v2.0 — 启动入口

基于 LangChain 1.x + LangGraph 1.x 官方最佳实践重构。
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
# override=True 强制覆盖已存在的环境变量
from dotenv import load_dotenv
load_dotenv(os.path.join(root_path, ".env"), override=True)

import uvicorn

if __name__ == "__main__":
    # 从环境变量读取配置
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    port = int(os.getenv("BACKEND_PORT", "8001"))

    print(f"启动铝合金智能设计系统 v2.0: http://{host}:{port}")
    print(f"API 文档: http://{host}:{port}/docs")
    print(f"WebSocket: ws://{host}:{port}/ws/chat/{{session_id}}")

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=True,
    )
