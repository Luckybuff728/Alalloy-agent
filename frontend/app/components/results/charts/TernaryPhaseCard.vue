<template>
  <div class="ternary-card">

    <!-- 摘要指标行（与 condition-bar 相同语义） -->
    <div class="condition-bar">
      <div class="cond-item" v-for="m in summaryItems" :key="m.label">
        <span class="cond-label">{{ m.label }}</span>
        <span class="cond-value" :class="m.cls">{{ m.value }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">截面温度</span>
        <span class="cond-value">{{ temperature }}</span>
      </div>
    </div>

    <!-- 相图渲染区 -->
    <div class="section">
      <div class="section-title">三元等温截面相图</div>

      <!-- 加载中 -->
      <div v-if="chartState === 'loading'" class="chart-placeholder loading">
        <div class="loading-spinner"></div>
        <span>正在加载相图数据…</span>
      </div>

      <!-- Plotly 渲染（优先） -->
      <div ref="chartRef" class="chart-canvas" v-show="chartState === 'plotly'"></div>

      <!-- PNG 图片（当 Plotly 不可用时） -->
      <template v-if="chartState === 'image'">
        <div class="img-wrap">
          <img
            :src="imageSrc"
            alt="三元等温截面相图"
            class="phase-image"
            @error="onImageError"
          />
        </div>
        <p class="img-note">预渲染图片 · {{ temperature }}</p>
      </template>

      <!-- 无数据提示 -->
      <div v-if="chartState === 'unavailable'" class="chart-placeholder">
        <el-icon :size="28" color="#cbd5e1"><TriangleOutline /></el-icon>
        <p>相图数据文件可通过下方链接下载，在 Python/Plotly 中渲染。</p>
      </div>
    </div>

    <!-- 截面内出现的相 -->
    <div class="section" v-if="phasesInDiagram.length > 0">
      <div class="section-title">截面内出现的相</div>
      <div class="phase-tags">
        <span v-for="phase in phasesInDiagram" :key="phase" class="phase-tag">
          {{ getPhaseDisplayName(phase) }}
        </span>
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
      <span>三元等温截面（Calphad 方法）。ternary_plotly.json 包含完整 Plotly 图形数据，可在 Python/Plotly 中直接渲染交互图。</span>
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
  OpenOutline,
  TriangleOutline,
} from '@vicons/ionicons5'
import Plotly from 'plotly.js-dist-min'
import { getPhaseDisplayName } from '~/utils/phaseNames'

const props = defineProps({ data: { type: Object, required: true } })

const chartRef = ref(null)
// loading | plotly | image | unavailable
const chartState = ref('loading')

const payload   = computed(() => props.data?.result ?? props.data ?? {})
const dataSummary = computed(() => payload.value?.data_summary ?? {})

// count=0/null 时显示 —
const fmtCount = (v) => (v == null || v === 0) ? '—' : Number(v).toLocaleString('zh-CN')

const summaryItems = computed(() => [
  { label: '共轭线 (tie-line)', value: fmtCount(dataSummary.value?.tie_line_count),    cls: '' },
  { label: '三相三角',         value: fmtCount(dataSummary.value?.tie_triangle_count), cls: 'accent' },
])

const phasesInDiagram = computed(() => dataSummary.value?.phases_in_diagram ?? [])

const temperature = computed(() => {
  const t = dataSummary.value?.temperature_K ?? dataSummary.value?.temperature
  if (!t) return '—'
  return `${Number(t).toFixed(0)} K (${(Number(t) - 273.15).toFixed(0)} °C)`
})

// 文件 URL
const files = computed(() => props.data?.files ?? {})

const jsonFileUrl = computed(() =>
  Object.entries(files.value).find(([n]) => n.endsWith('.json') && !n.includes('log'))?.[1] ?? null
)
const imageSrc = computed(() =>
  Object.entries(files.value).find(([n]) => n.endsWith('.png'))?.[1] ?? null
)

// 文件链接（无 emoji，使用图标）
const fileLinks = computed(() =>
  Object.entries(files.value)
    .filter(([name]) => !name.includes('output.log'))
    .map(([name, url]) => ({
      name, url,
      icon: name.endsWith('.png') ? ImageOutline : DocumentTextOutline,
      hint: name.endsWith('.json') ? 'Plotly 交互图数据'
          : name.endsWith('.png') ? '相图预览图片（可直接查看）'
          : '数据文件',
    }))
)

const onImageError = () => {
  // PNG 加载失败 → 降级到 unavailable
  chartState.value = 'unavailable'
}

// 渲染策略：优先 Plotly JSON → 降级 PNG → 降级提示
const tryRender = async () => {
  chartState.value = 'loading'

  // ① 尝试 Plotly JSON 渲染
  if (jsonFileUrl.value) {
    try {
      const resp = await fetch(jsonFileUrl.value)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const plotlyData = await resp.json()

      await new Promise(r => setTimeout(r, 50))
      if (!chartRef.value) throw new Error('chartRef not ready')

      // 多路径探测 Plotly traces
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
        margin: { l: 50, r: 20, t: 30, b: 50 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { family: 'Inter, sans-serif', size: 11, color: '#5f6368' },
      }, { responsive: true, displayModeBar: false })

      chartState.value = 'plotly'
      return
    } catch (e) {
      console.warn('[TernaryPhaseCard] Plotly 渲染失败:', e.message)
    }
  }

  // ② 降级到 PNG 图片
  if (imageSrc.value) {
    chartState.value = 'image'
    return
  }

  // ③ 无数据
  chartState.value = 'unavailable'
}

onMounted(tryRender)
watch(() => props.data, tryRender, { deep: true })
</script>

<style scoped>
.ternary-card { background: transparent; padding: 0; }

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
.cond-value.primary { color: var(--primary, #1967d2); }
.cond-value.accent  { color: #059669; }

/* ── 节标题（与 PointCalculationCard 一致） ── */
.section { margin-bottom: 12px; }
.section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-secondary, #64748b);
  margin-bottom: 6px; padding-left: 2px;
}

/* ── 相图渲染区 ── */
.chart-canvas { width: 100%; height: 340px; }

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

.img-wrap {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 6px; overflow: hidden;
}
.phase-image { width: 100%; display: block; }
.img-note {
  font-size: 11px; color: var(--text-tertiary, #94a3b8);
  margin-top: 4px; text-align: center;
}

/* ── 相标签 ── */
.phase-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.phase-tag {
  padding: 3px 9px;
  background: var(--bg-secondary, #f8fafc);
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 4px;
  font-size: 11px; font-weight: 500;
  color: var(--text-primary, #1e293b);
}

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
