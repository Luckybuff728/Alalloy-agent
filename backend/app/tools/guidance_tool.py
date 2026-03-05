"""
引导挂件工具 — 让 LLM 主动显示选项引导用户

设计原则：
1. 工具内部调用 interrupt() 暂停图执行，前端渲染交互挂件
2. resume 值作为 interrupt() 的返回值，工具拿到用户选择
3. return_direct=True 让 create_agent 的 ReAct 循环在工具执行后直接退出
   （由 _make_tools_to_model_edge 的 return_direct 检查触发 → 子图结束 → thinker 路由）

流程：
1. LLM 调用 show_guidance_widget(widget_type, title, options, ...)
2. interrupt() 暂停图 → 前端渲染挂件
3. 用户选择 → Command(resume=...) → interrupt() 返回
4. 工具返回字符串 → ToolNode 包装为 ToolMessage
5. return_direct=True → 跳过 model 节点 → 子图结束 → thinker 重新路由
"""
from typing import Dict, Any, List, Optional

from langchain_core.tools import tool
from langgraph.types import interrupt


@tool(return_direct=True)
def show_guidance_widget(
    widget_type: str,
    title: str,
    message: str = "",
    options: Optional[List[Dict[str, Any]]] = None,
    form_fields: Optional[List[Dict[str, Any]]] = None,
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

    返回:
        用户选择结果的描述字符串
    """
    user_selection = interrupt({
        "interrupt_type": "guidance_widget",
        "widget": {
            "type": widget_type,
            "title": title,
            "message": message,
            "options": options or [],
            "form_fields": form_fields or [],
        },
    })

    if isinstance(user_selection, dict):
        label = user_selection.get(
            "label",
            user_selection.get("text", user_selection.get("id", str(user_selection)))
        )
    else:
        label = str(user_selection)

    return f"用户通过引导挂件选择了：{label}"
