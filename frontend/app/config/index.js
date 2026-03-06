/**
 * 前端配置
 * 铝合金智能设计系统 v2.0
 * 
 * 此文件集中管理所有铝合金 Agent 特有的配置，包括：
 * - 品牌信息 (BRAND)
 * - 能力矩阵 (CAPABILITIES)
 * - 示例问题 (EXAMPLE_QUESTIONS)
 * - 预设场景 (SCENARIOS)
 * - 结果卡片类型 (RESULT_TYPES)
 * - 表单配置 (FORM_OPTIONS)
 */

// ==================== 运行时配置 ====================
const getRuntimeConfig = () => {
  if (typeof useRuntimeConfig === 'function') {
    return useRuntimeConfig()
  }
  return {
    public: {
      devMode: false,
      backendHost: 'localhost',
      backendPort: '8001',
      authProvider: 'both',
      supabaseUrl: '',
      supabaseAnonKey: '',
    }
  }
}

const config = getRuntimeConfig()

// 后端 API 地址
const API_BASE_URL = config.public.apiBaseUrl || 
  `http://${config.public.backendHost}:${config.public.backendPort}`

// WebSocket 基础地址
const WS_BASE_URL = config.public.wsBaseUrl || 
  `ws://${config.public.backendHost}:${config.public.backendPort}`

// WebSocket 端点
const WS_ENDPOINTS = {
  chat: `${WS_BASE_URL}/ws/chat`
}

// 开发模式
const DEV_MODE = config.public.devMode || false

// 登录方式控制：'both' | 'supabase' | 'ferriskey'
const AUTH_PROVIDER = config.public.authProvider || 'both'

// Supabase 配置（供 auth.js 懒初始化时使用）
const SUPABASE_URL = config.public.supabaseUrl || ''
const SUPABASE_ANON_KEY = config.public.supabaseAnonKey || ''

// 默认仿真 ID (如有)
const defaultSimId = ''

// ==================== 品牌信息 ====================
const BRAND = {
  name: 'Alalloy Agent',
  shortName: 'Alalloy',
  title: '铝合金智能设计专家',
  subtitle: '您的专属铝合金智能设计专家。我可以帮您进行合金成分设计、热力学计算与性能预测。',
  intro: '我是专注于 **铝合金** 设计与研发的多智能体系统，支持从成分设计、热力学计算到性能预测的全流程验证。',
  logo: '/logo.svg',
  version: '2.0.0'
}

// ==================== 能力矩阵 ====================
const CAPABILITIES = [
  {
    icon: '🌡️',
    name: '热力学计算',
    desc: '基于 Calphad 的平衡相图、凝固路径 (Scheil) 与相组成计算'
  },
  {
    icon: '📊',
    name: '性能预测',
    desc: '基于机器学习的机械性能预测 (抗拉强度、屈服强度、延伸率等)'
  },
  {
    icon: '💡',
    name: '成分设计优化',
    desc: '根据目标性能自动推荐和优化合金成分配比'
  },
  {
    icon: '📚',
    name: '知识检索',
    desc: '检索标准合金牌号数据及文献库中的工艺参数'
  }
]

// ==================== 示例问题 ====================
const EXAMPLE_QUESTIONS = [
  '计算 Al-4Cu-1Mg 合金在 500℃ 的平衡相组成',
  '预测 7075 铝合金 T6 处理后的室温拉伸性能',
  '设计一款用于新能源汽车一体化压铸车身后地板结构件的高延性Al-Si-Mg系压铸铝合金，要求满足：抗拉强度 ≥ 330 MPa，延伸率 ≥ 15%'
]

// ==================== 预设场景 ====================
const SCENARIOS = [
  { 
    id: '2xxx_aero', 
    label: '航空结构件 (2xxx系)', 
    icon: '✈️',
    data: {
      baseSystem: 'Al-Cu-Mg',
      application: 'aerospace',
      targetProperties: ['yield_strength', 'elongation']
    }
  },
  { 
    id: '7xxx_high_strength', 
    label: '高强结构件 (7xxx系)', 
    icon: '💪',
    data: {
      baseSystem: 'Al-Zn-Mg-Cu',
      application: 'general',
      targetProperties: ['yield_strength', 'corrosion']
    }
  },
  { 
    id: '6xxx_auto', 
    label: '汽车轻量化 (6xxx系)', 
    icon: '🚗',
    data: {
      baseSystem: 'Al-Mg-Si',
      application: 'automotive',
      targetProperties: ['yield_strength', 'castability']
    }
  },
  {
    id: 'nev_die_casting',
    label: '新能源一体化压铸',
    icon: '⚡',
    data: {
      baseSystem: 'Al-Si-Mg',
      application: 'nev_die_casting',
      targetProperties: ['tensile_strength', 'elongation', 'castability']
    }
  }
]

