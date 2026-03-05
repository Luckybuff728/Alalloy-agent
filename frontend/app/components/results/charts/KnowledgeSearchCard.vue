<template>
  <div class="knowledge-card">
    <div v-if="!dataList || dataList.length === 0" class="no-data">
      <el-empty description="未找到相关材料数据" :image-size="48" />
    </div>
    
    <template v-else>
      <table class="data-table">
        <thead>
          <tr>
            <th class="th-composition">成分</th>
            <th class="th-num">UTS<span class="unit">MPa</span></th>
            <th class="th-num">YS<span class="unit">MPa</span></th>
            <th class="th-num">EL<span class="unit">%</span></th>
            <th class="th-num">硬度<span class="unit">HV</span></th>
          </tr>
        </thead>
        <tbody>
          <tr 
            v-for="(item, index) in displayData" 
            :key="index"
            :title="getCondition(item)"
          >
            <td class="td-composition">{{ getComposition(item) }}</td>
            <td class="td-num">{{ getNumProp(item, 'UTS') }}</td>
            <td class="td-num">{{ getNumProp(item, 'YS') }}</td>
            <td class="td-num">{{ getNumProp(item, 'EL') }}</td>
            <td class="td-num">{{ getNumProp(item, 'HV') }}</td>
          </tr>
        </tbody>
      </table>
      
      <!-- 展开收起控制 -->
      <div 
        v-if="hasMoreData" 
        class="expand-action" 
        @click="toggleExpand"
      >
        <span class="expand-text">{{ isExpanded ? '收起数据' : `展开其余 ${hiddenCount} 条数据` }}</span>
        <el-icon class="expand-icon" :class="{ 'is-expanded': isExpanded }">
          <ChevronDownOutline />
        </el-icon>
      </div>

      <div class="table-footer">
        <span>共 {{ dataList.length }} 条</span>
        <span class="footer-hint">悬停行可查看实验条件</span>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * 知识检索结果卡片 (IDME 数据) - 精简专业表格
 * 字段来源: Property_UltimateTensileStrength / Property_YieldStrength /
 *           Property_Elongation / Property_Hardness / Composition_NAME
 */
import { ref, computed } from 'vue'
import { ElEmpty, ElIcon } from 'element-plus'
import { ChevronDownOutline } from '@vicons/ionicons5'

const props = defineProps({
  data: {
    type: Object,
    required: true,
    default: () => ({})
  }
})

const dataList = computed(() => props.data?.data || [])

// 展开收起逻辑
const DEFAULT_LIMIT = 5
const isExpanded = ref(false)

const displayData = computed(() => {
  if (isExpanded.value) return dataList.value
  return dataList.value.slice(0, DEFAULT_LIMIT)
})

const hasMoreData = computed(() => dataList.value.length > DEFAULT_LIMIT)
const hiddenCount = computed(() => dataList.value.length - DEFAULT_LIMIT)

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

const getComposition = (item) =>
  item.Composition_NAME || item.Composition_Name || item.composition || '—'

// 各属性字段优先级映射（IDME 完整字段名在前）
const FIELD_MAPS = {
  UTS: ['Property_UltimateTensileStrength', 'Property_UTS', 'UTS', 'tensile_strength'],
  YS:  ['Property_YieldStrength',           'Property_YS',  'YS',  'yield_strength'],
  EL:  ['Property_Elongation',              'Property_EL',  'EL',  'elongation'],
  HV:  ['Property_Hardness',               'Property_HV',  'HV',  'hardness'],
}

const getNumProp = (item, type) => {
  for (const field of (FIELD_MAPS[type] || [])) {
    const v = item[field]
    if (v !== undefined && v !== null && v !== '') {
      const n = typeof v === 'number' ? v : parseFloat(v)
      return isNaN(n) ? v : n.toFixed(1)
    }
  }
  return '—'
}

const getCondition = (item) =>
  item.Property_ExperimentCondition || ''
</script>

<style scoped>
.knowledge-card {
  width: 100%;
}

.no-data {
  padding: 28px 16px;
}

/* 表格本体：移除两侧边框，让其完全贴合容器 */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

/* 表头：极简风格，无背景色，仅有底边框 */
.data-table thead tr {
  border-bottom: 1px solid var(--border-color, #e4e7ed);
}

.data-table th {
  padding: 12px 0 8px 0; /* 移除左右 padding，使其与内容左对齐 */
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #909399);
  text-align: left;
  background: transparent;
  white-space: nowrap;
}

/* 第一列和最后一列分别靠近容器边缘 */
.data-table th:first-child,
.data-table td:first-child {
  padding-left: 0;
}

.data-table th:last-child,
.data-table td:last-child {
  padding-right: 0;
}

.th-composition {
  width: 45%;
}

/* 数值列对齐方式调整 */
.th-num {
  text-align: left; /* 表头左对齐看起来更整齐 */
}

.unit {
  font-weight: 400;
  font-size: 11px;
  color: var(--text-placeholder, #c0c4cc);
  margin-left: 4px;
}

/* 数据行 */
.data-table tbody tr {
  border-bottom: 1px solid var(--border-light, #f2f3f5);
  transition: background 0.2s;
  cursor: default;
}

.data-table tbody tr:last-child {
  border-bottom: none;
}

.data-table tbody tr:hover {
  background: var(--bg-light, #f9fafc);
}

.td-composition {
  padding: 12px 0;
  font-weight: 500;
  color: var(--text-primary, #303133);
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  line-height: 1.4;
}

.td-num {
  padding: 12px 0;
  text-align: left; /* 数值左对齐，与表头一致 */
  color: var(--text-regular, #606266);
  font-variant-numeric: tabular-nums;
  font-size: 13.5px;
}

/* 展开收起控制区域 */
.expand-action {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  margin-top: 4px;
  cursor: pointer;
  color: var(--el-color-primary, #409eff);
  font-size: 13px;
  transition: all 0.2s ease;
  user-select: none;
}

.expand-action:hover {
  color: var(--el-color-primary-light-3, #79bbff);
  background-color: var(--bg-light, #f9fafc);
  border-radius: 4px;
}

.expand-icon {
  font-size: 14px;
  transition: transform 0.3s ease;
}

.expand-icon.is-expanded {
  transform: rotate(180deg);
}

/* 底部状态栏：无背景，靠右对齐 */
.table-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 8px 0 4px 0;
  font-size: 12px;
  color: var(--text-placeholder, #c0c4cc);
}

.footer-hint {
  font-style: italic;
}
</style>
