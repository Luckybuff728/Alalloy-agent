/**
 * 将 reportWriter 输出的 Markdown 报告解析为结构化内容。
 *
 * 目标：
 * - 不再直接按 Markdown 网页样式输出 PDF
 * - 仅提取标题、段落、列表、表格、评语等内容语义
 * - 后续由 pdfmake 按公文模板重新排版
 */

const normalizeLine = (line) => (line || '').replace(/\r/g, '').trimEnd()

const toChineseNumber = (num) => {
  const map = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (num <= 10) return map[num]
  if (num < 20) return `十${map[num - 10]}`
  if (num % 10 === 0) return `${map[Math.floor(num / 10)]}十`
  return `${map[Math.floor(num / 10)]}十${map[num % 10]}`
}

const isTableRow = (line) => {
  const text = (line || '').trim()
  if (!text.includes('|')) return false
  const pipeCount = (text.match(/\|/g) || []).length
  return pipeCount >= 2
}

const isTableDivider = (line) => {
  const text = (line || '').trim()
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(text)
}

const parseTable = (lines, startIndex) => {
  const rows = []
  let i = startIndex

  while (i < lines.length && isTableRow(lines[i])) {
    rows.push(lines[i].trim())
    i++
  }
  if (rows.length < 2) return null

  // 第二行必须是 Markdown 表头分隔线
  if (!isTableDivider(rows[1])) return null

  const splitRow = (row) =>
    row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim())

  const header = splitRow(rows[0])
  const body = rows
    .slice(2)
    .map(splitRow)
    .filter((row) => row.some((cell) => cell))

  if (!header.length || !body.length) return null

  return {
    nextIndex: i,
    block: {
      type: 'table',
      header,
      rows: body,
    },
  }
}

const isListLine = (line) =>
  /^[-*]\s+/.test(line) ||
  /^\d+\.\s+/.test(line) ||
  /^（\d+）/.test(line)

const parseList = (lines, startIndex) => {
  const items = []
  let i = startIndex
  let ordered = false

  while (i < lines.length) {
    const raw = lines[i].trim()
    if (!raw) break

    if (/^[-*]\s+/.test(raw)) {
      items.push(raw.replace(/^[-*]\s+/, '').trim())
      i++
      continue
    }
    if (/^\d+\.\s+/.test(raw)) {
      ordered = true
      items.push(raw.replace(/^\d+\.\s+/, '').trim())
      i++
      continue
    }
    break
  }

  if (!items.length) return null
  return {
    nextIndex: i,
    block: {
      type: ordered ? 'orderedList' : 'bulletList',
      items,
    },
  }
}

export const parseReportMarkdown = (markdown = '') => {
  const lines = markdown.split('\n').map(normalizeLine)
  const result = {
    title: '',
    sections: [],
  }

  let currentSection = null
  let currentBlocks = null
  let paragraphBuffer = []

  const flushParagraph = () => {
    if (!paragraphBuffer.length || !currentBlocks) return
    const text = paragraphBuffer.join('\n').trim()
    if (text) {
      currentBlocks.push({ type: 'paragraph', text })
    }
    paragraphBuffer = []
  }

  const ensureSection = () => {
    if (!currentSection) {
      currentSection = { title: '', blocks: [] }
      currentBlocks = currentSection.blocks
      result.sections.push(currentSection)
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    // 空行
    if (!line) {
      flushParagraph()
      i++
      continue
    }

    // 顶层标题
    if (line.startsWith('# ')) {
      flushParagraph()
      result.title = line.replace(/^#\s+/, '').trim()
      i++
      continue
    }

    // 一级节标题
    if (line.startsWith('## ')) {
      flushParagraph()
      const rawTitle = line.replace(/^##\s+/, '').trim()
      const m = rawTitle.match(/^(\d+)\.\s*(.+)$/)
      const title = m ? `${toChineseNumber(Number(m[1]))}、${m[2]}` : rawTitle
      currentSection = { title, blocks: [] }
      currentBlocks = currentSection.blocks
      result.sections.push(currentSection)
      i++
      continue
    }

    // 二级节标题（候选成分 / 工艺小节）
    if (line.startsWith('### ')) {
      flushParagraph()
      ensureSection()
      const rawTitle = line.replace(/^###\s+/, '').trim()
      let title = rawTitle
      const m = rawTitle.match(/^\d+\.(\d+)\s*(.+)$/)
      if (m) {
        title = `（${toChineseNumber(Number(m[1]))}）${m[2]}`
      }
      currentBlocks.push({ type: 'heading3', text: title })
      i++
      continue
    }

    // 三级标题
    if (line.startsWith('#### ')) {
      flushParagraph()
      ensureSection()
      currentBlocks.push({ type: 'heading4', text: line.replace(/^####\s+/, '').trim() })
      i++
      continue
    }

    // 分隔线：PDF 内不直接保留，由模板控制
    if (/^---+$/.test(line)) {
      flushParagraph()
      i++
      continue
    }

    // 表格
    const tableMatch = parseTable(lines, i)
    if (tableMatch) {
      flushParagraph()
      ensureSection()
      currentBlocks.push(tableMatch.block)
      i = tableMatch.nextIndex
      continue
    }

    // 列表
    if (isListLine(line)) {
      flushParagraph()
      ensureSection()
      const listMatch = parseList(lines, i)
      if (listMatch) {
        currentBlocks.push(listMatch.block)
        i = listMatch.nextIndex
        continue
      }
    }

    // 评语 / 引用块
    if (line.startsWith('>')) {
      flushParagraph()
      ensureSection()
      currentBlocks.push({
        type: 'note',
        text: line.replace(/^>\s*/, '').trim(),
      })
      i++
      continue
    }

    // 默认视为段落
    ensureSection()
    paragraphBuffer.push(line)
    i++
  }

  flushParagraph()
  return result
}

