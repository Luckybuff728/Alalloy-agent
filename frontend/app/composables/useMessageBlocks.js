/**
 * 消息块管理模块
 * 
 * 职责：
 * - 管理 contentBlocks 的增删改查
 * - 处理 text/thinking/pending/tool 等块类型的转换
 * - 与 useMultiAgent.js 解耦，提供纯函数式 API
 * 
 * 设计理念：
 * - 所有函数都是纯函数或接受 messages ref 作为参数
 * - 不直接依赖全局状态
 */

/**
 * 创建新的 Agent 消息
 * @param {string} agent - Agent 名称
 * @returns {object} 新消息对象
 */
export const createAgentMessage = (agent = 'System') => ({
  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role: 'agent',
  agent,
  content: '',
  contentBlocks: [],
  timestamp: new Date(),
  isStreaming: true
})

/**
 * 追加文本到 contentBlocks
 * 
 * @param {object} msg - 消息对象
 * @param {string} text - 要追加的文本
 * @param {string} agent - Agent 名称
 * @param {object} options - { blockType: 'pending'|'thinking'|'chat' }
 * @returns {boolean} 是否创建了新块
 */
export const appendTextToContentBlocks = (msg, text, agent, options = {}) => {
  const { blockType = 'pending' } = options
  if (!msg.contentBlocks) msg.contentBlocks = []
  
  const lastBlock = msg.contentBlocks[msg.contentBlocks.length - 1]
  
  // 判断是否应该追加到现有块
  const canAppend = lastBlock 
    && lastBlock.type === 'text' 
    && lastBlock.blockType === blockType
    && !lastBlock.collapsed
  
  if (canAppend) {
    lastBlock.content += text
    return false
  } else {
    // 创建新的 text 块
    msg.contentBlocks.push({
      type: 'text',
      content: text,
      agent: agent || msg.agent,
      blockType,
      startTime: Date.now()
    })
    return true
  }
}

/**
 * 将当前 pending 块转为 thinking 块
 * 收到 tool_call_start 信号时调用，推理完成后自动收起
 * 
 * @param {object} msg - 消息对象
 */
export const convertPendingBlockToThinking = (msg) => {
  if (!msg.contentBlocks) return
  
  // 从末尾找最后一个 pending 块并转换
  for (let i = msg.contentBlocks.length - 1; i >= 0; i--) {
    const block = msg.contentBlocks[i]
    if (block.type === 'text' && block.blockType === 'pending') {
      block.blockType = 'thinking'
      block.duration = Math.round((Date.now() - block.startTime) / 1000)
      block.collapsed = true  // ★ 思考完成后立即折叠；用户可点击标题手动展开
      delete block.startTime
      break
    }
  }
}

/**
 * 将所有剩余 pending 块确定为 chat 块
 * chat_complete 时调用
 * 
 * @param {object} msg - 消息对象
 */
export const finalizePendingBlocksAsChat = (msg) => {
  if (!msg.contentBlocks) return
  
  msg.contentBlocks.forEach((block) => {
    if (block.type === 'text' && block.blockType === 'pending') {
      block.blockType = 'chat'
      delete block.startTime
    }
  })
}

/**
 * 收起所有 thinking 块
 * chat_complete 时调用
 * 
 * @param {object} msg - 消息对象
 */
export const collapseAllThinkingBlocks = (msg) => {
  if (!msg.contentBlocks) return
  
  msg.contentBlocks.forEach((block) => {
    if (block.type === 'text' && block.blockType === 'thinking') {
      block.collapsed = true
    }
  })
}

/**
 * 添加工具块到 contentBlocks
 * 使用 tool_call_id 区分不同的工具调用
 * 
 * @param {object} msg - 消息对象
 * @param {object} toolData - 工具数据
 */
