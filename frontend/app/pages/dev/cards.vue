<template>
  <div class="preview-page">
    <div class="page-header">
      <h1>🧪 结果卡片预览沙盒</h1>
      <p>独立测试所有 CalphaMesh & ONNX 结果卡片，无需运行任务。路由：<code>/dev/cards</code></p>
      <div class="tab-bar">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >{{ tab.label }}</button>
      </div>
    </div>

    <div class="preview-body">
      <!-- 外层模拟 result-card -->
      <div class="mock-result-card">
        <div class="mock-header">
          <span class="mock-title">{{ currentTab.label }}</span>
          <span class="mock-time">预览</span>
        </div>
        <div class="mock-body">
          <!-- 1. Point 计算 -->
          <template v-if="activeTab === 'point'">
            <PointCalculationCard :data="mockPoint" />
          </template>

          <!-- 2. Line（相分数-温度曲线） -->
          <template v-else-if="activeTab === 'phase_fraction'">
            <PhaseFractionChart
              :data="mockLineData.data"
              :phases="mockLineData.phases"
              title="相分数-温度曲线（平衡冷却）500–900 K"
            />
          </template>

          <!-- 3. Scheil 凝固曲线（从 rawResult.shown_rows 解析，使用 NP(*) 格式） -->
          <template v-else-if="activeTab === 'scheil'">
            <ScheilSolidificationChart
              :data="scheilSeriesFromMock"
              :rawResult="mockScheilData.rawResult"
              title="Scheil 非平衡凝固曲线（固相线 832 K）"
            />
          </template>

          <!-- 4. 二元平衡相图 -->
          <template v-else-if="activeTab === 'binary'">
            <BinaryPhaseCard :data="mockBinary" />
          </template>

          <!-- 5. 三元等温截面 -->
          <template v-else-if="activeTab === 'ternary'">
            <TernaryPhaseCard :data="mockTernary" />
          </template>

          <!-- 6. 沸点/熔点 -->
          <template v-else-if="activeTab === 'boiling'">
            <BoilingPointCard :data="mockBoiling" />
          </template>

          <!-- 7. 热力学性质 -->
          <template v-else-if="activeTab === 'thermo_props'">
            <ThermoPropertiesChart :data="mockThermoProps" />
          </template>

          <!-- 8. ONNX 性能预测卡 -->
          <template v-else-if="activeTab === 'performance'">
            <PerformanceCard :data="mockPerformance" />
          </template>
        </div>
      </div>

      <!-- 原始 mock 数据 -->
      <details class="raw-json-wrap">
        <summary>查看 Mock 数据 JSON</summary>
        <pre class="raw-json">{{ JSON.stringify(currentMockData, null, 2) }}</pre>
      </details>
    </div>
  </div>
</template>

<script setup>
/**
 * /dev/cards — 结果卡片独立预览页
 * 直接访问 http://localhost:3000/dev/cards 即可预览所有卡片，无需运行 Agent 任务
 */
import { ref, computed } from 'vue'
import PointCalculationCard   from '~/components/results/charts/PointCalculationCard.vue'
import PhaseFractionChart     from '~/components/results/charts/PhaseFractionChart.vue'
import ScheilSolidificationChart from '~/components/results/charts/ScheilSolidificationChart.vue'
import BinaryPhaseCard        from '~/components/results/charts/BinaryPhaseCard.vue'
import TernaryPhaseCard       from '~/components/results/charts/TernaryPhaseCard.vue'
import BoilingPointCard       from '~/components/results/charts/BoilingPointCard.vue'
import ThermoPropertiesChart  from '~/components/results/charts/ThermoPropertiesChart.vue'
import PerformanceCard        from '~/components/results/charts/PerformanceCard.vue'

const activeTab = ref('point')

const tabs = [
  { id: 'point',         label: '① 单点平衡计算' },
  { id: 'phase_fraction',label: '② 相分数-温度曲线' },
  { id: 'scheil',        label: '③ Scheil 凝固模拟' },
  { id: 'binary',        label: '④ 二元平衡相图' },
  { id: 'ternary',       label: '⑤ 三元等温截面' },
  { id: 'boiling',       label: '⑥ 熔点/沸点' },
  { id: 'thermo_props',  label: '⑦ 热力学性质曲线' },
  { id: 'performance',   label: '⑧ ONNX 性能预测' },
]
const currentTab = computed(() => tabs.find(t => t.id === activeTab.value) ?? tabs[0])

// ═══════════════════════════════════════════════════════════
// Mock 数据（模拟真实 CalphaMesh API 返回结构）
// ═══════════════════════════════════════════════════════════

