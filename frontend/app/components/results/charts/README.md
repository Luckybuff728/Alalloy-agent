# 图表组件使用说明

本目录包含铝合金 Agent 的所有图表组件，使用 Plotly.js 实现数据可视化。

## 组件列表

### 性能图表

#### 1. PerformanceBarChart - 性能柱状图
展示多个合金的性能对比（抗拉强度、屈服强度、延伸率）。

```vue
<PerformanceBarChart :data="alloys" />
```

**数据格式：**
```javascript
[
  {
    composition: 'Al-4Cu-1Mg',
    tensile_strength: 450,
    yield_strength: 350,
    elongation: 12
  },
  // ...更多合金
]
```

#### 2. PerformanceRadarChart - 性能雷达图
多维度展示合金性能对比，数据会自动归一化到 0-100。

```vue
<PerformanceRadarChart :data="alloys" />
```

**数据格式：** 同 PerformanceBarChart

#### 3. PerformanceCard - 性能卡片
展示单个合金的详细性能参数，带进度条可视化。

```vue
<PerformanceCard :data="singleAlloy" />
```

**数据格式：**
```javascript
{
  composition: 'Al-4Cu-1Mg',
  tensile_strength: 450,
  yield_strength: 350,
  elongation: 12
}
```

### 热力学图表

#### 4. ScheilSolidificationChart - Scheil 凝固曲线
展示凝固过程中液相和固相的变化，支持单合金和多合金对比。

**单合金模式：**
```vue
<ScheilSolidificationChart :data="scheilData" />
```

```javascript
// 数据格式
[
  { temperature: 933, liquid: 1.0, solid: 0.0 },
  { temperature: 920, liquid: 0.8, solid: 0.2 },
  // ...
]
```

**多合金对比模式：**
```vue
<ScheilSolidificationChart :multiData="multiScheilData" />
```

```javascript
// 数据格式
[
  {
    composition: 'Al-4Cu-1Mg',
    data: [
      { temperature: 933, liquid: 1.0, solid: 0.0 },
      // ...
    ]
  },
  // ...更多合金
]
```

#### 5. PhaseFractionChart - 相分数-温度曲线
展示不同相随温度的分布变化。

```vue
<PhaseFractionChart 
  :data="phaseFractionData" 
  :phases="['Fcc', 'Al2Cu']" 
  title="相分数-温度曲线"
/>
```

**数据格式：**
```javascript
[
  { temperature: 933, Fcc: 1.0, Al2Cu: 0.0 },
  { temperature: 920, Fcc: 0.85, Al2Cu: 0.15 },
  // ...
]
```

#### 6. GibbsEnergyChart - 吉布斯能-温度曲线
展示不同相的吉布斯自由能随温度的变化。

**单合金模式：**
```vue
<GibbsEnergyChart 
  :data="gibbsData" 
  :phases="['Fcc', 'Bcc']" 
/>
```

**多合金对比模式：**
```vue
<GibbsEnergyChart :multiData="multiGibbsData" />
```

```javascript
// multiData 格式
[
  {
    composition: 'Al-4Cu-1Mg',
    data: [
      { temperature: 300, Fcc: -50000, Bcc: -48000 },
      // ...
    ],
    phases: ['Fcc', 'Bcc']
  },
  // ...
]
```

#### 7. ThermoCompareChart - 关键温度对比
对比多个合金的液相线和固相线温度。

```vue
<ThermoCompareChart :data="thermoCompareData" />
```

**数据格式：**
```javascript
[
  { composition: 'Al-4Cu-1Mg', liquidus: 933, solidus: 821 },
  { composition: 'Al-6Cu-0.5Mg', liquidus: 920, solidus: 810 },
  // ...
]
```

## 在 ResultsPanel 中使用

ResultsPanel 会根据 `result.type` 自动选择合适的图表组件：

- `performance` → PerformanceCard
- `performance_compare` → PerformanceBarChart + PerformanceRadarChart
- `scheil` → ScheilSolidificationChart
- `phase_fraction` → PhaseFractionChart
- `gibbs` → GibbsEnergyChart
- `thermo` → ThermoCompareChart + ScheilSolidificationChart

**示例：从 WebSocket 推送结果**

```javascript
// 后端发送性能对比结果
{
  type: 'performance_compare',
  data: {
    alloys: [
      { composition: 'Al-4Cu-1Mg', tensile_strength: 450, ... },
      { composition: 'Al-6Cu-0.5Mg', tensile_strength: 470, ... }
    ]
  },
  timestamp: Date.now()
}

// 后端发送 Scheil 凝固曲线
{
  type: 'scheil',
  data: {
    multiData: [
      { composition: 'Al-4Cu-1Mg', data: [...] },
      { composition: 'Al-6Cu-0.5Mg', data: [...] }
    ],
    title: 'Scheil 凝固曲线对比'
  },
  timestamp: Date.now()
}
```

## 性能优化

所有图表组件内置数据采样功能：
- Scheil 曲线：最大 120 点
- 相分数曲线：最大 100 点
- 吉布斯能曲线：最大 100 点

这确保即使原始数据包含数千个点，渲染性能依然流畅。

## 样式定制

所有图表使用 CSS 变量系统，可通过修改 `app/assets/style.css` 统一调整：

- `--bg-primary`: 图表背景色
- `--border-light`: 图表边框色
- `--text-primary`: 标题文字颜色
- `--text-secondary`: 次要文字颜色

## 技术栈

- **图表库**: Plotly.js (plotly.js-dist-min)
- **框架**: Vue 3 Composition API
- **响应式**: 支持自适应容器大小
