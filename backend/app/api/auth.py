"""
认证路由

提供基于 OIDC (FerrisKey) 和 DEV_MODE 测试签发的认证接口。
采用基于 JWT 的无状态 state 进行 CSRF 防护，适配多 Worker 部署。
"""
import os
import json
from urllib.parse import urlencode

from fastapi import APIRouter, Request, Depends, HTTPException, status
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel

from ..core.logger import logger
from ..core.security import (
    DEV_MODE,
    FERRISKEY_CLIENT_ID,
    FERRISKEY_CLIENT_SECRET,
    VERIFY_SSL,
    create_dev_token,
    generate_state_token,
    verify_state_token,
    get_ferriskey_auth_url,
    get_ferriskey_logout_url,
    exchange_code_for_tokens,
    decode_token,
    refresh_access_token,
)
from .dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 回调 URL 配置
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5174")
FRONTEND_CALLBACK_URL = f"{FRONTEND_URL}/callback"
BACKEND_CALLBACK_URL = os.getenv("BACKEND_CALLBACK_URL", "http://localhost:8001/api/auth/callback")


class LoginResponse(BaseModel):
    """登录响应"""
    access_token: str
    token_type: str = "Bearer"
    user: dict


@router.get("/login")
async def login(request: Request):
    """
    登录入口
    
    开发模式：直接签发测试 JWT，重定向到前端 callback
    生产模式：生成无状态 signed state，重定向到 OIDC 认证服务
    """
    if DEV_MODE:
        logger.info("[DEV_MODE] 跳过 IAM 认证，签发测试 Token")
        access_token = create_dev_token()
        
        callback_params = urlencode({
            "access_token": access_token,
            "refresh_token": "dev-refresh-token",
        })
        return RedirectResponse(url=f"{FRONTEND_CALLBACK_URL}?{callback_params}")

    # 生产模式: OIDC 授权码流程
    state = generate_state_token()
    
    auth_url = get_ferriskey_auth_url()
    params = {
        "response_type": "code",
        "client_id": FERRISKEY_CLIENT_ID,
        "redirect_uri": BACKEND_CALLBACK_URL,
        "scope": "openid profile email",
        "state": state,
    }
    
    redirect_url = f"{auth_url}?{urlencode(params)}"
    logger.info(f"🔐 OIDC 登录重定向: {redirect_url[:100]}...")
    
    return RedirectResponse(url=redirect_url)


@router.get("/callback")
async def auth_callback(code: str = None, state: str = None, error: str = None, error_description: str = None):
    """
    OIDC 回调处理
    
    1. 验证无状态 state 防止 CSRF (解决多进程丢失问题)
    2. 用 code 换取 access_token 等
    3. 重定向回前端页面
    """
    if DEV_MODE:
        return {"status": "dev_mode", "message": "开发模式不需要处理 OIDC 回调"}

    if error:
        logger.error(f"FerrisKey 认证错误: {error} - {error_description}")
        return RedirectResponse(url=f"{FRONTEND_CALLBACK_URL}?error={error}&error_description={error_description}")

    if not code:
        return RedirectResponse(url=f"{FRONTEND_CALLBACK_URL}?error=missing_code")

    # 验证 JWT Signed State
    if not state or not verify_state_token(state):
        logger.warning(f"⚠️ State 验证失败，可能为 CSRF 攻击或已过期: {state}")
        return RedirectResponse(url=f"{FRONTEND_CALLBACK_URL}?error=invalid_state")

    # 换取 Tokens
    tokens = await exchange_code_for_tokens(code, BACKEND_CALLBACK_URL)
    if not tokens:
        return RedirectResponse(url=f"{FRONTEND_CALLBACK_URL}?error=token_exchange_failed")

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")

    # 这里不再从后端解析提取用户信息附在 URL，前端调 /me 获取（保证敏感信息不在 URL 中）
    callback_params = urlencode({
        "access_token": access_token,
        "refresh_token": refresh_token,
    })
    
    logger.info("✅ OIDC 认证成功，准备重定向回前端")
    return RedirectResponse(url=f"{FRONTEND_CALLBACK_URL}?{callback_params}")


@router.get("/me")
async def get_current_user_info(user: dict = Depends(get_current_user)):
    """
    获取当前用户信息
    使用 depends 统一的 JWT 验证机制
    """
    return {
        "user": user
    }


class RefreshRequest(BaseModel):
    refresh_token: str

@router.post("/refresh")
async def refresh_token_endpoint(data: RefreshRequest):
    """刷新 Token"""
    if data.refresh_token.startswith("dev-") and DEV_MODE:
        logger.info("[DEV_MODE] 重新签发测试 Token (refresh)")
        return {
            "access_token": create_dev_token(),
            "refresh_token": "dev-refresh-token",
            "expires_in": 86400,
        }

    tokens = await refresh_access_token(data.refresh_token)
    if not tokens:
        raise HTTPException(
            status_code=401,
            detail="Refresh Token 无效或已过期，请重新登录"
        )
    
    return {
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token", data.refresh_token),
        "expires_in": tokens.get("expires_in", 300)
    }

class LogoutRequest(BaseModel):
    refresh_token: str = ""

@router.post("/logout")
async def logout_endpoint(data: LogoutRequest):
    """登出并清理 SSO 会话"""
    if data.refresh_token and not data.refresh_token.startswith("dev-"):
        import httpx
        logout_url = get_ferriskey_logout_url()
        try:
            async with httpx.AsyncClient(timeout=10.0, verify=VERIFY_SSL) as client:
                await client.post(
                    logout_url,
                    data={
                        "client_id": FERRISKEY_CLIENT_ID,
                        "client_secret": FERRISKEY_CLIENT_SECRET,
                        "refresh_token": data.refresh_token,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                logger.info("✅ FerrisKey SSO Session 已注销")
        except Exception as e:
            logger.warning(f"⚠️ FerrisKey 登出请求失败: {e}")
            
    return {"message": "已登出"}