/** ① 单点平衡计算 — Al-Si-Mg-Fe-Mn @ 850K */
const mockPoint = {
  task_type: 'point_calculation',
  status: 'completed',
  alloyLabel: 'Al-4Si-1Mg-1.5Fe-0.5Mn',
  result: {
    temperature: 850.0,
    pressure: 101325.0,
    phases: 'ALPHA_ALFEMNSI+BETA_ALFESI+FCC_A1+LIQUID',
    phase_fractions: {
      ALPHA_ALFEMNSI: 0.0140,
      BETA_ALFESI:    0.0940,
      FCC_A1:         0.7580,
      LIQUID:         0.1340,
    },
    compositions: { AL: 0.93, FE: 0.015, MG: 0.01, MN: 0.005, SI: 0.04 },
    chemical_potentials: {
      AL: -33110.3, FE: -147939.6, MG: -69681.9, MN: -138738.6, SI: -25228.8
    },
    thermodynamic_properties: {
      GM: -35775.3, HM: 15867.9, SM: 60.76, CPM: 31.29
    },
    derived_metrics: { dominant_phase: 'FCC_A1', phase_count: 4 }
  }
}

/** ② 相分数-温度曲线（line_calculation） */
const generateLineData = () => {
  const temps = Array.from({ length: 45 }, (_, i) => 900 - i * 10)
  return temps.map(T => ({
    temperature: T,
    FCC_A1:         T > 870 ? 0 : Math.min(0.80, (870 - T) / 400),
    LIQUID:         T > 870 ? 1 - (900 - T) * 0.03 : Math.max(0, (T - 820) / 300),
    BETA_ALFESI:    T > 880 ? 0 : 0.094 * (1 - Math.max(0, T - 820) / 100),
    ALPHA_ALFEMNSI: T > 890 ? 0 : 0.012,
    MG2SI:          T > 840 ? 0 : 0.02,
  }))
}
const mockLineData = {
  data: generateLineData(),
  phases: ['FCC_A1', 'LIQUID', 'BETA_ALFESI', 'ALPHA_ALFEMNSI', 'MG2SI'],
}

/**
 * ③ Scheil 凝固模拟 — 模拟真实 NP(*) 格式 CSV 数据（均匀采样20点）
 * 使用非线性 Scheil 曲线（凝固后期液相快速减少，符合 Al-Si 合金特征）
 */
const generateScheilData = () => {
  const tLiq = 1100, tSol = 832
  // 模拟均匀采样的 20 个 NP(*) 格式行（真实后端格式）
  return Array.from({ length: 20 }, (_, i) => {
    const T = tLiq - (tLiq - tSol) * (i / 19)   // 均匀覆盖完整温度范围
    // 非线性凝固：在高温区（1100-950K）全液态，950K后加速凝固
    const normT = Math.max(0, (tLiq - T) / (tLiq - tSol))
    const liquid = T > 950 ? 1.0 : Math.pow(Math.max(0, (T - tSol) / (950 - tSol)), 0.6)
    const fccFraction = Math.max(0, 0.78 * (1 - liquid))
    const betaAlFeSi = Math.max(0, 0.094 * (1 - Math.max(0, (T - 850) / (950-850))))
    const mg2si = T < 840 ? 0.02 * (840 - T) / 10 : 0
    return {
      'T/K': T,
      'NP(LIQUID)': liquid,
      'NP(FCC_A1)': fccFraction,
      'NP(BETA_ALFESI)': betaAlFeSi,
      'NP(MG2SI)': mg2si,
    }
  })
}
const mockScheilData = {
  data: null,   // 不直接传 data，改用 rawResult 让 buildScheilSeries 解析
  rawResult: {
    task_type: 'scheil_solidification',
    status: 'completed',
    result: {
      data_summary: {
        total_steps: 57,
        temperature_range: { liquidus_K: 1100.0, solidus_K: 832.0 },
        // shown_rows: 均匀采样 20 个点，使用 NP(*) 格式（真实后端格式）
        shown_rows: generateScheilData(),
        key_points: [
          { temperature_K: 1100.0, liquid_fraction: 1.0, solid_fraction: 0.0 },
          { temperature_K: 966.0,  liquid_fraction: 0.5, solid_fraction: 0.5 },
          { temperature_K: 832.0,  liquid_fraction: 0.0, solid_fraction: 1.0 },
        ]
      },
      derived_metrics: {
        freezing_range_K: 268.0,
        t_at_liquid_fraction_0_9_K: 1065.0,
        t_at_liquid_fraction_0_5_K: 966.0,
        t_at_liquid_fraction_0_1_K: 870.0,
      }
    }
  }
}

