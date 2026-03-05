<template>
  <div class="performance-card">
    <!-- 头部：成分 + 状态标签 -->
    <div class="card-header">
      <h4 class="card-title">{{ data.composition }}</h4>
      <el-tag size="small" type="success" effect="plain">ONNX 预测</el-tag>
    </div>
    
    <!-- 性能指标列表 -->
    <div class="property-list">
      <div
        v-for="prop in properties"
        :key="prop.key"
        class="property-item"
      >
        <!-- 指标头部：名称 + 数值 + 等级 -->
        <div class="property-header">
          <div class="property-info">
            <span class="property-label">{{ prop.label }}</span>
            <span class="property-unit">{{ prop.unit }}</span>
          </div>
          <div class="property-value-box">
            <span class="property-value">{{ formatValue(getValue(prop.key)) }}</span>
            <el-tag 
              :type="getGradeType(getPercentage(prop.key, prop.max))" 
              size="small" 
              effect="plain"
              class="grade-tag"
            >
              {{ getGrade(getPercentage(prop.key, prop.max)) }}
            </el-tag>
          </div>
        </div>
        
        <!-- 可视化进度条 + 参考刻度 -->
        <div class="property-bar-container">
          <div class="property-bar">
            <div 
              class="property-fill" 
              :style="{ 
                width: `${getPercentage(prop.key, prop.max)}%`,
                backgroundColor: getBarColor(getPercentage(prop.key, prop.max))
              }"
            >
              <span class="fill-label" v-if="getPercentage(prop.key, prop.max) > 15">
                {{ getPercentage(prop.key, prop.max).toFixed(0) }}%
              </span>
            </div>
          </div>
          <div class="property-scale">
            <span class="scale-mark scale-min">0</span>
            <span class="scale-mark scale-mid">{{ (prop.max / 2).toFixed(0) }}</span>
            <span class="scale-mark scale-max">{{ prop.max }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 底部说明 -->
    <div class="card-footer">
      <el-icon :size="14"><InformationCircleOutline /></el-icon>
      <span class="footer-text">预测基于 Al-Si-Mg 系铝合金训练数据</span>
    </div>
  </div>
</template>

<script setup>
/**
 * 单个合金性能卡片组件（专业版）
 * 展示抗拉强度、屈服强度、延伸率，带性能等级评估
 */
import { InformationCircleOutline } from '@vicons/ionicons5'
import { ElTag, ElIcon } from 'element-plus'

const props = defineProps({
  data: {
    type: Object,
    required: true
  }
})

// 性能指标定义（基于铝合金行业标准）
const properties = [
  { key: 'tensile_strength', label: '抗拉强度', unit: 'MPa', max: 500 },
  { key: 'yield_strength', label: '屈服强度', unit: 'MPa', max: 400 },
  { key: 'elongation', label: '延伸率', unit: '%', max: 30 }
]

const getValue = (key) => {
  return props.data[key] || 0
}

const formatValue = (value) => {
  return value.toFixed(1)
}

const getPercentage = (key, max) => {
  const value = getValue(key)
  return Math.min((value / max) * 100, 100)
}

// 颜色系统：基于材料性能等级
const getBarColor = (percentage) => {
  if (percentage >= 80) return '#10b981' // 优秀 - 绿色
  if (percentage >= 60) return '#3b82f6' // 良好 - 蓝色
  if (percentage >= 40) return '#f59e0b' // 中等 - 橙色
  return '#ef4444' // 偏低 - 红色
}

// 性能等级标签
const getGrade = (percentage) => {
  if (percentage >= 80) return '优秀'
  if (percentage >= 60) return '良好'
  if (percentage >= 40) return '中等'
  return '偏低'
}

const getGradeType = (percentage) => {
  if (percentage >= 80) return 'success'
  if (percentage >= 60) return 'primary'
  if (percentage >= 40) return 'warning'
  return 'danger'
}
</script>

<style scoped>
.performance-card {
  /* 移除外层已有卡片样式，避免"盒中盒"嵌套 */
  background: transparent;
  padding: 0; /* 依靠外层父组件的 padding */
  border: none;
  box-shadow: none;
}

/* 头部 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f8fafc);
  border-radius: 8px;
  border: 1px solid var(--border-light, #e5e7eb);
}

.card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  letter-spacing: -0.02em;
}

/* 性能指标列表 */
.property-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.property-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 指标头部 */
.property-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.property-info {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.property-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.property-unit {
  font-size: 9px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.property-value-box {
  display: flex;
  align-items: center;
  gap: 6px;
}

.property-value {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 700;
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  letter-spacing: -0.02em;
}

.grade-tag {
  font-size: 9px;
  padding: 0 4px;
  height: 16px;
  line-height: 14px;
  font-weight: 600;
}

/* 进度条容器 */
.property-bar-container {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.property-bar {
  width: 100%;
  height: 6px;
  background: linear-gradient(to right, #f3f4f6, #e5e7eb);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.property-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 4px;
  position: relative;
}

.fill-label {
  font-size: 8px;
  color: white;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* 刻度标记 */
.property-scale {
  display: flex;
  justify-content: space-between;
  padding: 0 1px;
}

.scale-mark {
  font-size: 9px;
  color: var(--text-tertiary);
  font-weight: 500;
  font-family: 'SF Mono', monospace;
}

/* 底部说明 */
.card-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-light);
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
}

.footer-text {
  font-size: 9px;
  line-height: 1.2;
}

/* 悬停效果 */
.property-item:hover .property-fill {
  filter: brightness(1.1);
}
</style>
