/**
 * 会话状态恢复器 (v5.0)
 * 负责解析后端的 session_state 数据，并恢复到前端的响应式状态中
 * 
 * v5.0 重构（UI 快照完美恢复）：
 * - ★ 优先使用 ui_snapshot 完美恢复（原样还原所有 contentBlocks、widget 等）
 * - 降级方案：重建 contentBlocks 结构（支持 thinking/chat/tool 块）
 * - 将 tool_result 消息合并到对应的 tool block
 * - 解析后端返回的 tool_results 数组（用于 Results Panel）
 * - 支持所有工具结果类型的恢复（ONNX、Calphad、iDME 等）
 */
import { ElMessage } from 'element-plus'
import { getToolDisplayName } from '../config/toolRegistry'

/**
 * 恢复会话状态
 * 
 * @param {object} params.stateData - 后端返回的 data.state 对象
 * @param {object} params.refs - 前端的 UI Ref 对象集合 { sessionId, messages }
 * @param {object} params.store - Pinia results store 实例
 */
export const restoreSessionState = ({ stateData, refs, store }) => {
  if (!stateData) return

  const { messages } = refs

  // ★ 优先检查是否有 UI 快照（完美恢复）
  if (stateData.ui_snapshot && stateData.ui_snapshot.messages && stateData.ui_snapshot.messages.length > 0) {
    console.log('[SessionRestorer] ★ 使用 UI 快照完美恢复，消息数:', stateData.ui_snapshot.messages.length)
    
    // 直接覆盖 messages（快照已包含完整的 contentBlocks）
    messages.value = stateData.ui_snapshot.messages
    
    // 恢复 Results Panel 状态
    if (stateData.ui_snapshot.resultsState && Array.isArray(stateData.ui_snapshot.resultsState)) {
      for (const result of stateData.ui_snapshot.resultsState) {
        store.addResult(result.type, result.title, result.data)
      }
    }
    
    const savedAt = stateData.ui_snapshot.savedAt
    ElMessage.success(`已恢复会话（${savedAt ? '快照时间: ' + new Date(savedAt).toLocaleTimeString() : '快照恢复'}）`)
    return
  }

  // 降级方案：重建 contentBlocks
  console.log('[SessionRestorer] 使用降级方案恢复，消息数:', stateData.messages?.length || 0, '工具结果数:', stateData.tool_results?.length || 0)

  // 1. ★ 恢复消息历史（重建 contentBlocks）
  if (stateData.messages && stateData.messages.length > 0) {
    messages.value = rebuildMessagesWithContentBlocks(stateData.messages)
  }

  // 2. ★ 解析 tool_results 数组并恢复分析结果卡片
  if (stateData.tool_results && Array.isArray(stateData.tool_results)) {
    let restoredCount = 0
    
    for (const toolResult of stateData.tool_results) {
      const { type, content, tool_name } = toolResult
      
      // 确保 content 是对象（后端可能返回 JSON 字符串或纯文本）
      let parsedContent = content
      if (typeof content === 'string') {
        const trimmed = content.trim()
        // 仅当内容看起来像 JSON 时才尝试解析
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            parsedContent = JSON.parse(content)
          } catch (e) {
            // JSON 解析失败，包装为文本消息对象
            console.warn('[SessionRestorer] JSON 解析失败，作为文本处理:', type)
            parsedContent = { status: 'success', message: content }
          }
        } else {
          // 纯文本内容，包装为消息对象
          parsedContent = { status: 'success', message: content }
        }
      }
      
      // 根据工具类型恢复对应的卡片
      try {
        const restored = restoreToolResult(type, parsedContent, tool_name, store)
        if (restored) restoredCount++
      } catch (e) {
        console.error('[SessionRestorer] 恢复工具结果失败:', type, e)
      }
    }
    
    if (restoredCount > 0) {
      console.log(`[SessionRestorer] 成功恢复 ${restoredCount} 个分析结果`)
    }
  }

  // 3. ★ 恢复待确认的挂件（HITL）
  if (stateData.pending_interrupts && Array.isArray(stateData.pending_interrupts)) {
    restorePendingInterrupts(stateData.pending_interrupts, messages)
  }

  ElMessage.success(`已恢复会话，共 ${stateData.messages?.length || 0} 条消息`)
}

