/**
 * 聊天面板组件
 * 显示对话消息和输入区域
 * 支持智能滚动：用户查看历史时不打断，有新内容时显示提示
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { Send, Loader2, Sparkles, Database, Cpu, Flame, ArrowDown } from 'lucide-react'
import clsx from 'clsx'
import { MarkdownRenderer } from '../common/MarkdownRenderer'
import './ChatPanel.css'

// ================================
// 类型定义
// ================================

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatPanelProps {
  /** 消息列表 */
  messages: Message[]
  /** 输入值 */
  inputValue: string
  /** 输入变化回调 */
  onInputChange: (value: string) => void
  /** 发送消息回调 */
  onSend: () => void
  /** 是否正在加载 */
  isLoading: boolean
  /** 是否连接 */
  isConnected: boolean
  /** 流式文本（实时生成中的内容） */
  streamingText?: string
}

/**
 * 聊天面板主组件
 */
export function ChatPanel({
  messages,
  inputValue,
  onInputChange,
  onSend,
  isLoading,
  isConnected,
  streamingText = '',
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesAreaRef = useRef<HTMLDivElement>(null)
  
  // 是否在底部附近（用于智能滚动判断）
  const [isAtBottom, setIsAtBottom] = useState(true)
  // 是否有新内容（用于显示提示按钮）
  const [hasNewContent, setHasNewContent] = useState(false)
  
  // 检测是否在底部（阈值 100px）
  const checkIfAtBottom = useCallback(() => {
    const container = messagesAreaRef.current
    if (!container) return true
    const threshold = 100
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }, [])
  
  // 滚动事件处理
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom()
    setIsAtBottom(atBottom)
    // 如果用户手动滚动到底部，清除新内容提示
    if (atBottom) {
      setHasNewContent(false)
    }
  }, [checkIfAtBottom])
  
  // 滚动到底部
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ 
      behavior: smooth ? 'smooth' : 'auto' 
    })
    setHasNewContent(false)
  }, [])
  
  // 智能滚动：只有在底部时才自动滚动
  useEffect(() => {
    if (isAtBottom) {
      // 用户在底部，自动滚动
      scrollToBottom(true)
    } else if (messages.length > 0 || streamingText) {
      // 用户在查看历史，显示新内容提示
      setHasNewContent(true)
    }
  }, [messages, streamingText, isAtBottom, scrollToBottom])
  
  // 用户发送新消息后强制滚动到底部
  useEffect(() => {
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'user') {
      scrollToBottom(false)
      setIsAtBottom(true)
    }
  }, [messages, scrollToBottom])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <div className="chat-panel">
      {/* 面板标题 */}
      <div className="panel-header">
        <span className="panel-title">对话</span>
      </div>
      
      {/* 消息区域 */}
      <div 
        className="messages-area" 
        ref={messagesAreaRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className="messages-list">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            
            {/* 流式输出（打字机效果） */}
            {streamingText && (
              <div className="message-row">
                <div className="avatar assistant">
                  <img src="/favicon.ico" alt="AI" className="avatar-icon" />
                </div>
                <div className="message-bubble assistant">
                  <MarkdownRenderer content={streamingText} />
                  <span className="typing-cursor">▌</span>
                </div>
              </div>
            )}
            
            {/* 加载指示器（仅在无流式输出时显示） */}
            {isLoading && !streamingText && (
              <div className="loading-indicator">
                <div className="loading-icon">
                  <Loader2 className="animate-spin" size={18} />
                </div>
                <span>正在分析中...</span>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
        
        {/* 新内容提示按钮 */}
        {hasNewContent && !isAtBottom && (
          <button 
            className="scroll-to-bottom"
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDown size={16} />
            <span>新内容</span>
          </button>
        )}
      </div>

      {/* 输入区域 */}
      <div className="input-area">
        <div className="input-wrapper">
          <input
            className="chat-input"
            value={inputValue}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述您的合金设计需求..."
            disabled={!isConnected || isLoading}
          />
          <button
            className="send-button"
            onClick={onSend}
            disabled={!isConnected || !inputValue.trim() || isLoading}
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 欢迎屏幕
 */
function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-icon">
          <Sparkles size={40} />
        </div>
        <h1 className="welcome-title">智能Al合金设计</h1>
        {/* <p className="welcome-desc">
          基于 AI 的铝合金智能设计系统
        </p> */}
        <div className="feature-grid">
          <FeatureCard icon={<Database size={20} />} label="材料数据库" />
          <FeatureCard icon={<Cpu size={20} />} label="ML 预测" />
          <FeatureCard icon={<Flame size={20} />} label="热力学模拟" />
        </div>
      </div>
    </div>
  )
}

/**
 * 功能卡片
 */
function FeatureCard({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <span className="feature-label">{label}</span>
    </div>
  )
}

/**
 * 消息气泡
 * 用户消息不显示头像，AI消息显示favicon
 */
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  
  return (
    <div className={clsx("message-row", isUser && "user")}>
      {/* AI消息显示favicon头像 */}
      {!isUser && (
        <div className="avatar assistant">
          <img src="/favicon.ico" alt="AI" className="avatar-icon" />
        </div>
      )}
      <div className={clsx("message-bubble", isUser ? "user" : "assistant")}>
        {isUser ? (
          <div className="message-content">{message.content}</div>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>
    </div>
  )
}

export default ChatPanel
