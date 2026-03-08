"""
报告生成工具

将 reportWriter 生成的完整 Markdown 报告持久化到本地，
并向前端返回结构化的报告数据（含原始内容），
前端可直接渲染 Markdown 并提供浏览器打印 / 导出 PDF 功能。

设计说明：
- return_direct=False（默认）：reportWriter 调用后 ReAct 循环继续，
  可接着调用 show_guidance_widget 展示引导选项
- 工具只负责"保存 + 返回结构"，不调用 interrupt()，不阻塞图执行
- 前端通过 tool_name="generate_report" 识别并渲染专属报告视图
"""

import os
import json
from datetime import datetime
from typing import Dict, Any

from langchain_core.tools import tool

# 报告存储目录（相对于 backend 根目录）
_REPORTS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "reports"
)


def _ensure_reports_dir() -> str:
    os.makedirs(_REPORTS_DIR, exist_ok=True)
    return os.path.abspath(_REPORTS_DIR)


@tool
def generate_report(
    content: str,
    title: str = "铝合金设计分析报告",
) -> str:
    """
    生成并保存铝合金设计报告，支持前端渲染和浏览器打印导出 PDF。

    **调用时机**：reportWriter 完成全部章节撰写后，将完整 Markdown 作为
    content 参数一次性传入，作为最后一个动作调用本工具。

    **content 格式要求**：
    - 完整的 Markdown 文档，包含所有章节
    - 标题层级：# 顶层，## 章节，### 小节
    - 章节间插入 `---` 分隔线
    - 表格用 Markdown 标准表格格式
    - 不含 HTML 标签，确保跨平台渲染一致

    参数:
        content: 完整的报告 Markdown 内容
        title:   报告标题（用于文件命名，默认为"铝合金设计分析报告"）

    返回:
        JSON 字符串，含 report_type / title / content / saved_at / filename
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = title.replace(" ", "_").replace("/", "-")[:40]
    filename = f"report_{safe_title}_{timestamp}.md"

    # 持久化到本地
    try:
        reports_dir = _ensure_reports_dir()
        filepath = os.path.join(reports_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        saved = True
    except Exception:
        saved = False

    result: Dict[str, Any] = {
        "report_type": "alloy_design_report",
        "title": title,
        "content": content,
        "saved_at": datetime.now().isoformat(),
        "filename": filename if saved else None,
    }
    return json.dumps(result, ensure_ascii=False)
