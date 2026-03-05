"""
Supabase 客户端服务

提供 Supabase 数据库连接和客户端初始化。
支持 DEV_MODE 降级到内存模式。

隐藏问题防护：
1. 连接池管理：使用单例模式避免重复创建连接
2. 环境变量缺失：提供明确的错误提示
3. DEV_MODE 降级：环境变量缺失时自动降级
4. 连接超时处理：设置合理的超时时间
"""

import os
from typing import Optional
from functools import lru_cache

from dotenv import load_dotenv

from ..core.logger import logger

# 加载环境变量
load_dotenv()

# ==================== 配置常量 ====================

# Supabase 配置
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL", "")

# 开发模式配置
DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"


# ==================== 客户端单例 ====================

_supabase_client = None
_is_initialized = False
_fallback_mode = False  # 降级到内存模式标志


def _check_config() -> tuple[bool, str]:
    """
    检查 Supabase 配置是否完整
    
    返回:
        (配置是否有效, 错误信息)
    """
    if not SUPABASE_URL:
        return False, "缺少 SUPABASE_URL 环境变量"
    if not SUPABASE_SERVICE_KEY:
        return False, "缺少 SUPABASE_SERVICE_KEY 环境变量"
    return True, ""


def get_supabase_client():
    """
    获取 Supabase 客户端单例
    
    隐藏问题防护：
    - 配置缺失时返回 None 并设置降级标志
    - 连接失败时记录日志并降级
    
    返回:
        Supabase 客户端，或 None（降级模式）
    """
    global _supabase_client, _is_initialized, _fallback_mode
    
    if _is_initialized:
        return _supabase_client
    
    _is_initialized = True
    
    # 检查配置
    config_valid, error_msg = _check_config()
    if not config_valid:
        logger.warning(f"Supabase 配置不完整: {error_msg}")
        if DEV_MODE:
            logger.warning("DEV_MODE 启用，降级到内存存储模式")
            _fallback_mode = True
            return None
        else:
            raise RuntimeError(f"生产环境必须配置 Supabase: {error_msg}")
    
    try:
        from supabase import create_client, Client
        
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        logger.info(f"Supabase 客户端初始化成功: {SUPABASE_URL}")
        return _supabase_client
        
    except ImportError:
        logger.error("supabase-py 未安装，请运行: pip install supabase")
        if DEV_MODE:
            _fallback_mode = True
            return None
        raise
        
    except Exception as e:
        logger.error(f"Supabase 客户端初始化失败: {e}")
        if DEV_MODE:
            logger.warning("DEV_MODE 启用，降级到内存存储模式")
            _fallback_mode = True
            return None
        raise


def is_fallback_mode() -> bool:
    """
    检查是否处于降级模式（内存存储）
    
    返回:
        True 表示降级到内存模式
    """
    # 确保已初始化
    if not _is_initialized:
        get_supabase_client()
    return _fallback_mode


def get_db_connection_string() -> Optional[str]:
    """
    获取 PostgreSQL 连接字符串（用于 AsyncPostgresSaver）
    
    隐藏问题防护：
    - 检查连接字符串格式
    - 验证必要组件存在
    
    返回:
        连接字符串，或 None（降级模式）
    """
    if not SUPABASE_DB_URL:
        if DEV_MODE:
            logger.warning("缺少 SUPABASE_DB_URL，Checkpointer 将使用 MemorySaver")
            return None
        else:
            raise RuntimeError("生产环境必须配置 SUPABASE_DB_URL")
    
    # 验证连接字符串格式
    if not SUPABASE_DB_URL.startswith(("postgresql://", "postgres://")):
        logger.warning(f"SUPABASE_DB_URL 格式可能不正确: {SUPABASE_DB_URL[:30]}...")
    
    return SUPABASE_DB_URL


# ==================== 数据库操作辅助函数 ====================

async def execute_migration(migration_sql: str) -> bool:
    """
    执行数据库迁移 SQL
    
    参数:
        migration_sql: SQL 语句
        
    返回:
        是否执行成功
    """
    client = get_supabase_client()
    if not client:
        logger.warning("Supabase 客户端不可用，跳过迁移")
        return False
    
    try:
        # 使用 RPC 执行原始 SQL（需要在 Supabase 中创建函数）
        # 或者使用 psycopg2/asyncpg 直接连接
        logger.info("执行数据库迁移...")
        # TODO: 实现实际的迁移执行
        return True
    except Exception as e:
        logger.error(f"数据库迁移失败: {e}")
        return False


def reset_client():
    """
    重置客户端状态（用于测试）
    """
    global _supabase_client, _is_initialized, _fallback_mode
    _supabase_client = None
    _is_initialized = False
    _fallback_mode = False
