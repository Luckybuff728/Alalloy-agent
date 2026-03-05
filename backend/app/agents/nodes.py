"""
Agent 节点定义

Thinker: structured_output 路由决策，通过 Command(goto=...) 直接控制路由。
专家: 由 create_agent() 生成 CompiledGraph，作为原生子图节点注册到父图。
      LangGraph 自动处理：状态映射（共享键）、interrupt 传播、checkpointer 继承。
      每个子图自带 ReAct 循环、HITL 中间件、上下文总结中间件、工具重试中间件。

命名规范（camelCase）：
    - thinker         — 调度中心
    - dataExpert      — 数据专家
    - analysisExpert  — 分析专家
    - reportWriter    — 报告专家
"""

from typing import Optional, List, Any, Dict, Literal
from pathlib import Path

from langchain_core.messages import SystemMessage
from langgraph.graph import END
from langgraph.types import Command
from pydantic import BaseModel, Field

from .state import AlalloyState
from ..core.logger import logger
from ..core.llm import get_llm


# ==================== Thinker 路由决策模型 ====================


class ThinkerDecision(BaseModel):
    """Thinker 路由决策，LLM 直接输出结构化数据。"""

    reasoning: str = Field(description="说明当前已有什么、缺什么，以及选择该专家的原因，不超过 2 句话")
    next_agent: Literal["dataExpert", "analysisExpert", "reportWriter", "__end__"] = Field(
        description="选择的目标: dataExpert / analysisExpert / reportWriter / __end__（结束本轮）"
    )


# ==================== Prompt 加载 ====================


def _load_prompt(prompt_name: str) -> str:
    prompt_dir = Path(__file__).parent / "prompts"
    prompt_file = prompt_dir / f"{prompt_name}.md"

    if prompt_file.exists():
        return prompt_file.read_text(encoding="utf-8")

    logger.warning(f"提示词文件不存在: {prompt_file}")
    return f"你是铝合金智能设计系统的 {prompt_name} 专家。"


# ==================== Thinker 节点 ====================

VALID_AGENTS = {"dataExpert", "analysisExpert", "reportWriter", "__end__"}


async def thinker_node(
    state: AlalloyState,
) -> Command[Literal["dataExpert", "analysisExpert", "reportWriter", "__end__"]]:
    """Thinker 路由节点 — structured_output + Command(goto=...) 直接路由。"""
    logger.info("Thinker: 开始路由决策")

    llm = get_llm()
    system_prompt = _load_prompt("thinker")
    structured_llm = llm.with_structured_output(ThinkerDecision)

    messages = list(state.get("messages", []))
    route_input = [SystemMessage(content=system_prompt)] + messages

    try:
        decision: ThinkerDecision = await structured_llm.ainvoke(route_input)
        next_agent = decision.next_agent

        if next_agent not in VALID_AGENTS:
            logger.warning(f"Thinker 输出无效目标: {next_agent!r}，回退到 analysisExpert")
            next_agent = "dataExpert"

        logger.info(
            f"Thinker 决策: next={next_agent}, "
            f"reasoning={decision.reasoning[:100]}..."
        )

        if next_agent == "__end__":
            return Command(update={"current_agent": "thinker"}, goto=END)
        return Command(
            update={"current_agent": "thinker"},
            goto=next_agent,
        )

    except Exception as e:
        err_msg = str(e)
        logger.error(f"Thinker 路由决策失败: {e}")
        # 消息历史损坏（tool_call 对不完整）时，直接结束避免无限循环
        if "tool_call" in err_msg or "tool_calls" in err_msg or "role" in err_msg:
            logger.warning("Thinker: 检测到消息历史损坏，路由到 END 防止循环")
            return Command(update={"current_agent": "thinker"}, goto=END)
        return Command(
            update={"current_agent": "thinker"},
            goto="dataExpert",
        )


# ==================== create_agent 子图工厂 ====================