/** ④ 二元平衡相图 — Al-Si（预览：模拟 Plotly JSON 内联渲染） */
// 构造一条简单的 Al-Si 液相线用于 Plotly 渲染演示
const alSiLiquidus = (() => {
  // Al-Si 液相线近似（共晶成分 12.6%Si @ 850K）
  const xSi = Array.from({ length: 30 }, (_, i) => i * 0.01)
  const T = xSi.map(x => x < 0.126 ? 933 - 933 * x / 0.126 * 0.083 : 1687 - (1 - x) / 0.874 * 837)
  return { xSi, T }
})()

const mockBinaryPlotly = {
  data: [
    {
      x: alSiLiquidus.xSi.map(x => (x * 100).toFixed(1)),
      y: alSiLiquidus.T,
      name: '液相线 Liquidus',
      type: 'scatter', mode: 'lines',
      line: { color: '#dc2626', width: 2 }
    },
    {
      x: [0, 12.6, 100],
      y: [933, 850, 1687],
      name: '固相线（示意）',
      type: 'scatter', mode: 'lines',
      line: { color: '#2563eb', width: 1.5, dash: 'dot' }
    }
  ],
  layout: {
    xaxis: { title: { text: 'x(Si) mol%' }, range: [0, 30] },
    yaxis: { title: { text: '温度 T (K)' } },
    title: { text: 'Al-Si 二元相图（示意）', font: { size: 13 } }
  }
}

// 模拟通过 fetch 返回 Plotly JSON 的 URL（用 blob URL）
const mockBinaryJsonUrl = (() => {
  const blob = new Blob([JSON.stringify(mockBinaryPlotly)], { type: 'application/json' })
  return URL.createObjectURL(blob)
})()

const mockBinary = {
  task_type: 'binary_equilibrium',
  status: 'completed',
  system: 'Al-Si',
  result: {
    data_summary: {
      system: 'Al-Si',
      phase_count: 3,
      boundary_count: 11,
    }
  },
  files: {
    'binary_equilibrium.json': mockBinaryJsonUrl,
    'output.log': '',
  }
}

/** ⑤ 三元等温截面 — Al-Mg-Si @ 773K */
const mockTernary = {
  task_type: 'ternary_calculation',
  status: 'completed',
  result: {
    data_summary: {
      point_count: 2161,
      tie_line_count: 218,
      tie_triangle_count: 575,
      phases_in_diagram: ['FCC_A1', 'HCP_A3', 'BETA_ALMG', 'MG2SI', 'DIAMOND_A4'],
      temperature_K: 773.0,
    }
  },
  files: {
    // 预览页面使用一个可公开访问的真实三元相图图片
    'ternary_equilibrium.png': 'https://raw.githubusercontent.com/materialsproject/pymatgen/master/docs/img/phase_diagram.png',
    // JSON 文件用占位符（实际运行时会是 S3 presigned URL）
    'ternary_plotly.json': '',
  }
}

/** ⑥ 熔点/沸点 — 纯 Al（实际 CalphaMesh 返回格式） */
const mockBoiling = {
  task_type: 'boiling_point',
  status: 'completed',
  result: {
    data_summary: {
      columns: ['Component', 'Solidus/K', 'Liquidus/K', 'BubblePoint/K', 'DewPoint/K'],
      rows: [
        {
          Component: 'AL',
          'Solidus/K': 933.47,
          'Liquidus/K': 933.47,
          'BubblePoint/K': 2743.00,
          'DewPoint/K': 2743.00,
        }
      ],
      pressure: 101325,
    },
    derived_metrics: {
      solidus_K: 933.47,
      liquidus_K: 933.47,
      bubble_point_K: 2743.00,
      dew_point_K: 2743.00,
    }
  },
  files: {
    'boiling_melting_point.csv': '',
  }
}

/**
 * ⑦ 热力学性质曲线 — Al-Si-Mg-Fe-Mn, 500-950K
 * 模拟真实 CalphaMesh 后端输出格式（多相列名：GM(FCC_A1)/J/mol 等）
 */
