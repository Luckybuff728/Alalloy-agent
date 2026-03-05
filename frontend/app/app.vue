<script setup>
/**
 * Alalloy Agent 前端入口
 * 
 * 认证逻辑：
 * - 初始化时验证已存储的 Token
 * - 未登录跳转到登录页
 * - 已登录显示主界面
 */
import { onMounted, watch } from 'vue'
import { useAuthStore } from './stores/auth'

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

// 初始化认证状态
onMounted(async () => {
  if (process.client) {
    await authStore.init()
  }
})

// 监听认证状态，在初始化完成后执行路由守卫
watch(
  () => [authStore.initialized, authStore.isAuthenticated, route.path],
  ([initialized, isAuthenticated, path]) => {
    // 允许访问 /login 和 /callback（OIDC 回调）
    if (initialized && !isAuthenticated && path !== '/login' && path !== '/callback') {
      console.log('[App] 未登录，跳转至登录页')
      router.replace('/login')
    }
    // 已登录但在登录页，跳转到首页
    if (initialized && isAuthenticated && path === '/login') {
      console.log('[App] 已登录，跳转至首页')
      router.replace('/')
    }
  },
  { immediate: true }
)
</script>

<template>
  <div>
    <!-- 认证初始化中显示加载状态 -->
    <div v-if="!authStore.initialized" class="loading-screen">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <p>正在验证身份...</p>
      </div>
    </div>
    
    <!-- 初始化完成后渲染页面 -->
    <NuxtPage v-else />
  </div>
</template>

<style scoped>
.loading-screen {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base, #f5f7fa);
}

.loading-content {
  text-align: center;
  color: var(--text-secondary, #666);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-light, #e0e0e0);
  border-top-color: var(--primary, #409eff);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
