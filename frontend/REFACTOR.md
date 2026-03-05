# 前端架构重构说明

## 重构目标

1. **消除巨石文件**：拆分 `useMultiAgent.js` 和 `ChatMessage.vue`
2. **引入注册表模式**：用 `toolRegistry.js` 替代硬编码的工具映射
3. **添加类型定义**：为核心数据结构提供类型安全
4. **简化目录结构**：减少嵌套层级，提升可维护性

---

## 已完成的改动

### 1. 创建 ToolRegistry (`config/toolRegistry.js`)

集中管理所有工具的元信息，替代分散在各处的硬编码映射：

```javascript
import { getToolDisplayName, getResultDisplay, shouldShowInResultPanel } from '~/config/toolRegistry'

// 获取工具中文名
const name = getToolDisplayName('predict_onnx_performance')  // 'ONNX 性能预测'

// 判断是否需要在结果面板展示
const showInPanel = shouldShowInResultPanel('predict_onnx_performance')  // true
```

**优势**：
- 新增工具只需在注册表中添加一行配置
- 支持动态注册 `registerTool(name, meta)`
- 提供分类查询 `getToolsByCategory(category)`

### 2. 创建类型定义 (`types/index.d.ts`)

为核心数据结构提供 TypeScript 类型定义：

- `WSEventType` - WebSocket 事件类型
- `MessageBlock` / `ToolBlock` - 消息块类型
- `ChatMessage` - 聊天消息类型
- `ToolMeta` - 工具元信息类型

### 3. 拆分 useMessageBlocks (`composables/useMessageBlocks.js`)

从 `useMultiAgent.js` 中提取消息块操作函数：

```javascript
import { 
  createAgentMessage,
  appendTextToContentBlocks,
  convertPendingBlockToThinking,
  finalizePendingBlocksAsChat,
  addToolBlockToMessage,
  findToolBlock,
  updateToolBlockResult
} from '~/composables/useMessageBlocks'
```

**优势**：
- 纯函数设计，易于单元测试
- 与状态管理解耦
- 代码复用性更强

### 4. 更新 ToolStatusWidget

移除硬编码的 `NAME_MAP`，改用 `toolRegistry`：

```javascript
import { getToolDisplayName } from '~/config/toolRegistry'
```

---

## 目录结构优化建议

### 当前结构（存在问题）

```
app/
├── components/
│   ├── common/           # 只有 1 个文件
│   ├── layout/           # 只有 1 个文件
│   └── panels/           # 嵌套过深
│       ├── charts/       # 9 个图表组件
│       ├── chat/         
│       │   └── widgets/  # 5 个挂件（嵌套 3 层）
│       └── cards/        # 空目录
├── composables/          # 5 个文件，useMultiAgent 过大
├── utils/                # 6 个文件
└── config/               # 1 个文件
```

### 建议结构（扁平化）

```
app/
├── components/
│   ├── chat/             # 聊天模块（合并 panels/chat）
│   │   ├── ChatPanel.vue
│   │   ├── ChatInput.vue
│   │   ├── ChatMessage.vue
│   │   ├── WelcomeHero.vue
│   │   └── widgets/      # 保留 widgets 子目录
│   ├── results/          # 结果模块
│   │   ├── ResultsPanel.vue
│   │   └── charts/       # 图表组件
│   ├── layout/           # 布局组件
│   └── common/           # 通用组件
├── composables/
│   ├── useMultiAgent.js  # 主入口（组合其他模块）
│   ├── useMessageBlocks.js  # 消息块操作
│   ├── useWebSocket.js   # WS 连接
│   ├── useSessions.js    # 会话管理
│   └── useChatScroll.js  # 滚动行为
├── config/
│   ├── index.js          # API 配置
│   └── toolRegistry.js   # 工具注册表
├── types/
│   └── index.d.ts        # 类型定义
└── utils/                # 纯函数工具
```

---

## v2.0 重构完成 (2026-02-24)

### 5. 创建 Pinia Results Store (`stores/results.js`)

集中管理工具调用产生的业务结果：

```javascript
import { useResultsStore } from '~/stores/results'

const resultsStore = useResultsStore()

// 添加结果
resultsStore.addResult('performance', 'ONNX 性能预测', chartData)

// 更新特定状态
resultsStore.updateState('validation', result)

// 清空所有结果
resultsStore.clearAll()

// 获取结果列表（响应式）
const results = computed(() => resultsStore.resultsList)
```

