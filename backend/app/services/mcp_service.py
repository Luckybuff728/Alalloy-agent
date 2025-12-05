"""
MCP 服务模块

提供 MCP (Multi-server Client Protocol) 工具的初始化和调用功能。
"""

import os
from typing import Dict, Any, List, Optional
from langchain_mcp_adapters.client import MultiServerMCPClient
from dotenv import load_dotenv

from ..core.logger import logger

# 加载环境变量
load_dotenv()

# 全局变量保存 MCP 客户端和工具
GLOBAL_MCP_CLIENT: Optional[MultiServerMCPClient] = None
GLOBAL_MCP_TOOLS: List[Any] = []

# 工作流允许的工具列表
# 工作流结构：开始 → 体系提取 → IDME查询 → 推荐合金 → 迭代分析 → 报告生成
ALLOWED_TOOLS = {
    # ONNX 性能预测 (迭代内 - 性能预测分支)
    "onnx_model_inference",      # 执行模型推理
    "onnx_get_models_info",      # 获取可用模型列表
    "onnx_get_model_config",     # 获取模型配置（输入规格）
    
    # Calphad 热力学计算 (迭代内 - 热力学分支)
    "calphamesh_submit_point_task",   # 点计算任务
    "calphamesh_submit_line_task",    # 线计算任务
    "calphamesh_submit_scheil_task",  # 希尔凝固计算任务
    "calphamesh_get_task_status",     # 查询任务状态和结果
    "calphamesh_list_tasks",          # 列出用户任务
}


async def setup_mcp_tools() -> tuple:
    """
    设置 MultiServerMCPClient 以连接到 ONNX 和 Calphad MCP 服务器。
    
    初始化全局变量并返回工具列表。
    
    返回:
        tuple: (工具列表, MCP 客户端)
    """
    global GLOBAL_MCP_CLIENT, GLOBAL_MCP_TOOLS
    
    # MCP 服务器配置
    mcp_url = os.getenv("MCP_URL", "http://111.22.21.99:10004/mcp")
    mcp_token = os.getenv("MCP_TOKEN", "tk_9EERZLMf3jVd7BqlL2x1VeswUZMOS5We")
    
    mcp_config = {
        "mcp-server": {
            "transport": "streamable_http",
            "url": mcp_url,
            "headers": {
                "Authorization": f"Bearer {mcp_token}"
            }
        }
    }
    
    logger.info(f"MCP 配置: url={mcp_url}")
    
    client = MultiServerMCPClient(mcp_config)
    GLOBAL_MCP_CLIENT = client
    
    # 注意：MultiServerMCPClient.get_tools() 会连接到服务器并获取工具定义
    try:
        all_tools = await client.get_tools()
        # 过滤只保留需要的工具
        tools = [t for t in all_tools if t.name in ALLOWED_TOOLS]
        GLOBAL_MCP_TOOLS = tools
        logger.success(f"成功连接到 MCP 服务器，加载了 {len(tools)}/{len(all_tools)} 个工具")
        logger.info(f"已加载工具: {[t.name for t in tools]}")
        return tools, client
    except Exception as e:
        logger.warning(f"连接 MCP 服务器失败: {e}")
        return [], client


def get_mcp_tools() -> List[Any]:
    """
    获取已初始化的 MCP 工具列表。
    
    返回:
        List[Any]: MCP 工具列表
    """
    return GLOBAL_MCP_TOOLS


async def call_mcp_tool(tool_name: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    查找并调用 MCP 工具的辅助函数。
    
    参数:
        tool_name: 工具的完整名称或关键字
        input_data: 工具的输入参数
        
    返回:
        包含 result 或 error 的字典
    """
    if not GLOBAL_MCP_TOOLS:
        logger.error("MCP 工具未初始化")
        return {"error": "MCP 工具未初始化"}
    
    # 首先尝试精确匹配
    target_tool = None
    for t in GLOBAL_MCP_TOOLS:
        if t.name == tool_name:
            target_tool = t
            break
    
    # 如果没有精确匹配，尝试关键字匹配
    if not target_tool:
        for t in GLOBAL_MCP_TOOLS:
            if tool_name in t.name:
                target_tool = t
                break
            
    if not target_tool:
        available = [t.name for t in GLOBAL_MCP_TOOLS]
        logger.warning(f"未找到工具 '{tool_name}'，可用工具: {available}")
        return {"error": f"未找到工具 '{tool_name}'"}
    
    logger.info(f"调用 MCP 工具: {target_tool.name}，参数: {input_data}")
    try:
        result = await target_tool.ainvoke(input_data)
        logger.success(f"工具 {target_tool.name} 调用成功")
        # 返回结果同时包含输入参数，便于前端显示完整的工具调用信息
        return {
            "result": result,
            "tool_name": target_tool.name,
            "input": input_data
        }
    except Exception as e:
        logger.error(f"工具 {target_tool.name} 调用失败: {e}")
        return {
            "error": str(e),
            "tool_name": tool_name,
            "input": input_data
        }
