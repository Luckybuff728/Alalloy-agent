"""
图构建器 — 多 Agent 规范：Router + 循环回 Thinker（参考 Handoffs 多子图）

命名规范（camelCase）：thinker / dataExpert / analyst / reportWriter

拓扑（符合 LangChain 多 Agent Handoffs 规范）：
  START → thinker →(Command goto)→ [dataExpert | analysisExpert | reportWriter | __end__]
       ↑                                                                              │
       └── dataExpert ── analysisExpert ── reportWriter ───────────────────────────┘

- 专家完成后统一回到 thinker；thinker 根据状态决定下一跳（专家或 END）。
- 专家内 show_guidance_widget 触发 HITL 暂停；用户 resume 后图在同一执行内继续，自然回到 thinker 再路由。
- 使用 checkpointer 持久化，interrupt/resume 由框架处理，无需在 API 层做二次触发。
"""

from typing import Optional, List, Any

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.base import BaseCheckpointSaver

from .state import AlalloyState
from .nodes import thinker_node, build_expert_agents
from ..tools import DATA_EXPERT_TOOLS, ANALYST_TOOLS, REPORT_WRITER_TOOLS
from ..core.logger import logger
from ..infra.supabase_client import get_db_connection_string, is_fallback_mode
from ..infra.mcp_service import categorize_mcp_tools


# ==================== 主构建函数 ====================


def build_graph(
    checkpointer: Optional[BaseCheckpointSaver] = None,
    mcp_tools: Optional[List[Any]] = None,
) -> StateGraph:
    """
    构建铝合金 Agent 图。

    路由机制：Thinker 返回 Command(goto=...) 直接路由，无需 conditional_edges。

    每个专家由 create_agent 子图实现：
    - dataExpert:      IDME 查询 + 成分解析 + guidance (HITL), SummarizationMiddleware
    - analysisExpert:  ONNX + Calphad (MCP) + guidance (HITL), HumanInTheLoopMiddleware + Summarization
    - reportWriter:    纯文本生成, SummarizationMiddleware
    """
    logger.info("开始构建铝合金 Agent 图（create_agent 模式）")

    if checkpointer is None:
        checkpointer = MemorySaver()
        logger.warning("使用 MemorySaver（内存存储），会话状态不会持久化")

    # ==================== MCP 工具分类 ====================
    mcp_categorized = categorize_mcp_tools(mcp_tools or [])
    onnx_tools = mcp_categorized["onnx"]
    calphad_tools = mcp_categorized["calphad"]

    data_expert_tools = DATA_EXPERT_TOOLS
    analyst_tools = ANALYST_TOOLS + onnx_tools + calphad_tools

    logger.info(
        f"工具分配: dataExpert={len(data_expert_tools)}个, "
        f"analysisExpert={len(analyst_tools)}个 "
        f"(本地{len(ANALYST_TOOLS)} + onnx{len(onnx_tools)} + calphad{len(calphad_tools)})"
    )

    # ==================== 构建 create_agent 子图 ====================
    # 对 ONNX 性能预测及所有主要 CalphaMesh 提交任务开启 HITL，执行前要求用户确认参数：
    #   ONNX HITL：onnx_model_inference（确认成分输入）
    #   CalphaMesh HITL：point / line / scheil / binary / ternary
    #   不拦截：thermo_properties（性质扫描，后台执行）
    CALPHAD_HITL_TOOLS = {
        "calphamesh_submit_point_task",
        "calphamesh_submit_line_task",
        "calphamesh_submit_scheil_task",
        "calphamesh_submit_binary_task",
        "calphamesh_submit_ternary_task",
    }
    calphad_submit_names = [
        t.name for t in calphad_tools
        if "submit" in t.name and t.name in CALPHAD_HITL_TOOLS
    ] if calphad_tools else []
    onnx_hitl_names = [
        t.name for t in onnx_tools
        if t.name == "onnx_model_inference"
    ] if onnx_tools else []
    all_hitl_names = calphad_submit_names + onnx_hitl_names
    hitl_config = {name: True for name in all_hitl_names} if all_hitl_names else None

    dataExpert_agent, analysisExpert_agent, reportWriter_agent = build_expert_agents(
        data_expert_tools=data_expert_tools,
        analysis_expert_tools=analyst_tools,
        calphad_hitl_tools=hitl_config,
        report_writer_tools=REPORT_WRITER_TOOLS,
    )

    # ==================== 创建图 ====================
    graph = StateGraph(AlalloyState)

    # 1. Thinker 路由节点（返回 Command(goto=...) 直接路由到目标专家）
    graph.add_node("thinker", thinker_node)

    # 2. 专家子图节点（原生 CompiledGraph，LangGraph 自动处理状态映射与 interrupt）
    graph.add_node("dataExpert", dataExpert_agent)
    graph.add_node("analysisExpert", analysisExpert_agent)
    graph.add_node("reportWriter", reportWriter_agent)

    # ==================== 边 ====================

    # 入口 → Thinker
    graph.add_edge(START, "thinker")

    # 专家完成 → 回到 thinker（thinker 再通过 Command(goto=...) 决定下一跳或 END）
    graph.add_edge("dataExpert", "thinker")
    graph.add_edge("analysisExpert", "thinker")
    graph.add_edge("reportWriter", "thinker")

    # ==================== 编译 ====================
    compiled = graph.compile(checkpointer=checkpointer)
    logger.info("铝合金 Agent 图构建完成（create_agent 模式）")
    return compiled


# ==================== 异步构建函数（支持 PostgreSQL） ====================


def get_postgres_checkpointer_context():
    """获取 PostgreSQL Checkpointer 上下文管理器，或 None（降级到 MemorySaver）"""
    connection_string = get_db_connection_string()

    if not connection_string:
        logger.warning("未配置 SUPABASE_DB_URL，将使用 MemorySaver")
        return None

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        logger.info("创建 AsyncPostgresSaver 上下文管理器...")
        return AsyncPostgresSaver.from_conn_string(connection_string)
    except ImportError as e:
        logger.error(f"langgraph-checkpoint-postgres 未安装: {e}")
        return None
    except Exception as e:
        logger.error(f"AsyncPostgresSaver 创建失败: {e}")
        return None


async def build_graph_with_checkpointer(
    checkpointer: Optional[BaseCheckpointSaver] = None,
    mcp_tools: Optional[List[Any]] = None,
) -> StateGraph:
    """使用指定 checkpointer + MCP 工具构建图"""
    if checkpointer is None:
        checkpointer = MemorySaver()
        logger.warning("使用 MemorySaver（内存存储），会话状态不会跨重启持久化")
    else:
        logger.info("使用 AsyncPostgresSaver（PostgreSQL 存储），会话状态将持久化")

    return build_graph(checkpointer=checkpointer, mcp_tools=mcp_tools)


# ==================== Checkpointer 状态查询 ====================

_global_checkpointer: Optional[BaseCheckpointSaver] = None


def set_global_checkpointer(checkpointer: BaseCheckpointSaver):
    global _global_checkpointer
    _global_checkpointer = checkpointer


def get_global_checkpointer() -> Optional[BaseCheckpointSaver]:
    return _global_checkpointer
