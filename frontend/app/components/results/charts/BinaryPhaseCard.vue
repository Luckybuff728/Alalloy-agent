<template>
  <div class="binary-card">

    <!-- 计算条件行（与 PointCalculationCard 相同结构） -->
    <div class="condition-bar">
      <div class="cond-item">
        <span class="cond-label">体系</span>
        <span class="cond-value">{{ systemLabel }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">稳定相数</span>
        <span class="cond-value accent">{{ phaseSummary.phase_count ?? '—' }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">相界线数</span>
        <span class="cond-value">{{ phaseSummary.boundary_count ?? '—' }}</span>
      </div>
    </div>

    <!-- 相图渲染区 -->
    <div class="section">
      <div class="section-title">平衡相图</div>

      <!-- 加载中 -->
      <div v-if="chartState === 'loading'" class="chart-placeholder loading">
        <div class="loading-spinner"></div>
        <span>正在加载相图数据…</span>
      </div>

      <!-- 渲染成功 -->
      <div ref="chartRef" class="chart-canvas" v-show="chartState === 'ready'"></div>

      <!-- PNG 图片（备用） -->
      <div v-if="chartState === 'image' && imageSrc" class="img-wrap">
        <img :src="imageSrc" alt="二元平衡相图" class="phase-image"
          @error="imageError = true" @load="imageLoaded = true"
        />
      </div>

      <!-- 无数据提示 -->
      <div v-if="chartState === 'unavailable'" class="chart-placeholder">
        <el-icon :size="28" color="#cbd5e1"><StatsChartOutline /></el-icon>
        <p>相图数据文件可通过下方链接下载，在 Python/Plotly 中渲染查看。</p>
      </div>
    </div>

    <!-- 文件链接 -->
    <div class="section" v-if="fileLinks.length > 0">
      <div class="section-title">计算结果文件</div>
      <div class="file-list">
        <a v-for="f in fileLinks" :key="f.name" :href="f.url" target="_blank" class="file-link">
          <el-icon :size="14" class="file-type-icon"><component :is="f.icon" /></el-icon>
          <span class="file-name">{{ f.name }}</span>
          <span class="file-hint">{{ f.hint }}</span>
          <el-icon :size="12" class="open-icon"><OpenOutline /></el-icon>
        </a>
      </div>
    </div>

    <div class="card-footer">
      <el-icon :size="12"><InformationCircleOutline /></el-icon>
      <span>二元平衡相图（Calphad 方法）。binary_equilibrium.json 包含完整 Plotly 图形数据，可在 Python/Plotly 中直接渲染。</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElIcon } from 'element-plus'
import {
  InformationCircleOutline,
  DocumentTextOutline,
  ImageOutline,
  StatsChartOutline,
  OpenOutline,
  DocumentOutline,
} from '@vicons/ionicons5'
import Plotly from 'plotly.js-dist-min'

const props = defineProps({ data: { type: Object, required: true } })

const chartRef = ref(null)
const chartState = ref('loading')   // loading | ready | image | unavailable
const imageError = ref(false)
const imageLoaded = ref(false)

const payload = computed(() => props.data?.result ?? props.data ?? {})
const phaseSummary = computed(() => payload.value?.data_summary ?? {})

const systemLabel = computed(() =>
  phaseSummary.value?.system ?? props.data?.system ?? '二元体系'
)

// 文件链接（无 emoji）
const fileLinks = computed(() => {
  const files = props.data?.files ?? {}
  return Object.entries(files)
    .filter(([name]) => !name.includes('output.log'))
    .map(([name, url]) => ({
      name, url,
      icon: name.endsWith('.png') ? ImageOutline : DocumentTextOutline,
      hint: name.endsWith('.json') ? 'Plotly 交互图数据'
          : name.endsWith('.png') ? '相图预览图片'
          : '数据文件',
    }))
})

// 查找 JSON 和 PNG 文件 URL
const jsonFileUrl = computed(() => {
  const files = props.data?.files ?? {}
  return Object.entries(files).find(([n]) => n.endsWith('.json') && !n.includes('log'))?.[1] ?? null
})

const imageSrc = computed(() => {
  const files = props.data?.files ?? {}
  return Object.entries(files).find(([n]) => n.endsWith('.png'))?.[1] ?? null
})

// 尝试获取并渲染 Plotly JSON
const tryRenderPlotly = async () => {
  if (!jsonFileUrl.value) {
    chartState.value = imageSrc.value ? 'image' : 'unavailable'
    return
  }
  chartState.value = 'loading'
  try {
    const resp = await fetch(jsonFileUrl.value)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const plotlyData = await resp.json()

    // 等待 DOM 更新后渲染
    await new Promise(r => setTimeout(r, 50))
    if (!chartRef.value) throw new Error('chartRef not ready')

    // 多路径探测 Plotly traces：支持多种可能的 JSON 结构
    //   格式1: { data: [...traces], layout: {...} }   ← 标准 Plotly 导出
    //   格式2: [...traces]                             ← 纯 traces 数组
    //   格式3: { traces: [...], layout: {...} }        ← 部分第三方工具
    let traces = []
    let layout = {}
    if (Array.isArray(plotlyData)) {
      traces = plotlyData
    } else if (plotlyData && typeof plotlyData === 'object') {
      traces = plotlyData.data ?? plotlyData.traces ?? []
      layout = plotlyData.layout ?? {}
    }

    if (!Array.isArray(traces) || traces.length === 0) throw new Error('no traces')

    Plotly.newPlot(chartRef.value, traces, {
      ...layout,
      margin: { l: 60, r: 20, t: 30, b: 55 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { family: 'Inter, sans-serif', size: 12, color: '#5f6368' },
      xaxis: { ...(layout.xaxis ?? {}), gridcolor: '#e8eaed', linecolor: '#dadce0' },
      yaxis: { ...(layout.yaxis ?? {}), gridcolor: '#e8eaed', linecolor: '#dadce0' },
    }, { responsive: true, displayModeBar: false })

    chartState.value = 'ready'
  } catch (e) {
    console.warn('[BinaryPhaseCard] Plotly 渲染失败，尝试 PNG:', e.message)
    chartState.value = imageSrc.value ? 'image' : 'unavailable'
  }
}

onMounted(tryRenderPlotly)
watch(() => props.data, tryRenderPlotly, { deep: true })
</script>

<style scoped>
.binary-card { background: transparent; padding: 0; }

/* ── 条件行（与 PointCalculationCard 一致） ── */
.condition-bar {
  display: flex; gap: 8px; margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e2e8f0);
}
.cond-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
.cond-label { font-size: 10px; color: var(--text-tertiary, #94a3b8); margin-bottom: 2px; }
.cond-value {
  font-size: 16px; font-weight: 700; color: var(--text-primary, #0f172a);
  font-variant-numeric: tabular-nums;
}
.cond-value.accent { color: var(--primary, #1967d2); }

/* ── 节标题（与 PointCalculationCard 一致） ── */
.section { margin-bottom: 12px; }
.section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-secondary, #64748b);
  margin-bottom: 6px; padding-left: 2px;
}

/* ── 相图渲染区 ── */
.chart-canvas { width: 100%; height: 320px; }

.chart-placeholder {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 10px;
  height: 160px; border-radius: 6px;
  background: var(--bg-secondary, #f8fafc);
  border: 1px dashed var(--border-light, #e2e8f0);
  color: var(--text-tertiary, #94a3b8);
}
.chart-placeholder p { font-size: 12px; color: var(--text-tertiary, #94a3b8); text-align: center; margin: 0; padding: 0 16px; line-height: 1.5; }
.chart-placeholder.loading { gap: 8px; }

.loading-spinner {
  width: 20px; height: 20px;
  border: 2px solid #e2e8f0;
  border-top-color: var(--primary, #1967d2);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* PNG 图片 */
.img-wrap {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 6px; overflow: hidden;
}
.phase-image { width: 100%; display: block; }

/* ── 文件列表 ── */
.file-list { display: flex; flex-direction: column; gap: 4px; }
.file-link {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  background: var(--bg-secondary, #f8fafc);
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 6px; text-decoration: none; transition: all 0.15s;
}
.file-link:hover {
  border-color: var(--primary, #1967d2);
  background: #eff6ff;
}
.file-type-icon { color: var(--text-secondary, #64748b); flex-shrink: 0; }
.file-name {
  font-size: 12px; font-weight: 500;
  color: var(--primary, #1967d2); flex: 1;
  font-family: 'SF Mono', 'Consolas', monospace;
}
.file-hint { font-size: 11px; color: var(--text-tertiary, #94a3b8); }
.open-icon { color: var(--text-tertiary, #94a3b8); flex-shrink: 0; }

/* ── 底部说明 ── */
.card-footer {
  display: flex; align-items: flex-start; gap: 5px;
  padding-top: 8px; border-top: 1px solid var(--border-light, #e2e8f0);
  margin-top: 4px;
}
.card-footer span { font-size: 10px; color: #94a3b8; line-height: 1.4; }
</style>
