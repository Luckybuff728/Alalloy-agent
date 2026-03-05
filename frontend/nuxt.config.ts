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
      devMode: process.env.DEV_MODE === 'true' || process.env.VITE_DEV_MODE === 'true',
      // 后端配置
      backendHost: process.env.VITE_BACKEND_HOST || 'localhost',
      backendPort: process.env.VITE_BACKEND_PORT || '8001',
      apiBaseUrl: process.env.VITE_API_BASE_URL,
      wsBaseUrl: process.env.VITE_WS_BASE_URL
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
