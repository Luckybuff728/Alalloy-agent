<template>
  <div class="chart-container">
    <h4 class="chart-title">{{ title }}</h4>

    <!-- 关键温度信息行 -->
    <div class="thermo-metrics" v-if="keyMetrics">
      <div v-for="m in keyMetrics" :key="m.label" class="metric-chip">
        <span class="chip-label">{{ m.label }}</span>
        <span class="chip-val">{{ m.value }}</span>
      </div>
    </div>

    <div ref="chartRef" class="chart-canvas"></div>

    <!-- 数据来源说明 -->
    <div class="data-mode-hint" v-if="dataMode">
      <el-icon :size="10"><InformationCircleOutline /></el-icon>
      <span>{{ dataMode }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import Plotly from 'plotly.js-dist-min'
import { ElIcon } from 'element-plus'
import { InformationCircleOutline } from '@vicons/ionicons5'
import { getPhaseDisplayName } from '~/utils/phaseNames'

const props = defineProps({
  /** 单合金数据：[{ temperature, liquid, solid }] */
  data: { type: Array, default: () => [] },
  /** 多合金数据：[{ composition, data: [{temperature, liquid, solid}] }] */
  multiData: { type: Array, default: () => [] },
  /** 完整 CalphaMesh 结果对象（含 derived_metrics 等） */
  rawResult: { type: Object, default: null },
  title: { type: String, default: 'Scheil 非平衡凝固曲线' }
})

const chartRef = ref(null)

const COLORS = ['#1967d2','#34a853','#f9ab00','#8b5cf6','#ea4335','#4285f4']

const isMulti = computed(() => props.multiData && props.multiData.length > 0)

// 关键热力学指标
const keyMetrics = computed(() => {
  const dm = props.rawResult?.result?.derived_metrics
    ?? props.rawResult?.derived_metrics
    ?? null
  const ds = props.rawResult?.result?.data_summary
    ?? props.rawResult?.data_summary
    ?? null

  if (!dm && !ds) return null

  const liquidus = ds?.temperature_range?.liquidus_K
  const solidus  = ds?.temperature_range?.solidus_K
  const freezing = dm?.freezing_range_K

  const items = []
  // liquidus 在 Scheil 结果中 = start_temperature（用户设置），是液相线的近似上界
  if (liquidus) items.push({ label: '起始温度（≈液相线）', value: `${Number(liquidus).toFixed(1)} K (${(Number(liquidus)-273.15).toFixed(0)} °C)` })
  // solidus = 最终凝固温度（Scheil 语义：最后一点液相消失的温度，即共晶或最低终凝温度）
  if (solidus)  items.push({ label: '终凝温度（Scheil 固相线）', value: `${Number(solidus).toFixed(1)} K (${(Number(solidus)-273.15).toFixed(0)} °C)` })
  if (freezing) items.push({ label: '凝固范围 ΔT', value: `${Number(freezing).toFixed(1)} K`, warn: Number(freezing) > 100 })
  if (ds?.total_steps) items.push({ label: '模拟步数', value: `${ds.total_steps} 步` })
  return items.length > 0 ? items : null
})

// 数据模式说明
const dataMode = computed(() => {
  const ds = props.rawResult?.result?.data_summary
  if (!ds) return null
  const total = ds.total_steps ?? 0
  const shown = props.data?.length ?? props.multiData?.[0]?.data?.length ?? 0
  if (total > 0 && shown > 0 && shown < total) {
    return `均匀采样：从 ${total} 步中展示 ${shown} 个代表性数据点（覆盖完整凝固区间）。调用 result_mode="full" 可获取全部 ${total} 步数据。`
  }
  return null
})

const sampleData = (data, maxPoints = 150) => {
  if (!data || data.length <= maxPoints) return data
  const result = []
  const step = (data.length - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints; i++) result.push(data[Math.round(i * step)])
  return result
}

const renderChart = () => {
  if (!chartRef.value) return

  let traces = []

  if (isMulti.value) {
    props.multiData.forEach((alloy, idx) => {
      const sampled = sampleData(alloy.data, 150)
      // 液相线（实线）
      traces.push({
        x: sampled.map(d => d.temperature),
        y: sampled.map(d => d.liquid),
        name: `${alloy.composition}（液相）`,
        type: 'scatter', mode: 'lines',
        line: { color: COLORS[idx % COLORS.length], width: 2, dash: 'solid' },
        connectgaps: true
      })
    })
  } else if (props.data && props.data.length > 0) {
    const sampled = sampleData(props.data, 150)
    traces = [
      {
        x: sampled.map(d => d.temperature),
        y: sampled.map(d => d.liquid),
        name: '液相分数 f(LIQUID)',
        type: 'scatter', mode: 'lines',
        line: { color: COLORS[0], width: 2.5 },
        fill: 'tozeroy', fillcolor: 'rgba(25,103,210,0.08)',
        hovertemplate: '%{x:.1f} K<br>液相 %{y:.3f}<extra></extra>',
      },
      {
        x: sampled.map(d => d.temperature),
        y: sampled.map(d => d.solid),
        name: '固相分数（累计）',
        type: 'scatter', mode: 'lines',
        line: { color: COLORS[1], width: 2, dash: 'dot' },
        hovertemplate: '%{x:.1f} K<br>固相 %{y:.3f}<extra></extra>',
      }
    ]
  }

  if (traces.length === 0) return

  // 液相线/固相线参考线
  const shapes = []
  const annotations = []
  const dm = props.rawResult?.result?.derived_metrics ?? props.rawResult?.derived_metrics
  const ds = props.rawResult?.result?.data_summary ?? props.rawResult?.data_summary

  if (ds?.temperature_range) {
    const liq = ds.temperature_range.liquidus_K
    const sol = ds.temperature_range.solidus_K
    if (liq) {
      shapes.push({
        type: 'line', x0: liq, x1: liq, y0: 0, y1: 1,
        xref: 'x', yref: 'paper',
        line: { color: '#dc2626', width: 1, dash: 'dot' }
      })
      annotations.push({
        x: liq, y: 0.98, xref: 'x', yref: 'paper',
        // "起始温度 ≈ 液相线"：Scheil start_temperature 是用户设置的，是液相线上界近似
        text: `T<sub>start</sub> ${Number(liq).toFixed(0)} K`,
        showarrow: false, font: { size: 10, color: '#dc2626' },
        xanchor: 'right', bgcolor: 'rgba(255,255,255,0.8)'
      })
    }
    if (sol) {
      shapes.push({
        type: 'line', x0: sol, x1: sol, y0: 0, y1: 1,
        xref: 'x', yref: 'paper',
        line: { color: '#2563eb', width: 1, dash: 'dot' }
      })
      annotations.push({
        x: sol, y: 0.98, xref: 'x', yref: 'paper',
        // Scheil 终凝温度（≠ 平衡固相线，是最后液相消失温度）
        text: `T<sub>f</sub> ${Number(sol).toFixed(0)} K`,
        showarrow: false, font: { size: 10, color: '#2563eb' },
        xanchor: 'left', bgcolor: 'rgba(255,255,255,0.8)'
      })
    }
  }

  // 50% 固相参考线
  shapes.push({
    type: 'line', x0: 0, x1: 1, y0: 0.5, y1: 0.5,
    xref: 'paper', yref: 'y',
    line: { color: '#9ca3af', width: 1, dash: 'dash' }
  })
  annotations.push({
    x: 1, y: 0.5, xref: 'paper', yref: 'y',
    text: '50%',
    showarrow: false, font: { size: 10, color: '#9ca3af' },
    xanchor: 'right', yanchor: 'bottom'
  })

  Plotly.newPlot(chartRef.value, traces, {
    margin: { l: 60, r: 20, t: 15, b: 60 },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
    xaxis: {
      // X 轴反向：高温在左（液态）→ 低温在右（固态），符合冶金学凝固曲线标准方向
      title: { text: '温度 T (K)   ←  降温方向（冷却）', font: { size: 11 } },
      gridcolor: '#e8eaed', linecolor: '#dadce0',
      autorange: 'reversed',
      tickfont: { size: 10 }
    },
    yaxis: {
      title: { text: '相分数', font: { size: 11 } },
      gridcolor: '#e8eaed', linecolor: '#dadce0',
      range: [0, 1.01],
      tickformat: '.0%',
      tickfont: { size: 11 }
    },
    legend: {
      orientation: 'h', x: 0.5, xanchor: 'center', y: 1.18,
      font: { size: 11 }
    },
    hovermode: 'x unified',
    shapes,
    annotations,
  }, { responsive: true, displayModeBar: false })
}

onMounted(renderChart)
watch(() => [props.data, props.multiData, props.rawResult], renderChart, { deep: true })
</script>

<style scoped>
.chart-container { background: transparent; padding: 0; border: none; }

.chart-title {
  margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: var(--text-primary);
}

/* 关键指标行 */
.thermo-metrics {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;
}
.metric-chip {
  display: flex; flex-direction: column; align-items: center;
  padding: 5px 10px; border-radius: 6px;
  background: var(--bg-secondary,#f8fafc);
  border: 1px solid var(--border-light,#e2e8f0);
}
.chip-label { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
.chip-val { font-size: 12px; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; }

.chart-canvas { width: 100%; height: 300px; }

.data-mode-hint {
  display: flex; align-items: center; gap: 4px;
  margin-top: 4px; font-size: 10px; color: #94a3b8;
}
</style>
