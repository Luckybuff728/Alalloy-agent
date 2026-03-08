<template>
  <div class="report-card">
    <!-- 核心摘要行：只在能提取到有效信息时显示 -->
    <div class="condition-bar" v-if="summaryStats.length">
      <div v-for="(s, i) in summaryStats" :key="i" class="cond-item">
        <span class="cond-label">{{ s.label }}</span>
        <span class="cond-value" :class="s.cls" :title="s.value">{{ s.value }}</span>
      </div>
    </div>

    <!-- 报告元数据行（始终显示） -->
    <div class="meta-bar">
      <span class="meta-item" v-if="candidateCount > 0">
        <span class="meta-dot"></span>候选方案 {{ candidateCount }} 个
      </span>
      <span class="meta-item">
        <span class="meta-dot"></span>共 {{ sectionCount }} 章节
      </span>
      <span class="meta-item" v-if="savedTime">
        <span class="meta-dot"></span>生成于 {{ savedTime }}
      </span>
    </div>

    <!-- 章节目录 -->
    <div class="section">
      <div class="chapter-list">
        <div v-for="(sec, i) in previewSections" :key="i" class="chapter-row">
          <span class="chapter-index">{{ i + 1 }}</span>
          <span class="chapter-name">{{ sec.title }}</span>
          <span v-if="sec.snippet" class="chapter-snippet">{{ sec.snippet }}</span>
        </div>
        <div v-if="!previewSections.length" class="no-data">暂无章节信息</div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="card-footer">
      <span>{{ props.data.title || '铝合金设计可行性报告' }}</span>
      <el-button
        type="primary"
        size="small"
        :loading="downloading"
        :disabled="downloading"
        class="btn-download"
        @click="downloadPdf"
      >
        <el-icon v-if="!downloading"><DownloadOutline /></el-icon>
        {{ downloading ? '生成中...' : '下载 PDF' }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElButton, ElIcon, ElMessage } from 'element-plus'
import { DownloadOutline } from '@vicons/ionicons5'
import { downloadReportPdf } from '../../utils/reportPdfBuilder'

const props = defineProps({
  data: { type: Object, required: true },
})

const downloading = ref(false)
const content = computed(() => props.data.content || '')

// ── 核心摘要：只提取真实数据，无任何兜底 fallback ──────────────────────
const summaryStats = computed(() => {
  const text = content.value
  const stats = []

  // 推荐成分：从第3节"最优方案推荐"或"结论"中提取
  // 匹配加粗的合金标识，如 **Al-8.0Si-0.28Mg** 或 推荐成分：Al-...
  const recPatterns = [
    /推荐成分[：:]\s*\*{1,2}(Al[^\s*，,。；\n]{4,})\*{0,2}/,
    /推荐成分[：:]\s*(Al[-\d.A-Za-z]+)/,
    /最优方案(?:是|为)[：:]?\s*\*{0,2}(Al[-\d.A-Za-z]+)/,
    /\*{2}(Al-[\d.]+[A-Za-z]+[^\s*]{0,30})\*{2}/,  // **Al-7Si-...** 加粗格式
  ]
  for (const pat of recPatterns) {
    const m = text.match(pat)
    if (m?.[1]) {
      // 截断到合理长度（避免过长），去掉末尾残留标点
      const val = m[1].trim().replace(/[，,。；\s].*$/, '').slice(0, 30)
      stats.push({ label: '推荐成分', value: val, cls: 'v-blue' })
      break
    }
  }

  // 最高 UTS：匹配 "UTS）：xxx MPa" 或 "UTS: xxx MPa" 或 "UTS：xxx" 等格式
  const utsAll = [...text.matchAll(/UTS[）\)：:\s]*(\d{2,3}(?:\.\d+)?)\s*MPa/g)]
    .map(m => Number(m[1])).filter(v => v > 50 && v < 800)
  if (utsAll.length) {
    stats.push({ label: '最高 UTS', value: `${Math.max(...utsAll).toFixed(0)} MPa`, cls: 'v-amber' })
  }

  // 最高 EL：匹配延伸率
  const elAll = [...text.matchAll(/EL[）\)：:\s]*(\d+(?:\.\d+)?)\s*%/g)]
    .map(m => Number(m[1])).filter(v => v > 0 && v < 60)
  if (elAll.length) {
    stats.push({ label: '最高 EL', value: `${Math.max(...elAll).toFixed(1)} %`, cls: 'v-green' })
  }

  // 凝固区间（来自 Scheil 数据）
  const dtM = text.match(/凝固区间[：:]\s*(\d+(?:\.\d+)?)\s*K/)
  if (dtM) {
    const dt = Number(dtM[1])
    stats.push({
      label: '凝固区间',
      value: `${dt.toFixed(0)} K`,
      cls: dt < 70 ? 'v-green' : dt < 100 ? 'v-amber' : 'v-red',
    })
  }

  return stats
})

