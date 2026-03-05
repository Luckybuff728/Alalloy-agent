<template>
  <div ref="containerRef" :class="['markdown-content', { streaming }]" v-html="renderedHtml"></div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { renderMarkdown } from '../../utils/markdown'
import mermaid from 'mermaid'

// 初始化 Mermaid 配置（支持多种图表类型）
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  // 流程图配置
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis'
  },
  // 甘特图配置
  gantt: {
    titleTopMargin: 25,
    barHeight: 20,
    barGap: 4,
    topPadding: 50,
    leftPadding: 75,
    gridLineStartPadding: 35,
    fontSize: 11,
    numberSectionStyles: 4
  },
  // 序列图配置
  sequence: {
    diagramMarginX: 50,
    diagramMarginY: 10,
    actorMargin: 50,
    width: 150,
    height: 65,
    boxMargin: 10,
    boxTextMargin: 5,
    noteMargin: 10,
    messageMargin: 35
  }
})

const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  streaming: {
    type: Boolean,
    default: false
  }
})

const containerRef = ref(null)

// 最终渲染的 HTML
const renderedHtml = ref('')

// 节流定时器
let throttleTimer = null
const THROTTLE_DELAY = 50

// Mermaid SVG 缓存（避免重复渲染）
const mermaidCache = new Map()

// 对 Mermaid 源码做简单纠错，尽量在前端容错（不修改提示词）
const sanitizeMermaidCode = (rawCode) => {
  if (!rawCode) return ''

  // 1）先在整段文本上把一行写多条语句的情况拆成多行
  //    例如：`H --> I[实验工单]    I --> J[中试阶段]`
  //    把 `]    I -->` 这种模式替换为 `]\nI -->`
  let code = rawCode.replace(/]\s+([A-Za-z0-9_]+\s*-->)/g, `]\n$1`)

  // 2）按行拆分并去掉首尾空白行
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // 3）对每一行做轻量修复：补齐缺失的 `]`
  const fixed = lines.map((line) => {
    // 节点定义缺失 ]：I[实验工单
    if (/^[A-Za-z0-9_]+\s*\[[^\]]+$/.test(line)) {
      return line + ']'
    }
    // 连线语句中 label 缺失 ]：I --> J[中
    if (/^[A-Za-z0-9_]+\s*-->\s*[A-Za-z0-9_]+\s*\[[^\]]+$/.test(line)) {
      return line + ']'
    }
    return line
  })

  return fixed.join('\n')
}

// 使用 DOM 解析处理 Mermaid 图表
const processMermaidInHtml = async (html) => {
  // 创建临时 DOM 容器
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html
  
  // 查找所有 Mermaid 元素，转换为数组（避免 NodeList 在修改时失效）
  const mermaidElements = Array.from(tempDiv.querySelectorAll('.mermaid'))
  if (mermaidElements.length === 0) return html
  
  // 收集所有需要处理的元素信息
  const tasks = []
  for (const el of mermaidElements) {
    // 优先从 data-code 属性获取原始代码（未转义），否则从 textContent 获取
    const dataCode = el.getAttribute('data-code')
    const rawCode = dataCode ? decodeURIComponent(dataCode) : (el.textContent || '')
    const code = sanitizeMermaidCode(rawCode)
    if (!code.trim()) continue
    const wrapper = el.closest('.mermaid-wrapper') || el
    tasks.push({ el, wrapper, code, originalHtml: el.innerHTML })
  }
  
  // 逐个处理（从后往前，避免索引变化）
  for (let i = tasks.length - 1; i >= 0; i--) {
    const { wrapper, code, originalHtml } = tasks[i]
    
    // 检查缓存
    if (mermaidCache.has(code)) {
      const newDiv = document.createElement('div')
      newDiv.className = 'mermaid-rendered'
      newDiv.innerHTML = mermaidCache.get(code)
      wrapper.parentNode?.replaceChild(newDiv, wrapper)
      continue
    }
    
    try {
      // 生成唯一 ID
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
      
      // 调试：打印传递给 Mermaid 的代码
      console.log('[Mermaid] Rendering code:', code.substring(0, 200))
      
      // 渲染图表
      const { svg } = await mermaid.render(id + '-svg', code)
      
      // 缓存
      mermaidCache.set(code, svg)
      
      // 替换元素
      const newDiv = document.createElement('div')
      newDiv.className = 'mermaid-rendered'
      newDiv.innerHTML = svg
      wrapper.parentNode?.replaceChild(newDiv, wrapper)
    } catch (err) {
      console.warn('Mermaid render error:', err.message || err)
      // 缓存错误状态
      const errorHtml = `<pre class="mermaid-error">${originalHtml}</pre>`
      mermaidCache.set(code, errorHtml)
      
      const newDiv = document.createElement('div')
      newDiv.className = 'mermaid-rendered'
      newDiv.innerHTML = errorHtml
      wrapper.parentNode?.replaceChild(newDiv, wrapper)
    }
  }
  
  return tempDiv.innerHTML
}

