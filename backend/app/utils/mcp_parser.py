"""
MCP 结果解析工具

解析 MCP 服务返回的格式化字符串，提取结构化数据。
MCP 服务（ONNX、Calphad）返回的是人类可读的格式化字符串，
需要解析提取其中的结构化数据供前端使用。
"""

import re
import json
from typing import Dict, Any, Optional, Union

from ..core.logger import logger


def parse_onnx_result(raw_result: Union[str, Dict]) -> Dict[str, Any]:
    """
    解析 ONNX MCP 返回的格式化字符串。
    
    输入格式示例:
    "🎯 推理完成！\n🔥 模型UUID: ...\n⏱️ 推理时间: 0.15ms\n
     📊 输出结果:\n• UTS: 269.176147\n  📝 描述: Ultimate Tensile Strength..."
    
    参数:
        raw_result: MCP 返回的原始结果（字符串或字典）
        
    返回:
        结构化的性能预测结果:
        {
            "UTS": 269.17,          # 抗拉强度 MPa
            "YS": 122.66,           # 屈服强度 MPa
            "EL": 13.02,            # 延伸率 %
            "inference_time": 0.15, # 推理时间 ms
            "model_uuid": "...",    # 模型 UUID
            "request_id": "..."     # 请求 ID
        }
    """
    result = {}
    
    # 如果已经是字典且包含结构化数据，直接返回
    if isinstance(raw_result, dict):
        if "UTS" in raw_result or "tensile_strength" in raw_result:
            return raw_result
        # 检查嵌套的 result 字段
        if "result" in raw_result:
            inner = raw_result["result"]
            if isinstance(inner, dict):
                return inner
            raw_result = inner
    
    # 转换为字符串进行解析
    text = str(raw_result) if raw_result else ""
    
    if not text:
        return {"error": "空结果", "raw": ""}
    
    # 提取性能指标值
    # 格式: • UTS: 269.176147 或 UTS: 269.176147
    patterns = {
        "UTS": r"UTS[：:]\s*([\d.]+)",
        "YS": r"YS[：:]\s*([\d.]+)",
        "EL": r"EL[：:]\s*([\d.]+)",
        "HV": r"HV[：:]\s*([\d.]+)",  # 硬度（如果有）
    }
    
    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                result[key] = round(float(match.group(1)), 2)
            except ValueError:
                pass
    
    # 提取各指标的范围信息（格式: 📊 范围: [50.00, 300.00]）
    range_patterns = {
        "YS": r"YS[：:].*?范围[：:]\s*\[([\d.]+),\s*([\d.]+)\]",
        "UTS": r"UTS[：:].*?范围[：:]\s*\[([\d.]+),\s*([\d.]+)\]",
        "EL": r"EL[：:].*?范围[：:]\s*\[([\d.]+),\s*([\d.]+)\]",
    }
    
    ranges = {}
    for key, pattern in range_patterns.items():
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            try:
                ranges[key] = [float(match.group(1)), float(match.group(2))]
            except ValueError:
                pass
    if ranges:
        result["ranges"] = ranges
    
    # 提取推理时间
    time_match = re.search(r"推理时间[：:]\s*([\d.]+)\s*ms", text)
    if time_match:
        try:
            result["inference_time_ms"] = float(time_match.group(1))
        except ValueError:
            pass
    
    # 提取模型 UUID
    uuid_match = re.search(r"模型UUID[：:]\s*([a-f0-9\-]+)", text, re.IGNORECASE)
    if uuid_match:
        result["model_uuid"] = uuid_match.group(1)
    
    # 提取请求 ID
    request_match = re.search(r"请求ID[：:]\s*([a-f0-9\-]+)", text, re.IGNORECASE)
    if request_match:
        result["request_id"] = request_match.group(1)
    
    # 如果没有提取到任何性能数据，保存原始文本
    if not any(k in result for k in ["UTS", "YS", "EL", "HV"]):
        result["raw"] = text[:500] if len(text) > 500 else text
        result["parse_error"] = "未能提取性能指标"
        logger.warning(f"ONNX 结果解析失败，原始内容: {text[:200]}...")
    else:
        logger.info(f"ONNX 结果解析成功: UTS={result.get('UTS')}, YS={result.get('YS')}, EL={result.get('EL')}")
    
    return result