// ── 元数据（始终可用）──────────────────────────────────────────────────────
// 候选方案数：统计第 2 节内 ### 小节数量
const candidateCount = computed(() => {
  const m = content.value.match(/^###\s/gm)
  return m ? m.length : 0
})

// 报告保存时间
const savedTime = computed(() => {
  const raw = props.data.saved_at
  if (!raw) return ''
  try {
    const dt = new Date(raw)
    const pad = n => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  } catch { return '' }
})

// ── 章节目录 ──────────────────────────────────────────────────────────────
const previewSections = computed(() => {
  const lines = content.value.split('\n')
  const result = []
  let title = ''
  let snippet = ''

  for (const raw of lines) {
    const line = raw.trim()
    // 只取 ## 级章节（不含 ### 小节）
    if (/^##\s/.test(line) && !/^###/.test(line)) {
      if (title) result.push({ title, snippet })
      title = line.replace(/^##\s+/, '').replace(/^\d+[.、]\s*/, '').trim()
      snippet = ''
    } else if (title && !snippet && line
      && !line.startsWith('#') && !line.startsWith('---')
      && !line.startsWith('|') && !line.startsWith('>')) {
      // 去掉 Markdown 修饰符，取首句有效内容
      const clean = line.replace(/\*+/g, '').replace(/`/g, '').replace(/^\s*[-*]\s+/, '').trim()
      if (clean.length > 2) {
        snippet = clean.slice(0, 42)
        if (clean.length > 42) snippet += '…'
      }
    }
  }
  if (title) result.push({ title, snippet })
  return result.slice(0, 7)
})

const sectionCount = computed(() => {
  const m = content.value.match(/^## /gm)
  return m ? m.length : 0
})

const downloadPdf = async () => {
  if (downloading.value) return
  downloading.value = true
  try {
    await downloadReportPdf({
      title: props.data.title || '铝合金设计可行性报告',
      markdown: content.value,
      savedAt: props.data.saved_at,
    })
  } catch (err) {
    console.error('[ReportCard] PDF 导出失败:', err)
    ElMessage.error(err?.message || 'PDF 导出失败，请稍后重试')
  } finally {
    downloading.value = false
  }
}
</script>

<style scoped>
/* 根元素透明，由外层 ResultCard wrapper 负责边框/阴影/padding */
.report-card { background: transparent; padding: 0; }

/* ── 摘要指标行（与 PointCalculationCard condition-bar 一致） ── */
.condition-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e2e8f0);
  flex-wrap: wrap;
}

.cond-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 80px;
}

.cond-label {
  font-size: 10px;
  color: var(--text-tertiary, #94a3b8);
  margin-bottom: 2px;
}

.cond-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #0f172a);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.v-blue  { color: #1967d2; }
.v-amber { color: #d97706; }
.v-green { color: #059669; }
.v-red   { color: #dc2626; }

/* ── 元数据行 ── */
.meta-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
  padding: 0 2px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary, #94a3b8);
}

.meta-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-tertiary, #cbd5e1);
  flex-shrink: 0;
}

/* ── 章节目录 ── */
.section { margin-bottom: 10px; }

.chapter-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.chapter-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.5;
}

.chapter-row:hover {
  background: var(--bg-secondary, #f8fafc);
}

.chapter-index {
  font-size: 10px;
  color: var(--text-tertiary, #94a3b8);
  width: 14px;
  text-align: right;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.chapter-name {
  color: var(--text-primary, #1e293b);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.chapter-snippet {
  color: var(--text-tertiary, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.no-data {
  font-size: 12px;
  color: var(--text-tertiary, #94a3b8);
}

/* ── 底部操作栏 ── */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light, #e2e8f0);
  margin-top: 4px;
}

.card-footer > span {
  font-size: 10px;
  color: var(--text-tertiary, #94a3b8);
}

.btn-download { font-size: 12px; }
</style>
