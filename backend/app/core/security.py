"""
JWT 认证与安全核心模块 (Multi-Auth v2)

支持三种认证方式（按验证优先级排列）：
1. DEV_MODE 测试 Token —— HS256 + DEV_JWT_SECRET（仅开发环境）
2. Supabase Auth Token —— ES256 + Supabase JWKS（生产环境，甲方交付）
   ★ Supabase 用户 access_token 使用 ES256 签名，需要拉取 JWKS 公钥验签
   ★ 旧版 Supabase / Service Token 使用 HS256 + SUPABASE_JWT_SECRET，作为兼容保留
3. FerrisKey OIDC Token —— RS256 + FerrisKey JWKS（生产环境，公司内部）

两个入口：
  decode_token()      异步入口，供 REST API 路由使用（可按需拉取 JWKS）
  decode_token_sync() 同步入口，供 WebSocket 连接鉴权使用（仅依赖已缓存 JWKS）
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

DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

DEV_USER_ID = os.getenv("DEV_USER_ID", "dev-user-0001")
DEV_USER_EMAIL = os.getenv("DEV_USER_EMAIL", "dev@topmaterial-tech.com")
DEV_USER_NAME = os.getenv("DEV_USER_NAME", "开发测试用户")

DEV_JWT_SECRET = os.getenv("DEV_JWT_SECRET", "alalloy-dev-secret-do-not-use-in-prod")
DEV_ALGORITHM = "HS256"

FERRISKEY_URL = os.getenv("FERRISKEY_URL", "https://ferriskey-api.topmatdev.com")
FERRISKEY_REALM = os.getenv("FERRISKEY_REALM", "dev")
FERRISKEY_CLIENT_ID = os.getenv("FERRISKEY_CLIENT_ID", "alalloy-agent")
FERRISKEY_CLIENT_SECRET = os.getenv("FERRISKEY_CLIENT_SECRET", "")
VERIFY_SSL = os.getenv("VERIFY_SSL", "true").lower() == "true"

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_AUTH_ENABLED = os.getenv("SUPABASE_AUTH_ENABLED", "true").lower() == "true"


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

def get_supabase_jwks_url() -> str:
    return f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"


# ==================== JWKS 缓存（FerrisKey） ====================

_ferriskey_jwks_cache: Optional[Dict[str, Any]] = None
_ferriskey_jwks_cache_time: float = 0
_JWKS_CACHE_TTL = 3600

async def _get_ferriskey_jwks() -> Optional[Dict[str, Any]]:
    global _ferriskey_jwks_cache, _ferriskey_jwks_cache_time
    now = time.time()

    if _ferriskey_jwks_cache and (now - _ferriskey_jwks_cache_time < _JWKS_CACHE_TTL):
        return _ferriskey_jwks_cache

    jwks_url = get_ferriskey_jwks_url()
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=VERIFY_SSL) as client:
            response = await client.get(jwks_url)
            if response.status_code == 200:
                _ferriskey_jwks_cache = response.json()
                _ferriskey_jwks_cache_time = now
                logger.info(f"✅ FerrisKey JWKS 公钥已刷新 (来源: {jwks_url})")
                return _ferriskey_jwks_cache
            else:
                logger.warning(f"❌ FerrisKey JWKS 拉取失败: HTTP {response.status_code}")
    except httpx.RequestError as e:
        logger.error(f"❌ FerrisKey JWKS 请求异常: {e}")

    if _ferriskey_jwks_cache:
        logger.warning("⚠️ 使用过期的 FerrisKey JWKS 缓存")
        return _ferriskey_jwks_cache

    return None

# 向后兼容：main.py 中 import _get_jwks
_get_jwks = _get_ferriskey_jwks
_jwks_cache = None  # alias — decode_token_sync 内部直接读 _ferriskey_jwks_cache


# ==================== JWKS 缓存（Supabase） ====================

_supabase_jwks_cache: Optional[Dict[str, Any]] = None
_supabase_jwks_cache_time: float = 0

async def _get_supabase_jwks() -> Optional[Dict[str, Any]]:
    """拉取 Supabase Auth 的 JWKS 公钥（ES256 用户 Token 验签用）"""
    global _supabase_jwks_cache, _supabase_jwks_cache_time
    now = time.time()

    if _supabase_jwks_cache and (now - _supabase_jwks_cache_time < _JWKS_CACHE_TTL):
        return _supabase_jwks_cache

    if not SUPABASE_URL:
        return None

    jwks_url = get_supabase_jwks_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(jwks_url)
            if response.status_code == 200:
                _supabase_jwks_cache = response.json()
                _supabase_jwks_cache_time = now
                keys = _supabase_jwks_cache.get("keys", [])
                algs = [k.get("kty", "?") for k in keys]
                logger.info(f"✅ Supabase JWKS 公钥已刷新: {len(keys)} 个密钥, 类型={algs}")
                return _supabase_jwks_cache
            else:
                logger.warning(f"❌ Supabase JWKS 拉取失败: HTTP {response.status_code}")
    except Exception as e:
        logger.error(f"❌ Supabase JWKS 请求异常: {e}")

    if _supabase_jwks_cache:
        logger.warning("⚠️ 使用过期的 Supabase JWKS 缓存")
        return _supabase_jwks_cache

    return None


# ==================== 通用 JWKS 工具 ====================

def _find_signing_key_by_kid(jwks: Dict[str, Any], kid: str) -> Optional[dict]:
    """从 JWKS 中按 kid 查找签名密钥"""
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def _find_signing_key_for_token(jwks: Dict[str, Any], token: str) -> Optional[dict]:
    """从 JWKS 中为 token 找到匹配的签名密钥"""
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")

        if kid:
            return _find_signing_key_by_kid(jwks, kid)

        keys = jwks.get("keys", [])
        return keys[0] if keys else None
    except Exception as e:
        logger.error(f"解析 Token Header 失败: {e}")
        return None


# ==================== Token 验证与签发 ====================

def _peek_token_alg(token: str) -> str:
    """快速读取 token header 的 alg 字段（不做签名验证）"""
    try:
        return jwt.get_unverified_header(token).get("alg", "")
    except Exception:
        return ""


def _is_supabase_claims(payload: dict) -> bool:
    """通过 claims 判断是否为 Supabase 颁发的 token"""
    iss = payload.get("iss", "")
    aud = payload.get("aud", "")
    return "supabase" in iss and aud == "authenticated"


def decode_supabase_token(token: str) -> Optional[dict]:
    """
    验证 Supabase Auth 颁发的 JWT（同步，依赖已缓存的 JWKS）。

    Supabase 用户 access_token 使用 ES256 + kid 签名（2025 年后默认行为）。
    旧版或 service token 可能使用 HS256 + SUPABASE_JWT_SECRET，作为兼容保留。

    识别策略：
    1. 读 header.alg → 确定验签方式
    2. ES256 + kid → 从 _supabase_jwks_cache 中找公钥验签
    3. HS256 → 用 SUPABASE_JWT_SECRET 验签
    4. 验签后检查 iss 含 "supabase" 且 aud == "authenticated"
    """
    if not SUPABASE_AUTH_ENABLED:
        return None

    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "")
        kid = header.get("kid")

        payload = None

        if alg == "ES256" and kid:
            if not _supabase_jwks_cache:
                logger.debug("Supabase JWKS 缓存未建立，ES256 Token 无法验证")
                return None

            key_dict = _find_signing_key_by_kid(_supabase_jwks_cache, kid)
            if not key_dict:
                logger.debug(f"Supabase JWKS 中未找到 kid={kid}")
                return None

            signing_key = PyJWK.from_dict(key_dict).key
            payload = jwt.decode(
                token, signing_key,
                algorithms=["ES256"],
                options={"verify_aud": False, "verify_iss": False},
                leeway=60
            )

        elif alg == "HS256" and SUPABASE_JWT_SECRET:
            payload = jwt.decode(
                token, SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False, "verify_iss": False}
            )
        else:
            return None

        if not _is_supabase_claims(payload):
            return None

        payload["_auth_source"] = "supabase"
        logger.debug(f"✅ Supabase Token 验证成功 ({alg}): sub={payload.get('sub')}, email={payload.get('email', 'N/A')}")
        return payload

    except PyJWTError as e:
        logger.debug(f"Supabase Token 验证未通过: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Supabase Token 解析异常: {e}")
        return None


async def decode_ferriskey_token(token: str) -> Optional[dict]:
    """验证 FerrisKey OIDC 颁发的 JWT（RS256，异步拉取 JWKS）"""
    jwks = await _get_ferriskey_jwks()
    if not jwks:
        return None

    signing_key_dict = _find_signing_key_for_token(jwks, token)
    if not signing_key_dict:
        return None

    try:
        signing_key = PyJWK.from_dict(signing_key_dict).key
        payload = jwt.decode(
            token, signing_key,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_iss": False},
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
    """验证 DEV_MODE 本地签发的测试 Token"""
    try:
        payload = jwt.decode(
            token, DEV_JWT_SECRET,
            algorithms=[DEV_ALGORITHM],
            options={"verify_aud": False, "verify_iss": False}
        )
        if payload.get("_auth_source") == "dev_mode":
            return payload
        return None
    except PyJWTError:
        return None


# ==================== 统一 Token 验证入口 ====================

async def decode_token(token: str) -> Optional[dict]:
    """
    统一 Token 验证入口（异步，供 REST API 使用）

    验证优先级：
    1. DEV_MODE 测试 token
    2. Supabase Auth token（异步确保 JWKS 缓存已建立后做同步验签）
    3. FerrisKey OIDC token（异步拉取 JWKS + 验签）

    ★ 关键：在尝试 Supabase 验签前先确保 JWKS 缓存可用
    """
    if DEV_MODE:
        dev_payload = decode_dev_token(token)
        if dev_payload:
            return dev_payload

    # 确保 Supabase JWKS 缓存已建立（异步可以按需拉取）
    if SUPABASE_AUTH_ENABLED:
        await _get_supabase_jwks()

    supabase_payload = decode_supabase_token(token)
    if supabase_payload:
        return supabase_payload

    ferriskey_payload = await decode_ferriskey_token(token)
    if ferriskey_payload:
        return ferriskey_payload

    logger.warning("❌ 所有 Token 验证方式均失败")
    return None


def decode_token_sync(token: str) -> Optional[dict]:
    """
    同步 Token 验证入口（供 WebSocket 连接鉴权使用）

    验证优先级：
    1. DEV_MODE 测试 token
    2. Supabase Auth token（ES256 依赖 _supabase_jwks_cache，HS256 本地验签）
    3. FerrisKey OIDC token（RS256 依赖 _ferriskey_jwks_cache）

    ★ 同步上下文无法发起 HTTP 请求，所有 JWKS 必须由启动预热或先前的异步调用填充。
    """
    if DEV_MODE:
        return decode_dev_token(token)

    supabase_payload = decode_supabase_token(token)
    if supabase_payload:
        return supabase_payload

    if not _ferriskey_jwks_cache:
        logger.warning("decode_token_sync: FerrisKey JWKS 缓存未建立")
        return None

    signing_key_dict = _find_signing_key_for_token(_ferriskey_jwks_cache, token)
    if not signing_key_dict:
        return None

    try:
        signing_key = PyJWK.from_dict(signing_key_dict).key
        payload = jwt.decode(
            token, signing_key,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_iss": False},
            leeway=60
        )
        payload["_auth_source"] = "ferriskey"
        return payload
    except Exception:
        return None


# ==================== OIDC State（无状态 CSRF 防护）====================

def generate_state_token(return_to: str = "", expires_minutes: int = 10) -> str:
    payload = {
        "return_to": return_to,
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_minutes * 60,
        "type": "oidc_state"
    }
    return jwt.encode(payload, DEV_JWT_SECRET, algorithm=DEV_ALGORITHM)


def verify_state_token(state: str) -> Optional[dict]:
    try:
        payload = jwt.decode(state, DEV_JWT_SECRET, algorithms=[DEV_ALGORITHM])
        if payload.get("type") == "oidc_state":
            return payload
        return None
    except PyJWTError:
        return None


# ==================== Supabase Token 刷新 ====================

async def refresh_supabase_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    """通过 Supabase Auth REST API 刷新 access_token"""
    if not SUPABASE_URL:
        return None
    try:
        anon_key = os.getenv("SUPABASE_ANON_KEY", "")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
                json={"refresh_token": refresh_token},
                headers={
                    "Content-Type": "application/json",
                    "apikey": anon_key,
                }
            )
            if response.status_code == 200:
                data = response.json()
                return {
                    "access_token": data.get("access_token"),
                    "refresh_token": data.get("refresh_token", refresh_token),
                    "expires_in": data.get("expires_in", 3600),
                }
            else:
                logger.warning(f"❌ Supabase Token 刷新失败: HTTP {response.status_code} {response.text[:200]}")
                return None
    except Exception as e:
        logger.error(f"❌ Supabase Token 刷新异常: {e}")
        return None


# ==================== FerrisKey Token 交换与刷新 ====================

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
        logger.error(f"❌ FerrisKey Token 刷新异常: {e}")
        return None
