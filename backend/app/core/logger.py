"""
日志配置模块

使用 loguru 进行统一日志管理。
"""

import sys
from loguru import logger

# 移除默认的 handler
logger.remove()

# 添加控制台输出
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="DEBUG",
    colorize=True
)

# 添加文件日志（可选）
logger.add(
    "logs/app_{time:YYYY-MM-DD}.log",
    rotation="00:00",  # 每天午夜轮换
    retention="7 days",  # 保留7天
    compression="zip",  # 压缩旧日志
    level="INFO",
    encoding="utf-8"
)

# 导出 logger 实例
__all__ = ["logger"]
