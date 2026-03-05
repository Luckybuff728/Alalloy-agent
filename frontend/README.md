# 铝合金智能设计系统 (Alalloy Agent) - 前端

这是铝合金智能设计系统的前端项目，基于大语言模型和多智能体架构，提供材料设计、性能预测、图表可视化和工作流编排的用户界面。

## 🛠 技术栈

- **框架**: Nuxt 4 (基于 Vue 3.5 + Composition API)
- **UI 组件库**: Element Plus 2.12 + @element-plus/icons-vue
- **状态管理**: Pinia
- **数据可视化**: 
  - Plotly.js (热力学曲线、性能对比图)
  - vtk.js (FEM/PVD 物理场 3D 渲染)
  - Mermaid (流程图与复杂关系图)
- **Markdown 渲染**: markdown-it + highlight.js
- **后台与实时通信**: Supabase + 原生 WebSocket

---

## 📂 目录结构

系统采用了扁平化的模块化设计，核心逻辑集中在 `app/` 目录下：

```text
frontend/
├── app/
│   ├── assets/              # 全局样式（CSS 变量定义等）
│   ├── components/          # Vue 组件
│   │   ├── common/          # 通用组件 (如 MarkdownRenderer)
│   │   ├── layout/          # 布局组件 (如侧边栏)
│   │   ├── panels/          # 核心业务面板
│   │   │   ├── chat/        # 聊天区域 (ChatMessage, ChatInput 等)
│   │   │   │   └── widgets/ # 交互挂件 (工具状态、表单确认等)
│   │   │   └── charts/      # 图表可视化组件
│   │   └── ResultsPanel.vue # 右侧分析结果面板
│   ├── composables/         # 组合式函数 (核心业务逻辑)
│   │   ├── useMultiAgent.js      # Agent 会话流与事件分发管理
│   │   ├── useMessageBlocks.js   # 消息块(Block)状态与操作
│   │   ├── useWebSocket.js       # WebSocket 连接与重连控制
│   │   ├── useSessions.js        # 历史会话管理
│   │   └── useChatScroll.js      # 聊天窗口自动滚动控制
│   ├── config/              # 配置文件
│   │   ├── index.js              # 环境变量与 API 端点
│   │   └── toolRegistry.js       # ★ 核心：工具注册表与元信息
│   ├── pages/               # 页面视图 (三栏布局的主页)
│   ├── types/               # TypeScript 类型定义
│   │   └── index.d.ts            # 消息块、WebSocket 事件等接口定义
│   └── utils/               # 纯函数工具
│       └── toolResultHandler.js  # 工具调用结果分发器
├── nuxt.config.ts           # Nuxt 配置文件
├── package.json             # 依赖管理
└── REFACTOR.md              # 前端架构重构说明文档
```

---

## 🚀 核心架构设计

### 1. 消息块渲染体系 (Block System)
聊天消息被拆分为不同类型的块 (Block)，以支持丰富的流式输出和交互：
- **pending**: 正在接收的文本块（显示为闪烁状态）
- **thinking**: 深度思考与推理过程（浅色折叠面板）
- **text / chat**: 普通对话文本（支持 Markdown）
- **tool**: 工具调用块（展示工具输入参数和执行状态）

### 2. 工具注册表模式 (ToolRegistry)
统一在 `config/toolRegistry.js` 中管理所有 Agent 工具的元数据，避免了硬编码。每个工具定义了：
- 中文显示名称
- 分类 (预测、仿真、热力学、交互等)
- 结果展示方式 (侧边栏卡片、图表、内联)
- 关联的图表组件

### 3. Human-in-the-Loop (HITL) 交互
支持与 Agent 进程的中断与交互：
- 挂件系统 (`widgets/ToolConfirmWidget.vue`) 用于参数二次确认
- 支持局部决策与 Agent 的暂停/恢复
- 动态表单生成（请求用户输入实验数据）

---

## 🖥 启动与运行

### 1. 环境准备
确保已安装 Node.js (推荐 v18+)。

```bash
cd frontend
npm install
```

### 2. 环境变量配置
在 `frontend` 根目录创建 `.env` 文件：

```env
# 基础 API 地址
VITE_API_BASE_URL=http://localhost:8001
VITE_WS_BASE_URL=ws://localhost:8001

# Supabase 配置 (可选，用于云端存储)
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

### 3. 运行开发服务器

```bash
npm run dev
```

启动后，访问 [http://localhost:5174](http://localhost:5174) (具体端口请参考终端输出)。

### 4. 构建与生产部署

```bash
npm run build
npm run preview
```

---

## 🔌 与后端通信机制

前端通过 WebSocket (`useWebSocket.js`) 与后端的 LangGraph 状态图保持双向通信。
核心事件协议包含：

| 事件类型 | 说明 |
|---------|------|
| `connected` | WS 连接建立确认 |
| `chat_token` | Agent 正在流式输出普通文本 |
| `thinking_token` | 正在流式输出深度思考内容 |
| `tool_call_start` | 开始调用工具（包含参数初始化） |
| `tool_call_args` | 流式接收工具参数 JSON |
| `tool_ready` | 工具参数接收完毕，准备执行 |
| `tool_result` | 工具执行完毕，返回最终结果 |
| `chat_complete` | 单轮对话完整结束 |
| `interrupt` | 触发 HITL，等待用户提供输入或确认 |
| `error` | 执行过程中的异常上报 |

---

## 🎨 UI 与样式规范

项目参考了材料研发的专业设计系统规范：
- 采用 Element Plus 组件库为基础。
- 核心色调：Google Blue (`#0b57d0`) 作为主色系，提升沉浸感。
- 深色背景适配：针对部分代码块、JSON 数据展示面板，使用深色背景 (`#0c0c0e`) 与浅色语法高亮，以减少视觉疲劳。
- 详细样式变量见 `app/assets/style.css`。

---

## 📚 维护与演进
- 若需要了解近期的架构重构历史（如巨石模块拆分、硬编码清理等），请参考 [REFACTOR.md](./REFACTOR.md)。
- 若要添加新工具展示逻辑，只需修改 `app/config/toolRegistry.js`，图表展示会自动路由到对应的组件中。
