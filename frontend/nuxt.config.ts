/**
 * Nuxt 配置
 * 铝合金智能设计系统 v2.0 前端
 * 对齐涂层 Agent 技术栈：Element Plus + CSS 变量
 */
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',

  // 使用 app/ 目录结构（与涂层 Agent 保持一致）
  future: { compatibilityVersion: 4 },

  devtools: { enabled: false },
  experimental: {
    appManifest: false
  },

  devServer: {
    port: parseInt(process.env.VITE_DEV_PORT || '5174'),
    host: process.env.VITE_DEV_HOST || '0.0.0.0',
  },

  // 模块
  modules: [
    '@element-plus/nuxt',
    '@pinia/nuxt',
  ],

  // Element Plus 自动导入
  elementPlus: {
    importStyle: 'css',
  },

  // 全局 CSS
  css: [
    '~/assets/style.css',
    '~/assets/styles/responsive.css'
  ],

  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],

  imports: {
    dirs: ['stores']
  },

  vite: {
    server: {
      proxy: {
        '/api': {
          target: process.env.VITE_API_BASE_URL || `http://${process.env.VITE_BACKEND_HOST || 'localhost'}:${process.env.VITE_BACKEND_PORT || '8001'}`,
          changeOrigin: true
        },
        '/ws': {
          target: process.env.VITE_WS_BASE_URL || `ws://${process.env.VITE_BACKEND_HOST || 'localhost'}:${process.env.VITE_BACKEND_PORT || '8001'}`,
          ws: true
        }
      }
    }
  },

  runtimeConfig: {
    public: {
      // 开发模式：跳过 IAM 认证
      devMode: process.env.NUXT_PUBLIC_DEV_MODE === 'true' || process.env.VITE_DEV_MODE === 'true',
      // 后端配置
      // ★ 默认空字符串：生产 Nginx 代理场景下使用相对路径（/api/...）
      // 本地开发时在 frontend/.env 中设置 VITE_BACKEND_HOST=localhost
      backendHost: process.env.VITE_BACKEND_HOST || '',
      backendPort: process.env.VITE_BACKEND_PORT || '8001',
      apiBaseUrl: process.env.VITE_API_BASE_URL,
      wsBaseUrl: process.env.VITE_WS_BASE_URL,
      // 登录方式控制（可在部署时通过 NUXT_PUBLIC_AUTH_PROVIDER 覆盖，无需重新打包）
      // 可选值：'both'（同时显示两种入口）| 'supabase'（仅甲方）| 'ferriskey'（仅内部）
      authProvider: process.env.NUXT_PUBLIC_AUTH_PROVIDER || 'both',
      // Supabase 配置（NUXT_PUBLIC_ 前缀，运行时可覆盖）
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    }
  },

  // SSR 关闭（纯 SPA 模式，支持科学计算库）
  ssr: false,

  // 应用元信息
  app: {
    head: {
      title: '铝合金智能设计系统',
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }
      ],
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'AI 驱动的铝合金智能设计系统 v2.0' }
      ]
    },
  },
})