const generateThermoRows = () => {
  const temps = [500, 525, 550, 575, 600, 625, 650, 675, 700, 725, 750, 775, 800, 825, 850, 875, 900, 925]
  return temps.map(T => {
    const x = (T - 500) / 425   // 归一化温度 0-1
    return {
      'T/K': T,
      'P/Pa': 100000,
      // 主相 FCC_A1（铝基体）的性质（用列名模拟实际 CSV 格式）
      'GM(FCC_A1)/J/mol':   -42500 - x * 21000,
      'HM(FCC_A1)/J/mol':    5200  + x * 7500,
      'SM(FCC_A1)/J/mol/K':  42.1  + x * 18,
      'CPM(FCC_A1)/J/mol/K': 28.6  + x * 3.3,
      // 液相（仅高温区出现）
      ...(T >= 900 ? {
        'GM(LIQUID)/J/mol':   -41000 - x * 22000,
        'HM(LIQUID)/J/mol':    8500  + x * 6000,
        'SM(LIQUID)/J/mol/K':  50    + x * 15,
        'CPM(LIQUID)/J/mol/K': 32,
      } : {}),
    }
  })
}
const thermoRows = generateThermoRows()
const mockThermoProps = {
  task_type: 'thermodynamic_properties',
  status: 'completed',
  result: {
    data_summary: {
      total_rows: 18,
      temperature_range: { start_K: 500, end_K: 925 },
      columns: Object.keys(thermoRows[0]),
      rows: thermoRows,
    },
    derived_metrics: {
      property_extrema: {
        'GM(FCC_A1)/J/mol': { min: { value: -63500 }, max: { value: -42500 } },
        'HM(FCC_A1)/J/mol': { min: { value: 5200 }, max: { value: 12700 } },
        'SM(FCC_A1)/J/mol/K': { min: { value: 42.1 }, max: { value: 60.1 } },
        'CPM(FCC_A1)/J/mol/K': { min: { value: 28.6 }, max: { value: 31.9 } },
      }
    }
  }
}

/** ⑧ ONNX 性能预测 */
const mockPerformance = {
  composition: 'Al-7.5Si-0.35Mg-0.1Fe',
  alloyLabel: 'Al-7.5Si-0.35Mg-0.1Fe',   // 供卡片头部显示
  tensile_strength: 334.1,
  yield_strength: 198.7,
  elongation: 11.2,
  hardness: 85.3,
}

// 从 mockScheilData.rawResult.shown_rows 解析 Scheil 曲线数据
// 复用与 toolResultHandler 相同的 NP(*) 解析逻辑
const scheilSeriesFromMock = computed(() => {
  const rows = mockScheilData.rawResult?.result?.data_summary?.shown_rows ?? []
  return rows.map(row => {
    const T = Number(row['T/K'] ?? 0)
    if (!T || T <= 0) return null
    // 从 NP(LIQUID) 列提取液相分数
    const liquid = Number(row['NP(LIQUID)'] ?? row['f(LIQUID)'] ?? 0)
    // 从 NP(*) 或 f(*) 列累加固相分数（排除液相和温压列）
    const solid = Object.entries(row)
      .filter(([k]) => {
        const u = k.toUpperCase()
        return (u.startsWith('NP(') || u.startsWith('F('))
          && u !== 'NP(LIQUID)' && u !== 'F(LIQUID)'
      })
      .reduce((s, [, v]) => s + Number(v || 0), 0)
    return { temperature: T, liquid, solid: solid > 0.001 ? solid : Math.max(0, 1 - liquid) }
  }).filter(Boolean)
})

// 当前 tab 对应的 mock 数据
const mockDataMap = {
  point:          mockPoint,
  phase_fraction: mockLineData,
  scheil:         mockScheilData,
  binary:         mockBinary,
  ternary:        mockTernary,
  boiling:        mockBoiling,
  thermo_props:   mockThermoProps,
  performance:    mockPerformance,
}
const currentMockData = computed(() => mockDataMap[activeTab.value] ?? {})
</script>

<style scoped>
.preview-page {
  min-height: 100vh;
  background: #f8fafc;
  padding: 24px;
  font-family: 'Inter', sans-serif;
}

.page-header {
  max-width: 900px;
  margin: 0 auto 24px;
}

.page-header h1 {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 6px;
}

.page-header p {
  font-size: 13px;
  color: #64748b;
  margin: 0 0 16px;
}

.page-header code {
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tab-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  border-color: #1967d2;
  color: #1967d2;
}

.tab-btn.active {
  background: #1967d2;
  color: #fff;
  border-color: #1967d2;
}

.preview-body {
  max-width: 900px;
  margin: 0 auto;
}

/* 模拟 result-card 外壳 */
.mock-result-card {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #eef2f6;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  overflow: hidden;
  margin-bottom: 16px;
}

.mock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  position: relative;
}

.mock-header::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #1967d2;
}

.mock-title {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  padding-left: 8px;
}

.mock-time {
  font-size: 10px;
  color: #94a3b8;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
}

.mock-body {
  padding: 12px;
}

/* Raw JSON 展示 */
.raw-json-wrap {
  margin-top: 8px;
}

.raw-json-wrap summary {
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  padding: 4px 0;
  user-select: none;
}

.raw-json-wrap summary:hover {
  color: #1967d2;
}

.raw-json {
  margin-top: 8px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  color: #475569;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
}
</style>
