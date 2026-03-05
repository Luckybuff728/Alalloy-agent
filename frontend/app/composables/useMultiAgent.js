/**
 * 对话式多 Agent 系统 (v2.0 重构版)
 * 
 * 设计理念：
 * - 用户消息驱动，而非流程驱动
 * - 智能路由到合适的专家
 * - 支持多轮对话，实时流式输出
 * - 每条消息独立处理
 * 
 * v2.0 重构：
 * - 使用 useMessageBlocks 管理消息块操作
 * - 使用 useAgentEvents 分发事件处理
 * - 使用 Pinia store 管理业务状态
 * - 统一使用 contentBlocks，移除旧的 tools 数组
 */
import { ref, computed, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { WS_ENDPOINTS, API_BASE_URL } from '../config'
import { useWebSocket } from './useWebSocket'
import { useSessions } from './useSessions'
import { processToolResult } from '../utils/toolResultHandler'
import { restoreSessionState as restoreSessionStateUtil } from '../utils/sessionRestorer'
import { useResultsStore } from '../stores/results'
import { createEventHandlers, dispatchEvent } from './useAgentEvents'
import {
  createAgentMessage,
  appendTextToContentBlocks,
  convertPendingBlockToThinking,
  finalizePendingBlocksAsChat,
  collapseAllThinkingBlocks,
  addToolBlockToMessage,
  findToolBlock,
  updateToolBlockArgs,
  finalizeToolBlock,
  updateToolBlockResult
} from './useMessageBlocks'

export function useMultiAgent() {
  // ==================== WebSocket ====================
  const {
    connect: wsConnect,
    send: wsSend,
    disconnect: wsDisconnect,
    reconnect: wsReconnect,
    isConnected,
    connectionState,
    reconnectAttempts,
    shouldReconnect,
    setLongTaskStatus
  } = useWebSocket()

  // 获取会话管理 (单例模式，与 Sidebar 共享)
  const { refreshSessions, updateSessionStatus, createSession, updateSessionTitleViaAPI } = useSessions()
  
  // 获取结果 store
  const resultsStore = useResultsStore()

  // ==================== 状态 ====================
  const sessionId = ref(null)
  const clientId = ref(null)
  const currentAgent = ref('System')
  const isAgentTyping = ref(false)
  const activeTool = ref(null)

  // ==================== 错误状态 ====================
  const lastError = ref(null)
  const hasError = ref(false)

  // 对话消息
  const messages = ref([])

  // 当前流式消息
  const streamingMessage = ref(null)

  // ★ 响应式内部状态（替代闭包变量）已迁移至 Pinia store (resultsStore)
  
  // 工具结果去重集合（用于防止重复的 tool_result 事件）
  const emittedToolResults = ref(new Set())
  
  // 挂件缓冲队列（用于 chat_complete 后批量挂载挂件）
  const widgetQueue = ref([])

  // 会话完成 (通过后端 REST API)
  const completeCurrentSession = async () => {
    if (!sessionId.value) return

    // 1. 立即乐观更新前端状态 (Instant Feedback)
    updateSessionStatus(sessionId.value, 'completed')

    try {
      const { useAuthStore } = await import('../stores/auth')
      const authStore = useAuthStore()
      const resp = await fetch(`${API_BASE_URL}/api/sessions/${sessionId.value}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authStore.token}`
        },
        body: JSON.stringify({ status: 'completed' })
      })

      if (!resp.ok) throw new Error('更新状态失败')
      ElMessage.success('任务已标记为完成 🏆')

      // 2. 后台静默刷新确保数据一致性
      refreshSessions()
    } catch (e) {
      console.error('完成任务失败:', e)
      ElMessage.error('更新状态失败')
    }
  }

  // ==================== 连接管理 ====================

  /**
   * 连接到对话式 WebSocket (v3.0: 必须携带 session_id)
   * 
   * 参数:
   *   token - JWT 认证令牌
   *   targetSessionId - 必须提供的会话 ID (由 REST API 预先创建)
   */
  const connect = (token, targetSessionId) => {
    if (!targetSessionId) {
      console.error('[ChatAgent] connect() 必须提供 session_id')
      return
    }

    // 增加保护：如果已经是在连接中或已连接到目标会话，则不重复操作
    if (connectionState.value === 'connecting' || connectionState.value === 'reconnecting') {
        console.log('[ChatAgent] 正在建立连接中，忽略重复请求')
        return
    }

    if (isConnected.value && targetSessionId === sessionId.value) {
        console.log('[ChatAgent] 已经连接到该会话，无需重新连接')
        return
    }

    // WS URL 必须携带 session_id
    const wsUrl = `${WS_ENDPOINTS.chat}?token=${token}&session_id=${targetSessionId}`
    console.log('[ChatAgent] 连接到:', targetSessionId)

    // 清理状态 (业务场景：如果是重新连接同一个会话，则保留现有消息，避免闪烁)
    const isReconnectingSameSession = targetSessionId === sessionId.value
    
    if (!isReconnectingSameSession) {
      sessionId.value = null
      clientId.value = null
      currentAgent.value = 'System'
      isAgentTyping.value = false
      messages.value = []
      resultsStore.clearAll()
    } else {
      console.log('[ChatAgent] 检测到重连同一会话，保留现有 UI 内容')
    }

    wsConnect(wsUrl, handleMessage)
  }

  /**
   * 创建新会话并连接 WS
   * 
   * 新对话流程: POST /api/sessions → 拿到 session_id → WS connect
   * 
   * 参数:
   *   token - JWT 认证令牌
   * 
   * 返回:
   *   创建的会话对象，失败返回 null
   */
  const createAndConnect = async (token) => {
    const session = await createSession('新对话')
    if (!session || !session.id) {
      ElMessage.error('创建会话失败')
      return null
    }
    console.log('[ChatAgent] 新会话已创建:', session.id)
    connect(token, session.id)
    return session
  }

  /**
   * 断开连接
   */
  const disconnect = () => {
    wsDisconnect(true)
    isAgentTyping.value = false
  }

  // ==================== 消息处理 ====================

  /**
   * 处理WebSocket消息
   */
  const handleMessage = (data) => {
    console.log('[ChatAgent] 收到消息:', data.type)

    switch (data.type) {
      case 'connection':
        sessionId.value = data.session_id
        clientId.value = data.client_id
        console.log('[ChatAgent] 连接模式:', data.mode, 'session_id:', data.session_id)
        
        // 显示连接成功消息（仅在消息少时显示，避免刷屏）
        if (!messages.value.length || messages.value.length < 5) {
          ElMessage.success('对话式助手已连接')
        }
        
        // 刷新会话列表
        refreshSessions()
        break

      case 'connection_replaced':
        // ★ 并发会话冲突：此会话已在其他位置打开
        console.warn('[ChatAgent] 连接被替换:', data.message)
        ElMessage.warning({
          message: data.message || '此会话已在其他位置打开',
          duration: 5000
        })
        // 不自动重连，让用户决定
        break

      case 'system_message':
        addMessage({
          type: 'agent',
          agent: 'System',
          agentIcon: '🤖',
          content: data.content,
          widget: data.widget, // Pass widget data to message
          timestamp: new Date().toISOString()
        })
        break


      // ==================== v3 实时 tool_call_chunks 检测事件 ====================
      
      // tool_call_start：检测到工具调用开始
      // ★ 核心：将当前 pending 块转为 thinking 块，并创建工具块
      case 'tool_call_start':
        console.log('[useMultiAgent] tool_call_start 收到:', data.tool)
        
        // ★ 引导挂件工具不显示调用框（通过 interrupt 机制处理）
        // 关键：分析内容应作为 chat 块（正常回复），而不是 thinking 块
        if (data.tool === 'show_guidance_widget') {
          console.log('[useMultiAgent] 隐藏 guidance widget 工具框，保留分析内容为 chat')
          if (streamingMessage.value) {
            // ★ 将 pending 块转为 chat 块（正式回复），而不是 thinking 块
            finalizePendingBlocksAsChat(streamingMessage.value)
            messages.value = [...messages.value]
          }
          break
        }
        
        if (streamingMessage.value) {
          // ★ ReAct 模式：工具调用前的内容是推理过程，转为 thinking 块
          // thinking 块在 chat_complete 时统一折叠
          convertPendingBlockToThinking(streamingMessage.value)
          // 创建工具块（参数构建中状态）
          addToolBlockToMessage(streamingMessage.value, {
            name: data.tool,
            displayName: data.tool,
            id: data.id || '',
            input: {},
            inputJson: '',  // 用于显示参数构建过程
            isBuilding: true,  // 参数构建中
            isRunning: false,
            isPaused: false,
            isCancelled: false,
            result: null
          })
          messages.value = [...messages.value]
        }
        break

      // tool_call_args：工具参数片段（实时显示参数构建）
      case 'tool_call_args':
        if (streamingMessage.value) {
          // ★ 传入 tool_call_id 支持同一工具多次调用
          updateToolBlockArgs(streamingMessage.value, data.args, data.index, data.id || data.tool_call_id)
          messages.value = [...messages.value]
        }
        break

      // tool_ready：工具参数完整（确认信号）
      case 'tool_ready':
        console.log('[useMultiAgent] tool_ready 收到:', data.tool, data.id)
        if (streamingMessage.value) {
          // ★ 传入 tool_call_id 支持同一工具多次调用
          finalizeToolBlock(streamingMessage.value, data.tool, data.input, data.id || data.tool_call_id)
          messages.value = [...messages.value]
        }
        break

      // ==================== 标准聊天事件 ====================
      case 'chat_start':
        // 开启新会话前，强制结束所有历史消息的流式状态，清理光标残留
        messages.value.forEach(m => {
          if (m.isStreaming) m.isStreaming = false
        })
        emittedToolResults.value.clear()  // 重置去重集合

        isAgentTyping.value = true
        currentAgent.value = '🔀 智能路由'
        streamingMessage.value = {
          type: 'agent',
          agent: currentAgent.value,
          // V4: 使用 contentBlocks 替代 content + tools，实现按时间顺序渲染
          contentBlocks: [],
          isStreaming: true,
          isThinking: false,
          reasoning: '',
          timestamp: new Date().toISOString()
        }
        messages.value.push(streamingMessage.value)
        break

      case 'resume_start':
        // interrupt resume 开始 - 不创建新消息气泡
        // 后续的 tool_start / chat_token 事件会按需创建
        isAgentTyping.value = true
        break

      case 'agent_start':
        currentAgent.value = data.display_name || data.agent || 'Agent'
        if (streamingMessage.value) {
          streamingMessage.value.agent = currentAgent.value
        }
        break

      case 'agent_end':
        // Agent 完成
        break

      case 'chat_token':
        // ReAct 模式：流式输出时用 pending 块
        // - 检测到 tool_call_start → pending 转 thinking（中间推理）
        // - chat_complete 时剩余 pending → chat（最终回复）
        if (!streamingMessage.value) {
          streamingMessage.value = createNewAgentMessage()
          messages.value.push(streamingMessage.value)
        }
        appendTextToContentBlocks(streamingMessage.value, data.content, data.agent, { blockType: 'pending' })
        break

      case 'tool_start':
        activeTool.value = data.display_name || data.tool
        setLongTaskStatus(true)
        if (!streamingMessage.value) {
          streamingMessage.value = createNewAgentMessage()
          messages.value.push(streamingMessage.value)
        }
        // v2: 工具调用前的推理块已通过 reasoning_end 信号处理，直接添加工具块
        // ★ 使用 tool_call_id 区分不同的工具调用
        addToolBlockToMessage(streamingMessage.value, {
          name: data.tool,
          displayName: data.display_name || data.tool,
          id: data.tool_call_id || data.id || '',
          input: data.input,
          isRunning: true,
          isPaused: false,
          isCancelled: false,
          interruptPayload: data.interruptPayload || null,
          result: null
        })
        // HITL: 立即标记为 paused
        if (data.interruptPayload) {
          const toolBlock = findToolBlock(streamingMessage.value, data.tool, data.tool_call_id)
          if (toolBlock) {
            toolBlock.isRunning = false
            toolBlock.isPaused = true
          }
          messages.value = [...messages.value]
        }
        break

      case 'tool_end':
        // V4: 更新 contentBlocks 中的工具状态
        // ★ 使用 tool_call_id 精确匹配
        {
          const toolBlock = findToolBlock(streamingMessage.value, data.tool, data.tool_call_id)
          if (toolBlock) {
            toolBlock.isRunning = false
          }
        }
        activeTool.value = null
        setLongTaskStatus(false)
        break

      case 'tool_progress':
        // 实时更新工具执行进度 (V3.0)
        updateToolProgress(data.tool, data.progress, data.message, data.step)
        break

      case 'tool_result':
        // ★ 使用 tool_call_id 去重（支持同一工具多次调用）
        {
          const dedupeKey = data.tool_call_id || data.tool
          if (emittedToolResults.value.has(dedupeKey)) {
            console.log('[ChatAgent] 跳过重复 tool_result:', dedupeKey)
            break
          }
          emittedToolResults.value.add(dedupeKey)
          // V4: 更新工具块结果（使用 tool_call_id 精确匹配）
          const toolBlock = findToolBlock(streamingMessage.value, data.tool, data.tool_call_id)
          if (toolBlock) {
            toolBlock.result = data.result
            toolBlock.isRunning = false
          }
          // ★ 将工具输入参数（input）一并传递给结果处理器，用于重建成分字符串等
          handleToolResult({ ...data, toolInput: toolBlock?.input || null })
        }
        break

      // 注：widget 事件已废弃，现在通过 interrupt 机制处理 guidance_widget
      // 保留 case 以兼容旧版本，但不再使用
      case 'widget':
        console.log('[ChatAgent] 收到旧版 widget 事件（已废弃，请使用 interrupt）:', data.widget?.type)
        break

      case 'structured_content':
        // 从 Agent 输出中提取的结构化内容（优化方案摘要、工单信息等）
        handleStructuredContent(data.data)
        break

      case 'chat_complete':
        // v3: 流式消息完成 - 将所有 pending 块确定为 chat，收起 thinking 块
        isAgentTyping.value = false
        activeTool.value = null
        setLongTaskStatus(false)

        if (streamingMessage.value) {
          // ★ 核心：将剩余 pending 块确定为 chat 块
          finalizePendingBlocksAsChat(streamingMessage.value)
          // 收起所有 thinking 块
          collapseAllThinkingBlocks(streamingMessage.value)
          
          streamingMessage.value.isStreaming = false
          messages.value = [...messages.value] // 触发更新
          streamingMessage.value = null
        }
        currentAgent.value = 'System'

        // 刷新挂件缓冲区
        if (widgetQueue.value.length > 0) {
          widgetQueue.value.forEach(item => {
            if (item.mode === 'attach' && item.widget) {
              const lastMsg = messages.value[messages.value.length - 1]
              if (lastMsg) {
                lastMsg.widget = item.widget
                messages.value = [...messages.value]
              }
            } else {
              addMessage({ ...item, timestamp: new Date().toISOString() })
            }
          })
          widgetQueue.value = []
        }
        
        // ★ 保存 UI 快照（用于完美恢复历史会话）
        saveUISnapshot()
        break

      case 'session_title_updated':
        // ★ 后端生成标题后，前端通过 REST API 持久化
        console.log('[ChatAgent] 收到生成的会话标题:', data.title)
        if (data.session_id && data.title) {
          // 调用 REST API 持久化标题（fire-and-forget，不阻塞消息处理）
          updateSessionTitleViaAPI(data.session_id, data.title)
        }
        break

      case 'ui_snapshot_saved':
        // ★ UI 快照保存响应
        if (data.success) {
          console.log('[ChatAgent] UI 快照已保存:', data.session_id)
        } else {
          console.warn('[ChatAgent] UI 快照保存失败:', data.session_id)
        }
        break

      case 'chat_error':
      case 'error':
        ElMessage.error(data.message || '发生错误')
        addMessage({
          type: 'error',
          content: `❌ ${data.message}`,
          timestamp: new Date().toISOString()
        })
        isAgentTyping.value = false
        if (streamingMessage.value) {
          streamingMessage.value.isStreaming = false
          messages.value = [...messages.value] 
          streamingMessage.value = null
        }
        break

      case 'interaction_ack':
        console.log('[ChatAgent] Interaction Acknowledged:', data)
        break

      case 'parameters_set':
        if (pendingParamResolve.value) {
          pendingParamResolve.value()
          pendingParamResolve.value = null
        }
        break

      case 'session_state':
        if (data.state) {
          // ★ 使用 Pinia store 恢复业务状态
          restoreSessionStateUtil({
            stateData: data.state,
            refs: { sessionId, messages },
            store: resultsStore
          })
        } else if (data.is_new) {
          // 新会话或无历史状态
          console.log('[ChatAgent] 新会话，无历史对话')
        }
        break

      case 'session_restore_failed':
        // ★ 会话历史加载失败
        console.warn('[ChatAgent] 会话恢复失败:', data.error)
        ElMessage.warning({
          message: data.message || '无法加载历史对话',
          duration: 4000
        })
        // 清空当前消息，作为新会话继续
        messages.value = []
        break

      case 'interrupt':
        // interrupt() 暂停事件 - 图已暂停
        {
          const targetMsg = streamingMessage.value || messages.value.findLast(m => m.type === 'agent')
          
          // ★ 引导挂件类型的 interrupt（人机协同选项）
          if (data.interrupt_type === 'guidance_widget' && data.payload?.widget) {
            console.log('[useMultiAgent] 收到 guidance_widget interrupt:', data.payload.widget.title)
            if (targetMsg) {
              // ★ 确保所有 pending 块都转为 chat（防止 tool_call_start 事件丢失的情况）
              finalizePendingBlocksAsChat(targetMsg)
              // 将 widget 附加到消息末尾
              targetMsg.widget = data.payload.widget
              targetMsg.isStreaming = false
            }
            streamingMessage.value = null
            messages.value = [...messages.value]
            isAgentTyping.value = false
            activeTool.value = null
            setLongTaskStatus(false)
            // ★ 保存 UI 快照（确保 interrupt 状态可恢复）
            saveUISnapshot()
            break
          }
          
          // 工具确认类型的 interrupt（HITL 参数确认）
          if (targetMsg?.contentBlocks?.length > 0) {
            const allActionRequests = data.payload?.action_requests || []
            // 保存完整 interrupt payload 到消息，供 sendResume 重建有序 decisions
            targetMsg._hitlPayload = data.payload

            for (const block of targetMsg.contentBlocks) {
              if (block.type === 'tool' && block.isRunning) {
                block.isRunning = false
                block.isPaused = true
                if (!block.interruptPayload && data.payload) {
                  // 每个工具块只注入自己对应的 action，避免显示全部工具参数
                  const matchedAction = allActionRequests.find(a => a.name === block.name)
                  block.interruptPayload = matchedAction
                    ? { ...data.payload, action_requests: [matchedAction] }
                    : data.payload
                }
              }
            }
            targetMsg.isStreaming = false
          }
          
          streamingMessage.value = null
          messages.value = [...messages.value]
          isAgentTyping.value = false
          activeTool.value = null
          setLongTaskStatus(false)
          // ★ 保存 UI 快照（确保 HITL 状态可恢复）
          saveUISnapshot()
        }
        break

      case 'pong':
        break

      case 'generate_stopped':
        if (streamingMessage.value) {
          streamingMessage.value.isStreaming = false
          streamingMessage.value.isThinking = false
          messages.value = [...messages.value]
          streamingMessage.value = null
        }
        isAgentTyping.value = false
        currentAgent.value = 'System'
        activeTool.value = null
        break

      default:
        console.log('[ChatAgent] 未处理的消息类型:', data.type)
    }
  }

  // ==================== 消息操作 ====================

  const addMessage = (msg) => {
    messages.value.push({
      id: Date.now() + Math.random(),
      ...msg
    })
  }

  const createNewAgentMessage = () => ({
    type: 'agent',
    agent: currentAgent.value,
    // V4: 使用 contentBlocks 替代 content + tools
    contentBlocks: [],
    isStreaming: true,
    isThinking: false,
    reasoning: '',
    timestamp: new Date().toISOString()
  })

  // ==================== V4: ContentBlocks 辅助函数 ====================
  // ★ 已迁移至 useMessageBlocks.js，此处仅保留包装函数以触发 messages 更新

  /**
   * 包装 useMessageBlocks 函数，添加 messages 更新触发
   */
  const appendTextWithUpdate = (msg, text, agent, options = {}) => {
    appendTextToContentBlocks(msg, text, agent, options)
    messages.value = [...messages.value]
  }

  const addToolBlockWithUpdate = (msg, toolData) => {
    addToolBlockToMessage(msg, toolData)
    messages.value = [...messages.value]
  }

  /**
   * 更新工具进度（统一接口）
   */
  const updateToolProgress = (toolName, progress, message, step) => {
    const targetMsg = streamingMessage.value || messages.value.findLast(m => m.type === 'agent')
    if (!targetMsg) return
    
    const toolBlock = findToolBlock(targetMsg, toolName)
    if (toolBlock) {
      toolBlock.isRunning = true
      toolBlock.progress = progress
      toolBlock.statusMessage = message
      toolBlock.currentStep = step
      messages.value = [...messages.value]
    }
  }

  const handleToolResult = (data) => {
    // ★ 简化：业务状态由 Pinia store 管理，此处只传递 UI 状态
    processToolResult({
      data,
      state: {
        isAgentTyping,
        currentAgent,
        messages,
        widgetQueue
      },
      callbacks: { addMessage }
    })
  }

  const handleStructuredContent = (data) => {
    if (!data || !data.type) return
    if (data.type === 'optimization_plans') {
      resultsStore.updateState('optimization', data)
      resultsStore.addResult('optimization_plans', '优化方案概览', data)
    } else if (data.type === 'workorder') {
      resultsStore.updateState('workorder', data)
      resultsStore.addResult('workorder', '实验工单', data)
    }
  }

  const sendMessage = (content) => {
    if (!content?.trim()) return
    if (!isConnected.value) {
      ElMessage.error('连接已断开')
      return
    }

    const hasUserMessage = messages.value.some(m => m.type === 'user')
    if (!hasUserMessage) {
      messages.value = messages.value.filter(m => !(m.type === 'agent' && m.agent === 'System'))
    }

    messages.value.forEach(m => { if (m.isStreaming) m.isStreaming = false })

    addMessage({
      type: 'user',
      content: content,
      timestamp: new Date().toISOString()
    })

    const message = {
      type: 'chat_message',
      content: content,
      session_id: sessionId.value
    }

    wsSend(message)
  }

  const sendInteraction = (payload) => {
    if (!isConnected.value) return
    wsSend({
      type: 'widget_interaction',
      session_id: sessionId.value,
      interaction: payload
    })
  }

  // 跨工具块 HITL 决策聚合（key: toolName → decision object）
  // 当单次 interrupt 含多个 action_requests 时，需等所有工具块都确认后再发送 resume
  const _hitlAccumulator = {}

  /**
   * 恢复被 interrupt() 暂停的执行
   * @param {object} value - 用户响应:
   *   HITL (单/多工具): { confirmed|cancelled: true, decisionByTool: { toolName: {type} } }
   *   guidance_widget: { id: "...", label: "..." }
   */
  const sendResume = (value) => {
    if (!isConnected.value) {
      ElMessage.error('连接已断开，无法恢复执行')
      return
    }

    const targetMsg = messages.value.findLast(m => {
      if (m.type !== 'agent') return false
      return m.contentBlocks?.some(b => b.type === 'tool' && b.isPaused)
    })

    // ── HITL 多工具块聚合逻辑 ──────────────────────────────────────
    if (value.decisionByTool) {
      const allActions = targetMsg?._hitlPayload?.action_requests || []

      // 累积本次决策
      Object.assign(_hitlAccumulator, value.decisionByTool)

      // 更新已决策工具块的 UI 状态（isPaused → isRunning/isCancelled）
      if (targetMsg) {
        for (const [toolName, decision] of Object.entries(value.decisionByTool)) {
          const block = targetMsg.contentBlocks?.find(
            b => b.type === 'tool' && b.isPaused && b.name === toolName
          )
          if (block) {
            block.interruptPayload = null
            block.isPaused = false
            block.isRunning = decision?.type !== 'reject'
            block.isCancelled = decision?.type === 'reject'
          }
        }
        messages.value = [...messages.value]
      }

      // 检查是否所有 action 都已收集到决策
      const decidedNames = Object.keys(_hitlAccumulator)
      const allDecided = allActions.length > 0
        ? allActions.every(a => decidedNames.includes(a.name))
        : true

      if (!allDecided) {
        const remaining = allActions.filter(a => !decidedNames.includes(a.name)).map(a => a.name)
        console.log(`[ChatAgent] HITL 等待更多确认: ${remaining.join(', ')}`)
        return
      }

      // 全部决策收齐 → 按原始 action_requests 顺序组装并发送
      const orderedDecisions = allActions.length > 0
        ? allActions.map(a => _hitlAccumulator[a.name] ?? { type: 'approve' })
        : Object.values(_hitlAccumulator)

      // 清空聚合器
      for (const k of Object.keys(_hitlAccumulator)) delete _hitlAccumulator[k]

      if (targetMsg) {
        targetMsg.isStreaming = true
        streamingMessage.value = targetMsg
        messages.value = [...messages.value]
      }
      isAgentTyping.value = true

      console.log(`[ChatAgent] HITL 全部决策收齐，发送 resume:`, orderedDecisions)
      wsSend({ type: 'resume_interrupt', session_id: sessionId.value, value: { decisions: orderedDecisions } })
      return
    }

    // ── 非 HITL 路径（guidance_widget 等）直接发送 ─────────────────
    console.log('[ChatAgent] 发送 resume:', value)

    if (targetMsg) {
      for (const block of targetMsg.contentBlocks) {
        if (block.type === 'tool' && block.isPaused) {
          block.interruptPayload = null
          block.isPaused = false
          if (value.cancelled) block.isCancelled = true
          else block.isRunning = true
        }
      }
      targetMsg.isStreaming = true
      streamingMessage.value = targetMsg
      messages.value = [...messages.value]
    }

    isAgentTyping.value = true

    const resumeValue = value.decisions ? { decisions: value.decisions } : value
    wsSend({ type: 'resume_interrupt', session_id: sessionId.value, value: resumeValue })
  }

  /**
   * 保存 UI 快照到后端
   * 
   * 快照内容包括：
   * - messages: 完整的消息数组（含 contentBlocks、widget 等）
   * - resultsState: Pinia store 中的结果状态
   * 
   * 调用时机：chat_complete、interrupt 后
   */
  const saveUISnapshot = () => {
    if (!isConnected.value || !sessionId.value) return
    if (!messages.value || messages.value.length === 0) return
    
    try {
      // 序列化 messages（移除响应式代理，保留纯数据）
      const snapshot = {
        messages: JSON.parse(JSON.stringify(messages.value)),
        resultsState: JSON.parse(JSON.stringify(resultsStore.resultsList)),
        savedAt: new Date().toISOString()
      }
      
      wsSend({
        type: 'save_ui_snapshot',
        session_id: sessionId.value,
        snapshot: snapshot
      })
      
      console.log('[ChatAgent] UI 快照已发送:', snapshot.messages.length, '条消息')
    } catch (e) {
      console.warn('[ChatAgent] 序列化 UI 快照失败:', e)
    }
  }

  const clearSession = () => {
    if (isConnected.value) wsSend({ type: 'clear_session', session_id: sessionId.value })
    messages.value = []
    resultsStore.clearAll()
    emittedToolResults.value.clear()
  }

  const stopGenerate = () => {
    if (!isAgentTyping.value) return
    wsSend({ type: 'stop_generate', session_id: sessionId.value })
    if (streamingMessage.value) {
      // 将所有 pending 块确定为 chat，追加"已终止"标记块
      finalizePendingBlocksAsChat(streamingMessage.value)
      streamingMessage.value.contentBlocks.push({
        type: 'chat',
        content: '*[已终止生成]*',
        isStopped: true
      })
      streamingMessage.value.isStreaming = false
      streamingMessage.value.isThinking = false
      messages.value = [...messages.value]
      streamingMessage.value = null
    }
    isAgentTyping.value = false
    activeTool.value = null
    setLongTaskStatus(false)
  }

  const canSendMessage = computed(() => isConnected.value && !isAgentTyping.value)
  const statusText = computed(() => {
    if (!isConnected.value) return '未连接'
    if (isAgentTyping.value) {
      if (activeTool.value) return `正在使用 ${activeTool.value}...`
      return `${currentAgent.value} 正在思考...`
    }
    return '就绪'
  })

  onUnmounted(() => disconnect())

  // ★ 从 Pinia store 获取 results（响应式）
  const results = computed(() => resultsStore.resultsList)

  return {
    connect, createAndConnect, send: wsSend, disconnect, reconnect: wsReconnect,
    setLongTaskStatus, sendMessage, sendInteraction, sendResume,
    clearSession, stopGenerate,
    isConnected, connectionState, messages, results,
    sessionId, currentAgent,
    isAgentTyping, activeTool, canSendMessage, statusText,
    reconnectAttempts, shouldReconnect,
    // ★ 暴露 store 以便组件直接访问业务状态
    resultsStore
  }
}
