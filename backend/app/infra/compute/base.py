"""
AsyncComputeService — 异步科学计算服务基类

参考 TopMat Agent框架.md 第 2.3 节。
适配 TopMatStudio REST API（/api/tasks 端点）。

子类只需实现:
- _build_description(): 构建 description JSON
- _parse_result(): 解析结果文件

基类提供:
- submit(): 提交任务
- poll(): 轮询状态
- wait_for_completion(): 指数退避等待
- get_result_files(): 获取 S3 签名 URL
- cancel(): 取消任务
"""

import asyncio
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

import httpx

from ...core.logger import logger


# ==================== 数据类型 ====================


class TaskStatus(str, Enum):
    """
    任务状态枚举

    参考 TopMatStudio_API.md 第 3 节任务生命周期:
    pending → queued → running → completed / failed / aborted
    """
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ABORTED = "aborted"

    @property
    def is_terminal(self) -> bool:
        """是否为终态"""
        return self in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.ABORTED)


@dataclass
class TaskResult:
    """
    计算任务结果

    参数:
        task_id: 任务 ID
        status: 最终状态
        result_files: S3 签名 URL 列表
        parsed_data: 解析后的结构化数据
        metadata: 元信息
    """
    task_id: str
    status: TaskStatus
    result_files: List[str] = field(default_factory=list)
    parsed_data: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)


# ==================== 基类 ====================


class AsyncComputeService(ABC):
    """
    异步科学计算服务基类

    适配 TopMatStudio /api/tasks 端点（Bearer Token 认证）。

    参数:
        base_url: API 基础 URL
        token: Bearer Token（JWT）
        timeout: 单次 HTTP 请求超时（秒）
        max_poll_time: 最大轮询等待时间（秒）
        poll_interval: 初始轮询间隔（秒）
        max_poll_interval: 最大轮询间隔（秒）
    """

    def __init__(
        self,
        base_url: str = "https://api.topmaterial-tech.com",
        token: str = "",
        timeout: float = 30.0,
        max_poll_time: float = 300.0,
        poll_interval: float = 3.0,
        max_poll_interval: float = 15.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.max_poll_time = max_poll_time
        self.poll_interval = poll_interval
        self.max_poll_interval = max_poll_interval

    def _get_headers(self) -> Dict[str, str]:
        """
        构建认证请求头

        返回:
            HTTP 请求头字典
        """
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
        }

    async def submit(self, params: Dict[str, Any]) -> int:
        """
        提交计算任务

        参考 TopMatStudio_API.md 第 4.2 节:
        POST /api/tasks → {"title", "description"(JSON字符串), "task_type", "db_key"}

        参数:
            params: 计算参数（由子类 _build_description 定义具体结构）

        返回:
            task_id (int): 任务 ID

        异常:
            httpx.HTTPStatusError: API 返回错误状态码
        """
        description = self._build_description(params)
        task_name = params.get("task_name", "unnamed")

        payload = {
            "title": f"{params.get('task_type', 'calc')}-{task_name}",
            "description": json.dumps(description),  # 必须是 JSON 字符串
            "task_type": "topthermo_next",
            "db_key": "default",
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.base_url}/api/tasks",
                json=payload,
                headers=self._get_headers(),
            )
            resp.raise_for_status()
            data = resp.json()

        task_id = data.get("id")
        if not task_id:
            raise ValueError(f"API 响应中缺少 id: {data}")

        logger.info(f"任务提交成功: id={task_id}, status={data.get('status')}")
        return task_id

    async def poll(self, task_id: int) -> Dict[str, Any]:
        """
        查询任务状态

        参考 TopMatStudio_API.md 第 4.3 节:
        GET /api/tasks/{id}

        参数:
            task_id: 任务 ID

        返回:
            完整的任务状态字典
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/tasks/{task_id}",
                headers=self._get_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def wait_for_completion(
        self,
        task_id: int,
        on_status_change: Optional[Callable] = None,
    ) -> TaskStatus:
        """
        指数退避轮询等待任务完成

        参数:
            task_id: 任务 ID
            on_status_change: 状态变化回调（可用于推送进度）

        返回:
            最终任务状态

        异常:
            TimeoutError: 超过最大轮询时间
        """
        elapsed = 0.0
        interval = self.poll_interval
        last_status = None

        while elapsed < self.max_poll_time:
            task_data = await self.poll(task_id)
            status_str = task_data.get("status", "pending")

            try:
                status = TaskStatus(status_str)
            except ValueError:
                status = TaskStatus.PENDING

            # 状态变化时触发回调
            if status != last_status:
                logger.debug(f"任务 {task_id} 状态变化: {last_status} → {status}")
                if on_status_change:
                    await on_status_change(task_id, status)
                last_status = status

            # 终态则返回
            if status.is_terminal:
                return status

            # 指数退避等待
            await asyncio.sleep(interval)
            elapsed += interval
            interval = min(interval * 1.5, self.max_poll_interval)

        raise TimeoutError(
            f"任务 {task_id} 超时：已等待 {elapsed:.0f}s，最大 {self.max_poll_time:.0f}s"
        )

    async def get_result_files(self, task_id: int) -> Dict[str, Any]:
        """
        获取结果文件的 S3 签名 URL

        参考 TopMatStudio_API.md 第 4.4 节:
        GET /api/tasks/{id}/results

        参数:
            task_id: 任务 ID

        返回:
            {"task_id": "uuid", "files": [...], "total_count": N}
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.base_url}/api/tasks/{task_id}/results",
                headers=self._get_headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def download_result(self, task_id: int) -> Dict[str, Any]:
        """
        下载并解析结果文件

        参考 TopMatStudio_API.md 第 4.5 节:
        从 S3 URL 下载 results.json / table.csv / output.log

        参数:
            task_id: 任务 ID

        返回:
            {"results": dict, "table_csv": str, "output_log": str}
        """
        files_info = await self.get_result_files(task_id)
        s3_task_id = files_info.get("task_id", "")
        parsed = {}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for url in files_info.get("files", []):
                # 从 URL 提取文件名
                try:
                    filename = url.split(f"{s3_task_id}/")[1].split("?")[0]
                except (IndexError, AttributeError):
                    continue

                resp = await client.get(url)
                if resp.status_code != 200:
                    continue

                if filename == "results.json":
                    parsed["results"] = resp.json()
                elif filename == "table.csv":
                    parsed["table_csv"] = resp.text
                elif filename == "output.log":
                    parsed["output_log"] = resp.text

        return parsed

    async def cancel(self, task_id: int) -> bool:
        """
        取消任务

        参考 TopMatStudio_API.md 第 6.5 节:
        PATCH /api/tasks/{id}/stop

        参数:
            task_id: 任务 ID

        返回:
            是否成功取消
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.patch(
                f"{self.base_url}/api/tasks/{task_id}/stop",
                headers=self._get_headers(),
            )
        return resp.status_code == 200

    # ===== 子类必须实现 =====

    @abstractmethod
    def _build_description(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        构建 description JSON（将被 json.dumps 序列化）

        参数:
            params: 业务参数

        返回:
            description 字典
        """
        ...

    @abstractmethod
    def _parse_result(
        self,
        task_id: int,
        result_data: Dict[str, Any],
    ) -> TaskResult:
        """
        解析下载的结果数据

        参数:
            task_id: 任务 ID
            result_data: download_result() 返回的数据

        返回:
            统一的 TaskResult 对象
        """
        ...
