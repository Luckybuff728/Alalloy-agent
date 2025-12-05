/**
 * 结果面板组件
 * 显示工具调用结果、推荐合金、性能预测等
 */

import { useState, useMemo } from 'react'
import { 
  FileText, BarChart3, Database, Cpu, Flame, Settings,
  Check, X, FileDown
} from 'lucide-react'
import clsx from 'clsx'
import { 
  PerformanceBarChart, 
  PerformanceRadarChart, 
  ThermoCompareChart,
  ScheilSolidificationChart,
  PhaseFractionChart,
  GibbsEnergyChart,
  type PerformanceData,
  type ThermoCompareData,
  type MultiScheilData,
  type MultiGibbsData,
  type PhaseFractionData
} from './PerformanceChart'
import { downloadPDFReport, getReportSummary } from '../../utils/pdfGenerator'
import './ResultsPanel.css'

// ================================
// 类型定义
// ================================

export interface ToolResult {
  tool_name: string
  tool_type: 'database' | 'ml_model' | 'simulation'
  input?: any              // 工具输入参数
  result: any              // 工具输出结果
  success: boolean
  node?: string
  timestamp?: number
  composition?: string     // 合金成分
  calculation_type?: string // 热力学计算类型 (point/line/scheil)
}

interface ResultsPanelProps {
  /** 工具调用结果 */
  toolResults: ToolResult[]
  /** 推荐合金列表 */
  recommendedAlloys: string[]
  /** 性能预测数据 */
  performanceData: PerformanceData[]
  /** 分析结果 */
  analysisResults: any[]
  /** 热力学数据 */
  thermoData?: { composition: string; data: any }[]
  /** 最终报告 */
  finalReport?: string
}

/**
 * 结果面板主组件
 */
