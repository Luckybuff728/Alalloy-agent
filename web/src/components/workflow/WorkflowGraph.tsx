/**
 * 工作流可视化组件
 * 使用 ReactFlow 展示 LangGraph 工作流节点和连接
 */

import { useMemo, useCallback, useState, Component, type ReactNode } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  Handle,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './WorkflowGraph.css'
import { 
  Search, Database, Lightbulb, Cpu, Flame, FileCheck, 
  Loader2, Check, X, Circle, Clock, Info, ChevronRight
} from 'lucide-react'

// ================================
// 类型定义
// ================================

export interface WorkflowStep {
  node: string
  status: 'pending' | 'queued' | 'running' | 'completed' | 'error'  // 添加 queued（排队中）状态
  composition?: string  // 合金成分标识
  meta?: {
    label: string
    description: string
    icon: string
  }
  output?: any  // 节点输出数据
  timestamp?: number
}

/** 工具结果数据类型 */
export interface ToolResult {
  tool_name: string
  tool_type: string
  result: any
  success: boolean
  composition?: string
  calculation_type?: string
}

/** 节点详情数据 */
export interface NodeDetail {
  nodeId: string
  label: string
  status: string
  composition?: string
  input?: any
  output?: any
}

interface WorkflowGraphProps {
  /** 工作流步骤数据 */
  steps: WorkflowStep[]
  /** 推荐的合金列表 */
  alloys?: string[]
  /** 工具调用结果（用于显示输入输出） */
  toolResults?: ToolResult[]
  /** 自定义类名 */
  className?: string
}

// ================================
// 图标映射
// ================================

const ICON_MAP: Record<string, React.ReactNode> = {
  search: <Search size={15} />,
  database: <Database size={15} />,
  lightbulb: <Lightbulb size={15} />,
  cpu: <Cpu size={15} />,
  flame: <Flame size={15} />,
  'file-check': <FileCheck size={15} />,
}

// ================================
// 自定义节点组件
// ================================
// 注意：节点颜色通过 CSS 类控制（wf-node-pending/running/completed/error）

function CustomNode({ data }: { data: any }) {
  const isClickable = data.status === 'completed' || data.status === 'error'
  
  return (
    <div className={`wf-node wf-node-${data.status} ${isClickable ? 'wf-node-clickable' : ''}`}>
      {/* 顶部连接点（输入） */}
      <Handle type="target" position={Position.Top} className="wf-handle wf-handle-top" />
      {/* 左侧连接点（输入-用于横向连接） */}
      <Handle type="target" position={Position.Left} className="wf-handle wf-handle-left" id="left" />
      
      {/* 节点内容 */}
      <div className="wf-node-content">
        {/* 状态徽章 */}
        <div className="wf-node-status">
          {data.status === 'queued' && <Clock className="animate-pulse" size={12} />}
          {data.status === 'running' && <Loader2 className="animate-spin" size={12} />}
          {data.status === 'completed' && <Check size={12} />}
          {data.status === 'error' && <X size={12} />}
          {data.status === 'pending' && <Circle size={10} />}
        </div>
        
        {/* 图标 */}
        <div className="wf-node-icon">
          {ICON_MAP[data.icon] || <Circle size={16} />}
        </div>
        {/* 标签 */}
        <div className="wf-node-label">
          {data.label}
        </div>
        
        {/* 可点击提示 */}
        {isClickable && (
          <div className="wf-node-hint">
            <Info size={10} />
          </div>
        )}
      </div>
      
      {/* 底部连接点（输出） */}
      <Handle type="source" position={Position.Bottom} className="wf-handle wf-handle-bottom" />
      {/* 右侧连接点（输出-用于横向连接） */}
      <Handle type="source" position={Position.Right} className="wf-handle wf-handle-right" id="right" />
    </div>
  )
}

const nodeTypes = {
  custom: CustomNode,
}

// ================================
// 节点详情弹窗组件
// ================================

interface NodeDetailPanelProps {
  detail: NodeDetail | null
  onClose: () => void
}

/**
 * 节点详情面板（点击节点后显示）
 */
