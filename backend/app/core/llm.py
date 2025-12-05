"""
LLM 配置模块

使用阿里云 DashScope 的 OpenAI 兼容模式配置通义千问模型。
支持 qwen-plus、qwen-max、qwen-turbo 等模型。
"""

import os
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

from .logger import logger

# 加载环境变量
load_dotenv()

# DashScope API 配置
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

# 默认模型配置
DEFAULT_MODEL = "qwen-plus"  # 可选: qwen-plus, qwen-max, qwen-turbo


def get_llm(
    model: str = DEFAULT_MODEL,
    temperature: float = 0,
    **kwargs
) -> ChatOpenAI:
    """
    获取配置好的 LLM 实例。
    
    参数:
        model: 模型名称，默认使用 qwen-plus
        temperature: 温度参数，控制输出的随机性，默认为 0
        **kwargs: 其他传递给 ChatOpenAI 的参数
    
    返回:
        ChatOpenAI: 配置好的 LLM 实例
    
    异常:
        ValueError: 如果未设置 DASHSCOPE_API_KEY 环境变量
    """
    if not DASHSCOPE_API_KEY:
        error_msg = (
            "未设置 DASHSCOPE_API_KEY 环境变量。\n"
            "请在 .env 文件中添加: DASHSCOPE_API_KEY=your-api-key\n"
            "或设置环境变量: export DASHSCOPE_API_KEY=your-api-key"
        )
        logger.error(error_msg)
        raise ValueError(error_msg)
    
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=DASHSCOPE_API_KEY,
        base_url=DASHSCOPE_BASE_URL,
        **kwargs
    )


# 预配置的 LLM 实例 (延迟初始化)
_llm_instance = None


def get_default_llm() -> ChatOpenAI:
    """
    获取默认的 LLM 单例实例。
    
    返回:
        ChatOpenAI: 默认配置的 LLM 实例
    """
    global _llm_instance
    if _llm_instance is None:
        _llm_instance = get_llm()
    return _llm_instance


# 预配置的流式 LLM 实例 (延迟初始化)
_streaming_llm_instance = None


def get_streaming_llm(
    model: str = DEFAULT_MODEL,
    temperature: float = 0,
    **kwargs
) -> ChatOpenAI:
    """
    获取支持流式输出的 LLM 实例。
    
    用于需要实时流式输出的场景，如报告生成。
    
    参数:
        model: 模型名称，默认使用 qwen-plus
        temperature: 温度参数，控制输出的随机性，默认为 0
        **kwargs: 其他传递给 ChatOpenAI 的参数
    
    返回:
        ChatOpenAI: 支持流式输出的 LLM 实例
    
    异常:
        ValueError: 如果未设置 DASHSCOPE_API_KEY 环境变量
    """
    if not DASHSCOPE_API_KEY:
        error_msg = "未设置 DASHSCOPE_API_KEY 环境变量"
        logger.error(error_msg)
        raise ValueError(error_msg)
    
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=DASHSCOPE_API_KEY,
        base_url=DASHSCOPE_BASE_URL,
        streaming=True,  # 开启流式输出
        **kwargs
    )


def get_default_streaming_llm() -> ChatOpenAI:
    """
    获取默认的流式 LLM 单例实例。
    
    返回:
        ChatOpenAI: 默认配置的流式 LLM 实例
    """
    global _streaming_llm_instance
    if _streaming_llm_instance is None:
        _streaming_llm_instance = get_streaming_llm()
    return _streaming_llm_instance


# 导出便捷函数
__all__ = ["get_llm", "get_default_llm", "get_streaming_llm", "get_default_streaming_llm", "DEFAULT_MODEL"]
