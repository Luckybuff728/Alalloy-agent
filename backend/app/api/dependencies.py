"""
认证依赖注入模块

提供 FastAPI Depends 依赖，用于保护需要认证的端点。

支持三种登录来源的用户信息提取：
- dev_mode:   DEV_MODE 测试 token，payload 字段与 FerrisKey 一致
- ferriskey:  FerrisKey OIDC token，使用 preferred_username/name
- supabase:   Supabase Auth token，name 在 user_metadata.full_name 中

输出统一格式：{ id, email, username, name, role, _auth_source }
"""

from typing import Optional, Dict, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..core.logger import logger
from ..core.security import decode_token, decode_token_sync

security = HTTPBearer(auto_error=False)


def _extract_user_info(payload: dict) -> Dict[str, Any]:
    """
    从 Token payload 中提取统一的用户信息，兼容多登录来源。

    Supabase JWT 示例结构：
        { "sub": "uuid", "email": "x@y.com", "role": "authenticated",
          "aud": "authenticated", "iss": "https://xxx.supabase.co/auth/v1",
          "user_metadata": { "full_name": "张三", "username": "zhangsan" } }

    FerrisKey / DEV_MODE JWT 示例结构：
        { "sub": "uuid", "email": "x@y.com", "preferred_username": "zhangsan",
          "name": "张三", "role": "authenticated" }
    """
    auth_source = payload.get("_auth_source", "unknown")

    if auth_source == "supabase":
        user_meta = payload.get("user_metadata") or {}
        name = (
            user_meta.get("full_name")
            or user_meta.get("name")
            or payload.get("name", "")
        )
        username = (
            user_meta.get("username")
            or user_meta.get("preferred_username")
            or payload.get("email", "")
        )
        return {
            "id": payload.get("sub"),
            "email": payload.get("email"),
            "username": username,
            "name": name,
            "role": payload.get("role", "authenticated"),
            "_auth_source": "supabase",
        }

    # FerrisKey / DEV_MODE — 字段结构相同
    return {
        "id": payload.get("sub"),
        "email": payload.get("email"),
        "username": payload.get("preferred_username", payload.get("name", "")),
        "name": payload.get("name", ""),
        "role": payload.get("role", "authenticated"),
        "_auth_source": auth_source,
    }


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Dict[str, Any]:
    """
    获取当前用户信息
    
    必须提供有效的 JWT Token (FerrisKey 颁发，或 DEV_MODE 下的测试 Token)
    """
    if not credentials:
        logger.warning("[Auth] 缺少 Authorization Header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少认证令牌",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    token = credentials.credentials
    payload = await decode_token(token)
    
    if not payload or not payload.get("sub"):
        logger.warning("[Auth] 令牌验证失败或缺少 sub 字段")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效或过期的认证令牌",
            headers={"WWW-Authenticate": "Bearer"}
        )
        
    return _extract_user_info(payload)


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[Dict[str, Any]]:
    """
    可选的用户认证（不强制要求）
    """
    if not credentials:
        return None
        
    try:
        token = credentials.credentials
        payload = await decode_token(token)
        
        if not payload or not payload.get("sub"):
            return None
            
        return _extract_user_info(payload)
    except Exception:
        return None


def verify_token_sync(token: str) -> bool:
    """
    同步验证 Token（用于 WebSocket 连接验证）
    """
    if not token:
        return False
        
    payload = decode_token_sync(token)
    return payload is not None and "sub" in payload


def extract_user_from_token_sync(token: str) -> Optional[Dict[str, Any]]:
    """
    从 Token 提取用户信息（同步版本，用于 WebSocket）
    """
    if not token:
        return None
        
    payload = decode_token_sync(token)
    if not payload or not payload.get("sub"):
        return None
        
    return _extract_user_info(payload)
