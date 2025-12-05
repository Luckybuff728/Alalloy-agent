/// <reference types="vite/client" />

/**
 * Vite 环境变量类型声明
 */
interface ImportMetaEnv {
  /** WebSocket 连接地址 */
  readonly VITE_WS_URL: string
  /** 后端 API 地址 */
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
