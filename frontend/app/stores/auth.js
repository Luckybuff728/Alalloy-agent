/**
 * Multi-Auth 认证 Store (铝合金 Agent v2.1)
 *
 * 支持三种登录来源，统一管理 Token 状态：
 *
 * | authSource   | 登录方式           | 刷新方式              | 登出方式              |
 * |--------------|--------------------|-----------------------|-----------------------|
 * | dev_mode     | 后端 /api/auth/login (DEV_MODE) | 后端 /api/auth/refresh | 本地清除              |
 * | ferriskey    | 后端 /api/auth/login → OIDC    | 后端 /api/auth/refresh | 后端 /api/auth/logout |
 * | supabase     | 前端 Supabase SDK  | 前端 Supabase SDK     | 前端 SDK + 后端通知   |
 *
 * Token 管理：
 * - auth_token    → localStorage (access token)
 * - refresh_token → localStorage (refresh token)
 * - auth_source   → localStorage ("dev_mode" | "ferriskey" | "supabase")
 */
import { defineStore } from 'pinia'

// Supabase 客户端通过 useSupabase() composable 获取（单例，在 composables/useSupabase.js 定义）
// 不在这里重复初始化，避免双实例问题

// ===================== Store 定义 =====================

export const useAuthStore = defineStore('auth', {
  state: () => ({
    // Access Token（持久化到 localStorage）
    token: (typeof window !== 'undefined' && localStorage.getItem('auth_token')) || '',
    // Refresh Token（持久化到 localStorage）
    refreshToken: (typeof window !== 'undefined' && localStorage.getItem('refresh_token')) || '',
    // 登录来源标记（持久化到 localStorage）
    authSource: (typeof window !== 'undefined' && localStorage.getItem('auth_source')) || '',
    // 用户信息
    user: null,
    // 是否已完成初始化
    initialized: false,
    // Token 刷新定时器 ID
    _refreshTimerId: null,
  }),

  getters: {
    /**
     * 是否已认证（token + user 双重确认）
     */
    isAuthenticated: state => !!state.token && !!state.user,

    /**
     * 是否为 Supabase 登录
     */
    isSupabaseAuth: state => state.authSource === 'supabase',
  },

  actions: {
    // ===================== 核心：设置认证状态 =====================

    /**
     * 设置认证信息（各登录方式成功后调用）
     *
     * @param {string} accessToken  - JWT Access Token
     * @param {string} refreshToken - Refresh Token（可选）
     * @param {object} user         - 用户信息（可选，可后续通过 /me 获取）
     * @param {string} source       - 登录来源："dev_mode" | "ferriskey" | "supabase"
     */
    setAuth(accessToken, refreshToken = null, user = null, source = '') {
      this.token = accessToken
      this.user = user
      this.initialized = true

      if (refreshToken) this.refreshToken = refreshToken
      if (source) this.authSource = source

      if (typeof window !== 'undefined') {
        localStorage.setItem('auth_token', accessToken)
        if (refreshToken) localStorage.setItem('refresh_token', refreshToken)
        if (source) localStorage.setItem('auth_source', source)
      }

      console.log(`[AuthStore] 认证信息已设置 (source=${source || this.authSource}):`, user?.email || user?.username || '(待获取)')
      this.scheduleTokenRefresh()
    },

    // ===================== Supabase 登录 =====================

    /**
     * 使用邮箱/密码登录（Supabase Auth，纯前端直连）
     *
     * @param {string} email
     * @param {string} password
     * @returns {{ success: boolean, error?: string }}
     */
    async loginWithSupabase(email, password) {
      const supabase = useSupabase()
      if (!supabase) {
        return { success: false, error: 'Supabase 服务未配置' }
      }

      try {
        console.log('[AuthStore] Supabase 登录中...')
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })

        if (error) {
          console.warn('[AuthStore] Supabase 登录失败:', error.message)
          return { success: false, error: _translateSupabaseError(error) }
        }

        const { session } = data

        // 先写入 token（供 validateToken 的 Authorization header 使用）
        this.token = session.access_token
        this.refreshToken = session.refresh_token
        this.authSource = 'supabase'
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', session.access_token)
          localStorage.setItem('refresh_token', session.refresh_token)
          localStorage.setItem('auth_source', 'supabase')
        }

        // ★ 关键：必须等后端 /me 验证通过才算登录成功
        // 如果后端验签失败（JWKS 未就绪、密钥不匹配等），这里会返回 false
        const isValid = await this.validateToken()
        if (!isValid) {
          console.error('[AuthStore] ❌ 后端验证 Supabase Token 失败')
          this.clearTokens()
          return { success: false, error: '后端验证失败，请确认服务配置或稍后重试' }
        }

        this.initialized = true
        this.scheduleTokenRefresh()
        console.log('[AuthStore] ✅ Supabase 登录成功:', email)
        return { success: true }
      } catch (e) {
        console.error('[AuthStore] Supabase 登录异常:', e.message)
        this.clearTokens()
        return { success: false, error: '登录服务暂时不可用，请稍后重试' }
      }
    },

    /**
     * 注册新用户（通过后端代理，使用 Service Key 跳过邮件验证）
     *
     * @param {string} email
     * @param {string} password
     * @param {string} name     - 可选姓名
     * @returns {{ success: boolean, error?: string }}
     */
    async registerWithSupabase(email, password, name = '') {
      try {
        console.log('[AuthStore] Supabase 注册中...')
        const res = await fetch('/api/auth/supabase/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name })
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { success: false, error: err.detail || '注册失败，请检查邮箱格式和密码强度' }
        }

        const data = await res.json()
        console.log('[AuthStore] ✅ 注册成功:', data.email)
        return { success: true, message: '注册成功，请使用邮箱密码登录' }
      } catch (e) {
        console.error('[AuthStore] 注册异常:', e.message)
        return { success: false, error: '注册服务暂时不可用' }
      }
    },

    // ===================== Token 刷新 =====================

    /**
     * 解析 JWT Token 过期时间
     * @returns {number|null} 过期时间戳（毫秒）
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
     * 调度 Token 自动刷新
     */
    scheduleTokenRefresh() {
      if (typeof window === 'undefined') return
      if (this._refreshTimerId) {
        clearTimeout(this._refreshTimerId)
        this._refreshTimerId = null
      }

      const expTime = this._parseTokenExpiration()
      if (!expTime) {
        // 无法解析过期时间，使用定时轮询
        console.log('[AuthStore] 无法解析过期时间，使用 4 分钟轮询刷新')
        this._refreshTimerId = setTimeout(() => this._performRefresh(), 4 * 60 * 1000)
        return
      }

      const now = Date.now()
      const REFRESH_BUFFER = 60 * 1000 // 过期前 1 分钟刷新
      const delay = expTime - REFRESH_BUFFER - now

      if (delay <= 0) {
        console.log('[AuthStore] Token 即将过期，立即刷新...')
        this._performRefresh()
      } else {
        console.log(`[AuthStore] Token 刷新已调度，将在 ${Math.round(delay / 1000)} 秒后执行`)
        this._refreshTimerId = setTimeout(() => this._performRefresh(), delay)
      }
    },

    /**
     * 执行 Token 刷新（按 authSource 分支）
     */
    async _performRefresh() {
      console.log(`[AuthStore] 刷新 Token (source=${this.authSource})...`)

      if (!this.refreshToken) {
        console.warn('[AuthStore] 无 Refresh Token，验证现有 Token...')
        const isValid = await this.validateToken()
        if (!isValid) {
          console.warn('[AuthStore] ❌ Token 失效，需要重新登录')
          this.logout()
        }
        return
      }

      // Supabase 刷新：直接调 SDK，不走后端
      if (this.authSource === 'supabase') {
        await this._refreshSupabaseToken()
        return
      }

      // FerrisKey / DEV_MODE：调后端 /api/auth/refresh
      await this._refreshFerrisKeyToken()
    },

    async _refreshSupabaseToken() {
      const supabase = useSupabase()
      if (!supabase) {
        console.warn('[AuthStore] Supabase 客户端不可用，登出')
        this.logout()
        return
      }
      try {
        const { data, error } = await supabase.auth.refreshSession({
          refresh_token: this.refreshToken
        })
        if (error || !data?.session) {
          console.warn('[AuthStore] ❌ Supabase Token 刷新失败:', error?.message)
          this.logout()
          return
        }
        this.token = data.session.access_token
        this.refreshToken = data.session.refresh_token
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', this.token)
          localStorage.setItem('refresh_token', this.refreshToken)
        }
        console.log('[AuthStore] ✅ Supabase Token 刷新成功')
        this.scheduleTokenRefresh()
      } catch (e) {
        console.error('[AuthStore] Supabase Token 刷新异常:', e.message)
        this.logout()
      }
    },

    async _refreshFerrisKeyToken() {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refresh_token: this.refreshToken,
            source: this.authSource || 'ferriskey',
          })
        })
        if (!res.ok) {
          console.warn('[AuthStore] ❌ FerrisKey Refresh Token 无效或已过期')
          this.logout()
          return
        }
        const data = await res.json()
        this.token = data.access_token
        this.refreshToken = data.refresh_token || this.refreshToken
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_token', this.token)
          if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token)
        }
        console.log('[AuthStore] ✅ FerrisKey Token 刷新成功')
        this.scheduleTokenRefresh()
      } catch (e) {
        console.error('[AuthStore] FerrisKey Token 刷新异常:', e.message)
        this.logout()
      }
    },

    // ===================== Token 验证 =====================

    /**
     * 验证当前 Token 并获取用户信息
     * @returns {Promise<boolean>}
     */
    async validateToken() {
      if (!this.token) return false
      try {
        const res = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
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

    // ===================== 初始化 =====================

    /**
     * 应用启动时初始化认证状态
     */
    async init() {
      if (this.initialized) return

      const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
      if (currentPath === '/callback') {
        console.log('[AuthStore] 当前在 /callback 页面，等待回调处理...')
        this.initialized = true
        return
      }

      // ★ 如果是 Supabase 用户，在 Nuxt 上下文内预热 Supabase 客户端单例
      // 确保后续 setTimeout 回调（token 刷新）中调用 useSupabase() 时直接返回缓存实例
      // 而不会因在 setTimeout 上下文中调用 useRuntimeConfig() 而报错
      if (this.authSource === 'supabase') {
        useSupabase()
      }

      // ★ 模式切换检测：DEV_MODE → 生产模式时，旧 dev token 必须清除
      // 否则会产生"旧 dev token 去打 Supabase/FerrisKey 验证链，全部 401"的噪音
      if (this.token && this.authSource === 'dev_mode') {
        let currentDevMode = false
        if (typeof useRuntimeConfig === 'function') {
          try { currentDevMode = useRuntimeConfig().public?.devMode || false } catch (_) {}
        }
        if (!currentDevMode) {
          console.log('[AuthStore] 检测到模式切换（dev_mode → 生产），清除旧 dev token')
          this.clearTokens()
        }
      }

      if (this.token) {
        console.log(`[AuthStore] 检测到已存储 Token (source=${this.authSource})，验证中...`)
        const isValid = await this.validateToken()

        if (isValid) {
          console.log('[AuthStore] ✅ Token 有效，已登录')
          this.scheduleTokenRefresh()
        } else {
          console.log('[AuthStore] ❌ Token 无效，尝试刷新...')
          if (this.refreshToken) {
            await this._performRefresh()
            // 刷新后再验证一次（刷新可能也失败并已 clearTokens）
            if (this.token) {
              const refreshValid = await this.validateToken()
              if (!refreshValid) {
                console.log('[AuthStore] 刷新后仍无效，清除')
                this.clearTokens()
              }
            }
          } else {
            console.log('[AuthStore] Token 无效且无法刷新，已清除')
            this.clearTokens()
          }
        }
      } else {
        console.log('[AuthStore] 未检测到 Token')
      }

      this.initialized = true
    },

    // ===================== 登出 =====================

    /**
     * 登出（按 authSource 分支清理 Server Session）
     *
     * ★ 关键设计：clearTokens() 必须在所有异步操作之前执行（乐观状态更新）
     *   - 立即清除本地状态 → isAuthenticated 立刻变 false → app.vue watcher 触发路由跳转
     *   - server 端清理（signOut / backend API）在后台异步完成，不阻塞用户体验
     *   - 如果异步清理失败（网络异常等），本地已登出，风险可控
     */
    async logout() {
      if (this._refreshTimerId) {
        clearTimeout(this._refreshTimerId)
        this._refreshTimerId = null
      }

      // ★ 先记录 source 和 refreshToken，因为 clearTokens() 会清除它们
      const prevSource = this.authSource
      const prevRefreshToken = this.refreshToken

      // ★ 立即清除本地状态（使 isAuthenticated 立刻变 false，路由守卫正常工作）
      this.clearTokens()
      console.log('[AuthStore] 已登出（本地状态已清除）')

      // Server 端清理（后台执行，不阻塞导航）
      if (prevSource === 'supabase') {
        const supabase = useSupabase()
        if (supabase) {
          supabase.auth.signOut().catch(e =>
            console.warn('[AuthStore] Supabase signOut 失败 (非关键):', e.message)
          )
        }
        fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'supabase' })
        }).catch(() => {})

      } else if (prevRefreshToken && !prevRefreshToken.startsWith('dev-')) {
        fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refresh_token: prevRefreshToken,
            source: prevSource || 'ferriskey',
          })
        }).catch(e =>
          console.warn('[AuthStore] FerrisKey 登出通知失败 (非关键):', e.message)
        )
      }
    },

    /**
     * 清除所有认证状态（不触发远程登出）
     */
    clearTokens() {
      this.token = ''
      this.refreshToken = ''
      this.authSource = ''
      this.user = null

      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('auth_source')
      }

      console.log('[AuthStore] 认证状态已清除')
    },

    /**
     * 触发 FerrisKey/DEV_MODE 登录（跳转后端入口）
     */
    _triggerLogin() {
      if (typeof window !== 'undefined') {
        console.log('[AuthStore] 重定向到 FerrisKey 登录入口...')
        window.location.href = '/api/auth/login'
      }
    },
  }
})

// ===================== 工具函数 =====================

/**
 * 将 Supabase Auth 错误转为用户友好的中文提示
 */
function _translateSupabaseError(error) {
  const msg = error.message || ''
  if (msg.includes('Invalid login credentials')) return '邮箱或密码错误'
  if (msg.includes('Email not confirmed')) return '请先验证您的邮箱后再登录'
  if (msg.includes('Too many requests')) return '登录尝试过于频繁，请稍后重试'
  if (msg.includes('User not found')) return '用户不存在，请先注册'
  if (msg.includes('network') || msg.includes('fetch')) return '网络异常，请检查网络连接'
  return msg || '登录失败，请重试'
}
