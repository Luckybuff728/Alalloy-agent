<template>
  <div class="results-panel">
    <!-- 头部 -->
    <div class="results-header">
      <div class="header-left">
        <span class="header-title">分析结果</span>
        <span class="result-count" v-if="results.length > 0">{{ results.length }}</span>
      </div>
      <el-button text circle @click="clearResults" v-if="results.length > 0">
        <el-icon :size="18"><CloseCircleOutline /></el-icon>
      </el-button>
    </div>
    
    <!-- 内容区域 -->
    <div class="results-content" ref="resultsContainer">
      <!-- 空状态 -->
      <div v-if="results.length === 0" class="empty-state">
        <div class="empty-image">
          <el-icon :size="64"><AnalyticsOutline /></el-icon>
        </div>
        <div class="empty-text">
          <h3>暂无分析结果</h3>
          <p>提交任务后，AI 分析的详细报告、<br>性能预测及计算结果将显示在这里</p>
        </div>
      </div>
      
      <!-- 结果列表 -->
      <div v-else class="results-list">
        <div
          v-for="result in results"
          :key="result.id"
          class="result-card"
          :class="`result-${result.type}`"
        >
          <!-- 通用结果卡片头部 -->
          <div class="result-header-strip">
            <div class="strip-left">
              <el-icon :size="18"><component :is="getResultIcon(result.type)" /></el-icon>
              <h4>{{ getResultTitle(result.type) }}</h4>
            </div>
            <span class="result-time">{{ formatTime(result.timestamp) }}</span>
          </div>
          
          <!-- 结果内容 -->
          <div class="result-body">
            <!-- 性能预测 - 单个合金卡片 -->
            <template v-if="result.type === 'performance' && result.data">
              <PerformanceCard :data="result.data" />
            </template>
            
            <!-- 性能对比 - 多合金对比 -->
            <template v-else-if="result.type === 'performance_compare' && result.data?.alloys">
              <div class="charts-grid">
                <PerformanceBarChart :data="result.data.alloys" />
                <PerformanceRadarChart :data="result.data.alloys" />
              </div>
            </template>
            
            <!-- Scheil 凝固曲线 -->
            <template v-else-if="result.type === 'scheil'">
              <ScheilSolidificationChart
                :data="result.data?.data"
                :multiData="result.data?.multiData"
                :title="result.data?.title || 'Scheil 凝固曲线'"
              />
            </template>
            
            <!-- 相分数-温度曲线 -->
            <template v-else-if="result.type === 'phase_fraction' && result.data?.data">
              <PhaseFractionChart
                :data="result.data.data"
                :phases="result.data.phases || []"
                :title="result.data.title"
              />
            </template>
            
            <!-- 吉布斯能-温度曲线 -->
            <template v-else-if="result.type === 'gibbs' && result.data">
              <GibbsEnergyChart
                :data="result.data.data"
                :phases="result.data.phases"
                :multiData="result.data.multiData"
                :title="result.data.title || '吉布斯能-温度曲线'"
              />
            </template>
            
            <!-- 热力学综合对比 -->
            <template v-else-if="result.type === 'thermo' && result.data">
              <div class="charts-grid">
                <ThermoCompareChart
                  v-if="result.data.compare"
                  :data="result.data.compare"
                />
                <ScheilSolidificationChart
                  v-if="result.data.scheil"
                  :multiData="result.data.scheil"
                />
              </div>
            </template>
            
            <!-- IDME 知识检索结果 -->
            <template v-else-if="result.type === 'knowledge_search' && result.data">
              <KnowledgeSearchCard :data="result.data" />
            </template>
            
            <!-- 通用 JSON 展示（兜底） -->
            <template v-else>
              <pre class="raw-data">{{ formatJSON(result.data) }}</pre>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * ResultsPanel.vue - 结果展示面板 (铝合金 Agent 版)
 * 
 * 集成图表组件展示性能预测和热力学分析结果
 */
