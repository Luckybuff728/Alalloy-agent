"""
LangGraph 状态定义

定义工作流的全局状态和子图状态。
"""

from typing import List, Dict, Any, Optional, TypedDict, Annotated
from langchain_core.messages import BaseMessage
import operator


class OverallState(TypedDict):
    """
    IDME 工作流的全局状态。
    
    包含整个工作流执行过程中需要的所有数据。
    """
    # 聊天历史
    messages: Annotated[List[BaseMessage], operator.add]
    
    # 提取的参数
    system: Optional[str]  # 合金体系
    performance_requirements: Optional[str]  # 性能要求
    
    # IDME API 查询结果
    idme_results: Optional[List[Dict[str, Any]]]
    
    # 推荐用于分析的合金列表
    # 合金成分列表 (字符串)
    recommended_alloys: Optional[List[str]]
    
    # 子图的分析结果
    # 从并行执行中聚合
    analysis_results: Annotated[List[Dict[str, Any]], operator.add]
    
    # 最终报告内容
    final_report: Optional[str]


class AlloyState(TypedDict):
    """
    单个合金在并行分析阶段的状态。
    
    用于分析子图处理单个合金的计算任务。
    """
    # 成分字符串 (例如: "Al-7Si-0.3Mg")
    composition: str
    
    # 计算类型 (point/line/scheil)，默认 scheil
    calculation_type: Optional[str]
    
    # ONNX 预测结果
    onnx_result: Optional[Dict[str, Any]]
    
    # Calphad 计算结果
    calphad_result: Optional[Dict[str, Any]]
    
    # 结果解读
    interpretation: Optional[str]
    
    # 格式化后的结果，用于合并回 OverallState
    analysis_results: Optional[List[Dict[str, Any]]]
