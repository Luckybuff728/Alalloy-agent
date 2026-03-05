"""
Calphad 热力学计算服务

继承 AsyncComputeService，适配 TopMatStudio /api/tasks 端点。
支持 point_calculation / line_calculation / scheil_calculation 三种模式。

参考:
- TopMatStudio_API.md 第 5 节（计算任务参数详解）
- TopMat Agent框架.md 第 2.4 节（具体 Service 示例）
"""

import os
import random
from typing import Any, Dict

from .base import AsyncComputeService, TaskResult, TaskStatus
from ...core.logger import logger

# 铝合金专用 TDB 数据库文件（服务器端路径）
AL_TDB_FILE = "/app/exe/topthermo-next/database/AL-DEFAULT.TDB"


class CalphadService(AsyncComputeService):
    """
    Calphad 热力学计算服务

    用法:
        service = get_calphad_service()
        task_id = await service.submit({
            "task_type": "scheil_calculation",
            "components": ["AL", "SI", "MG"],
            "compositions": {"AL": 0.9, "SI": 0.07, "MG": 0.03},
            "temperature": 1000,
        })
        status = await service.wait_for_completion(task_id)
        result = await service.get_parsed_result(task_id)
    """

    def __init__(self, **kwargs):
        """初始化 Calphad 服务"""
        token = os.getenv("TOPMAT_TOKEN", "")
        base_url = os.getenv(
            "TOPMAT_API_URL", "https://api.topmaterial-tech.com"
        )
        super().__init__(
            base_url=base_url,
            token=token,
            max_poll_time=300.0,  # Calphad 最长等待 5 分钟
            poll_interval=3.0,
            max_poll_interval=10.0,
            **kwargs,
        )

    def _build_description(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        构建 Calphad 计算的 description JSON

        参考 TopMatStudio_API.md 第 5.2-5.4 节。

        参数:
            params: 包含以下字段:
                - task_type: "point_calculation" / "line_calculation" / "scheil_calculation"
                - components: 组元列表，如 ["AL", "SI", "MG"]
                - compositions: 原子分数字典，如 {"AL": 0.9, "SI": 0.07, "MG": 0.03}
                - temperature: 计算温度 (K)（point/scheil）
                - temperature_range: 温度范围 [起, 止]（line）
                - temperature_step: 温度步长 (K)（line）
                - tdb_file: TDB 数据库路径（可选，默认 AL_TDB_FILE）
                - activated_phases: 激活的相列表（可选，默认 [] 表示自动检测）

        返回:
            description 字典
        """
        task_type = params.get("task_type", "scheil_calculation")
        rand_id = random.randint(1000, 9999)
        task_name = f"{task_type}_{rand_id}"

        # 构建 condition
        condition: Dict[str, Any] = {
            "components": params["components"],
            "activated_phases": params.get("activated_phases", []),
            "compositions": params["compositions"],
        }

        # 根据计算类型添加温度参数
        if task_type == "line_calculation":
            condition["temperature_range"] = params.get(
                "temperature_range", [300, 1000]
            )
            condition["temperature_step"] = params.get("temperature_step", 5)
        else:
            # point_calculation / scheil_calculation
            condition["temperature"] = params.get("temperature", 1000)

        description = {
            "task_type": task_type,
            "tdb_file": params.get("tdb_file", AL_TDB_FILE),
            "task_name": task_name,
            # task_path 必须用相对路径（TopMatStudio_API.md 第 5.1 节）
            "task_path": f"examples/framework_demo/result/{task_name}",
            "condition": condition,
        }

        logger.info(
            f"Calphad 任务描述: type={task_type}, "
            f"components={params['components']}"
        )
        return description

    def _parse_result(
        self,
        task_id: int,
        result_data: Dict[str, Any],
    ) -> TaskResult:
        """
        解析 Calphad 计算结果

        参数:
            task_id: 任务 ID
            result_data: download_result() 返回的字典

        返回:
            TaskResult 包含解析后的热力学数据
        """
        results_json = result_data.get("results", {})
        output_log = result_data.get("output_log", "")

        # 检查是否真正计算成功（TopMatStudio_API.md 第 8.3 节）
        is_success = bool(results_json)
        if not is_success and output_log:
            is_success = (
                "任务执行成功" in output_log and "ERROR" not in output_log
            )

        return TaskResult(
            task_id=str(task_id),
            status=TaskStatus.COMPLETED if is_success else TaskStatus.FAILED,
            parsed_data=results_json,
            metadata={
                "has_table_csv": "table_csv" in result_data,
                "output_log_preview": output_log[:500] if output_log else "",
            },
        )

    async def get_parsed_result(self, task_id: int) -> TaskResult:
        """
        获取并解析计算结果（组合 download_result + _parse_result）

        参数:
            task_id: 任务 ID

        返回:
            解析后的 TaskResult
        """
        raw_data = await self.download_result(task_id)
        return self._parse_result(task_id, raw_data)


# ==================== 单例 ====================

_calphad_service = None


def get_calphad_service() -> CalphadService:
    """
    获取 Calphad 服务单例

    返回:
        CalphadService 实例
    """
    global _calphad_service
    if _calphad_service is None:
        _calphad_service = CalphadService()
    return _calphad_service
