"""
LangGraph 节点函数

定义工作流中每个节点的处理逻辑。
"""

import json
import re
from typing import Dict, Any
from langchain_core.messages import HumanMessage

from .state import OverallState, AlloyState
from ..core.logger import logger
from ..core.llm import get_default_llm
from ..models.schemas import CalculationType
from ..services.idme_service import query_idme_api
from ..services.mcp_service import call_mcp_tool
from ..utils.composition import (
    parse_composition_string,
    mass_to_atomic_fraction,
    format_onnx_inputs,
)
from ..utils.mcp_parser import parse_onnx_result, parse_calphad_result

# 获取 LLM 实例
llm = get_default_llm()


# ================================
# 主图节点
# ================================

def extract_parameters(state: OverallState) -> Dict[str, Any]:
    """
    从用户输入中提取材料体系和性能要求。
    
    参数:
        state: 全局状态，包含用户消息
        
    返回:
        提取的 system 和 performance_requirements
    """
    messages = state["messages"]
    last_message = messages[-1].content
    
    logger.info(f"开始提取参数，用户输入: {last_message}")
    
    prompt = f"""
    你是一位铝合金材料科学专家。请从用户需求中提取以下参数：
    
    1. **system**: 合金体系，格式为 "Al-X-Y" (如 Al-Si、Al-Si-Mg、Al-Mg)
       - 可识别的体系包括：Al-Si、Al-Mg、Al-Si-Mg、Al-Cu、Al-Zn
       
    2. **performance_requirements**: 性能指标要求
       - 包括：抗拉强度(UTS)、屈服强度(YS)、延伸率(EL)、硬度等
       - 格式示例："抗拉强度: [300, +∞] (单位: MPa)"
       
    3. **elements**: 体系所包含的元素列表
       - 格式示例：["Al", "Si", "Mg"]
    
    请以 JSON 格式返回，不要添加 markdown 格式：
    {{"system": "Al-Si-Mg", "performance_requirements": "屈服强度不低于100MPa", "elements": ["Al", "Si", "Mg"]}}
    
    用户请求: {last_message}
    """
    
    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        # 简单解析，生产环境中建议使用结构化输出
        content = response.content.strip()
        
        # 处理可能的 markdown 代码块
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
            
        data = json.loads(content)
        system = data.get("system", "Al-Si-Mg")
        requirements = data.get("performance_requirements", last_message)
        
        logger.info(f"参数提取成功 - 体系: {system}, 要求: {requirements[:50]}...")
        
        return {
            "system": system,
            "performance_requirements": requirements
        }
    except Exception as e:
        logger.warning(f"提取参数时出错: {e}，使用默认值 Al-Si-Mg")
        return {"system": "Al-Si-Mg", "performance_requirements": last_message}


def query_idme(state: OverallState) -> Dict[str, Any]:
    """
    查询 IDME API 获取材料数据。
    
    支持回退查询：如果主体系没有数据，自动尝试相关体系。
    
    参数:
        state: 全局状态，包含 system 信息
        
    返回:
        IDME 查询结果
    """
    system = state.get("system", "Al-Si-Mg")
    
    # IDME 数据库目前只有 Al-Si-Mg 体系数据
    # 将所有铝合金体系统一映射为 Al-Si-Mg
    SUPPORTED_SYSTEM = "Al-Si-Mg"
    
    if system != SUPPORTED_SYSTEM:
        logger.info(f"体系 {system} 映射为 {SUPPORTED_SYSTEM} 进行查询")
        system = SUPPORTED_SYSTEM
    
    logger.info(f"查询 IDME，材料体系: {system}")
    
    try:
        result = query_idme_api.invoke({"material_system": system})
        
        if isinstance(result, dict) and "data" in result:
            data = result["data"]
            data_count = len(data) if isinstance(data, list) else 0
            logger.info(f"IDME 返回 {data_count} 条数据")
            return {"idme_results": result}
        else:
            return {"idme_results": {"data": [], "resultType": "SUCCESS", "errors": {}}}
            
    except Exception as e:
        logger.error(f"查询 IDME 失败: {e}")
        return {"idme_results": {"data": [], "error": str(e)}}


