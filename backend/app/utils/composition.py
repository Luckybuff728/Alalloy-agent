"""
成分解析和转换工具

提供合金成分字符串解析、质量分数/原子分数转换等功能。
"""

import re
from typing import Dict

from ..core.logger import logger


# 元素原子质量 (用于原子分数转换)
ATOMIC_MASS: Dict[str, float] = {
    "Al": 26.98, "Si": 28.09, "Mg": 24.31, "Cu": 63.55,
    "Zn": 65.38, "Fe": 55.85, "Mn": 54.94, "Ti": 47.87,
    "Cr": 52.00, "Ni": 58.69, "Sn": 118.71, "Pb": 207.2,
    "Sr": 87.62, "Ce": 140.12, "Zr": 91.22, "Mo": 95.94,
    "La": 138.91
}

# ONNX 模型必需的 15 个输入元素 (不包括 Al，Al 是余量)
ONNX_REQUIRED_ELEMENTS = [
    "Si", "Mg", "Fe", "Cu", "Zn", "Mn", "Ti", "Sr",
    "Ce", "Ni", "Cr", "Sn", "Zr", "Mo", "La"
]


def parse_composition_string(comp_str: str) -> Dict[str, float]:
    """
    将合金成分字符串解析为质量分数字典。
    
    示例:
        "Al-7Si-0.3Mg" -> {"Al": 92.7, "Si": 7.0, "Mg": 0.3}
    
    参数:
        comp_str: 合金成分字符串，如 "Al-7Si-0.3Mg"
        
    返回:
        质量分数字典 (%)
    """
    mass_fractions: Dict[str, float] = {}
    parts = comp_str.replace('-', ' ').split()
    
    for part in parts:
        # 匹配 "7Si" 或 "Si7" 或 "Al"
        match1 = re.match(r'^(\d*\.?\d*)([A-Z][a-z]?)$', part)  # "7Si"
        match2 = re.match(r'^([A-Z][a-z]?)(\d*\.?\d*)$', part)  # "Si7" 或 "Al"
        
        if match1 and match1.group(2):
            num = float(match1.group(1)) if match1.group(1) else 0
            elem = match1.group(2)
        elif match2:
            elem = match2.group(1)
            num = float(match2.group(2)) if match2.group(2) else 0
        else:
            continue
            
        if elem in ATOMIC_MASS:
            mass_fractions[elem] = num
    
    # 如果 Al 没有指定数值，计算余量
    if "Al" in mass_fractions and mass_fractions["Al"] == 0:
        other_sum = sum(v for k, v in mass_fractions.items() if k != "Al")
        mass_fractions["Al"] = 100 - other_sum
    
    logger.debug(f"成分解析(质量%): {comp_str} -> {mass_fractions}")
    return mass_fractions


def mass_to_atomic_fraction(mass_fractions: Dict[str, float]) -> Dict[str, float]:
    """
    将质量分数转换为原子分数。
    
    **重要**: Calphad 服务端要求原子分数之和严格等于 1.0，否则任务会失败。
    
    参数:
        mass_fractions: 质量分数字典，如 {"Al": 92.7, "Si": 7.0, "Mg": 0.3}
        
    返回:
        原子分数字典，和严格为 1.0
    """
    # 归一化质量分数
    total = sum(mass_fractions.values())
    if total == 0:
        return {"AL": 1.0}
    
    normalized = {k: v / total for k, v in mass_fractions.items()}
    
    # 计算摩尔数
    moles: Dict[str, float] = {}
    for elem, mass_frac in normalized.items():
        if elem in ATOMIC_MASS:
            moles[elem] = mass_frac / ATOMIC_MASS[elem]
    
    # 转换为原子分数（先计算未归一化的值）
    total_moles = sum(moles.values())
    if total_moles == 0:
        return {"AL": 1.0}
    
    raw_fractions = {
        elem.upper(): mol / total_moles 
        for elem, mol in moles.items()
    }
    
    # 严格归一化：确保和精确等于 1.0
    # 步骤1: 四舍五入到6位小数
    rounded = {k: round(v, 6) for k, v in raw_fractions.items()}
    
    # 步骤2: 计算归一化误差，调整最大分量（通常是 AL）
    current_sum = sum(rounded.values())
    diff = 1.0 - current_sum
    
    if abs(diff) > 1e-9:  # 存在误差需要调整
        # 找到最大分量进行调整（避免小分量变负）
        max_elem = max(rounded, key=rounded.get)
        rounded[max_elem] = round(rounded[max_elem] + diff, 6)
    
    # 验证最终和
    final_sum = sum(rounded.values())
    logger.debug(f"原子分数转换: {mass_fractions} -> {rounded}, 和={final_sum}")
    
    return rounded


def format_onnx_inputs(mass_fractions: Dict[str, float]) -> Dict[str, float]:
    """
    将质量分数转换为 ONNX 模型输入格式。
    
    AlSiMg_properties_v1 模型需要 15 个必需输入（质量百分比）:
    W(Si), W(Mg), W(Fe), W(Cu), W(Zn), W(Mn), W(Ti), W(Sr),
    W(Ce), W(Ni), W(Cr), W(Sn), W(Zr), W(Mo), W(La)
    
    缺失的元素自动设为 0。
    
    参数:
        mass_fractions: 质量分数字典，如 {"Al": 92.7, "Si": 7.0, "Mg": 0.3}
        
    返回:
        ONNX 输入格式，包含所有 15 个必需输入
    """
    inputs: Dict[str, float] = {}
    for elem in ONNX_REQUIRED_ELEMENTS:
        # 从 mass_fractions 获取值，如果没有则设为 0
        value = mass_fractions.get(elem, 0.0)
        inputs[f"W({elem})"] = value
    
    logger.debug(f"ONNX 输入格式 (15个元素): {inputs}")
    return inputs
