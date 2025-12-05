/**
 * 性能数据图表组件
 * 使用 Recharts 展示合金性能预测结果
 * 支持多合金对比，带数据采样优化性能
 */

import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
} from 'recharts'

// ================================
// 性能优化：数据采样函数
// ================================

/**
 * 对数据进行均匀采样，限制最大数据点数量
 * 保留首尾点，中间均匀采样
 */
function sampleData<T>(data: T[], maxPoints: number = 100): T[] {
  if (data.length <= maxPoints) return data
  
  const result: T[] = []
  const step = (data.length - 1) / (maxPoints - 1)
  
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step)
    result.push(data[idx])
  }
  
  return result
}

// ================================
// 类型定义
// ================================

export interface PerformanceData {
  /** 合金成分 */
  composition: string
  /** 抗拉强度 (MPa) */
  tensile_strength?: number
  /** 屈服强度 (MPa) */
  yield_strength?: number
  /** 延伸率 (%) */
  elongation?: number
  /** 硬度 (HV) */
  hardness?: number
  /** 密度 (g/cm³) */
  density?: number
  /** 热导率 (W/m·K) */
  thermal_conductivity?: number
}

export interface ThermoData {
  /** 温度 (°C) */
  temperature: number
  /** 液相分数 */
  liquid_fraction?: number
  /** 固相分数 */
  solid_fraction?: number
}

interface PerformanceChartProps {
  /** 性能数据列表 */
  data: PerformanceData[]
  /** 图表类型 */
  type?: 'bar' | 'radar' | 'comparison'
  /** 自定义类名 */
  className?: string
}

interface ThermoChartProps {
  /** 热力学数据 */
  data: ThermoData[]
  /** 自定义类名 */
  className?: string
}

// ================================
// 颜色配置
// ================================

const COLORS = [
  '#1967d2', // 主蓝色
  '#34a853', // 绿色
  '#f9ab00', // 橙色
  '#8b5cf6', // 紫色
  '#ea4335', // 红色
  '#4285f4', // 浅蓝
]

const PROPERTY_LABELS: Record<string, string> = {
  tensile_strength: '抗拉强度',
  yield_strength: '屈服强度',
  elongation: '延伸率',
  hardness: '硬度',
  density: '密度',
  thermal_conductivity: '热导率',
}

// ================================
// 柱状图组件
// ================================

