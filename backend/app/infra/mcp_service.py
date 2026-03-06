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
    "calphamesh_get_task_result",
    "calphamesh_get_task_status",
    "calphamesh_list_tasks",
}

# 工具角色分类
ONNX_TOOL_NAMES = {"onnx_model_inference", "onnx_models_list", "onnx_get_model_config"}
CALPHAD_TOOL_NAMES = {
    "calphamesh_submit_point_task", "calphamesh_submit_line_task",
    "calphamesh_submit_scheil_task", "calphamesh_get_task_result",
    "calphamesh_get_task_status",
    "calphamesh_list_tasks",
}

# ==================== 工具描述增强 ====================
# ONNX: 服务端描述过于简略 → 完整替换
# CalphaMesh: 服务端描述已足够详细（含参数 schema / enum / range）→ 仅追加业务语义补充
# get_task_result / get_task_status / list_tasks: 服务端描述已充分 → 不修改

TOOL_DESCRIPTIONS = {
    "onnx_models_list": """获取所有可用 ONNX 模型列表。
返回：模型名称、版本、状态（[已加载]/[未加载]）、UUID。""",

    "onnx_model_inference": """执行 ONNX 模型推理预测铝合金性能。

参数：
- uuid: 模型UUID（推荐: 9fa6d60e-55ea-4035-96f2-6f9cfa1a9696）
- inputs: 质量百分比字典，格式 W(元素名)，需包含全部 15 种元素（缺失设 0）

示例（Al-7Si-0.3Mg）：
{"W(Si)": 7.0, "W(Mg)": 0.3, "W(Fe)": 0.0, "W(Cu)": 0.0, "W(Zn)": 0.0, "W(Mn)": 0.0, "W(Ti)": 0.0, "W(Sr)": 0.0, "W(Ce)": 0.0, "W(Ni)": 0.0, "W(Cr)": 0.0, "W(Sn)": 0.0, "W(Zr)": 0.0, "W(Mo)": 0.0, "W(La)": 0.0}

首次调用自动加载模型，[未加载] 状态正常。返回 UTS、YS、EL 等性能指标。""",

    "onnx_get_model_config": """查询指定 ONNX 模型的输入参数列表、取值范围和输出参数。
参数：uuid（模型UUID）。用途：确认非默认模型所需的输入格式。""",
}

# CalphaMesh submit 工具：追加到服务端描述之后（不替换）
# 仅补充服务端 schema 无法表达的业务语义——TDB 支持元素完整列表及过滤归一化规则

# 各 TDB 支持元素完整列表（过滤时严格按此执行，列表之外的元素一律不加入）
_TDB_ELEMENT_LISTS = (
    "\n\n[TDB 支持元素完整列表]"
    "\n  • FE-C-SI-MN-CU-TI-O.TDB   → 仅支持：FE、C、SI、MN、CU、TI、O（共 7 种）"
    "\n  • B-C-SI-ZR-HF-LA-Y-TI-O.TDB → 仅支持：B、C、SI、ZR、HF、LA、Y、TI、O（共 9 种）"
    "\n  （AL、MG、SR、NI、CR 等铝合金常见元素均不在任何可用 TDB 中）"
)

CALPHAMESH_SUBMIT_RULES = (
    _TDB_ELEMENT_LISTS
    + "\n\n调用前必须完成以下三步，否则服务端会直接拒绝："
    "\n  1. 对照上述支持列表，将 composition 中不在列表内的元素全部剔除（不得替代）。"
    "\n  2. 对保留元素重新归一化：f_i = n_i / Σn_j；最后将最大分量设为 1.0 - Σ(其余元素 f_j)，"
    "使总和严格等于 1.0。"
    "\n  3. 用过滤后的 components 和归一化后的 composition 提交，结果标注为受支持元素子系统趋势分析。"
)

TOOL_DESCRIPTION_ADDONS = {
    "calphamesh_submit_point_task": CALPHAMESH_SUBMIT_RULES,
    "calphamesh_submit_scheil_task": CALPHAMESH_SUBMIT_RULES,
    "calphamesh_submit_line_task": CALPHAMESH_SUBMIT_RULES,
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
        
        # ★ 增强工具描述
        # - TOOL_DESCRIPTIONS: 完整替换（服务端描述不足的工具）
        # - TOOL_DESCRIPTION_ADDONS: 追加补充（服务端描述已充分的工具）
        _mcp_tools = []
        for tool in filtered_tools:
            if tool.name in TOOL_DESCRIPTIONS:
                tool.description = TOOL_DESCRIPTIONS[tool.name]
            elif tool.name in TOOL_DESCRIPTION_ADDONS:
                tool.description += TOOL_DESCRIPTION_ADDONS[tool.name]
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
