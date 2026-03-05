/**
 * 轻量级 Markdown 渲染器（用于推理框）
 *
 * 支持：
 * - **加粗** / __加粗__
 * - `行内代码`
 * - ```围栏代码块```
 * - | GFM 表格 |
 *
 * 自动去除：
 * - 标题标记（# ## ###）
 * - 列表标记（- * 1.）
 * - 分隔线（--- *** ___）
 * - 多余连续空行（压缩为最多一个段落间距）
 */

// ── 工具函数 ────────────────────────────────────────────────

const escapeHtml = (str) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** 判断是否为表格分隔行，例如 |---|:---:| */
const isTableSeparator = (line) =>
  /^\|[\s\-\|:]+\|?\s*$/.test(line.trim())

/** 解析一行表格，返回单元格字符串数组 */
function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** 对已转义的文本应用行内格式（加粗、行内代码） */
function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
}

/** 将连续的表格行数组渲染为 <table> HTML */
function renderTableBlock(tableLines) {
  const validLines = tableLines.filter((l) => l.trim().startsWith('|'))
  if (validLines.length < 2 || !isTableSeparator(validLines[1])) {
    return validLines.map((l) => applyInline(escapeHtml(l.trim()))).join('<br>')
  }

  const headers = parseTableRow(validLines[0]).map((h) =>
    applyInline(escapeHtml(h))
  )
  const dataRows = validLines.slice(2).map((line) =>
    parseTableRow(line).map((cell) => applyInline(escapeHtml(cell)))
  )

  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${dataRows
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody>`

  return `<div class="lite-table-wrap"><table class="lite-table">${thead}${tbody}</table></div>`
}

// ── 主渲染函数 ───────────────────────────────────────────────

/**
 * 渲染轻量级 Markdown
 * @param {string} text - Markdown 文本
 * @returns {string} - HTML 字符串
 */
export function renderLiteMarkdown(text) {
  if (!text) return ''

  const lines = text.split('\n')
  const resultParts = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // ── 1. 围栏代码块：```lang ... ``` ──
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim() || ''
      const codeLines = []
      i++
      // 收集代码内容，直到遇到闭合的 ```
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // 跳过闭合的 ```
      const codeContent = escapeHtml(codeLines.join('\n'))
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
      resultParts.push(
        `<pre class="lite-code"${langAttr}><code>${codeContent}</code></pre>`
      )
      continue
    }

    // ── 2. 表格块检测 ──
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const tableLines = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      resultParts.push(renderTableBlock(tableLines))
      continue
    }

    // ── 3. 空行 → 用空字符串占位，join 后产生 <br><br> ──
    if (!trimmed) {
      resultParts.push('')
      i++
      continue
    }

    // ── 4. 分隔线（丢弃，不产生任何内容） ──
    if (/^[\-\*_]{3,}\s*$/.test(trimmed)) {
      i++
      continue
    }

    // ── 5. 普通文本行：去除标题/列表标记，应用行内格式 ──
    const plain = trimmed
      .replace(/^#{1,6}\s+/, '')   // 标题
      .replace(/^[\-\*]\s+/, '')   // 无序列表
      .replace(/^\d+\.\s+/, '')    // 有序列表

    resultParts.push(applyInline(escapeHtml(plain)))
    i++
  }

  // join 各行（空行条目会产生 <br><br>），最后压缩多余空行
  return resultParts
    .join('<br>')
    .replace(/(<br>\s*){3,}/g, '<br><br>') // 最多保留一次段落间距
    .replace(/^(<br>)+/, '')               // 去除开头多余换行
    .replace(/(<br>)+$/, '')               // 去除结尾多余换行
}
