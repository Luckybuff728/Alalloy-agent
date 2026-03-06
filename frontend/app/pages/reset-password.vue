<script setup>
/**
 * 密码重置页面 — 使用 Supabase SDK 原生流程
 *
 * 完整流程：
 *   1. 用户输入邮箱 → 前端调 supabase.auth.resetPasswordForEmail()
 *   2. Supabase 用配置的 SMTP 发送含重置链接的邮件
 *   3. 用户点击邮件链接 → 跳转到本页面，URL hash 含 access_token & type=recovery
 *   4. Supabase SDK detectSessionInUrl:true 自动解析 hash → 触发 PASSWORD_RECOVERY 事件
 *   5. 用户输入新密码 → supabase.auth.updateUser({ password: newPassword })
 *   6. 完成，跳转登录
 *
 * 核心优势（SDK 框架优势）：
 *   - 无需后端参与密码更新（Supabase 直接处理）
 *   - resetPasswordForEmail 使用 anon key，遵守 Supabase 邮件配置（SMTP/模板）
 *   - onAuthStateChange 自动处理 token 解析，无需手动读 URL hash
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const router = useRouter()

// ===================== Supabase 客户端 =====================
const supabase = useSupabase()

// ===================== 状态 =====================
const phase = ref('request')    // 'request' | 'reset' | 'done'
const email = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showNewPwd = ref(false)
const showConfirmPwd = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const doneTitle = ref('')

// onAuthStateChange 订阅取消函数
let _authListener = null

// ===================== 密码强度 =====================
const passwordStrength = computed(() => {
  const p = newPassword.value
  if (!p) return null
  let score = 0
  if (p.length >= 8) score++
  if (p.length >= 12) score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  if (score <= 1) return { level: 'weak', label: '弱', color: '#ef4444', width: '33%' }
  if (score <= 3) return { level: 'medium', label: '中', color: '#f59e0b', width: '66%' }
  return { level: 'strong', label: '强', color: '#22c55e', width: '100%' }
})

const passwordsMatch = computed(() => {
  if (!confirmPassword.value) return null
  return newPassword.value === confirmPassword.value
})

// ===================== 初始化：检查 recovery session =====================
onMounted(async () => {
  if (!supabase) return

  // ★ 时序保障：先注册 onAuthStateChange，再检查已有 session
  // 顺序很重要：如果先 getSession() 后注册，可能错过 SDK 在 mount 时已触发的事件

  // 1. 注册事件监听（先注册，不遗漏任何事件）
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    console.log('[ResetPassword] auth event:', event)
    if (event === 'PASSWORD_RECOVERY') {
      phase.value = 'reset'
      window.history.replaceState({}, '', '/reset-password')
    }
  })
  _authListener = subscription

  // 2. 检查 SDK 是否已通过 URL hash 建立了 recovery session
  // （当用户从邮件链接跳转过来时，SDK 会在初始化时解析 hash 并建立 session）
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    // 已有 session 说明 SDK 已处理了 recovery token（可能在事件注册前就完成了）
    const url = new URL(window.location.href)
    const hashType = new URLSearchParams(window.location.hash.substring(1)).get('type')
    if (hashType === 'recovery' || session.user?.aud === 'authenticated') {
      console.log('[ResetPassword] 检测到已有 recovery session，切换到密码设置')
      phase.value = 'reset'
      window.history.replaceState({}, '', '/reset-password')
    }
  }
})

onUnmounted(() => {
  // 清理订阅，防止内存泄漏
  _authListener?.unsubscribe()
})

// ===================== 申请发送重置邮件 =====================
async function handleRequestReset() {
  errorMsg.value = ''
  successMsg.value = ''

  if (!email.value || !email.value.includes('@')) {
    errorMsg.value = '请输入有效的邮箱地址'
    return
  }

  loading.value = true
  try {
    const redirectTo = `${window.location.origin}/reset-password`

    // 策略一：优先使用 Supabase SDK（前端直连，需要 redirectTo 在 Supabase 白名单中）
    // 策略二：若 SDK 失败（redirectTo 未加白名单或 SMTP 未配置），自动回退到后端 admin API
    //         后端 admin API 绕过重定向 URL 限制，并在 DEV_MODE 下返回直达链接
    let sent = false

    if (supabase) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.value, { redirectTo })

      if (!error) {
        sent = true
      } else {
        console.warn('[ResetPassword] SDK resetPasswordForEmail 失败，回退到后端 API:', error.message)
        // 常见失败原因：redirectTo 未加入 Supabase 白名单、SMTP 未配置
        // 此时由后端 admin API 接管（admin API 无 redirectTo 校验限制）
      }
    }

    // 回退：调用后端 admin API（也可独立使用，支持 DEV_MODE 直达链接）
    if (!sent) {
      const res = await fetch('/api/auth/supabase/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Referer': window.location.href },
        body: JSON.stringify({ email: email.value, redirect_to: redirectTo })
      })
      const data = await res.json()
      if (!res.ok) {
        errorMsg.value = data.detail || '发送失败，请稍后重试'
        return
      }
      // DEV_MODE 下后端返回直达链接
      if (data.dev_action_link) {
        devActionLink.value = data.dev_action_link
      }
    }

    phase.value = 'done'
    doneTitle.value = '邮件已发送'
    successMsg.value = `重置密码邮件已发送到 ${email.value}，请在 15 分钟内点击邮件中的链接完成重置（请检查垃圾邮件箱）`

  } catch (e) {
    console.error('[ResetPassword] 发送异常:', e)
    errorMsg.value = '网络异常，请检查网络连接后重试'
  } finally {
    loading.value = false
  }
}

// ===================== 设置新密码 =====================
async function handleSetPassword() {
  errorMsg.value = ''

  if (newPassword.value.length < 8) {
    errorMsg.value = '密码至少需要 8 位字符'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  try {
    // ★ 直接用 SDK 更新密码 — 此时 Supabase 已通过 onAuthStateChange 建立了 recovery session
    // 无需手动传 token，SDK 内部已持有当前会话
    const { error } = await supabase.auth.updateUser({
      password: newPassword.value
    })

    if (error) {
      console.error('[ResetPassword] updateUser 失败:', error.message)
      errorMsg.value = _translateError(error.message)
    } else {
      phase.value = 'done'
      doneTitle.value = '密码已更新'
      successMsg.value = '您的密码已成功更新，请使用新密码重新登录'
      // 让 Supabase 清理 recovery session（不污染正常登录状态）
      await supabase.auth.signOut()
    }
  } catch (e) {
    errorMsg.value = '密码更新失败，重置链接可能已过期，请重新申请'
  } finally {
    loading.value = false
  }
}

function goLogin() {
  router.replace('/login')
}

function _translateError(msg) {
  if (!msg) return '操作失败，请重试'
  if (msg.includes('rate limit') || msg.includes('too many')) return '操作过于频繁，请稍后再试'
  // Supabase 将"redirectTo URL 不在白名单"的错误包装成了"email invalid format"，此处正确翻译
  if (msg.includes('invalid format') || msg.includes('validate email')) return '邮件发送失败（服务配置问题），请联系管理员'
  if (msg.includes('expired') || msg.includes('invalid')) return '重置链接已过期，请重新申请'
  if (msg.includes('weak') || msg.includes('password')) return '密码强度不足，请使用更复杂的密码'
  if (msg.includes('network') || msg.includes('fetch')) return '网络异常，请检查网络连接'
  return msg
}
</script>

<template>
  <div class="reset-page">
    <div class="reset-card">
      <div class="brand-bar">
        <span class="brand-name">TopMaterial Tech</span>
      </div>

      <!-- ===== 完成态 ===== -->
      <div v-if="phase === 'done'" class="phase-done">
        <div class="done-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        </div>
        <h2 class="done-title">{{ doneTitle }}</h2>
        <p class="done-desc">{{ successMsg }}</p>
        <button class="btn-primary" @click="goLogin">返回登录</button>
      </div>

      <!-- ===== 申请重置模式 ===== -->
      <template v-else-if="phase === 'request'">
        <div class="phase-header">
          <div class="back-link" @click="goLogin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M15 19l-7-7 7-7"/>
            </svg>
            返回登录
          </div>
          <h2 class="phase-title">忘记密码</h2>
          <p class="phase-desc">输入注册邮箱，Supabase 将直接向您发送密码重置链接。</p>
        </div>

        <div v-if="errorMsg" class="msg-error">{{ errorMsg }}</div>

        <div class="form-field">
          <label>邮箱地址</label>
          <input
            v-model="email"
            type="email"
            placeholder="your@email.com"
            class="input-field"
            :disabled="loading"
            @keyup.enter="handleRequestReset"
            autocomplete="email"
          />
        </div>

        <button class="btn-primary" @click="handleRequestReset" :disabled="loading || !supabase">
          <span class="spinner" v-if="loading"></span>
          {{ loading ? '发送中...' : '发送重置邮件' }}
        </button>

        <div v-if="!supabase" class="warn-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <span>Supabase 未配置，密码重置不可用</span>
        </div>

        <p class="hint-text">FerrisKey 企业 SSO 用户请联系 IT 管理员重置密码</p>
      </template>

      <!-- ===== 设置新密码模式（PASSWORD_RECOVERY 事件触发后显示）===== -->
      <template v-else-if="phase === 'reset'">
        <div class="phase-header">
          <h2 class="phase-title">设置新密码</h2>
          <p class="phase-desc">请输入您的新密码，完成后需重新登录。</p>
        </div>

        <div v-if="errorMsg" class="msg-error">{{ errorMsg }}</div>

        <!-- 新密码 -->
        <div class="form-field">
          <label>新密码</label>
          <div class="input-wrapper">
            <input
              v-model="newPassword"
              :type="showNewPwd ? 'text' : 'password'"
              placeholder="至少 8 位字符"
              class="input-field"
              :disabled="loading"
              autocomplete="new-password"
            />
            <button class="eye-btn" @click="showNewPwd = !showNewPwd" type="button">
              <svg v-if="showNewPwd" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                <path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
              </svg>
            </button>
          </div>
          <div v-if="passwordStrength" class="strength-bar">
            <div class="strength-track">
              <div class="strength-fill" :style="{ width: passwordStrength.width, background: passwordStrength.color }"></div>
            </div>
            <span class="strength-label" :style="{ color: passwordStrength.color }">{{ passwordStrength.label }}</span>
          </div>
        </div>

        <!-- 确认密码 -->
        <div class="form-field">
          <label>确认新密码</label>
          <div class="input-wrapper">
            <input
              v-model="confirmPassword"
              :type="showConfirmPwd ? 'text' : 'password'"
              placeholder="再次输入新密码"
              class="input-field"
              :class="{ 'input-error': passwordsMatch === false, 'input-ok': passwordsMatch === true }"
              :disabled="loading"
              @keyup.enter="handleSetPassword"
              autocomplete="new-password"
            />
            <button class="eye-btn" @click="showConfirmPwd = !showConfirmPwd" type="button">
              <svg v-if="showConfirmPwd" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                <path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
              </svg>
            </button>
          </div>
          <p v-if="passwordsMatch === false" class="field-error">两次密码不一致</p>
        </div>

        <button
          class="btn-primary"
          @click="handleSetPassword"
          :disabled="loading || passwordsMatch === false || !newPassword"
        >
          <span class="spinner" v-if="loading"></span>
          {{ loading ? '更新中...' : '确认设置新密码' }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.reset-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #f8fafc; font-family: 'PingFang SC', 'Microsoft YaHei', 'Inter', sans-serif; padding: 24px;
}
.reset-card {
  width: 100%; max-width: 460px; background: #fff; border-radius: 20px;
  padding: 48px 44px; box-shadow: 0 4px 24px rgba(15,23,42,0.08);
}
.brand-bar { margin-bottom: 36px; }
.brand-name { font-size: 1rem; font-weight: 800; color: #0f172a; letter-spacing: -0.3px; }

/* 完成态 */
.phase-done { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 16px; }
.done-icon { width: 80px; height: 80px; background: #f0fdf4; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #22c55e; }
.done-title { font-size: 1.5rem; font-weight: 700; color: #0f172a; margin: 0; }
.done-desc { color: #64748b; font-size: 0.9rem; line-height: 1.6; max-width: 340px; }

/* 表单头部 */
.phase-header { margin-bottom: 24px; }
.back-link { display: inline-flex; align-items: center; gap: 6px; color: #64748b; font-size: 0.875rem; cursor: pointer; margin-bottom: 20px; transition: color 0.2s; }
.back-link:hover { color: #3b82f6; }
.phase-title { font-size: 1.6rem; font-weight: 800; color: #0f172a; margin: 0 0 8px; letter-spacing: -0.5px; }
.phase-desc { color: #64748b; font-size: 0.9rem; line-height: 1.6; margin: 0; }

/* 表单 */
.form-field { margin-bottom: 18px; }
.form-field label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 6px; }
.input-wrapper { position: relative; }
.input-field {
  width: 100%; height: 48px; padding: 0 44px 0 14px;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  font-size: 0.95rem; color: #0f172a; outline: none;
  transition: border-color 0.2s; box-sizing: border-box; background: #fff;
}
.form-field > .input-field { padding: 0 14px; }
.input-field:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
.input-field:disabled { background: #f8fafc; color: #94a3b8; }
.input-field.input-error { border-color: #ef4444; }
.input-field.input-ok { border-color: #22c55e; }
.eye-btn { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #94a3b8; padding: 4px; display: flex; align-items: center; transition: color 0.2s; }
.eye-btn:hover { color: #64748b; }
.field-error { font-size: 0.78rem; color: #ef4444; margin-top: 4px; }

/* 密码强度 */
.strength-bar { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.strength-track { flex: 1; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; }
.strength-fill { height: 100%; border-radius: 2px; transition: width 0.3s, background 0.3s; }
.strength-label { font-size: 0.75rem; font-weight: 500; white-space: nowrap; }

/* 消息 */
.msg-error { padding: 10px 14px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 10px; color: #b91c1c; font-size: 0.875rem; margin-bottom: 16px; }
.warn-box { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 10px; color: #92400e; font-size: 0.8rem; margin-top: 12px; }

/* 按钮 */
.btn-primary { width: 100%; height: 52px; background: #0f172a; color: #fff; border: none; border-radius: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 4px; }
.btn-primary:hover:not(:disabled) { background: #1e293b; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.15); }
.btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.hint-text { margin-top: 16px; color: #94a3b8; font-size: 0.8rem; text-align: center; line-height: 1.6; }

@media (max-width: 500px) { .reset-card { padding: 36px 24px; border-radius: 16px; } }
</style>