/**
 * 恢复单个工具结果到对应的卡片
 * 
 * @param {string} type - 工具结果类型 (performance_prediction, calphad_task, idme_data)
 * @param {object} content - 解析后的结果内容
 * @param {string} toolName - 工具名称
 * @param {object} store - Pinia store
 * @returns {boolean} 是否成功恢复
 */
const restoreToolResult = (type, content, toolName, store) => {
  // 跳过已取消的任务
  if (content?.status === 'cancelled') {
    return false
  }
  
  switch (type) {
    case 'performance_prediction':
      return restoreONNXResult(content, store)
    
    case 'calphad_task':
      return restoreCalPhadResult(content, store)
    
    case 'idme_data':
      return restoreIDMEResult(content, store)
    
    default:
      console.warn('[SessionRestorer] 未知的工具结果类型:', type)
      return false
  }
}

/**
 * 恢复 ONNX 性能预测结果
 */
const restoreONNXResult = (content, store) => {
  // 纯文本消息（如 "推理完成\nUUID:..."）无法恢复图表
  if (content.message && !content.predictions && !content.result) {
    console.log('[SessionRestorer] ONNX 结果为纯文本，跳过图表恢复:', content.message.slice(0, 50))
    return false
  }
  
  // 多层解析：兼容不同的数据格式
  let predictions = content.predictions
  
  // 如果 predictions 是字符串文本，提取数值
  if (typeof predictions === 'string') {
    const lines = predictions.split('\n')
    const extracted = {}
    
    for (const line of lines) {
      const m = line.match(/[•\s]*([A-Z]{2,3})\s*:\s*([\d.]+)/i)
      if (m) {
        extracted[m[1].toUpperCase()] = parseFloat(m[2])
      }
    }
    
    predictions = {
      tensile_strength: extracted['UTS'] || 0,
      yield_strength: extracted['YS'] || 0,
      elongation: extracted['EL'] || 0,
      hardness: extracted['HV'] || 0
    }
  }
  
  // 构建标准化的图表数据
  const chartData = {
    composition: content.composition || '未知成分',
    tensile_strength: predictions?.tensile_strength || predictions?.UTS || 0,
    yield_strength: predictions?.yield_strength || predictions?.YS || 0,
    elongation: predictions?.elongation || predictions?.EL || 0,
    hardness: predictions?.hardness || predictions?.HV || 0
  }
  
  store.updateState('performance', chartData)
  store.addResult('performance', 'ONNX 性能预测', chartData)
  
  return true
}

/**
 * 恢复 Calphad 热力学计算结果
 */