def _parse_calphad_result_data(result_data: Dict, calc_type: str) -> Dict[str, Any]:
    """
    解析 Calphad result_data 字段，提取关键信息供前端显示。
    
    根据日志分析，result_data 的格式：
    - Point: {"PhaseName[global]<system>": ["Liquid"], "Temperature": ["1000"], "Gibbs[...]": [...]}
    - Line: {"ChemicalPot[...]": [...], "Temperature": [...], ...}  多个温度点
    - Scheil: {"Label": ["Fcc", "Fcc+Diamond", ...], "Temperature": [...], "FractionSolid": [...]}
    
    参数:
        result_data: Calphad 返回的 result_data 字典
        calc_type: 计算类型 (point/line/scheil)
        
    返回:
        简化的结构化数据，用于前端显示
    """
    parsed = {"raw_keys": list(result_data.keys())[:10]}  # 保留原始键名供调试
    
    # 提取温度数据
    if "Temperature" in result_data:
        temps = result_data["Temperature"]
        if isinstance(temps, list) and len(temps) > 0:
            parsed["temperature"] = [float(t) for t in temps[:5]]  # 只取前5个
            parsed["temp_count"] = len(temps)
            if len(temps) > 1:
                parsed["temp_range"] = [float(temps[0]), float(temps[-1])]
    
    # 根据计算类型提取特定数据
    if calc_type == "point":
        # 点计算：提取平衡相、温度、各相吉布斯能
        
        # 1. 提取平衡相名称
        phase_key = "PhaseName[global]<system>"
        if phase_key in result_data:
            phases = result_data[phase_key]
            if isinstance(phases, list) and len(phases) > 0:
                phase_str = phases[0]
                parsed["equilibrium_phases"] = phase_str
                # 分解为单独相
                parsed["phases"] = [p.strip() for p in phase_str.split("+")]
        
        # 2. 提取计算温度
        if "Temperature" in result_data:
            temps = result_data["Temperature"]
            if isinstance(temps, list) and len(temps) > 0:
                try:
                    parsed["temperature"] = float(temps[0])
                except (ValueError, TypeError):
                    pass
        
        # 3. 提取各相吉布斯能
        gibbs_data = {}
        for key, value in result_data.items():
            if key.startswith("Gibbs[global]<") and isinstance(value, list) and len(value) > 0:
                phase_match = re.search(r'<(\w+)>', key)
                if phase_match:
                    phase = phase_match.group(1)
                    try:
                        gibbs_data[phase] = round(float(value[0]), 2)
                    except (ValueError, TypeError):
                        pass
        if gibbs_data:
            parsed["gibbs_energy"] = gibbs_data
            # 找出最稳定相（吉布斯能最低）
            if gibbs_data:
                stable_phase = min(gibbs_data, key=gibbs_data.get)
                parsed["stable_phase"] = stable_phase
                    
    elif calc_type == "line":
        # 线计算：提取温度范围、相演化、吉布斯能等关键信息
        
        # 1. 提取温度数据
        if "Temperature" in result_data:
            temps = result_data["Temperature"]
            if isinstance(temps, list) and len(temps) > 0:
                try:
                    temp_floats = [float(t) for t in temps if t != ""]
                    if temp_floats:
                        parsed["temp_range"] = [min(temp_floats), max(temp_floats)]
                        parsed["temp_count"] = len(temp_floats)
                        parsed["temperatures"] = temp_floats  # 保存完整温度数组
                except (ValueError, TypeError):
                    pass
        
        # 2. 提取相名称演化 (PhaseName[global]<system>)
        phase_key = "PhaseName[global]<system>"
        if phase_key in result_data:
            phase_names = result_data[phase_key]
            if isinstance(phase_names, list):
                non_empty = [p for p in phase_names if p != ""]
                if non_empty:
                    # 提取唯一相组合
                    unique_phases = []
                    seen = set()
                    for p in non_empty:
                        if p not in seen:
                            seen.add(p)
                            unique_phases.append(p)
                    parsed["phase_evolution"] = unique_phases
                    
                    # 提取涉及的单独相
                    all_phases = set()
                    for p in unique_phases:
                        for single in p.split("+"):
                            all_phases.add(single.strip())
                    parsed["phases"] = list(all_phases)
                    
                    # 分析相变（从相名称变化推断）
                    if len(unique_phases) > 1:
                        parsed["phase_transitions"] = len(unique_phases) - 1
        
        # 3. 从化学势键名提取相信息（备用）
        if "phases" not in parsed:
            phases = set()
            for key in result_data.keys():
                phase_match = re.search(r'@(\w+)>', key)
                if phase_match:
                    phases.add(phase_match.group(1))
            if phases:
                parsed["phases"] = list(phases)
        
        # 4. 提取吉布斯能数据
        gibbs_data = {}
        for key, value in result_data.items():
            if key.startswith("Gibbs[global]<") and isinstance(value, list):
                phase_match = re.search(r'<(\w+)>', key)
                if phase_match:
                    phase = phase_match.group(1)
                    non_empty = [v for v in value if v != ""]
                    if non_empty:
                        try:
                            gibbs_floats = [float(v) for v in non_empty]
                            gibbs_data[phase] = {
                                "min": round(min(gibbs_floats), 1),
                                "max": round(max(gibbs_floats), 1),
                                "points": len(gibbs_floats)
                            }
                        except (ValueError, TypeError):
                            pass
        if gibbs_data:
            parsed["gibbs_energy"] = gibbs_data
        
        # 5. 推断相变温度（从 Fcc/固相 消失点推断液相线温度）
        if "temperatures" in parsed and "Gibbs[global]<Fcc>" in result_data:
            fcc_gibbs = result_data["Gibbs[global]<Fcc>"]
            temps = parsed["temperatures"]
            if isinstance(fcc_gibbs, list) and len(fcc_gibbs) == len(temps):
                # 找到 Fcc 相存在的最高温度（液相线温度近似）
                for i in range(len(fcc_gibbs) - 1, -1, -1):
                    if fcc_gibbs[i] != "":
                        parsed["liquidus_temp"] = round(temps[i], 1)
                        break
            
    elif calc_type == "scheil":
        # Scheil凝固：提取相序列、温度范围、各相分数
        
        # 1. 提取相演化序列 (Label 或 phase_name)
        label_key = "Label" if "Label" in result_data else "phase_name"
        if label_key in result_data:
            labels = result_data[label_key]
            if isinstance(labels, list):
                non_empty = [l for l in labels if l and l != ""]
                # 提取唯一的相组合
                unique_phases = []
                seen = set()
                for label in non_empty:
                    if label not in seen:
                        seen.add(label)
                        unique_phases.append(label)
                parsed["phase_sequence"] = unique_phases[:10]
                parsed["total_steps"] = len(non_empty)
                
                # 提取所有涉及的相
                all_phases = set()
                for p in unique_phases:
                    for single in p.split("+"):
                        all_phases.add(single.strip())
                parsed["phases"] = list(all_phases)
        
        # 2. 从 T 数组提取温度范围（Scheil 使用 T 而不是 Temperature）
        temp_key = "T" if "T" in result_data else "Temperature"
        if temp_key in result_data:
            temps = result_data[temp_key]
            if isinstance(temps, list) and len(temps) > 0:
                try:
                    temp_floats = [float(t) for t in temps if t and t != ""]
                    if temp_floats:
                        # Scheil: 从液相线温度降到共晶/终点温度
                        parsed["liquidus_temp"] = round(max(temp_floats), 1)
                        parsed["solidus_temp"] = round(min(temp_floats), 1)
                        parsed["temp_range"] = [parsed["liquidus_temp"], parsed["solidus_temp"]]
                except (ValueError, TypeError):
                    pass
        
        # 3. 提取各相分数 (f(@*) 格式)
        phase_fractions = {}
        for key, value in result_data.items():
            if key.startswith("f(@") and not key.startswith("f_tot"):
                phase_match = re.search(r'f\(@(\w+)\)', key)
                if phase_match and isinstance(value, list):
                    phase = phase_match.group(1)
                    non_empty = [v for v in value if v and v != ""]
                    if non_empty:
                        try:
                            fractions = [float(v) for v in non_empty]
                            phase_fractions[phase] = {
                                "max": round(max(fractions), 4),
                                "final": round(fractions[-1], 4)
                            }
                        except (ValueError, TypeError):
                            pass
        if phase_fractions:
            parsed["phase_fractions"] = phase_fractions
        
        # 4. 提取总固相分数 (fs)
        if "fs" in result_data:
            fs = result_data["fs"]
            if isinstance(fs, list) and len(fs) > 0:
                try:
                    fs_floats = [float(v) for v in fs if v and v != ""]
                    if fs_floats:
                        parsed["final_solid_fraction"] = round(fs_floats[-1], 4)
                except (ValueError, TypeError):
                    pass
    
    return parsed


