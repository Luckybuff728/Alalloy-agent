"""
认证路由

提供基于 OIDC (FerrisKey) 和 DEV_MODE 测试签发的认证接口。
采用基于 JWT 的无状态 state 进行 CSRF 防护，适配多 Worker 部署。
"""
import os
import json
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, Request, Depends, HTTPException, status
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel

from ..core.logger import logger
from ..core.security import (
    DEV_MODE,
    FERRISKEY_CLIENT_ID,
    FERRISKEY_CLIENT_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    SUPABASE_AUTH_ENABLED,
    VERIFY_SSL,
    create_dev_token,
    generate_state_token,
    verify_state_token,
    get_ferriskey_auth_url,
    get_ferriskey_logout_url,
    exchange_code_for_tokens,
    decode_token,
    refresh_access_token,
    refresh_supabase_token,
)
from .dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 回调 URL 配置（作为静态兜底值，运行时通过 Referer 动态解析）
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5174")
FRONTEND_CALLBACK_URL = f"{FRONTEND_URL}/callback"
BACKEND_CALLBACK_URL = os.getenv("BACKEND_CALLBACK_URL", "http://localhost:8001/api/auth/callback")


# ==================== 动态 callback URL 解析 ====================

def _resolve_frontend_callback(request: Request) -> str:
    """
    动态解析前端 callback URL，兼容本机（localhost）和局域网（任意 IP）访问。

    策略：
    - 从请求头的 Referer / Origin 提取浏览器实际的 frontend origin
    - 仅替换 FRONTEND_CALLBACK_URL 中的 origin 部分（scheme + host + port）
    - 路径部分（/callback）保持不变
    - 无法解析时回退到 FRONTEND_CALLBACK_URL 配置值

    示例：
      FRONTEND_URL              = http://localhost:5174
      LAN 用户 Referer          = http://192.168.6.110:5174/
      → 返回                    = http://192.168.6.110:5174/callback  ✅
      本机用户 Referer          = http://localhost:5174/
      → 返回                    = http://localhost:5174/callback       ✅
    """
    origin_str = ""

    # 优先使用 Referer（同域请求浏览器几乎总会携带）
    referer = request.headers.get("referer", "")
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            origin_str = f"{parsed.scheme}://{parsed.netloc}"

    # 次选 Origin 头（跨域请求时携带）
    if not origin_str:
        origin = request.headers.get("origin", "")
        if origin and origin not in ("null", ""):
            origin_str = origin

    if not origin_str:
        logger.debug("[Auth] 无法从请求头获取 frontend origin，使用配置值")
        return FRONTEND_CALLBACK_URL

    # 仅替换 origin，保留路径（/callback）
    parsed_default = urlparse(FRONTEND_CALLBACK_URL)
    resolved = f"{origin_str}{parsed_default.path}"
    logger.debug(f"[Auth] 动态解析 callback URL: {resolved} (来源: Referer={referer or '无'})")
    return resolved


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
    # ★ 动态解析前端 callback URL（兼容本机和局域网访问）
    callback_url = _resolve_frontend_callback(request)

    if DEV_MODE:
        logger.info(f"[DEV_MODE] 跳过 IAM 认证，签发测试 Token → {callback_url}")
        access_token = create_dev_token()

        callback_params = urlencode({
            "access_token": access_token,
            "refresh_token": "dev-refresh-token",
        })
        return RedirectResponse(url=f"{callback_url}?{callback_params}")

    # 生产模式: OIDC 授权码流程
    # ★ 将动态解析的 callback URL 存入 state JWT 的 return_to 字段
    # auth_callback 被 FerrisKey 调用时（无 Referer），从 state 中取回正确的前端地址
    state = generate_state_token(return_to=callback_url)

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

    # ★ 优先从 state JWT 中取回登录时解析的前端 callback URL
    # verify_state_token 同时完成签名验证和 return_to 提取
    state_payload = verify_state_token(state) if state else None
    callback_url = (
        state_payload.get("return_to") or FRONTEND_CALLBACK_URL
        if state_payload else FRONTEND_CALLBACK_URL
    )

    if error:
        logger.error(f"FerrisKey 认证错误: {error} - {error_description}")
        return RedirectResponse(url=f"{callback_url}?error={error}&error_description={error_description}")

    if not code:
        return RedirectResponse(url=f"{callback_url}?error=missing_code")

    # 验证 JWT Signed State（已在上方完成，此处仅检查 payload 是否有效）
    if not state_payload:
        logger.warning(f"⚠️ State 验证失败，可能为 CSRF 攻击或已过期: {state}")
        return RedirectResponse(url=f"{callback_url}?error=invalid_state")

    # 换取 Tokens
    tokens = await exchange_code_for_tokens(code, BACKEND_CALLBACK_URL)
    if not tokens:
        return RedirectResponse(url=f"{callback_url}?error=token_exchange_failed")

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")

    # 前端调 /me 获取用户信息（敏感信息不在 URL 中）
    callback_params = urlencode({
        "access_token": access_token,
        "refresh_token": refresh_token,
    })

    logger.info(f"✅ OIDC 认证成功，重定向回前端 → {callback_url}")
    return RedirectResponse(url=f"{callback_url}?{callback_params}")


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
    source: str = ""  # "supabase" | "ferriskey" | "dev_mode" | "" (自动检测)


