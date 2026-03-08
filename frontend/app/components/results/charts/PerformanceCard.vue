<template>
  <div class="performance-card">
    <!-- 头部：成分 + 预测标签 -->
    <div class="card-header">
      <h4 class="card-title">{{ data.composition || '—' }}</h4>
      <div class="header-meta">
        <span class="meta-badge">ONNX</span>
        <span v-if="data.heat_treatment" class="meta-state">{{ data.heat_treatment }}</span>
      </div>
    </div>

    <!-- 核心指标网格：紧凑布局 -->
    <div class="metrics-grid">
      <div v-for="prop in properties" :key="prop.key" class="metric-item">
        <div class="metric-label">
          {{ prop.name }} <span class="property-symbol" v-html="prop.symbol"></span>
          <span class="metric-unit">({{ prop.unit }})</span>
        </div>
        <div class="metric-value-container">
          <span class="value">{{ formatValue(getValue(prop.key)) }}</span>
        </div>
      </div>
      
      <!-- 屈强比派生指标 -->
      <div class="metric-item highlight" v-if="yieldRatio > 0">
        <div class="metric-label">
          屈强比 <span class="property-symbol" v-html="'R<sub>p0.2</sub>/R<sub>m</sub>'"></span>
        </div>
        <div class="metric-value-container">
          <span class="value">{{ yieldRatio }}</span>
        </div>
      </div>
    </div>

    <!-- 底部说明 -->
    <div class="card-footer">
      <el-icon :size="12"><InformationCircleOutline /></el-icon>
      <span>预测基于 Al-Si-Mg 系铝合金训练数据。</span>
    </div>
  </div>
</template>

<script setup>
/**
 * 铝合金力学性能预测卡片 (紧凑网格版)
 * 符号规范遵循 GB/T 228.1：Rm（抗拉强度）、Rp0.2（屈服强度）、A（断后伸长率）
 */
import { computed } from 'vue'
import { InformationCircleOutline } from '@vicons/ionicons5'
import { ElIcon } from 'element-plus'

const props = defineProps({
  data: {
    type: Object,
    required: true,
    default: () => ({})
  }
})

const properties = [
  { key: 'tensile_strength', name: '抗拉强度', symbol: 'R<sub>m</sub>',     unit: 'MPa' },
  { key: 'yield_strength',   name: '屈服强度', symbol: 'R<sub>p0.2</sub>',  unit: 'MPa' },
  { key: 'elongation',       name: '断后伸长率', symbol: 'A',               unit: '%'   }
]

const getValue = (key) => {
  const v = props.data[key]
  return (v !== undefined && v !== null) ? Number(v) : 0
}

const formatValue = (value) => Number(value).toFixed(1)

/** 屈强比（Rp0.2 / Rm）：表征加工硬化余量的标准工程参数 */
const yieldRatio = computed(() => {
  const uts = getValue('tensile_strength')
  const ys  = getValue('yield_strength')
  if (uts <= 0 || ys <= 0) return 0
  return (ys / uts).toFixed(2)
})
</script>

<style scoped>
.performance-card {
  background: transparent;
  padding: 0;
  border: none;
  box-shadow: none;
}

/* ── 头部 ── */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e2e8f0);
}

.card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #0f172a);
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  letter-spacing: -0.01em;
  word-break: break-all;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.meta-badge {
  font-size: 10px;
  font-weight: 600;
  color: #475569;
  background: #e2e8f0;
  border-radius: 3px;
  padding: 1px 6px;
  letter-spacing: 0.02em;
}

.meta-state {
  font-size: 10px;
  font-weight: 500;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 1px 6px;
}

/* ── 指标网格 (紧凑布局) ── */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 10px 4px;
  background: var(--bg-secondary, #f9fafb);
  border-radius: 6px;
  border: 1px solid var(--border-light, #e5e7eb);
}

.metric-item.highlight {
  background: #f0f9ff;
  border-color: #bae6fd;
}

.metric-label {
  font-size: 11px;
  color: var(--text-tertiary, #64748b);
  margin-bottom: 4px;
  white-space: nowrap;
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.property-symbol {
  font-style: italic;
  font-family: 'Times New Roman', Times, serif;
}

.metric-unit {
  font-size: 9px;
  color: #94a3b8;
}

.metric-value-container {
  display: flex;
  align-items: baseline;
}

.value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #0f172a);
  font-family: 'SF Mono', 'Consolas', monospace;
  letter-spacing: -0.02em;
}

.metric-item.highlight .value {
  color: #0369a1;
}

/* 响应式：窄屏幕下自动切为 2x2 */
@media (max-width: 500px) {
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ── 底部说明 ── */
.card-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light, #e2e8f0);
  display: flex;
  align-items: flex-start;
  gap: 5px;
}

.card-footer span {
  font-size: 10px;
  line-height: 1.4;
  color: #94a3b8;
}
</style>
