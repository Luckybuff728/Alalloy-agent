import { parseReportMarkdown } from './reportMarkdownParser'

const MM_TO_PT = 2.834645669

const marginsPt = {
  top: 2098 / 20,
  bottom: 1984 / 20,
  left: 1587 / 20,
  right: 1474 / 20,
}

const PAGE_WIDTH_PT = 11906 / 20
const HEADER_DIST_PT = 851 / 20
const LOGO_X_OFFSET_PT = 152400 / 12700
const LOGO_Y_OFFSET_PT = 62865 / 12700
const LOGO_Y_ADJUST_PT = -16
const LOGO_W_PT = 677545 / 12700
const LOGO_H_PT = 650240 / 12700

const SUBSCRIPT_MAP = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
}

const assetCache = new Map()
let pdfMakeInstance = null
let fontsReady = false

const arrayBufferToBase64 = (buffer) => {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const fetchAsBase64 = async (url) => {
  const cached = assetCache.get(url)
  if (cached) return cached
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`加载资源失败: ${url}`)
  const base64 = arrayBufferToBase64(await resp.arrayBuffer())
  assetCache.set(url, base64)
  return base64
}

const fetchAsDataUrl = async (url) => {
  const key = `data:${url}`
  const cached = assetCache.get(key)
  if (cached) return cached
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`加载资源失败: ${url}`)
  const blob = await resp.blob()
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  assetCache.set(key, dataUrl)
  return dataUrl
}

const loadPdfMake = async () => {
  if (pdfMakeInstance && fontsReady) return pdfMakeInstance

  const module = await import('pdfmake/build/pdfmake')
  const pdfMake = module.default || module

  // 注册本地中文字体
  const fontFiles = {
    'fz-gov-xbs.ttf': '/template-fonts/fz-gov-xbs.ttf',
    'simfang.ttf': '/fonts/simfang.ttf',
    'simhei.ttf': '/fonts/simhei.ttf',
    'simkai.ttf': '/fonts/simkai.ttf',
    'stsong.ttf': '/fonts/stsong.ttf',
    'simsunb.ttf': '/fonts/simsunb.ttf',
  }

  const vfs = {}
  for (const [filename, url] of Object.entries(fontFiles)) {
    vfs[filename] = await fetchAsBase64(url)
  }

  pdfMake.addVirtualFileSystem(vfs)
  pdfMake.addFonts({
    FangSong: {
      normal: 'simfang.ttf',
      bold: 'simfang.ttf',
      italics: 'simfang.ttf',
      bolditalics: 'simfang.ttf',
    },
    KaiTi: {
      normal: 'simkai.ttf',
      bold: 'simkai.ttf',
      italics: 'simkai.ttf',
      bolditalics: 'simkai.ttf',
    },
    SimHei: {
      normal: 'simhei.ttf',
      bold: 'simhei.ttf',
      italics: 'simhei.ttf',
      bolditalics: 'simhei.ttf',
    },
    SongTi: {
      normal: 'simfang.ttf',
      bold: 'simfang.ttf',
      italics: 'simfang.ttf',
      bolditalics: 'simfang.ttf',
    },
    FZGovXiaoBiaoSong: {
      normal: 'fz-gov-xbs.ttf',
      bold: 'fz-gov-xbs.ttf',
      italics: 'fz-gov-xbs.ttf',
      bolditalics: 'fz-gov-xbs.ttf',
    },
  })

  pdfMakeInstance = pdfMake
  fontsReady = true
  return pdfMake
}

const cleanupText = (text = '') => {
  let normalized = String(text)
    .replace(/[\u200B\u2060\u00AD]/g, '')
    .replace(/✅/g, '达标')
    .replace(/❌/g, '未达标')
    .replace(/⚠️|⚠/g, '风险提示')
    .replace(/[—–]/g, '-')
    .replace(/→/g, '->')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/±/g, '+/-')
    .replace(/×/g, 'x')
    .replace(/β/g, 'beta')
    .replace(/α/g, 'alpha')
    .replace(/γ/g, 'gamma')
    .replace(/δ/g, 'delta')
    .replace(/°\s*C/g, '℃')
    .replace(/°C/g, '℃')
    .replace(/℃/g, '℃')

  normalized = normalized.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (char) => SUBSCRIPT_MAP[char] || char)
  normalized = normalized.replace(/\s+/g, ' ').trim()
  return normalized
}

