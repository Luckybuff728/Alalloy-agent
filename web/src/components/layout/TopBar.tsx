/**
 * 顶部状态栏组件
 * 显示系统名称、连接状态等信息
 */

import { Sparkles, Wifi, WifiOff, Clock, Activity } from 'lucide-react'
import clsx from 'clsx'

interface TopBarProps {
  /** 是否连接 */
  isConnected: boolean
  /** 工作流状态 */
  workflowStatus: 'idle' | 'running' | 'completed' | 'error'
  /** 步骤进度 */
  stepsProgress?: { completed: number; total: number }
}

/**
 * 顶部状态栏
 */
export function TopBar({ isConnected, workflowStatus, stepsProgress }: TopBarProps) {
  return (
    <div className="top-bar">
      {/* 左侧：系统名称 */}
      <div className="top-bar-left">
        <Sparkles className="top-bar-logo" size={20} />
        <span className="top-bar-title">Al-IDME</span>
        <span className="top-bar-subtitle">智能合金设计系统</span>
      </div>

      {/* 中间：工作流状态 */}
      <div className="top-bar-center">
        {workflowStatus === 'running' && stepsProgress && (
          <div className="workflow-status running">
            <Activity size={14} className="animate-pulse" />
            <span>分析中 ({stepsProgress.completed}/{stepsProgress.total})</span>
          </div>
        )}
        {workflowStatus === 'completed' && (
          <div className="workflow-status completed">
            <span>分析完成</span>
          </div>
        )}
        {workflowStatus === 'error' && (
          <div className="workflow-status error">
            <span>分析出错</span>
          </div>
        )}
      </div>

      {/* 右侧：连接状态和时间 */}
      <div className="top-bar-right">
        <div className={clsx("connection-indicator", isConnected ? "connected" : "disconnected")}>
          {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{isConnected ? "已连接" : "未连接"}</span>
        </div>
        <div className="time-display">
          <Clock size={14} />
          <CurrentTime />
        </div>
      </div>
    </div>
  )
}

/**
 * 实时时间显示
 */
function CurrentTime() {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  })
  return <span>{timeStr}</span>
}

export default TopBar
