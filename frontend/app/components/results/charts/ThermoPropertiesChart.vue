<template>
  <div class="thermo-chart">

    <!-- 条件摘要行 -->
    <div class="condition-bar">
      <div class="cond-item">
        <span class="cond-label">温度范围</span>
        <span class="cond-value">{{ tRange }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">数据点</span>
        <span class="cond-value">{{ summary?.total_rows ?? rows.length }} 行</span>
      </div>
      <div v-for="e in extremaSummary" :key="e.key" class="cond-item">
        <span class="cond-label">{{ e.label }}</span>
        <span class="cond-value small">{{ e.range }}</span>
      </div>
    </div>

    <!-- 属性 Tab + 图表工具栏 -->
    <div class="chart-toolbar">
      <div class="prop-tabs">
        <button
          v-for="tab in availableTabs"
          :key="tab.key"
          class="prop-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >{{ tab.label }}</button>
      </div>
      <div class="toolbar-actions">
        <button class="toolbar-btn" title="框选放大" @click="activateTool('zoom')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button class="toolbar-btn" title="平移" @click="activateTool('pan')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/>
            <polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/>
            <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
          </svg>
        </button>
        <button class="toolbar-btn" title="重置视图" @click="resetZoom()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 图表画布 -->
    <div ref="chartRef" class="chart-canvas"></div>

    <!-- 相系列切换面板 -->
    <div class="series-panel" v-if="allSeriesNames.length > 0">
      <div class="series-header">
        <span class="series-title">相系列</span>
        <span class="series-ctrl" @click="toggleAll(true)">全选</span>
        <span class="series-ctrl" @click="toggleAll(false)">清空</span>
      </div>
      <div class="series-chips">
        <button
          v-for="(name, idx) in allSeriesNames"
          :key="name"
          class="series-chip"
          :class="{ hidden: !isSeriesVisible(name) }"
          @click="toggleSeries(name)"
          @dblclick.prevent="isolateSeries(name)"
          :title="`${name}（双击只显示此相）`"
        >
          <span class="chip-dot" :style="{ background: COLORS[idx % COLORS.length] }"></span>
          <span class="chip-name">{{ name }}</span>
        </button>
      </div>
      <div class="series-hint">单击切换 · 双击仅显示该相</div>
    </div>

    <!-- 数据模式说明 -->
    <div class="data-note" v-if="isSummaryMode">
      <el-icon :size="11"><InformationCircleOutline /></el-icon>
      <span>摘要模式：展示前 {{ rows.length }} 个数据点（共 {{ summary?.total_rows }} 行）。调用 result_mode="full" 可获取完整数据。</span>
    </div>

    <!-- 工程意义说明 -->
    <div class="usage-block" v-if="activeUsageNote">
      <el-icon :size="12" class="usage-icon"><InformationCircleOutline /></el-icon>
      <span>{{ activeUsageNote }}</span>
    </div>

    <!-- 数据表格（折叠） -->
    <details class="data-table-wrap" v-if="rows.length > 0">
      <summary class="table-toggle">查看数据表格（{{ rows.length }} 行）</summary>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>T (K)</th>
              <th v-for="col in visibleDataCols" :key="col">{{ beautifyColName(col) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i">
              <td>{{ fmtNum(row[tempKey] ?? row['T/K']) }}</td>
              <td v-for="col in visibleDataCols" :key="col">{{ fmtNum(row[col]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, reactive, nextTick } from 'vue'
import Plotly from 'plotly.js-dist-min'
import { ElIcon } from 'element-plus'
import { InformationCircleOutline } from '@vicons/ionicons5'
import { getPhaseDisplayName } from '~/utils/phaseNames'

const props = defineProps({
  data: { type: Object, required: true }
})

const chartRef  = ref(null)
const activeTab = ref('GM')

// 当前 dragmode：'zoom' | 'pan'
const dragMode = ref('zoom')

const payload = computed(() => props.data?.result ?? props.data ?? {})
const summary = computed(() => payload.value?.data_summary ?? null)

const rows = computed(() => {
  const rd = payload.value?.result?.raw_data
  if (Array.isArray(rd) && rd.length > 0) return rd
  return summary.value?.rows ?? []
})

const isSummaryMode = computed(() => {
  const total = summary.value?.total_rows
  return total && total > rows.value.length
})

// ── 温度列检测 ────────────────────────────────────────────────
const findTempKey = (row) => {
  if (!row) return null
  for (const k of Object.keys(row)) {
    const clean = k.trim().replace(/^\ufeff/, '')
    if (['T/K', 'T(K)', 'Temperature', 'T', 'temperature_K'].includes(clean)) return k
  }
  return Object.keys(row).find(k => {
    const u = k.trim().toUpperCase()
    return (u === 'T' || u.startsWith('T/') || u.startsWith('T('))
      && !u.startsWith('F(') && !u.includes('J/')
  }) ?? null
}

const tempKey = computed(() => findTempKey(rows.value[0]) ?? 'T/K')

// ── 属性列定义 ────────────────────────────────────────────────
const PROP_DEFS = [
  {
    key: 'GM', label: 'G (J/mol)', yTitle: 'G (J/mol)',
    note: 'G 是系统摩尔 Gibbs 自由能（各相加权平均），值越负代表该状态越稳定。曲线斜率 = −S，可辅助判断相变驱动力。',
    colPatterns: ['GM'],
  },
  {
    key: 'HM', label: 'H (J/mol)', yTitle: 'H (J/mol)',
    note: 'H 是系统摩尔焓（各相加权平均）。ΔH 给出加热/冷却过程的热量需求，是铸造热模拟的输入参数之一。',
    colPatterns: ['HM'],
  },
  {
    key: 'SM', label: 'S (J/(mol·K))', yTitle: 'S (J/(mol·K))',
    note: 'S 是系统摩尔熵（各相加权平均）。液相熵通常高于固相，相变点处熵有突变，可辅助识别相变温度。',
    colPatterns: ['SM'],
  },
  {
    key: 'CPM', label: 'Cₚ (J/(mol·K))', yTitle: 'Cₚ (J/(mol·K))',
    note: 'Cₚ 是系统摩尔定压热容（各相加权平均）。可用于铸造仿真热物性输入，换算：Cₚ [J/(g·K)] = Cₚ [J/(mol·K)] ÷ 平均摩尔质量。',
    colPatterns: ['CPM'],
  },
]

const availableTabs = computed(() => {
  if (rows.value.length === 0) return PROP_DEFS
  const keys = Object.keys(rows.value[0] || {})
  return PROP_DEFS.filter(d => keys.some(k => d.colPatterns.some(p => k.includes(p))))
})

const safeActiveTab = computed(() => {
  const found = availableTabs.value.find(t => t.key === activeTab.value)
  return found ?? (availableTabs.value[0] ?? PROP_DEFS[0])
})

const activeUsageNote = computed(() => safeActiveTab.value?.note ?? null)

const getDataCols = (tabKey) => {
  const def = PROP_DEFS.find(d => d.key === tabKey)
  if (!def || rows.value.length === 0) return []
  const keys = Object.keys(rows.value[0] || {})
  return keys.filter(k =>
    def.colPatterns.some(p => k.includes(p))
    && k !== tempKey.value
    && k !== 'T/K' && k !== 'P/Pa'
  )
}

const visibleDataCols = computed(() => getDataCols(activeTab.value))

const beautifyColName = (col) => {
  const m = col.match(/\(([^)]+)\)/)
  if (m) return getPhaseDisplayName(m[1])
  return col.replace(/\/J\/mol.*/, '').replace('/J/', ' ').trim()
}

// ── 相系列切换状态 ─────────────────────────────────────────────
// 颜色板：扩展到 16 个以覆盖更多相
const COLORS = [
  '#1967d2', '#34a853', '#f97316', '#8b5cf6', '#ea4335',
  '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#64748b',
  '#ef4444', '#3b82f6', '#84cc16', '#d946ef', '#f43f5e', '#0ea5e9',
]

const allSeriesNames = computed(() =>
  visibleDataCols.value.map(col => beautifyColName(col))
)

// reactive map: seriesName → true/false（true = 显示）
const seriesVisibility = reactive({})

watch(allSeriesNames, (names) => {
  names.forEach(n => {
    if (!(n in seriesVisibility)) seriesVisibility[n] = true
  })
}, { immediate: true })

const isSeriesVisible = (name) => seriesVisibility[name] !== false

const toggleSeries = (name) => {
  seriesVisibility[name] = !isSeriesVisible(name)
  renderChart()
}

const toggleAll = (val) => {
  allSeriesNames.value.forEach(n => { seriesVisibility[n] = val })
  renderChart()
}

const isolateSeries = (name) => {
  allSeriesNames.value.forEach(n => { seriesVisibility[n] = (n === name) })
  renderChart()
}

// ── 图表工具 ─────────────────────────────────────────────────
const activateTool = (mode) => {
  dragMode.value = mode
  if (chartRef.value) {
    Plotly.relayout(chartRef.value, { dragmode: mode })
  }
}

const resetZoom = () => {
  if (chartRef.value) {
    Plotly.relayout(chartRef.value, { 'xaxis.autorange': true, 'yaxis.autorange': true })
  }
}

// ── 摘要极值 ─────────────────────────────────────────────────
const extremaSummary = computed(() => {
  const ext = payload.value?.derived_metrics?.property_extrema ?? {}
  return PROP_DEFS.map(d => {
    const extKey = Object.keys(ext).find(k => {
      const ku = k.toUpperCase()
      return ku.startsWith(d.key) && (ku[d.key.length] === '/' || ku[d.key.length] === '(')
    })
    if (extKey) {
      const e = ext[extKey]
      const mn = Number(e.min?.value ?? e.min ?? 0)
      const mx = Number(e.max?.value ?? e.max ?? 0)
      if (Math.abs(mx - mn) > 0.001) {
        return { key: d.key, label: d.label, range: `${fmtSci(mn)} ~ ${fmtSci(mx)}` }
      }
    }
    if (rows.value.length === 0) return null
    const dataColsForKey = getDataCols(d.key)
    if (dataColsForKey.length === 0) return null
    let mn = Infinity, mx = -Infinity
    for (const row of rows.value) {
      for (const col of dataColsForKey) {
        const v = Number(row[col])
        if (!Number.isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v }
      }
    }
    if (mn === Infinity) return null
    return { key: d.key, label: d.label, range: `${fmtSci(mn)} ~ ${fmtSci(mx)}` }
  }).filter(Boolean).slice(0, 3)
})

const tRange = computed(() => {
  if (rows.value.length > 0) {
    const key = tempKey.value
    const temps = rows.value.map(r => Number(r[key])).filter(v => !Number.isNaN(v) && v > 0)
    if (temps.length > 0) return `${Math.min(...temps).toFixed(0)}–${Math.max(...temps).toFixed(0)} K`
  }
  const tr = summary.value?.temperature_range
  if (tr) {
    const s = tr.start_K ?? tr.start, e = tr.end_K ?? tr.end
    if (s && e) return `${Number(s).toFixed(0)}–${Number(e).toFixed(0)} K`
  }
  return '—'
})

const fmtSci = (v) => {
  if (v === undefined || v === null) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return n.toFixed(3)
}

const fmtNum = (v) => {
  if (v === undefined || v === null) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  if (Math.abs(n) >= 10000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
  if (Math.abs(n) >= 100) return n.toFixed(2)
  return n.toFixed(4)
}

// ── Plotly 渲染 ─────────────────────────────────────────────
const renderChart = () => {
  if (!chartRef.value || rows.value.length === 0) return

  const def = safeActiveTab.value
  const dataCols = getDataCols(def.key)
  if (dataCols.length === 0) return

  const tKey = tempKey.value

  const traces = dataCols.map((col, idx) => {
    const name = beautifyColName(col)
    const visible = isSeriesVisible(name)
    const xVals = rows.value.map(r => Number(r[tKey])).filter(v => !Number.isNaN(v) && v > 0)
    const yVals = rows.value
      .filter(r => !Number.isNaN(Number(r[tKey])) && Number(r[tKey]) > 0)
      .map(r => Number(r[col]))

    return {
      x: xVals,
      y: yVals,
      name,
      type: 'scatter',
      mode: xVals.length <= 30 ? 'lines+markers' : 'lines',
      visible: visible ? true : 'legendonly',
      marker: { size: 4 },
      line: { color: COLORS[idx % COLORS.length], width: 2 },
      connectgaps: true,
      hovertemplate: `<b>${name}</b><br>T = %{x:.0f} K<br>${def.yTitle} = %{y:,.2f}<extra></extra>`,
    }
  })

  const yVals = traces.filter(t => t.visible !== 'legendonly').flatMap(t => t.y).filter(v => !Number.isNaN(v))
  const yRange = yVals.length > 0 ? [Math.min(...yVals), Math.max(...yVals)] : undefined
  const absMax = yRange ? Math.max(Math.abs(yRange[0]), Math.abs(yRange[1])) : 0

  const tickformat = absMax >= 10000 ? ',.0f'
                   : absMax >= 1000  ? ',.1f'
                   : absMax >= 10    ? '.2f'
                   : '.4f'

  Plotly.newPlot(chartRef.value, traces, {
    margin: { l: 72, r: 24, t: 12, b: 52 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'rgba(248,250,252,0.5)',
    font: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#475569' },
    dragmode: dragMode.value,
    xaxis: {
      title: { text: '温度 T (K)', font: { size: 11 }, standoff: 8 },
      gridcolor: '#e2e8f0', linecolor: '#cbd5e1', zeroline: false,
      tickfont: { size: 10 }, tickcolor: '#cbd5e1',
    },
    yaxis: {
      title: { text: def.yTitle, font: { size: 11 }, standoff: 6 },
      gridcolor: '#e2e8f0', linecolor: '#cbd5e1', zeroline: false,
      tickfont: { size: 10 }, tickformat, exponentformat: 'none',
    },
    showlegend: false,   // 图例由外部芯片面板接管
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: 'rgba(255,255,255,0.95)',
      bordercolor: '#e2e8f0',
      font: { size: 12 },
    },
  }, {
    responsive: true,
    displayModeBar: false,  // 使用自定义工具栏
    scrollZoom: true,
  })
}

onMounted(renderChart)
watch([() => props.data, activeTab], () => {
  // Tab 切换时重置系列可见性
  allSeriesNames.value.forEach(n => { seriesVisibility[n] = true })
  renderChart()
}, { deep: true })
</script>

<style scoped>
.thermo-chart { background: transparent; padding: 0; }

/* ── 条件行 ── */
.condition-bar {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e2e8f0);
}
.cond-item { display: flex; flex-direction: column; }
.cond-label { font-size: 10px; color: var(--text-tertiary, #94a3b8); margin-bottom: 1px; }
.cond-value { font-size: 13px; font-weight: 600; color: var(--text-primary, #0f172a); font-variant-numeric: tabular-nums; }
.cond-value.small { font-size: 11px; }

/* ── 工具栏（Tab + 缩放按钮） ── */
.chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 8px;
}
.prop-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.prop-tab {
  padding: 4px 12px; font-size: 12px; font-weight: 500;
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 4px;
  background: var(--bg-secondary, #f8fafc);
  color: var(--text-secondary, #64748b);
  cursor: pointer; transition: all 0.15s;
}
.prop-tab:hover { border-color: var(--primary, #1967d2); color: var(--primary, #1967d2); }
.prop-tab.active { background: var(--primary, #1967d2); color: #fff; border-color: var(--primary, #1967d2); }

.toolbar-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.toolbar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 4px;
  background: var(--bg-secondary, #f8fafc);
  color: var(--text-tertiary, #94a3b8);
  cursor: pointer;
  transition: all 0.15s;
}
.toolbar-btn:hover {
  border-color: var(--primary, #1967d2);
  color: var(--primary, #1967d2);
  background: #eff6ff;
}

/* ── 图表 ── */
.chart-canvas { width: 100%; height: 340px; }

/* ── 相系列切换面板 ── */
.series-panel {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--bg-secondary, #f8fafc);
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 6px;
}
.series-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.series-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #475569);
  flex: 1;
}
.series-ctrl {
  font-size: 11px;
  color: var(--primary, #1967d2);
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 3px;
  transition: background 0.1s;
}
.series-ctrl:hover { background: #eff6ff; }

.series-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.series-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 5px;
  border-radius: 12px;
  border: 1px solid var(--border-light, #e2e8f0);
  background: #fff;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}
.series-chip:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}
.series-chip.hidden {
  opacity: 0.4;
  background: #f8fafc;
  color: var(--text-tertiary, #94a3b8);
}

.chip-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.chip-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-hint {
  margin-top: 5px;
  font-size: 10px;
  color: var(--text-tertiary, #94a3b8);
}

/* ── 数据模式说明 ── */
.data-note {
  display: flex; align-items: center; gap: 4px;
  margin-top: 6px; font-size: 10px; color: var(--text-tertiary, #94a3b8);
}

/* ── 工程意义说明 ── */
.usage-block {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 8px 10px; margin-top: 8px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 11px; color: #1e40af; line-height: 1.5;
}
.usage-icon { color: var(--primary, #1967d2); flex-shrink: 0; margin-top: 1px; }

/* ── 数据表格 ── */
.data-table-wrap { margin-top: 10px; }
.table-toggle {
  font-size: 11px; color: var(--text-secondary, #64748b);
  cursor: pointer; padding: 4px 0; user-select: none;
}
.table-toggle:hover { color: var(--primary, #1967d2); }
.table-scroll { overflow-x: auto; margin-top: 6px; max-height: 220px; overflow-y: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.data-table th, .data-table td {
  padding: 4px 8px;
  border: 1px solid var(--border-light, #e2e8f0);
  text-align: right; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.data-table th:first-child, .data-table td:first-child { text-align: left; }
.data-table th {
  background: var(--bg-secondary, #f8fafc);
  font-weight: 600; position: sticky; top: 0;
  color: var(--text-secondary, #475569);
}
.data-table tr:hover td { background: #f8fafc; }
</style>
