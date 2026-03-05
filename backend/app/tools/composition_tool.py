"""
成分解析工具

提供合金成分字符串的解析和标准化功能。
输出质量分数、原子分数和 ONNX 输入格式，
供 LLM 调用 MCP 工具（ONNX/Calphad）时使用。
"""

from typing import Dict, Any
from langchain_core.tools import tool

from ..utils.composition import parse_composition_string, format_onnx_inputs, mass_to_atomic_fraction
from ..core.logger import logger


@tool
def parse_composition(composition: str) -> Dict[str, Any]:
    """
    解析合金成分字符串为标准化格式。

    支持多种输入格式，输出质量分数、原子分数和 ONNX 输入格式。
    解析结果可直接用于调用 ONNX 性能预测和 Calphad 热力学计算工具。

    参数:
        composition: 合金成分字符串（如 'Al-7Si-0.3Mg'）

    返回:
        包含以下字段的字典:
        - mass_fractions: 质量分数（如 {"Al": 92.7, "Si": 7.0, "Mg": 0.3}）
        - atomic_fractions: 原子分数（供 Calphad 计算使用）
        - onnx_inputs: ONNX 模型输入格式（15 元素标准化）
        - components: 组元列表（供 Calphad 计算使用）
    """
    logger.info(f"工具调用: parse_composition - {composition}")

    try:
        mass_fractions = parse_composition_string(composition)
        onnx_inputs = format_onnx_inputs(mass_fractions)
        atomic_fractions = mass_to_atomic_fraction(mass_fractions)

        return {
            "status": "success",
            "composition": composition,
            "mass_fractions": mass_fractions,
            "atomic_fractions": atomic_fractions,
            "components": list(atomic_fractions.keys()),
            "onnx_inputs": onnx_inputs,
        }
    except Exception as e:
        return {"status": "error", "message": f"成分解析失败: {e}"}
