"""
MCP 服务模块（遵循 langchain/mcp.mdx 最佳实践）

提供 MCP (Model Context Protocol) 工具的初始化和管理。
核心设计：
1. 使用 tool_interceptors 实现日志记录和错误处理
2. MCP 工具直接传递给 Agent，不做二次包装
3. 提供工具分类函数，按角色分组分配给不同专家节点

参考: CementedCarbide_Agent/langchain-docs/src/oss/langchain/mcp.mdx
"""

import os
import time
from typing import List, Any, Optional, Dict

from langchain_mcp_adapters.client import MultiServerMCPClient
from dotenv import load_dotenv

from ..core.logger import logger

# 加载环境变量
load_dotenv()

# 全局 MCP 客户端和工具缓存
_mcp_client: Optional[MultiServerMCPClient] = None
_mcp_tools: List[Any] = []

# 铝合金场景允许的 MCP 工具
ALLOWED_TOOLS = {
    "onnx_model_inference",
    "onnx_models_list",
    "onnx_get_model_config",  # 查询模型输入参数格式
    "calphamesh_submit_point_task",
    "calphamesh_submit_line_task",
    "calphamesh_submit_scheil_task",
    "calphamesh_get_task_status",
    "calphamesh_list_tasks",
}

# 工具角色分类
ONNX_TOOL_NAMES = {"onnx_model_inference", "onnx_models_list", "onnx_get_model_config"}
CALPHAD_TOOL_NAMES = {
    "calphamesh_submit_point_task", "calphamesh_submit_line_task",
    "calphamesh_submit_scheil_task", "calphamesh_get_task_status",
    "calphamesh_list_tasks",
}

