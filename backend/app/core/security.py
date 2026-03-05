"""
JWT 认证与安全核心模块 (FerrisKey OIDC 版本)

支持两种认证方式：
1. FerrisKey OIDC Token 验证（生产环境主要方式）—— 使用 JWKS 公钥本地验证
2. DEV_MODE 测试 Token 验证（开发环境）—— 使用本地对称密钥签发和验证

提供 OIDC state 生成和验证功能，实现无状态的 CSRF 防护。
"""
import os
import time
from typing import Optional, Dict, Any

import httpx
import jwt
from jwt import PyJWK
from jwt.exceptions import PyJWTError
from loguru import logger

# ==================== 配置常量 ====================

# 核心模式
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

# DEV_MODE 测试用户配置
DEV_USER_ID = os.getenv("DEV_USER_ID", "dev-user-0001")
DEV_USER_EMAIL = os.getenv("DEV_USER_EMAIL", "dev@topmaterial-tech.com")
DEV_USER_NAME = os.getenv("DEV_USER_NAME", "开发测试用户")

# 本地签名密钥 (用于 DEV_MODE Token 和 OIDC State 签名)
DEV_JWT_SECRET = os.getenv("DEV_JWT_SECRET", "alalloy-dev-secret-do-not-use-in-prod")
DEV_ALGORITHM = "HS256"

# FerrisKey 配置
FERRISKEY_URL = os.getenv("FERRISKEY_URL", "https://ferriskey-api.topmatdev.com")
FERRISKEY_REALM = os.getenv("FERRISKEY_REALM", "dev")
FERRISKEY_CLIENT_ID = os.getenv("FERRISKEY_CLIENT_ID", "alalloy-agent")
FERRISKEY_CLIENT_SECRET = os.getenv("FERRISKEY_CLIENT_SECRET", "")
VERIFY_SSL = os.getenv("VERIFY_SSL", "true").lower() == "true"


# ==================== URL 构造 ====================

def get_ferriskey_base_url() -> str:
    return f"{FERRISKEY_URL}/realms/{FERRISKEY_REALM}/protocol/openid-connect"

def get_ferriskey_auth_url() -> str:
    return f"{get_ferriskey_base_url()}/auth"

def get_ferriskey_token_url() -> str:
    return f"{get_ferriskey_base_url()}/token"

def get_ferriskey_logout_url() -> str:
    return f"{get_ferriskey_base_url()}/logout"

def get_ferriskey_jwks_url() -> str:
    return f"{get_ferriskey_base_url()}/certs"


# ==================== JWKS 缓存 ====================

_jwks_cache: Optional[Dict[str, Any]] = None
_jwks_cache_time: float = 0
_JWKS_CACHE_TTL = 3600  # 1小时

async def _get_jwks() -> Optional[Dict[str, Any]]:
    global _jwks_cache, _jwks_cache_time
    now = time.time()

    if _jwks_cache and (now - _jwks_cache_time < _JWKS_CACHE_TTL):
        return _jwks_cache

    jwks_url = get_ferriskey_jwks_url()
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=VERIFY_SSL) as client:
            response = await client.get(jwks_url)
            if response.status_code == 200:
                _jwks_cache = response.json()
                _jwks_cache_time = now
                logger.info(f"✅ JWKS 公钥已刷新 (来源: {jwks_url})")
                return _jwks_cache
            else:
                logger.warning(f"❌ JWKS 拉取失败: HTTP {response.status_code}")
    except httpx.RequestError as e:
        logger.error(f"❌ JWKS 请求异常: {e}")

    if _jwks_cache:
        logger.warning("⚠️ 使用过期的 JWKS 缓存")
        return _jwks_cache

    return None

def _find_signing_key(jwks: Dict[str, Any], token: str) -> Optional[dict]:
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")

        if not kid:
            keys = jwks.get("keys", [])
            if keys:
                return keys[0]
            return None

        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                return key

        return None
    except Exception as e:
        logger.error(f"解析 Token Header 失败: {e}")
        return None


# ==================== Token 验证与签发 ====================

