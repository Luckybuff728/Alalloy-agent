/**
 * FerrisKey 认证 Store (铝合金 Agent v2)
 *
 * 使用 FerrisKey (TopMat Trust) OIDC 进行用户认证。
 * 支持 DEV_MODE 和生产环境的统一流程。
 *
 * Token 管理：
 * - accessToken: FerrisKey 颁发的 Access Token (用于 API 和 WebSocket 认证)
 * - refreshToken: FerrisKey 颁发的 Refresh Token (用于刷新 Access Token)
 */
import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    // FerrisKey Access Token (持久化到 localStorage)
    token: (typeof window !== 'undefined' && localStorage.getItem('auth_token')) || '',
    // FerrisKey Refresh Token (持久化到 localStorage)
    refreshToken: (typeof window !== 'undefined' && localStorage.getItem('refresh_token')) || '',
    // 用户信息
    user: null,
    // 是否已初始化
    initialized: false,
    // Token 刷新定时器 ID
    _refreshTimerId: null
  }),

  getters: {
    /**
     * 是否已认证
     */
    isAuthenticated: state => !!state.token && !!state.user
  },

  actions: {
    /**
     * 设置认证信息（OIDC 回调成功后调用）
     *
     * @param {string} accessToken - FerrisKey Access Token
     * @param {string} refreshToken - FerrisKey Refresh Token
     * @param {object} user - 用户信息（可选，可通过 /me 获取）
     */
    setAuth(accessToken, refreshToken = null, user = null) {
      this.token = accessToken
      this.user = user
      this.initialized = true

      if (refreshToken) {
        this.refreshToken = refreshToken
      }

      // 持久化 Token 到 localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('auth_token', accessToken)
        if (refreshToken) {
          localStorage.setItem('refresh_token', refreshToken)
        }
      }

      console.log('[AuthStore] 认证信息已设置:', user?.email || user?.username || '(待获取)')

      // 自动调度 Token 刷新
      this.scheduleTokenRefresh()
    },

    /**
     * 解析 JWT Token 的过期时间
     * @returns {number|null} - 过期时间戳（毫秒），解析失败返回 null
     */
    _parseTokenExpiration() {
      if (!this.token) return null

      try {
        const parts = this.token.split('.')
        if (parts.length !== 3) return null

        const payload = JSON.parse(atob(parts[1]))
        if (!payload.exp) return null

        return payload.exp * 1000
      } catch (e) {
        console.warn('[AuthStore] JWT 解析失败:', e.message)
        return null
      }
    },

    /**
     * 调度 Token 刷新
     * 在 Token 过期前 1 分钟自动使用 refresh_token 刷新
     */
    scheduleTokenRefresh() {
      if (typeof window === 'undefined') return

      // 清除已有的定时器
      if (this._refreshTimerId) {
        clearTimeout(this._refreshTimerId)
        this._refreshTimerId = null
      }

      const expTime = this._parseTokenExpiration()
      if (!expTime) {
        // 无法解析过期时间，使用定时轮询（适用于 DEV_MODE 的长期 Token）
        console.log('[AuthStore] 无法解析过期时间，使用 4 分钟轮询刷新')
        this._refreshTimerId = setTimeout(() => this._performRefresh(), 4 * 60 * 1000)
        return
      }

      const now = Date.now()
      const REFRESH_BUFFER = 60 * 1000  // 过期前 1 分钟刷新
      const refreshAt = expTime - REFRESH_BUFFER
      const delay = refreshAt - now

      if (delay <= 0) {
        console.log('[AuthStore] Token 即将过期，立即刷新...')
        this._performRefresh()
      } else {
        const refreshInSeconds = Math.round(delay / 1000)
        console.log(`[AuthStore] Token 刷新已调度，将在 ${refreshInSeconds} 秒后执行`)
        this._refreshTimerId = setTimeout(() => this._performRefresh(), delay)
      }
    },

    /**
     * 执行 Token 刷新
     */
    async _performRefresh() {
      console.log('[AuthStore] 正在刷新 Token...')

      if (!this.refreshToken) {
        console.warn('[AuthStore] 无 Refresh Token，尝试验证现有 Token...')
        const isValid = await this.validateToken()
        if (!isValid) {
          console.warn('[AuthStore] ❌ Token 刷新失败，用户需要重新登录')
          this.logout()
        }
        return
      }

      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: this.refreshToken })
        })

        if (!res.ok) {
          console.warn('[AuthStore] ❌ Refresh Token 无效或已过期')
          this.logout()
          return
        }

        const data = await res.json()

        // 更新所有 Token
        this.token = data.access_token
        this.refreshToken = data.refresh_token || this.refreshToken

        // 更新 localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', this.token)
          if (data.refresh_token) {
            localStorage.setItem('refresh_token', data.refresh_token)
          }
        }

        console.log('[AuthStore] ✅ Token 刷新成功')
        // 重新调度下一次刷新
        this.scheduleTokenRefresh()
      } catch (e) {
        console.error('[AuthStore] Token 刷新异常:', e.message)
        this.logout()
      }
    },

    /**
     * 验证当前 Token 是否有效，并获取用户信息
     *
     * @returns {Promise<boolean>} - Token 是否有效
     */
    async validateToken() {
      if (!this.token) return false

      try {
        const res = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        })

        if (!res.ok) {
          console.warn('[AuthStore] Token 验证失败:', res.status)
          return false
        }

        const data = await res.json()
        if (data.user) {
          this.user = data.user
          console.log('[AuthStore] Token 验证成功:', data.user?.email)
          return true
        }
        return false

      } catch (e) {
        console.error('[AuthStore] Token 验证异常:', e.message)
        return false
      }
    },

    /**
     * 初始化认证状态
     * 在应用启动时调用，检查已存储的 Token 是否有效
     */
    async init() {
      if (this.initialized) return

      // 如果当前在 /callback 页面，跳过自动登录（让 callback.vue 先处理 URL 参数）
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
      if (currentPath === '/callback') {
        console.log('[AuthStore] 当前在 /callback 页面，等待回调处理...')
        this.initialized = true
        return
      }

      if (this.token) {
        console.log('[AuthStore] 检测到已存储 Token，验证中...')
        const isValid = await this.validateToken()

        if (isValid) {
          console.log('[AuthStore] ✅ Token 有效，已登录')
          this.scheduleTokenRefresh()
        } else {
          console.log('[AuthStore] ❌ Token 无效，尝试刷新...')
          if (this.refreshToken) {
            await this._performRefresh()
            // 如果刷新成功，再次验证以获取用户信息
            if (this.token) {
              await this.validateToken()
            }
          } else {
            // 无 refresh_token，清除无效 Token
            console.log('[AuthStore] Token 无效且无法刷新，已清除')
            this.clearTokens()
          }
        }
      } else {
        // 无 Token
        console.log('[AuthStore] 未检测到 Token')
      }

      this.initialized = true
    },

    /**
     * 清除无效 Token（不触发登出通知）
     */
    clearTokens() {
      this.token = ''
      this.refreshToken = ''
      this.user = null
      
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('refresh_token')
      }
      
      console.log('[AuthStore] 已清除无效 Token')
    },

    /**
     * 触发登录流程
     * 重定向到后端 /api/auth/login，由后端决定是 DEV_MODE 签发还是跳转 OIDC
     */
    _triggerLogin() {
      if (typeof window !== 'undefined') {
        console.log('[AuthStore] 重定向到登录入口...')
        window.location.href = '/api/auth/login'
      }
    },

    /**
     * 登出
     */
    async logout() {
      // 清除刷新定时器
      if (this._refreshTimerId) {
        clearTimeout(this._refreshTimerId)
        this._refreshTimerId = null
      }

      // 通知后端登出（清除 FerrisKey SSO Session）
      if (this.refreshToken) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.refreshToken })
          })
        } catch (e) {
          console.warn('[AuthStore] 登出通知失败 (非关键):', e.message)
        }
      }

      // 清除状态
      this.token = ''
      this.refreshToken = ''
      this.user = null

      // 清除 localStorage
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('refresh_token')
      }

      console.log('[AuthStore] 已登出')
    }
  }
})
