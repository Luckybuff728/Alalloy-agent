"""
Tool 层（简化版）

本地工具使用 LangChain @tool 装饰器定义。
MCP 工具（ONNX/Calphad）在运行时动态获取。

本地工具:
- query_idme:           IDME 数据查询（REST API）
- show_guidance_widget: 显示引导挂件（人机协同）
- generate_report:      生成并保存最终报告（返回结构化 JSON，前端渲染为 PDF 可打印视图）

注意：成分解析由 LLM 直接完成，无需专门工具。
LLM 可根据 onnx_get_model_config 返回的参数格式自行构建输入。
"""

from .idme_tool import query_idme
from .guidance_tool import show_guidance_widget
from .report_tool import generate_report

# 本地工具按角色分组（MCP 工具在 builder.py 中动态注入）
DATA_EXPERT_TOOLS = [query_idme, show_guidance_widget]
ANALYST_TOOLS = [show_guidance_widget]          # MCP 工具在运行时追加
REPORT_WRITER_TOOLS = [generate_report]         # reportWriter 专属工具