import { ref, watch, nextTick } from 'vue'
import { ElButton, ElIcon } from 'element-plus'
import {
  CloseCircleOutline,
  AnalyticsOutline,
  DocumentTextOutline,
  BarChartOutline,
  GitNetworkOutline,
  TrendingUpOutline
} from '@vicons/ionicons5'
import { CONFIG } from '../../config'
import {
  PerformanceBarChart,
  PerformanceRadarChart,
  PerformanceCard,
  ScheilSolidificationChart,
  PhaseFractionChart,
  GibbsEnergyChart,
  ThermoCompareChart,
  KnowledgeSearchCard
} from './charts'

const props = defineProps({
  results: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['clear'])

const resultsContainer = ref(null)

// 自动滚动到底部
watch(() => props.results.length, () => {
  nextTick(() => {
    if (resultsContainer.value) {
      resultsContainer.value.scrollTop = resultsContainer.value.scrollHeight
    }
  })
})

// 获取结果类型的标题
const getResultTitle = (type) => {
  return CONFIG.RESULT_TYPES[type]?.title || `结果 (${type})`
}

// 获取结果类型的图标
const getResultIcon = (type) => {
  const icons = {
    performance: BarChartOutline,
    performance_compare: GitNetworkOutline,
    thermo: TrendingUpOutline,
    scheil: TrendingUpOutline,
    phase_fraction: TrendingUpOutline,
    gibbs: TrendingUpOutline
  }
  return icons[type] || DocumentTextOutline
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 格式化 JSON
const formatJSON = (data) => {
  try {
    return JSON.stringify(data, null, 2)
  } catch (e) {
    return String(data)
  }
}

// 清空结果
const clearResults = () => {
  emit('clear')
}
</script>

<style scoped>
.results-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}

/* 头部区域 */
.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0 12px;
  margin: 0 20px;
  background: transparent;
  border-bottom: 1px solid var(--border-light);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.result-count {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

/* 内容区域 */
.results-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  background: transparent;
}

.results-content::-webkit-scrollbar {
  width: 6px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 24px;
  padding: 0 40px;
  text-align: center;
}

.empty-image {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.empty-text h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-text p {
  margin: 0;
  font-size: 14px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

/* 结果列表 */
.results-list {
  display: flex;
  flex-direction: column;
  gap: 8px; /* 进一步压缩卡片间距 */
}

/* 结果卡片 */
.result-card {
  background: var(--bg-primary);
  border-radius: 8px; /* 减小圆角，显得更紧凑 */
  border: 1px solid var(--border-light, #eef2f6);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04); /* 弱化阴影 */
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  animation: cardSlideIn 0.4s ease-out;
  overflow: hidden;
}

.result-card:hover {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

@keyframes cardSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 卡片头部 */
.result-header-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px; /* 压缩头部内边距 */
  background: transparent;
  border-bottom: 1px solid var(--border-light, #f1f5f9);
  position: relative;
}

.result-header-strip::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--primary, #1967d2);
}

.strip-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.strip-left h4 {
  margin: 0;
  font-size: 13px; /* 减小头部标题字号 */
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  letter-spacing: 0.01em;
}

.strip-left .el-icon {
  color: var(--primary, #1967d2);
  font-size: 14px; /* 减小图标大小 */
}

.result-time {
  font-size: 10px;
  color: var(--text-tertiary, #94a3b8);
  font-family: 'Inter', sans-serif;
}

/* 卡片内容 */
.result-body {
  padding: 12px; /* 压缩内容区内边距 */
}

/* 原始数据展示 - 用于通用 JSON 展示 */
.raw-data {
  margin: 0;
  padding: 12px;
  background: #f8f9fa;
  border-radius: var(--radius-sm);
  font-family: monospace;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 300px;
  overflow-y: auto;
}

/* 图表网格布局 */
.charts-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 1200px) {
  .charts-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
