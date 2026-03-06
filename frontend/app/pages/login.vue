<script setup>
/**
 * 登录页面 (Multi-Auth v2)
 *
 * 支持三种入口，通过 NUXT_PUBLIC_AUTH_PROVIDER 控制显示：
 *   both      → Supabase 邮箱/密码表单 + FerrisKey SSO 按钮
 *   supabase  → 仅 Supabase（甲方交付环境）
 *   ferriskey → 仅 FerrisKey SSO（内部管理环境）
 *
 * 功能清单：
 *   ✅ 登录 / 注册 Tab 切换
 *   ✅ 密码显示/隐藏切换
 *   ✅ 注册时密码确认 + 密码强度指示器
 *   ✅ 客户端表单校验（邮箱格式、密码长度）
 *   ✅ 忘记密码链接（跳转 /reset-password）
 *   ✅ DEV_MODE 横幅（生产环境隐藏）
 */
import { ref, computed, onMounted } from 'vue'

const authStore = useAuthStore()
const router = useRouter()
const config = useRuntimeConfig()

// ===================== 登录方式控制 =====================
const authProvider = computed(() => config.public.authProvider || 'both')
const showSupabase = computed(() => ['both', 'supabase'].includes(authProvider.value))
const showFerrisKey = computed(() => ['both', 'ferriskey'].includes(authProvider.value))
const isDevMode = computed(() => config.public.devMode)

// ===================== 表单状态 =====================
const mode = ref('login')          // 'login' | 'register'
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const name = ref('')
const showPwd = ref(false)
const showConfirmPwd = ref(false)

const loading = ref(false)
const errorMsg = ref('')
const successMsg = ref('')

function clearMessages() {
  errorMsg.value = ''
  successMsg.value = ''
}

function switchMode(m) {
  mode.value = m
  confirmPassword.value = ''
  showPwd.value = false
  showConfirmPwd.value = false
  clearMessages()
}

// ===================== 表单验证 =====================
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value))

const passwordStrength = computed(() => {
  const p = password.value
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
  if (mode.value !== 'register' || !confirmPassword.value) return null
  return password.value === confirmPassword.value
})

// ===================== 提交处理 =====================
async function handleSubmit() {
  clearMessages()

  // 客户端校验
  if (!email.value) {
    errorMsg.value = '请填写邮箱地址'
    return
  }
  if (!emailValid.value) {
    errorMsg.value = '邮箱格式不正确'
    return
  }
  if (!password.value) {
    errorMsg.value = '请填写密码'
    return
  }
  if (mode.value === 'login' && password.value.length < 6) {
    errorMsg.value = '密码长度不正确'
    return
  }
  if (mode.value === 'register') {
    if (password.value.length < 8) {
      errorMsg.value = '注册密码至少需要 8 位字符'
      return
    }
    if (!confirmPassword.value) {
      errorMsg.value = '请再次输入密码以确认'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = '两次输入的密码不一致'
      return
    }
  }

  loading.value = true
  try {
    if (mode.value === 'login') {
      const result = await authStore.loginWithSupabase(email.value, password.value)
      if (result.success) {
        router.push('/')
      } else {
        errorMsg.value = result.error || '登录失败，请重试'
      }
    } else {
      const result = await authStore.registerWithSupabase(email.value, password.value, name.value)
      if (result.success) {
        successMsg.value = '注册成功！请使用邮箱和密码登录'
        switchMode('login')
      } else {
        errorMsg.value = result.error || '注册失败，请重试'
      }
    }
  } finally {
    loading.value = false
  }
}

// ===================== FerrisKey SSO =====================
function startFerrisKeyLogin() {
  window.location.href = '/api/auth/login'
}

// 已登录则直接跳转主页
onMounted(() => {
  if (authStore.isAuthenticated) router.push('/')
})
</script>