const wrapTableCellText = (text = '', columnIndex = 0, totalColumns = 0) => {
  const normalized = cleanupText(text)
  if (!normalized) return normalized

  // 只对表格中的长串做显式换行，避免再用不可见字符导致方框乱码。
  if (columnIndex === 0 && normalized.length > 20) {
    return normalized
      .replace(/-/g, '-\n')
      .replace(/\//g, '/\n')
  }

  if (totalColumns >= 5 && normalized.length > 12) {
    return normalized
      .replace(/\s+/g, '\n')
  }

  return normalized
}

const parseInline = (text = '', baseStyle = {}) => {
  const src = cleanupText(text)
  const parts = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(src))) {
    if (match.index > lastIndex) {
      parts.push({ text: src.slice(lastIndex, match.index), ...baseStyle })
    }
    const token = match[0]
    if (token.startsWith('**')) {
      parts.push({
        text: token.slice(2, -2),
        bold: true,
        ...baseStyle,
      })
    } else if (token.startsWith('`')) {
      parts.push({
        text: token.slice(1, -1),
        font: 'FangSong',
        fontSize: (baseStyle.fontSize || 16) - 1,
        ...baseStyle,
      })
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < src.length) {
    parts.push({ text: src.slice(lastIndex), ...baseStyle })
  }

  return parts.length ? parts : [{ text: src, ...baseStyle }]
}

const buildParagraph = (text, styleName = 'body') => ({
  text: parseInline(text),
  style: styleName,
})

const normalizeSectionTitle = (title) => cleanupText(title)