def recommend_alloys(state: OverallState) -> Dict[str, Any]:
    """
    根据 IDME 结果和性能要求推荐合金。
    
    参数:
        state: 全局状态，包含 IDME 结果和性能要求
        
    返回:
        推荐的合金成分列表
    """
    system = state.get("system")
    requirements = state.get("performance_requirements")
    idme_results = state.get("idme_results")
    
    prompt = f"""
    你是铝合金设计专家。基于以下信息推荐合金成分：
    
    **材料体系**: {system}
    **性能要求**: {requirements}
    **知识图谱数据**: {str(idme_results)[:1500]}
    
    任务要求：
    1. 从知识图谱中筛选出符合性能要求的最优合金成分作为 filtered_alloy_composition
    2. 基于知识图谱数据推理，推荐 2 种可能具有更高目标性能的新合金成分
       - 这些成分应在现有数据基础上进行合理优化
       - 考虑元素之间的协同作用
    
    **成分格式要求**：
    - 使用 "Al-XSi-YMg" 格式（X、Y 为质量百分比数值）
    - 示例："Al-11Si-0.5Mg"、"Al-7Si-0.3Mg-0.1Ti"
    
    请仅返回 JSON 数组，不要添加任何解释或 markdown 格式：
    ["Al-11Si-0.5Mg", "Al-7Si-0.35Mg", "Al-9Si-0.4Mg"]
    """
    
    response = llm.invoke([HumanMessage(content=prompt)])
    try:
        content = response.content.strip()
        # 处理 Markdown 代码块格式
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        alloys = json.loads(content)
        if isinstance(alloys, list) and len(alloys) > 0:
            logger.success(f"合金推荐成功，推荐 {len(alloys)} 种合金: {alloys}")
            return {"recommended_alloys": alloys}
        else:
            logger.warning(f"LLM 返回空列表，使用默认推荐")
            return {"recommended_alloys": ["Al-7Si-0.3Mg", "Al-8Si-0.4Mg"]}
    except Exception as e:
        logger.warning(f"推荐合金解析失败: {e}，原始响应: {response.content[:200]}...")
        return {"recommended_alloys": ["Al-7Si-0.3Mg", "Al-8Si-0.4Mg"]}