**优势**：
- 状态集中管理，支持跨组件共享
- 可使用 Vue DevTools 调试
- 简化 composable 的参数传递

### 6. 创建事件处理器模块 (`composables/useAgentEvents.js`)

将 WebSocket 事件处理逻辑从 `useMultiAgent.js` 中解耦：

```javascript
import { createEventHandlers, dispatchEvent } from '~/composables/useAgentEvents'

// 创建事件处理器
const handlers = createEventHandlers(context)

// 分发事件（内置错误边界）
dispatchEvent(handlers, data)
```

**优势**：
- 每个事件处理器独立可测试
- 统一的错误边界处理
- 易于扩展新事件类型

### 7. useMultiAgent v2.0 重构

完成的改动：

| 改动项 | 描述 |
|--------|------|
| 删除重复函数 | 消息块操作函数改用 import useMessageBlocks |
| 移除旧格式 | 统一使用 contentBlocks，移除 tools 数组兼容代码 |
| 响应式闭包变量 | `pendingParamResolve`、`emittedToolResults` 改为 ref |
| 业务状态迁移 | `validationResult`、`performancePrediction` 等迁移至 Pinia store |
| 简化 handleToolResult | 只传递 UI 状态，业务状态由 store 管理 |

**代码量变化**：~1008 行 → ~780 行（减少 ~23%）

### 8. 更新 sessionRestorer.js

适配 Pinia store：

```javascript
export const restoreSessionState = ({ stateData, refs, store }) => {
  // refs 只包含 UI 状态: { sessionId, messages, sessionParams }
  // store 是 Pinia results store 实例
  store.updateState('validation', result)
  store.addResult('performance', 'ML 性能预测', data)
}
```

### 9. 更新 toolResultHandler.js

适配 Pinia store：

```javascript
export const processToolResult = ({ data, state, callbacks }) => {
  const resultsStore = useResultsStore()
  
  // 使用 store 方法
  resultsStore.updateState('performance', chartData)
  resultsStore.addResult('performance', 'ONNX 性能预测', chartData)
}
```

---

## v2.1 目录结构重构 (2026-02-24)

### 10. 目录结构扁平化

**问题**：原目录嵌套过深，模块边界不清晰

```
components/
├── panels/              # ❌ 名称太宽泛，嵌套 3 层
│   ├── ChatPanel.vue
│   ├── ResultsPanel.vue
│   ├── chat/            # 聊天子组件
│   └── charts/          # 图表组件（实际属于 results）
```

**解决方案**：按功能模块扁平化组织

```
components/
├── common/              # 通用组件
│   └── MarkdownRenderer.vue
├── layout/              # 布局组件
│   └── AppSidebar.vue
├── chat/                # ✅ 聊天模块（统一管理）
│   ├── ChatPanel.vue
│   ├── ChatMessage.vue
│   ├── ChatInput.vue
│   ├── WelcomeHero.vue
│   └── widgets/         # 聊天挂件
│       ├── ToolStatusWidget.vue
│       ├── ToolConfirmWidget.vue
│       ├── ActionButtonsWidget.vue
│       ├── InlineFormWidget.vue
│       └── WelcomeSetupWidget.vue
└── results/             # ✅ 结果模块（统一管理）
    ├── ResultsPanel.vue
    ├── HITLConfirmDialog.vue
    └── charts/          # 图表组件
        ├── PerformanceCard.vue
        ├── PerformanceBarChart.vue
        ├── PerformanceRadarChart.vue
        ├── GibbsEnergyChart.vue
        ├── ScheilSolidificationChart.vue
        ├── PhaseFractionChart.vue
        ├── ThermoCompareChart.vue
        ├── index.js
        └── README.md
```

**优势**：
- 模块边界清晰，易于定位文件
- 减少嵌套层级，路径更简洁
- 符合 Nuxt 3 自动导入规范

### 11. 修复编译错误

修复 `useMultiAgent.js` 中 `results` 变量重复声明错误：
- 删除第 122 行的 `const results = ref([])`
- 使用底部的 `computed(() => resultsStore.resultsList)` 版本

---

## v2.2 安全与业务逻辑审查 (2026-02-24)

### 12. 目录分类修正

**HITLConfirmDialog.vue** 从 `results/` 移动到 `chat/`，人机协同属于聊天交互模块。

