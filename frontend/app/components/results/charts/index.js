/**
 * 图表组件统一导出
 * 铝合金 Agent 结果面板图表库
 */

// ── 性能图表 ──────────────────────────────────────────────────────
export { default as PerformanceBarChart }   from './PerformanceBarChart.vue'
export { default as PerformanceRadarChart } from './PerformanceRadarChart.vue'
export { default as PerformanceCard }       from './PerformanceCard.vue'

// ── 热力学图表（核心 3 类） ──────────────────────────────────────
export { default as ScheilSolidificationChart } from './ScheilSolidificationChart.vue'
export { default as PhaseFractionChart }        from './PhaseFractionChart.vue'
export { default as GibbsEnergyChart }          from './GibbsEnergyChart.vue'
export { default as ThermoCompareChart }        from './ThermoCompareChart.vue'

// ── 热力学图表（扩展 4 类，支持新 MCP 工具） ────────────────────
export { default as PointCalculationCard }  from './PointCalculationCard.vue'
export { default as ThermoPropertiesChart } from './ThermoPropertiesChart.vue'
export { default as BinaryPhaseCard }       from './BinaryPhaseCard.vue'
export { default as TernaryPhaseCard }      from './TernaryPhaseCard.vue'
export { default as BoilingPointCard }      from './BoilingPointCard.vue'

// ── 知识检索 ─────────────────────────────────────────────────────
export { default as KnowledgeSearchCard } from './KnowledgeSearchCard.vue'
