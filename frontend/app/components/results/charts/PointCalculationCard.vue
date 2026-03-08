<template>
  <div class="point-card">
    <!-- 计算条件 -->
    <div class="condition-bar">
      <div class="cond-item">
        <span class="cond-label">温度</span>
        <span class="cond-value">{{ formatTemp(result.temperature) }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">压力</span>
        <span class="cond-value">{{ formatPressure(result.pressure) }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">相数</span>
        <span class="cond-value">{{ result.derived_metrics?.phase_count ?? '—' }}</span>
      </div>
    </div>

    <!-- 相分数 -->
    <div class="section">
      <div class="section-title">平衡相及相分数</div>
      <div class="phase-bars">
        <div v-for="(fraction, phase) in phaseFractions" :key="phase" class="phase-row">
          <div class="phase-name-col">
            <span class="phase-badge" :style="{ background: getPhaseColor(phase) }"></span>
            <span class="phase-name">{{ getPhaseDisplayName(phase) }}</span>
          </div>
          <div class="phase-bar-col">
            <div class="phase-bar-track">
              <div class="phase-bar-fill" :style="{ width: (fraction * 100).toFixed(1) + '%', background: getPhaseColor(phase) }"></div>
            </div>
            <span class="phase-pct">{{ (fraction * 100).toFixed(2) }}%</span>
          </div>
        </div>
        <div v-if="Object.keys(phaseFractions).length === 0" class="no-data">暂无相分数数据</div>
      </div>
    </div>

    <!-- 热力学性质 -->
    <div class="section" v-if="thermoProps">
      <div class="section-title">摩尔热力学性质</div>
      <div class="thermo-grid">
        <div v-for="prop in thermoList" :key="prop.key" class="thermo-item">
          <div class="thermo-label">{{ prop.label }}</div>
          <div class="thermo-value">{{ formatThermo(thermoProps[prop.key]) }}</div>
          <div class="thermo-unit">{{ prop.unit }}</div>
        </div>
      </div>
    </div>

    <!-- 化学势 -->
    <div class="section" v-if="hasMu">
      <div class="section-title">化学势 μ (J/mol)</div>
      <div class="mu-table">
        <div class="mu-row header-row">
          <span>元素</span><span>化学势 (J/mol)</span>
        </div>
        <div v-for="(mu, elem) in chemPotentials" :key="elem" class="mu-row">
          <span class="elem-name">{{ elem }}</span>
          <span class="mu-val">{{ Number(mu).toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <el-icon :size="12"><InformationCircleOutline /></el-icon>
      <span>单点平衡计算结果。温度单位 K，能量单位 J/mol。</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElIcon } from 'element-plus'
import { InformationCircleOutline } from '@vicons/ionicons5'
import { getPhaseDisplayName } from '~/utils/phaseNames'

const props = defineProps({
  data: { type: Object, required: true }
})

// 后端包裹在 result.result 里
const result = computed(() => props.data?.result ?? props.data ?? {})

const phaseFractions = computed(() => result.value?.phase_fractions ?? {})
const thermoProps = computed(() => result.value?.thermodynamic_properties ?? null)
const chemPotentials = computed(() => result.value?.chemical_potentials ?? {})
const hasMu = computed(() => Object.keys(chemPotentials.value).length > 0)

const thermoList = [
  { key: 'GM', label: 'G', unit: 'J/mol' },
  { key: 'HM', label: 'H', unit: 'J/mol' },
  { key: 'SM', label: 'S', unit: 'J/(mol·K)' },
  { key: 'CPM', label: 'Cₚ', unit: 'J/(mol·K)' },
]

const PHASE_COLORS = [
  '#1967d2','#34a853','#f9ab00','#ea4335',
  '#8b5cf6','#06b6d4','#f97316','#14b8a6',
  '#0284c7','#65a30d','#c026d3','#0891b2',
]
// 在响应式作用域内定义，避免多实例共享颜色映射
const phaseColorMap = ref({})
const getPhaseColor = (phase) => {
  if (!phaseColorMap.value[phase]) {
    const idx = Object.keys(phaseColorMap.value).length
    phaseColorMap.value[phase] = PHASE_COLORS[idx % PHASE_COLORS.length]
  }
  return phaseColorMap.value[phase]
}

const formatTemp = (k) => {
  if (!k && k !== 0) return '—'
  const celsius = (Number(k) - 273.15).toFixed(0)
  return `${Number(k).toFixed(2)} K (${celsius} °C)`
}

const formatPressure = (pa) => {
  if (!pa && pa !== 0) return '101325 Pa'
  return `${Number(pa).toFixed(0)} Pa`
}

const formatThermo = (v) => {
  if (v === undefined || v === null) return '—'
  const n = Number(v)
  return Math.abs(n) >= 1000
    ? n.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
    : n.toFixed(2)
}
</script>

<style scoped>
.point-card { background: transparent; padding: 0; }

.condition-bar {
  display: flex; gap: 8px; margin-bottom: 12px;
  padding: 8px 12px; background: var(--bg-secondary,#f8fafc);
  border-radius: 6px; border: 1px solid var(--border-light,#e2e8f0);
}
.cond-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
.cond-label { font-size: 10px; color: var(--text-tertiary,#94a3b8); margin-bottom: 2px; }
.cond-value { font-size: 12px; font-weight: 600; color: var(--text-primary,#0f172a); text-align: center; }

.section { margin-bottom: 12px; }
.section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-secondary,#64748b);
  margin-bottom: 6px; padding-left: 2px;
}

/* 相分数条 */
.phase-bars { display: flex; flex-direction: column; gap: 5px; }
.phase-row { display: flex; align-items: center; gap: 8px; }
.phase-name-col { display: flex; align-items: center; gap: 5px; width: 160px; flex-shrink: 0; }
.phase-badge { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.phase-name { font-size: 12px; color: var(--text-primary,#1e293b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.phase-bar-col { display: flex; align-items: center; gap: 6px; flex: 1; }
.phase-bar-track {
  flex: 1; height: 6px; background: #f1f5f9;
  border-radius: 3px; overflow: hidden;
}
.phase-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
.phase-pct { font-size: 11px; color: var(--text-secondary,#64748b); width: 44px; text-align: right; font-variant-numeric: tabular-nums; }
.no-data { font-size: 12px; color: var(--text-tertiary,#94a3b8); }

/* 热力学性质网格 */
.thermo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.thermo-item {
  background: var(--bg-secondary,#f9fafb);
  border: 1px solid var(--border-light,#e5e7eb);
  border-radius: 6px; padding: 8px 4px;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.thermo-label { font-size: 11px; color: var(--text-tertiary,#94a3b8); font-style: italic; }
.thermo-value { font-size: 13px; font-weight: 700; color: var(--text-primary,#0f172a); font-variant-numeric: tabular-nums; }
.thermo-unit { font-size: 9px; color: #94a3b8; }

/* 化学势表 */
.mu-table { border: 1px solid var(--border-light,#e2e8f0); border-radius: 6px; overflow: hidden; }
.mu-row { display: grid; grid-template-columns: 60px 1fr; padding: 5px 10px; font-size: 12px; border-bottom: 1px solid var(--border-light,#f1f5f9); }
.mu-row:last-child { border-bottom: none; }
.header-row { background: var(--bg-secondary,#f8fafc); font-weight: 600; font-size: 11px; color: var(--text-secondary,#64748b); }
.elem-name { font-weight: 600; color: var(--text-primary,#1e293b); }
.mu-val { font-variant-numeric: tabular-nums; color: var(--text-secondary,#475569); }

/* 底部 */
.card-footer {
  display: flex; align-items: flex-start; gap: 5px;
  padding-top: 8px; border-top: 1px solid var(--border-light,#e2e8f0); margin-top: 4px;
}
.card-footer span { font-size: 10px; color: #94a3b8; line-height: 1.4; }
</style>
