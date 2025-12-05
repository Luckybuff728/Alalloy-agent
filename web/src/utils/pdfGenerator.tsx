/**
 * PDF 报告生成工具
 * 使用 @react-pdf/renderer 生成矢量 PDF（清晰、文件小）
 */

import React from 'react'
import type { ReactElement } from 'react'
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'

/**
 * 报告配置
 */
interface ReportConfig {
  title?: string
  company?: string
  content: string
  alloys?: string[]
}

/**
 * 格式化日期时间
 */
function formatDateTime(): string {
  const now = new Date()
  return `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

// 注册中文字体（使用系统字体）
Font.register({
  family: 'Chinese',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/npm/source-han-sans-cn@1.0.0/SourceHanSansCN-Regular.otf', fontWeight: 'normal' },
    { src: 'https://cdn.jsdelivr.net/npm/source-han-sans-cn@1.0.0/SourceHanSansCN-Bold.otf', fontWeight: 'bold' },
  ]
})

// PDF 样式
const styles = StyleSheet.create({
  page: {
    padding: '20mm 25mm',
    fontFamily: 'Chinese',
    fontSize: 10,
    lineHeight: 1.6,
    color: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
    marginBottom: 12,
  },
  company: {
    fontSize: 11,
    color: '#3b82f6',
    fontWeight: 'bold',
  },
  date: {
    fontSize: 9,
    color: '#888',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    color: '#111',
  },
  alloysBox: {
    backgroundColor: '#f0f7ff',
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    padding: '6 10',
    marginBottom: 10,
  },
  alloysLabel: {
    fontSize: 9,
    color: '#666',
  },
  alloyTag: {
    fontSize: 9,
    color: '#1e40af',
    backgroundColor: '#dbeafe',
    padding: '2 6',
    borderRadius: 4,
    marginLeft: 4,
  },
  h1: { fontSize: 14, fontWeight: 'bold', marginTop: 12, marginBottom: 6, color: '#111' },
  h2: { fontSize: 12, fontWeight: 'bold', marginTop: 10, marginBottom: 5, color: '#111', borderBottomWidth: 1, borderBottomColor: '#ddd', paddingBottom: 3 },
  h3: { fontSize: 11, fontWeight: 'bold', marginTop: 8, marginBottom: 4, color: '#222' },
  h4: { fontSize: 10, fontWeight: 'bold', marginTop: 6, marginBottom: 3, color: '#333' },
  paragraph: { marginBottom: 4 },
  listItem: { flexDirection: 'row', marginBottom: 2, paddingLeft: 8 },
  bullet: { width: 12, color: '#666' },
  listText: { flex: 1 },
  bold: { fontWeight: 'bold' },
  table: { marginVertical: 8, borderWidth: 1, borderColor: '#999', width: '100%' },
  tableRow: { flexDirection: 'row', width: '100%' },
  tableCell: { padding: '5 8', fontSize: 9, borderWidth: 0.5, borderColor: '#999', lineHeight: 1.4 },
  tableCellHeader: { padding: '5 8', fontSize: 9, borderWidth: 0.5, borderColor: '#999', fontWeight: 'bold', backgroundColor: '#e8e8e8', lineHeight: 1.4 },
  hr: { borderBottomWidth: 1, borderBottomColor: '#ddd', marginVertical: 8 },
  footer: {
    position: 'absolute',
    bottom: 15,
    left: 25,
    right: 25,
    textAlign: 'center',
    fontSize: 8,
    color: '#999',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 6,
  },
})

/**
 * 解析 Markdown 为 React PDF 元素
 */
function parseMarkdownToPdf(markdown: string): ReactElement[] {
  const elements: ReactElement[] = []
  const lines = markdown.split('\n')
  let key = 0
  let inTable = false
  let tableRows: string[][] = []
  
  // 清理文本中的 Markdown 标记，并处理特殊符号
  const cleanMarkdown = (text: string): string => {
    return text
      .replace(/`([^`]+)`/g, '$1')          // 移除行内代码反引号
      .replace(/\*\*([^*]+)\*\*/g, '$1')     // 移除加粗标记
      .replace(/\*([^*]+)\*/g, '$1')         // 移除斜体标记
      .replace(/~~([^~]+)~~/g, '$1')         // 移除删除线
      // 处理容易重叠的符号
      .replace(/°C/g, '°C ')                 // 摄氏度后加空格
      .replace(/℃/g, '℃ ')                  // 摄氏度符号后加空格
      .replace(/×/g, ' × ')                  // 乘号前后加空格
      .replace(/α/g, 'α ')                   // 希腊字母后加空格
      .replace(/β/g, 'β ')
      .replace(/γ/g, 'γ ')
      .replace(/,(\S)/g, ', $1')             // 逗号后自动补空格，避免与字母/数字粘连
      .replace(/\s+/g, ' ')                  // 合并多余空格
      .trim()
  }
  
  const flushTable = () => {
    if (tableRows.length > 0) {
      // 确保所有行的列数一致
      const maxCols = Math.max(...tableRows.map(r => r.length))
      const normalizedRows = tableRows.map(row => {
        while (row.length < maxCols) row.push('')
        return row
      })
      
      // 根据列数计算宽度比例
      const colCount = maxCols
      // 第一列较窄，最后一列较宽
      const getColWidth = (idx: number): string => {
        if (colCount === 3) {
          return idx === 0 ? '20%' : idx === 1 ? '30%' : '50%'
        } else if (colCount === 2) {
          return '50%'
        }
        return `${100 / colCount}%`
      }
      
      elements.push(
        <View key={key++} style={styles.table}>
          {normalizedRows.map((row, rowIdx) => (
            <View key={rowIdx} style={styles.tableRow}>
              {row.map((cell, cellIdx) => (
                <View key={cellIdx} style={[
                  rowIdx === 0 ? styles.tableCellHeader : styles.tableCell,
                  { width: getColWidth(cellIdx) }
                ]}>
                  <Text style={{ fontSize: 9, lineHeight: 1.5, letterSpacing: 0.3 }}>{cleanMarkdown(cell)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )
      tableRows = []
    }
    inTable = false
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    // 空行
    if (!line) {
      if (inTable) flushTable()
      continue
    }
    
    // 表格
    if (line.startsWith('|') || (inTable && line.includes('|'))) {
      // 跳过分隔行 (|---|---|)
      if (line.match(/^\|?[\s:-]+\|/)) continue
      inTable = true
      // 解析单元格：去掉首尾的 |，然后按 | 分割
      const trimmed = line.replace(/^\|/, '').replace(/\|$/, '')
      const cells = trimmed.split('|').map(c => c.trim())
      if (cells.length > 0 && cells.some(c => c)) {
        tableRows.push(cells)
      }
      continue
    } else if (inTable) {
      flushTable()
    }
    
    // 标题
    if (line.startsWith('#### ')) {
      elements.push(<Text key={key++} style={styles.h4}>{cleanMarkdown(line.slice(5))}</Text>)
    } else if (line.startsWith('### ')) {
      elements.push(<Text key={key++} style={styles.h3}>{cleanMarkdown(line.slice(4))}</Text>)
    } else if (line.startsWith('## ')) {
      elements.push(<Text key={key++} style={styles.h2}>{cleanMarkdown(line.slice(3))}</Text>)
    } else if (line.startsWith('# ')) {
      elements.push(<Text key={key++} style={styles.h1}>{cleanMarkdown(line.slice(2))}</Text>)
    }
    // 分隔线
    else if (line === '---' || line === '***') {
      elements.push(<View key={key++} style={styles.hr} />)
    }
    // 列表
    else if (line.match(/^[-*]\s/)) {
      const text = line.slice(2)
      elements.push(
        <View key={key++} style={styles.listItem}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.listText}>{cleanMarkdown(text)}</Text>
        </View>
      )
    } else if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s/, '')
      const num = line.match(/^(\d+)\./)?.[1] || '1'
      elements.push(
        <View key={key++} style={styles.listItem}>
          <Text style={styles.bullet}>{num}.</Text>
          <Text style={styles.listText}>{cleanMarkdown(text)}</Text>
        </View>
      )
    }
    // 普通段落
    else {
      elements.push(
        <Text key={key++} style={styles.paragraph}>{cleanMarkdown(line)}</Text>
      )
    }
  }
  
  if (inTable) flushTable()
  
  return elements
}

/**
 * PDF 文档组件
 */
function ReportDocument({ config }: { config: ReportConfig }): ReactElement {
  const { title = '铝合金智能设计分析报告', company = '顶材科技', content, alloys = [] } = config
  const dateTime = formatDateTime()
  const contentElements = parseMarkdownToPdf(content)
  
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* 页眉 */}
        <View style={styles.header}>
          <Text style={styles.company}>{company}</Text>
          <Text style={styles.date}>{dateTime}</Text>
        </View>
        
        {/* 标题 */}
        <Text style={styles.title}>{title}</Text>
        
        {/* 推荐合金 */}
        {alloys.length > 0 && (
          <View style={styles.alloysBox}>
            <Text>
              <Text style={styles.alloysLabel}>推荐合金：</Text>
              {alloys.map((a, i) => (
                <Text key={i} style={styles.alloyTag}> {a} </Text>
              ))}
            </Text>
          </View>
        )}
        
        {/* 正文 */}
        {contentElements}
        
        {/* 页脚 */}
        <Text style={styles.footer}>{company} · 智能Al合金设计系统</Text>
      </Page>
    </Document>
  )
}

/**
 * 下载 PDF 报告
 */
export async function downloadPDFReport(config: ReportConfig): Promise<void> {
  const doc = <ReportDocument config={config} />
  const blob = await pdf(doc).toBlob()
  
  // 生成文件名
  const now = new Date()
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const fileName = `铝合金设计报告_${timestamp}.pdf`
  
  // 下载
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 获取报告摘要（用于预览）
 */
export function getReportSummary(content: string, maxLength: number = 200): string {
  // 移除 Markdown 标记
  const cleanContent = content
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  
  if (cleanContent.length <= maxLength) {
    return cleanContent
  }
  
  return cleanContent.substring(0, maxLength) + '...'
}

/**
 * 测试 PDF 生成（开发用）
 * 在浏览器控制台调用: testPdfFromMarkdown(markdownText)
 */
export async function testPdfFromMarkdown(markdown: string, alloys: string[] = []): Promise<void> {
  await downloadPDFReport({
    title: '铝合金智能设计分析报告',
    company: '顶材科技',
    content: markdown,
    alloys
  })
}

// 暴露到 window 对象，方便在控制台测试
if (typeof window !== 'undefined') {
  (window as any).testPdfFromMarkdown = testPdfFromMarkdown
}
