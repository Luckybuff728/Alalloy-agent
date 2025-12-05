"""
WebSocket API 路由

处理工作流的 WebSocket 通信。
统一消息格式，支持工具调用反馈。
"""

import time
import contextvars
from typing import Dict, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from langchain_core.messages import HumanMessage

from ..core.logger import logger
from ..graph.workflow import graph

# ================================
# 全局 WebSocket 上下文变量
# ================================
# 用于在节点函数中发送实时状态更新
current_websocket: contextvars.ContextVar[Optional[WebSocket]] = contextvars.ContextVar(
    'current_websocket', default=None
)


async def send_node_status(
    node: str, 
    status: str, 
    composition: str = None, 
    data: dict = None
):
    """
    从节点函数内部发送状态更新消息。
    
    参数:
        node: 节点名称
        status: 状态 ('queued', 'running', 'completed', 'error')
        composition: 合金成分标识
        data: 附加数据
    """
    ws = current_websocket.get()
    if ws is None:
        logger.warning(f"无法发送状态更新: WebSocket 未设置")
        return
    
    try:
        msg = {
            "type": "node_status",
            "timestamp": int(time.time() * 1000),
            "node": node,
            "status": status
        }
        
        if composition:
            msg["composition"] = composition
        
        if data:
            msg["data"] = data
        
        # 添加节点元数据
        if node in NODE_CONFIG:
            msg["meta"] = NODE_CONFIG[node]
        
        await ws.send_json(msg)
        logger.debug(f"发送节点状态: {node} -> {status}, composition={composition}")
    except Exception as e:
        logger.error(f"发送状态更新失败: {e}")


async def send_tool_result(
    node: str,
    tool_name: str,
    tool_type: str,
    result: dict,
    success: bool,
    composition: str = None,
    calculation_type: str = None
):
    """
    从节点函数内部发送工具调用结果消息。
    用于实时推送每个工具的执行结果，无需等待整个节点完成。
    
    参数:
        node: 节点名称
        tool_name: 工具名称
        tool_type: 工具类型 ('database', 'ml_model', 'simulation')
        result: 工具返回结果
        success: 是否成功
        composition: 合金成分标识
        calculation_type: 计算类型（用于热力学计算）
    """
    ws = current_websocket.get()
    if ws is None:
        logger.warning(f"无法发送工具结果: WebSocket 未设置")
        return
    
    try:
        data = {
            "tool_name": tool_name,
            "tool_type": tool_type,
            "result": result,
            "success": success
        }
        
        if calculation_type:
            data["calculation_type"] = calculation_type
        
        if composition:
            data["composition"] = composition
        
        msg = {
            "type": "tool_result",
            "timestamp": int(time.time() * 1000),
            "node": node,
            "data": data
        }
        
        if composition:
            msg["composition"] = composition
        
        await ws.send_json(msg)
        logger.info(f"发送工具结果: {tool_name}, composition={composition}, success={success}")
    except Exception as e:
        logger.error(f"发送工具结果失败: {e}")


async def send_llm_token(
    node: str,
    token: str,
    composition: str = None,
    is_complete: bool = False
):
    """
    发送 LLM 流式 token 消息。
    
    用于实时推送 LLM 生成的文本片段到前端，实现打字机效果。
    
    参数:
        node: 节点名称（如 'generate_report'）
        token: token 文本片段（流式时为单个 chunk，完成时可为空）
        composition: 合金成分标识（可选）
        is_complete: 是否流式结束标志
    """
    ws = current_websocket.get()
    if ws is None:
        return
    
    try:
        msg = {
            "type": "llm_complete" if is_complete else "llm_token",
            "timestamp": int(time.time() * 1000),
            "node": node,
            "token": token
        }
        
        if composition:
            msg["composition"] = composition
        
        await ws.send_json(msg)
        
        # 只在完成时记录日志，避免大量 token 日志
        if is_complete:
            logger.info(f"LLM 流式输出完成: {node}")
    except Exception as e:
        logger.error(f"发送 LLM token 失败: {e}")


router = APIRouter()


# ================================
# 统一消息格式
# ================================
# 所有消息遵循以下格式:
# {
#   "type": "node_start" | "node_complete" | "tool_call" | "tool_result" | "data" | "error" | "done",
#   "timestamp": 1234567890123,
#   "node": "节点名称",
#   "data": { ... }  // 具体数据
# }

