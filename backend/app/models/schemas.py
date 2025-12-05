"""
Pydantic 结构化输出模型

用于 LLM 的结构化输出定义。
"""

from typing import Dict, List, Optional
from pydantic import AliasChoices, BaseModel, Field


class AlloyComposition(BaseModel):
    """合金成分结构化输出"""
    system: str = Field(description="合金体系，如 'Al-Si-Mg'")
    elements: Dict[str, float] = Field(
        description="元素质量分数，如 {'Al': 92.7, 'Si': 7.0, 'Mg': 0.3}"
    )


class PerformanceRequirements(BaseModel):
    """性能需求结构化输出"""
    target_property: str = Field(
        description="目标性能，如 '屈服强度', '抗拉强度', '硬度', '延伸率'"
    )
    min_value: Optional[float] = Field(default=None, description="最小值要求")
    unit: Optional[str] = Field(default="MPa", description="单位")


class ExtractedParameters(BaseModel):
    """从用户输入提取的参数"""
    system: str = Field(description="合金体系，如 'Al-Si' 或 'Al-Si-Mg'")
    performance_requirements: str = Field(description="性能要求描述")


class CalculationType(BaseModel):
    """
    热力学计算类型判断结果。
    
    使用 LangChain 的 with_structured_output 功能。
    """
    calculation_type: str = Field(
        default="scheil",  # 添加默认值，防止字段缺失导致验证失败
        description="计算类型：'point'(点计算), 'line'(线计算), 或 'scheil'(希尔凝固计算)",
        validation_alias=AliasChoices(
            "calculation_type",
            "recommended_calculation_type", 
            "calc_type",
            "type"
        )  # 接受 LLM 可能使用的多种别名
    )
    reason: str = Field(
        default="默认使用 scheil 计算",  # 设为可选，避免验证失败
        description="选择该计算类型的原因"
    )


class AnalysisInterpretation(BaseModel):
    """分析结果解读"""
    summary: str = Field(description="结果摘要")
    key_findings: List[str] = Field(description="关键发现列表")
    recommendations: str = Field(description="建议")
