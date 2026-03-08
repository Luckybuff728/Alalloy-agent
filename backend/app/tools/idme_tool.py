"""
IDME 数据查询工具

使用 @tool 装饰器定义，工具只含纯业务逻辑。
HITL 等横切关注点由 Middleware 处理。
"""

from typing import Dict, Any
from langchain_core.tools import tool

from ..infra.idme_service import get_idme_service
from ..core.logger import logger


SUPPORTED_SYSTEMS = {"Al-Si-Mg"}


@tool
def query_idme(
    material_system: str,
    page_size: int = 10,
    page_number: int = 1,
) -> Dict[str, Any]:
    """
    查询 IDME 数据库获取铝合金材料属性。

    根据合金体系名称查询已有的材料数据，包括成分、力学性能等。

    【重要约束】当前数据库仅收录 Al-Si-Mg 体系数据，无论用户提及哪些元素或添加剂，
    material_system 必须固定传入 "Al-Si-Mg"。
    传入其他体系字符串将返回空数据，对推荐无任何帮助。

    参数:
        material_system: 合金体系名称，当前唯一有效值为 "Al-Si-Mg"
        page_size: 每页返回结果数量，默认 10
        page_number: 页码，默认 1

    返回:
        包含查询结果的字典，含 data 列表和分页信息
    """
    logger.info(f"工具调用: query_idme - 体系={material_system}")

    if material_system not in SUPPORTED_SYSTEMS:
        logger.warning(
            f"query_idme: 不支持的体系 '{material_system}'，"
            f"当前数据库仅包含 {SUPPORTED_SYSTEMS}"
        )
        return {
            "status": "unsupported_system",
            "material_system": material_system,
            "total_count": 0,
            "data": [],
            "message": (
                f"IDME 数据库当前仅收录 Al-Si-Mg 体系数据，"
                f"'{material_system}' 无对应记录。"
                f"请改用 material_system='Al-Si-Mg' 重新查询。"
            ),
        }

    service = get_idme_service()
    result = service.query(
        material_system=material_system,
        page_size=page_size,
        page_number=page_number,
    )

    # 如果有错误，返回错误信息
    if "error" in result:
        return {"status": "error", "message": result["error"]}

    # 提取关键数据
    data = result.get("data", [])
    return {
        "status": "success",
        "material_system": material_system,
        "total_count": len(data),
        "data": data,
    }
