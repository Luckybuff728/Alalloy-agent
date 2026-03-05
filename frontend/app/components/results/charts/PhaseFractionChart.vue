<template>
  <div class="chart-container">
    <h4 class="chart-title">{{ title }}</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * 相分数-温度曲线图组件
 * 展示不同相随温度的变化
 */
import { ref, onMounted, watch } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  data: {
    type: Array,
    required: true
    // 格式: [{ temperature: number, [phase: string]: number }]
  },
  phases: {
    type: Array,
    required: true
    // 相名称列表: ['Fcc', 'Bcc', ...]
  },
  title: {
    type: String,
    default: '相分数-温度曲线'
  }
})

const chartRef = ref(null)

const COLORS = [
  '#1967d2',
  '#34a853',
  '#f9ab00',
  '#8b5cf6',
  '#ea4335',
  '#4285f4'
]

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
    name: phase,
    type: 'scatter',
    mode: 'lines',
    line: { color: COLORS[idx % COLORS.length], width: 2 }
  }))

  const layout = {
    margin: { l: 60, r: 30, t: 40, b: 60 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
    xaxis: {
      title: { text: '温度 (K)', font: { size: 11 } },
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      autorange: 'reversed',
      tickfont: { size: 10 }
    },
    yaxis: {
      title: { text: '相分数', font: { size: 11 } },
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      range: [0, 1],
      tickformat: '.0%',
      tickfont: { size: 11 }
    },
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: 1.15,
      font: { size: 11 }
    },
    hovermode: 'closest'
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
.chart-container {
  /* 移除内层独立卡片样式，由外层 result-card 统一控制 */
  background: transparent;
  padding: 0;
  border: none;
}

.chart-title {
  margin: 0 0 16px 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.chart-canvas {
  width: 100%;
  height: 280px;
}
</style>
