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

# 铝合金场景允许的 MCP 工具（6 类计算 + 3 类查询）
ALLOWED_TOOLS = {
    # ONNX 性能预测
    "onnx_model_inference",
    "onnx_models_list",
    "onnx_get_model_config",
    # CalphaMesh 热力学计算（6 类提交工具）
    "calphamesh_submit_point_task",
    "calphamesh_submit_line_task",
    "calphamesh_submit_scheil_task",
    "calphamesh_submit_binary_task",                     # 二元平衡相图
    "calphamesh_submit_ternary_task",                    # 三元等温截面
    "calphamesh_submit_thermodynamic_properties_task",   # 热力学性质扫描
    # CalphaMesh 结果查询（3 类）
    "calphamesh_get_task_result",
    "calphamesh_get_task_status",
    "calphamesh_list_tasks",
}

# 工具角色分类
ONNX_TOOL_NAMES = {"onnx_model_inference", "onnx_models_list", "onnx_get_model_config"}
CALPHAD_TOOL_NAMES = {
    "calphamesh_submit_point_task",
    "calphamesh_submit_line_task",
    "calphamesh_submit_scheil_task",
    "calphamesh_submit_binary_task",
    "calphamesh_submit_ternary_task",
    "calphamesh_submit_thermodynamic_properties_task",
    "calphamesh_get_task_result",
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

【重要】只允许使用以下一个模型，禁止使用其他模型：
- 压铸成形性能预测模型 UUID: 9fa6d60e-55ea-4035-96f2-6f9cfa1a9696（唯一可用）
- T6热处理模型 UUID: 1a4b3b66-bf2d-45a6-bbea-ef1486b6812d ← 禁止使用，系统未集成 T6 工艺参数

参数：
- uuid: 固定使用 "9fa6d60e-55ea-4035-96f2-6f9cfa1a9696"
- inputs: 质量百分比字典，格式 W(元素名)，需包含全部 15 种元素（缺失设 0）

示例（Al-7Si-0.3Mg）：
{"W(Si)": 7.0, "W(Mg)": 0.3, "W(Fe)": 0.0, "W(Cu)": 0.0, "W(Zn)": 0.0, "W(Mn)": 0.0, "W(Ti)": 0.0, "W(Sr)": 0.0, "W(Ce)": 0.0, "W(Ni)": 0.0, "W(Cr)": 0.0, "W(Sn)": 0.0, "W(Zr)": 0.0, "W(Mo)": 0.0, "W(La)": 0.0}

首次调用自动加载模型，[未加载] 状态正常。返回 UTS、YS、EL 等性能指标。""",

    "onnx_get_model_config": """查询指定 ONNX 模型的输入参数列表、取值范围和输出参数。
参数：uuid（模型UUID）。用途：确认非默认模型所需的输入格式。""",
}

# CalphaMesh submit 工具：追加到服务端描述之后（不替换）
# 补充服务端 schema 无法完整表达的业务语义：TDB 选择策略和归一化规则

# ── TDB 选择策略（注入所有 7 类 submit 工具）──────────────────────────────
_TDB_SELECTION_GUIDE = (
    "\n\n[TDB 选择策略]"
    "\n  铝合金场景（含 AL/SI/MG/FE/MN）→ 优先使用 Al-Si-Mg-Fe-Mn_by_wf.TDB"
    "\n    支持元素：AL、SI、MG、FE、MN（5 种，含铝基体）"
    "\n    适用任务：压铸铝合金 Al-Si-Mg 系的所有计算"
    "\n  铁基合金（主体为 FE）→ FE-C-SI-MN-CU-TI-O.TDB（FE/C/SI/MN/CU/TI/O）"
    "\n  硼化物/难熔金属 → B-C-SI-ZR-HF-LA-Y-TI-O.TDB（B/C/SI/ZR/HF/LA/Y/TI/O）"
)

# ── 归一化规则（含不支持元素时必须执行，适用于所有 TDB）─────────────────────
_NORMALIZATION_RULE = (
    "\n\n[元素过滤与归一化（含不支持元素时必须执行）]"
    "\n  Al TDB 仅支持 AL/SI/MG/FE/MN，须剔除 Cu/Zn/Sr/Ti/Cr/Ni 等元素后重归一化："
    "\n  1. n_i = wt%_i / M_i（摩尔质量：AL=26.98, SI=28.09, MG=24.31, FE=55.85, MN=54.94）"
    "\n  2. N_total = Σn_i（仅保留元素）"
    "\n  3. 非 AL 元素：f_i = n_i / N_total（保留 6 位小数）"
    "\n  4. AL 必须用补数法：f_AL = 1.0 - Σ(其余 f_i)，禁止独立计算 AL 后直接相加"
    "\n  5. 提交前确认 Σ(所有 f_i) == 1.0，不允许 0.9999 或 1.0001"
    "\n  结果需标注为 Al-Si-Mg-Fe-Mn 子系统趋势分析"
)

# ── 各 submit 工具的描述追加内容 ─────────────────────────────────────────
_AL_SUBMIT_RULES = _TDB_SELECTION_GUIDE + _NORMALIZATION_RULE

# Binary 专用提示（顶点成分约束）
_BINARY_ADDON = (
    _TDB_SELECTION_GUIDE
    + "\n\n[Al-Si 二元相图推荐配置]"
    "\n  components=[\"AL\",\"SI\"], tdb_file=\"Al-Si-Mg-Fe-Mn_by_wf.TDB\""
    "\n  start_composition={\"AL\":1.0,\"SI\":0.0}  ← 纯铝端"
    "\n  end_composition={\"AL\":0.7,\"SI\":0.3}    ← 30 mol% Si 端（覆盖全部常用牌号）"
    "\n  start_temperature=500.0, end_temperature=1200.0"
)

# Ternary 专用提示（三顶点约束）
_TERNARY_ADDON = (
    _TDB_SELECTION_GUIDE
    + "\n\n[Al-Mg-Si 三元截面推荐配置]"
    "\n  components=[\"AL\",\"MG\",\"SI\"], temperature=773.0（时效温度 500°C）"
    "\n  composition_y={\"AL\":1.0,\"MG\":0.0,\"SI\":0.0}（纯 Al 顶点）"
    "\n  composition_x={\"AL\":0.0,\"MG\":1.0,\"SI\":0.0}（纯 Mg 顶点）"
    "\n  composition_o={\"AL\":0.0,\"MG\":0.0,\"SI\":1.0}（纯 Si 顶点）"
    "\n  三顶点各自总和须等于 1.0，不可重复"
)

# ThermoProperties 专用提示（压力参数说明）
_THERMO_ADDON = (
    _TDB_SELECTION_GUIDE
    + "\n\n[压力参数重要说明]"
    "\n  pressure_start / pressure_end 是 log10(P/Pa)，不是直接 Pa 值"
    "\n  常压（约 1 atm）= 5（即 10^5 Pa = 100000 Pa）"
    "\n  常压分析时：pressure_start=5.0, pressure_end=5.0, pressure_increments=2"
)

TOOL_DESCRIPTION_ADDONS = {
    "calphamesh_submit_point_task":     _AL_SUBMIT_RULES,
    "calphamesh_submit_line_task":      _AL_SUBMIT_RULES,
    "calphamesh_submit_scheil_task":    _AL_SUBMIT_RULES,
    "calphamesh_submit_binary_task":    _BINARY_ADDON,
    "calphamesh_submit_ternary_task":   _TERNARY_ADDON,
    "calphamesh_submit_thermodynamic_properties_task": _THERMO_ADDON,
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