export function ResultsPanel({ 
  toolResults, 
  recommendedAlloys, 
  performanceData,
  analysisResults,
  thermoData = [],
  finalReport = ''
}: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState<'tools' | 'charts' | 'report'>('tools')
  
  const hasContent = toolResults.length > 0 || 
                     recommendedAlloys.length > 0 || 
                     performanceData.length > 0 ||
                     analysisResults.length > 0 ||
                     thermoData.length > 0

  return (
    <div className="results-panel">
      {/* 面板标题 */}
      <div className="panel-header">
        <span className="panel-title">分析结果</span>
      </div>
      
      {/* 标签切换 */}
      <div className="panel-tabs">
        <button 
          className={clsx("panel-tab", activeTab === 'tools' && "active")}
          onClick={() => setActiveTab('tools')}
        >
          <FileText size={16} />
          <span>结果</span>
          {toolResults.length > 0 && (
            <span className="tab-badge">{toolResults.length}</span>
          )}
        </button>
        <button 
          className={clsx("panel-tab", activeTab === 'charts' && "active")}
          onClick={() => setActiveTab('charts')}
        >
          <BarChart3 size={16} />
          <span>图表</span>
        </button>
        <button 
          className={clsx("panel-tab", activeTab === 'report' && "active")}
          onClick={() => setActiveTab('report')}
        >
          <FileDown size={16} />
          <span>报告</span>
          {finalReport && <span className="tab-badge-dot" />}
        </button>
      </div>

      {/* 内容区域 - 使用 CSS 隐藏而非卸载，保持组件状态和缓存 */}
      <div className="panel-body">
        <div className={clsx("tab-content", activeTab !== 'tools' && "hidden")}>
          {hasContent ? (
            <ToolsView 
              toolResults={toolResults}
              recommendedAlloys={recommendedAlloys}
              analysisResults={analysisResults}
            />
          ) : (
            <EmptyState icon={<FileText size={48} />} text="分析结果将在此显示" />
          )}
        </div>
        
        <div className={clsx("tab-content", activeTab !== 'charts' && "hidden")}>
          <ChartsView performanceData={performanceData} toolResults={toolResults} />
        </div>
        
        <div className={clsx("tab-content", activeTab !== 'report' && "hidden")}>
          <ReportView 
            finalReport={finalReport} 
            recommendedAlloys={recommendedAlloys}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * 工具结果视图
 */
function ToolsView({ 
  toolResults, 
  recommendedAlloys, 
  analysisResults,
}: Omit<ResultsPanelProps, 'performanceData' | 'thermoData'>) {
  // 分离不同类型的工具结果，避免重复显示
  const dbResults = toolResults.filter(r => r.tool_type === 'database')
  const mlResults = toolResults.filter(r => r.tool_type === 'ml_model')
  const thermoResults = toolResults.filter(r => r.tool_type === 'simulation')
  
  return (
    <div className="tools-view">
      {/* 数据库查询结果 */}
      {dbResults.length > 0 && (
        <ResultSection title="数据库查询" count={dbResults.length}>
          {dbResults.map((result, idx) => (
            <ToolResultCard key={idx} result={result} />
          ))}
        </ResultSection>
      )}

      {/* 推荐合金 */}
      {recommendedAlloys.length > 0 && (
        <ResultSection title="推荐合金">
          <div className="alloy-list">
            {recommendedAlloys.map((alloy, idx) => (
              <span key={idx} className="alloy-chip">{alloy}</span>
            ))}
          </div>
        </ResultSection>
      )}

      {/* 性能预测结果（ML 模型） */}
      {mlResults.length > 0 && (
        <ResultSection title="性能预测" count={mlResults.length}>
          {mlResults.map((result, idx) => (
            <ToolResultCard key={idx} result={result} />
          ))}
        </ResultSection>
      )}

      {/* 热力学计算结果（实时显示每个完成的任务） */}
      {thermoResults.length > 0 && (
        <ResultSection title="热力学计算" count={thermoResults.length}>
          {thermoResults.map((result, idx) => (
            <ToolResultCard key={idx} result={result} />
          ))}
        </ResultSection>
      )}

      {/* 分析结果 */}
      {analysisResults.length > 0 && (
        <ResultSection title="详细分析">
          {analysisResults.map((result, idx) => (
            <AnalysisCard key={idx} data={result} />
          ))}
        </ResultSection>
      )}
    </div>
  )
}

/**
 * 图表视图 - 显示性能和热力学图表
 * 所有图表都支持多合金对比显示
 * 使用 useMemo 缓存数据处理，优化性能
 */
function ChartsView({ performanceData, toolResults }: { 
  performanceData: PerformanceData[]
  toolResults: ToolResult[]
}) {
  // 使用 useMemo 缓存热力学结果筛选
  const { scheilResults, lineResults } = useMemo(() => ({
    scheilResults: toolResults.filter(r => r.tool_type === 'simulation' && r.calculation_type === 'scheil'),
    lineResults: toolResults.filter(r => r.tool_type === 'simulation' && r.calculation_type === 'line')
  }), [toolResults])
  
  // 1. 缓存关键温度数据
  const thermoCompareData = useMemo(() => {
    const data: ThermoCompareData[] = []
    scheilResults.forEach(r => {
      const resultData = r.result?.data || r.result || {}
      if (resultData.liquidus_temp && r.composition) {
        data.push({
          composition: r.composition,
          liquidus: resultData.liquidus_temp,
          solidus: resultData.solidus_temp,
        })
      }
    })
    return data
  }, [scheilResults])
  
  // 2. 缓存多合金 Scheil 数据
  const multiScheilData = useMemo(() => {
    return scheilResults
      .filter(r => r.composition && r.result?.raw_data)
      .map(r => {
        const rawData = r.result.raw_data || {}
        const temperatures = rawData['T'] || []
        const fs = rawData['fs'] || []
        const fl = rawData['fl'] || []
        
        const data = temperatures.map((t: string, i: number) => ({
          temperature: parseFloat(t) || 0,
          liquid: parseFloat(fl[i]) || 0,
          solid: parseFloat(fs[i]) || 0,
        })).filter((d: any) => d.temperature > 0)
        
        return { composition: r.composition!, data }
      })
      .filter(m => m.data.length > 0) as MultiScheilData[]
  }, [scheilResults])
  
  // 3. 缓存多合金吉布斯能数据
  const multiGibbsData = useMemo(() => {
    return lineResults
      .filter(r => r.composition && r.result?.raw_data)
      .map(r => {
        const rawData = r.result.raw_data || {}
        const temperatures = rawData['Temperature'] || []
        const gibbsKeys = Object.keys(rawData).filter(k => k.startsWith('Gibbs[global]<'))
        const phases = gibbsKeys.map(k => k.match(/<(\w+)>/)?.[1] || k)
        
        const data = temperatures.map((t: string, i: number) => {
          const point: any = { temperature: parseFloat(t) || 0 }
          gibbsKeys.forEach((k, idx) => {
            const val = rawData[k]?.[i]
            if (val && val !== '') {
              point[phases[idx]] = parseFloat(val)
            }
          })
          return point
        }).filter((d: any) => d.temperature > 0)
        
        return { composition: r.composition!, data, phases }
      })
      .filter(m => m.data.length > 0 && m.phases.length > 0) as MultiGibbsData[]
  }, [lineResults])
  
  // 4. 缓存各合金的相分数数据（每个合金单独展示）
  const phaseFractionDataList = useMemo(() => {
    return scheilResults
      .filter(r => r.composition && r.result?.raw_data)
      .map(r => {
        const rawData = r.result.raw_data || {}
        const temperatures = rawData['T'] || []
        
        // 查找相分数字段（f(@XXX) 格式）
        const phaseKeys = Object.keys(rawData).filter(k => 
          k.startsWith('f(@') && !k.includes('f_tot')
        )
        const phases = phaseKeys.map(k => k.match(/f\(@(\w+)\)/)?.[1] || k)
        
        if (phaseKeys.length === 0 || temperatures.length === 0) {
          return null
        }
        
        const data: PhaseFractionData[] = temperatures.map((t: string, i: number) => {
          const point: PhaseFractionData = { temperature: parseFloat(t) || 0 }
          phaseKeys.forEach((k, idx) => {
            const val = rawData[k]?.[i]
            point[phases[idx]] = val ? parseFloat(val) : 0
          })
          return point
        }).filter((d: PhaseFractionData) => d.temperature > 0)
        
        return { composition: r.composition!, data, phases }
      })
      .filter(Boolean) as { composition: string; data: PhaseFractionData[]; phases: string[] }[]
  }, [scheilResults])
  
  // 缓存状态判断
  const { hasPerf, hasThermo, hasScheil, hasGibbs, hasPhaseFraction, hasData } = useMemo(() => ({
    hasPerf: performanceData.length > 0,
    hasThermo: thermoCompareData.length > 0,
    hasScheil: multiScheilData.length > 0,
    hasGibbs: multiGibbsData.length > 0,
    hasPhaseFraction: phaseFractionDataList.length > 0,
    hasData: performanceData.length > 0 || thermoCompareData.length > 0 || 
             multiScheilData.length > 0 || multiGibbsData.length > 0 ||
             phaseFractionDataList.length > 0
  }), [performanceData, thermoCompareData, multiScheilData, multiGibbsData, phaseFractionDataList])
  
  if (!hasData) {
    return <EmptyState icon={<BarChart3 size={48} />} text="暂无图表数据" />
  }
  
  return (
    <div className="charts-view">
      {/* 性能对比图表（所有合金） */}
      {hasPerf && (
        <>
          <PerformanceRadarChart data={performanceData} />
          <PerformanceBarChart data={performanceData} />
        </>
      )}
      
      {/* 热力学关键温度对比（所有合金） */}
      {hasThermo && (
        <ThermoCompareChart data={thermoCompareData} />
      )}
      
      {/* Scheil 凝固曲线（多合金对比） */}
      {hasScheil && (
        <ScheilSolidificationChart 
          multiData={multiScheilData} 
          title="Scheil 凝固曲线对比"
        />
      )}
      
      {/* 吉布斯能曲线（多合金对比） */}
      {hasGibbs && (
        <GibbsEnergyChart 
          multiData={multiGibbsData}
          title="吉布斯能对比 (Fcc相)"
        />
      )}
      
      {/* 各合金的相分数演化（每个合金一个图表） */}
      {hasPhaseFraction && phaseFractionDataList.map(item => (
        <PhaseFractionChart
          key={item.composition}
          data={item.data}
          phases={item.phases}
          title={`相分数演化 (${item.composition})`}
        />
      ))}
    </div>
  )
}

/**
 * 结果区域标题
 */
function ResultSection({ 
  title, 
  count, 
  children 
}: { 
  title: string
  count?: number
  children: React.ReactNode 
}) {
  return (
    <div className="result-section">
      <h3 className="result-title">
        {title}
        {count !== undefined && <span className="result-count">({count})</span>}
      </h3>
      {children}
    </div>
  )
}

/**
 * 渲染热力学计算结果
 * 根据不同的计算类型（point/line/scheil）显示不同的关键信息
 * 
 * 后端返回的 data 格式（经 _parse_calphad_result_data 解析）：
 * - Point: {phases: ["Liquid"], temperature: [1000], gibbs_energy: -43507.47}
 * - Line: {phases: ["Fcc", "Liquid"], temp_range: [298, 1000], temp_count: 50}
 * - Scheil: {phase_sequence: ["Fcc", "Fcc+Diamond", ...], temp_range: [...], total_steps: 100}
 */
function renderThermoResult(data: any, calcType?: string): React.ReactNode {
  // 检查是否有错误
  if (data.error) {
    return (
      <div className="error-message">
        {data.error}
      </div>
    )
  }
  
  // 获取实际数据（可能在 data 字段中嵌套）
  const actualData = data.data || data
  
  // 根据计算类型分别处理
  switch (calcType) {
    case 'point': {
      // 点计算：显示平衡相、温度、各相吉布斯能
      const equilibriumPhases = actualData.equilibrium_phases
      const temperature = actualData.temperature
      const gibbsEnergy = actualData.gibbs_energy || {}
      const stablePhase = actualData.stable_phase
      
      return (
        <div className="thermo-result">
          {/* 计算温度 */}
          {temperature && (
            <div className="thermo-temp">
              计算温度: <strong>{typeof temperature === 'number' ? temperature.toFixed(0) : temperature} K</strong>
              <span className="temp-note">({(Number(temperature) - 273.15).toFixed(0)}°C)</span>
            </div>
          )}
          
          {/* 平衡相 */}
          {equilibriumPhases && (
            <div className="thermo-equilibrium">
              平衡相: <strong>{equilibriumPhases}</strong>
            </div>
          )}
          
          {/* 各相吉布斯能 */}
          {Object.keys(gibbsEnergy).length > 0 && (
            <div className="thermo-gibbs-detail">
              <span className="phase-label">吉布斯能 (J/mol):</span>
              <div className="gibbs-list">
                {Object.entries(gibbsEnergy).map(([phase, energy]: [string, any], idx) => (
                  <span key={idx} className={`gibbs-item ${phase === stablePhase ? 'stable' : ''}`}>
                    {phase}: {energy.toFixed(1)}
                    {phase === stablePhase && <span className="stable-tag">稳定</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )
    }
    
    case 'line': {
      // 线计算：显示温度扫描结果、相演化、液相线温度
      const tempRange = actualData.temp_range
      const tempCount = actualData.temp_count
      const phases = actualData.phases || []
      const phaseEvolution = actualData.phase_evolution || []
      const liquidusTemp = actualData.liquidus_temp
      const gibbsEnergy = actualData.gibbs_energy || {}
      
      return (
        <div className="thermo-result">
          {/* 温度范围 */}
          {tempRange && Array.isArray(tempRange) && (
            <div className="thermo-range">
              温度扫描: <strong>{tempRange[0]?.toFixed(0)} → {tempRange[1]?.toFixed(0)} K</strong>
              {tempCount > 0 && <span className="temp-count">({tempCount}点)</span>}
            </div>
          )}
          
          {/* 液相线温度（重要指标） */}
          {liquidusTemp && (
            <div className="thermo-liquidus">
              液相线温度: <strong>{liquidusTemp.toFixed(0)} K</strong>
              <span className="temp-note">({(liquidusTemp - 273.15).toFixed(0)}°C)</span>
            </div>
          )}
          
          {/* 相演化过程 */}
          {phaseEvolution.length > 0 && (
            <div className="thermo-evolution">
              <span className="phase-label">相演化:</span>
              <div className="evolution-flow">
                {phaseEvolution.map((phase: string, idx: number) => (
                  <span key={idx} className="evolution-step">
                    <span className="phase-chip">{phase}</span>
                    {idx < phaseEvolution.length - 1 && <span className="evolution-arrow">→</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* 涉及的相 */}
          {phases.length > 0 && phaseEvolution.length === 0 && (
            <div className="thermo-phases">
              <span className="phase-label">涉及相:</span>
              <div className="phase-list">
                {phases.slice(0, 6).map((phase: string, idx: number) => (
                  <span key={idx} className="phase-chip">{phase}</span>
                ))}
              </div>
            </div>
          )}
          
          {/* 吉布斯能范围 */}
          {Object.keys(gibbsEnergy).length > 0 && (
            <div className="thermo-gibbs-summary">
              <span className="phase-label">吉布斯能 (J/mol):</span>
              <div className="gibbs-list">
                {Object.entries(gibbsEnergy).map(([phase, data]: [string, any], idx) => (
                  <span key={idx} className="gibbs-item">
                    {phase}: {data.min.toFixed(0)} ~ {data.max.toFixed(0)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )
    }
    
    case 'scheil': {
      // Scheil 凝固计算：显示凝固路径、温度、各相分数
      const phaseSequence = actualData.phase_sequence || []
      const liquidusTemp = actualData.liquidus_temp
      const solidusTemp = actualData.solidus_temp
      const totalSteps = actualData.total_steps
      const solidFraction = actualData.final_solid_fraction
      const phaseFractions = actualData.phase_fractions || {}
      
      return (
        <div className="thermo-result">
          {/* 凝固温度范围 */}
          {liquidusTemp && solidusTemp && (
            <div className="thermo-solidification">
              <div className="solidification-temps">
                <span className="temp-item">
                  液相线: <strong>{liquidusTemp.toFixed(0)} K</strong>
                  <span className="temp-note">({(liquidusTemp - 273.15).toFixed(0)}°C)</span>
                </span>
                <span className="temp-arrow">→</span>
                <span className="temp-item">
                  固相线: <strong>{solidusTemp.toFixed(0)} K</strong>
                  <span className="temp-note">({(solidusTemp - 273.15).toFixed(0)}°C)</span>
                </span>
              </div>
            </div>
          )}
          
          {/* 凝固统计 */}
          <div className="solidification-stats">
            {totalSteps > 0 && (
              <span className="stat-item">凝固步数: <strong>{totalSteps}</strong></span>
            )}
            {solidFraction !== undefined && (
              <span className="stat-item">最终固相: <strong>{(solidFraction * 100).toFixed(1)}%</strong></span>
            )}
          </div>
          
          {/* 各相最终分数 */}
          {Object.keys(phaseFractions).length > 0 && (
            <div className="thermo-phase-fractions">
              <span className="phase-label">相分数:</span>
              <div className="fraction-grid">
                {Object.entries(phaseFractions).map(([phase, data]: [string, any], idx) => (
                  <span key={idx} className="fraction-item">
                    {phase}: <strong>{(data.final * 100).toFixed(1)}%</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* 相演化序列 */}
          {phaseSequence.length > 0 && (
            <div className="thermo-evolution">
              <span className="phase-label">凝固路径:</span>
              <div className="evolution-flow">
                {phaseSequence.slice(0, 4).map((phase: string, idx: number) => (
                  <span key={idx} className="evolution-step">
                    <span className="phase-chip small">{phase}</span>
                    {idx < Math.min(phaseSequence.length, 4) - 1 && <span className="evolution-arrow">→</span>}
                  </span>
                ))}
                {phaseSequence.length > 4 && <span className="phase-more">...</span>}
              </div>
            </div>
          )}
        </div>
      )
    }
  }
  
  // 兜底：尝试智能检测数据结构
  const phases = actualData.phases || actualData.phase_sequence || []
  if (phases.length > 0) {
    return (
      <div className="thermo-result">
        <div className="thermo-phases">
          <span className="phase-label">相:</span>
          <div className="phase-list">
            {phases.slice(0, 6).map((phase: string, idx: number) => (
              <span key={idx} className="phase-chip">{phase}</span>
            ))}
            {phases.length > 6 && <span className="phase-more">+{phases.length - 6}</span>}
          </div>
        </div>
      </div>
    )
  }
  
  // 最终兜底
  return (
    <div className="thermo-result">
      <div className="result-summary">计算完成</div>
    </div>
  )
}

/**
 * 工具调用结果卡片（简洁版，只显示关键结果）
 */
function ToolResultCard({ result }: { result: ToolResult }) {
  const getToolIcon = () => {
    switch (result.tool_type) {
      case 'database': return <Database size={16} />
      case 'ml_model': return <Cpu size={16} />
      case 'simulation': return <Flame size={16} />
      default: return <Settings size={16} />
    }
  }

  // 渲染结果内容（只显示解析后的关键数据）
  const renderContent = () => {
    const data = result.result
    if (!data) return <div className="no-data">无数据</div>
    
    // 如果有错误，显示错误信息
    if (data.error || data.parse_error) {
      return (
        <div className="error-message">
          {data.error || data.parse_error}
        </div>
      )
    }
    
    // 性能数据（ONNX 预测结果）
    const uts = data.UTS || data.tensile_strength || data.uts
    const ys = data.YS || data.yield_strength || data.ys
    const el = data.EL || data.elongation || data.el
    const hv = data.HV || data.hardness || data.hv
    
    if (uts || ys || el || hv) {
      return (
        <div className="metrics-grid">
          {uts && <MetricItem label="抗拉强度" value={uts} unit="MPa" />}
          {ys && <MetricItem label="屈服强度" value={ys} unit="MPa" />}
          {el && <MetricItem label="延伸率" value={el} unit="%" />}
          {hv && <MetricItem label="硬度" value={hv} unit="HV" />}
        </div>
      )
    }
    
    // IDME 查询结果
    if (data.data && Array.isArray(data.data)) {
      const count = data.data.length
      return (
        <div className="idme-result">
          <div className="result-summary">查询到 <strong>{count}</strong> 条相关数据</div>
        </div>
      )
    }
    
    // 热力学计算结果 - 根据计算类型显示不同内容
    if (result.tool_type === 'simulation') {
      return renderThermoResult(data, result.calculation_type)
    }
    
    // 数组类型
    if (Array.isArray(data)) {
      return (
        <div className="result-summary">返回 <strong>{data.length}</strong> 条结果</div>
      )
    }
    
    // 其他情况显示简洁提示
    return <div className="result-summary">处理完成</div>
  }

  return (
    <div className={clsx("tool-result-card", result.tool_type, !result.success && "error")}>
      <div className="tool-result-header">
        <div className={clsx("tool-result-icon", result.tool_type)}>
          {getToolIcon()}
        </div>
        <div className="tool-result-info">
          <div className="tool-result-name">
            {result.tool_name}
            {result.composition && (
              <span className="composition-tag">{result.composition}</span>
            )}
          </div>
        </div>
        <span className={clsx("status-indicator", result.success ? "success" : "error")}>
          {result.success ? <Check size={14} /> : <X size={14} />}
        </span>
      </div>
      <div className="tool-result-content">
        {renderContent()}
      </div>
    </div>
  )
}

/**
 * 指标项
 */
function MetricItem({ label, value, unit }: { label: string; value: number; unit: string }) {
  const displayValue = typeof value === 'number' ? value.toFixed(1) : value
  return (
    <div className="metric-item">
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {displayValue}
        <span className="metric-unit">{unit}</span>
      </div>
    </div>
  )
}

/**
 * 分析结果卡片
 */
function AnalysisCard({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="analysis-card">
      <div className="analysis-header" onClick={() => setExpanded(!expanded)}>
        <span className="analysis-composition">{data.composition}</span>
        <span className="analysis-type">{data.calculation_type || 'scheil'}</span>
      </div>
      
      {expanded && (
        <div className="analysis-details">
          {data.interpretation && (
            <div className="interpretation">{data.interpretation}</div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 报告视图 - 显示最终报告摘要和下载按钮
 */
function ReportView({ 
  finalReport, 
  recommendedAlloys 
}: { 
  finalReport: string
  recommendedAlloys: string[] 
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  
  // 处理 PDF 下载
  const handleDownload = async () => {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      await downloadPDFReport({
        title: '铝合金智能设计分析报告',
        company: '顶材科技',
        content: finalReport,
        alloys: recommendedAlloys
      })
    } finally {
      setIsDownloading(false)
    }
  }
  
  if (!finalReport) {
    return (
      <div className="report-view">
        <div className="report-empty">
          <FileDown size={48} className="report-empty-icon" />
          <p>报告生成后将在此显示</p>
          <span className="report-empty-hint">完成分析后可下载 PDF 报告</span>
        </div>
      </div>
    )
  }
  
  // 获取报告摘要
  const summary = getReportSummary(finalReport, 300)
  
  // 格式化当前时间
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  
  return (
    <div className="report-view">
      {/* 报告信息卡片 */}
      <div className="report-card">
        <div className="report-header">
          <div className="report-title">
            <FileText size={20} />
            <span>铝合金智能设计分析报告</span>
          </div>
          <div className="report-meta">
            <span className="report-company">顶材科技</span>
            <span className="report-date">{dateStr}</span>
          </div>
        </div>
        
        {/* 推荐合金 */}
        {recommendedAlloys.length > 0 && (
          <div className="report-alloys">
            <span className="report-alloys-label">推荐合金：</span>
            {recommendedAlloys.map((alloy, idx) => (
              <span key={idx} className="report-alloy-tag">{alloy}</span>
            ))}
          </div>
        )}
        
        {/* 报告摘要 */}
        <div className="report-summary">
          <p>{summary}</p>
        </div>
        
        {/* 操作按钮 */}
        <div className="report-actions">
          <button 
            className="report-btn report-btn-primary" 
            onClick={handleDownload}
            disabled={isDownloading}
          >
            <FileDown size={16} />
            <span>{isDownloading ? '生成中...' : '下载 PDF 报告'}</span>
          </button>
        </div>
      </div>
      
      {/* 说明文字 */}
      <div className="report-note">
        <p>📄 完整报告内容请查看对话面板或下载 PDF 文件</p>
      </div>
    </div>
  )
}

/**
 * 空状态
 */
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="empty-results">
      <div className="empty-icon">{icon}</div>
      <p>{text}</p>
    </div>
  )
}

export default ResultsPanel
