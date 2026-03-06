/**
 * useSupabase — 全局唯一 Supabase 客户端（单例）
 *
 * 为什么这样设计：
 * - Nuxt 3 composable，自动在正确的上下文中调用 useRuntimeConfig()
 * - detectSessionInUrl: true  → 自动解析密码重置/魔法链接 URL hash 中的 token
 * - persistSession: false     → auth.js 自己管理 token 持久化（避免双重存储冲突）
 * - autoRefreshToken: false   → auth.js 自己调度刷新时机（精确控制）
 *
 * 使用场景：
 *   const supabase = useSupabase()
 *   await supabase.auth.signInWithPassword({ email, password })
 *   await supabase.auth.resetPasswordForEmail(email, { redirectTo: '...' })
 *   await supabase.auth.updateUser({ password: newPassword })
 *   supabase.auth.onAuthStateChange((event, session) => { ... })
 */
import { createClient } from '@supabase/supabase-js'

let _client = null

export function useSupabase() {
  if (_client) return _client

  // useRuntimeConfig() 在 Nuxt composable 上下文中安全调用
  const config = useRuntimeConfig()
  const url = config.public?.supabaseUrl || ''
  const anonKey = config.public?.supabaseAnonKey || ''

  if (!url || !anonKey) {
    console.warn('[useSupabase] Supabase URL 或 anonKey 未配置，请检查 frontend/.env')
    return null
  }

  _client = createClient(url, anonKey, {
    auth: {
      persistSession: false,    // auth.js 负责 localStorage 持久化
      autoRefreshToken: false,  // auth.js 负责 token 刷新调度
      detectSessionInUrl: true, // ★ 自动从 URL hash 中读取 recovery/magic-link token
    }
  })

  console.log('[useSupabase] Supabase 客户端已初始化')
  return _client
}
