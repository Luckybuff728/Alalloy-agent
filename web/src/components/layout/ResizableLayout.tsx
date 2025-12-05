/**
 * 可调整大小的三栏布局组件
 * 使用 react-resizable-panels 实现拖动调整面板大小
 */

import type { ReactNode } from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'

interface ResizableLayoutProps {
  /** 顶部状态栏 */
  topBar?: ReactNode
  /** 左侧面板内容 */
  leftPanel: ReactNode
  /** 中间主内容 */
  mainContent: ReactNode
  /** 右侧面板内容 */
  rightPanel: ReactNode
  /** 左侧面板默认宽度百分比 */
  leftDefaultSize?: number
  /** 右侧面板默认宽度百分比 */
  rightDefaultSize?: number
}

/**
 * 拖动调整手柄组件
 */
function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <PanelResizeHandle className={`resize-handle ${className}`}>
      <div className="resize-handle-bar" />
    </PanelResizeHandle>
  )
}

/**
 * 可调整大小的三栏布局
 */
export function ResizableLayout({
  topBar,
  leftPanel,
  mainContent,
  rightPanel,
  leftDefaultSize = 25,
  rightDefaultSize = 28,
}: ResizableLayoutProps) {
  return (
    <div className="layout-wrapper">
      {/* 顶部状态栏 */}
      {topBar && <div className="top-bar-wrapper">{topBar}</div>}
      
      {/* 三栏布局 */}
      <PanelGroup direction="horizontal" className="resizable-layout">
        {/* 左侧面板 */}
        <Panel
          defaultSize={leftDefaultSize}
          minSize={15}
          maxSize={40}
          className="panel-left"
        >
          <div className="panel-content">{leftPanel}</div>
        </Panel>

        <ResizeHandle />

        {/* 中间主内容 */}
        <Panel minSize={30} className="panel-main">
          <div className="panel-content">{mainContent}</div>
        </Panel>

        <ResizeHandle />

        {/* 右侧面板 */}
        <Panel
          defaultSize={rightDefaultSize}
          minSize={18}
          maxSize={45}
          className="panel-right"
        >
          <div className="panel-content">{rightPanel}</div>
        </Panel>
      </PanelGroup>
    </div>
  )
}

export default ResizableLayout
