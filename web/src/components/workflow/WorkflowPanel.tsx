/**
 * 工作流面板组件
 * 整个面板用于显示工作流图
 */

import { WorkflowGraph } from './WorkflowGraph'
import './WorkflowPanel.css'

// ================================
// 类型定义
// ================================

export interface NodeMeta {
  label: string
  description: string
  icon: string
  tool?: string
}

export interface ToolResult {
  tool_name: string
  tool_type: 'database' | 'ml_model' | 'simulation'
  result: any
  success: boolean
}

export interface WorkflowStep {
  node: string
  meta?: NodeMeta
  status: 'pending' | 'queued' | 'running' | 'completed' | 'error'  // 添加 queued 状态
  toolResult?: ToolResult
  output?: Record<string, any>
  timestamp?: number
  composition?: string  // 合金成分标识
}

interface WorkflowPanelProps {
  /** 工作流步骤 */
  steps: WorkflowStep[]
  /** 推荐的合金列表 */
  alloys?: string[]
  /** 工具调用结果（用于节点详情查看） */
  toolResults?: ToolResult[]
  /** 连接状态 */
  isConnected: boolean
}

/**
 * 工作流面板主组件
 * 整个面板仅用于展示工作流图
 * 支持点击节点查看输入输出
 */
export function WorkflowPanel({ steps, alloys = [], toolResults = [] }: WorkflowPanelProps) {
  return (
    <div className="workflow-panel">
      <div className="panel-header">
        <span className="panel-title">工作流</span>
        {toolResults.length > 0 && (
          <span className="panel-hint">点击已完成节点查看详情</span>
        )}
      </div>
      <div className="panel-body-full">
        <WorkflowGraph steps={steps} alloys={alloys} toolResults={toolResults} />
      </div>
    </div>
  )
}

export default WorkflowPanel
