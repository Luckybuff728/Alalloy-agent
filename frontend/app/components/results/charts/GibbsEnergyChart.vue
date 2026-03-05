<template>
  <div class="chart-container">
    <h4 class="chart-title">{{ title }}</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * 吉布斯能-温度曲线图组件
 * 支持单合金多相 / 多合金主相对比
 */
import { ref, onMounted, watch, computed } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  // 单合金数据：[{ temperature: number, [phase: string]: number }]
  data: {
    type: Array,
    default: () => []
  },
  phases: {
    type: Array,
    default: () => []
  },
  // 多合金数据：[{ composition: string, data: GibbsData[], phases: string[] }]
  multiData: {
    type: Array,
    default: () => []
  },
  title: {
    type: String,
    default: '吉布斯能-温度曲线'
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

const isMulti = computed(() => props.multiData && props.multiData.length > 0)

const renderChart = () => {
  if (!chartRef.value) return

  let traces = []

  if (isMulti.value) {
    // 多合金模式：每个合金的主要相（通常是第一个相）
    props.multiData.forEach((alloy, idx) => {
      const mainPhase = alloy.phases[0]
      if (!mainPhase) return

      const sampledData = sampleData(alloy.data, 100)

      traces.push({
        x: sampledData.map(d => d.temperature),
        y: sampledData.map(d => d[mainPhase]),
        name: alloy.composition,
        type: 'scatter',
        mode: 'lines',
        line: { color: COLORS[idx % COLORS.length], width: 2 },
        connectgaps: true
      })
    })
  } else if (props.data && props.data.length > 0 && props.phases && props.phases.length > 0) {
    // 单合金模式：所有相
    const sampledData = sampleData(props.data, 100)

    traces = props.phases.map((phase, idx) => ({
      x: sampledData.map(d => d.temperature),
      y: sampledData.map(d => d[phase]),
      name: phase,
      type: 'scatter',
      mode: 'lines',
      line: { color: COLORS[idx % COLORS.length], width: 2 }
    }))
  }

  if (traces.length === 0) return

  const layout = {
    margin: { l: 70, r: 30, t: 40, b: 60 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
    xaxis: {
      title: { text: '温度 (K)', font: { size: 11 } },
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      tickfont: { size: 10 }
    },
    yaxis: {
      title: { text: 'G (J/mol)', font: { size: 11 } },
      gridcolor: '#e8eaed',
      linecolor: '#dadce0',
      tickfont: { size: 10 },
      tickformat: '.2s'
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

watch(() => [props.data, props.phases, props.multiData], () => {
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
