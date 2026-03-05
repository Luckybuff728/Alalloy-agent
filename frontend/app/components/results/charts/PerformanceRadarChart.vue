<template>
  <div class="chart-container">
    <h4 class="chart-title">多维性能对比 (雷达图)</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * 性能雷达图组件
 * 多维度展示合金性能对比
 */
import { ref, onMounted, watch } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  data: {
    type: Array,
    required: true
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

const PROPERTY_LABELS = {
  tensile_strength: '抗拉强度',
  yield_strength: '屈服强度',
  elongation: '延伸率'
}

const renderChart = () => {
  if (!chartRef.value || !props.data || props.data.length === 0) return

  // 计算归一化值
  const properties = ['tensile_strength', 'yield_strength', 'elongation']
  const maxValues = {}
  
  properties.forEach(prop => {
    maxValues[prop] = Math.max(...props.data.map(d => d[prop] || 0), 1)
  })

  // 为每个合金创建一个 trace
  const traces = props.data.map((item, idx) => {
    const values = properties.map(prop => {
      const value = item[prop] || 0
      return Math.round((value / maxValues[prop]) * 100)
    })

    return {
      type: 'scatterpolar',
      r: [...values, values[0]], // 闭合雷达图
      theta: [...properties.map(p => PROPERTY_LABELS[p]), PROPERTY_LABELS[properties[0]]],
      fill: 'toself',
      name: item.composition,
      line: { color: COLORS[idx % COLORS.length], width: 2 },
      marker: { color: COLORS[idx % COLORS.length], size: 4 },
      fillcolor: COLORS[idx % COLORS.length],
      opacity: 0.6
    }
  })

  const layout = {
    polar: {
      radialaxis: {
        visible: true,
        range: [0, 100],
        gridcolor: '#e8eaed',
        tickfont: { size: 10, color: '#9aa0a6' }
      },
      angularaxis: {
        gridcolor: '#e8eaed',
        tickfont: { size: 11, color: '#5f6368' }
      }
    },
    margin: { l: 60, r: 60, t: 40, b: 40 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12 },
    legend: {
      orientation: 'h',
      x: 0.5,
      xanchor: 'center',
      y: -0.15,
      font: { size: 11 }
    },
    showlegend: true
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
  height: 300px;
}
</style>
