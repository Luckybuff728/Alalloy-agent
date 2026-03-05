<template>
  <div class="chart-container">
    <h4 class="chart-title">性能对比 (柱状图)</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * 性能柱状图组件
 * 使用 Plotly.js 展示合金性能对比
 */
import { ref, onMounted, watch } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  data: {
    type: Array,
    required: true,
    // 格式: [{ composition: string, tensile_strength?: number, yield_strength?: number, elongation?: number }]
  }
})

const chartRef = ref(null)

// 颜色配置（与旧项目保持一致）
const COLORS = {
  tensile_strength: '#1967d2',
  yield_strength: '#34a853',
  elongation: '#f9ab00'
}

const renderChart = () => {
  if (!chartRef.value || !props.data || props.data.length === 0) return

  // 准备数据
  const compositions = props.data.map(d => d.composition)
  
  const traces = [
    {
      x: compositions,
      y: props.data.map(d => d.tensile_strength || 0),
      name: '抗拉强度',
      type: 'bar',
      marker: { color: COLORS.tensile_strength, line: { width: 0 } }
    },
    {
      x: compositions,
      y: props.data.map(d => d.yield_strength || 0),
      name: '屈服强度',
      type: 'bar',
      marker: { color: COLORS.yield_strength, line: { width: 0 } }
    },
    {
      x: compositions,
      y: props.data.map(d => (d.elongation || 0) * 10),
      name: '延伸率 (×10)',
      type: 'bar',
      marker: { color: COLORS.elongation, line: { width: 0 } }
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
  height: 280px;
}
</style>
