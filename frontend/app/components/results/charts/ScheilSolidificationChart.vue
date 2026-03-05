<template>
  <div class="chart-container">
    <h4 class="chart-title">{{ title }}</h4>
    <div ref="chartRef" class="chart-canvas"></div>
  </div>
</template>

<script setup>
/**
 * Scheil 凝固曲线图组件
 * 支持单合金和多合金对比模式
 */
import { ref, onMounted, watch, computed } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  // 单合金数据：[{ temperature: number, liquid: number, solid: number }]
  data: {
    type: Array,
    default: () => []
  },
  // 多合金数据：[{ composition: string, data: ScheilData[] }]
  multiData: {
    type: Array,
    default: () => []
  },
  title: {
    type: String,
    default: 'Scheil 凝固曲线'
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

// 数据采样函数（限制最大点数提升性能）
const sampleData = (data, maxPoints = 120) => {
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
    // 多合金模式：每个合金一条固相线
    props.multiData.forEach((alloy, idx) => {
      const sampledData = sampleData(alloy.data, 120)
      
      traces.push({
        x: sampledData.map(d => d.temperature),
        y: sampledData.map(d => d.solid),
        name: `${alloy.composition} 固相`,
        type: 'scatter',
        mode: 'lines',
        line: { color: COLORS[idx % COLORS.length], width: 2 },
        connectgaps: true
      })
    })
  } else if (props.data && props.data.length > 0) {
    // 单合金模式：液相 + 固相
    const sampledData = sampleData(props.data, 120)
    
    traces = [
      {
        x: sampledData.map(d => d.temperature),
        y: sampledData.map(d => d.liquid),
        name: '液相',
        type: 'scatter',
        mode: 'lines',
        line: { color: COLORS[0], width: 2 }
      },
      {
        x: sampledData.map(d => d.temperature),
        y: sampledData.map(d => d.solid),
        name: '固相',
        type: 'scatter',
        mode: 'lines',
        line: { color: COLORS[1], width: 2 }
      }
    ]
  }

  if (traces.length === 0) return

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

watch(() => [props.data, props.multiData], () => {
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