// ==================== 表单选项 ====================
const FORM_OPTIONS = {
  // 基础合金系
  baseSystems: [
    { label: 'Al-Cu-Mg (2xxx系)', value: 'Al-Cu-Mg' },
    { label: 'Al-Mg-Si (6xxx系)', value: 'Al-Mg-Si' },
    { label: 'Al-Zn-Mg-Cu (7xxx系)', value: 'Al-Zn-Mg-Cu' },
    { label: 'Al-Si (4xxx系)', value: 'Al-Si' },
    { label: 'Al-Si-Mg (铸造系)', value: 'Al-Si-Mg' }
  ],
  // 应用场景
  applications: [
    { label: '航空航天结构件', value: 'aerospace' },
    { label: '汽车轻量化部件', value: 'automotive' },
    { label: '新能源一体化压铸', value: 'nev_die_casting' },
    { label: '3C电子产品外壳', value: '3c_electronics' },
    { label: '通用工程结构', value: 'general' }
  ],
  // 目标性能
  targetProperties: [
    { label: '抗拉强度', value: 'tensile_strength' },
    { label: '屈服强度', value: 'yield_strength' },
    { label: '延伸率', value: 'elongation' },
    { label: '耐腐蚀性', value: 'corrosion' },
    { label: '铸造性能', value: 'castability' }
  ]
}

// 性能名称映射 (用于显示)
const PROPERTY_LABELS = {
  'yield_strength': '屈服强度',
  'elongation': '延伸率',
  'corrosion': '耐腐蚀性',
  'castability': '铸造性能',
  'tensile_strength': '抗拉强度',
  'hardness': '硬度'
}

// ==================== 结果卡片类型 ====================
const RESULT_TYPES = {
  'performance_prediction': {
    title: 'ML 性能预测',
    icon: 'SpeedometerOutline',
    color: '#8b5cf6'
  },
  'performance': {
    title: '性能预测',
    icon: 'BarChartOutline',
    color: '#8b5cf6'
  },
  'performance_compare': {
    title: '性能对比分析',
    icon: 'GitNetworkOutline',
    color: '#8b5cf6'
  },
  'thermo_point': {
    title: '热力学点计算',
    icon: 'ThermometerOutline',
    color: '#10b981'
  },
  'thermo_line': {
    title: '相图计算',
    icon: 'StatsChartOutline',
    color: '#3b82f6'
  },
  'thermo_scheil': {
    title: 'Scheil 凝固计算',
    icon: 'SnowOutline',
    color: '#06b6d4'
  },
  'scheil': {
    title: 'Scheil 凝固曲线',
    icon: 'TrendingUpOutline',
    color: '#06b6d4'
  },
  'phase_fraction': {
    title: '相分数-温度曲线',
    icon: 'TrendingUpOutline',
    color: '#3b82f6'
  },
  'gibbs': {
    title: '吉布斯能曲线',
    icon: 'TrendingUpOutline',
    color: '#10b981'
  },
  'thermo': {
    title: '热力学综合分析',
    icon: 'TrendingUpOutline',
    color: '#10b981'
  },
  'composition_design': {
    title: '成分设计',
    icon: 'FlaskOutline',
    color: '#f59e0b'
  },
  'knowledge_search': {
    title: '知识检索',
    icon: 'SearchOutline',
    color: '#6366f1'
  }
}

// ==================== 导出配置 ====================
export const CONFIG = {
  API_BASE_URL,
  WS_BASE_URL,
  WS_ENDPOINTS,
  DEV_MODE,
  AUTH_PROVIDER,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  defaultSimId,
  BRAND,
  CAPABILITIES,
  EXAMPLE_QUESTIONS,
  SCENARIOS,
  FORM_OPTIONS,
  PROPERTY_LABELS,
  RESULT_TYPES
}

// 兼容旧的导出方式
export { API_BASE_URL, WS_BASE_URL, WS_ENDPOINTS, DEV_MODE, AUTH_PROVIDER, SUPABASE_URL, SUPABASE_ANON_KEY }