<template>
  <div class="auth-page">
    <!-- ===== 左侧：品牌区 ===== -->
    <div class="brand-side">
      <div class="brand-inner">
        <header class="logo-area">
          <span class="brand-logo">TopMaterial Tech</span>
        </header>

        <div class="hero-content">
          <h1 class="hero-title">
            <div class="line highlight">Alalloy Agent</div>
          </h1>
          <p class="hero-desc">赋能铝合金智能设计，AI 驱动的未来实验室</p>

          <div class="capability-matrix">
            <div class="cap-item">
              <span class="cap-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
              </span>
              <div class="cap-text">
                <strong>对话式交互</strong>
                <span class="cap-desc">自然语言驱动，智能理解合金设计意图</span>
              </div>
            </div>
            <div class="cap-item">
              <span class="cap-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              </span>
              <div class="cap-text">
                <strong>多 Agent 协作</strong>
                <span class="cap-desc">热力学、性能预测、数据库专家智能路由</span>
              </div>
            </div>
            <div class="cap-item">
              <span class="cap-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" /></svg>
              </span>
              <div class="cap-text">
                <strong>智能成分设计</strong>
                <span class="cap-desc">自动化生成铝合金成分与微观组织优化策略</span>
              </div>
            </div>
            <div class="cap-item">
              <span class="cap-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>
              </span>
              <div class="cap-text">
                <strong>专业工具集成</strong>
                <span class="cap-desc">Calphad 计算、Scheil 凝固、IDME 属性预测</span>
              </div>
            </div>
          </div>
        </div>

        <div class="brand-footer">
          <span>&copy; 2025 Changsha TopMaterial Technology Co., Ltd 湘ICP备2025130936号</span>
        </div>
      </div>

      <div class="geometric-bg">
        <div class="circle c1"></div>
        <div class="circle c2"></div>
        <div class="grid-mesh"></div>
      </div>
    </div>

    <!-- ===== 右侧：登录区 ===== -->
    <div class="form-side">
      <div class="form-container">
        <header class="form-header">
          <h2 class="title">欢迎使用</h2>
          <p class="subtitle">
            {{ authProvider === 'ferriskey' ? '使用 TopMaterial 企业账号登录' : '登录或注册以继续' }}
          </p>
        </header>

        <div class="form-body">

          <!-- DEV_MODE 横幅 -->
          <div v-if="isDevMode" class="dev-mode-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <span>开发模式已启用（DEV_MODE=true）</span>
          </div>

          <!-- ===== Supabase 邮箱/密码表单 ===== -->
          <div v-if="showSupabase" class="supabase-form">

            <!-- 登录 / 注册 Tab -->
            <div class="form-mode-tabs" v-if="!isDevMode">
              <button class="tab-btn" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
              <button class="tab-btn" :class="{ active: mode === 'register' }" @click="switchMode('register')">注册账号</button>
            </div>

            <!-- 消息提示 -->
            <div v-if="errorMsg" class="msg-error">{{ errorMsg }}</div>
            <div v-if="successMsg" class="msg-success">{{ successMsg }}</div>

            <!-- 注册：姓名（可选） -->
            <div v-if="mode === 'register'" class="form-field">
              <label>姓名<span class="label-optional">（可选）</span></label>
              <input
                v-model="name" type="text" placeholder="您的姓名"
                class="input-field" :disabled="loading"
              />
            </div>

            <!-- 邮箱 -->
            <div class="form-field">
              <label>邮箱地址</label>
              <input
                v-model="email" type="email" placeholder="your@email.com"
                class="input-field"
                :class="{ 'input-error': email && !emailValid }"
                :disabled="loading"
                @keyup.enter="handleSubmit"
                autocomplete="email"
              />
              <p v-if="email && !emailValid" class="field-error">邮箱格式不正确</p>
            </div>

            <!-- 密码 -->
            <div class="form-field">
              <div class="label-row">
                <label>密码</label>
                <button
                  v-if="mode === 'login'"
                  class="forgot-link"
                  @click="router.push('/reset-password')"
                  type="button"
                >忘记密码？</button>
              </div>
              <div class="input-wrapper">
                <input
                  v-model="password"
                  :type="showPwd ? 'text' : 'password'"
                  :placeholder="mode === 'register' ? '至少 8 位，建议包含字母、数字' : '请输入密码'"
                  class="input-field"
                  :disabled="loading"
                  @keyup.enter="handleSubmit"
                  autocomplete="current-password"
                />
                <button class="eye-btn" @click="showPwd = !showPwd" type="button" tabindex="-1">
                  <!-- 开眼：密码可见时显示 -->
                  <svg v-if="showPwd" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                    <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/>
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                  <!-- 斜线眼：密码隐藏时显示 -->
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                    <path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>
                  </svg>
                </button>
              </div>
              <!-- 注册时显示密码强度 -->
              <div v-if="mode === 'register' && passwordStrength" class="strength-bar">
                <div class="strength-track">
                  <div class="strength-fill" :style="{ width: passwordStrength.width, background: passwordStrength.color }"></div>
                </div>
                <span class="strength-label" :style="{ color: passwordStrength.color }">{{ passwordStrength.label }}</span>
              </div>
            </div>

            <!-- 注册：确认密码 -->
            <div v-if="mode === 'register'" class="form-field">
              <label>确认密码</label>
              <div class="input-wrapper">
                <input
                  v-model="confirmPassword"
                  :type="showConfirmPwd ? 'text' : 'password'"
                  placeholder="再次输入密码"
                  class="input-field"
                  :class="{ 'input-error': passwordsMatch === false, 'input-ok': passwordsMatch === true }"
                  :disabled="loading"
                  @keyup.enter="handleSubmit"
                  autocomplete="new-password"
                />
                <button class="eye-btn" @click="showConfirmPwd = !showConfirmPwd" type="button" tabindex="-1">
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

            <!-- 提交按钮 -->
            <button class="btn-submit" @click="handleSubmit" :disabled="loading">
              <svg v-if="!loading" class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              <span class="spinner" v-if="loading"></span>
              {{ mode === 'login' ? '登录' : '注册并激活' }}
            </button>
          </div>

          <!-- ===== 分割线 ===== -->
          <div v-if="showSupabase && showFerrisKey" class="divider">
            <span>或使用企业账号</span>
          </div>

          <!-- ===== FerrisKey SSO 按钮 ===== -->
          <button v-if="showFerrisKey" class="btn-sso" @click="startFerrisKeyLogin" :disabled="loading">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/>
            </svg>
            {{ showSupabase ? '使用 TopMaterial 企业 SSO 登录' : '登录 / TopMaterial 企业 SSO' }}
          </button>

          <p v-if="showFerrisKey && !showSupabase" class="login-hint">
            点击后将跳转到 TopMaterial 统一认证中心
          </p>

          <!-- 安全标识 -->
          <div class="security-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
              <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span>企业级安全认证 · 数据加密传输</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex; min-height: 100vh;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Inter', sans-serif;
  background: #ffffff; overflow: hidden;
}