const restoreCalPhadResult = (content, store) => {
  let parsedContent = content
  if (typeof parsedContent === 'string') {
    try {
      parsedContent = JSON.parse(parsedContent)
    } catch {
      return false
    }
  }

  if (!parsedContent || typeof parsedContent !== 'object') {
    return false
  }

  const buildScheilSeries = (payload) => {
    const rawCurve = payload?.result?.raw_data
    if (rawCurve?.temperatures && rawCurve?.liquid_fractions) {
      return rawCurve.temperatures
        .map((temperature, idx) => {
          const liquid = Number(rawCurve.liquid_fractions[idx] ?? 0)
          return {
            temperature: Number(temperature),
            liquid,
            solid: Number(rawCurve.solid_fractions?.[idx] ?? (1 - liquid))
          }
        })
        .filter(item => !Number.isNaN(item.temperature))
    }

    const keyPoints = payload?.result?.data_summary?.key_points || []
    return keyPoints
      .map(point => ({
        temperature: Number(point.temperature_K ?? point.temperature ?? 0),
        liquid: Number(point.liquid_fraction ?? 0),
        solid: Number(point.solid_fraction ?? (1 - Number(point.liquid_fraction ?? 0)))
      }))
      .filter(item => !Number.isNaN(item.temperature))
  }

  const buildLineSeries = (payload) => {
    const rows = payload?.result?.raw_data || payload?.result?.data_summary?.rows || []
    const phases = new Set()

    const data = rows
      .map(row => {
        if (!row || typeof row !== 'object') return null
        const temperature = Number(
          row['T/K'] ??
          row.temperature ??
          row.temperature_K ??
          row['temperature_K'] ??
          row['Temperature'] ??
          NaN
        )
        if (Number.isNaN(temperature)) return null

        const normalized = { temperature }
        Object.entries(row).forEach(([key, value]) => {
          const match = key.match(/^f\((.+)\)$/)
          if (!match) return
          const phase = match[1]
          const numericValue = Number(value)
          if (!Number.isNaN(numericValue)) {
            normalized[phase] = numericValue
            phases.add(phase)
          }
        })
        return normalized
      })
      .filter(Boolean)

    return { data, phases: Array.from(phases) }
  }

  // 新 MCP 契约：只恢复真正的 get_task_result 结果
  if (parsedContent.task_type) {
    if (['pending', 'running', 'still_running'].includes(parsedContent.status)) {
      return false
    }

    if (parsedContent.task_type === 'scheil_solidification') {
      const scheilSeries = buildScheilSeries(parsedContent)
      if (scheilSeries.length > 0) {
        store.addResult('scheil', 'Scheil 凝固曲线', {
          data: scheilSeries,
          raw: parsedContent,
          title: 'Scheil 凝固曲线'
        })
      } else {
        store.addResult('thermo_scheil', 'Scheil 凝固分析', parsedContent)
      }
      return true
    }

    if (parsedContent.task_type === 'line_calculation') {
      const { data, phases } = buildLineSeries(parsedContent)
      if (data.length > 0 && phases.length > 0) {
        store.addResult('phase_fraction', '相分数曲线', {
          data,
          phases,
          raw: parsedContent,
          title: '相分数-温度曲线'
        })
      } else {
        store.addResult('thermo_line', '线计算结果', parsedContent)
      }
      return true
    }

    if (parsedContent.task_type === 'point_calculation') {
      store.addResult('thermo_point', '热力学点计算', parsedContent)
      return true
    }

    store.addResult('thermo_point', '热力学结果', parsedContent)
    return true
  }

  // 兼容旧格式
  if (parsedContent.message && !parsedContent.result) {
    console.log('[SessionRestorer] Calphad 结果为纯文本，跳过图表恢复:', parsedContent.message.slice(0, 50))
    return false
  }

  if (parsedContent.status !== 'success' || !parsedContent.result) {
    return false
  }

  const calcType = parsedContent.calculation_type || 'scheil'
  const resultData = parsedContent.result
  const composition = parsedContent.composition || '未知成分'

  switch (calcType) {
    case 'scheil':
      store.addResult('scheil', 'Scheil 凝固曲线', {
        composition,
        data: resultData.scheil_data || resultData,
        title: `${composition} Scheil 凝固曲线`
      })
      return true

    case 'phase_fraction':
      store.addResult('phase_fraction', '相分数曲线', {
        composition,
        data: resultData.phase_data || resultData,
        title: `${composition} 相分数曲线`
      })
      return true

    case 'point':
      store.addResult('thermo_point', '热力学点计算', {
        composition,
        data: resultData,
        title: `${composition} 热力学点计算`
      })
      return true

    case 'line':
      store.addResult('thermo_line', '相图计算', {
        composition,
        data: resultData,
        title: `${composition} 相图线计算`
      })
      return true

    default:
      return false
  }
}

/**
 * 恢复 iDME 知识检索结果
 */
const restoreIDMEResult = (content, store) => {
  store.addResult('knowledge_search', '知识检索', content)
  return true
}

/**
 * 恢复待确认的挂件（HITL）- 降级路径专用
 *
 * 后端 _extract_pending_interrupts 实际返回格式：
 *   { type: "guidance_widget" | "hitl_review" | "generic", id: string, payload: object }
 *
 * 注意：UI 快照路径不会进入此函数（快照已保存完整 widget/interruptPayload 状态）。
 *
 * @param {Array} interrupts - 待确认的 interrupt 列表（后端格式）
 * @param {Ref} messages - 消息列表 ref（已由 rebuildMessagesWithContentBlocks 重建）
 */
