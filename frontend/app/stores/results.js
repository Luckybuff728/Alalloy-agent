/**
 * 结果数据 Pinia Store
 * 
 * 职责：
 * - 集中管理工具调用产生的业务结果
 * - 支持跨组件状态共享
 * - 提供结果列表的增删改查
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useResultsStore = defineStore('results', () => {
  // ==================== 业务结果状态 ====================
  
  /**
   * 验证结果（成分/工艺校验）
   */
  const validationResult = ref(null)
  
  /**
   * 性能预测结果（ONNX/ML）
   */
  const performancePrediction = ref(null)
  
  /**
   * 历史对比数据
   */
  const historicalData = ref(null)
  
  /**
   * 优化方案结果
   */
  const optimizationResults = ref(null)
  
  /**
   * 实验工单数据
   */
  const experimentWorkorder = ref(null)
  
  /**
   * 结果列表（按时间顺序）
   */
  const resultsList = ref([])
  
  // ==================== 计算属性 ====================
  
  /**
   * 是否有任何结果
   */
  const hasResults = computed(() => resultsList.value.length > 0)
  
  /**
   * 最新的结果
   */
  const latestResult = computed(() => 
    resultsList.value.length > 0 ? resultsList.value[resultsList.value.length - 1] : null
  )
  
  /**
   * 按类型分组的结果
   */
  const resultsByType = computed(() => {
    const grouped = {}
    resultsList.value.forEach(r => {
      if (!grouped[r.type]) grouped[r.type] = []
      grouped[r.type].push(r)
    })
    return grouped
  })
  
  // ==================== 操作方法 ====================
  
  /**
   * 添加结果到列表
   * @param {string} type - 结果类型 (performance/scheil/historical 等)
   * @param {string} title - 显示标题
   * @param {any} data - 结果数据
   */
  const addResult = (type, title, data) => {
    resultsList.value.push({
      id: Date.now(),
      type,
      title,
      data,
      timestamp: new Date().toISOString()
    })
  }
  
  /**
   * 更新特定类型的业务状态
   * @param {string} type - 状态类型
   * @param {any} value - 新值
   */
  const updateState = (type, value) => {
    switch (type) {
      case 'validation':
        validationResult.value = value
        break
      case 'performance':
        performancePrediction.value = value
        break
      case 'historical':
        historicalData.value = value
        break
      case 'optimization':
        optimizationResults.value = value
        break
      case 'workorder':
        experimentWorkorder.value = value
        break
    }
  }
  
  /**
   * 清空所有结果
   */
  const clearAll = () => {
    validationResult.value = null
    performancePrediction.value = null
    historicalData.value = null
    optimizationResults.value = null
    experimentWorkorder.value = null
    resultsList.value = []
  }
  
  return {
    // 状态
    validationResult,
    performancePrediction,
    historicalData,
    optimizationResults,
    experimentWorkorder,
    resultsList,
    
    // 计算属性
    hasResults,
    latestResult,
    resultsByType,
    
    // 方法
    addResult,
    updateState,
    clearAll
  }
})
