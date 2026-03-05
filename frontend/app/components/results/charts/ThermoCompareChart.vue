<template>
  <div class="chart-container">
    <h4 class="chart-title">关键温度对比 (K)</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * 热力学关键温度对比图组件
 * 展示液相线和固相线温度对比
 */
import { ref, onMounted, watch } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  data: {
    type: Array,
    required: true
    // 格式: [{ composition: string, liquidus: number, solidus?: number }]
  }
})

const chartRef = ref(null)

const renderChart = () => {
  if (!chartRef.value || !props.data || props.data.length === 0) return

  const compositions = props.data.map(d => d.composition)

  const traces = [
    {
      x: compositions,
      y: props.data.map(d => d.liquidus),
      name: '液相线',
      type: 'bar',
      marker: { color: '#dc2626', line: { width: 0 } }
    },
    {
      x: compositions,
      y: props.data.map(d => d.solidus || 0),
      name: '固相线',
      type: 'bar',
      marker: { color: '#2563eb', line: { width: 0 } }
    }
  ]

  const layout = {
    barmode: 'group',
    margin: { l: 50, r: 30, t: 20, b: 50 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
    xaxis: {
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      tickfont: { size: 11 }
    },
    yaxis: {
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
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

watch(() => props.data, () => {
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
  height: 200px;
}
</style>