def build_expert_agents(
    data_expert_tools: List[Any],
    analysis_expert_tools: List[Any],
    calphad_hitl_tools: Dict[str, bool] = None,
):
    """
    构建三个专家的 create_agent 子图。

    HITL 配置:
        - dataExpert:      show_guidance_widget 触发 HITL interrupt
        - analysisExpert:  show_guidance_widget + Calphad 提交类工具触发 HITL interrupt
        - reportWriter:    无工具，无 HITL

    返回:
        (dataExpert_agent, analysisExpert_agent, reportWriter_agent) 三个编译后的 graph
    """
    from langchain.agents import create_agent
    from langchain.agents.middleware import (
        HumanInTheLoopMiddleware,
        ContextEditingMiddleware,
        ClearToolUsesEdit,
        ToolRetryMiddleware,
        ModelRetryMiddleware,
        ModelCallLimitMiddleware,
    )

    llm = get_llm()

    tool_retry_mw = ToolRetryMiddleware(
        max_retries=2,
        backoff_factor=2.0,
        initial_delay=1.0,
        max_delay=60.0,
        jitter=True,
        retry_on=(ConnectionError, TimeoutError, OSError),
        on_failure="return_message",
    )

    model_retry_mw = ModelRetryMiddleware(
        max_retries=2,
        backoff_factor=2.0,
        initial_delay=1.0,
        max_delay=30.0,
    )

    # ContextEditingMiddleware：超出阈值时只清除旧工具输出，保留最近 5 条结果。
    # 不注入摘要 SystemMessage，避免 LLM 在调用 show_guidance_widget 前"回显摘要"。
    context_editing_mw = ContextEditingMiddleware(
        edits=[
            ClearToolUsesEdit(
                trigger=500000,   # token 数超过 20000 时触发清理
                keep=10,          # 保留最近 5 条工具结果
                clear_tool_inputs=False,
                placeholder="[已清除，结果已在前文汇总]",
            ),
        ],
    )

    # --- dataExpert (HITL for guidance widget) ---
    # 流程：query_idme(1次) + 成分推荐(1次) + show_guidance_widget(1次) = ~3次；留有余量
    dataExpert_hitl = HumanInTheLoopMiddleware(
        interrupt_on={"show_guidance_widget": True},
    )
    dataExpert_agent = create_agent(
        model=llm,
        tools=data_expert_tools,
        system_prompt=_load_prompt("dataExpert"),
        middleware=[
            dataExpert_hitl,
            tool_retry_mw,
            model_retry_mw,
            ModelCallLimitMiddleware(run_limit=8, exit_behavior="end"),
            context_editing_mw,
        ],
        name="dataExpert",
    )

    # --- analysisExpert (HITL for Calphad submit + guidance widget) ---
    # 流程：models_list(1) + inference×5(5) + 综合(1) + guidance_widget(1) = ~8次
    # Calphad 场景：submit×5(5) + status×5(5) = ~10次；取较大值并留余量
    calphad_hitl = calphad_hitl_tools or {
        "calphamesh_submit_scheil_task": True,
        "calphamesh_submit_point_task": True,
        "calphamesh_submit_line_task": True,
    }
    analysisExpert_hitl = HumanInTheLoopMiddleware(
        interrupt_on={**calphad_hitl, "show_guidance_widget": True},
    )
    analysisExpert_agent = create_agent(
        model=llm,
        tools=analysis_expert_tools,
        system_prompt=_load_prompt("analysisExpert"),
        middleware=[
            analysisExpert_hitl,
            tool_retry_mw,
            model_retry_mw,
            ModelCallLimitMiddleware(run_limit=20, exit_behavior="end"),
            context_editing_mw,
        ],
        name="analysisExpert",
    )

    # --- reportWriter (no tools, single-pass generation) ---
    reportWriter_agent = create_agent(
        model=llm,
        tools=[],
        system_prompt=_load_prompt("reportWriter"),
        middleware=[
            model_retry_mw,
            ModelCallLimitMiddleware(run_limit=4, exit_behavior="end"),
            context_editing_mw,
        ],
        name="reportWriter",
    )

    logger.info(
        f"create_agent 子图构建完成: "
        f"dataExpert(tools={len(data_expert_tools)}), "
        f"analysisExpert(tools={len(analysis_expert_tools)}), "
        f"reportWriter(tools=0)"
    )
    return dataExpert_agent, analysisExpert_agent, reportWriter_agent
