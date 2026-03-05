/**
 * Agent 事件处理器模块
 * 
 * 职责：
 * - 将 WebSocket 事件分发到对应的处理函数
 * - 解耦事件处理逻辑，提升可维护性
 * - 统一错误处理
 */
import { ElMessage } from 'element-plus'
import {
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

/**
 * 创建事件处理器工厂
 * 
 * @param {object} context - 上下文对象，包含所有需要的状态和回调
 * @returns {object} 事件处理器映射
 */
export function createEventHandlers(context) {
  const {
    // 状态 refs
    sessionId,
    clientId,
    currentAgent,
    isAgentTyping,
    activeTool,
    messages,
    streamingMessage,
    emittedToolResults,
    pendingParamResolve,
    widgetQueue,
    // 回调函数
    setLongTaskStatus,
    refreshSessions,
    addMessage,
    createNewAgentMessage,
    handleToolResult,
    handleStructuredContent,
    restoreSessionState
  } = context

  // ==================== 连接事件 ====================
  
  const handleConnection = (data) => {
    sessionId.value = data.session_id
    clientId.value = data.client_id
    console.log('[AgentEvents] 连接模式:', data.mode, 'session_id:', data.session_id)
    
    // 显示连接成功消息（仅在消息少时显示）
    if (!messages.value.length || messages.value.length < 5) {
      ElMessage.success('对话式助手已连接')
    }
    
    refreshSessions()
  }

  const handleSystemMessage = (data) => {
    addMessage({
      type: 'agent',
      agent: 'System',
      agentIcon: '🤖',
      content: data.content,
      widget: data.widget,
      timestamp: new Date().toISOString()
    })
  }

  // ==================== 工具调用事件 ====================
  
  const handleToolCallStart = (data) => {
    console.log('[AgentEvents] tool_call_start:', data.tool)
    if (streamingMessage.value) {
      // 将当前 pending 块转为 thinking 块
      convertPendingBlockToThinking(streamingMessage.value)
      // 创建工具块（参数构建中状态）
      addToolBlockToMessage(streamingMessage.value, {
        name: data.tool,
        displayName: data.tool,
        id: data.id || '',
        input: {},
        inputJson: '',
        isBuilding: true,
        isRunning: false,
        isPaused: false,
        isCancelled: false,
        result: null
      })
      messages.value = [...messages.value]
    }
  }

  const handleToolCallArgs = (data) => {
    if (streamingMessage.value) {
      updateToolBlockArgs(streamingMessage.value, data.args, 0, data.id)
      messages.value = [...messages.value]
    }
  }

  const handleToolReady = (data) => {
    console.log('[AgentEvents] tool_ready:', data.tool, data.id)
    if (streamingMessage.value) {
      finalizeToolBlock(streamingMessage.value, data.tool, data.input, data.id)
      messages.value = [...messages.value]
    }
    activeTool.value = data.tool
    setLongTaskStatus(true)
  }

  const handleToolStart = (data) => {
    activeTool.value = data.display_name || data.tool
    setLongTaskStatus(true)
    if (!streamingMessage.value) {
      streamingMessage.value = createNewAgentMessage()
      messages.value.push(streamingMessage.value)
    }
    
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
  }

  const handleToolEnd = (data) => {
    const toolBlock = findToolBlock(streamingMessage.value, data.tool, data.tool_call_id)
    if (toolBlock) {
      toolBlock.isRunning = false
    }
    activeTool.value = null
    setLongTaskStatus(false)
  }

  const handleToolProgress = (data) => {
    const targetMsg = streamingMessage.value || messages.value.findLast(m => m.type === 'agent')
    if (!targetMsg) return
    
    const toolBlock = findToolBlock(targetMsg, data.tool)
    if (toolBlock) {
      toolBlock.isRunning = true
      toolBlock.progress = data.progress
      toolBlock.statusMessage = data.message
      toolBlock.currentStep = data.step
      messages.value = [...messages.value]
    }
  }

  const handleToolResultEvent = (data) => {
    // 使用 tool_call_id 去重
    const dedupeKey = data.tool_call_id || data.tool
    if (emittedToolResults.value.has(dedupeKey)) {
      console.log('[AgentEvents] 跳过重复 tool_result:', dedupeKey)
      return
    }
    emittedToolResults.value.add(dedupeKey)
    
    handleToolResult(data)
    
    // 更新工具块结果
    const toolBlock = findToolBlock(streamingMessage.value, data.tool, data.tool_call_id)
    if (toolBlock) {
      toolBlock.result = data.result
      toolBlock.isRunning = false
      
      // ★ 检测工具错误（后端返回的错误消息）
      if (data.result && typeof data.result === 'string') {
        // 检测错误关键词
        if (data.result.includes('执行失败') || data.result.includes('超时') || data.result.includes('错误')) {
          toolBlock.hasError = true
          toolBlock.errorMessage = data.result
        }
      }
    }
  }

  // ==================== 消息流事件 ====================
  
  const handleAgentStart = (data) => {
    currentAgent.value = data.agent || 'Agent'
    isAgentTyping.value = true
    if (!streamingMessage.value) {
      streamingMessage.value = createNewAgentMessage()
      messages.value.push(streamingMessage.value)
    }
  }

  const handleChatToken = (data) => {
    if (!streamingMessage.value) {
      streamingMessage.value = createNewAgentMessage()
      messages.value.push(streamingMessage.value)
    }
    appendTextToContentBlocks(streamingMessage.value, data.content, data.agent, { blockType: 'pending' })
    messages.value = [...messages.value]
  }

  const handleChatComplete = () => {
    isAgentTyping.value = false
    activeTool.value = null
    setLongTaskStatus(false)

    if (streamingMessage.value) {
      finalizePendingBlocksAsChat(streamingMessage.value)
      collapseAllThinkingBlocks(streamingMessage.value)
      streamingMessage.value.isStreaming = false
      messages.value = [...messages.value]
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
  }

  // ==================== 中断与恢复事件 ====================
  
  const handleInterrupt = (data) => {
    const targetMsg = streamingMessage.value || messages.value.findLast(m => m.type === 'agent')
    
    if (targetMsg?.contentBlocks?.length > 0) {
      for (const block of targetMsg.contentBlocks) {
        if (block.type === 'tool' && block.isRunning) {
          block.isRunning = false
          block.isPaused = true
          if (!block.interruptPayload && data.payload) {
            block.interruptPayload = data.payload
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
  }

  const handleSessionState = (data) => {
    if (data.state) {
      restoreSessionState(data.state)
    }
  }

  // ==================== 错误事件 ====================
  
  const handleError = (data) => {
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
  }

  // ==================== 其他事件 ====================
  
  const handleParametersSet = () => {
    if (pendingParamResolve.value) {
      pendingParamResolve.value()
      pendingParamResolve.value = null
    }
  }

  const handleGenerateStopped = () => {
    if (streamingMessage.value) {
      streamingMessage.value.isStreaming = false
      streamingMessage.value.isThinking = false
      messages.value = [...messages.value]
      streamingMessage.value = null
    }
    isAgentTyping.value = false
    currentAgent.value = 'System'
    activeTool.value = null
  }

  const handleStructuredContentEvent = (data) => {
    handleStructuredContent(data.data)
  }

  // ==================== 事件映射表 ====================
  
  return {
    'connection': handleConnection,
    'system_message': handleSystemMessage,
    'tool_call_start': handleToolCallStart,
    'tool_call_args': handleToolCallArgs,
    'tool_ready': handleToolReady,
    'tool_start': handleToolStart,
    'tool_end': handleToolEnd,
    'tool_progress': handleToolProgress,
    'tool_result': handleToolResultEvent,
    'agent_start': handleAgentStart,
    'chat_token': handleChatToken,
    'chat_complete': handleChatComplete,
    'interrupt': handleInterrupt,
    'session_state': handleSessionState,
    'chat_error': handleError,
    'error': handleError,
    'parameters_set': handleParametersSet,
    'generate_stopped': handleGenerateStopped,
    'structured_content': handleStructuredContentEvent,
    'interaction_ack': (data) => console.log('[AgentEvents] Interaction Acknowledged:', data),
    'agent_end': () => {},
    'pong': () => {}
  }
}

/**
 * 统一的事件分发函数
 * 
 * @param {object} handlers - 事件处理器映射
 * @param {object} data - WebSocket 消息数据
 */
export function dispatchEvent(handlers, data) {
  const handler = handlers[data.type]
  
  if (handler) {
    try {
      handler(data)
    } catch (error) {
      console.error(`[AgentEvents] 处理 ${data.type} 事件失败:`, error)
      ElMessage.error(`消息处理异常: ${error.message}`)
    }
  } else {
    console.log('[AgentEvents] 未处理的消息类型:', data.type)
  }
}
