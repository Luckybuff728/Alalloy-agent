/**
 * 工具结果处理器
 * 负责根据工具名称和结果类型，决定如何在 UI 上展示（结果面板、交互挂件、Toast 等）
 * 
 * 设计说明：
 * - 使用 toolRegistry 获取工具元信息
 * - 使用 Pinia store 管理业务状态
 * - 根据 resultDisplay 类型决定展示方式
 */
import { ElMessage } from 'element-plus'
import { getResultDisplay, getToolDisplayName, ResultDisplay } from '~/config/toolRegistry'
import { useResultsStore } from '~/stores/results'

/**
 * 处理工具调用结果
 * 
 * @param {object} params.data - 后端返回的完整数据包 { tool, result, display_name }
 * @param {object} params.state - 前端的响应式状态引用集合（简化版）
 * @param {function} params.callbacks - 回调函数集合 { addMessage }
 */
export const processToolResult = ({ data, state, callbacks }) => {
  const { tool, result, display_name } = data
  
  // 使用 Pinia store 管理结果状态
  const resultsStore = useResultsStore()
  
  // 从 state 中只保留必要的 UI 状态
  const { 
    isAgentTyping,
    currentAgent,
    messages,
    widgetQueue
  } = state

  // 使用 store 的 addResult 方法
  const addResult = (type, title, data) => resultsStore.addResult(type, title, data)
  
  const { addMessage } = callbacks

  console.log('[ToolHandler] 处理工具结果:', tool, result)

  // ★ 过滤空结果和交互工具结果
  if (!result || result === '' || result === '""') {
    console.log('[ToolHandler] 跳过空结果:', tool)
    return
  }
  
  // ★ guidance_widget 是交互工具，不在结果区显示
  if (tool === 'show_guidance_widget') {
    console.log('[ToolHandler] 跳过 guidance_widget 结果')
    return
  }

  // 1. 状态更新类工具 - 不显示结果
  if (tool === 'update_params') {
    console.log('[ToolHandler] 参数已更新:', result)
    return
  }

  // 2. 验证工具 - 更新验证状态
  if (tool.includes('validate_composition') || tool.includes('validate_process')) {
    resultsStore.updateState('validation', result)
    return
  }

  // 3. 归一化/RAG/根因分析 - 结果已混入 Chat 消息，无需独立展示
  if (tool.includes('normalize_composition') || 
      tool.includes('query_knowledge_base') || 
      tool.includes('rag') || 
      tool.includes('analyze_root_cause')) {
    return
  }

  // 4. ONNX 性能预测（铝合金）
  // 支持旧工具名称和 MCP 原生工具名称
  if (tool.includes('predict_onnx_performance') || tool === 'onnx_model_inference') {
    if (result && result.status === 'cancelled') {
      console.log('[ToolHandler] ONNX 预测已取消，跳过结果展示')
      return
    }
    
    console.log('[ToolHandler] ONNX 原始结果:', result)
    
    /**
     * 从 onnx_model_inference 的 inputs 字典重建可读成分字符串。
     * inputs 格式: { "W(Si)": 7.5, "W(Mg)": 0.35, "W(Fe)": 0.1, ... }
     * 输出格式: "Al-7.5Si-0.35Mg-0.1Fe"（仅列出质量分数 > 0 的非 Al 元素）
     */
    const buildCompositionFromInputs = (toolInput) => {
      const inputs = toolInput?.inputs
      if (!inputs || typeof inputs !== 'object') return null
      const parts = Object.entries(inputs)
        .filter(([k, v]) => v > 0 && k.startsWith('W(') && k !== 'W(Al)')
        .map(([k, v]) => {
          const elem = k.slice(2, -1) // "W(Si)" → "Si"
          // 去掉末尾无意义的零：7.00 → "7", 0.30 → "0.3"
          const numStr = parseFloat(v.toFixed(4)).toString()
          return `${numStr}${elem}`
        })
      return parts.length > 0 ? `Al-${parts.join('-')}` : null
    }

    // MCP onnx_model_inference 返回纯文本格式："推理完成\nUUID:...\n• UTS: 334.12..."
    // 需要直接从文本中提取数值
    let chartData = null
    
    if (typeof result === 'string') {
      // 检查是否是 MCP 纯文本格式
      if (result.includes('推理完成') || result.includes('UTS:') || result.includes('YS:')) {
        console.log('[ToolHandler] 检测到 MCP 纯文本格式，直接解析')
        
        // 从文本中提取数值
        const extracted = {}
        const lines = result.split('\n')
        
        for (const line of lines) {
          // 匹配 "• UTS: 334.123456" 或 "UTS: 334.123456" 格式
          const m = line.match(/[•\s]*([A-Z]{2,3})\s*:\s*([\d.]+)/i)
          if (m) {
            extracted[m[1].toUpperCase()] = parseFloat(m[2])
          }
        }
        
        console.log('[ToolHandler] 从 MCP 文本提取的数值:', extracted)
        
        if (Object.keys(extracted).length > 0) {
          // ★ 从工具输入参数重建成分字符串
          const compositionStr = buildCompositionFromInputs(data.toolInput) || '未知成分'
          chartData = {
            composition: compositionStr,
            tensile_strength: extracted['UTS'] || 0,
            yield_strength: extracted['YS'] || 0,
            elongation: extracted['EL'] || 0,
            hardness: extracted['HV'] || 0
          }
        }
      } else {
        // 尝试 JSON 解析（旧格式）
        try {
          const parsedResult = JSON.parse(result)
          if (parsedResult.status === 'success' && parsedResult.predictions) {
            let pred = parsedResult.predictions
            
            // 如果 predictions 是字符串，再次提取
            if (typeof pred === 'string') {
              const lines = pred.split('\n')
              const extracted = {}
              for (const line of lines) {
                const m = line.match(/[•\s]*([A-Z]{2,3})\s*:\s*([\d.]+)/i)
                if (m) extracted[m[1].toUpperCase()] = parseFloat(m[2])
              }
              pred = {
                tensile_strength: extracted['UTS'] || 0,
                yield_strength: extracted['YS'] || 0,
                elongation: extracted['EL'] || 0,
                hardness: extracted['HV'] || 0
              }
            }
            
            chartData = {
              composition: parsedResult.composition
                || buildCompositionFromInputs(data.toolInput)
                || '未知成分',
              tensile_strength: pred.tensile_strength || pred.tensileStrength || pred.UTS || 0,
              yield_strength: pred.yield_strength || pred.yieldStrength || pred.YS || 0,
              elongation: pred.elongation || pred.EL || 0,
              hardness: pred.hardness || pred.HV || 0
            }
          }
        } catch (e) {
          console.warn('[ToolHandler] ONNX 结果非 JSON 格式，跳过:', e.message)
        }
      }
    } else if (typeof result === 'object' && result.predictions) {
      // 已经是对象格式
      const pred = result.predictions
      chartData = {
        composition: result.composition
          || buildCompositionFromInputs(data.toolInput)
          || '未知成分',
        tensile_strength: pred.tensile_strength || pred.UTS || 0,
        yield_strength: pred.yield_strength || pred.YS || 0,
        elongation: pred.elongation || pred.EL || 0,
        hardness: pred.hardness || pred.HV || 0
      }
    }
    
    if (chartData && (chartData.tensile_strength > 0 || chartData.yield_strength > 0)) {
      console.log('[ToolHandler] ONNX 图表数据:', chartData)
      resultsStore.updateState('performance', chartData)
      addResult('performance', display_name || 'ONNX 性能预测', chartData)
    } else {
      console.warn('[ToolHandler] ONNX 结果无有效数据:', result)
    }
  }
  // 5. ML 预测（兼容旧工具）
  else if (tool.includes('predict_ml')) {
    if (result && result.status === 'cancelled') {
      console.log('[ToolHandler] ML 预测已取消，跳过结果展示')
      return
    }
    resultsStore.updateState('performance', result)
    addResult('performance', display_name || 'ML 性能预测', result)
  } 
  // 6. Calphad 热力学计算（铝合金）
  // 支持旧工具名称和 MCP 原生工具名称
  else if (tool.includes('submit_calphad_task') || tool.startsWith('calphamesh_submit_')) {
    if (result && result.status === 'cancelled') {
      console.log('[ToolHandler] Calphad 计算已取消，跳过结果展示')
      return
    }
    
    console.log('[ToolHandler] Calphad 原始结果:', result)
    
    // 从工具名称推断计算类型
    const inferredCalcType = tool.includes('scheil') ? 'scheil' 
      : tool.includes('line') ? 'line' 
      : tool.includes('point') ? 'point' 
      : 'scheil'
    
    // MCP Calphad 工具返回纯文本格式："Point计算任务已提交..."、"Scheil计算任务已提交..."、"任务列表 (第1页/共21页)"
    // 这种情况下，结果只是任务提交确认，实际数据需要通过 get_task_result 获取
    if (typeof result === 'string') {
      // 检查是否是 MCP 任务提交确认消息或任务列表
      if (result.includes('计算任务已') || result.includes('task_id') || result.includes('已提交')) {
        console.log('[ToolHandler] 检测到 MCP Calphad 任务提交确认，跳过图表展示')
        // 任务提交确认不需要展示图表，等待 get_task_result 返回实际数据
        return
      }
      
      // calphamesh_list_tasks 返回的任务列表（纯文本格式）
      if (result.includes('任务列表') && (result.includes('completed') || result.includes('pending') || result.includes('failed'))) {
        console.log('[ToolHandler] 检测到 MCP Calphad 任务列表，作为内联文本展示')
        // 任务列表直接作为内联文本展示在聊天中，不需要单独的结果面板
        return
      }
      
      // 尝试 JSON 解析
      try {
        const parsedResult = JSON.parse(result)
        if (parsedResult.status === 'success' && parsedResult.result) {
          const resultData = parsedResult.result
          const calcType = parsedResult.calculation_type || inferredCalcType
          
          if (calcType === 'scheil') {
            const scheilData = {
              composition: parsedResult.composition,
              data: resultData.scheil_data || resultData,
              title: `${parsedResult.composition} Scheil 凝固曲线`
            }
            addResult('scheil', display_name || 'Scheil 凝固曲线', scheilData)
            console.log('[ToolHandler] Scheil 凝固曲线结果已添加')
          } else if (calcType === 'line') {
            const phaseFractionData = {
              data: resultData.phase_fraction_data || resultData,
              phases: resultData.phases || Object.keys(resultData[0] || {}).filter(k => k !== 'temperature'),
              title: `${parsedResult.composition} 相分数-温度曲线`
            }
            addResult('phase_fraction', display_name || '相分数曲线', phaseFractionData)
            console.log('[ToolHandler] 相分数曲线结果已添加')
          } else if (calcType === 'point') {
            addResult('thermo_point', display_name || '热力学点计算', resultData)
            console.log('[ToolHandler] 热力学点计算结果已添加')
          }
        }
      } catch (e) {
        console.warn('[ToolHandler] Calphad 结果非 JSON 格式，可能是状态消息:', result.substring(0, 100))
      }
    } else if (typeof result === 'object' && result.status === 'success' && result.result) {
      // 已经是对象格式
      const resultData = result.result
      const calcType = result.calculation_type || inferredCalcType
      
      if (calcType === 'scheil') {
        const scheilData = {
          composition: result.composition,
          data: resultData.scheil_data || resultData,
          title: `${result.composition} Scheil 凝固曲线`
        }
        addResult('scheil', display_name || 'Scheil 凝固曲线', scheilData)
      } else if (calcType === 'line') {
        const phaseFractionData = {
          data: resultData.phase_fraction_data || resultData,
          phases: resultData.phases || Object.keys(resultData[0] || {}).filter(k => k !== 'temperature'),
          title: `${result.composition} 相分数-温度曲线`
        }
        addResult('phase_fraction', display_name || '相分数曲线', phaseFractionData)
      } else if (calcType === 'point') {
        addResult('thermo_point', display_name || '热力学点计算', resultData)
      }
    }
  }
  // 7. IDME 数据查询
  else if (tool.includes('query_idme')) {
    if (result && result.status === 'cancelled') {
      console.log('[ToolHandler] IDME 查询已取消，跳过结果展示')
      return
    }
    
    let parsedResult = result
    if (typeof parsedResult === 'string') {
      try { parsedResult = JSON.parse(parsedResult) } 
      catch (e) { console.error('[ToolHandler] IDME 结果解析失败:', e); return }
    }
    
    if (parsedResult.status === 'success' || parsedResult.data) {
      addResult('knowledge_search', display_name || 'IDME 数据检索', parsedResult)
      console.log('[ToolHandler] IDME 检索结果已添加')
    }
  }
  // 8. 其他未知工具兜底
  else {
    addResult('other', display_name || tool, result)
  }
}

/**
 * 内部帮助函数：处理挂件插入时机
 */
const handleWidgetInsertion = (widget, state, callbacks) => {
  const { isAgentTyping, widgetQueue, messages } = state
  
  if (isAgentTyping.value) {
    // 如果正在生成中，放入缓冲区，等待 chat_complete 后挂载
    widgetQueue.value.push({ mode: 'attach', widget })
  } else {
    // 立即挂载到最近的 agent 消息
    const targetMsg = messages.value.findLast(m => m.type === 'agent')
    if (targetMsg) {
      targetMsg.widget = widget
      // 注意：这里需要外部触发消息更新，如果是 ref 数组，修改内部属性可能需要 [...] 触发
      messages.value = [...messages.value]
    } else {
       // 兜底：如果没有 Agent 消息，新建一条
       callbacks.addMessage({
         type: 'agent',
         agent: state.currentAgent.value || 'System',
         content: '请进行操作：',
         widget: widget
       })
    }
  }
}