const restorePendingInterrupts = (interrupts, messages) => {
  if (!interrupts || interrupts.length === 0) return

  let restoredCount = 0

  for (const interrupt of interrupts) {
    const { type, id, payload } = interrupt

    if (type === 'guidance_widget') {
      // ── 引导挂件：找到最后一条 agent 消息，附加 widget ─────────
      // payload 格式: { interrupt_type: "guidance_widget", widget: {...}, ... }
      const widget = payload?.widget
      if (!widget) {
        console.warn('[SessionRestorer] guidance_widget interrupt 缺少 widget 字段，id:', id)
        continue
      }

      const lastAgentMsg = [...messages.value].reverse().find(m => m.type === 'agent')
      if (lastAgentMsg) {
        lastAgentMsg.widget = widget
        restoredCount++
        console.log('[SessionRestorer] guidance_widget 已恢复到最后一条 agent 消息:', widget.title)
      } else {
        console.warn('[SessionRestorer] 未找到 agent 消息用于附加 guidance_widget')
      }

    } else if (type === 'hitl_review') {
      // ── HITL 工具审批：在 agent 消息的 tool blocks 中找到匹配的工具 ──
      // payload 格式: { action_requests: [{name, args}, ...], review_configs: [...] }
      const actionRequests = payload?.action_requests || []
      const toolNames = new Set(actionRequests.map(a => a.name).filter(Boolean))

      if (toolNames.size === 0) {
        console.warn('[SessionRestorer] hitl_review interrupt 的 action_requests 为空，id:', id)
        continue
      }

      // 从最后一条消息向前搜索，找到包含对应工具块的 agent 消息
      let found = false
      for (let i = messages.value.length - 1; i >= 0; i--) {
        const msg = messages.value[i]
        if (msg.type !== 'agent' || !Array.isArray(msg.contentBlocks)) continue

        const matchedBlocks = msg.contentBlocks.filter(
          b => b.type === 'tool' && toolNames.has(b.name)
        )

        if (matchedBlocks.length > 0) {
          for (const block of matchedBlocks) {
            block.isPaused = true
            block.isRunning = false
            block.interruptPayload = payload
            restoredCount++
          }
          // 保存整个 hitl payload 到消息，供 sendResume 重建有序 decisions
          msg._hitlPayload = payload
          found = true
          console.log('[SessionRestorer] hitl_review 已恢复到工具块:', [...toolNames].join(', '))
          break
        }
      }

      if (!found) {
        console.warn('[SessionRestorer] 未找到匹配工具块用于 hitl_review，工具:', [...toolNames].join(', '))
      }

    } else {
      // generic：暂无针对性 UI 恢复逻辑，记录日志即可
      console.log('[SessionRestorer] 跳过 generic interrupt 恢复，id:', id)
    }
  }

  if (restoredCount > 0) {
    console.log(`[SessionRestorer] 成功恢复 ${restoredCount} 个待确认挂件`)
    messages.value = [...messages.value]
  }
}

/**
 * ★ 重建消息的 contentBlocks 结构（v4.1）
 * 
 * 核心改进：
 * 1. 合并连续的 agent 消息（LangGraph 一轮对话可能产生多条 AIMessage）
 * 2. 智能识别推理内容：有 tool_calls 的消息内容作为 thinking 块
 * 
 * 后端返回的消息格式：
 * - { type: 'user', content: '...' }
 * - { type: 'agent', content: '...', agent: '...', tool_calls: [...] }
 * - { type: 'tool_result', tool_name: '...', content: '...', tool_call_id: '...' }
 * 
 * @param {Array} rawMessages - 后端返回的原始消息数组
 * @returns {Array} 重建后的消息数组
 */