# ==================== 工具描述增强 ====================
# MCP 原生工具描述太简短，这里提供详细描述供 LLM 理解
TOOL_DESCRIPTIONS = {
    # ONNX 工具
    "onnx_models_list": """获取所有可用 ONNX 模型列表。
返回格式：模型名称、版本、状态([已加载]/[未加载])、UUID。""",
    
    "onnx_model_inference": """执行 ONNX 模型推理预测铝合金性能。

参数：
- uuid: 模型UUID（推荐: 9fa6d60e-55ea-4035-96f2-6f9cfa1a9696）
- inputs: 成分输入字典，格式为 W(元素名) 的质量百分比

输入格式（AlSiMg_properties_v1）：
需要15个元素的质量%，缺失的元素设为0。例如 Al-7Si-0.3Mg：
{
  "W(Si)": 7.0, "W(Mg)": 0.3, "W(Fe)": 0.0, "W(Cu)": 0.0, 
  "W(Zn)": 0.0, "W(Mn)": 0.0, "W(Ti)": 0.0, "W(Sr)": 0.0, 
  "W(Ce)": 0.0, "W(Ni)": 0.0, "W(Cr)": 0.0, "W(Sn)": 0.0, 
  "W(Zr)": 0.0, "W(Mo)": 0.0, "W(La)": 0.0
}

★ 懒加载说明：模型列表显示 [未加载] 是正常的，首次调用会自动加载。

返回：UTS(抗拉强度)、YS(屈服强度)、EL(延伸率) 等性能指标。""",
    
    "onnx_get_model_config": """查询指定 ONNX 模型的详细配置信息。
参数：uuid（模型UUID）
返回：模型的输入参数列表、取值范围、输出参数等。
用途：当需要使用非 AlSiMg_properties_v1 的模型时，先调用此工具查看该模型需要的输入参数格式。""",
    
    # Calphad 工具
    #
    # 共享参数说明块（所有 submit 工具共用）
    # 在各自描述中直接内联，避免 LLM 漏读

    "calphamesh_submit_point_task": """提交单点平衡计算任务（异步），返回 task_id，不是结果。提交后必须调用 calphamesh_get_task_status 查询结果。

参数：
- components: 大写元素列表，如 ["SI", "FE"]
- composition: 原子分数字典（大写符号，总和必须精确=1.0）
- temperature: 温度（K）
- tdb_file: 数据库文件名（AL-DEFAULT.TDB 支持 SI, FE, MN, CU, TI, SR 等，不含 AL/MG）

**composition 计算规则（AL-DEFAULT.TDB）：**
1. 过滤：仅保留数据库支持的元素（去除 AL、MG）
2. 各元素摩尔数 = 质量% ÷ 原子量（Si=28.09, Fe=55.85, Mn=54.94, Cu=63.55, Ti=47.87, Sr=87.62）
3. 各元素初始原子分数 = 摩尔数 ÷ 摩尔数总和
4. **精度保证**：将最大分量设为 `1.0 - 其余各分量之和`，确保总和精确=1.0

返回：task_id（字符串）""",

    "calphamesh_submit_scheil_task": """提交 Scheil 凝固模拟任务（异步），返回 task_id，不是结果。提交后必须调用 calphamesh_get_task_status 查询结果。

参数：
- components: 大写元素列表
- composition: 原子分数字典（总和必须精确=1.0）
- start_temperature: 起始温度（K）
- temperature_step: 温度步长（K）
- tdb_file: 数据库文件名

**composition 计算规则（AL-DEFAULT.TDB）：**
1. 过滤：仅保留数据库支持的元素（去除 AL、MG）
2. 各元素摩尔数 = 质量% ÷ 原子量（Si=28.09, Fe=55.85, Mn=54.94, Cu=63.55, Ti=47.87, Sr=87.62）
3. 各元素初始原子分数 = 摩尔数 ÷ 摩尔数总和
4. **精度保证**：将最大分量设为 `1.0 - 其余各分量之和`，确保总和精确=1.0

返回：task_id（字符串）""",

    "calphamesh_submit_line_task": """提交线性扫描计算任务（异步），返回 task_id，不是结果。提交后必须调用 calphamesh_get_task_status 查询结果。

参数：
- components: 大写元素列表
- start_composition / end_composition: 起止成分（原子分数，各自总和必须精确=1.0）
- start_temperature / end_temperature: 起止温度（K）
- steps: 计算步数
- tdb_file: 数据库文件名

**composition 计算规则（AL-DEFAULT.TDB）：**
1. 过滤：仅保留数据库支持的元素（去除 AL、MG）
2. 各元素摩尔数 = 质量% ÷ 原子量（Si=28.09, Fe=55.85, Mn=54.94, Cu=63.55, Ti=47.87, Sr=87.62）
3. 各元素初始原子分数 = 摩尔数 ÷ 摩尔数总和
4. **精度保证**：将最大分量设为 `1.0 - 其余各分量之和`，确保总和精确=1.0

返回：task_id（字符串）""",

    "calphamesh_get_task_status": """查询 Calphad 任务的状态和计算结果。

参数：task_id（submit 工具返回的任务 ID）

返回值含义：
- status = "completed"：result 字段包含实际计算数据，可以解读
- status = "pending" 或 "running"：任务还在计算中，result 为空
  → 你应该停止调用工具，用文本告知用户"任务 {task_id} 仍在计算中，请稍后再问"
  → 不要对 pending/running 的任务假装已有结果
- status = "failed"：error 字段包含错误原因

使用规则：
- 每个 submit 工具返回的 task_id 都必须用本工具查询一次
- 如果有多个 task_id，逐个查询
- pending/running 时不要重复轮询同一个 task_id，告知用户等待即可""",

    "calphamesh_list_tasks": """列出用户的 Calphad 任务历史。
可选参数：page、items_per_page
用于查看历史计算记录。""",
}


# ==================== Tool Interceptors ====================
# 参考 mcp.mdx: Advanced features > Tool interceptors


