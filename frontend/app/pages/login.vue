<script setup>
/**
 * 登录页面 (FerrisKey OIDC 版本)
 *
 * 简化为单按钮重定向模式：
 * 点击「登录」→ 重定向到 FerrisKey 登录页 → 认证成功后回调到 /callback
 *
 * 保留品牌展示左侧面板和 Premium 设计风格。
 */
import { onMounted } from 'vue'

const authStore = useAuthStore()
const router = useRouter()

/**
 * 发起 OIDC 登录
 * 跳转到后端 /api/auth/login 接口，后端会 302 重定向到 FerrisKey 登录页
 */
function startLogin() {
  window.location.href = '/api/auth/login'
}

// 如果已登录，直接跳转主页
onMounted(() => {
  if (authStore.isAuthenticated) router.push('/')
})
</script>

<template>
  <div class="auth-page">
    <!-- Left: Brand Surface (Wider 55%) -->
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

          <!-- Core Capability Matrix -->
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
          <span>&copy; Copyright © 2025 Changsha TopMaterial Technology Co., Ltd 湘ICP备2025130936号 (Hunan ICP Registration No. 2025130936).</span>
        </div>
      </div>

      <!-- Abstract Geometric Background -->
      <div class="geometric-bg">
        <div class="circle c1"></div>
        <div class="circle c2"></div>
        <div class="grid-mesh"></div>
      </div>
    </div>

    <!-- Right: Login Action Area -->
    <div class="form-side">
      <div class="form-container">
        <header class="form-header">
          <h2 class="title">欢迎使用</h2>
          <p class="subtitle">使用 TopMaterial 账号登录以继续</p>
        </header>

        <div class="form-body">
          <!-- 统一登录按钮 -->
          <button class="btn-submit" @click="startLogin">
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            登录 / 注册
          </button>

          <p class="login-hint">
            点击后将跳转到 TopMaterial 统一认证中心
          </p>

          <!-- 安全提示 -->
          <div class="security-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
              <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span>企业级安全认证 · 支持 SSO 单点登录</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* =================== 全局样式 =================== */
.auth-page {
  display: flex;
  min-height: 100vh;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'Inter', sans-serif;
  background: #ffffff;
  overflow: hidden;
}

/* =================== 左侧：宽版品牌区 (55%) =================== */
.brand-side {
  flex: 0 0 55%;
  background: #020617; /* Slate 950 */
  position: relative;
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 80px;
  justify-content: space-between;
  overflow: hidden;
}

.brand-inner {
  position: relative;
  z-index: 10;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.logo-area {
  display: flex;
  align-items: center;
}

/* Runway-style Bold Text Logo */
.brand-logo {
  font-size: 1.5rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.5px;
  font-family: 'Inter', sans-serif;
}

.hero-content {
  margin-bottom: 20%;
}

.hero-title {
  font-size: 4rem;
  font-weight: 800;
  line-height: 1.4;
  letter-spacing: -3px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  margin-bottom: 40px;
}

/* 屏幕适配 */
@media (max-width: 1400px) {
    .brand-side { flex: 0 0 50%; }
    .hero-title { font-size: 3.5rem; }
}

.hero-title .line { display: block; }

/* 蓝色系高亮渐变 */
.hero-title .highlight {
  background: linear-gradient(120deg, #3b82f6, #06b6d4, #6366f1);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-desc {
  font-size: 1.25rem;
  font-weight: 300;
  opacity: 0.8;
  max-width: 480px;
  line-height: 1.5;
  margin-bottom: 48px;
}

.brand-footer {
  font-size: 0.75rem;
  opacity: 0.5;
  letter-spacing: 1px;
}

/* 抽象背景艺术 */
.geometric-bg {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  overflow: hidden;
  z-index: 1;
}

.circle {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.5;
}

.c1 {
  width: 700px; height: 700px;
  background: #2563eb;
  top: -20%; right: -25%;
  opacity: 0.2;
}

.c2 {
  width: 600px; height: 600px;
  background: #06b6d4;
  bottom: -20%; left: -20%;
  opacity: 0.15;
}

.grid-mesh {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px);
  background-size: 40px 40px;
  opacity: 0.3;
  mask-image: radial-gradient(circle at 50% 50%, black, transparent 80%);
}


/* =================== 右侧：登录区 =================== */
.form-side {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}

.form-container {
  width: 100%;
  max-width: 440px;
  padding: 40px;
}

.form-header { margin-bottom: 48px; }

.title {
  font-size: 2.2rem;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 12px;
  letter-spacing: -1px;
}

.subtitle { color: #64748b; font-size: 1rem; }

.form-body {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.btn-submit {
  width: 100%;
  height: 56px;
  background: #0f172a;
  color: #fff;
  border: none;
  border-radius: 14px;
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.btn-submit:hover {
  background: #1e293b;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15);
}

.btn-icon {
  width: 20px;
  height: 20px;
}

.login-hint {
  margin-top: 20px;
  color: #94a3b8;
  font-size: 0.85rem;
  text-align: center;
}

.security-badge {
  margin-top: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 0.8rem;
}

.security-badge svg {
  color: #22c55e;
  flex-shrink: 0;
}

/* 功能矩阵 */
.capability-matrix {
  margin-top: 48px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px 32px;
}

.cap-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.cap-icon {
  display: flex;
  width: 24px; height: 24px;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
  margin-top: 2px;
}
.cap-icon svg { width: 100%; height: 100%; }

.cap-text strong {
  font-size: 0.95rem;
  color: #fff;
  font-weight: 600;
  display: block;
  margin-bottom: 4px;
}

.cap-desc {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.5);
  line-height: 1.4;
}

/* Responsive Hide */
@media (max-width: 1100px) {
  .brand-side { display: none; }
  .form-container { max-width: 100%; }
}
</style>