const rebuildMessagesWithContentBlocks = (rawMessages) => {
  const result = []
  const pendingToolResults = new Map() // tool_call_id -> result
  
  // 第一遍：收集所有 tool_result
  for (const msg of rawMessages) {
    if (msg.type === 'tool_result' && msg.tool_call_id) {
      pendingToolResults.set(msg.tool_call_id, {
        tool_name: msg.tool_name,
        content: msg.content
      })
    }
  }
  
  // 第二遍：重建消息（合并连续的 agent 消息）
  let currentAgentMsg = null // 当前正在构建的 agent 消息
  
  for (const msg of rawMessages) {
    // 跳过 tool_result 消息（已合并到 agent 消息）
    if (msg.type === 'tool_result') {
      continue
    }
    
    // 用户消息：结束当前 agent 消息，开始新的用户消息
    if (msg.type === 'user') {
      // 保存之前的 agent 消息
      if (currentAgentMsg) {
        result.push(currentAgentMsg)
        currentAgentMsg = null
      }
      
      result.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'user',
        content: msg.content,
        timestamp: msg.timestamp || new Date().toISOString()
      })
      continue
    }
    
    // Agent 消息：合并到当前 agent 消息或创建新的
    if (msg.type === 'agent') {
      // ★ 关键逻辑：连续的 agent 消息合并为一条
      if (!currentAgentMsg) {
        currentAgentMsg = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'agent',
          agent: msg.agent || 'Assistant',
          content: '',
          contentBlocks: [],
          timestamp: msg.timestamp || new Date().toISOString(),
          isStreaming: false
        }
      }
      
      // ★ 智能识别推理内容：有 tool_calls → content 是推理过程
      const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0
      
      if (msg.content) {
        if (hasToolCalls) {
          // 有工具调用 → content 作为推理块（thinking）
          currentAgentMsg.contentBlocks.push({
            type: 'text',
            blockType: 'thinking',
            content: msg.content,
            collapsed: true // 默认收起
          })
        } else {
          // 无工具调用 → content 作为聊天块（chat）
          // 但先检查是否有 <think> 标签
          const { thinkingContent, chatContent } = parseAgentContent(msg.content)
          
          if (thinkingContent) {
            currentAgentMsg.contentBlocks.push({
              type: 'text',
              blockType: 'thinking',
              content: thinkingContent,
              collapsed: true
            })
          }
          
          if (chatContent) {
            currentAgentMsg.contentBlocks.push({
              type: 'text',
              blockType: 'chat',
              content: chatContent
            })
          }
        }
      }
      
      // 添加工具块（如果有 tool_calls）
      if (hasToolCalls) {
        for (const tc of msg.tool_calls) {
          const toolResult = pendingToolResults.get(tc.id)
          
          currentAgentMsg.contentBlocks.push({
            type: 'tool',
            name: tc.name,
            displayName: getToolDisplayName(tc.name) || tc.name,
            id: tc.id,
            input: tc.args || {},
            inputJson: JSON.stringify(tc.args || {}, null, 2),
            isBuilding: false,
            isRunning: false,
            isPaused: false,
            isCancelled: false,
            result: toolResult ? toolResult.content : null,
            hasError: false
          })
        }
      }
      
      continue
    }
    
    // 其他类型消息（system 等）：结束当前 agent 消息
    if (currentAgentMsg) {
      result.push(currentAgentMsg)
      currentAgentMsg = null
    }
    
    result.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: msg.type || 'system',
      content: msg.content,
      timestamp: msg.timestamp || new Date().toISOString()
    })
  }
  
  // 保存最后一个 agent 消息
  if (currentAgentMsg) {
    result.push(currentAgentMsg)
  }
  
  return result
}

/**
 * 解析 Agent 内容，分离推理内容和最终回复
 * 
 * 常见模式：
 * - <think>...</think> 标签包裹推理内容
 * - 推理内容通常以特定格式开头（如"让我分析..."、"首先..."）
 * - 最终回复通常在末尾
 * 
 * @param {string} content - 原始内容
 * @returns {{ thinkingContent: string, chatContent: string }}
 */
const parseAgentContent = (content) => {
  if (!content) return { thinkingContent: '', chatContent: '' }
  
  // 检测 <think>...</think> 标签
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i)
  if (thinkMatch) {
    const thinkingContent = thinkMatch[1].trim()
    const chatContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    return { thinkingContent, chatContent }
  }
  
  // 检测 [思考] ... [/思考] 标签
  const thinkMatch2 = content.match(/\[思考\]([\s\S]*?)\[\/思考\]/i)
  if (thinkMatch2) {
    const thinkingContent = thinkMatch2[1].trim()
    const chatContent = content.replace(/\[思考\][\s\S]*?\[\/思考\]/gi, '').trim()
    return { thinkingContent, chatContent }
  }
  
  // 没有明确的推理标记，全部作为 chat 内容
  return { thinkingContent: '', chatContent: content }
}