export function PerformanceBarChart({ data, className = '' }: PerformanceChartProps) {
  // 转换数据格式用于柱状图（不显示硬度）
  const chartData = data.map(item => ({
    name: item.composition,
    '抗拉强度': item.tensile_strength || 0,
    '屈服强度': item.yield_strength || 0,
    '延伸率': (item.elongation || 0) * 10, // 放大以便显示
  }))

  return (
    <div className={`chart-container ${className}`}>
      <h4 className="chart-title">性能对比 (柱状图)</h4>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 12, fill: '#5f6368' }}
            axisLine={{ stroke: '#dadce0' }}
          />
          <YAxis 
            tick={{ fontSize: 12, fill: '#5f6368' }}
            axisLine={{ stroke: '#dadce0' }}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #dadce0',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          />
          <Legend />
          <Bar dataKey="抗拉强度" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          <Bar dataKey="屈服强度" fill={COLORS[1]} radius={[4, 4, 0, 0]} />
          <Bar dataKey="延伸率" fill={COLORS[2]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ================================
// 雷达图组件 - 多维性能对比
// ================================

export function PerformanceRadarChart({ data, className = '' }: PerformanceChartProps) {
  if (data.length === 0) return null
  
  // 准备雷达图数据 - 归一化到 0-100（不显示硬度）
  const properties = ['tensile_strength', 'yield_strength', 'elongation']
  const maxValues: Record<string, number> = {}
  
  properties.forEach(prop => {
    maxValues[prop] = Math.max(...data.map(d => (d as any)[prop] || 0), 1)
  })
  
  const radarData = properties.map(prop => {
    const entry: any = { property: PROPERTY_LABELS[prop] || prop }
    data.forEach((item) => {
      const value = (item as any)[prop] || 0
      entry[item.composition] = Math.round((value / maxValues[prop]) * 100)
    })
    return entry
  })

  return (
    <div className={`chart-container ${className}`}>
      <h4 className="chart-title">多维性能对比 (雷达图)</h4>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={radarData}>
          <PolarGrid stroke="#e8eaed" />
          <PolarAngleAxis 
            dataKey="property" 
            tick={{ fontSize: 12, fill: '#5f6368' }}
          />
          <PolarRadiusAxis 
            angle={90} 
            domain={[0, 100]} 
            tick={{ fontSize: 10, fill: '#9aa0a6' }}
          />
          {data.map((item, idx) => (
            <Radar
              key={`${item.composition}-${idx}`}
              name={item.composition}
              dataKey={item.composition}
              stroke={COLORS[idx % COLORS.length]}
              fill={COLORS[idx % COLORS.length]}
              fillOpacity={0.2}
              strokeWidth={2}
            />
          ))}
          <Legend />
          <Tooltip />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ================================
// 单个合金性能卡片
// ================================

export function PerformanceCard({ data, className = '' }: { data: PerformanceData, className?: string }) {
  // 不显示硬度
  const properties = [
    { key: 'tensile_strength', label: '抗拉强度', unit: 'MPa', max: 500 },
    { key: 'yield_strength', label: '屈服强度', unit: 'MPa', max: 400 },
    { key: 'elongation', label: '延伸率', unit: '%', max: 30 },
  ]

  return (
    <div className={`performance-card ${className}`}>
      <h4 className="card-title">{data.composition}</h4>
      <div className="property-list">
        {properties.map(prop => {
          const value = (data as any)[prop.key] || 0
          const percentage = Math.min((value / prop.max) * 100, 100)
          
          return (
            <div key={prop.key} className="property-item">
              <div className="property-header">
                <span className="property-label">{prop.label}</span>
                <span className="property-value">{value.toFixed(1)} {prop.unit}</span>
              </div>
              <div className="property-bar">
                <div 
                  className="property-fill" 
                  style={{ 
                    width: `${percentage}%`,
                    backgroundColor: percentage > 70 ? '#34a853' : percentage > 40 ? '#f9ab00' : '#1967d2'
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ================================
// 热力学曲线图 - Scheil 凝固曲线（支持多合金对比）
// ================================

export interface ScheilData {
  /** 温度 (K) */
  temperature: number
  /** 液相分数 */
  liquid: number
  /** 固相分数 */
  solid: number
}

/** 多合金 Scheil 数据 */
export interface MultiScheilData {
  composition: string
  data: ScheilData[]
}

interface ScheilChartProps {
  /** 单合金数据（兼容旧接口） */
  data?: ScheilData[]
  /** 多合金数据 */
  multiData?: MultiScheilData[]
  title?: string
  className?: string
}

export function ScheilSolidificationChart({ data, multiData, title = 'Scheil 凝固曲线', className = '' }: ScheilChartProps) {
  // 使用 useMemo 缓存处理后的数据
  const chartData = useMemo(() => {
    // 多合金模式
    if (multiData && multiData.length > 0) {
      // 找出所有温度点的并集，然后采样
      const allTemps = new Set<number>()
      multiData.forEach(m => m.data.forEach(d => allTemps.add(d.temperature)))
      const sortedTemps = sampleData(Array.from(allTemps).sort((a, b) => b - a), 120)
      
      return sortedTemps.map(temp => {
        const point: any = { temperature: temp }
        multiData.forEach(m => {
          // 找最近的温度点
          const closest = m.data.reduce((prev, curr) => 
            Math.abs(curr.temperature - temp) < Math.abs(prev.temperature - temp) ? curr : prev
          )
          if (Math.abs(closest.temperature - temp) < 10) {
            point[`${m.composition}_liquid`] = closest.liquid
            point[`${m.composition}_solid`] = closest.solid
          }
        })
        return point
      })
    }
    
    // 单合金模式
    if (data && data.length > 0) {
      return sampleData(data, 120)
    }
    
    return []
  }, [data, multiData])
  
  if (chartData.length === 0) return null
  
  // 获取所有合金名称
  const alloys = multiData?.map(m => m.composition) || []
  const isMulti = alloys.length > 0
  
  return (
    <div className={`chart-container ${className}`}>
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
          <XAxis 
            dataKey="temperature" 
            label={{ value: '温度 (K)', position: 'bottom', offset: 35 }}
            tick={{ fontSize: 10, fill: '#5f6368' }}
            axisLine={{ stroke: '#dadce0' }}
            reversed
            tickCount={6}
            tickFormatter={(v) => Number(v).toFixed(0)}
          />
          <YAxis 
            domain={[0, 1]}
            label={{ value: '相分数', angle: -90, position: 'insideLeft' }}
            tick={{ fontSize: 11, fill: '#5f6368' }}
            axisLine={{ stroke: '#dadce0' }}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #dadce0', borderRadius: '8px' }}
            formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
            labelFormatter={(label) => `温度: ${Number(label).toFixed(1)} K`}
          />
          <Legend verticalAlign="top" height={36} />
          
          {isMulti ? (
            // 多合金模式：每个合金一条固相线
            alloys.map((alloy, idx) => (
              <Line 
                key={alloy}
                type="monotone" 
                dataKey={`${alloy}_solid`}
                name={`${alloy} 固相`}
                stroke={COLORS[idx % COLORS.length]} 
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))
          ) : (
            // 单合金模式
            <>
              <Line type="monotone" dataKey="liquid" name="液相" stroke={COLORS[0]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="solid" name="固相" stroke={COLORS[1]} strokeWidth={2} dot={false} />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ================================
// 相分数随温度变化图（带数据采样）
// ================================

export interface PhaseFractionData {
  temperature: number
  [phase: string]: number
}

interface PhaseFractionChartProps {
  data: PhaseFractionData[]
  phases: string[]
  title?: string
  className?: string
}

export function PhaseFractionChart({ data, phases, title = '相分数-温度曲线', className = '' }: PhaseFractionChartProps) {
  // 数据采样优化性能
  const sampledData = useMemo(() => sampleData(data, 100), [data])
  
  if (sampledData.length === 0 || phases.length === 0) return null
  
  return (
    <div className={`chart-container ${className}`}>
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={sampledData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
          <XAxis 
            dataKey="temperature"
            label={{ value: '温度 (K)', position: 'bottom', offset: 35 }}
            tick={{ fontSize: 10, fill: '#5f6368' }}
            reversed
            tickCount={6}
            tickFormatter={(v) => Number(v).toFixed(0)}
          />
          <YAxis 
            domain={[0, 1]}
            label={{ value: '相分数', angle: -90, position: 'insideLeft' }}
            tick={{ fontSize: 11, fill: '#5f6368' }}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          />
          <Tooltip 
            formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
            labelFormatter={(label) => `温度: ${Number(label).toFixed(1)} K`}
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #dadce0', borderRadius: '8px' }}
          />
          <Legend verticalAlign="top" height={36} />
          {phases.map((phase, idx) => (
            <Line 
              key={phase}
              type="monotone" 
              dataKey={phase}
              name={phase}
              stroke={COLORS[idx % COLORS.length]} 
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ================================
// 吉布斯能对比图（支持多合金）
// ================================

export interface GibbsData {
  temperature: number
  [phase: string]: number
}

/** 多合金吉布斯能数据 */
export interface MultiGibbsData {
  composition: string
  data: GibbsData[]
  phases: string[]
}

interface GibbsChartProps {
  /** 单合金数据（兼容旧接口） */
  data?: GibbsData[]
  phases?: string[]
  /** 多合金数据 */
  multiData?: MultiGibbsData[]
  title?: string
  className?: string
}

export function GibbsEnergyChart({ data, phases, multiData, title = '吉布斯能-温度曲线', className = '' }: GibbsChartProps) {
  // 使用 useMemo 缓存处理后的数据
  const { chartData, lineKeys } = useMemo(() => {
    // 多合金模式：只显示每个合金的 Fcc 相（主要相）进行对比
    if (multiData && multiData.length > 0) {
      const allTemps = new Set<number>()
      multiData.forEach(m => m.data.forEach(d => allTemps.add(d.temperature)))
      const sortedTemps = sampleData(Array.from(allTemps).sort((a, b) => a - b), 100)
      
      const keys: string[] = []
      const processed = sortedTemps.map(temp => {
        const point: any = { temperature: temp }
        multiData.forEach(m => {
          // 取第一个有效相（通常是 Fcc）
          const mainPhase = m.phases[0]
          if (mainPhase) {
            const key = `${m.composition}`
            if (!keys.includes(key)) keys.push(key)
            
            const closest = m.data.reduce((prev, curr) => 
              Math.abs(curr.temperature - temp) < Math.abs(prev.temperature - temp) ? curr : prev
            )
            if (Math.abs(closest.temperature - temp) < 20) {
              point[key] = closest[mainPhase]
            }
          }
        })
        return point
      })
      
      return { chartData: processed, lineKeys: keys }
    }
    
    // 单合金模式
    if (data && data.length > 0 && phases && phases.length > 0) {
      return { chartData: sampleData(data, 100), lineKeys: phases }
    }
    
    return { chartData: [], lineKeys: [] }
  }, [data, phases, multiData])
  
  if (chartData.length === 0 || lineKeys.length === 0) return null
  
  return (
    <div className={`chart-container ${className}`}>
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 45, bottom: 50 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
          <XAxis 
            dataKey="temperature"
            label={{ value: '温度 (K)', position: 'bottom', offset: 35 }}
            tick={{ fontSize: 10, fill: '#5f6368' }}
            tickCount={6}
            tickFormatter={(v) => Number(v).toFixed(0)}
          />
          <YAxis 
            label={{ value: 'G (J/mol)', angle: -90, position: 'insideLeft', offset: 5 }}
            tick={{ fontSize: 10, fill: '#5f6368' }}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            width={45}
          />
          <Tooltip 
            formatter={(value: number) => `${value.toFixed(1)} J/mol`}
            labelFormatter={(label) => `温度: ${Number(label).toFixed(0)} K`}
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #dadce0', borderRadius: '8px' }}
          />
          <Legend verticalAlign="top" height={36} />
          {lineKeys.map((key, idx) => (
            <Line 
              key={key}
              type="monotone" 
              dataKey={key}
              name={key}
              stroke={COLORS[idx % COLORS.length]} 
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ================================
// 热力学关键温度对比图
// ================================

export interface ThermoCompareData {
  composition: string
  liquidus: number
  solidus?: number
}

interface ThermoCompareChartProps {
  data: ThermoCompareData[]
  className?: string
}

export function ThermoCompareChart({ data, className = '' }: ThermoCompareChartProps) {
  if (data.length === 0) return null
  
  const chartData = data.map(d => ({
    name: d.composition,
    '液相线': d.liquidus,
    '固相线': d.solidus || 0,
  }))
  
  return (
    <div className={`chart-container ${className}`}>
      <h4 className="chart-title">关键温度对比 (K)</h4>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#5f6368' }} />
          <YAxis tick={{ fontSize: 11, fill: '#5f6368' }} domain={['dataMin - 50', 'dataMax + 50']} />
          <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #dadce0', borderRadius: '8px' }} />
          <Legend />
          <Bar dataKey="液相线" fill="#dc2626" radius={[4, 4, 0, 0]} />
          <Bar dataKey="固相线" fill="#2563eb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// 保留旧接口兼容
export function ThermoLineChart({ data, className = '' }: ThermoChartProps) {
  const scheilData = data.map(d => ({
    temperature: d.temperature,
    liquid: d.liquid_fraction || 0,
    solid: d.solid_fraction || 0,
  }))
  return <ScheilSolidificationChart data={scheilData} className={className} />
}

// ================================
// 导出
// ================================

export default {
  PerformanceBarChart,
  PerformanceRadarChart,
  PerformanceCard,
  ThermoLineChart,
  ScheilSolidificationChart,
  PhaseFractionChart,
  GibbsEnergyChart,
  ThermoCompareChart,
}
