# Al-IDME 前端

基于 React 19 + TypeScript + Vite 构建的铝合金智能设计系统前端应用。

## 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | React 19 + TypeScript |
| **构建工具** | Vite (rolldown-vite) |
| **样式** | TailwindCSS 4 + CSS Modules |
| **图标** | Lucide React |
| **图表** | Recharts |
| **工作流可视化** | @xyflow/react |
| **Markdown 渲染** | react-markdown + remark-gfm |
| **WebSocket** | react-use-websocket |
| **布局** | react-resizable-panels |

## 项目结构

```
web/
├── public/                  # 静态资源
│   ├── favicon.ico
│   └── vite.svg
├── src/
│   ├── assets/             # 图片等资源
│   ├── components/         # 组件目录
│   │   ├── chat/           # 聊天面板组件
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ChatPanel.css
│   │   │   └── index.ts
│   │   ├── common/         # 通用组件
│   │   │   └── MarkdownRenderer.tsx
│   │   ├── layout/         # 布局组件
│   │   │   └── Header.tsx
│   │   ├── results/        # 结果面板组件
│   │   │   ├── ResultsPanel.tsx
│   │   │   ├── PerformanceChart.tsx
│   │   │   └── ResultsPanel.css
│   │   ├── workflow/       # 工作流面板组件
│   │   │   └── WorkflowPanel.tsx
│   │   └── index.ts        # 组件导出
│   ├── styles/             # 全局样式
│   │   ├── variables.css   # CSS 变量定义
│   │   ├── base.css        # 基础样式
│   │   ├── components.css  # 组件样式
│   │   ├── layout.css      # 布局样式
│   │   ├── markdown.css    # Markdown 样式
│   │   └── ...
│   ├── App.tsx             # 主应用组件
│   ├── App.css
│   ├── main.tsx            # 入口文件
│   └── index.css
├── .env                    # 环境变量
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## 核心功能

### 1. 聊天面板 (ChatPanel)
- 用户输入合金设计需求
- LLM 流式响应显示（打字机效果）
- **智能滚动**：用户查看历史时不打断，有新内容时显示提示按钮
- Markdown 格式渲染

### 2. 工作流面板 (WorkflowPanel)
- 基于 @xyflow/react 的可视化工作流
- 实时显示 Agent 执行节点状态
- 工具调用过程可视化

### 3. 结果面板 (ResultsPanel)
- **工具结果展示**：数据库查询、ML 预测、热力学模拟
- **性能图表**：雷达图、柱状图（多合金对比）
- **热力学图表**：Scheil 凝固曲线、吉布斯能曲线（支持多合金对比）
- 数据采样优化，解决大数据量渲染性能问题

## 环境变量

在项目根目录创建 `.env` 文件：

```env
# 后端 WebSocket 地址
VITE_WS_URL=ws://localhost:8001/ws/run

# 后端 API 地址
VITE_API_URL=http://localhost:8001
```

## 快速开始

### 安装依赖

```bash
cd web
npm install
```

### 开发模式

```bash
npm run dev
```

应用将在 http://localhost:5173 启动。

### 生产构建

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### 预览生产构建

```bash
npm run preview
```

### 代码检查

```bash
npm run lint
```

## WebSocket 通信

前端通过 WebSocket 与后端实时通信，主要消息类型：

| 消息类型 | 说明 |
|----------|------|
| `node_start` | 节点开始执行 |
| `node_complete` | 节点执行完成 |
| `tool_result` | 工具调用结果 |
| `llm_token` | LLM 流式 token |
| `llm_complete` | LLM 生成完成 |
| `workflow_complete` | 工作流执行完成 |
| `error` | 错误信息 |

## 设计规范

### CSS 变量

项目使用 CSS 变量统一管理设计 Token，定义在 `src/styles/variables.css`：

```css
:root {
  /* 颜色 */
  --primary: #1967d2;
  --primary-hover: #1557b0;
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --text-primary: #202124;
  --text-secondary: #5f6368;
  
  /* 间距 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  
  /* 圆角 */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
  
  /* 字体 */
  --font-sm: 13px;
  --font-base: 14px;
  --font-lg: 16px;
}
```

### 组件规范

- 每个组件独立目录，包含 `.tsx`、`.css`、`index.ts`
- 使用中文注释说明组件功能
- Props 使用 TypeScript 接口定义
- 样式使用 BEM 命名或功能命名

## 开发注意事项

1. **性能优化**
   - 大数据量图表使用 `sampleData()` 采样
   - 使用 `useMemo` 缓存计算结果
   - 避免不必要的重渲染

2. **WebSocket 连接**
   - 使用 `react-use-websocket` 管理连接
   - 自动重连机制
   - 心跳检测

3. **样式隔离**
   - 组件样式使用独立 CSS 文件
   - 避免全局样式污染
   - 使用 CSS 变量保持一致性

## License

MIT