const buildTable = (block) => {
  const headerCells = block.header || []
  const header = headerCells.map((cell) => ({
    text: cleanupText(cell),
    style: 'tableHeader',
    alignment: 'center',
  }))

  const rowCount = header.length
  const body = [header]
  for (const row of block.rows || []) {
    const padded = [...row]
    while (padded.length < rowCount) padded.push('')
    body.push(
      padded.slice(0, rowCount).map((cell, columnIndex) => ({
        text: parseInline(wrapTableCellText(cell, columnIndex, rowCount), { fontSize: rowCount >= 5 ? 11.5 : 12.5 }),
        style: 'tableCell',
        noWrap: false,
      }))
    )
  }

  let widths = header.map(() => '*')
  if (header.length >= 6) {
    widths = [128, 42, 35, 46, 46, 56]
  } else if (header.length === 5) {
    widths = [140, 52, 52, 52, 58]
  } else if (header.length === 4) {
    widths = [88, 82, 82, '*']
  }
  if (header.length === 3) {
    widths = [60, 90, '*']
  } else if (header.length === 2) {
    widths = [96, '*']
  }

  return {
    margin: [0, 8, 0, 10],
    table: {
      headerRows: 1,
      dontBreakRows: true,
      keepWithHeaderRows: 1,
      widths,
      body,
    },
    layout: {
      fillColor: (rowIndex) => {
        if (rowIndex === 0) return '#f3f4f6'
        return null
      },
      hLineColor: () => '#666666',
      vLineColor: () => '#666666',
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
  }
}

const buildNote = (text) => ({
  text: parseInline(text, { fontSize: 15 }),
  style: 'noteText',
  margin: [0, 6, 0, 8],
  unbreakable: true,
})

const buildBlocks = (blocks = []) => {
  const content = []

  for (const block of blocks) {
    if (block.type === 'heading3') {
      content.push({
        text: normalizeSectionTitle(block.text),
        style: 'heading3',
        headlineLevel: 2,
        unbreakable: true,
      })
      continue
    }
    if (block.type === 'heading4') {
      content.push({
        text: normalizeSectionTitle(block.text),
        style: 'heading4',
        headlineLevel: 3,
        unbreakable: true,
      })
      continue
    }
    if (block.type === 'paragraph') {
      content.push(buildParagraph(block.text))
      continue
    }
    if (block.type === 'bulletList') {
      content.push({
        ul: (block.items || []).map((item) => ({
          text: parseInline(item),
          style: 'body',
        })),
        margin: [18, 2, 0, 6],
      })
      continue
    }
    if (block.type === 'orderedList') {
      content.push({
        ol: (block.items || []).map((item) => ({
          text: parseInline(item),
          style: 'body',
        })),
        margin: [18, 2, 0, 6],
      })
      continue
    }
    if (block.type === 'table') {
      content.push(buildTable(block))
      continue
    }
    if (block.type === 'note') {
      content.push(buildNote(block.text))
      continue
    }
  }

  return content
}

const buildDocDefinition = ({ title, markdown, savedAt, logoDataUrl, qrDataUrl }) => {
  const parsed = parseReportMarkdown(markdown)
  const finalTitle = cleanupText(title || parsed.title || '铝合金设计可行性报告')
  const rawDate = savedAt ? new Date(savedAt) : new Date()
  const dateObj = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate
  const dateStr = `${dateObj.getFullYear()}年${String(dateObj.getMonth() + 1).padStart(2, '0')}月${String(dateObj.getDate()).padStart(2, '0')}日`
  const content = [
    { text: finalTitle, style: 'docTitle' },
  ]

  for (const section of parsed.sections) {
    if (section.title) {
      content.push({
        text: normalizeSectionTitle(section.title),
        style: 'heading2',
        headlineLevel: 1,
        unbreakable: true,
      })
    }
    content.push(...buildBlocks(section.blocks))
  }

  content.push({
    text: '长沙顶材科技有限公司',
    style: 'signOff',
    alignment: 'right',
    margin: [0, 24, 0, 0],
  })
  content.push({
    text: dateStr,
    style: 'signOff',
    alignment: 'right',
    margin: [0, 4, 0, 0],
  })
  if (qrDataUrl) {
    content.push({
      columns: [
        { width: '*', text: '' },
        { width: 52, image: qrDataUrl, fit: [48, 48] },
      ],
      margin: [0, 8, 0, 0],
    })
  }

  return {
    pageSize: 'A4',
    pageMargins: [marginsPt.left, marginsPt.top, marginsPt.right, marginsPt.bottom],
    defaultStyle: {
      font: 'FangSong',
      fontSize: 16,
      lineHeight: 1.75,
      color: '#000000',
    },
    info: {
      title: finalTitle,
      author: '长沙顶材科技有限公司',
      subject: '铝合金设计可行性报告',
      creator: 'Alalloy Agent',
      producer: 'pdfmake',
    },
    header: (currentPage) => {
      if (currentPage !== 1) return { text: '' }
      return {
        margin: [0, 0, 0, 0],
        stack: [
          {
            text: '长沙顶材科技有限公司',
            style: 'companyCn',
            absolutePosition: { x: 0, y: HEADER_DIST_PT + 3 },
            width: PAGE_WIDTH_PT,
            alignment: 'center',
          },
          {
            text: 'CHANGSHA TOPMATERIAL TECHNOLOGY CO., LTD.',
            style: 'companyEn',
            absolutePosition: { x: 0, y: HEADER_DIST_PT + 24 },
            width: PAGE_WIDTH_PT,
            alignment: 'center',
          },
          logoDataUrl
            ? {
                image: logoDataUrl,
                fit: [LOGO_W_PT, LOGO_H_PT],
                absolutePosition: {
                  x: marginsPt.left + LOGO_X_OFFSET_PT,
                  y: HEADER_DIST_PT + LOGO_Y_OFFSET_PT + LOGO_Y_ADJUST_PT,
                },
              }
            : { text: '' },
        ],
      }
    },
    footer: () => ({ text: '' }),
    pageBreakBefore: (currentNode, nodeContainer) => {
      if (!currentNode) return false
      const followingNodes = nodeContainer.getFollowingNodesOnPage()
      if (currentNode.headlineLevel && followingNodes.length === 0) {
        return true
      }
      if (currentNode.style === 'heading3' && followingNodes.length < 2) {
        return true
      }
      if (currentNode.style === 'heading4' && followingNodes.length < 2) {
        return true
      }
      return false
    },
    styles: {
      docTitle: {
        font: 'FangSong',
        fontSize: 22,
        bold: true,
        alignment: 'center',
        lineHeight: 1.45,
        margin: [0, 18, 0, 12],
      },
      heading2: {
        font: 'SimHei',
        fontSize: 16,
        bold: true,
        lineHeight: 2,
        margin: [0, 14, 0, 4],
      },
      heading3: {
        font: 'KaiTi',
        fontSize: 16,
        lineHeight: 2,
        margin: [0, 10, 0, 2],
      },
      heading4: {
        font: 'FangSong',
        fontSize: 16,
        bold: true,
        lineHeight: 1.75,
        margin: [0, 8, 0, 2],
      },
      body: {
        font: 'FangSong',
        fontSize: 16,
        lineHeight: 1.75,
        margin: [0, 0, 0, 2],
      },
      tableHeader: {
        font: 'SimHei',
        fontSize: 12,
        bold: true,
        color: '#111111',
      },
      tableCell: {
        font: 'FangSong',
        fontSize: 12.5,
        lineHeight: 1.4,
      },
      companyCn: {
        font: 'FZGovXiaoBiaoSong',
        fontSize: 16,
        lineHeight: 1,
        color: '#293a7a',
        characterSpacing: 0,
      },
      companyEn: {
        font: 'FZGovXiaoBiaoSong',
        fontSize: 10.5,
        lineHeight: 1,
        color: '#293a7a',
      },
      signOff: {
        font: 'FangSong',
        fontSize: 14,
        lineHeight: 1.6,
      },
      noteText: {
        font: 'FangSong',
        fontSize: 15,
        lineHeight: 1.6,
        color: '#222222',
      },
    },
    content,
  }
}

export const downloadReportPdf = async ({ title, markdown, savedAt }) => {
  const pdfMake = await loadPdfMake()
  const [logoDataUrl, qrDataUrl] = await Promise.all([
    fetchAsDataUrl('/template-assets/header-logo-from-docx.png')
      .catch(() => fetchAsDataUrl('/template-assets/image1.png'))
      .catch(() => fetchAsDataUrl('/favicon.ico')),
    fetchAsDataUrl('/template-assets/image2.jpeg').catch(() => ''),
  ])

  const docDefinition = buildDocDefinition({
    title,
    markdown,
    savedAt,
    logoDataUrl,
    qrDataUrl,
  })

  const filename = `${(title || '报告').replace(/[\s/\\:*?"<>|]/g, '_')}.pdf`
  await pdfMake.createPdf(docDefinition).download(filename)
}

