"""
LangGraph 工作流定义

定义主工作流和分析子图的图结构。
"""

from langgraph.graph import StateGraph, START, END
from langgraph.constants import Send

from .state import OverallState, AlloyState
from .nodes import (
    extract_parameters,
    query_idme,
    recommend_alloys,
    generate_report,
    predict_performance,
    calculate_thermo,
    format_analysis_output,
    interpret_results,
)


# ================================
# 1. 定义分析子图
# ================================
# 该图将为每个合金执行：
# 1. 并行执行 ONNX 性能预测和 Calphad 热力学计算（三种类型）
# 2. 结果解读
# 3. 格式化输出

analysis_builder = StateGraph(AlloyState)

# 添加节点
analysis_builder.add_node("predict_performance", predict_performance)  # ONNX 性能预测
analysis_builder.add_node("calculate_thermo", calculate_thermo)        # Calphad 热力学计算（执行全部三种）
analysis_builder.add_node("interpret_results", interpret_results)      # 结果解读
analysis_builder.add_node("format_output", format_analysis_output)     # 格式化输出

# 定义边
# 流程: START -> 并行(ONNX + Calphad) -> 结果解读 -> 格式化 -> END
analysis_builder.add_edge(START, "predict_performance")
analysis_builder.add_edge(START, "calculate_thermo")

# 两个计算完成后，进行结果解读
analysis_builder.add_edge("predict_performance", "interpret_results")
analysis_builder.add_edge("calculate_thermo", "interpret_results")

# 解读完成后，格式化输出
analysis_builder.add_edge("interpret_results", "format_output")
analysis_builder.add_edge("format_output", END)

# 编译分析子图
analysis_graph = analysis_builder.compile()


# ================================
# 2. 定义主工作流
# ================================

def continue_to_analysis(state: OverallState):
    """
    条件边函数：将推荐的合金映射到分析子图。
    
    使用 LangGraph 的 Send 机制实现 Map-Reduce 模式。
    
    参数:
        state: 全局状态
        
    返回:
        Send 对象列表，每个合金对应一个分析子图实例
    """
    alloys = state.get("recommended_alloys", [])
    # 将每个合金映射到 analysis_subgraph
    # 子图的输入是匹配 AlloyState 的字典
    return [Send("analysis_subgraph", {"composition": alloy}) for alloy in alloys]


workflow_builder = StateGraph(OverallState)

# 添加节点
workflow_builder.add_node("extract_parameters", extract_parameters)
workflow_builder.add_node("query_idme", query_idme)
workflow_builder.add_node("recommend_alloys", recommend_alloys)
workflow_builder.add_node("analysis_subgraph", analysis_graph)
workflow_builder.add_node("generate_report", generate_report)

# 添加边
workflow_builder.add_edge(START, "extract_parameters")
workflow_builder.add_edge("extract_parameters", "query_idme")
workflow_builder.add_edge("query_idme", "recommend_alloys")

# Map-Reduce: 扇出到分析子图
workflow_builder.add_conditional_edges(
    "recommend_alloys", 
    continue_to_analysis, 
    ["analysis_subgraph"]
)

# 扇入: analysis_subgraph 的结果会自动聚合到 OverallState.analysis_results
# 这是因为 OverallState 中使用了 reducer (operator.add)
workflow_builder.add_edge("analysis_subgraph", "generate_report")
workflow_builder.add_edge("generate_report", END)

# 编译主工作流
graph = workflow_builder.compile()