def parse_calphad_result(raw_result: Union[str, Dict], calc_type: str = "") -> Dict[str, Any]:
    """
    解析 Calphad MCP 返回的格式化字符串。
    
    输入格式示例:
    "✅ 任务状态查询结果\n\n📋 任务ID: 17291\n📝 标题: Task-Scheil-1764831726\n
     🔩 类型: scheil\n📊 状态: ✅ completed\n👁 用户ID: 40\n
     🎯 计算结果:\n{\"phases\": [...], \"temperature\": [...]}\n\n📃 日志: ..."
    
    参数:
        raw_result: MCP 返回的原始结果（字符串或字典）
        calc_type: 计算类型 (point/line/scheil)
        
    返回:
        结构化的热力学计算结果:
        {
            "task_id": 17291,
            "calc_type": "scheil",
            "status": "completed",
            "data": { ... },        # 实际计算数据
            "error": "...",         # 如果有错误
            "processing_time": ...  # 处理时间
        }
    """
    result = {
        "calc_type": calc_type
    }
    
    # 如果已经是结构化字典，检查并返回
    if isinstance(raw_result, dict):
        # 检查是否有嵌套的 result 字段
        if "result" in raw_result:
            inner = raw_result["result"]
            if isinstance(inner, dict):
                result.update(inner)
                return result
            raw_result = inner
    
    # 转换为字符串进行解析
    text = str(raw_result) if raw_result else ""
    
    if not text:
        return {"error": "空结果", "calc_type": calc_type}
    
    # 提取任务 ID
    task_id_match = re.search(r"任务ID[：:]\s*(\d+)", text)
    if task_id_match:
        result["task_id"] = int(task_id_match.group(1))
    
    # 提取状态
    status_match = re.search(r"状态[：:]\s*[✅❌🔄📊]*\s*(\w+)", text)
    if status_match:
        result["status"] = status_match.group(1).lower()
    
    # 提取计算类型
    type_match = re.search(r"类型[：:]\s*(\w+)", text)
    if type_match:
        result["calc_type"] = type_match.group(1).lower()
    
    # 提取嵌入的 JSON 计算结果
    # 查找 "计算结果:" 后面的 JSON 块（贪婪匹配到最后一个 }）
    json_match = re.search(r"计算结果[：:]\s*\n?\s*(\{.+\})", text, re.DOTALL)
    if json_match:
        try:
            json_str = json_match.group(1)
            data = json.loads(json_str)
            
            # 检查是否包含错误信息
            if isinstance(data, dict):
                if data.get("error"):
                    result["error"] = data["error"]
                    result["status"] = data.get("status", "failed")
                else:
                    # 解析 result_data 字段（Calphad 的实际计算结果）
                    result_data = data.get("result_data", data)
                    parsed_data = _parse_calphad_result_data(result_data, calc_type)
                    result["data"] = parsed_data
                    # 保留原始数据供前端图表使用
                    result["raw_data"] = result_data
                    
        except json.JSONDecodeError as e:
            logger.warning(f"Calphad JSON 解析失败: {e}, 原始: {json_str[:200]}...")
            result["raw_json"] = json_str[:500]
    
    # 如果没有找到 JSON，尝试查找更宽松的模式
    if "data" not in result and "error" not in result:
        # 尝试匹配多行 JSON
        json_block_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text)
        if json_block_match:
            try:
                data = json.loads(json_block_match.group(0))
                if isinstance(data, dict):
                    if data.get("error"):
                        result["error"] = data["error"]
                    else:
                        result["data"] = data
            except json.JSONDecodeError:
                pass
    
    # 提取日志信息
    log_match = re.search(r"日志[：:]\s*(.+?)(?:\n\n|$)", text, re.DOTALL)
    if log_match:
        result["log"] = log_match.group(1).strip()[:200]
    
    # 如果既没有数据也没有错误信息，保存原始文本
    if "data" not in result and "error" not in result:
        result["raw"] = text[:500] if len(text) > 500 else text
        result["parse_warning"] = "未能提取结构化数据"
        logger.warning(f"Calphad 结果解析不完整，类型: {calc_type}")
    else:
        logger.info(f"Calphad 结果解析成功，类型: {calc_type}, 状态: {result.get('status')}")
    
    return result


