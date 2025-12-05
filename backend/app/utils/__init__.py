"""
工具函数模块

包含成分解析、单位转换等通用工具函数。
"""

from .composition import (
    parse_composition_string,
    mass_to_atomic_fraction,
    format_onnx_inputs,
    ATOMIC_MASS,
    ONNX_REQUIRED_ELEMENTS,
)

__all__ = [
    "parse_composition_string",
    "mass_to_atomic_fraction",
    "format_onnx_inputs",
    "ATOMIC_MASS",
    "ONNX_REQUIRED_ELEMENTS",
]