async def decode_ferriskey_token(token: str) -> Optional[dict]:
    jwks = await _get_jwks()
    if not jwks:
        return None

    signing_key_dict = _find_signing_key(jwks, token)
    if not signing_key_dict:
        return None

    try:
        # 将 JWKS dict 转换为 RSA 公钥对象
        signing_key = PyJWK.from_dict(signing_key_dict).key
        
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            options={
                "verify_aud": False,
                "verify_iss": False,
            },
            # 允许 60 秒的时钟偏差，解决服务器时钟不同步问题
            leeway=60
        )
        payload["_auth_source"] = "ferriskey"
        logger.debug(f"✅ FerrisKey Token 验证成功: sub={payload.get('sub')}, user={payload.get('preferred_username', 'N/A')}")
        return payload
    except PyJWTError as e:
        logger.warning(f"❌ FerrisKey Token 验证失败: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ FerrisKey Token 解析异常: {e}")
        return None

def create_dev_token(expires_hours: int = 24) -> str:
    """仅在 DEV_MODE 下签发本地测试 Token"""
    payload = {
        "sub": DEV_USER_ID,
        "email": DEV_USER_EMAIL,
        "preferred_username": DEV_USER_NAME,
        "name": DEV_USER_NAME,
        "role": "admin",
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_hours * 3600,
        "_auth_source": "dev_mode",
    }
    return jwt.encode(payload, DEV_JWT_SECRET, algorithm=DEV_ALGORITHM)

def decode_dev_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token,
            DEV_JWT_SECRET,
            algorithms=[DEV_ALGORITHM],
            options={"verify_aud": False, "verify_iss": False}
        )
        if payload.get("_auth_source") == "dev_mode":
            return payload
        return None
    except PyJWTError:
        return None

async def decode_token(token: str) -> Optional[dict]:
    """
    统一 Token 验证入口
    """
    if DEV_MODE:
        dev_payload = decode_dev_token(token)
        if dev_payload:
            return dev_payload

    payload = await decode_ferriskey_token(token)
    if payload:
        return payload

    logger.warning("❌ 所有 Token 验证方式均失败")
    return None

def decode_token_sync(token: str) -> Optional[dict]:
    """同步验证入口 (用于 WebSocket 连接等非异步上下文)，在没有缓存的情况下可能失败，建议 WebSocket 阶段仅依靠传递的有效性或预先验证"""
    if DEV_MODE:
        return decode_dev_token(token)
    
    # 注意：同步无法 await _get_jwks()，需要依赖外部确保或者退回到简单解析，这里仅为了兼容
    # 实际上 WebSocket 鉴权最好在升级前完成，或者依赖缓存
    global _jwks_cache
    if not _jwks_cache:
        return None
        
    signing_key_dict = _find_signing_key(_jwks_cache, token)
    if not signing_key_dict:
        return None
        
    try:
        # 将 JWKS dict 转换为 RSA 公钥对象（与 decode_ferriskey_token 保持一致）
        signing_key = PyJWK.from_dict(signing_key_dict).key
        
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_iss": False},
            # 允许 60 秒的时钟偏差，解决服务器时钟不同步问题
            leeway=60
        )
        payload["_auth_source"] = "ferriskey"
        return payload
    except Exception:
        return None


# ==================== OIDC State (无状态 CSRF 防护) ====================

def generate_state_token(return_to: str = "", expires_minutes: int = 10) -> str:
    """生成一个包含有效期的签名的 state"""
    payload = {
        "return_to": return_to,
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_minutes * 60,
        "type": "oidc_state"
    }
    return jwt.encode(payload, DEV_JWT_SECRET, algorithm=DEV_ALGORITHM)

def verify_state_token(state: str) -> Optional[dict]:
    """验证 state 的有效性"""
    try:
        payload = jwt.decode(
            state,
            DEV_JWT_SECRET,
            algorithms=[DEV_ALGORITHM]
        )
        if payload.get("type") == "oidc_state":
            return payload
        return None
    except PyJWTError:
        return None

# ==================== Token 交换与刷新 ====================

async def exchange_code_for_tokens(code: str, redirect_uri: str) -> Optional[Dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=VERIFY_SSL) as client:
            response = await client.post(
                get_ferriskey_token_url(),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": FERRISKEY_CLIENT_ID,
                    "client_secret": FERRISKEY_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"❌ 授权码交换失败: {response.text}")
                return None
    except Exception as e:
        logger.error(f"❌ 授权码交换异常: {e}")
        return None

async def refresh_access_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=VERIFY_SSL) as client:
            response = await client.post(
                get_ferriskey_token_url(),
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": FERRISKEY_CLIENT_ID,
                    "client_secret": FERRISKEY_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if response.status_code == 200:
                return response.json()
            return None
    except Exception as e:
        logger.error(f"❌ Token 刷新异常: {e}")
        return None
