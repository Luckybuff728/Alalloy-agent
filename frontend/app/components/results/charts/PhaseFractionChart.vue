<template>
  <div class="chart-container">
    <!-- 条件信息栏（温度范围 + 相数） -->
    <div class="meta-bar" v-if="tempRange.min > 0">
      <div class="meta-item">
        <span class="meta-label">温度范围</span>
        <span class="meta-val">{{ tempRange.min.toFixed(0) }}–{{ tempRange.max.toFixed(0) }} K</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">相数</span>
        <span class="meta-val">{{ phases.length }}</span>
      </div>
      <div class="meta-item" v-if="hasLiquid">
        <span class="meta-label">液相线（近似）</span>
        <span class="meta-val">{{ liquidusApprox }} K</span>
      </div>
    </div>

    <h4 class="chart-title">{{ title }}</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * 相分数-温度曲线图组件（line_calculation 平衡冷却路径）
 * 展示不同相随温度的变化，X 轴反向（高温→低温，符合冶金惯例）
 */
import { ref, onMounted, watch, computed } from 'vue'
import Plotly from 'plotly.js-dist-min'
import { getPhaseDisplayName } from '~/utils/phaseNames'

const props = defineProps({
  data: {
    type: Array,
    required: true
    // 格式: [{ temperature: number, [phase: string]: number }]
  },
  phases: {
    type: Array,
    required: true
    // 相名称列表: ['FCC_A1', 'LIQUID', ...]（原始 CALPHAD 名）
  },
  title: {
    type: String,
    default: '相分数-温度曲线（平衡冷却）'
  }
})

const chartRef = ref(null)

// 扩展到 12 色，覆盖 Al-Si-Mg-Fe-Mn 体系最多 16 个激活相
const COLORS = [
  '#1967d2', '#34a853', '#f9ab00', '#ea4335',
  '#8b5cf6', '#06b6d4', '#f97316', '#14b8a6',
  '#0284c7', '#65a30d', '#c026d3', '#be123c',
]

// 温度范围（从数据中提取）
const tempRange = computed(() => {
  if (!props.data || props.data.length === 0) return { min: 0, max: 0 }
  const temps = props.data.map(d => d.temperature).filter(v => v > 0)
  return { min: Math.min(...temps), max: Math.max(...temps) }
})

// 判断是否有液相，并计算液相线近似（液相分数开始 < 1.0 的温度）
const hasLiquid = computed(() => props.phases.includes('LIQUID'))
const liquidusApprox = computed(() => {
  if (!hasLiquid.value || !props.data || props.data.length === 0) return '—'
  // 从高温向低温扫，找到第一个 f(LIQUID) < 1.0 的温度（液相线）
  const sorted = [...props.data].sort((a, b) => b.temperature - a.temperature)
  for (const row of sorted) {
    const lf = row['LIQUID'] ?? 0
    if (lf < 0.999) return row.temperature.toFixed(0)
  }
  return '—'
})

// 数据采样函数
const sampleData = (data, maxPoints = 100) => {
  if (data.length <= maxPoints) return data
  
  const result = []
  const step = (data.length - 1) / (maxPoints - 1)
  
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step)
    result.push(data[idx])
  }
  
  return result
}

const renderChart = () => {
  if (!chartRef.value || !props.data || props.data.length === 0 || !props.phases || props.phases.length === 0) return

  const sampledData = sampleData(props.data, 100)

  const traces = props.phases.map((phase, idx) => ({
    x: sampledData.map(d => d.temperature),
    y: sampledData.map(d => d[phase] || 0),
    name: getPhaseDisplayName(phase),   // 美化相名
    type: 'scatter',
    mode: 'lines',
    line: { color: COLORS[idx % COLORS.length], width: 2 },
    hovertemplate: `%{x:.1f} K  ${getPhaseDisplayName(phase)}: %{y:.4f}<extra></extra>`
  }))

  const layout = {
    margin: { l: 60, r: 30, t: 40, b: 60 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
    xaxis: {
      title: { text: '温度 T (K)', font: { size: 11 } },
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      autorange: 'reversed',   // 降温方向
      tickfont: { size: 10 }
    },
    yaxis: {
      title: { text: '相分数 f', font: { size: 11 } },
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      range: [0, 1.05],
      tickformat: '.0%',
      tickfont: { size: 11 }
    },
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: 1.18,
      font: { size: 11 }
    },
    hovermode: 'x unified'
  }

  const config = {
    responsive: true,
    displayModeBar: false
  }

  Plotly.newPlot(chartRef.value, traces, layout, config)
}

onMounted(() => {
  renderChart()
})

watch(() => [props.data, props.phases], () => {
  renderChart()
}, { deep: true })
</script>

<style scoped>
.chart-container { background: transparent; padding: 0; border: none; }

/* 条件信息栏 */
.meta-bar {
  display: flex; gap: 8px; margin-bottom: 8px;
  padding: 7px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e2e8f0);
}
.meta-item { display: flex; flex-direction: column; }
.meta-label { font-size: 10px; color: var(--text-tertiary, #94a3b8); margin-bottom: 1px; }
.meta-val { font-size: 12px; font-weight: 600; color: var(--text-primary, #0f172a); font-variant-numeric: tabular-nums; }

.chart-title {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.chart-canvas {
  width: 100%;
  height: 300px;
}
</style>
