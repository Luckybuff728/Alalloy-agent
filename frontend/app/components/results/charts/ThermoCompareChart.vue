<template>
  <div class="chart-container">
    <h4 class="chart-title">关键温度对比</h4>
    <div ref="chartRef" class="chart-canvas"></div>
    <div class="legend-note">
      🔴 液相线 T_liquidus &nbsp;&nbsp; 🔵 固相线 T_solidus &nbsp;&nbsp;
      ⬛ 凝固范围 ΔT（右轴）
    </div>
  </div>
</template>

<script setup>
/**
 * 热力学关键温度多合金对比图
 * 主轴：液相线和固相线绝对温度（散点 + 误差棒显示范围）
 * 次轴：凝固范围 ΔT = T_liq - T_sol（越小越优）
 */
import { ref, onMounted, watch } from 'vue'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({
  // [{ composition, liquidus, solidus, freezing_range? }]
  data: { type: Array, required: true }
})

const chartRef = ref(null)

const renderChart = () => {
  if (!chartRef.value || !props.data || props.data.length === 0) return

  const comps = props.data.map(d => d.composition)
  const liquidus = props.data.map(d => d.liquidus ?? 0)
  const solidus  = props.data.map(d => d.solidus ?? 0)
  const freezing = props.data.map(d => d.freezing_range ?? (d.liquidus - d.solidus) ?? 0)

  const traces = [
    // 液相线
    {
      x: comps, y: liquidus,
      name: 'T_液相线 (K)',
      type: 'scatter', mode: 'markers+lines',
      marker: { color: '#dc2626', size: 9, symbol: 'circle' },
      line: { color: '#dc2626', width: 1.5, dash: 'dot' },
      yaxis: 'y1',
      hovertemplate: '%{x}<br>T_liq: %{y:.1f} K (%{customdata:.0f} °C)<extra>液相线</extra>',
      customdata: liquidus.map(v => v - 273.15),
    },
    // 固相线
    {
      x: comps, y: solidus,
      name: 'T_固相线 (K)',
      type: 'scatter', mode: 'markers+lines',
      marker: { color: '#2563eb', size: 9, symbol: 'diamond' },
      line: { color: '#2563eb', width: 1.5, dash: 'dot' },
      yaxis: 'y1',
      hovertemplate: '%{x}<br>T_sol: %{y:.1f} K (%{customdata:.0f} °C)<extra>固相线</extra>',
      customdata: solidus.map(v => v - 273.15),
    },
    // 凝固范围（次轴柱状图）
    {
      x: comps, y: freezing,
      name: 'ΔT 凝固范围 (K)',
      type: 'bar',
      marker: { color: freezing.map(v => v > 100 ? 'rgba(239,68,68,0.5)' : 'rgba(100,116,139,0.3)') },
      yaxis: 'y2',
      hovertemplate: '%{x}<br>ΔT: %{y:.1f} K<extra>凝固范围</extra>',
    }
  ]

  const yMin = Math.min(...solidus) - 30
  const yMax = Math.max(...liquidus) + 30

  Plotly.newPlot(chartRef.value, traces, {
    barmode: 'overlay',
    margin: { l: 60, r: 55, t: 10, b: 60 },
    paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
    xaxis: { gridcolor: '#e8eaed', linecolor: '#dadce0', tickfont: { size: 10 } },
    yaxis: {
      title: { text: '温度 (K)', font: { size: 11 } },
      gridcolor: '#e8eaed', linecolor: '#dadce0',
      range: [yMin, yMax], tickfont: { size: 10 }
    },
    yaxis2: {
      title: { text: 'ΔT (K)', font: { size: 11 } },
      overlaying: 'y', side: 'right',
      showgrid: false, tickfont: { size: 10 },
      rangemode: 'tozero'
    },
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.18, font: { size: 11 } },
    hovermode: 'closest',
  }, { responsive: true, displayModeBar: false })
}

onMounted(renderChart)
watch(() => props.data, renderChart, { deep: true })
</script>

<style scoped>
.chart-container { background: transparent; padding: 0; border: none; }
.chart-title {
  margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: var(--text-primary);
}
.chart-canvas { width: 100%; height: 220px; }
.legend-note { margin-top: 4px; font-size: 10px; color: #94a3b8; text-align: center; }
</style>