def parse_idme_result(raw_result: Union[str, Dict]) -> Dict[str, Any]:
    """
    解析 IDME API 返回的结果。
    
    IDME 通常返回标准 JSON，但需要提取关键字段供前端显示。
    
    参数:
        raw_result: IDME API 返回的原始结果
        
    返回:
        结构化的 IDME 查询结果:
        {
            "success": True,
            "count": 9,
            "alloys": [...],        # 合金列表（简化版）
            "data": [...]           # 完整数据
        }
    """
    result = {"success": False}
    
    if isinstance(raw_result, dict):
        # 检查是否成功
        if raw_result.get("resultType") == "SUCCESS":
            result["success"] = True
        elif raw_result.get("error"):
            result["error"] = raw_result["error"]
            return result
        
        # 提取数据
        data = raw_result.get("data", [])
        if isinstance(data, list):
            result["count"] = len(data)
            result["data"] = data
            
            # 提取简化的合金列表（供卡片显示）
            alloys = []
            for item in data[:10]:  # 最多显示10条
                if isinstance(item, dict):
                    # 尝试提取合金成分和关键属性
                    alloy_info = {
                        "name": item.get("Composition_Name", ""),
                        "id": item.get("Composition_ID", ""),
                    }
                    
                    # 提取性能属性
                    for key in ["Property_YS", "Property_UTS", "Property_EL", "Property_HV"]:
                        if key in item and item[key]:
                            prop_name = key.replace("Property_", "")
                            alloy_info[prop_name] = item[key]
                    
                    alloys.append(alloy_info)
            
            result["alloys"] = alloys
            logger.info(f"IDME 结果解析成功，共 {len(data)} 条数据")
        else:
            result["data"] = []
            result["count"] = 0
            
    elif isinstance(raw_result, str):
        # 如果是字符串，尝试解析为 JSON
        try:
            parsed = json.loads(raw_result)
            return parse_idme_result(parsed)
        except json.JSONDecodeError:
            result["error"] = "无法解析 IDME 响应"
            result["raw"] = raw_result[:500] if len(raw_result) > 500 else raw_result
    
    return result


def parse_mcp_result(tool_name: str, raw_result: Any) -> Dict[str, Any]:
    """
    根据工具名称自动选择合适的解析器。
    
    参数:
        tool_name: MCP 工具名称
        raw_result: 原始返回结果
        
    返回:
        解析后的结构化结果
    """
    if "onnx" in tool_name.lower():
        return parse_onnx_result(raw_result)
    elif "calpha" in tool_name.lower():
        # 从工具名推断计算类型
        calc_type = ""
        if "point" in tool_name.lower():
            calc_type = "point"
        elif "line" in tool_name.lower():
            calc_type = "line"
        elif "scheil" in tool_name.lower():
            calc_type = "scheil"
        return parse_calphad_result(raw_result, calc_type)
    elif "idme" in tool_name.lower():
        return parse_idme_result(raw_result)
    else:
        # 未知工具，返回原始结果
        logger.warning(f"未知工具类型: {tool_name}")
        if isinstance(raw_result, dict):
            return raw_result
        return {"raw": str(raw_result)[:500]}
