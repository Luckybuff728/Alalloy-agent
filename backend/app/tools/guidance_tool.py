"""
引导挂件工具 — 让 LLM 主动显示选项引导用户

通过 HumanInTheLoopMiddleware 暂停图执行，前端显示挂件，
用户选择后以 HITL edit decision 恢复。工具返回纯字符串，框架自动包装为 ToolMessage。

HITL 流程：
1. LLM 调用此工具（不含 user_selection）
2. HumanInTheLoopMiddleware 拦截，生成 action_request interrupt
3. 前端根据 action_request 中的 args 渲染挂件 UI
4. 用户选择后，前端发送 edit decision，将选择写入 user_selection
5. 工具以修改后的参数执行，返回用户选择结果
"""
from typing import Dict, Any, List, Optional
from langchain_core.tools import tool


@tool
def show_guidance_widget(
    widget_type: str,
    title: str,
    message: str = "",
    options: Optional[List[Dict[str, Any]]] = None,
    form_fields: Optional[List[Dict[str, Any]]] = None,
    user_selection: Optional[Dict[str, Any]] = None,
) -> str:
    """
    显示引导挂件，暂停等待用户选择下一步操作或调整参数。

    widget_type 可选值:
    - 'options': 选项卡，让用户选择下一步
    - 'form': 表单，让用户输入参数

    使用场景:
    - 完成分析后，引导用户选择"生成报告"或"继续优化"
    - 需要用户确认参数范围时
    - 多个候选方案让用户选择

    参数:
        widget_type: 挂件类型 ('options' 或 'form')
        title: 标题
        message: 提示信息（可选）
        options: 选项列表，格式 [{"id": "opt1", "label": "选项1", "description": "描述"}]
        form_fields: 表单字段，格式 [{"key": "temp", "label": "温度", "type": "number", "default": 25}]
        user_selection: 系统内部字段，由人工审核流程自动填入，调用时不要设置

    返回:
        用户选择的结果描述（字符串）
    """
    if user_selection:
        if isinstance(user_selection, dict):
            label = user_selection.get("label", user_selection.get("id", "未知"))
            return f"用户通过引导挂件选择了：{label}"
        return f"用户输入了：{user_selection}"

    return "引导挂件已显示，等待用户选择"
