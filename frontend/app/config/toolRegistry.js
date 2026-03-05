/**
 * 工具注册表 (Tool Registry)
 * 
 * 设计理念：
 * - 集中管理所有工具的元信息（名称、类型、图表组件等）
 * - 替代分散在各处的硬编码映射
 * - 支持动态注册新工具，提升可拓展性
 * 
 * 使用方式：
 * import { getToolDisplayName, getToolCategory, shouldShowResult } from '@/config/toolRegistry'
 */

// ==================== 工具元信息定义 ====================

/**
 * 工具分类枚举
 */
export const ToolCategory = {
  PREDICTION: 'prediction',      // 预测类（ONNX、ML）
  SIMULATION: 'simulation',      // 仿真类（FEM、PVD、相场）
  VALIDATION: 'validation',      // 验证类（成分、工艺校验）
  KNOWLEDGE: 'knowledge',        // 知识类（RAG、知识库查询）
  INTERACTION: 'interaction',    // 交互类（用户确认、表单）
  STATE: 'state',                // 状态类（参数更新）
  ANALYSIS: 'analysis',          // 分析类（根因分析、对比）
  THERMO: 'thermo',              // 热力学类（Calphad）
}

/**
 * 结果展示方式枚举
 */
export const ResultDisplay = {
  NONE: 'none',                  // 不展示（如 update_params）
  CARD: 'card',                  // 结果卡片（如性能预测）
  CHART: 'chart',                // 图表（如热力学曲线）
  INLINE: 'inline',              // 内联到聊天消息
  WIDGET: 'widget',              // 交互挂件（如表单确认）
}

/**
 * 工具注册表
 * key: 工具名称（与后端一致）
 * value: 工具元信息
 */
const TOOL_REGISTRY = {
  // ==================== 预测类 ====================
  // 旧工具名称（兼容）
  'predict_onnx_performance': {
    displayName: 'ONNX 性能预测',
    category: ToolCategory.PREDICTION,
    resultDisplay: ResultDisplay.CARD,
    chartComponent: 'PerformanceCard',
    description: '基于 ONNX 模型预测铝合金力学性能',
  },
  // MCP 原生工具名称
  'onnx_model_inference': {
    displayName: 'ONNX 性能预测',
    category: ToolCategory.PREDICTION,
    resultDisplay: ResultDisplay.CARD,
    chartComponent: 'PerformanceCard',
    description: '基于 ONNX 模型预测铝合金力学性能（MCP）',
  },
  'onnx_models_list': {
    displayName: 'ONNX 模型列表',
    category: ToolCategory.PREDICTION,
    resultDisplay: ResultDisplay.INLINE,
    description: '查询可用的 ONNX 预测模型列表',
  },
  'onnx_get_model_config': {
    displayName: 'ONNX 模型配置',
    category: ToolCategory.PREDICTION,
    resultDisplay: ResultDisplay.NONE,
    description: '获取 ONNX 模型配置信息',
  },
  'predict_ml_performance_tool': {
    displayName: 'ML 性能预测',
    category: ToolCategory.PREDICTION,
    resultDisplay: ResultDisplay.CARD,
    chartComponent: 'PerformanceCard',
    description: '机器学习性能预测模型',
  },

  // ==================== 热力学类 ====================
  // 旧工具名称（兼容）
  'submit_calphad_task': {
    displayName: 'Calphad 热力学计算',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.CHART,
    chartComponent: 'ThermoCompareChart',
    description: 'Calphad 相图计算',
  },
  // MCP 原生工具名称
  'calphamesh_submit_scheil_task': {
    displayName: 'Scheil 凝固计算',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.CHART,
    chartComponent: 'ScheilSolidificationChart',
    description: 'Scheil 凝固路径计算（MCP）',
  },
  'calphamesh_submit_point_task': {
    displayName: '热力学点计算',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.CHART,
    chartComponent: 'ThermoCompareChart',
    description: '单点平衡相计算（MCP）',
  },
  'calphamesh_submit_line_task': {
    displayName: '相分数曲线计算',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.CHART,
    chartComponent: 'PhaseFractionChart',
    description: '相分数-温度曲线计算（MCP）',
  },
  'calphamesh_get_task_status': {
    displayName: 'Calphad 任务状态',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.NONE,
    description: '查询 Calphad 任务状态',
  },
  'calphamesh_get_task_result': {
    displayName: 'Calphad 任务结果',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.CHART,
    chartComponent: 'ThermoCompareChart',
    description: '获取 Calphad 计算结果',
  },
  'calphamesh_list_tasks': {
    displayName: 'Calphad 任务列表',
    category: ToolCategory.THERMO,
    resultDisplay: ResultDisplay.INLINE,
    description: '列出用户的 Calphad 任务列表（MCP）',
  },

  // ==================== 验证类 ====================
  'validate_composition_tool': {
    displayName: '成分完整性校验',
    category: ToolCategory.VALIDATION,
    resultDisplay: ResultDisplay.INLINE,
    description: '校验合金成分的完整性和合理性',
  },
  'validate_process_params_tool': {
    displayName: '工艺完整性校验',
    category: ToolCategory.VALIDATION,
    resultDisplay: ResultDisplay.INLINE,
    description: '校验工艺参数的完整性',
  },
  'normalize_composition_tool': {
    displayName: '成分含量归一化',
    category: ToolCategory.VALIDATION,
    resultDisplay: ResultDisplay.NONE,
    description: '归一化合金成分百分比',
  },

  // ==================== 知识类 ====================
  'query_knowledge_base': {
    displayName: '材料知识库检索',
    category: ToolCategory.KNOWLEDGE,
    resultDisplay: ResultDisplay.INLINE,
    description: 'RAG 知识库检索',
  },
  'query_idme': {
    displayName: 'iDME 数据查询',
    category: ToolCategory.KNOWLEDGE,
    resultDisplay: ResultDisplay.INLINE,
    description: '查询 iDME 材料数据库',
  },

  // ==================== 交互类 ====================
  'show_guidance_widget': {
    displayName: '引导选项',
    category: ToolCategory.INTERACTION,
    resultDisplay: ResultDisplay.WIDGET,
    description: '显示引导选项让用户选择下一步',
  },

  // ==================== 状态类 ====================
  'update_params': {
    displayName: '状态参数更新',
    category: ToolCategory.STATE,
    resultDisplay: ResultDisplay.NONE,
    description: '更新会话状态参数',
  },

  // ==================== 分析类 ====================
}

