/**
 * Markdown渲染工具
 */
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'

// 注册语言
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('sql', sql)

/**
 * 生成唯一 ID（用于 Mermaid 图表等）
 * 使用时间戳 + 随机数避免冲突
 */
const generateUniqueId = (prefix = 'md') => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// 创建Markdown实例
const md = new MarkdownIt({
  html: true,        // 允许HTML标签
  linkify: true,     // 自动转换URL为链接
  typographer: true, // 启用排版优化
  breaks: true,      // 转换换行符为<br>
  highlight: function (str, lang) {
    // Mermaid 图表特殊处理
    // 注意：markdown-it 要求返回值以 <pre 开头才不会被包装，所以用隐藏的 pre 包装
    if (lang === 'mermaid') {
      const id = generateUniqueId('mermaid')
      // 不转义 Mermaid 代码，保持原始语法（如 --> 不能变成 --&gt;）
      // 使用 data-code 属性存储原始代码，避免 HTML 解析问题
      return `<pre style="display:none;"></pre><div class="mermaid-wrapper"><div class="mermaid" id="${id}" data-code="${encodeURIComponent(str)}">${md.utils.escapeHtml(str)}</div></div>`
    }

    // 代码高亮
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code class="language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch (err) {
        console.error('Highlight error:', err)
      }
    }
    // 未指定语言或不支持的语言，使用纯文本
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})

// 表格渲染规则 - 添加滚动容器支持响应式
md.renderer.rules.table_open = () => '<div class="table-wrapper"><table>'
md.renderer.rules.table_close = () => '</table></div>'

/**
 * 流式输出时智能补全未闭合的 Markdown 语法
 * 避免渲染错乱（如未闭合的代码块、加粗等）
 * @param {string} text - 原始 Markdown 文本
 * @returns {string} - 补全后的文本
 */
function autoCompleteMarkdown(text) {
  if (!text) return text

  let result = text

  // 1. 检测未闭合的代码块（```）
  const codeBlockMatches = result.match(/```/g)
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    // 奇数个 ```，说明有未闭合的代码块
    result += '\n```'
  }

  // 2. 检测未闭合的行内代码（`）- 只处理最后一行
  const lines = result.split('\n')
  const lastLine = lines[lines.length - 1]
  const inlineCodeMatches = lastLine.match(/`/g)
  if (inlineCodeMatches && inlineCodeMatches.length % 2 !== 0) {
    result += '`'
  }

  // 3. 检测未闭合的加粗（**）- 只处理最后一段
  const lastParagraph = result.split(/\n\n/).pop() || ''
  const boldMatches = lastParagraph.match(/\*\*/g)
  if (boldMatches && boldMatches.length % 2 !== 0) {
    result += '**'
  }

  // 4. 检测未闭合的斜体（*）- 排除已处理的 **
  const italicText = lastParagraph.replace(/\*\*/g, '')
  const italicMatches = italicText.match(/\*/g)
  if (italicMatches && italicMatches.length % 2 !== 0) {
    result += '*'
  }

  return result
}

/**
 * 渲染 Markdown 文本为 HTML
 * @param {string} text - Markdown 文本
 * @param {boolean} isStreaming - 是否为流式输出（启用语法补全）
 * @returns {string} - 安全的 HTML 字符串
 */
export function renderMarkdown(text, isStreaming = false) {
  if (!text) return ''

  try {
    // 处理特殊字符，防止渲染错误
    let processedText = text.replace(/\u0000/g, '')

    // 流式输出时进行语法补全
    if (isStreaming) {
      processedText = autoCompleteMarkdown(processedText)
    }

    // 渲染 Markdown
    const rawHtml = md.render(processedText)

    // 使用 DOMPurify 进行 XSS 防护
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      // 允许的标签
      ALLOWED_TAGS: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'br', 'hr',
        'ul', 'ol', 'li',
        'blockquote', 'pre', 'code',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'a', 'img',
        'strong', 'em', 'del', 'mark', 's',
        'div', 'span',
        'sub', 'sup',
        'kbd', 'samp',
        'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
        'g', 'text', 'tspan', 'defs', 'marker', 'use', 'foreignObject'
      ],
      // 允许的属性
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'target', 'rel',
        'class', 'id', 'style',
        'data-processed', 'data-lang',
        // SVG 属性（Mermaid 需要）
        'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width',
        'd', 'transform', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry',
        'x1', 'y1', 'x2', 'y2', 'points',
        'marker-end', 'marker-start', 'font-size', 'text-anchor',
        'dominant-baseline', 'alignment-baseline',
        // 额外 SVG 属性（支持更多 Mermaid 图表类型）
        'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
        'stroke-dasharray', 'stroke-dashoffset', 'font-family', 'font-weight',
        'letter-spacing', 'clip-path', 'mask', 'filter', 'overflow',
        'preserveAspectRatio', 'xmlns', 'xmlns:xlink', 'xlink:href',
        'role', 'aria-label', 'aria-labelledby', 'aria-describedby'
      ],
      // 允许 data-* 属性
      ALLOW_DATA_ATTR: true
    })

    return cleanHtml
  } catch (error) {
    console.error('Markdown render error:', error)
    // 渲染失败时返回转义后的纯文本
    return `<pre>${DOMPurify.sanitize(text)}</pre>`
  }
}

/**
 * 格式化时间戳
 * @param {string|Date} timestamp - 时间戳
 * @returns {string} - 格式化后的时间
 */
export function formatTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  // 小于1分钟
  if (diff < 60000) {
    return '刚刚'
  }
  // 小于1小时
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`
  }
  // 小于1天
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`
  }
  // 显示具体时间
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 获取节点状态类型
 * @param {string} status - 节点状态
 * @returns {string} - Element Plus标签类型
 */
export function getStatusType(status) {
  const typeMap = {
    'pending': 'info',
    'processing': 'warning',
    'completed': 'success',
    'error': 'danger'
  }
  return typeMap[status] || 'info'
}

/**
 * 获取节点状态文本
 * @param {string} status - 节点状态
 * @returns {string} - 状态文本
 */
export function getStatusText(status) {
  const textMap = {
    'pending': '待处理',
    'processing': '进行中',
    'completed': '已完成',
    'error': '错误'
  }
  return textMap[status] || status
}

/**
 * 获取置信度颜色
 * @param {number} confidence - 置信度(0-1)
 * @returns {string} - 颜色值
 */
export function getConfidenceColor(confidence) {
  if (confidence >= 0.8) return '#10b981'  // 绿色
  if (confidence >= 0.6) return '#3b82f6'  // 蓝色
  if (confidence >= 0.4) return '#f59e0b'  // 橙色
  return '#ef4444'  // 红色
}

/**
 * 获取置信度徽章
 * @param {number} confidence - 置信度(0-1)
 * @returns {object} - 徽章配置
 */
export function getConfidenceBadge(confidence) {
  if (confidence >= 0.8) {
    return { text: '高置信度', type: 'success' }
  }
  if (confidence >= 0.6) {
    return { text: '中置信度', type: 'primary' }
  }
  return { text: '低置信度', type: 'warning' }
}
