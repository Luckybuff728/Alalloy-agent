# IDME 工作流重构项目 (IDME Workflow Refactoring)

本项目使用 LangGraph 和 React 重构了原有的 IDME 合金设计工作流，实现了基于 WebSocket 的流式交互和并行分析。

## 目录结构

```
d:/Agent/Al_IDME/
├── backend/               # 后端代码 (Python/FastAPI/LangGraph)
│   ├── app/               # 核心逻辑
│   │   ├── agent.py       # 图构建
│   │   ├── nodes.py       # 节点函数
│   │   ├── state.py       # 状态定义
│   │   └── tools.py       # 工具与 MCP 集成
│   ├── server.py          # FastAPI 服务器入口
│   └── requirements.txt   # 后端依赖
└── web/                   # 前端代码 (React/Vite/Tailwind)
    ├── src/
    │   ├── App.tsx        # 主应用组件
    │   └── index.css      # 全局样式
    └── ...
```

## 运行指南

### 1. 启动后端服务

确保已安装 Python 3.9+。

```bash
# 安装依赖
pip install -r requirements.txt

# 从根目录启动后端服务
python run.py
```

服务器将在 `http://0.0.0.0:8001` 启动，WebSocket 端点为 `ws://localhost:8001/ws/run`。

### 2. 启动前端应用

确保已安装 Node.js 16+。

```bash
cd web
# 安装依赖 (如果尚未安装)
npm install

# 启动开发服务器
npm run dev
```

前端应用将在 `http://localhost:5174` 启动。

### 3. 配置说明

后端配置位于根目录 `.env`，主要配置项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| BACKEND_PORT | 8001 | 后端服务端口 |
| BACKEND_HOST | 0.0.0.0 | 后端服务地址 |
| FRONTEND_PORT | 5174 | 前端服务端口 |
| FRONTEND_URL | http://localhost:5174 | 前端地址 (用于 CORS) |

前端配置位于 `web/.env`：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| VITE_WS_URL | ws://localhost:8001/ws/run | WebSocket 地址 |
| VITE_API_URL | http://localhost:8001 | 后端 API 地址 |

## 功能说明

-   **智能对话**：通过左侧聊天面板输入需求（如“推荐 Al-Si 合金”）。
-   **实时状态**：左侧面板显示当前工作流运行到的节点（参数提取 -> IDME 查询 -> 推荐 -> 分析 -> 报告）。
-   **结果展示**：右侧面板实时展示推荐的合金列表、并行分析的结果（ONNX 预测）以及最终报告。
-   **并行分析**：后端使用 LangGraph 子图并行处理多个合金的性能预测和热力学计算。

## 注意事项

-   **MCP 服务器**：请确保 ONNX 和 Calphad 的 MCP 服务器已在 `http://8.148.79.228:9010` 和 `9009` 上运行并可访问。
-   **API 凭据**：IDME 和华为云 IAM 的凭据目前配置在 `tools.py` 中，生产环境建议通过环境变量注入。
