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

// ══════════════════════════════════════════════════════════
// 任务注册表：task_id → 提交时的成分/参数信息
// 解决"卡片无法区分来自哪个配方"的问题
// ══════════════════════════════════════════════════════════
const _taskRegistry = new Map()

/**
 * 将 CalphaMesh 摩尔分数成分格式化为合金标识字符串
 * 示例：{AL:0.93, SI:0.04, MG:0.01, FE:0.015, MN:0.005}
 *      → "Al-4Si-1Mg-1.5Fe-0.5Mn" (原子百分比)
 *
 * @param {object} composition - 摩尔分数成分 {AL:0.93, SI:0.04, ...}
 * @param {string[]} [components] - 组元列表（用于补充排序）
 * @returns {string|null}
 */
export const formatAlloyLabel = (composition, components) => {
  if (!composition || typeof composition !== 'object') return null
  const entries = Object.entries(composition)
    .filter(([, v]) => Number(v) > 0.0001)

  if (entries.length === 0) return null

  // AL（基体）始终排在首位
  const sorted = [...entries].sort(([a], [b]) => {
    const aIsAl = a.toUpperCase() === 'AL'
    const bIsAl = b.toUpperCase() === 'AL'
    if (aIsAl) return -1
    if (bIsAl) return 1
    // 其余按摩尔分数从大到小
    return Number(composition[b]) - Number(composition[a])
  })

  const parts = []
  for (const [elem, fraction] of sorted) {
    const elemName = elem.charAt(0).toUpperCase() + elem.slice(1).toLowerCase()
    const pct = Number(fraction) * 100

    if (pct > 90) {
      // 基体元素（如 Al > 90%）只显示元素名
      parts.push(elemName)
    } else {
      // 合金元素：先用 toPrecision(3) 取 3 位有效数字避免浮点尾数
      // 再用 parseFloat 去掉末尾的零：4.00→4, 1.50→1.5, 0.050→0.05
      const rounded = parseFloat(parseFloat(pct.toPrecision(3)).toFixed(4))
      const pctStr = rounded.toString()
      parts.push(`${pctStr}${elemName}`)
    }
  }
  return parts.join('-')
}

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

  console.log('[ToolHandler] 处理工具结果:', tool)

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

  // ★ generate_report — 解析 JSON 并在结果区展示报告卡片
  if (tool === 'generate_report') {
    let reportData = null
    if (typeof result === 'string') {
      try { reportData = JSON.parse(result) } catch (e) {
        console.warn('[ToolHandler] generate_report 结果解析失败:', e)
      }
    } else if (typeof result === 'object') {
      reportData = result
    }
    if (reportData && reportData.report_type === 'alloy_design_report') {
      addResult('alloy_design_report', reportData.title || '铝合金设计可行性报告', reportData)
      console.log('[ToolHandler] 报告已添加到结果面板')
    }
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
    
    console.log('[ToolHandler] ONNX 结果长度:', typeof result === 'string' ? result.length : JSON.stringify(result).length)
    
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
      console.log('[ToolHandler] ONNX 图表数据: UTS=', chartData.tensile_strength, 'EL=', chartData.elongation)
      resultsStore.updateState('performance', chartData)
      // ONNX 的 composition 已在 buildCompositionFromInputs 中格式化（wt%）
      // 作为 alloyLabel 附加到结果数据中，与 CalphaMesh 卡片保持一致显示规范
      const onnxLabel = chartData.composition ?? null
      addResult('performance', display_name || 'ONNX 性能预测', { ...chartData, alloyLabel: onnxLabel })
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
  // 6. Calphad / CalphaMesh 热力学计算
  else if (
    tool.includes('submit_calphad_task') ||
    tool.startsWith('calphamesh_submit_') ||
    tool === 'calphamesh_get_task_result' ||
    tool === 'calphamesh_get_task_status' ||
    tool === 'calphamesh_list_tasks'
  ) {
    if (result && result.status === 'cancelled') {
      console.log('[ToolHandler] Calphad 计算已取消，跳过结果展示')
      return
    }
    
    console.log('[ToolHandler] Calphad 结果长度:', typeof result === 'string' ? result.length : JSON.stringify(result).length)

    const parseMaybeJson = (value) => {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }

    /**
     * 从 CSV 行对象中提取温度值（兼容多种列名格式）
     * 兼容：'T/K', 'T/K ', 'T(K)', 'Temperature', 'T', 'temperature_K', BOM 前缀等
     */
    const extractTempFromRow = (row) => {
      if (!row || typeof row !== 'object') return NaN
      const keys = Object.keys(row)
      // 精确匹配优先（含去除首尾空白和 BOM 的变体）
      for (const k of keys) {
        const clean = k.trim().replace(/^\ufeff/, '')   // 去 BOM
        if (['T/K', 'T(K)', 'Temperature(K)', 'temperature_K', 'T'].includes(clean)) {
          const v = Number(row[k])
          if (!Number.isNaN(v) && v > 0) return v
        }
      }
      // 模糊匹配：列名以 T 开头且不是相分数列 f(*) 的
      const tKey = keys.find(k => {
        const u = k.trim().toUpperCase()
        return (u === 'T' || u.startsWith('T/') || u.startsWith('T(') || u === 'TEMPERATURE')
          && !u.startsWith('F(')
      })
      if (tKey) {
        const v = Number(row[tKey])
        if (!Number.isNaN(v) && v > 0) return v
      }
      // 最后兜底：取第一个值 > 100 的数字列（温度通常 > 200K）
      for (const k of keys) {
        const v = Number(row[k])
        if (!Number.isNaN(v) && v > 200 && v < 10000) return v
      }
      return NaN
    }

    /**
     * 从 CSV 行对象中提取液相分数
     * 兼容两种 CALPHAD 输出格式：
     *   - f(LIQUID)：Phase Fraction 格式（部分引擎）
     *   - NP(LIQUID)：Number of moles of Phase 格式（topthermo-next 实际输出）
     */
    const extractLiquidFromRow = (row) => {
      if (!row || typeof row !== 'object') return null   // null = 未找到（区别于 0.0）
      for (const k of Object.keys(row)) {
        const u = k.trim().toUpperCase()
        // 精确匹配两种格式的液相列名
        if (u === 'F(LIQUID)' || u === 'NP(LIQUID)' || u === 'LIQUID' || u === 'F_LIQUID') {
          const v = Number(row[k])
          return Number.isNaN(v) ? 0 : v
        }
      }
      return null  // 未找到液相列
    }

    /**
     * 从 CSV 行对象中提取各固相分数之和
     * 兼容 f(*) 和 NP(*) 两种格式
     */
    const extractSolidFromRow = (row, liquidKey) => {
      return Object.entries(row)
        .filter(([k]) => {
          const u = k.trim().toUpperCase()
          const isPhaseCol = u.startsWith('F(') || u.startsWith('NP(')
          const isLiquid = u === 'F(LIQUID)' || u === 'NP(LIQUID)'
          const isPressure = u.includes('P/PA') || u === 'P/PA' || u.startsWith('P(')
          const isTemp = u === 'T/K' || u === 'T' || u.startsWith('T(')
          return isPhaseCol && !isLiquid && !isPressure && !isTemp
        })
        .reduce((sum, [, v]) => {
          const n = Number(v)
          return sum + (Number.isNaN(n) ? 0 : n)
        }, 0)
    }

    /**
     * 将 CSV 行对象数组转换为 Scheil 图表数据序列
     * 支持 f(*) 和 NP(*) 两种相分数列名格式
     */
    const csvRowsToScheilSeries = (rows) => {
      return rows
        .map(row => {
          const temperature = extractTempFromRow(row)
          if (Number.isNaN(temperature) || temperature <= 0) return null

          const liquidRaw = extractLiquidFromRow(row)

          // 如果液相列未找到，尝试从固相合计反推
          if (liquidRaw === null) {
            const solid = extractSolidFromRow(row, null)
            const liquid = Math.max(0, 1 - solid)
            return { temperature, liquid, solid }
          }

          const liquid = Math.min(1, Math.max(0, liquidRaw))
          const solid = extractSolidFromRow(row, null)

          // 优先使用实际固相合计；如无固相数据则用 1 - liquid
          return { temperature, liquid, solid: solid > 0.001 ? solid : Math.max(0, 1 - liquid) }
        })
        .filter(Boolean)
    }

    /**
     * 从 CalphaMesh Scheil 结果构建图表数据序列。
     * 优先级：
     *  1. full 模式的 raw_data（完整 CSV 行对象数组）
     *  2. legacy raw_data.temperatures + liquid_fractions（旧 JSON 格式）
     *  3. summary 模式的 data_summary.shown_rows（CSV 行，最多 20 行）
     *  4. data_summary.key_points（最后兜底，仅 3 个关键点）
     */
    const buildScheilSeries = (payload) => {
      // ① full 模式：raw_data 是 CSV 行对象数组（来自 handle_scheil_csv_result）
      const rawData = payload?.result?.raw_data
      if (Array.isArray(rawData) && rawData.length > 1) {
        const rows = csvRowsToScheilSeries(rawData)
        if (rows.length > 1) return rows
      }

      // ② legacy: raw_data.temperatures + liquid_fractions 格式
      if (rawData?.temperatures && rawData?.liquid_fractions) {
        return rawData.temperatures
          .map((temperature, idx) => {
            const liquid = Number(rawData.liquid_fractions[idx] ?? 0)
            return { temperature: Number(temperature), liquid, solid: Number(rawData.solid_fractions?.[idx] ?? (1 - liquid)) }
          })
          .filter(item => !Number.isNaN(item.temperature))
      }

      // ③ summary 模式：data_summary.shown_rows（CSV 行格式，最多 20 行）
      const shownRows = payload?.result?.data_summary?.shown_rows
      if (Array.isArray(shownRows) && shownRows.length > 0) {
        const rows = csvRowsToScheilSeries(shownRows)
        if (rows.length > 0) return rows
      }

      // ④ 兜底：key_points（仅 3 点，分辨率很低，仅用于无其他数据时）
      const keyPoints = payload?.result?.data_summary?.key_points || []
      return keyPoints
        .map(point => ({
          temperature: Number(point.temperature_K ?? point.temperature ?? 0),
          liquid: Number(point.liquid_fraction ?? 0),
          solid: Number(point.solid_fraction ?? (1 - Number(point.liquid_fraction ?? 0)))
        }))
        .filter(item => !Number.isNaN(item.temperature) && item.temperature > 0)
    }

    const buildLineSeries = (payload) => {
      // 优先 full 模式的 raw_data（完整数据），降级 data_summary.rows（最多 20 行摘要）
      const rows = payload?.result?.raw_data || payload?.result?.data_summary?.rows || []
      const phases = new Set()

      const data = rows
        .map(row => {
          if (!row || typeof row !== 'object') return null

          // 温度：支持 T/K（Rust 输出）、temperature 等多种列名
          const temperature = Number(
            row['T/K'] ??
            row.temperature ??
            row.temperature_K ??
            row['temperature_K'] ??
            row['Temperature'] ??
            NaN
          )
          if (Number.isNaN(temperature) || temperature <= 0) return null

          // 提取所有 f(*) 相分数列，key 格式为 "f(FCC_A1)"，值为 0-1
          const normalized = { temperature }
          Object.entries(row).forEach(([key, value]) => {
            const match = key.trim().match(/^f\((.+)\)$/)
            if (!match) return
            const phase = match[1].trim()
            const numericValue = Number(value)
            // 过滤 NaN 和无效值（允许 0.0，不允许负值）
            if (!Number.isNaN(numericValue) && numericValue >= 0 && numericValue <= 1.001) {
              normalized[phase] = numericValue
              phases.add(phase)
            }
          })

          // 至少要有一个相分数才算有效行
          if (Object.keys(normalized).length <= 1) return null
          return normalized
        })
        .filter(Boolean)

      // 对所有已知相进行补零：在某温度点不存在的相，phase fraction = 0
      const phaseList = Array.from(phases)
      data.forEach(row => {
        phaseList.forEach(phase => {
          if (row[phase] === undefined) row[phase] = 0
        })
      })

      return { data, phases: phaseList }
    }

    const parsedResult = parseMaybeJson(result)

    // 新工作流：submit 只作为过程信息，但要先注册任务元数据（成分、温度等）
    if (tool.startsWith('calphamesh_submit_')) {
      // 从 submit 结果提取 task_id，从 toolInput 提取成分参数
      const taskId = parsedResult?.task_id ?? parsedResult?.id
      if (taskId) {
        // data.toolInput 是工具调用时传入的参数对象（由 useMultiAgent 注入）
        const input = data.toolInput ?? {}

        const comps     = input.components ?? input.arguments?.components
        const temp      = input.temperature ?? input.arguments?.temperature
        const startTemp = input.start_temperature ?? input.arguments?.start_temperature
        const tdbFile   = input.tdb_file ?? input.arguments?.tdb_file

        // ── alloyLabel 构建策略 ────────────────────────────────────────
        // binary / ternary：参数里的成分是"端点顶点"（{AL:1.0, SI:0.0}），
        // 直接用 formatAlloyLabel 只能得到 "Al"（无意义），改用组元名列表。
        // 其余任务：从实际成分构建，支持多字段名（composition / start_composition）。
        const isBinaryOrTernary = tool === 'calphamesh_submit_binary_task'
          || tool === 'calphamesh_submit_ternary_task'

        // ★ comp 声明在 if/else 外，避免块作用域导致 ReferenceError
        const comp = isBinaryOrTernary
          ? null   // binary/ternary 不依赖单一成分
          : (input.composition
              ?? input.start_composition
              ?? input.arguments?.composition
              ?? input.arguments?.start_composition
              ?? null)

        let alloyLabel
        if (isBinaryOrTernary) {
          alloyLabel = (comps ?? [])
            .map(e => e.charAt(0).toUpperCase() + e.slice(1).toLowerCase())
            .join('-') || null
        } else {
          alloyLabel = formatAlloyLabel(comp, comps)
          if (!alloyLabel && comps && comps.length >= 2) {
            alloyLabel = comps
              .map(e => e.charAt(0).toUpperCase() + e.slice(1).toLowerCase())
              .join('-')
          }
        }

        const taskType = parsedResult?.task_type

        _taskRegistry.set(taskId, { alloyLabel, comp, comps, temp, startTemp, tdbFile, taskType })
        console.log(`[ToolHandler] 注册任务 ${taskId} → ${alloyLabel ?? '(无成分)'}`)
      }
      return
    }

    if (tool === 'calphamesh_get_task_status' || tool === 'calphamesh_list_tasks') {
      console.log('[ToolHandler] CalphaMesh 状态/列表结果仅作过程信息展示，不加入结果面板')
      return
    }

    if (tool === 'calphamesh_get_task_result') {
      // ── 工具调用失败（is_error=true 或结果无法解析为对象）──────────────────
      if (data.is_error || !parsedResult || typeof parsedResult !== 'object') {
        // 尝试从错误字符串中提取 JSON 错误详情
        let errorMsg = '热力学计算失败'
        let taskId = data.toolInput?.task_id ?? data.toolInput?.arguments?.task_id ?? ''
        if (typeof result === 'string') {
          const jsonMatch = result.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            try {
              const errObj = JSON.parse(jsonMatch[0])
              errorMsg = errObj.message || errObj.details || errorMsg
              taskId = errObj.task_id ?? taskId
            } catch { /* 解析失败时使用默认提示 */ }
          }
        }
        const taskLabel = taskId ? `任务 ${taskId}` : '热力学计算'
        console.warn(`[ToolHandler] CalphaMesh 结果获取失败 (${taskLabel}): ${typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200)}`)
        ElMessage({
          type: 'warning',
          message: `${taskLabel} 失败：${errorMsg}`,
          duration: 6000,
          showClose: true,
        })
        return
      }

      if (['pending', 'running', 'still_running'].includes(parsedResult.status)) {
        console.log('[ToolHandler] CalphaMesh 任务仍在运行，跳过结果面板展示')
        return
      }

      // 从任务注册表查找成分标签（由 submit 时注入）
      const queryTaskId = data.toolInput?.task_id ?? data.toolInput?.arguments?.task_id
      const taskMeta = queryTaskId ? _taskRegistry.get(queryTaskId) : null

      // 从 point 计算结果中也可直接读取成分（results.json 包含 compositions 字段）
      const resultCompositions = parsedResult?.result?.compositions
      const alloyLabel = taskMeta?.alloyLabel
        ?? formatAlloyLabel(resultCompositions)
        ?? null

      if (alloyLabel) {
        console.log(`[ToolHandler] 任务 ${queryTaskId} 成分标签: ${alloyLabel}`)
      }

      // 封装注入 alloyLabel 的辅助函数，对每次 addResult 统一附加成分信息
      const addResultWithMeta = (type, title, resultData) => {
        const enriched = resultData && typeof resultData === 'object'
          ? { ...resultData, alloyLabel }
          : resultData
        addResult(type, title, enriched)
      }

      if (parsedResult.task_type === 'scheil_solidification') {
        const scheilSeries = buildScheilSeries(parsedResult)
        const ds = parsedResult?.result?.data_summary ?? {}
        const title = [
          'Scheil 非平衡凝固曲线',
          ds?.temperature_range?.solidus_K
            ? `（固相线 ${Number(ds.temperature_range.solidus_K).toFixed(0)} K）`
            : ''
        ].join('')
        if (scheilSeries.length > 1) {
          addResultWithMeta('scheil', display_name || title, {
            data: scheilSeries,
            raw: parsedResult,
            title,
          })
        } else {
          addResultWithMeta('thermo_point', display_name || 'Scheil 凝固分析', parsedResult)
        }
        return
      }

      if (parsedResult.task_type === 'line_calculation') {
        const { data: phaseData, phases } = buildLineSeries(parsedResult)
        const ds = parsedResult?.result?.data_summary ?? {}
        const tRange = ds?.temperature_range
          ? `${Number(ds.temperature_range.start ?? 0).toFixed(0)}–${Number(ds.temperature_range.end ?? 0).toFixed(0)} K`
          : ''
        if (phaseData.length > 0 && phases.length > 0) {
          addResultWithMeta('phase_fraction', display_name || `相分数-温度曲线 ${tRange}`, {
            data: phaseData,
            phases,
            raw: parsedResult,
            title: `相分数-温度曲线（平衡冷却）${tRange ? ' ' + tRange : ''}`,
          })
        } else {
          addResultWithMeta('thermo_point', display_name || '线计算结果', parsedResult)
        }
        return
      }

      if (parsedResult.task_type === 'point_calculation') {
        addResultWithMeta('thermo_point', display_name || '热力学点计算', parsedResult)
        return
      }

      if (parsedResult.task_type === 'binary_equilibrium') {
        // 若 Rust 端未能解析出 system 名，用 taskMeta 中的组元名补充
        const binaryEnriched = { ...parsedResult, alloyLabel }
        if (taskMeta?.comps && binaryEnriched.result?.data_summary) {
          const sysName = binaryEnriched.result.data_summary.system
          if (!sysName || sysName === 'Al-Si') {
            // 从 components 构建更准确的体系名
            const systemLabel = taskMeta.comps
              .map(e => e.charAt(0).toUpperCase() + e.slice(1).toLowerCase())
              .join('-')
            binaryEnriched.result = {
              ...binaryEnriched.result,
              data_summary: { ...binaryEnriched.result.data_summary, system: systemLabel }
            }
          }
        }
        addResult('binary_phase', display_name || '二元平衡相图', binaryEnriched)
        return
      }

      if (parsedResult.task_type === 'ternary_calculation') {
        // Rust 端不包含截面温度，从 taskMeta 中注入（submit 时保存的 temperature 参数）
        const ternaryEnriched = { ...parsedResult, alloyLabel }
        if (taskMeta?.temp != null && ternaryEnriched.result?.data_summary) {
          ternaryEnriched.result = {
            ...ternaryEnriched.result,
            data_summary: {
              ...ternaryEnriched.result.data_summary,
              temperature_K: taskMeta.temp   // 注入截面温度
            }
          }
        }
        addResult('ternary_phase', display_name || '三元等温截面', ternaryEnriched)
        return
      }

      if (parsedResult.task_type === 'thermodynamic_properties') {
        addResultWithMeta('thermo_properties', display_name || '热力学性质曲线', parsedResult)
        return
      }

      // 沸点/熔点计算
      if (parsedResult.task_type === 'boiling_point') {
        addResultWithMeta('boiling_point', display_name || '熔点/沸点计算', parsedResult)
        return
      }

      addResultWithMeta('thermo_point', display_name || '热力学结果', parsedResult)
      return
    }

    // 兼容旧本地 Calphad 工具输出
    const inferredCalcType = tool.includes('scheil')
      ? 'scheil'
      : tool.includes('line')
        ? 'line'
        : tool.includes('point')
          ? 'point'
          : 'scheil'

    if (typeof parsedResult === 'object' && parsedResult?.status === 'success' && parsedResult?.result) {
      const resultData = parsedResult.result
      const calcType = parsedResult.calculation_type || inferredCalcType

      if (calcType === 'scheil') {
        addResult('scheil', display_name || 'Scheil 凝固曲线', {
          composition: parsedResult.composition,
          data: resultData.scheil_data || resultData,
          title: `${parsedResult.composition} Scheil 凝固曲线`
        })
      } else if (calcType === 'line') {
        addResult('phase_fraction', display_name || '相分数曲线', {
          data: resultData.phase_fraction_data || resultData,
          phases: resultData.phases || Object.keys(resultData[0] || {}).filter(k => k !== 'temperature'),
          title: `${parsedResult.composition} 相分数曲线`
        })
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
  // 8. 其他工具兜底：只有注册表中 resultDisplay 不是 NONE/INLINE 的工具才展示卡片
  else {
    const display = getResultDisplay(tool)
    if (display === ResultDisplay.CARD || display === ResultDisplay.CHART) {
      addResult('other', display_name || tool, result)
    } else {
      console.log('[ToolHandler] 工具结果不展示到结果面板:', tool)
    }
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