### 13. 安全问题发现与修复

#### 🔒 安全问题 1：Token 在 WebSocket URL 中传递 ⚠️ 高风险

**问题位置**：`useMultiAgent.js:148`

```javascript
// ❌ Token 暴露在 URL 中
const wsUrl = `${WS_ENDPOINTS.chat}?token=${token}&session_id=${targetSessionId}`
```

**风险**：
- Token 可能被浏览器历史、日志、代理服务器记录
- 用户分享链接会泄露 Token

**建议解决方案**：
```javascript
// 方案 1：使用 WebSocket Subprotocol
const ws = new WebSocket(wsUrl, ['access_token', token])

// 方案 2：连接后通过消息发送认证
ws.send(JSON.stringify({ type: 'auth', token }))
```

#### 🔒 安全问题 2：Token 存储在 localStorage ⚠️ 中风险

**问题位置**：`stores/auth.js`

```javascript
// ❌ 容易受到 XSS 攻击
token: localStorage.getItem('auth_token') || ''
```

**风险**：
- localStorage 永久存储，没有过期机制
- 跨标签页可访问
- XSS 攻击可窃取

**建议解决方案**：
```javascript
// 方案 1：使用 HttpOnly Cookie（需后端配合）
// 方案 2：sessionStorage + 刷新机制
// 方案 3：添加 Token 过期检查
const tokenExpiry = Date.now() + (3600 * 1000)
localStorage.setItem('token_expiry', tokenExpiry)
```

#### 🔒 安全问题 3：缺少 CSRF 防护 ⚠️ 中风险

**问题位置**：所有 API 请求

**建议**：添加 CSRF Token
```javascript
headers: {
  'Authorization': `Bearer ${authStore.token}`,
  'X-CSRF-Token': getCsrfToken()
}
```

#### ✅ 良好的安全实践

1. **XSS 防护**：使用 DOMPurify 严格清理 HTML
2. **代码高亮**：使用 `escapeHtml` 转义用户输入
3. **Markdown 渲染**：白名单标签和属性

### 14. 业务逻辑问题修复

#### 🐛 问题 1：HITLConfirmDialog 缺少参数验证 ✅ 已修复

**问题**：用户可以提交空值或类型错误的参数

**修复**：添加类型验证
```javascript
const validated = {}
for (const param of group.params || []) {
  if (param.editable) {
    const value = editableParams.value[param.key]
    // 类型验证
    validated[param.key] = typeof param.value === 'number' 
      ? Number(value) || 0 
      : String(value || '')
  }
}
```

#### 🐛 问题 2：WebSocket 重连时可能丢失消息 ⚠️

**问题位置**：`useMultiAgent.js:connect`

**建议**：连接成功后请求 `session_state` 恢复历史消息

---

## v2.3 聊天滚动问题修复 (2026-02-24)

### 15. 问题诊断

**用户反馈**：输入新对话时，不是跟随到最底部，而是会浮上来一点

**根本原因分析**：发现 4 个关键问题

#### 🐛 问题 1：无效的 `behavior` 参数

**位置**：`useChatScroll.js:50` 和 `ChatPanel.vue:168,175`

```javascript
// ❌ 'instant' 不是标准的 scrollTo behavior 值
scrollToBottom('instant')  // 浏览器会忽略，导致滚动不精确
```

**标准值**：只支持 `'auto'` 和 `'smooth'`

#### 🐛 问题 2：ResizeObserver 时序竞态

**问题**：单次 `nextTick` 无法保证复杂内容渲染完成
- Markdown 渲染（DOMPurify、highlight.js、Mermaid）需要时间
- 图片加载、Widget 渲染需要额外的渲染周期

#### 🐛 问题 3：`isProgrammaticScroll` 覆盖不全

**问题**：只保护 `smooth` 滚动，`auto` 滚动仍会触发 `updateScrollState`，导致误判

#### 🐛 问题 4：多处滚动触发无防抖

**问题**：3 个 watch 监听同一消息的不同属性，可能在同一帧内多次触发滚动

### 16. 修复方案

#### ✅ 修复 1：统一使用标准 behavior 值

```javascript
// useChatScroll.js
const validBehavior = behavior === 'smooth' ? 'smooth' : 'auto'
containerRef.value.scrollTo({
  top: containerRef.value.scrollHeight,
  behavior: validBehavior  // ✅ 只使用标准值
})
```

