"""
IDME 服务模块

提供华为云 IDME API 的访问功能。
"""

import os
import requests
from typing import Dict, Any
from langchain_core.tools import tool
from dotenv import load_dotenv

from ..core.logger import logger

# 加载环境变量
load_dotenv()


def get_iam_token() -> str:
    """
    从华为云获取 IAM 令牌。
    
    返回:
        str: IAM 认证令牌
        
    异常:
        ValueError: 如果响应头中未找到令牌
        Exception: 如果请求失败
    """
    url = os.getenv(
        "HUAWEI_IAM_URL",
        "https://iam.cn-north-4.myhuaweicloud.com/v3/auth/tokens"
    )
    domain_name = os.getenv("HUAWEI_DOMAIN_NAME", "Topmaterial_Tech")
    user_name = os.getenv("HUAWEI_USER_NAME", "Topmaterial_Tech")
    password = os.getenv("HUAWEI_PASSWORD", "dckj@301")  # 注意：生产环境中请使用安全存储

    headers = {
        "Content-Type": "application/json;charset=utf8"
    }
    payload = {
        "auth": {
            "identity": {
                "methods": ["password"],
                "password": {
                    "user": {
                        "domain": {"name": domain_name},
                        "name": user_name,
                        "password": password
                    }
                }
            },
            "scope": {
                "domain": {"name": domain_name}
            }
        }
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        response.raise_for_status()
        token = response.headers.get("X-Subject-Token")
        if not token:
            raise ValueError("在响应头中未找到 X-Subject-Token")
        return token
    except Exception as e:
        logger.error(f"获取 IAM 令牌时出错: {e}")
        raise


@tool
def query_idme_api(
    material_system: str,
    page_size: int = 10,
    page_number: int = 1
) -> Dict[str, Any]:
    """
    根据材料体系查询 IDME API 获取合金属性。
    
    参数:
        material_system: 要查询的材料体系 (例如: 'Al-Si-Mg')
        page_size: 每页结果数量
        page_number: 页码
        
    返回:
        Dict[str, Any]: API 响应结果
    """
    try:
        token = get_iam_token()
        url = os.getenv(
            "IDME_API_URL",
            "https://idme.cn-southwest-2.huaweicloud.com/linkx-f-scriptengine/"
            "linkx_se/services/ScriptEngine/v1/api/external/Composition2property?envType=Pro"
        )
        tenant_id = os.getenv("IDME_TENANT_ID", "44")
        
        headers = {
            "tenantId": tenant_id,
            "Iam-X-Auth-Token": token
        }
        payload = {
            "Composition_MaterialSystem": material_system,
            "Composition_ID": "",
            "Composition_Name": "",
            "pageSize": page_size,
            "pageNumber": page_number,
            "returnTotalCountFlag": False
        }
        
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        logger.error(f"查询 IDME API 时出错: {e}")
        return {"error": str(e)}
