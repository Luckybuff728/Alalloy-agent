<template>
  <div class="callback-page">
    <div class="loading-container">
      <el-icon class="loading-icon" :size="48">
        <Loading />
      </el-icon>
      <p class="loading-text">{{ message }}</p>
    </div>
  </div>
</template>

<script setup>
/**
 * OIDC 回调处理页面
 * 
 * 处理后端重定向回来的 Token 参数，存储后跳转到首页。
 * 使用 history.replaceState 清理 URL 中的敏感 Token 信息。
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Loading } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const message = ref('正在处理登录...')

onMounted(async () => {
  try {
    // 解析 URL 参数
    const urlParams = new URLSearchParams(window.location.search)
    const accessToken = urlParams.get('access_token')
    const refreshToken = urlParams.get('refresh_token')
    const error = urlParams.get('error')
    const errorDescription = urlParams.get('error_description')

    // 立即清理 URL 中的敏感信息
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, '/callback')
    }

    // 检查错误
    if (error) {
      message.value = `登录失败: ${errorDescription || error}`
      console.error('[Callback] 认证错误:', error, errorDescription)
      
      // 3 秒后跳转到登录页或首页
      setTimeout(() => {
        router.replace('/')
      }, 3000)
      return
    }

    // 检查 Token
    if (!accessToken) {
      message.value = '未收到认证令牌，请重新登录'
      console.error('[Callback] 缺少 access_token')
      
      setTimeout(() => {
        router.replace('/')
      }, 2000)
      return
    }

    // 存储 Token
    authStore.setAuth(accessToken, refreshToken)
    message.value = '登录成功，正在获取用户信息...'

    // 获取用户信息
    const isValid = await authStore.validateToken()
    if (isValid) {
      message.value = '登录成功，正在跳转...'
      console.log('[Callback] ✅ 认证完成，跳转到首页')
    } else {
      message.value = '获取用户信息失败，但已登录'
      console.warn('[Callback] 获取用户信息失败')
    }

    // 跳转到首页
    router.replace('/')

  } catch (e) {
    console.error('[Callback] 处理异常:', e)
    message.value = '处理登录时发生错误'
    
    setTimeout(() => {
      router.replace('/')
    }, 2000)
  }
})
</script>

<style scoped>
.callback-page {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: var(--bg-primary, #f5f7fa);
}

.loading-container {
  text-align: center;
  padding: 40px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.loading-icon {
  color: var(--primary-color, #409eff);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-text {
  margin-top: 16px;
  color: var(--text-secondary, #606266);
  font-size: 14px;
}
</style>
