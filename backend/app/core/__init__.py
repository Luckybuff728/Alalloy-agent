"""
核心配置模块

包含 LLM 配置、日志配置等基础设施代码。
"""

from .logger import logger
from .llm import get_llm, get_default_llm, DEFAULT_MODEL

__all__ = ["logger", "get_llm", "get_default_llm", "DEFAULT_MODEL"]
