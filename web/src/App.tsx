/**
 * Al-IDME 主应用
 * 铝合金智能设计系统
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// 组件导入 - 统一从 components 目录导出
import { 
  ResizableLayout,
  TopBar,
  WorkflowPanel,
  ChatPanel,
  ResultsPanel,
  type WorkflowStep, 
  type ToolResult,
  type Message,
  type PerformanceData 
} from './components'

// ================================
// 类型定义
// ================================

interface AppState {
  messages: Message[]
  workflowStatus: 'idle' | 'running' | 'completed' | 'error'
  steps: WorkflowStep[]
  toolResults: ToolResult[]
  recommendedAlloys: string[]
  analysisResults: any[]
  performanceData: PerformanceData[]
  thermoData: any[]
  finalReport: string
  streamingTexts: Record<string, string>  // LLM 流式文本缓冲，按 node 存储
}


// ================================
// 主应用组件
// ================================

function App() {
  const [input, setInput] = useState('')
  const [state, setState] = useState<AppState>({
    messages: [],
    workflowStatus: 'idle',
    steps: [],
    toolResults: [],
    recommendedAlloys: [],
    analysisResults: [],
    performanceData: [],
    thermoData: [],
    finalReport: '',
    streamingTexts: {}  // 初始化流式文本缓冲
  })

  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const isConnecting = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [state.messages, state.steps])

  // WebSocket 连接
  useEffect(() => {
    if (isConnecting.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }
    isConnecting.current = true

    // 从环境变量获取 WebSocket 地址，默认为 8001 端口
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8001/ws/run'
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket 已连接')
      setIsConnected(true)
      isConnecting.current = false
    }

    ws.onclose = () => {
      console.log('WebSocket 已断开')
      setIsConnected(false)
      isConnecting.current = false
    }

    ws.onerror = (error) => {
      console.error('WebSocket 错误:', error)
      isConnecting.current = false
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleMessage(data)
      } catch (e) {
        console.error('解析消息失败', e)
      }
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [])

  const sendMessage = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(message)
    }
  }, [])

  // 统一消息处理
  const handleMessage = (msg: any) => {
    const { type, node, meta, data, timestamp } = msg

    switch (type) {
      case 'workflow_start':
        setState(prev => ({
          ...prev,
          workflowStatus: 'running',
          steps: [],
          toolResults: [],
          recommendedAlloys: [],
          analysisResults: [],
          performanceData: [],
          thermoData: [],
          finalReport: ''
        }))
        break

      case 'node_start': {
        const composition = msg.composition
        
        // 热力学计算节点需要展开为3个子节点
        const targetNodes = node === 'calculate_thermo' 
          ? ['calculate_thermo_point', 'calculate_thermo_line', 'calculate_thermo_scheil']
          : [node]
        
        // 热力学计算节点初始状态为 queued（排队中），其他节点为 running
        const isThermo = node === 'calculate_thermo'
        const initialStatus = isThermo ? 'queued' : 'running'
        
        setState(prev => {
          const newSteps = [...prev.steps]
          
          targetNodes.forEach(targetNode => {
            // 检查是否已存在该步骤（按节点名+合金成分匹配）
            const existingIdx = newSteps.findIndex(s => 
              s.node === targetNode && 
              (!composition || !s.composition || s.composition === composition)
            )
            
            if (existingIdx >= 0) {
              // 更新现有步骤状态
              newSteps[existingIdx] = {
                ...newSteps[existingIdx],
                status: initialStatus as any,
                timestamp,
                composition: composition || newSteps[existingIdx].composition
              }
            } else {
              // 添加新步骤
              newSteps.push({
                node: targetNode,
                meta,
                status: initialStatus as any,
                timestamp,
                composition
              })
            }
          })
          
          return { ...prev, steps: newSteps }
        })
        break
      }

      case 'tool_result': {
        const composition = msg.composition || data?.composition
        
        setState(prev => {
          // 处理热力学计算的多结果情况
          // 后端发送 calculate_thermo + calculation_type，前端映射到具体节点
          let targetNode = node
          const isThermo = node === 'calculate_thermo' && data?.calculation_type
          if (isThermo) {
            targetNode = `calculate_thermo_${data.calculation_type}`
          }
          
          // 构建更新对象
          const newMessages = [...prev.messages]
          const updates: Partial<typeof prev> = {
            // 更新步骤的工具结果（按节点名 + 合金成分匹配）
            steps: prev.steps.map(step => {
              const nodeMatch = step.node === targetNode
              const compositionMatch = !composition || !step.composition || step.composition === composition
              
              if (nodeMatch && compositionMatch) {
                return { ...step, toolResult: data, status: 'completed' as const, composition }
              }
              return step
            }),
            // 同时添加到工具结果列表
            toolResults: [...prev.toolResults, {
              ...data,
              node: targetNode,
              composition,
              timestamp
            }]
          }
          
          // 如果是性能预测结果，同时添加到 performanceData
          if (node === 'predict_performance' && data?.result) {
            const result = data.result
            // 提取性能数据（后端返回 UTS/YS/EL 格式）
            const perfData: PerformanceData = {
              composition: composition || '未知成分',
              tensile_strength: result.UTS || result.tensile_strength || result.uts,
              yield_strength: result.YS || result.yield_strength || result.ys,
              elongation: result.EL || result.elongation || result.el,
              hardness: result.HV || result.hardness || result.hv,
            }
            // 只有成功提取到数据才添加
            if (perfData.tensile_strength || perfData.yield_strength || perfData.elongation) {
              updates.performanceData = [...prev.performanceData, perfData]
            }
            // 添加性能预测完成消息
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: `✅ **性能预测完成** - ${composition}\n\n抗拉强度: ${perfData.tensile_strength?.toFixed(1) || '-'} MPa\n屈服强度: ${perfData.yield_strength?.toFixed(1) || '-'} MPa\n延伸率: ${perfData.elongation?.toFixed(1) || '-'}%`,
              timestamp: Date.now()
            })
          }
          
          // 热力学计算完成消息（每个合金+每种计算类型）
          if (isThermo && composition) {
            const calcTypeLabel: Record<string, string> = {
              'point': '点计算',
              'line': '线计算',
              'scheil': 'Scheil 凝固'
            }
            const calcType = data.calculation_type
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: `✅ **热力学计算完成** - ${composition}\n\n${calcTypeLabel[calcType] || calcType} 计算已完成`,
              timestamp: Date.now()
            })
          }
          
          if (newMessages.length > prev.messages.length) {
            updates.messages = newMessages
          }
          
          return { ...prev, ...updates }
        })
        break
      }

      case 'node_complete': {
        const composition = msg.composition || data?.composition
        
        // 热力学计算节点需要展开匹配3个子节点
        const targetNodes = node === 'calculate_thermo'
          ? ['calculate_thermo_point', 'calculate_thermo_line', 'calculate_thermo_scheil']
          : [node]
        
        setState(prev => {
          const newSteps = prev.steps.map(step => {
            // 匹配节点名（支持热力学子节点）和合金成分
            const nodeMatch = targetNodes.includes(step.node)
            const compositionMatch = !composition || !step.composition || step.composition === composition
            
            if (nodeMatch && compositionMatch) {
              return { ...step, status: 'completed' as const, output: data, composition }
            }
            return step
          })
          
          // 提取关键数据（注意：性能预测和热力学数据已在 tool_result 中处理）
          let updates: Partial<AppState> = { steps: newSteps }
          const newMessages = [...prev.messages]
          
          // IDME 数据库查询完成（后端节点名是 query_idme）
          if (node === 'query_idme' && data) {
            const idmeData = data?.idme_results || data?.result || []
            const resultCount = Array.isArray(idmeData) ? idmeData.length : (data?.count || 0)
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `✅ **IDME 数据库查询完成**\n\n查询到 ${resultCount} 条相关合金数据，正在进行成分设计...`,
              timestamp: Date.now()
            })
          }
          
          // 推荐合金时添加中间消息
          if (data?.recommended_alloys && data.recommended_alloys.length > 0) {
            updates.recommendedAlloys = data.recommended_alloys
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `✅ **成分设计完成**\n\n推荐合金成分：\n${data.recommended_alloys.map((a: string) => `- ${a}`).join('\n')}\n\n正在进行性能预测和热力学分析...`,
              timestamp: Date.now()
            })
          }
          
          if (data?.analysis_results) {
            updates.analysisResults = [...prev.analysisResults, ...data.analysis_results]
          }
          
          // 性能预测和热力学计算的消息已在 tool_result 中处理
          
          if (data?.final_report) {
            updates.finalReport = data.final_report
            // 添加最终报告消息
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.final_report,
              timestamp: Date.now()
            })
          }
          
          if (newMessages.length > prev.messages.length) {
            updates.messages = newMessages
          }
          
          return { ...prev, ...updates }
        })
        break
      }

      // 处理节点状态更新（热力学计算轮询状态）
      case 'node_status': {
        const composition = msg.composition
        const status = msg.status  // 'queued' | 'running' | 'completed' | 'error'
        
        setState(prev => {
          const newSteps = [...prev.steps]
          
          // 查找是否存在该步骤
          const existingIdx = newSteps.findIndex(step => 
            step.node === node && 
            (!composition || !step.composition || step.composition === composition)
          )
          
          if (existingIdx >= 0) {
            // 更新现有步骤
            newSteps[existingIdx] = {
              ...newSteps[existingIdx],
              status: status as any,
              composition: composition || newSteps[existingIdx].composition
            }
          } else {
            // 创建新步骤（如果 node_status 在 node_start 之前到达）
            newSteps.push({
              node,
              meta,
              status: status as any,
              timestamp,
              composition
            })
          }
          
          return { ...prev, steps: newSteps }
        })
        break
      }

      case 'done':
        setState(prev => ({
          ...prev,
          workflowStatus: 'completed'
        }))
        break

      case 'error':
        setState(prev => ({
          ...prev,
          workflowStatus: 'error',
          messages: [...prev.messages, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `❌ 错误: ${data?.message || '未知错误'}`,
            timestamp: Date.now()
          }]
        }))
        break

      // LLM 流式 token（新增）
      case 'llm_token': {
        const composition = msg.composition
        // 使用 node + composition 作为 key，区分不同合金的流式输出
        const streamKey = composition ? `${node}-${composition}` : (node || 'default')
        const token = msg.token || ''
        setState(prev => {
          // 更新流式文本
          const newStreamingTexts = {
            ...prev.streamingTexts,
            [streamKey]: (prev.streamingTexts[streamKey] || '') + token
          }
          
          // 同时更新节点状态为 running（如果是第一个 token）
          let newSteps = prev.steps
          if (node && !prev.streamingTexts[streamKey]) {
            // 第一个 token，检查是否需要添加/更新步骤状态
            const existingIdx = prev.steps.findIndex(s => s.node === node)
            if (existingIdx >= 0) {
              newSteps = prev.steps.map((s, i) => 
                i === existingIdx ? { ...s, status: 'running' as const } : s
              )
            } else {
              newSteps = [...prev.steps, {
                node,
                meta,
                status: 'running' as const,
                timestamp
              }]
            }
          }
          
          return { ...prev, streamingTexts: newStreamingTexts, steps: newSteps }
        })
        break
      }

      // LLM 流式结束（新增）
      case 'llm_complete': {
        const composition = msg.composition
        // 使用与 llm_token 相同的 key 规则
        const streamKey = composition ? `${node}-${composition}` : (node || 'default')
        
        setState(prev => {
          const finalText = prev.streamingTexts[streamKey] || ''
          const newStreamingTexts = { ...prev.streamingTexts }
          delete newStreamingTexts[streamKey]
          
          // 更新节点状态为 completed
          const newSteps = prev.steps.map(s => 
            s.node === node ? { ...s, status: 'completed' as const } : s
          )
          
          const newMessages = [...prev.messages]
          
          // interpret_results：将合金分析结果添加到对话
          if (node === 'interpret_results' && finalText) {
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `📊 **${composition} 分析结果**\n\n${finalText}`,
              timestamp: Date.now()
            })
            return {
              ...prev,
              steps: newSteps,
              streamingTexts: newStreamingTexts,
              messages: newMessages
            }
          }
          
          // generate_report：将最终报告添加到对话
          if (node === 'generate_report' && finalText) {
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: finalText,
              timestamp: Date.now()
            })
            return {
              ...prev,
              steps: newSteps,
              streamingTexts: newStreamingTexts,
              finalReport: finalText,
              messages: newMessages
            }
          }
          
          return { ...prev, steps: newSteps, streamingTexts: newStreamingTexts }
        })
        break
      }
    }
  }

  const handleSend = () => {
    if (!input.trim() || !isConnected) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      workflowStatus: 'running'
    }))

    sendMessage(JSON.stringify({ input }))
    setInput('')
  }

  // 计算步骤进度
  const stepsProgress = {
    completed: state.steps.filter(s => s.status === 'completed').length,
    total: state.steps.length
  }

  // 渲染使用解耦的组件
  return (
    <div className="app-root">
      <ResizableLayout
        leftDefaultSize={20}
        rightDefaultSize={28}
        topBar={
          <TopBar 
            isConnected={isConnected}
            workflowStatus={state.workflowStatus}
            stepsProgress={state.steps.length > 0 ? stepsProgress : undefined}
          />
        }
        leftPanel={
          <WorkflowPanel 
            steps={state.steps}
            alloys={state.recommendedAlloys}
            toolResults={state.toolResults}
            isConnected={isConnected} 
          />
        }
        mainContent={
          <ChatPanel
            messages={state.messages}
            inputValue={input}
            onInputChange={setInput}
            onSend={handleSend}
            isLoading={state.workflowStatus === 'running'}
            isConnected={isConnected}
            streamingText={state.streamingTexts['generate_report'] || ''}
          />
        }
        rightPanel={
          <ResultsPanel
            toolResults={state.toolResults}
            recommendedAlloys={state.recommendedAlloys}
            performanceData={state.performanceData}
            analysisResults={state.analysisResults}
            thermoData={state.thermoData}
            finalReport={state.finalReport}
          />
        }
      />
    </div>
  )
}

export default App