// 更新渲染的 HTML
const updateRenderedHtml = async (content, isStreaming) => {
  if (!content) {
    renderedHtml.value = ''
    return
  }
  
  // 注入光标标记
  // 使用不含特殊 Markdown 符号的随机字符串，避免被解析为粗体或斜体
  const cursorMarker = 'MARKER_CURSOR_Ob7x'
  let rawContent = content
  if (isStreaming) {
    rawContent += cursorMarker
  }
  
  // 渲染 Markdown
  let html = renderMarkdown(rawContent, isStreaming)
  
  // 流式输出时直接显示，并替换光标
  if (isStreaming) {
    // 替换标记为高亮光标
    html = html.replace(cursorMarker, '<span class="streaming-cursor">|</span>')
    renderedHtml.value = html
    return
  }
  
  // 非流式时，处理 Mermaid 图表
  renderedHtml.value = await processMermaidInHtml(html)
}

// 监听内容变化（合并流式和非流式逻辑，避免竞态条件）
watch(() => props.content, (newContent) => {
  if (props.streaming) {
    // 流式输出时节流更新
    if (throttleTimer) return
    
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      updateRenderedHtml(newContent, true)
    }, THROTTLE_DELAY)
  } else {
    // 非流式时直接更新
    updateRenderedHtml(newContent, false)
  }
}, { immediate: true })

// 关键修复：监听 streaming 状态变化
// 当 streaming 从 true 变为 false 时，需要重新渲染以移除光标
watch(() => props.streaming, (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // 清除可能存在的节流定时器
    if (throttleTimer) {
      clearTimeout(throttleTimer)
      throttleTimer = null
    }
    // 立即以非流式模式重新渲染，移除光标
    updateRenderedHtml(props.content, false)
  }
})

// 组件挂载后初始渲染
onMounted(async () => {
  if (props.content && !props.streaming) {
    await updateRenderedHtml(props.content, false)
  }
})

// 组件卸载时清理（包含 Mermaid 缓存）
onUnmounted(() => {
  if (throttleTimer) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }
  // 清理 Mermaid 缓存，避免内存泄漏
  mermaidCache.clear()
})
</script>

<style scoped>
.markdown-content {
  line-height: 1.75;
  color: var(--text-primary);
  font-size: 15px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* 流式输出光标 - 内联元素跟随 */
:deep(.streaming-cursor) {
  display: inline-block;
  margin-left: 1px;
  animation: blink 1s step-end infinite;
  color: var(--primary);
  font-weight: normal;
  opacity: 0.8;
  font-family: inherit;
  vertical-align: text-bottom;
}

@keyframes blink {
  0%, 50% {
    opacity: 1;
  }
  51%, 100% {
    opacity: 0;
  }
}

:deep(h1),
:deep(h2),
:deep(h3),
:deep(h4),
:deep(h5),
:deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-primary);
}

:deep(h1) {
  font-size: 24px;
}

:deep(h2) {
  font-size: 20px;
}

:deep(h3) {
  font-size: 17px;
}

:deep(h4) {
  font-size: 15px;
}

:deep(h5) {
  font-size: 15px;
  color: var(--text-secondary);
}

:deep(h6) {
  font-size: 14px;
  color: var(--text-tertiary);
}

/* 首个标题无顶部间距 */
:deep(h1:first-child),
:deep(h2:first-child),
:deep(h3:first-child),
:deep(h4:first-child),
:deep(h5:first-child),
:deep(h6:first-child) {
  margin-top: 0;
}

/* 段落样式 - 更紧凑 */
:deep(p) {
  margin: 8px 0;
  line-height: 1.7;
}

:deep(p:first-child) {
  margin-top: 0;
}

:deep(p:last-child) {
  margin-bottom: 0;
}

/* 列表样式 - 更紧凑 */
:deep(ul),
:deep(ol) {
  padding-left: 24px;
  margin: 8px 0;
}

:deep(li) {
  margin: 4px 0;
  line-height: 1.7;
}

:deep(li > p) {
  margin: 2px 0;
}

:deep(ul ul),
:deep(ol ul),
:deep(ul ol),
:deep(ol ol) {
  margin: 4px 0;
}

:deep(li::marker) {
  color: var(--text-secondary);
}

/* 行内代码 - 使用更中性的蓝紫色 */
:deep(code) {
  background: var(--code-inline-bg, rgba(99, 102, 241, 0.1));
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
  color: var(--code-inline-color, #6366f1);
  font-weight: 500;
}

:deep(pre) {
  background: #282c34;
  padding: 20px;
  border-radius: var(--radius-lg);
  overflow-x: auto;
  margin: 20px 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
  box-shadow: var(--shadow-sm);
  position: relative;
}

:deep(pre.hljs) {
  background: #282c34;
  color: #abb2bf;
}

:deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
  border: none;
  font-size: 14px;
  line-height: 1.6;
  font-weight: 400;
}