@router.post("/refresh")
async def refresh_token_endpoint(data: RefreshRequest):
    """
    刷新 Token — 严格按 source 字段路由，不做隐式 fallback

    前端必须传入正确的 source，避免 Supabase refresh_token 被误发给 FerrisKey。
    """
    # DEV_MODE
    if data.source == "dev_mode" or (data.refresh_token.startswith("dev-") and DEV_MODE):
        logger.info("[DEV_MODE] 重新签发测试 Token (refresh)")
        return {
            "access_token": create_dev_token(),
            "refresh_token": "dev-refresh-token",
            "expires_in": 86400,
        }

    # Supabase：前端 source="supabase" 时走此分支
    if data.source == "supabase":
        if not SUPABASE_AUTH_ENABLED:
            raise HTTPException(status_code=503, detail="Supabase Auth 未启用")
        tokens = await refresh_supabase_token(data.refresh_token)
        if not tokens:
            raise HTTPException(status_code=401, detail="Supabase Refresh Token 无效或已过期")
        logger.info("✅ Supabase Token 刷新成功")
        return tokens

    # FerrisKey（source="ferriskey" 或未指定）
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
    source: str = ""  # "supabase" | "ferriskey" | "" — 明确来源，防止误调


@router.post("/logout")
async def logout_endpoint(data: LogoutRequest):
    """
    登出并清理 SSO 会话

    source="supabase" 时跳过 FerrisKey logout（Supabase session 由前端 SDK 直接注销）
    source="ferriskey" 或不填时，调 FerrisKey logout 清理 SSO session
    """
    if data.source == "supabase":
        # Supabase session 由前端 supabase.auth.signOut() 直接注销，后端只需清理本地记录
        logger.info("✅ Supabase 用户登出（Server Session 由前端 SDK 处理）")
        return {"message": "已登出"}

    # FerrisKey / DEV_MODE：调 FerrisKey logout API 注销 SSO session
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


# ==================== Supabase 密码重置 ====================

class ResetPasswordRequest(BaseModel):
    email: str
    redirect_to: str = ""  # 前端重置密码页面的 URL，留空则使用默认值