# 节点元数据配置
NODE_CONFIG = {
    "extract_parameters": {
        "label": "参数提取",
        "description": "从用户输入中识别材料体系和性能要求",
        "icon": "search"
    },
    "query_idme": {
        "label": "IDME 查询",
        "description": "查询材料数据库获取相关数据",
        "icon": "database",
        "tool": "IDME API"
    },
    "recommend_alloys": {
        "label": "合金推荐",
        "description": "基于数据和需求推荐合金配方",
        "icon": "lightbulb"
    },
    "predict_performance": {
        "label": "性能预测",
        "description": "使用 ONNX 模型预测合金性能",
        "icon": "cpu",
        "tool": "ONNX Model"
    },
    "calculate_thermo": {
        "label": "热力学计算",
        "description": "执行 Calphad 热力学模拟（点计算、线计算、Scheil凝固）",
        "icon": "flame",
        "tool": "Calphad"
    },
    "interpret_results": {
        "label": "结果解读",
        "description": "AI 分析计算结果并给出建议",
        "icon": "brain"
    },
    "format_output": {
        "label": "格式化输出",
        "description": "整理分析结果",
        "icon": "file-text"
    },
    "generate_report": {
        "label": "报告生成",
        "description": "生成最终分析报告",
        "icon": "file-check"
    },
    "analysis_subgraph": {
        "label": "并行分析",
        "description": "对推荐合金进行并行计算分析",
        "icon": "git-branch"
    }
}


def create_message(msg_type: str, node: str = None, composition: str = None, data: dict = None) -> dict:
    """
    创建统一格式的消息。
    
    参数:
        msg_type: 消息类型
        node: 节点名称
        composition: 合金成分标识（用于区分多组并行计算）
        data: 附加数据
        
    返回:
        格式化的消息字典
    """
    msg = {
        "type": msg_type,
        "timestamp": int(time.time() * 1000)
    }
    
    if node:
        msg["node"] = node
        # 添加节点元数据
        if node in NODE_CONFIG:
            msg["meta"] = NODE_CONFIG[node]
    
    # 添加合金成分标识（用于多组并行计算）
    if composition:
        msg["composition"] = composition
    
    if data:
        msg["data"] = data
        
    return msg


