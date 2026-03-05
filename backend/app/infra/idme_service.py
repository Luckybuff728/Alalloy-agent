"""
IDME 服务模块

封装华为云 IDME API 的访问功能。
提供 IAM 认证和材料数据查询。
"""

import os
from typing import Dict, Any, Optional

import requests
from dotenv import load_dotenv

from ..core.logger import logger

# 加载环境变量
load_dotenv()


class IdmeService:
    """
    IDME API 服务

    封装华为云 IDME 平台的材料数据查询接口。
    包含 IAM 认证令牌的获取和缓存。
    """

    def __init__(self):
        """初始化 IDME 服务配置"""
        self.iam_url = os.getenv(
            "HUAWEI_IAM_URL",
            "https://iam.cn-north-4.myhuaweicloud.com/v3/auth/tokens",
        )
        self.domain_name = os.getenv("HUAWEI_DOMAIN_NAME", "Topmaterial_Tech")
        self.user_name = os.getenv("HUAWEI_USER_NAME", "Topmaterial_Tech")
        self.password = os.getenv("HUAWEI_PASSWORD", "")
        self.api_url = os.getenv(
            "IDME_API_URL",
            "https://idme.cn-southwest-2.huaweicloud.com/linkx-f-scriptengine/"
            "linkx_se/services/ScriptEngine/v1/api/external/"
            "Composition2property?envType=Pro",
        )
        self.tenant_id = os.getenv("IDME_TENANT_ID", "44")

        # IAM Token 缓存
        self._token: Optional[str] = None

    def _get_iam_token(self) -> str:
        """
        从华为云获取 IAM 认证令牌

        返回:
            IAM Token 字符串

        异常:
            ValueError: 如果响应头中未找到令牌
            Exception: 如果请求失败
        """
        headers = {"Content-Type": "application/json;charset=utf8"}
        payload = {
            "auth": {
                "identity": {
                    "methods": ["password"],
                    "password": {
                        "user": {
                            "domain": {"name": self.domain_name},
                            "name": self.user_name,
                            "password": self.password,
                        }
                    },
                },
                "scope": {"domain": {"name": self.domain_name}},
            }
        }

        response = requests.post(
            self.iam_url, headers=headers, json=payload, timeout=10
        )
        response.raise_for_status()

        token = response.headers.get("X-Subject-Token")
        if not token:
            raise ValueError("在响应头中未找到 X-Subject-Token")

        self._token = token
        logger.debug("IDME: IAM Token 获取成功")
        return token

    def query(
        self,
        material_system: str,
        page_size: int = 10,
        page_number: int = 1,
    ) -> Dict[str, Any]:
        """
        查询 IDME 数据库获取合金属性

        参数:
            material_system: 材料体系（如 'Al-Si-Mg'）
            page_size: 每页结果数量
            page_number: 页码

        返回:
            API 响应结果字典
        """
        try:
            # 获取或刷新 Token
            token = self._get_iam_token()

            headers = {
                "tenantId": self.tenant_id,
                "Iam-X-Auth-Token": token,
            }
            payload = {
                "Composition_MaterialSystem": material_system,
                "Composition_ID": "",
                "Composition_Name": "",
                "pageSize": page_size,
                "pageNumber": page_number,
                "returnTotalCountFlag": False,
            }

            response = requests.post(
                self.api_url, headers=headers, json=payload, timeout=30
            )
            response.raise_for_status()

            result = response.json()
            logger.info(
                f"IDME 查询成功: {material_system}, "
                f"返回 {len(result.get('data', []))} 条记录"
            )
            return result

        except Exception as e:
            logger.error(f"IDME 查询失败: {e}")
            return {"error": str(e)}


# 单例实例
_idme_service: Optional[IdmeService] = None


def get_idme_service() -> IdmeService:
    """
    获取 IDME 服务单例

    返回:
        IdmeService 实例
    """
    global _idme_service
    if _idme_service is None:
        _idme_service = IdmeService()
    return _idme_service