@router.post("/supabase/reset-password")
async def supabase_reset_password(data: ResetPasswordRequest, request: Request):
    """
    发送密码重置邮件（通过 Supabase Admin API generate_link）

    邮件投递说明：
    - Supabase 内置 SMTP 对国内邮箱（QQ/163 等）投递率低，建议生产环境配置自定义 SMTP。
    - DEV_MODE 下额外返回 action_link，可直接点击跳转，无需等待邮件。
    - 安全原则：无论邮箱是否真实存在，均返回相同成功消息，防止用户枚举攻击。
    """
    if not SUPABASE_AUTH_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase Auth 未启用")
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Supabase 配置不完整")

    # 动态解析前端重置页面 URL（兼容局域网访问）
    if not data.redirect_to:
        frontend_callback = _resolve_frontend_callback(request)
        base_url = frontend_callback.rsplit('/callback', 1)[0]
        redirect_url = f"{base_url}/reset-password"
    else:
        redirect_url = data.redirect_to

    import httpx

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{SUPABASE_URL}/auth/v1/admin/generate_link",
                json={
                    "type": "recovery",
                    "email": data.email,
                    "options": {"redirect_to": redirect_url}
                },
                headers={
                    "Content-Type": "application/json",
                    "apikey": SUPABASE_SERVICE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                }
            )

            if response.status_code == 200:
                resp_data = response.json()
                action_link = resp_data.get("action_link", "")
                logger.info(f"✅ 密码重置链接已生成: {data.email} → redirect={redirect_url}")

                result: dict = {
                    "message": "如果该邮箱已注册，您将收到一封密码重置邮件（请检查垃圾邮件箱），请在 15 分钟内完成操作"
                }

                # DEV_MODE：直接返回跳转链接，绕过邮件投递限制，方便本地测试
                if DEV_MODE and action_link:
                    result["dev_action_link"] = action_link
                    logger.info(f"[DEV_MODE] 直达重置链接: {action_link}")

                return result

            elif response.status_code == 422:
                # 邮箱不存在 — 同样返回成功消息（防枚举）
                logger.info(f"密码重置请求: 邮箱不存在（已静默处理）: {data.email}")
                return {"message": "如果该邮箱已注册，您将收到一封密码重置邮件，请在 15 分钟内完成操作"}
            else:
                error = response.json()
                error_msg = error.get("msg") or error.get("message") or "发送失败"
                logger.warning(f"⚠️ 密码重置链接生成失败: {data.email} → {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 密码重置异常: {e}")
        raise HTTPException(status_code=500, detail="重置服务暂时不可用")


# ★ /supabase/update-password 接口已移除
# 密码更新现在完全通过前端 supabase.auth.updateUser({ password }) 直接处理
# SDK onAuthStateChange PASSWORD_RECOVERY 事件会自动建立 recovery session，updateUser() 使用该 session
# 这是 Supabase 官方推荐的标准流程，无需后端代理


# ==================== Supabase 用户注册（后端代理）====================

class SupabaseRegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""  # 可选，写入 user_metadata.full_name


@router.post("/supabase/register")
async def supabase_register(data: SupabaseRegisterRequest):
    """
    通过 Supabase Admin API 注册新用户（后端代理，使用 Service Key）

    使用 Service Key 的好处：
    1. 可以跳过邮箱验证（signup_confirmation_required=false）
    2. 可以设置 user_metadata（如姓名）
    3. 前端无需暴露 admin 权限

    返回：新用户信息（不含 session token，注册后需单独登录）
    """
    if not SUPABASE_AUTH_ENABLED:
        raise HTTPException(status_code=503, detail="Supabase Auth 未启用")

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Supabase 配置不完整")

    import httpx

    user_metadata = {}
    if data.name:
        user_metadata["full_name"] = data.name

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                json={
                    "email": data.email,
                    "password": data.password,
                    "email_confirm": True,  # 跳过邮件验证，直接激活
                    "user_metadata": user_metadata,
                },
                headers={
                    "Content-Type": "application/json",
                    "apikey": SUPABASE_SERVICE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                }
            )
            if response.status_code == 200:
                user = response.json()
                logger.info(f"✅ Supabase 用户已注册: {data.email}")
                return {
                    "message": "注册成功",
                    "user_id": user.get("id"),
                    "email": user.get("email"),
                }
            else:
                error = response.json()
                error_msg = error.get("msg") or error.get("message") or "注册失败"
                logger.warning(f"⚠️ Supabase 注册失败: {data.email} → {error_msg}")
                raise HTTPException(status_code=400, detail=error_msg)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Supabase 注册异常: {e}")
        raise HTTPException(status_code=500, detail="注册服务暂时不可用")