/* 代码高亮样式 */
:deep(.hljs-comment),
:deep(.hljs-quote) {
  color: #5c6370;
  font-style: italic;
}

:deep(.hljs-keyword),
:deep(.hljs-selector-tag),
:deep(.hljs-type) {
  color: #c678dd;
}

:deep(.hljs-string),
:deep(.hljs-attr) {
  color: #98c379;
}

:deep(.hljs-number),
:deep(.hljs-literal),
:deep(.hljs-built_in) {
  color: #d19a66;
}

:deep(.hljs-function),
:deep(.hljs-title) {
  color: #61afef;
}

:deep(.hljs-variable),
:deep(.hljs-template-variable) {
  color: #e06c75;
}

:deep(.hljs-name),
:deep(.hljs-selector-id),
:deep(.hljs-selector-class) {
  color: #e5c07b;
}

/* 引用块 - 保持主色调 */
:deep(blockquote) {
  border-left: 4px solid var(--primary);
  padding: 8px 16px;
  margin: 12px 0;
  background: var(--primary-lighter);
  border-radius: 0 6px 6px 0;
  color: var(--text-secondary);
}

:deep(blockquote p) {
  margin: 4px 0;
}

:deep(blockquote p:first-child) {
  margin-top: 0;
}

:deep(blockquote p:last-child) {
  margin-bottom: 0;
}

/* 表格样式 - 简洁无阴影 */
:deep(.table-wrapper) {
  overflow-x: auto;
  margin: 12px 0;
  -webkit-overflow-scrolling: touch;
}

:deep(.table-wrapper table) {
  margin: 0;
}

:deep(table) {
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
}

:deep(th),
:deep(td) {
  border: 1px solid var(--border-light);
  padding: 8px 12px;
  text-align: left;
}

:deep(th) {
  background: var(--bg-secondary);
  font-weight: 600;
  color: var(--text-primary);
}

:deep(tbody tr:nth-child(even)) {
  background: var(--bg-secondary);
}

/* 链接样式 */
:deep(a) {
  color: var(--primary);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: all var(--transition-fast);
  font-weight: 500;
}

:deep(a:hover) {
  border-bottom-color: var(--primary);
  color: var(--primary-hover);
}

/* 文本强调样式 */
:deep(strong) {
  font-weight: 600;
  color: var(--text-primary);
}

:deep(em) {
  font-style: italic;
}

:deep(del) {
  text-decoration: line-through;
  color: var(--text-tertiary);
}

:deep(mark) {
  background: rgba(250, 204, 21, 0.3);
  padding: 1px 4px;
  border-radius: 3px;
}

/* 图片样式 - 简洁 */
:deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 12px 0;
}

/* 行内元素间距 */
:deep(code),
:deep(kbd),
:deep(samp) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
}

:deep(kbd) {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.9em;
  box-shadow: 0 2px 0 var(--border-color);
}

/* 注释样式 */
:deep(sub),
:deep(sup) {
  font-size: 0.75em;
}

/* 分隔线 - 更轻 */
:deep(hr) {
  border: none;
  border-top: 1px solid var(--border-light);
  margin: 16px 0;
}

/* Mermaid 图表样式 - 简洁无边框 */
:deep(.mermaid-wrapper),
:deep(.mermaid-rendered) {
  margin: 12px 0;
  padding: 0;
  background: transparent;
  border: none !important;
  border-left: none !important;
}

:deep(.mermaid),
:deep(.mermaid-rendered) {
  display: block;
  text-align: center;
  background: transparent;
  border: none !important;
  padding: 0;
  margin: 0;
}

:deep(.mermaid svg),
:deep(.mermaid-rendered svg) {
  max-width: 100%;
  height: auto !important;
  display: block;
  margin: 0 auto;
}

/* 确保 mermaid 内部元素无边框 */
:deep(.mermaid *),
:deep(.mermaid-rendered *) {
  border-left: none !important;
}

/* Mermaid 渲染失败时显示代码 */
:deep(.mermaid-error) {
  background: var(--bg-tertiary, #f5f5f5);
  color: var(--text-secondary, #666);
  padding: 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
}

/* 如果 mermaid 在 blockquote 内，移除边框 */
:deep(blockquote:has(.mermaid-wrapper)) {
  border-left: none;
  padding-left: 0;
  background: transparent;
}

/* 确保包含 mermaid 的容器无边框 */
:deep(p:has(.mermaid-wrapper)),
:deep(div:has(.mermaid-wrapper)) {
  border: none !important;
}
</style>