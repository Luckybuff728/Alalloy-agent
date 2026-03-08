<template>
  <div class="boiling-card">

    <!-- 计算条件行 -->
    <div class="condition-bar">
      <div class="cond-item">
        <span class="cond-label">计算体系</span>
        <span class="cond-value">{{ systemLabel }}</span>
      </div>
      <div class="cond-item">
        <span class="cond-label">外压</span>
        <span class="cond-value">{{ pressureLabel }}</span>
      </div>
      <div class="cond-item" v-if="isPureElement">
        <span class="cond-label">元素类型</span>
        <span class="cond-value">纯元素</span>
      </div>
    </div>

    <!-- 关键温度节点 -->
    <div class="section">
      <div class="section-title">关键温度节点</div>

      <!-- 纯元素（solidus=liquidus）→ 简化显示 -->
      <template v-if="isPureElement">
        <div class="temp-grid two-col">
          <div class="temp-card primary">
            <div class="temp-label">熔点 T<sub>m</sub></div>
            <div class="temp-K">{{ fmtK(metrics.solidus_K) }} K</div>
            <div class="temp-C">{{ fmtC(metrics.solidus_K) }} °C</div>
            <div class="temp-desc">固液共存温度（纯元素固相线 = 液相线）</div>
          </div>
          <div class="temp-card secondary" v-if="metrics.bubble_point_K">
            <div class="temp-label">沸点 T<sub>b</sub></div>
            <div class="temp-K">{{ fmtK(metrics.bubble_point_K) }} K</div>
            <div class="temp-C">{{ fmtC(metrics.bubble_point_K) }} °C</div>
            <div class="temp-desc">标准压力下开始沸腾的温度</div>
          </div>
        </div>
      </template>

      <!-- 多元合金（solidus≠liquidus） -->
      <template v-else>
        <div class="temp-grid">
          <div v-for="t in alloyTempItems" :key="t.key" class="temp-card" :class="t.cls">
            <div class="temp-label" v-html="t.label"></div>
            <div class="temp-K" v-if="t.value">{{ fmtK(t.value) }} K</div>
            <div class="temp-C" v-if="t.value">{{ fmtC(t.value) }} °C</div>
            <div class="temp-na" v-else>—</div>
            <div class="temp-desc">{{ t.desc }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- 工程应用说明 -->
    <div class="section">
      <div class="section-title">工程应用说明</div>
      <div class="usage-block">
        <div class="usage-row">
          <el-icon :size="13" class="usage-icon"><InformationCircleOutline /></el-icon>
          <span>
            <strong>熔点参考</strong>：T<sub>m</sub> 可作为 Scheil 凝固模拟 start_temperature 的参考值。
            建议将 start_temperature 设为高于液相线 <strong>50~200 K</strong>。
          </span>
        </div>
        <!-- 沸点注意：纯 Al 沸点 2743K，已远高于压铸温度（约 950K），无蒸发风险
             阈值使用 1500K（已大幅超过所有铸造温度）-->
        <div class="usage-row" v-if="metrics.bubble_point_K && Number(metrics.bubble_point_K) > 1500">
          <el-icon :size="13" class="usage-icon"><AlertCircleOutline /></el-icon>
          <span>
            <strong>沸点注意</strong>：沸点（{{ fmtK(metrics.bubble_point_K) }} K）远高于压铸/铸造加工温度，无蒸发风险。
          </span>
        </div>
      </div>
    </div>

    <!-- 原始数据表 -->
    <div class="section" v-if="tableRows.length > 0">
      <div class="section-title">计算详细结果</div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="col in chineseColumns" :key="col.key">{{ col.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in tableRows" :key="i">
              <td v-for="col in chineseColumns" :key="col.key">{{ formatCell(row[col.key]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card-footer">
      <el-icon :size="12"><InformationCircleOutline /></el-icon>
      <span>
        热力学计算结果（Calphad 方法，标准大气压）。
        纯元素时固相线 = 液相线、泡点 = 露点。温度单位 K，°C = K − 273.15。
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElIcon } from 'element-plus'
import { InformationCircleOutline, AlertCircleOutline } from '@vicons/ionicons5'

const props = defineProps({ data: { type: Object, required: true } })

const payload     = computed(() => props.data?.result ?? props.data ?? {})
const dataSummary = computed(() => payload.value?.data_summary ?? {})
const metrics     = computed(() => payload.value?.derived_metrics ?? {})
const tableRows   = computed(() => dataSummary.value?.rows ?? [])

// 判断是否为纯元素（solidus ≈ liquidus，容差 0.5K，避免与极窄凝固区合金混淆）
const isPureElement = computed(() => {
  const s = metrics.value?.solidus_K
  const l = metrics.value?.liquidus_K
  if (!s || !l) return false
  return Math.abs(Number(s) - Number(l)) < 0.5
})

// 体系名：优先用 alloyLabel（submit 时注入），否则从 rows 的 Component 列读取
const systemLabel = computed(() => {
  // alloyLabel 由 toolResultHandler 从 _taskRegistry 注入（如 "Al"）
  if (props.data?.alloyLabel) return props.data.alloyLabel
  if (tableRows.value.length === 0) return '—'
  const row = tableRows.value[0]
  const compKey = Object.keys(row).find(k =>
    k.toLowerCase().includes('component') || k === '组元'
  )
  return compKey ? String(row[compKey]) : '—'
})

// 压力（帕斯卡 → 标准大气压显示）
const pressureLabel = computed(() => {
  const pa = dataSummary.value?.pressure
  if (!pa) return '101,325 Pa（标准大气压）'
  const n = Number(pa)
  if (Math.abs(n - 101325) < 100) return '101,325 Pa（标准大气压）'
  return `${n.toLocaleString('zh-CN')} Pa`
})

// 多元合金温度项
const alloyTempItems = computed(() => [
  { key: 'solidus',  label: 'T<sub>solidus</sub> 固相线', value: metrics.value?.solidus_K,      cls: 'primary', desc: '完全固化温度' },
  { key: 'liquidus', label: 'T<sub>liquidus</sub> 液相线', value: metrics.value?.liquidus_K,     cls: 'primary', desc: '完全液化温度' },
  { key: 'bubble',   label: 'T<sub>bubble</sub> 泡点',    value: metrics.value?.bubble_point_K,  cls: 'secondary', desc: '开始沸腾温度' },
  { key: 'dew',      label: 'T<sub>dew</sub> 露点',       value: metrics.value?.dew_point_K,     cls: 'secondary', desc: '蒸气完全冷凝温度' },
].filter(t => t.value != null))

// 列名映射（英文 → 中文，兼容后端多种格式）
const COLUMN_MAP = {
  // 组元
  'Component':            { label: '组元' },
  'component':            { label: '组元' },
  // 固相线 / 液相线
  'Solidus/K':            { label: '固相线 T_solidus (K)' },
  'Liquidus/K':           { label: '液相线 T_liquidus (K)' },
  'Solidus Point (K)':    { label: '固相线 T_solidus (K)' },
  'Liquidus Point (K)':   { label: '液相线 T_liquidus (K)' },
  'SolidusPoint/K':       { label: '固相线 T_solidus (K)' },
  'LiquidusPoint/K':      { label: '液相线 T_liquidus (K)' },
  // 泡点 / 露点
  'BubblePoint/K':        { label: '泡点 T_bubble (K)' },
  'DewPoint/K':           { label: '露点 T_dew (K)' },
  'Bubble Point/K':       { label: '泡点 T_bubble (K)' },
  'Dew Point/K':          { label: '露点 T_dew (K)' },
  'Bubble Point (K)':     { label: '泡点 T_bubble (K)' },
  'Dew Point (K)':        { label: '露点 T_dew (K)' },
}

// 判断是否为成分分数列（x(AL)、x(Si) 等），在纯元素场景下通常为 1.0，无需展示
const isCompositionFracCol = (key) => /^x\s*\(/i.test(key)

const chineseColumns = computed(() => {
  if (tableRows.value.length === 0) return []
  return Object.keys(tableRows.value[0])
    .filter(k => !isCompositionFracCol(k))   // 过滤成分分数列
    .map(k => {
      const mapped = COLUMN_MAP[k]
      return { label: mapped?.label ?? k, key: k }
    })
})

const fmtK = (v) => v == null ? '—' : Number(v).toFixed(1)
const fmtC = (v) => v == null ? '—' : (Number(v) - 273.15).toFixed(1)

const formatCell = (v) => {
  if (v === undefined || v === null) return '—'
  const n = Number(v)
  if (!Number.isNaN(n)) return n.toFixed(2)
  return String(v)
}
</script>

<style scoped>
.boiling-card { background: transparent; padding: 0; }

/* ── 条件行 ── */
.condition-bar {
  display: flex; gap: 8px; margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e2e8f0);
}
.cond-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
.cond-label { font-size: 10px; color: var(--text-tertiary, #94a3b8); margin-bottom: 2px; }
.cond-value { font-size: 13px; font-weight: 600; color: var(--text-primary, #0f172a); }

/* ── 节标题 ── */
.section { margin-bottom: 12px; }
.section-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-secondary, #64748b);
  margin-bottom: 6px; padding-left: 2px;
}

/* ── 温度卡网格 ── */
.temp-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.temp-grid.two-col { grid-template-columns: repeat(2, 1fr); }

.temp-card {
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border-light, #e2e8f0);
  background: var(--bg-secondary, #f8fafc);
}
.temp-card.primary {
  border-color: #bfdbfe;
  background: #eff6ff;
}
.temp-card.secondary {
  border-color: #d1fae5;
  background: #f0fdf4;
}

.temp-label {
  font-size: 10px; font-weight: 600;
  color: var(--text-secondary, #64748b);
  margin-bottom: 4px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.temp-K {
  font-size: 22px; font-weight: 700;
  color: var(--text-primary, #0f172a);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.temp-card.primary .temp-K  { color: var(--primary, #1967d2); }
.temp-card.secondary .temp-K { color: #059669; }

.temp-C {
  font-size: 13px; font-weight: 500;
  margin-top: 1px;
  font-variant-numeric: tabular-nums;
}
.temp-card.primary .temp-C  { color: #3b82f6; }
.temp-card.secondary .temp-C { color: #10b981; }

.temp-na { font-size: 18px; color: #cbd5e1; font-weight: 600; }
.temp-desc {
  font-size: 10px; color: var(--text-tertiary, #94a3b8);
  margin-top: 4px; line-height: 1.3;
}

/* ── 应用说明 ── */
.usage-block {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
}
.usage-row {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12px; color: #92400e; line-height: 1.5;
}
.usage-icon { flex-shrink: 0; margin-top: 2px; color: #d97706; }
.usage-row strong { color: #78350f; }

/* ── 数据表 ── */
.table-scroll { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th, .data-table td {
  padding: 6px 10px;
  border: 1px solid var(--border-light, #e2e8f0);
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.data-table th:first-child, .data-table td:first-child { text-align: left; }
.data-table th {
  background: var(--bg-secondary, #f8fafc);
  font-weight: 600; font-size: 11px;
  color: var(--text-secondary, #475569);
}
.data-table tr:hover td { background: #f8fafc; }

/* ── 底部说明 ── */
.card-footer {
  display: flex; align-items: flex-start; gap: 5px;
  padding-top: 8px;
  border-top: 1px solid var(--border-light, #e2e8f0);
  margin-top: 4px;
}
.card-footer span { font-size: 10px; color: #94a3b8; line-height: 1.4; }
</style>