async def generate_report(state: OverallState) -> Dict[str, Any]:
    """
    生成最终分析报告（流式输出）。
    
    使用流式 LLM 实时推送生成的报告内容到前端，实现打字机效果。
    
    参数:
        state: 全局状态，包含所有分析结果
        
    返回:
        最终报告内容
    """
    # 延迟导入避免循环依赖
    from ..api.websocket import send_llm_token
    from ..core.llm import get_streaming_llm
    
    # 提取并格式化分析结果数据
    analysis_results = state.get('analysis_results', [])
    analysis_summary = []
    
    for result in analysis_results:
        composition = result.get('composition', '未知')
        onnx = result.get('onnx', {})
        calphad = result.get('calphad', {})
        
        # 提取 ONNX 性能预测
        onnx_data = onnx.get('result', {}) if isinstance(onnx, dict) else {}
        uts = onnx_data.get('UTS', '无数据')
        ys = onnx_data.get('YS', '无数据')
        el = onnx_data.get('EL', '无数据')
        
        # 提取 Calphad 热力学数据
        point_data = calphad.get('point', {}).get('data', {}) if calphad.get('point') else {}
        line_data = calphad.get('line', {}).get('data', {}) if calphad.get('line') else {}
        scheil_data = calphad.get('scheil', {}).get('data', {}) if calphad.get('scheil') else {}
        
        # 构建合金数据摘要
        alloy_summary = f"""
### {composition}
**ONNX 性能预测**:
- 抗拉强度 (UTS): {uts} MPa
- 屈服强度 (YS): {ys} MPa  
- 延伸率 (EL): {el} %

**热力学计算结果**:
- 点计算平衡相: {point_data.get('equilibrium_phases', '无数据')}
- 点计算温度: {point_data.get('temperature', '无数据')} K
- 线计算液相线温度: {line_data.get('liquidus_temp', '无数据')} K
- 线计算相演化: {line_data.get('phase_evolution', '无数据')}
- Scheil液相线温度: {scheil_data.get('liquidus_temp', '无数据')} K
- Scheil固相线温度: {scheil_data.get('solidus_temp', '无数据')} K
- Scheil相分数: {scheil_data.get('phase_fractions', '无数据')}
- Scheil凝固路径: {scheil_data.get('phase_sequence', '无数据')}
"""
        analysis_summary.append(alloy_summary)
    
    prompt = f"""
    你是铝合金材料科学家和工程技术顾问。请生成一份专业的合金设计可行性报告。
    
    ## 设计任务信息
    - **目标体系**: {state.get('system')}
    - **性能要求**: {state.get('performance_requirements')}
    - **候选合金**: {state.get('recommended_alloys')}
    
    ## 各合金分析数据
    {''.join(analysis_summary)}
    
    ## 报告要求
    请生成包含以下内容的报告：
    
    1. **设计目标概述**: 简述用户需求和设计目标
    2. **候选合金评估**: 对每种候选合金的热力学特性和预测性能进行分析，引用上述具体数据
    3. **最优方案推荐**: 基于综合分析，推荐最优合金成分及其理由
    4. **工艺建议**: 针对推荐合金给出工艺参数建议（熔炼温度、时效处理等）
    5. **风险提示**: 指出可能存在的问题和改进方向
    
    请使用专业、简洁的语言，重点突出数据支撑的结论。确保引用具体的计算数据值。
    """
    
    # 使用流式 LLM 生成报告
    streaming_llm = get_streaming_llm()
    full_text = ""
    
    logger.info("开始流式生成报告...")
    
    # 流式消费 token 并实时推送到前端
    async for chunk in streaming_llm.astream([HumanMessage(content=prompt)]):
        token = chunk.content
        if token:
            full_text += token
            # 实时推送 token 到前端
            await send_llm_token(
                node="generate_report",
                token=token
            )
    
    # 发送流式结束信号
    await send_llm_token(
        node="generate_report",
        token="",
        is_complete=True
    )
    
    logger.success(f"报告生成完成，总长度: {len(full_text)} 字符")
    
    # 保存 Markdown 文件用于调试
    try:
        import os
        from datetime import datetime
        
        # 保存到 backend/reports 目录
        reports_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')
        os.makedirs(reports_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"report_{timestamp}.md"
        filepath = os.path.join(reports_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(full_text)
        
        logger.info(f"报告已保存到: {filepath}")
    except Exception as e:
        logger.warning(f"保存报告文件失败: {e}")
    
    return {"final_report": full_text}


# ================================
# 分析子图节点
# ================================

def determine_calc_type(state: AlloyState) -> Dict[str, Any]:
    """
    根据合金成分判断应使用的热力学计算类型。
    
    参数:
        state: 合金状态，包含成分信息
        
    返回:
        计算类型 (point/line/scheil)
    """
    composition = state["composition"]
    
    try:
        # 使用结构化输出
        structured_llm = llm.with_structured_output(CalculationType)
        
        prompt = f"""
        你是铝合金热力学计算专家。根据以下信息判断应使用哪种热力学计算类型。
        
        **合金成分**: {composition}
        
        **计算类型说明**:
        1. **point (点计算)**: 计算特定温度和压力下的相平衡
           - 适用于：快速评估某一温度点的相组成
           - 输出：平衡相、吉布斯能、化学势
           
        2. **line (线计算)**: 沿温度轴进行扫描计算
           - 适用于：绘制相图、分析相变温度
           - 输出：温度-相分数曲线
           
        3. **scheil (希尔凝固计算)**: 模拟非平衡凝固过程
           - 适用于：铸造工艺分析、凝固路径预测
           - 输出：凝固相序列、液相线/固相线温度
        
        **默认规则**: 对于铝合金设计，优先使用 scheil 计算以评估铸造特性。
        
        请严格按照 JSON 格式输出:
        {{"calculation_type": "scheil", "reason": "用于评估铸造凝固特性"}}
        """
        
        result = structured_llm.invoke(prompt)
        calc_type = result.calculation_type.lower()
        
        # 验证返回值
        if calc_type not in ["point", "line", "scheil"]:
            calc_type = "scheil"
            
        logger.info(f"计算类型判断: {composition} -> {calc_type} (原因: {result.reason})")
        return {"calculation_type": calc_type}
        
    except Exception as e:
        logger.warning(f"计算类型判断失败: {e}，使用默认值 scheil")
        return {"calculation_type": "scheil"}


async def predict_performance(state: AlloyState) -> Dict[str, Any]:
    """
    调用 ONNX 工具进行性能预测。
    
    使用模型: AlSiMg_properties_v1
    
    参数:
        state: 合金状态，包含成分信息
        
    返回:
        ONNX 预测结果
    """
    # 延迟导入避免循环依赖
    from ..api.websocket import send_node_status
    
    composition = state["composition"]
    node_name = "predict_performance"
    # AlSiMg_properties_v1 模型的 UUID
    model_uuid = "9fa6d60e-55ea-4035-96f2-6f9cfa1a9696"
    
    logger.info(f"开始性能预测，成分: {composition}")
    
    # 发送运行中状态
    await send_node_status(
        node=node_name,
        status="running",
        composition=composition,
        data={"message": "正在进行性能预测..."}
    )
    
    # 步骤1: 解析成分字符串为质量分数
    mass_fractions = parse_composition_string(composition)
    
    # 步骤2: 转换为 ONNX 输入格式
    inputs = format_onnx_inputs(mass_fractions)
    
    logger.info(f"ONNX 输入参数: {inputs}")
    
    # 步骤3: 执行推理
    inference_result = await call_mcp_tool("onnx_model_inference", {
        "uuid": model_uuid,
        "inputs": inputs
    })
    
    # 解析 ONNX 返回结果（MCP 返回格式化字符串，需要解析提取数据）
    parsed_result = None
    if isinstance(inference_result, dict):
        if inference_result.get("error"):
            logger.error(f"性能预测失败: {inference_result.get('error')}")
            await send_node_status(
                node=node_name,
                status="error",
                composition=composition,
                data={"message": f"预测失败: {inference_result.get('error')}"}
            )
            parsed_result = {"error": inference_result.get("error")}
        else:
            # 解析 MCP 返回的格式化字符串，提取性能指标
            raw_result = inference_result.get("result", inference_result)
            parsed_result = parse_onnx_result(raw_result)
            
            logger.success(f"性能预测成功，成分: {composition}")
            logger.info(f"ONNX 解析结果: UTS={parsed_result.get('UTS')}, YS={parsed_result.get('YS')}, EL={parsed_result.get('EL')}")
            
            await send_node_status(
                node=node_name,
                status="completed",
                composition=composition,
                data={"message": "性能预测完成"}
            )
    
    # 返回解析后的结构化结果
    final_result = {
        "result": parsed_result,
        "tool_name": inference_result.get("tool_name", "onnx_model_inference"),
        "input": inference_result.get("input", inputs)
    }
    
    # 返回 composition 以便 WebSocket 端点追踪子图实例
    return {"onnx_result": final_result, "composition": composition}


TASK_POLL_INTERVAL = 15.0  # 轮询间隔（秒），适当放宽减少服务器压力
TASK_POLL_TIMEOUT = 300.0  # 超时时间（秒），5分钟，热力学计算通常需要2-3分钟

# 全局信号量：限制热力学计算的最大并发数
# Calphad 服务端有并发限制，且对复杂成分(多元素)任务处理较慢
# 设为1确保完全串行，避免简单任务抢占导致复杂任务长时间排队
import asyncio
THERMO_SEMAPHORE = asyncio.Semaphore(4)  # 同一时间只允许1个合金的热力学计算


async def calculate_thermo(state: AlloyState) -> Dict[str, Any]:
    """
    调用 Calphad 工具进行热力学计算。
    
    执行三种计算类型: point(点计算), line(线计算), scheil(凝固计算)
    采用异步提交 + 轮询等待的模式获取计算结果。
    使用全局信号量控制并发数，避免服务端队列拥堵。
    
    参数:
        state: 合金状态，包含成分信息
        
    返回:
        包含三种计算结果的 Calphad 结果字典
    """
    # 延迟导入避免循环依赖
    from ..api.websocket import send_node_status, send_tool_result
    
    composition_str = state["composition"]
    
    # 发送三个子节点的初始状态（排队中，等待信号量）
    for calc_type in ["point", "line", "scheil"]:
        await send_node_status(
            node=f"calculate_thermo_{calc_type}",
            status="queued",
            composition=composition_str,
            data={"message": f"等待计算槽位..."}
        )
    
    logger.info(f"准备热力学计算，成分: {composition_str}")
        
    # 步骤1: 解析成分字符串为质量分数
    mass_fractions = parse_composition_string(composition_str)
    
    # 步骤2: 转换为原子分数 (Calphad 需要原子分数)
    composition = mass_to_atomic_fraction(mass_fractions)
    components = list(composition.keys())
    
    # 三种计算任务的配置（包含各自特定的输入参数）
    # 根据 MCP 工具 schema 和工作流设计配置参数
    calc_configs = [
        {
            "type": "point",
            "tool_name": "calphamesh_submit_point_task",
            "label": "点计算",
            # 点计算：单一温度点的平衡计算
            "input": {
                "components": components,
                "composition": composition,
                "database": "al-default",
                "temperature": 1000.0,  # 计算温度 (K)
                "pressure": 1.0
            }
        },
        {
            "type": "line", 
            "tool_name": "calphamesh_submit_line_task",
            "label": "线计算",
            # 线计算：温度范围扫描，获取相分数随温度变化
            # 参数参考工作流: ctp (起始) + ctp_1 (结束) + ctp_steps
            "input": {
                "components": components,
                "start_composition": composition,
                "end_composition": composition,  # 成分不变，只扫描温度
                "start_temperature": 298.0,      # 起始温度 (K)
                "end_temperature": 1000.0,       # 结束温度 (K)
                "steps": 60,                     # 计算步数
                "database": "al-default",
                "pressure": 1.0
            }
        },
        {
            "type": "scheil",
            "tool_name": "calphamesh_submit_scheil_task",
            "label": "Scheil凝固计算",
            # Scheil凝固：从高温开始模拟非平衡凝固过程
            "input": {
                "components": components,
                "composition": composition,
                "database": "al-default",
                "temperature": 1000.0,  # 起始温度 (K)
                "pressure": 1.0
            }
        }
    ]
    
    logger.info(f"Calphad 计算配置已生成，成分: {composition}")
    
    async def submit_and_wait_task(config: dict):
        """
        提交计算任务并轮询等待结果。
        
        流程:
        1. 提交任务 → 获取 task_id
        2. 轮询 calphamesh_get_task_status 直到完成
        3. 返回最终结果
        """
        calc_type = config["type"]
        tool_name = config["tool_name"]
        label = config["label"]
        task_input = config["input"]  # 使用配置中的特定输入参数
        node_name = f"calculate_thermo_{calc_type}"  # 前端节点名
        
        # 步骤1: 提交任务
        logger.info(f"提交 {label} 任务 ({tool_name})")
        logger.info(f"{label} 输入参数: {task_input}")
        submit_result = await call_mcp_tool(tool_name, task_input)
        
        # 检查提交结果
        if isinstance(submit_result, dict) and submit_result.get("error"):
            logger.error(f"{label} 任务提交失败: {submit_result.get('error')}")
            # 发送错误状态
            await send_node_status(
                node=node_name,
                status="error",
                composition=composition_str,
                data={"message": f"任务提交失败: {submit_result.get('error')}"}
            )
            return calc_type, submit_result
        
        # 提取任务 ID（可能在 result 字段或直接返回）
        actual_result = submit_result.get("result", submit_result) if isinstance(submit_result, dict) else submit_result
        task_id = None
        
        if isinstance(actual_result, dict):
            task_id = actual_result.get("task_id") or actual_result.get("taskId") or actual_result.get("id")
        elif isinstance(actual_result, str):
            # MCP 返回格式化字符串，需要用正则提取任务ID
            # 格式: "✅ Scheil 计算任务提交成功！\n📋 任务ID: 17188\n📊 状态: pending..."
            match = re.search(r'任务ID[：:]\s*(\d+)', actual_result)
            if match:
                task_id = int(match.group(1))
            else:
                # 尝试其他可能的格式
                match = re.search(r'task_id[：:]\s*(\d+)', actual_result, re.IGNORECASE)
                if match:
                    task_id = int(match.group(1))
            
        logger.info(f"{label} 任务已提交，task_id: {task_id}")
        logger.info(f"{label} 提交返回: {json.dumps(submit_result, ensure_ascii=False, default=str)[:300]}")
        
        # 发送运行中状态（任务已提交）
        await send_node_status(
            node=node_name,
            status="running",
            composition=composition_str,
            data={"message": f"任务已提交，ID: {task_id}", "task_id": task_id}
        )
        
        # 如果没有 task_id，说明可能是同步返回结果
        if not task_id:
            logger.warning(f"{label} 未获取到 task_id，直接使用返回结果")
            if isinstance(submit_result, dict):
                submit_result["calculation_type"] = calc_type
                submit_result["calculation_label"] = label
            # 发送完成状态
            await send_node_status(
                node=node_name,
                status="completed",
                composition=composition_str,
                data={"message": "计算完成（同步返回）"}
            )
            return calc_type, submit_result
        
        # 步骤2: 轮询等待结果
        start_time = asyncio.get_event_loop().time()
        poll_count = 0
        last_status_sent = ""  # 记录上次发送的状态，避免重复发送
        
        while True:
            poll_count += 1
            elapsed = asyncio.get_event_loop().time() - start_time
            
            # 超时检查
            if elapsed > TASK_POLL_TIMEOUT:
                logger.error(f"{label} 任务超时（{TASK_POLL_TIMEOUT}秒），task_id: {task_id}")
                # 发送错误状态
                await send_node_status(
                    node=node_name,
                    status="error",
                    composition=composition_str,
                    data={"message": f"任务超时（{TASK_POLL_TIMEOUT}秒）", "task_id": task_id}
                )
                return calc_type, {
                    "error": f"任务超时",
                    "task_id": task_id,
                    "calculation_type": calc_type,
                    "calculation_label": label
                }
            
            # 查询任务状态
            status_result = await call_mcp_tool("calphamesh_get_task_status", {"task_id": task_id})
            actual_status = status_result.get("result", status_result) if isinstance(status_result, dict) else status_result
            
            # 详细日志：每5次或首次轮询输出完整状态
            if poll_count == 1 or poll_count % 5 == 0:
                logger.info(f"{label} 轮询 #{poll_count}，耗时 {elapsed:.1f}s")
                logger.info(f"{label} 原始返回: {json.dumps(status_result, ensure_ascii=False, default=str)[:400]}")
            
            # 解析状态（支持字典和字符串格式）
            status = ""
            if isinstance(actual_status, dict):
                status = actual_status.get("status", "").lower()
            elif isinstance(actual_status, str):
                # MCP 可能返回格式化字符串，尝试提取状态
                # 格式: "📊 状态: completed" 或 "status: running"
                status_match = re.search(r'状态[：:]\s*(\w+)', actual_status)
                if status_match:
                    status = status_match.group(1).lower()
                else:
                    status_match = re.search(r'status[：:]\s*(\w+)', actual_status, re.IGNORECASE)
                    if status_match:
                        status = status_match.group(1).lower()
                
                # 检查字符串中是否包含完成标记
                if "completed" in actual_status.lower() or "success" in actual_status.lower():
                    status = "completed"
            
            if status in ["completed", "success", "finished", "done"]:
                # 任务完成
                logger.success(f"{label} 任务完成，耗时 {elapsed:.1f}s，轮询 {poll_count} 次")
                logger.info(f"{label} 结果: {json.dumps(actual_status, ensure_ascii=False, default=str)[:500]}")
                
                # 解析 Calphad 返回的格式化字符串
                parsed_result = parse_calphad_result(status_result, calc_type)
                parsed_result["calculation_label"] = label
                parsed_result["task_id"] = task_id
                
                # 判断是否成功（检查解析结果中是否有 error）
                success = not parsed_result.get("error")
                
                # 实时发送工具结果（不等待其他任务完成）
                # 包含 data 和 raw_data 供前端图表使用
                result_to_send = {
                    "data": parsed_result.get("data", {}),
                    "raw_data": parsed_result.get("raw_data", {})
                }
                await send_tool_result(
                    node="calculate_thermo",
                    tool_name=label,
                    tool_type="simulation",
                    result=result_to_send,
                    success=success,
                    composition=composition_str,
                    calculation_type=calc_type
                )
                
                # 发送完成状态
                await send_node_status(
                    node=node_name,
                    status="completed",
                    composition=composition_str,
                    data={"message": f"计算完成，耗时 {elapsed:.1f}s", "task_id": task_id}
                )
                
                return calc_type, parsed_result
            
            elif status in ["failed", "error"]:
                # 任务失败
                error_msg = ""
                if isinstance(actual_status, dict):
                    error_msg = actual_status.get("error") or actual_status.get("message") or "未知错误"
                elif isinstance(actual_status, str):
                    error_msg = actual_status
                logger.error(f"{label} 任务失败: {error_msg}")
                
                error_result = {
                    "error": error_msg,
                    "task_id": task_id,
                    "calculation_type": calc_type,
                    "calculation_label": label
                }
                
                # 实时发送失败结果
                await send_tool_result(
                    node="calculate_thermo",
                    tool_name=label,
                    tool_type="simulation",
                    result=error_result,
                    success=False,
                    composition=composition_str,
                    calculation_type=calc_type
                )
                
                # 发送错误状态
                await send_node_status(
                    node=node_name,
                    status="error",
                    composition=composition_str,
                    data={"message": f"计算失败: {error_msg}", "task_id": task_id}
                )
                
                return calc_type, error_result
            
            elif status in ["pending", "running", "processing", "queued"]:
                # 仍在执行，发送进度更新（首次或每5次轮询）
                if poll_count == 1 or poll_count % 5 == 0:
                    await send_node_status(
                        node=node_name,
                        status="running",
                        composition=composition_str,
                        data={
                            "message": f"计算中... 轮询 #{poll_count}，已耗时 {elapsed:.0f}s",
                            "task_id": task_id,
                            "poll_count": poll_count,
                            "elapsed": round(elapsed, 1)
                        }
                    )
            
            # 等待后继续轮询
            await asyncio.sleep(TASK_POLL_INTERVAL)
    
    # 使用信号量控制并发 + 串行执行计算任务
    # 信号量限制同时执行的热力学计算数量，避免服务端队列拥堵导致超时
    # 即使有多个合金的子图并行执行，也会受到全局并发限制
    async with THERMO_SEMAPHORE:
        logger.info(f"成分 {composition_str} 已获取热力学计算槽位，开始执行")
        
        calphad_results = {}
        for config in calc_configs:
            try:
                calc_type, result = await submit_and_wait_task(config)
                calphad_results[calc_type] = result
            except Exception as e:
                logger.error(f"计算任务异常: {config['type']} - {e}")
    
    logger.info(f"热力学计算完成，成功执行 {len(calphad_results)} 种计算")
    
    # 不返回 composition，避免与 predict_performance 并发更新冲突
    # WebSocket 端点会从 predict_performance 的输出中获取并缓存 composition
    return {"calphad_result": calphad_results}


async def interpret_results(state: AlloyState) -> Dict[str, Any]:
    """
    对分析结果进行专业解读（流式输出）。
    
    结合 ONNX 预测和 Calphad 计算结果，生成材料学解读。
    使用流式 LLM 实时推送到前端对话面板。
    
    参数:
        state: 合金状态，包含所有分析结果
        
    返回:
        专业解读内容
    """
    from ..api.websocket import send_llm_token
    from ..core.llm import get_default_streaming_llm
    
    composition = state["composition"]
    onnx_result = state.get("onnx_result", {})
    calphad_result = state.get("calphad_result", {})
    
    # 简化 calphad 结果，只保留关键数据（避免 prompt 过长）
    calphad_summary = {}
    if calphad_result:
        for calc_type, result in calphad_result.items():
            if isinstance(result, dict) and "data" in result:
                calphad_summary[calc_type] = result["data"]
    
    prompt = f"""你是铝合金材料科学家。请对以下合金的计算结果进行简要专业解读。

## 合金成分
{composition}

## 性能预测
{json.dumps(onnx_result.get("result", onnx_result), ensure_ascii=False) if onnx_result else "无数据"}

## 热力学计算摘要
{json.dumps(calphad_summary, ensure_ascii=False) if calphad_summary else "无数据"}

## 要求
请简要说明（100-150字）：
1. 性能预测结果评价
2. 凝固特性和主要析出相
3. 工艺建议

使用中文，语言专业简洁。"""
    
    try:
        streaming_llm = get_default_streaming_llm()
        full_text = ""
        
        async for chunk in streaming_llm.astream([HumanMessage(content=prompt)]):
            token = chunk.content
            if token:
                full_text += token
                # 实时推送 token 到前端（带合金成分标识）
                await send_llm_token(
                    node="interpret_results",
                    token=token,
                    composition=composition
                )
        
        # 发送流式结束信号
        await send_llm_token(
            node="interpret_results",
            token="",
            composition=composition,
            is_complete=True
        )
        
        interpretation = full_text
        logger.info(f"结果解读完成: {composition}")
        
    except Exception as e:
        logger.warning(f"结果解读失败: {e}")
        interpretation = f"结果解读生成失败: {str(e)}"
    
    return {"interpretation": interpretation}


def format_analysis_output(state: AlloyState) -> Dict[str, Any]:
    """
    将分析结果格式化为列表，用于合并回 OverallState。
    
    参数:
        state: 合金状态，包含所有分析数据
        
    返回:
        格式化的分析结果列表
    """
    return {
        "analysis_results": [{
            "composition": state["composition"],
            "calculation_type": state.get("calculation_type", "scheil"),
            "onnx": state.get("onnx_result"),
            "calphad": state.get("calphad_result"),
            "interpretation": state.get("interpretation")
        }]
    }