#### ✅ 修复 2：保护所有程序滚动

```javascript
// ★ 修复前：只保护 smooth
if (behavior === 'smooth') {
  isProgrammaticScroll = true
}

// ★ 修复后：保护所有程序触发的滚动
isProgrammaticScroll = true
const delay = validBehavior === 'smooth' ? 500 : 100
setTimeout(() => {
  isProgrammaticScroll = false
}, delay)
```

#### ✅ 修复 3：增强 ResizeObserver 等待机制

```javascript
// 使用双重 nextTick + 延迟确保复杂内容渲染完成
const handleResize = () => {
  if (isLocked.value) {
    nextTick(() => {
      nextTick(() => {
        setTimeout(() => {
          scrollToBottom('auto')
        }, 20)  // 额外等待 20ms
      })
    })
  }
}
```

#### ✅ 修复 4：添加防抖机制

```javascript
// ChatPanel.vue - 合并多个 watch 并防抖
let scrollDebounceTimer = null
const debouncedScroll = () => {
  if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer)
  scrollDebounceTimer = setTimeout(() => {
    if (props.isGenerating && isLocked.value) {
      scrollToBottom('auto')
    }
  }, 50)
}

watch(() => props.messages[props.messages.length - 1]?.content, debouncedScroll)
watch(() => props.messages[props.messages.length - 1]?.reasoning, debouncedScroll)
```

### 17. 设计改进

#### 滚动锁定状态机

```
用户滚动到顶部 → isLocked = false (解锁)
                ↓
用户滚动到底部 → isLocked = true (锁定)
                ↓
新消息到达     → 自动跟随底部
                ↓
用户向上滚动   → isLocked = false (解锁)
```

#### ResizeObserver 渲染等待策略

```
DOM 变化 → ResizeObserver 触发
         ↓
      nextTick #1 (等待 Vue 更新)
         ↓
      nextTick #2 (等待组件渲染)
         ↓
      setTimeout 20ms (等待异步内容)
         ↓
      scrollToBottom()
```

---

## 后续优化建议

### 1. 完成 useMultiAgent 拆分

将事件处理逻辑进一步拆分为独立模块：

```javascript
// composables/useAgentEvents.js - 事件分发
// composables/useToolStatus.js - 工具状态机
// composables/useResultStore.js - 结果数据管理
```

### 2. 拆分 ChatMessage.vue

使用动态组件替代巨大的 `v-if` 链：

```vue
<template>
  <component 
    :is="getBlockComponent(block.type)" 
    :block="block" 
  />
</template>

<script setup>
const blockComponents = {
  text: () => import('./blocks/TextBlock.vue'),
  thinking: () => import('./blocks/ThinkingBlock.vue'),
  tool: () => import('./blocks/ToolBlock.vue'),
}

const getBlockComponent = (type) => blockComponents[type] || blockComponents.text
</script>
```

### 3. 完善 toolResultHandler 重构

使用策略模式替代大量 `if-else`：

```javascript
// 工具结果处理策略
const handlers = {
  predict_onnx_performance: handleOnnxResult,
  submit_calphad_task: handleCalphadResult,
  // ...
}

export const processToolResult = ({ data, state, callbacks }) => {
  const handler = handlers[data.tool]
  if (handler) {
    handler(data, state, callbacks)
  }
}
```

---

## 迁移指南

如果需要将现有代码迁移到新架构：

1. **更新工具名称引用**：
   ```javascript
   // 旧代码
   const NAME_MAP = { 'predict_onnx_performance': 'ONNX 性能预测' }
   const name = NAME_MAP[toolName] || toolName
   
   // 新代码
   import { getToolDisplayName } from '~/config/toolRegistry'
   const name = getToolDisplayName(toolName)
   ```

2. **更新消息块操作**：
   ```javascript
   // 旧代码（在 useMultiAgent 内部）
   const appendTextToContentBlocks = (msg, text, agent, options) => { ... }
   
   // 新代码
   import { appendTextToContentBlocks } from '~/composables/useMessageBlocks'
   ```

3. **添加新工具**：
   ```javascript
   // 在 config/toolRegistry.js 中添加
   'my_new_tool': {
     displayName: '我的新工具',
     category: ToolCategory.PREDICTION,
     resultDisplay: ResultDisplay.CARD,
     chartComponent: 'MyNewChart',
     description: '工具描述',
   }
   ```