/* ===== 左侧品牌区 ===== */
.brand-side {
  flex: 0 0 55%; background: #020617; position: relative;
  color: #fff; display: flex; flex-direction: column;
  padding: 80px; justify-content: space-between; overflow: hidden;
}
.brand-inner {
  position: relative; z-index: 10; height: 100%;
  display: flex; flex-direction: column; justify-content: space-between;
}
.logo-area { display: flex; align-items: center; }
.brand-logo { font-size: 1.5rem; font-weight: 800; color: #fff; letter-spacing: -0.5px; font-family: 'Inter', sans-serif; }
.hero-content { margin-bottom: 20%; }
.hero-title { font-size: 4rem; font-weight: 800; line-height: 1.4; letter-spacing: -3px; color: #fff; font-family: 'Inter', sans-serif; margin-bottom: 40px; }
@media (max-width: 1400px) { .brand-side { flex: 0 0 50%; } .hero-title { font-size: 3.5rem; } }
.hero-title .line { display: block; }
.hero-title .highlight { background: linear-gradient(120deg, #3b82f6, #06b6d4, #6366f1); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.hero-desc { font-size: 1.25rem; font-weight: 300; opacity: 0.8; max-width: 480px; line-height: 1.5; margin-bottom: 48px; }
.brand-footer { font-size: 0.75rem; opacity: 0.5; letter-spacing: 1px; }
.geometric-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden; z-index: 1; }
.circle { position: absolute; border-radius: 50%; filter: blur(100px); }
.c1 { width: 700px; height: 700px; background: #2563eb; top: -20%; right: -25%; opacity: 0.2; }
.c2 { width: 600px; height: 600px; background: #06b6d4; bottom: -20%; left: -20%; opacity: 0.15; }
.grid-mesh { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px); background-size: 40px 40px; opacity: 0.3; mask-image: radial-gradient(circle at 50% 50%, black, transparent 80%); }
.capability-matrix { margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; }
.cap-item { display: flex; align-items: flex-start; gap: 12px; }
.cap-icon { display: flex; width: 24px; height: 24px; align-items: center; justify-content: center; color: #3b82f6; margin-top: 2px; }
.cap-icon svg { width: 100%; height: 100%; }
.cap-text strong { font-size: 0.95rem; color: #fff; font-weight: 600; display: block; margin-bottom: 4px; }
.cap-desc { font-size: 0.8rem; color: rgba(255,255,255,0.5); line-height: 1.4; }

/* ===== 右侧登录区 ===== */
.form-side { flex: 1; display: flex; align-items: center; justify-content: center; background: #ffffff; }
.form-container { width: 100%; max-width: 440px; padding: 40px; }
.form-header { margin-bottom: 28px; }
.title { font-size: 2.2rem; font-weight: 800; color: #0f172a; margin-bottom: 10px; letter-spacing: -1px; }
.subtitle { color: #64748b; font-size: 1rem; }
.form-body { display: flex; flex-direction: column; width: 100%; }

/* DEV_MODE 横幅 */
.dev-mode-banner { display: flex; align-items: center; gap: 8px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 10px; padding: 10px 14px; margin-bottom: 20px; color: #92400e; font-size: 0.85rem; font-weight: 500; }

/* Tab */
.form-mode-tabs { display: flex; margin-bottom: 20px; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; }
.tab-btn { flex: 1; padding: 10px; border: none; background: #f8fafc; color: #64748b; font-size: 0.95rem; cursor: pointer; transition: all 0.2s; }
.tab-btn.active { background: #0f172a; color: #fff; font-weight: 600; }

/* 表单 */
.supabase-form { width: 100%; }
.form-field { margin-bottom: 16px; }
.form-field label { display: block; font-size: 0.875rem; font-weight: 500; color: #374151; margin-bottom: 6px; }
.label-optional { font-weight: 400; color: #94a3b8; margin-left: 4px; }
.label-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.label-row label { margin-bottom: 0; }

/* 忘记密码 */
.forgot-link {
  font-size: 0.8rem; color: #3b82f6; background: none; border: none;
  cursor: pointer; padding: 0; transition: color 0.2s;
}
.forgot-link:hover { color: #2563eb; text-decoration: underline; }

/* 输入框 */
.input-wrapper { position: relative; }
.input-field {
  width: 100%; height: 48px; padding: 0 44px 0 14px;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  font-size: 0.95rem; color: #0f172a; outline: none;
  transition: border-color 0.2s, box-shadow 0.2s; box-sizing: border-box; background: #fff;
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

/* 消息提示 */
.msg-error { padding: 10px 14px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 10px; color: #b91c1c; font-size: 0.875rem; margin-bottom: 14px; }
.msg-success { padding: 10px 14px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; color: #166534; font-size: 0.875rem; margin-bottom: 14px; }

/* 提交按钮 */
.btn-submit { width: 100%; height: 52px; background: #0f172a; color: #fff; border: none; border-radius: 12px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 4px; }
.btn-submit:hover:not(:disabled) { background: #1e293b; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.15); }
.btn-submit:disabled { opacity: 0.65; cursor: not-allowed; transform: none; }
.btn-icon { width: 20px; height: 20px; flex-shrink: 0; }

/* 加载 */
.spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 分割线 */
.divider { display: flex; align-items: center; gap: 12px; color: #94a3b8; font-size: 0.8rem; margin: 16px 0; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }

/* SSO 按钮 */
.btn-sso { width: 100%; height: 52px; background: #f8fafc; color: #374151; border: 1.5px solid #e2e8f0; border-radius: 12px; font-size: 1rem; font-weight: 500; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 10px; }
.btn-sso:hover:not(:disabled) { background: #f1f5f9; border-color: #cbd5e1; transform: translateY(-1px); }
.btn-sso:disabled { opacity: 0.65; cursor: not-allowed; }

.login-hint { margin-top: 12px; color: #94a3b8; font-size: 0.85rem; text-align: center; }

.security-badge { display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 0.8rem; margin-top: 24px; justify-content: center; }
.security-badge svg { color: #22c55e; flex-shrink: 0; }

@media (max-width: 1100px) {
  .brand-side { display: none; }
  .form-container { max-width: 100%; }
}
</style>