export const addToolBlockToMessage = (msg, toolData) => {
  if (!msg.contentBlocks) msg.contentBlocks = []
  
  const callId = toolData.id || toolData.tool_call_id
  const existing = callId 
    ? msg.contentBlocks.find(b => b.type === 'tool' && (b.id === callId || b.tool_call_id === callId))
    : null
  
  if (!existing) {
    const uniqueId = callId || `${toolData.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    msg.contentBlocks.push({
      type: 'tool',
      ...toolData,
      id: uniqueId
    })
  } else {
    Object.assign(existing, toolData)
  }
}

/**
 * 在 contentBlocks 中查找工具块
 * 优先按 tool_call_id 查找，其次按名称查找最后一个
 * 
 * @param {object} msg - 消息对象
 * @param {string} toolName - 工具名称
 * @param {string} toolCallId - 工具调用 ID
 * @returns {object|null} 工具块
 */
export const findToolBlock = (msg, toolName, toolCallId = null) => {
  if (!msg?.contentBlocks) return null
  
  // 优先按 tool_call_id 精确匹配
  if (toolCallId) {
    const byId = msg.contentBlocks.find(b => 
      b.type === 'tool' && (b.id === toolCallId || b.tool_call_id === toolCallId)
    )
    if (byId) return byId
  }
  
  // ★ 兜底按名称查找：优先找第一个仍在建参的同名块（而非最后一个）
  // 原因：并行调用同名工具时（如两个"单点平衡计算"），tool_ready 按创建顺序到达，
  //       应 finalize 第一个建参中的块，而非最后一个。
  const firstBuilding = msg.contentBlocks.find(
    b => b.type === 'tool' && b.name === toolName && b.isBuilding
  )
  if (firstBuilding) return firstBuilding

  // 最终兜底：找最后一个同名块（非建参状态时，如 updateToolBlockResult 等）
  return [...msg.contentBlocks].reverse().find(b => b.type === 'tool' && b.name === toolName) || null
}

/**
 * 更新工具块的参数（实时显示参数构建过程）
 * 
 * @param {object} msg - 消息对象
 * @param {string} argsFragment - 参数片段
 * @param {number} index - 索引（未使用）
 * @param {string} toolCallId - 工具调用 ID
 * @param {string} toolName - 工具名称（用于无 ID 时的兜底匹配）
 */
export const updateToolBlockArgs = (msg, argsFragment, index = 0, toolCallId = null, toolName = null) => {
  if (!msg.contentBlocks) return
  
  let toolBlock = null
  
  // 优先按 tool_call_id 匹配
  if (toolCallId) {
    toolBlock = msg.contentBlocks.find(b => 
      b.type === 'tool' && (b.id === toolCallId || b.tool_call_id === toolCallId)
    )
  }
  
  // ★ 兜底：找第一个同名且仍在建参的块（不能用"最后一个建参块"，
  //   并行同名工具时会将多个工具的参数混写到同一个块中）
  if (!toolBlock && toolName) {
    toolBlock = msg.contentBlocks.find(b => b.type === 'tool' && b.name === toolName && b.isBuilding)
  }
  // 最终兜底：任意第一个建参块（无法确定名称时）
  if (!toolBlock) {
    toolBlock = msg.contentBlocks.find(b => b.type === 'tool' && b.isBuilding)
  }
  
  if (toolBlock) {
    toolBlock.inputJson = (toolBlock.inputJson || '') + argsFragment
  }
}

/**
 * 工具参数构建完成
 * 收到 tool_ready 信号时调用
 * 
 * @param {object} msg - 消息对象
 * @param {string} toolName - 工具名称
 * @param {object} input - 完整的输入参数
 * @param {string} toolCallId - 工具调用 ID
 */
export const finalizeToolBlock = (msg, toolName, input, toolCallId = null) => {
  if (!msg.contentBlocks) return
  
  const toolBlock = findToolBlock(msg, toolName, toolCallId)
  if (toolBlock) {
    toolBlock.isBuilding = false
    toolBlock.isRunning = true
    toolBlock.input = input
  }
}

/**
 * 更新工具块的结果
 * 
 * @param {object} msg - 消息对象
 * @param {string} toolName - 工具名称
 * @param {any} result - 工具结果
 * @param {string} toolCallId - 工具调用 ID
 */
export const updateToolBlockResult = (msg, toolName, result, toolCallId = null) => {
  const toolBlock = findToolBlock(msg, toolName, toolCallId)
  if (toolBlock) {
    toolBlock.result = result
    toolBlock.isRunning = false
  }
}

/**
 * 标记工具块为已取消
 * 
 * @param {object} msg - 消息对象
 * @param {string} toolName - 工具名称
 * @param {string} toolCallId - 工具调用 ID
 */
export const cancelToolBlock = (msg, toolName, toolCallId = null) => {
  const toolBlock = findToolBlock(msg, toolName, toolCallId)
  if (toolBlock) {
    toolBlock.isRunning = false
    toolBlock.isPaused = false
    toolBlock.isCancelled = true
  }
}

/**
 * 标记工具块为暂停（等待用户确认）
 * 
 * @param {object} msg - 消息对象
 * @param {string} toolName - 工具名称
 * @param {object} interruptPayload - 中断载荷
 * @param {string} toolCallId - 工具调用 ID
 */
export const pauseToolBlock = (msg, toolName, interruptPayload, toolCallId = null) => {
  const toolBlock = findToolBlock(msg, toolName, toolCallId)
  if (toolBlock) {
    toolBlock.isRunning = false
    toolBlock.isPaused = true
    toolBlock.interruptPayload = interruptPayload
  }
}
