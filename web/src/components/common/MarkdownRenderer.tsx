/**
 * Markdown 渲染组件
 * 支持 GitHub 风格 Markdown 和代码语法高亮
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  /** Markdown 内容 */
  content: string
  /** 自定义类名 */
  className?: string
}

/**
 * Markdown 渲染器
 * 
 * 功能：
 * - 支持 GFM (GitHub Flavored Markdown)
 * - 代码块语法高亮
 * - 表格、任务列表、删除线等扩展语法
 */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  // 自定义组件渲染
  const components: Components = {
    // 代码块渲染
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const isInline = !match
      
      if (isInline) {
        // 行内代码
        return (
          <code className="inline-code" {...props}>
            {children}
          </code>
        )
      }
      
      // 代码块
      return (
        <SyntaxHighlighter
          style={oneDark}
          language={match[1]}
          PreTag="div"
          className="code-block"
          showLineNumbers={true}
          customStyle={{
            margin: 0,
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-sm)',
          }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      )
    },
    
    // 表格渲染
    table({ children }) {
      return (
        <div className="table-wrapper">
          <table className="md-table">{children}</table>
        </div>
      )
    },
    
    // 链接渲染 - 新窗口打开
    a({ href, children }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
          {children}
        </a>
      )
    },
    
    // 引用块
    blockquote({ children }) {
      return <blockquote className="md-blockquote">{children}</blockquote>
    },
    
    // 列表项 - 支持任务列表
    li({ children, ...props }) {
      return <li className="md-list-item" {...props}>{children}</li>
    },
  }

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
