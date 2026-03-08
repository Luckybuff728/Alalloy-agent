<template>
  <div class="knowledge-card">

    <!-- 空状态 -->
    <div v-if="!dataList || dataList.length === 0" class="empty-state">
      <el-icon :size="28" color="#cbd5e1"><DocumentOutline /></el-icon>
      <p>未找到相关材料数据</p>
    </div>

    <template v-else>
      <!-- 信息条 -->
      <div class="info-bar">
        <span class="info-label">IDME 数据库</span>
        <span class="info-count">{{ dataList.length }} 条匹配记录</span>
      </div>

      <!-- 数据表格 -->
      <div class="table-wrap">
        <table class="data-table">
          <!-- colgroup 显式控制各列宽度，确保 th/td 对齐 -->
          <colgroup>
            <col class="col-comp" />
            <col v-for="col in visibleCols" :key="col.key" class="col-num" />
          </colgroup>
          <thead>
            <tr>
              <th class="th-comp">成分</th>
              <th v-for="col in visibleCols" :key="col.key" class="th-num">
                {{ col.label }}<span class="unit">{{ col.unit }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, idx) in displayData"
              :key="idx"
              :title="getCondition(item)"
              class="data-row"
            >
              <td class="td-comp" :title="getComposition(item)">
                {{ getComposition(item) }}
              </td>
              <td v-for="col in visibleCols" :key="col.key" class="td-num">
                <span :class="getValueClass(item, col)">{{ getNumProp(item, col.key) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 展开/收起 -->
      <div v-if="hasMore" class="expand-row" @click="isExpanded = !isExpanded">
        <span>{{ isExpanded ? '收起数据' : `展开其余 ${hiddenCount} 条` }}</span>
        <el-icon :class="['chevron', { rotated: isExpanded }]"><ChevronDownOutline /></el-icon>
      </div>

      <!-- 底部提示 -->
      <div class="card-footer">
        <el-icon :size="11"><InformationCircleOutline /></el-icon>
        <span>共 {{ dataList.length }} 条。悬停行可查看实验条件。数值单位见列标题。</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElIcon } from 'element-plus'
import { ChevronDownOutline, DocumentOutline, InformationCircleOutline } from '@vicons/ionicons5'

const props = defineProps({
  data: { type: Object, required: true, default: () => ({}) }
})

const dataList = computed(() => props.data?.data || [])

// ── 展开收起：默认 3 条 ───────────────────────────────────────────
const DEFAULT_LIMIT = 3
const isExpanded = ref(false)

const displayData  = computed(() =>
  isExpanded.value ? dataList.value : dataList.value.slice(0, DEFAULT_LIMIT)
)
const hasMore     = computed(() => dataList.value.length > DEFAULT_LIMIT)
const hiddenCount = computed(() => dataList.value.length - DEFAULT_LIMIT)

// ── 字段映射 ──────────────────────────────────────────────────────
const FIELD_MAPS = {
  UTS: ['Property_UltimateTensileStrength', 'Property_UTS', 'UTS', 'tensile_strength'],
  YS:  ['Property_YieldStrength',           'Property_YS',  'YS',  'yield_strength'],
  EL:  ['Property_Elongation',              'Property_EL',  'EL',  'elongation'],
  HV:  ['Property_Hardness',               'Property_HV',  'HV',  'hardness'],
}

const ALL_COLS = [
  { key: 'UTS', label: 'UTS', unit: ' MPa' },
  { key: 'YS',  label: 'YS',  unit: ' MPa' },
  { key: 'EL',  label: 'EL',  unit: ' %'   },
  { key: 'HV',  label: '硬度', unit: ' HV'  },
]

// 只显示有数据的列
const visibleCols = computed(() =>
  ALL_COLS.filter(col => dataList.value.some(item => getRawProp(item, col.key) !== null))
)

const getRawProp = (item, type) => {
  for (const field of (FIELD_MAPS[type] || [])) {
    const v = item[field]
    if (v !== undefined && v !== null && v !== '') {
      const n = typeof v === 'number' ? v : parseFloat(v)
      return isNaN(n) ? null : n
    }
  }
  return null
}

const getNumProp = (item, type) => {
  const n = getRawProp(item, type)
  if (n === null) return '—'
  return n % 1 === 0 ? n.toString() : n.toFixed(1)
}

const getComposition = (item) =>
  item.Composition_NAME || item.Composition_Name || item.composition || '—'

const getCondition = (item) =>
  item.Property_ExperimentCondition ? `实验条件：${item.Property_ExperimentCondition}` : ''

// 突出优秀值（UTS≥300, EL≥12）
const getValueClass = (item, col) => {
  const n = getRawProp(item, col.key)
  if (n === null) return 'val-missing'
  if (col.key === 'UTS' && n >= 300) return 'val-highlight'
  if (col.key === 'EL'  && n >= 12)  return 'val-highlight'
  return ''
}
</script>

<style scoped>
.knowledge-card { background: transparent; padding: 0; }

/* ── 空状态 ── */
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 28px 0;
  color: var(--text-tertiary, #94a3b8); font-size: 12px;
}
.empty-state p { margin: 0; }

/* ── 信息条 ── */
.info-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; margin-bottom: 10px;
  background: var(--bg-secondary, #f8fafc);
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 6px;
}
.info-label {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-secondary, #64748b);
}
.info-count { font-size: 11px; color: var(--text-tertiary, #94a3b8); }

/* ── 表格容器 ── */
.table-wrap {
  border: 1px solid var(--border-light, #e2e8f0);
  border-radius: 6px; overflow: hidden;
}

/* ── 表格
   table-layout: fixed + colgroup 是 th/td 严格对齐的关键
   没有 fixed 时，th 宽度由内容决定，与 td 不同步 ── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;   /* ★ 固定布局，列宽由 colgroup 决定，th/td 严格对齐 */
}

/* colgroup 控制列宽 */
.col-comp { width: 44%; }
.col-num  { /* 剩余宽度均分 */ }

/* ── 表头 ── */
.data-table thead tr {
  background: var(--bg-secondary, #f8fafc);
  border-bottom: 1px solid var(--border-light, #e2e8f0);
}

.data-table th {
  padding: 8px 10px;
  font-size: 11px; font-weight: 600;
  color: var(--text-secondary, #64748b);
  white-space: nowrap; user-select: none;
}

/* 成分列：左对齐 */
.th-comp { text-align: left; }

/* 数值列：右对齐 */
.th-num { text-align: right; }

.unit {
  font-weight: 400; font-size: 10px;
  color: var(--text-tertiary, #94a3b8); margin-left: 2px;
}

/* ── 数据行 ── */
.data-row {
  border-bottom: 1px solid var(--border-light, #f1f5f9);
  transition: background 0.15s; cursor: default;
}
.data-row:last-child { border-bottom: none; }
.data-row:hover { background: var(--bg-secondary, #f8fafc); }

/* 成分单元格：左对齐，超长截断 */
.td-comp {
  padding: 9px 10px;
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  font-size: 12px; font-weight: 500;
  color: var(--text-primary, #1e293b);
  text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 数值单元格：右对齐 */
.td-num {
  padding: 9px 10px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 13px; color: var(--text-secondary, #475569);
  white-space: nowrap;
}

/* 突出值 */
.val-highlight { color: var(--primary, #1967d2); font-weight: 600; }
/* 缺失值 */
.val-missing   { color: var(--text-tertiary, #cbd5e1); }

/* ── 展开/收起 ── */
.expand-row {
  display: flex; justify-content: center; align-items: center; gap: 5px;
  padding: 8px 0; cursor: pointer; user-select: none;
  color: var(--primary, #1967d2); font-size: 12px;
  transition: color 0.15s;
}
.expand-row:hover { color: #1251a8; }

.chevron { font-size: 13px; transition: transform 0.25s; }
.chevron.rotated { transform: rotate(180deg); }

/* ── 底部 ── */
.card-footer {
  display: flex; align-items: flex-start; gap: 5px;
  padding-top: 8px; border-top: 1px solid var(--border-light, #e2e8f0);
  margin-top: 6px;
}
.card-footer span { font-size: 10px; color: #94a3b8; line-height: 1.4; }
</style>