@router.websocket("/ws/run")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket 端点，用于实时流式执行工作流。
    
    客户端发送: {"input": "用户请求内容"}
    服务端返回统一格式的消息流。
    """
    await websocket.accept()
    logger.info("WebSocket 连接已建立")
    
    try:
        while True:
            raw_data = await websocket.receive_text()
            logger.info(f"收到消息: {raw_data}")
            
            # 解析输入
            try:
                import json
                payload = json.loads(raw_data)
                user_input = payload.get("input")
            except Exception:
                await websocket.send_json(create_message(
                    "error", 
                    data={"message": "无效的 JSON 格式"}
                ))
                continue

            if not user_input:
                continue

            logger.info(f"开始处理用户请求: {user_input}")
            
            # 设置全局 WebSocket 上下文，供节点函数使用
            current_websocket.set(websocket)
            
            # 发送工作流开始消息
            await websocket.send_json(create_message(
                "workflow_start",
                data={"input": user_input}
            ))
            
            # 初始状态
            initial_state = {"messages": [HumanMessage(content=user_input)]}
            
            # 记录已处理的节点
            processed_nodes = set()
            
            # 维护 namespace -> composition 的映射
            # 当子图首次执行时记录其 composition，后续节点复用
            namespace_composition_map: Dict[str, str] = {}
            
            # 运行图并流式传输（启用 subgraphs=True 获取子图内部节点）
            async for namespace, chunk in graph.astream(initial_state, stream_mode="updates", subgraphs=True):
                if not isinstance(chunk, dict):
                    continue
                    
                for node_name, state_update in chunk.items():
                    # 提取实际节点名（子图节点名可能带有命名空间前缀）
                    actual_node_name = node_name
                    
                    # 获取 namespace 标识符（用于追踪同一子图实例）
                    ns_key = namespace[0] if namespace else None
                    
                    # 提取合金成分标识
                    composition = None
                    
                    # 1. 先尝试从映射中获取（复用已记录的 composition）
                    if ns_key and ns_key in namespace_composition_map:
                        composition = namespace_composition_map[ns_key]
                    
                    # 2. 如果映射中没有，从 state_update 获取
                    if not composition and isinstance(state_update, dict):
                        composition = state_update.get("composition")
                        # 记录到映射中，供后续节点使用
                        if composition and ns_key:
                            namespace_composition_map[ns_key] = composition
                            logger.info(f"记录子图 composition: {ns_key} -> {composition}")
                    
                    if namespace:
                        logger.info(f"子图节点: ns_key={ns_key}, node={node_name}, composition={composition}")
                    
                    # 生成唯一节点标识（节点名+合金成分）
                    node_key = f"{actual_node_name}:{composition}" if composition else actual_node_name
                    
                    # 发送节点开始消息（如果是新节点）
                    if node_key not in processed_nodes:
                        await websocket.send_json(create_message(
                            "node_start",
                            node=actual_node_name,
                            composition=composition
                        ))
                        processed_nodes.add(node_key)
                    
                    # 检查是否有工具调用结果
                    tool_data = _extract_tool_data(actual_node_name, state_update)
                    if tool_data:
                        # 处理多结果情况（如三种热力学计算）
                        if isinstance(tool_data, list):
                            for single_result in tool_data:
                                # 添加 composition 到结果数据
                                if composition:
                                    single_result["composition"] = composition
                                await websocket.send_json(create_message(
                                    "tool_result",
                                    node=actual_node_name,
                                    composition=composition,
                                    data=single_result
                                ))
                        else:
                            # 单结果情况
                            if composition and isinstance(tool_data, dict):
                                tool_data["composition"] = composition
                            await websocket.send_json(create_message(
                                "tool_result",
                                node=actual_node_name,
                                composition=composition,
                                data=tool_data
                            ))
                    
                    # 发送节点完成消息
                    node_output = _extract_node_output(actual_node_name, state_update)
                    if composition and isinstance(node_output, dict):
                        node_output["composition"] = composition
                    await websocket.send_json(create_message(
                        "node_complete",
                        node=actual_node_name,
                        composition=composition,
                        data=node_output
                    ))
                    
                    logger.info(f"节点完成: {actual_node_name}, composition={composition}")

            # 发送工作流完成消息
            await websocket.send_json(create_message("done"))
            logger.info("工作流执行完成")

    except WebSocketDisconnect:
        logger.info("客户端断开连接")
    except Exception as e:
        import traceback
        logger.error(f"工作流执行错误: {e}\n{traceback.format_exc()}")
        try:
            await websocket.send_json(create_message(
                "error",
                data={"message": str(e)}
            ))
        except:
            pass


def _extract_tool_data(node_name: str, state_update: dict) -> dict | None:
    """
    提取工具调用相关数据。
    
    参数:
        node_name: 节点名称
        state_update: 状态更新
        
    返回:
        工具调用数据，如果没有则返回 None
    """
    tool_mappings = {
        "query_idme": {
            "key": "idme_results",
            "tool_name": "IDME API",
            "tool_type": "database"
        },
        "predict_performance": {
            "key": "onnx_result",
            "tool_name": "ONNX 性能预测",
            "tool_type": "ml_model"
        }
        # 注意：calculate_thermo 已在节点函数中通过 send_tool_result 实时发送结果
        # 不在此处重复提取，避免重复显示
    }
    
    if node_name in tool_mappings:
        mapping = tool_mappings[node_name]
        key = mapping["key"]
        if key in state_update:
            raw_result = state_update[key]
            
            # 单结果情况（ONNX、IDME等）
            if isinstance(raw_result, dict) and "result" in raw_result:
                actual_result = raw_result.get("result")
                tool_input = raw_result.get("input", {})
                actual_tool_name = raw_result.get("tool_name", mapping["tool_name"])
            else:
                actual_result = raw_result
                tool_input = {}
                actual_tool_name = mapping["tool_name"]
            
            # 改进成功判断逻辑
            success = True
            if isinstance(raw_result, dict):
                # 检查是否有实际的 error 字段（非空）
                if raw_result.get("error"):
                    success = False
                # 对于 IDME，检查 resultType
                elif actual_result and isinstance(actual_result, dict):
                    if actual_result.get("resultType") == "SUCCESS":
                        success = True
                    # 检查 data 是否有内容
                    elif "data" in actual_result and isinstance(actual_result["data"], list):
                        success = len(actual_result["data"]) > 0
            
            return {
                "tool_name": actual_tool_name,
                "tool_type": mapping["tool_type"],
                "input": tool_input,
                "result": actual_result,
                "success": success
            }
    
    return None


def _extract_node_output(node_name: str, state_update: dict) -> dict:
    """
    提取节点输出数据。
    
    参数:
        node_name: 节点名称
        state_update: 状态更新
        
    返回:
        格式化的输出数据
    """
    output = {}
    
    # 根据节点类型提取关键数据
    key_mappings = {
        "extract_parameters": ["system", "performance_requirements"],
        "query_idme": ["idme_results"],
        "recommend_alloys": ["recommended_alloys"],
        "predict_performance": ["onnx_result"],
        "calculate_thermo": ["calphad_result"],
        "interpret_results": ["interpretation"],
        "format_output": ["analysis_results"],
        "generate_report": ["final_report"]
    }
    
    if node_name in key_mappings:
        for key in key_mappings[node_name]:
            if key in state_update:
                output[key] = state_update[key]
    
    return output