async def _log_tool_call(request, handler):
    """
    日志拦截器：记录每次 MCP 工具调用的名称、参数和耗时

    参考 mcp.mdx: Writing interceptors
    """
    start = time.time()
    tool_name = request.name
    logger.info(f"[MCP] 调用工具: {tool_name}, 参数: {request.args}")

    try:
        result = await handler(request)
        elapsed = time.time() - start
        logger.info(f"[MCP] 工具 {tool_name} 完成 ({elapsed:.2f}s)")
        return result
    except Exception as e:
        elapsed = time.time() - start
        logger.error(f"[MCP] 工具 {tool_name} 失败 ({elapsed:.2f}s): {e}")
        raise


# ==================== 初始化与管理 ====================


async def init_mcp_client() -> List[Any]:
    """
    初始化 MCP 客户端并获取工具列表

    使用 tool_interceptors 注入日志和错误处理（mcp.mdx 最佳实践）。
    MCP 工具直接作为 LangChain Tool 使用，不做二次包装。

    返回:
        过滤后的 MCP 工具列表（可直接传递给 Agent/ToolNode）
    """
    global _mcp_client, _mcp_tools

    mcp_url = os.getenv("MCP_URL", "http://111.22.21.99:10001/mcp")
    mcp_token = os.getenv("MCP_TOKEN", "")
    mcp_transport = os.getenv("MCP_TRANSPORT", "streamable_http")

    mcp_config = {
        "mcp-server": {
            "transport": mcp_transport,
            "url": mcp_url,
            "headers": {"Authorization": f"Bearer {mcp_token}"},
        }
    }

    logger.info(f"初始化 MCP 客户端: url={mcp_url}, transport={mcp_transport}")

    try:
        # ★ 使用 tool_interceptors 注入日志拦截器（mcp.mdx 最佳实践）
        client = MultiServerMCPClient(
            mcp_config,
            tool_interceptors=[_log_tool_call],
        )
        _mcp_client = client

        all_tools = await client.get_tools()
        # 过滤只保留铝合金场景需要的工具
        filtered_tools = [t for t in all_tools if t.name in ALLOWED_TOOLS]
        
        # ★ 增强工具描述（MCP 原生描述太简短）
        _mcp_tools = []
        for tool in filtered_tools:
            if tool.name in TOOL_DESCRIPTIONS:
                # 替换为详细描述
                tool.description = TOOL_DESCRIPTIONS[tool.name]
            _mcp_tools.append(tool)

        logger.info(
            f"MCP 初始化成功: {len(_mcp_tools)}/{len(all_tools)} 个工具"
        )
        logger.info(f"已加载工具: {[t.name for t in _mcp_tools]}")
        return _mcp_tools

    except Exception as e:
        logger.error(f"MCP 初始化失败: {e}")
        _mcp_tools = []
        return []


def get_mcp_tools() -> List[Any]:
    """
    获取已初始化的 MCP 工具列表

    返回:
        MCP 工具列表（如果未初始化则返回空列表）
    """
    return _mcp_tools


def categorize_mcp_tools(mcp_tools: List[Any]) -> Dict[str, List[Any]]:
    """
    按角色分类 MCP 工具（用于分配给不同专家节点）

    参数:
        mcp_tools: init_mcp_client() 返回的工具列表

    返回:
        按角色分组的字典:
        - "onnx": ONNX 性能预测工具
        - "calphad": Calphad 热力学计算工具
    """
    result = {"onnx": [], "calphad": []}

    for tool in mcp_tools:
        if tool.name in ONNX_TOOL_NAMES:
            result["onnx"].append(tool)
        elif tool.name in CALPHAD_TOOL_NAMES:
            result["calphad"].append(tool)

    logger.debug(
        f"MCP 工具分类: onnx={len(result['onnx'])}, "
        f"calphad={len(result['calphad'])}"
    )
    return result


async def cleanup_mcp_client():
    """
    清理 MCP 客户端资源
    """
    global _mcp_client, _mcp_tools
    if _mcp_client:
        logger.info("清理 MCP 客户端资源")
        _mcp_client = None
        _mcp_tools = []
