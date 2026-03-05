"""
会话标题自动生成工具

根据对话内容生成简洁的会话标题（15字以内）。

隐藏问题防护：
1. LLM 调用超时处理
2. 空消息处理
3. 标题长度限制（前端显示优化）
4. Fallback 默认标题
"""

from typing import Optional
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

from ..core.llm import get_llm
from ..core.logger import logger


async def generate_session_title(messages: list[BaseMessage]) -> Optional[str]:
    """
    根据对话历史生成会话标题
    
    生成策略：
    - 使用第一条用户消息 + 第一条 AI 回复
    - 调用 LLM 生成 15 字以内的摘要
    - 超时或失败时返回 None（使用默认标题）
    
    参数:
        messages: 消息列表（至少包含 1 条 HumanMessage 和 1 条 AIMessage）
    
    返回:
        生成的标题，或 None（失败时）
    """
    if not messages or len(messages) < 2:
        logger.debug("消息数量不足，无法生成标题")
        return None
    
    # 提取第一条用户消息和第一条 AI 回复
    first_user_msg = None
    first_ai_msg = None
    
    for msg in messages:
        if isinstance(msg, HumanMessage) and not first_user_msg:
            first_user_msg = msg.content
        elif isinstance(msg, AIMessage) and not first_ai_msg:
            first_ai_msg = msg.content
        
        if first_user_msg and first_ai_msg:
            break
    
    if not first_user_msg or not first_ai_msg:
        logger.debug("未找到有效的用户消息和 AI 回复")
        return None
    
    # 构建提示词
    prompt = f"""请为以下对话生成一个简洁的标题（15字以内）。只输出标题本身，不要有任何其他解释。

用户: {first_user_msg[:200]}
助手: {first_ai_msg[:200]}

标题:"""
    
    try:
        llm = get_llm(temperature=0.3)  # 稍高温度，更有创意
        
        # 调用 LLM 生成标题（设置超时 5 秒）
        response = await llm.ainvoke(
            [HumanMessage(content=prompt)],
            config={"timeout": 5}
        )
        
        title = response.content.strip()
        
        # 去除可能的引号
        title = title.strip('"\'「」《》')
        
        # 长度限制（中文按 2 个字符计算）
        if len(title) > 30:  # 约 15 个中文字符
            title = title[:30] + "..."
        
        logger.info(f"生成会话标题: {title}")
        return title
        
    except Exception as e:
        logger.warning(f"标题生成失败: {e}，将使用默认标题")
        return None


def get_default_title(message_count: int = 0) -> str:
    """
    获取默认标题（当自动生成失败时）
    
    参数:
        message_count: 消息数量
    
    返回:
        默认标题
    """
    if message_count == 0:
        return "新对话"
    else:
        return "铝合金设计任务"
