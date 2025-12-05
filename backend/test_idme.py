"""
IDME API 单独测试脚本

测试 IDME API 连接和查询功能。
"""

import os
import requests
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

def get_iam_token() -> str:
    """获取华为云 IAM 令牌"""
    url = os.getenv(
        "HUAWEI_IAM_URL",
        "https://iam.cn-north-4.myhuaweicloud.com/v3/auth/tokens"
    )
    domain_name = os.getenv("HUAWEI_DOMAIN_NAME", "Topmaterial_Tech")
    user_name = os.getenv("HUAWEI_USER_NAME", "Topmaterial_Tech")
    password = os.getenv("HUAWEI_PASSWORD", "dckj@301")

    print(f"[IAM] 请求 URL: {url}")
    print(f"[IAM] 用户: {user_name}, 域: {domain_name}")

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

    response = requests.post(url, headers=headers, json=payload, timeout=10)
    print(f"[IAM] 响应状态: {response.status_code}")
    
    if response.status_code != 201:
        print(f"[IAM] 错误响应: {response.text}")
        raise Exception(f"IAM 认证失败: {response.status_code}")
    
    token = response.headers.get("X-Subject-Token")
    if not token:
        raise ValueError("未找到 X-Subject-Token")
    
    print(f"[IAM] ✓ 获取令牌成功 (前50字符): {token[:50]}...")
    return token


def query_idme(material_system: str):
    """查询 IDME API"""
    token = get_iam_token()
    
    url = os.getenv(
        "IDME_API_URL",
        "https://idme.cn-southwest-2.huaweicloud.com/linkx-f-scriptengine/"
        "linkx_se/services/ScriptEngine/v1/api/external/Composition2property?envType=Pro"
    )
    tenant_id = os.getenv("IDME_TENANT_ID", "44")
    
    print(f"\n[IDME] 请求 URL: {url}")
    print(f"[IDME] Tenant ID: {tenant_id}")
    print(f"[IDME] 查询体系: {material_system}")
    
    headers = {
        "tenantId": tenant_id,
        "Iam-X-Auth-Token": token,
        "Content-Type": "application/json"
    }
    
    # 测试不同的请求格式
    payloads = [
        # 格式1: 原始格式
        {
            "Composition_MaterialSystem": material_system,
            "Composition_ID": "",
            "Composition_Name": "",
            "pageSize": 10,
            "pageNumber": 1,
            "returnTotalCountFlag": False
        },
        # 格式2: 简化格式
        {
            "Composition_MaterialSystem": material_system
        },
        # 格式3: 不同体系格式
        {
            "Composition_MaterialSystem": "Al-Si",
            "pageSize": 10,
            "pageNumber": 1
        }
    ]
    
    for i, payload in enumerate(payloads, 1):
        print(f"\n--- 测试格式 {i} ---")
        print(f"请求体: {payload}")
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            print(f"响应状态: {response.status_code}")
            
            result = response.json()
            print(f"响应内容: {result}")
            
            # 检查是否有数据
            if isinstance(result, dict):
                if "data" in result:
                    data = result["data"]
                    if isinstance(data, list):
                        print(f"数据条数: {len(data)}")
                        if len(data) > 0:
                            print(f"第一条数据: {data[0]}")
                            return result  # 找到有效数据
        except Exception as e:
            print(f"请求失败: {e}")
    
    return None


if __name__ == "__main__":
    print("=" * 60)
    print("IDME API 测试")
    print("=" * 60)
    
    # 测试不同的材料体系
    systems = ["Al-Si", "Al-Si-Mg", "AlSiMg", "Al"]
    
    for system in systems:
        print(f"\n{'='*60}")
        print(f"测试材料体系: {system}")
        print("=" * 60)
        
        try:
            result = query_idme(system)
            data = result.get("data", []) if result else []
            print(f"数据条数: {len(data)}")
            if data:
                print(f"✓ 成功获取 {system} 的数据")
            else:
                print(f"✗ {system} 无数据")
        except Exception as e:
            print(f"✗ 测试 {system} 失败: {e}")
