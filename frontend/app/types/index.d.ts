/**
 * 核心类型定义
 * 
 * 为 Agent 前端提供类型安全保障
 */

// ==================== WebSocket 事件类型 ====================

/**
 * WebSocket 事件类型枚举
 */
export type WSEventType =
  | 'connected'
  | 'chat_token'
  | 'chat_complete'
  | 'tool_call_start'
  | 'tool_call_args'
  | 'tool_ready'
  | 'tool_end'
  | 'tool_result'
  | 'thinking_start'
  | 'thinking_token'
  | 'thinking_end'
  | 'interrupt'
  | 'resume'
  | 'error'
  | 'session_state'

/**
 * WebSocket 事件基础结构
 */
export interface WSEvent {
  type: WSEventType
  [key: string]: any
}

/**
 * 工具调用开始事件
 */
export interface ToolCallStartEvent extends WSEvent {
  type: 'tool_call_start'
  name: string
  id: string
  display_name?: string
}

/**
 * 工具调用参数事件
 */
export interface ToolCallArgsEvent extends WSEvent {
  type: 'tool_call_args'
  id: string
  args: string
}

/**
 * 工具调用结束事件
 */
export interface ToolEndEvent extends WSEvent {
  type: 'tool_end'
  id: string
  name: string
}

/**
 * 工具结果事件
 */
export interface ToolResultEvent extends WSEvent {
  type: 'tool_result'
  tool: string
  tool_call_id: string
  result: any
  display_name?: string
}

// ==================== 消息块类型 ====================

/**
 * 消息块类型枚举
 */
export type BlockType = 'text' | 'thinking' | 'pending' | 'tool'

/**
 * 消息块基础结构
 */
export interface MessageBlock {
  type: BlockType
  content?: string
  blockType?: 'thinking' | 'pending' | 'chat'
  collapsed?: boolean
  duration?: number
}

/**
 * 工具消息块
 */
export interface ToolBlock extends MessageBlock {
  type: 'tool'
  name: string
  tool_call_id: string
  input?: Record<string, any>
  inputJson?: string
  result?: any
  isBuilding?: boolean
  isRunning?: boolean
  isPaused?: boolean
  isCancelled?: boolean
  interruptPayload?: any
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  agent?: string
  content?: string
  contentBlocks?: MessageBlock[]
  timestamp?: Date
  isStreaming?: boolean
}

// ==================== 会话状态类型 ====================

/**
 * 性能预测结果
 */
export interface PerformancePrediction {
  tensile_strength?: number
  yield_strength?: number
  elongation?: number
  hardness?: number
  composition?: string
  [key: string]: any
}

/**
 * 工具结果处理参数
 */
export interface ToolResultHandlerParams {
  data: {
    tool: string
    result: any
    display_name?: string
    tool_call_id?: string
  }
  state: {
    validationResult: any
    performancePrediction: any
    historicalData: any
    optimizationResults: any
    experimentWorkorder: any
    isAgentTyping: any
    currentAgent: any
    messages: any
    widgetQueue: any
  }
  callbacks: {
    addResult: (result: any) => void
    addMessage: (msg: ChatMessage) => void
  }
}

// ==================== 工具注册表类型 ====================

/**
 * 工具分类
 */
export type ToolCategory =
  | 'prediction'
  | 'simulation'
  | 'validation'
  | 'knowledge'
  | 'interaction'
  | 'state'
  | 'analysis'
  | 'thermo'

/**
 * 结果展示方式
 */
export type ResultDisplay = 'none' | 'card' | 'chart' | 'inline' | 'widget'

/**
 * 工具元信息
 */
export interface ToolMeta {
  displayName: string
  category: ToolCategory
  resultDisplay: ResultDisplay
  chartComponent?: string
  description?: string
}