// ==================== 查询函数 ====================

/**
 * 获取工具的中文显示名称
 * @param {string} toolName - 工具名称
 * @returns {string} 显示名称
 */
export const getToolDisplayName = (toolName) => {
  const tool = TOOL_REGISTRY[toolName]
  return tool?.displayName || toolName
}

/**
 * 获取工具的分类
 * @param {string} toolName - 工具名称
 * @returns {string} 工具分类
 */
export const getToolCategory = (toolName) => {
  const tool = TOOL_REGISTRY[toolName]
  return tool?.category || ToolCategory.STATE
}

/**
 * 获取工具的结果展示方式
 * @param {string} toolName - 工具名称
 * @returns {string} 展示方式
 */
export const getResultDisplay = (toolName) => {
  const tool = TOOL_REGISTRY[toolName]
  return tool?.resultDisplay || ResultDisplay.NONE
}

/**
 * 判断工具结果是否需要在结果面板展示
 * @param {string} toolName - 工具名称
 * @returns {boolean}
 */
export const shouldShowInResultPanel = (toolName) => {
  const display = getResultDisplay(toolName)
  return display === ResultDisplay.CARD || display === ResultDisplay.CHART
}

/**
 * 获取工具对应的图表组件名称
 * @param {string} toolName - 工具名称
 * @returns {string|null} 图表组件名称
 */
export const getChartComponent = (toolName) => {
  const tool = TOOL_REGISTRY[toolName]
  return tool?.chartComponent || null
}

/**
 * 获取工具的完整元信息
 * @param {string} toolName - 工具名称
 * @returns {object|null} 工具元信息
 */
export const getToolMeta = (toolName) => {
  return TOOL_REGISTRY[toolName] || null
}

/**
 * 注册新工具（动态扩展）
 * @param {string} toolName - 工具名称
 * @param {object} meta - 工具元信息
 */
export const registerTool = (toolName, meta) => {
  TOOL_REGISTRY[toolName] = {
    displayName: meta.displayName || toolName,
    category: meta.category || ToolCategory.STATE,
    resultDisplay: meta.resultDisplay || ResultDisplay.NONE,
    chartComponent: meta.chartComponent || null,
    description: meta.description || '',
  }
}

/**
 * 获取所有已注册的工具名称
 * @returns {string[]}
 */
export const getAllToolNames = () => {
  return Object.keys(TOOL_REGISTRY)
}

/**
 * 按分类获取工具列表
 * @param {string} category - 工具分类
 * @returns {string[]} 工具名称列表
 */
export const getToolsByCategory = (category) => {
  return Object.entries(TOOL_REGISTRY)
    .filter(([_, meta]) => meta.category === category)
    .map(([name, _]) => name)
}

// 默认导出注册表（用于调试）
export default TOOL_REGISTRY