function NodeDetailPanel({ detail, onClose }: NodeDetailPanelProps) {
  if (!detail) return null
  
  return (
    <div className="wf-detail-overlay" onClick={onClose}>
      <div className="wf-detail-panel" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="wf-detail-header">
          <div className="wf-detail-title">
            <span className={`wf-detail-status wf-detail-status-${detail.status}`}>
              {detail.status === 'completed' && <Check size={14} />}
              {detail.status === 'error' && <X size={14} />}
            </span>
            <span>{detail.label}</span>
          </div>
          <button className="wf-detail-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        {/* 成分标识 */}
        {detail.composition && (
          <div className="wf-detail-composition">
            合金成分: <strong>{detail.composition}</strong>
          </div>
        )}
        
        {/* 输入数据 */}
        {detail.input && (
          <div className="wf-detail-section">
            <div className="wf-detail-section-title">
              <ChevronRight size={14} />
              <span>输入参数</span>
            </div>
            <div className="wf-detail-content">
              <pre className="wf-detail-json">
                {JSON.stringify(detail.input, null, 2)}
              </pre>
            </div>
          </div>
        )}
        
        {/* 输出数据 */}
        <div className="wf-detail-section">
          <div className="wf-detail-section-title">
            <ChevronRight size={14} />
            <span>输出结果</span>
          </div>
          <div className="wf-detail-content">
            {detail.output ? (
              <pre className="wf-detail-json">
                {JSON.stringify(detail.output, null, 2)}
              </pre>
            ) : (
              <div className="wf-detail-empty">暂无输出数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ================================
// 预定义工作流节点结构
// ================================

// 前置节点定义（顺序执行）
const PRE_NODES = [
  { id: 'extract_parameters', label: '参数提取', icon: 'search' },
  { id: 'query_idme', label: 'IDME 查询', icon: 'database' },
  { id: 'recommend_alloys', label: '合金推荐', icon: 'lightbulb' },
]

// 并行节点定义（每个合金都会执行这些节点）
const PARALLEL_NODES = [
  { id: 'predict_performance', label: '性能预测', icon: 'cpu' },
  { id: 'calculate_thermo_point', label: '点计算', icon: 'flame' },
  { id: 'calculate_thermo_line', label: '线计算', icon: 'flame' },
  { id: 'calculate_thermo_scheil', label: 'Scheil计算', icon: 'flame' },
]

// 后置节点定义
const POST_NODES = [
  { id: 'generate_report', label: '报告生成', icon: 'file-check' },
]

// 注意：NODE_ID_MAP 已移除，节点映射在 App.tsx 中处理

/**
 * 从步骤中提取合金列表
 */
function extractAlloysFromSteps(steps: WorkflowStep[]): string[] {
  const alloys = new Set<string>()
  steps.forEach(step => {
    if (step.composition) {
      alloys.add(step.composition)
    }
  })
  return Array.from(alloys)
}

/**
 * 状态优先级（数字越大优先级越高）
 */
const STATUS_PRIORITY: Record<string, number> = {
  'pending': 0,
  'queued': 1,    // 排队中（热力学计算等待）
  'running': 2,
  'completed': 3,
  'error': 4,
}

/**
 * 判断节点是否为并行节点（需要按合金区分）
 */
function isParallelNode(nodeId: string): boolean {
  return PARALLEL_NODES.some(n => n.id === nodeId)
}

/**
 * 根据后端步骤数据生成节点状态映射
 * 支持按合金成分分组，取最高优先级状态
 */
function getNodeStatusMap(steps: WorkflowStep[], composition?: string): Record<string, WorkflowStep['status']> {
  const statusMap: Record<string, WorkflowStep['status']> = {}
  
  steps.forEach(step => {
    const nodeId = step.node
    
    // 对于并行节点，严格按合金成分匹配
    if (isParallelNode(nodeId)) {
      // 如果指定了合金成分，只匹配该合金的步骤
      if (composition) {
        // 必须完全匹配：step.composition 必须等于指定的 composition
        if (step.composition !== composition) {
          return
        }
      } else {
        // 没有指定合金成分时，跳过有合金标识的步骤（避免混淆）
        if (step.composition) {
          return
        }
      }
    }
    
    const currentPriority = STATUS_PRIORITY[statusMap[nodeId]] ?? -1
    const newPriority = STATUS_PRIORITY[step.status] ?? 0
    
    // 取优先级更高的状态（completed > running > pending）
    if (newPriority > currentPriority) {
      statusMap[nodeId] = step.status
    }
  })
  
  return statusMap
}

/**
 * 生成工作流布局（简洁垂直设计）
 * - 前置节点：垂直排列
 * - 并行节点：按合金分列，垂直排列
 * - 简洁连线：每列只有入边和出边
 */
function generateLayout(steps: WorkflowStep[], alloys: string[]) {
  const nodes: Node[] = []
  const edges: Edge[] = []
  
  // 防护检查：确保 steps 是有效数组
  const safeSteps = Array.isArray(steps) ? steps : []
  const safeAlloys = Array.isArray(alloys) ? alloys : []
  
  // 布局参数
  const nodeWidth = 88
  const nodeHeight = 54
  const gapY = 20           // 垂直间距（缩小）
  const colGap = 120        // 列间距
  const sectionGap = 45     // 区段间距
  
  // 确定合金列表
  const displayAlloys = safeAlloys.length > 0 ? safeAlloys : ['']
  const numAlloys = displayAlloys.length
  
  // 获取全局状态映射
  const globalStatusMap = getNodeStatusMap(safeSteps)
  
  // 计算总宽度 - 以原点为中心布局，让fitView更好地居中
  const totalWidth = numAlloys * nodeWidth + (numAlloys - 1) * colGap
  const centerX = 0  // 以原点为中心
  const startX = centerX - totalWidth / 2
  
  let currentY = 0  // 从原点开始垂直布局
  
  // ========== 1. 前置节点（垂直排列，居中）==========
  PRE_NODES.forEach((node, idx) => {
    const status = globalStatusMap[node.id] || 'pending'
    
    nodes.push({
      id: node.id,
      type: 'custom',
      position: { x: centerX - nodeWidth / 2, y: currentY },
      data: { label: node.label, icon: node.icon, status },
    })
    
    if (idx > 0) {
      const prevNode = PRE_NODES[idx - 1]
      edges.push({
        id: `e-${prevNode.id}-${node.id}`,
        source: prevNode.id,
        target: node.id,
        type: 'smoothstep',
        style: { stroke: '#d1d5db', strokeWidth: 1.5 },
      })
    }
    
    currentY += nodeHeight + gapY
  })
  
  const lastPreNode = PRE_NODES[PRE_NODES.length - 1]
  currentY += sectionGap - gapY
  
  // ========== 2. 并行任务区域（按合金分列，垂直排列）==========
  const parallelStartY = currentY
  const parallelHeight = PARALLEL_NODES.length * (nodeHeight + gapY) - gapY
  
  displayAlloys.forEach((alloy, alloyIdx) => {
    const alloyStatusMap = alloy ? getNodeStatusMap(safeSteps, alloy) : globalStatusMap
    const colX = startX + alloyIdx * (nodeWidth + colGap)
    
    // 虚线框包裹整列并行节点
    const boxPadding = 12
    const boxWidth = nodeWidth + boxPadding * 2
    const boxHeight = parallelHeight + boxPadding * 2
    const boxY = parallelStartY - boxPadding
    
    nodes.push({
      id: `group-${alloyIdx}`,
      type: 'group',
      position: { x: colX - boxPadding, y: boxY },
      data: {},
      style: {
        width: boxWidth,
        height: boxHeight,
        backgroundColor: 'rgba(241, 245, 249, 0.4)',
        border: '2px dashed #cbd5e1',
        borderRadius: 10,
      },
      selectable: false,
      draggable: false,
    })
    
    // 合金标签（放在虚线框上方，自适应文本长度）
    if (alloy && numAlloys > 1) {
      nodes.push({
        id: `label-${alloyIdx}`,
        type: 'default',
        position: { x: colX - boxPadding, y: boxY - 28 },
        data: { label: alloy },
        style: {
          fontSize: 11,
          padding: '4px 10px',
          background: '#dbeafe',
          border: '1px solid #93c5fd',
          borderRadius: 6,
          color: '#1e40af',
          fontWeight: 600,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          whiteSpace: 'nowrap',
          width: 'auto',
          minWidth: 'fit-content',
        },
        draggable: false,
        selectable: false,
      })
    }
    
    // 并行节点（垂直排列）
    let firstNodeId = ''
    let lastNodeId = ''
    const nodeStartY = alloy && numAlloys > 1 ? parallelStartY : parallelStartY
    
    PARALLEL_NODES.forEach((node, nodeIdx) => {
      const nodeId = alloy ? `${node.id}-${alloyIdx}` : node.id
      const status = alloyStatusMap[node.id] || 'pending'
      const y = nodeStartY + nodeIdx * (nodeHeight + gapY)
      
      if (nodeIdx === 0) firstNodeId = nodeId
      if (nodeIdx === PARALLEL_NODES.length - 1) lastNodeId = nodeId
      
      nodes.push({
        id: nodeId,
        type: 'custom',
        position: { x: colX, y },
        data: { label: node.label, icon: node.icon, status, composition: alloy },
      })
    })
    
    // 入边：从前置节点到第一个并行节点
    edges.push({
      id: `e-pre-${alloyIdx}`,
      source: lastPreNode.id,
      target: firstNodeId,
      type: 'smoothstep',
      style: { stroke: '#d1d5db', strokeWidth: 1.5 },
    })
    
    // 出边：从最后一个并行节点到报告生成
    edges.push({
      id: `e-post-${alloyIdx}`,
      source: lastNodeId,
      target: 'generate_report',
      type: 'smoothstep',
      style: { stroke: '#d1d5db', strokeWidth: 1.5 },
    })
  })
  
  // 计算并行区域结束位置
  currentY = parallelStartY + parallelHeight + sectionGap
  
  // ========== 3. 后置节点（居中）==========
  POST_NODES.forEach((node) => {
    const status = globalStatusMap[node.id] || 'pending'
    
    nodes.push({
      id: node.id,
      type: 'custom',
      position: { x: centerX - nodeWidth / 2, y: currentY },
      data: { label: node.label, icon: node.icon, status },
    })
  })
  
  return { nodes, edges }
}

// 注意：getEdgeColor 已移除，边颜色统一使用灰色

// ================================
// 错误边界组件
// ================================

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

/**
 * 错误边界 - 防止 ReactFlow 渲染错误导致白屏
 */
class WorkflowErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('WorkflowGraph Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="workflow-error">
          <div className="workflow-error-content">
            <span>⚠️ 工作流图加载失败</span>
            <button onClick={() => this.setState({ hasError: false })}>
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ================================
// 主组件
// ================================

/**
 * 内部工作流图组件（使用 useReactFlow）
 */
function WorkflowGraphInner({ steps, alloys = [], toolResults = [], className = '' }: WorkflowGraphProps) {
  const { fitView } = useReactFlow()
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null)
  
  // 从 steps 中提取合金列表（如果没有传入 alloys）
  const displayAlloys = useMemo(() => {
    if (alloys.length > 0) return alloys
    return extractAlloysFromSteps(steps)
  }, [steps, alloys])
  
  // 生成节点和边
  const { nodes, edges } = useMemo(() => 
    generateLayout(steps, displayAlloys), 
    [steps, displayAlloys]
  )

  // 初始化完成后调用 fitView 确保居中
  const onInit = useCallback(() => {
    setTimeout(() => {
      fitView({ 
        padding: 0.3,
        duration: 200
      })
    }, 50)
  }, [fitView])
  
  // 处理节点点击
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    // 只处理自定义节点，且状态为 completed 或 error
    if (node.type !== 'custom') return
    const status = node.data?.status
    if (status !== 'completed' && status !== 'error') return
    
    // 解析节点 ID（可能包含合金索引后缀）
    const nodeId = node.id
    const composition = node.data?.composition as string | undefined
    const label = (node.data?.label as string) || nodeId
    
    // 查找对应的工具结果
    let output: any = null
    let input: any = null
    
    // 根据节点类型查找结果和构建输入
    if (nodeId.startsWith('predict_performance')) {
      // 性能预测
      const result = toolResults.find(r => 
        r.tool_type === 'ml_model' && 
        (!composition || r.composition === composition)
      )
      output = result?.result
      // 构建输入信息
      if (composition) {
        input = {
          composition: composition,
          model: "Aolly_Design_CSU.onnx",
          description: "质量百分比输入"
        }
      }
    } else if (nodeId.startsWith('calculate_thermo')) {
      // 热力学计算
      let calcType = ''
      let calcDesc = ''
      if (nodeId.includes('point')) {
        calcType = 'point'
        calcDesc = '单点平衡计算'
      } else if (nodeId.includes('line')) {
        calcType = 'line'
        calcDesc = '温度扫描计算 (298K → 1000K)'
      } else if (nodeId.includes('scheil')) {
        calcType = 'scheil'
        calcDesc = 'Scheil 非平衡凝固'
      }
      
      const result = toolResults.find(r => 
        r.tool_type === 'simulation' && 
        r.calculation_type === calcType &&
        (!composition || r.composition === composition)
      )
      output = result?.result
      
      // 构建输入信息
      if (composition) {
        input = {
          composition: composition,
          calculation_type: calcType,
          description: calcDesc,
          database: "al-default",
          pressure: "1.0 atm"
        }
        if (calcType === 'line') {
          input.start_temperature = "298 K"
          input.end_temperature = "1000 K"
          input.steps = 60
        } else if (calcType === 'point') {
          input.temperature = "1000 K"
        } else if (calcType === 'scheil') {
          input.start_temperature = "1000 K"
        }
      }
    } else if (nodeId === 'query_idme') {
      // IDME 查询
      const result = toolResults.find(r => r.tool_type === 'database')
      output = result?.result
      input = {
        query_type: "知识图谱查询",
        description: "根据材料体系查询相关数据"
      }
    } else if (nodeId === 'extract_parameters') {
      // 参数提取 - 从 steps 中获取输出
      const step = steps.find(s => s.node === 'extract_parameters')
      if (step?.output) {
        output = {
          system: step.output.system,
          performance_requirements: step.output.performance_requirements
        }
      }
      input = {
        description: "从用户输入中提取材料体系和性能要求"
      }
    } else if (nodeId === 'recommend_alloys') {
      // 合金推荐 - 从 steps 中获取输出
      const step = steps.find(s => s.node === 'recommend_alloys')
      if (step?.output?.recommended_alloys) {
        output = {
          recommended_alloys: step.output.recommended_alloys
        }
      }
      // 从 IDME 结果构建输入
      const idmeResult = toolResults.find(r => r.tool_type === 'database')
      input = {
        description: "基于 IDME 查询结果推荐合金成分",
        idme_data_count: idmeResult?.result?.length || 0
      }
    } else if (nodeId === 'generate_report') {
      // 报告生成
      const step = steps.find(s => s.node === 'generate_report')
      output = step?.output?.final_report ? { report: "见对话面板" } : null
      input = {
        description: "综合所有分析结果生成最终报告"
      }
    }
    
    setSelectedNode({
      nodeId,
      label,
      status,
      composition,
      input,
      output,
    })
  }, [toolResults, steps])
  
  // 关闭详情面板
  const closeDetail = useCallback(() => {
    setSelectedNode(null)
  }, [])

  return (
    <div className={`workflow-graph-container ${className}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        onInit={onInit}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ 
          padding: 0.3,
          minZoom: 0.4, 
          maxZoom: 1.0,
          includeHiddenNodes: false
        }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { strokeWidth: 2 }
        }}
      >
        <Background color="#e2e8f0" gap={20} size={1} />
        <Controls showInteractive={false} position="top-right" />
      </ReactFlow>
      
      {/* 节点详情弹窗 */}
      <NodeDetailPanel detail={selectedNode} onClose={closeDetail} />
    </div>
  )
}

/**
 * 工作流图组件（带 Provider 和错误边界包装）
 */
export function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <WorkflowErrorBoundary>
      <ReactFlowProvider>
        <WorkflowGraphInner {...props} />
      </ReactFlowProvider>
    </WorkflowErrorBoundary>
  )
}

export default WorkflowGraph
