-- ============================================================
-- LangGraph Checkpoints 表迁移脚本
-- 版本: 002
-- 日期: 2026-02-24
-- 描述: 创建 LangGraph AsyncPostgresSaver 所需的表结构
-- 参考: langgraph.checkpoint.postgres 官方 schema
-- ============================================================

-- ★ 重要：LangGraph 1.x 的 AsyncPostgresSaver.setup() 会自动创建表
-- 但为了确保表结构正确且可预测，我们手动创建
-- 如果 setup() 检测到表已存在，会跳过创建

-- Checkpoints 表：存储图状态快照
CREATE TABLE IF NOT EXISTS public.checkpoints (
    -- 复合主键
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    
    -- 父检查点（用于状态回溯）
    parent_checkpoint_id TEXT,
    
    -- 检查点类型
    type TEXT,
    
    -- 检查点数据（序列化的图状态）
    checkpoint JSONB NOT NULL,
    
    -- 元数据
    metadata JSONB NOT NULL DEFAULT '{}',
    
    -- 主键
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- 添加注释
COMMENT ON TABLE public.checkpoints IS 'LangGraph 检查点表，存储图状态快照';
COMMENT ON COLUMN public.checkpoints.thread_id IS '线程 ID（对应 session_id）';
COMMENT ON COLUMN public.checkpoints.checkpoint_ns IS '检查点命名空间';
COMMENT ON COLUMN public.checkpoints.checkpoint_id IS '检查点 ID';
COMMENT ON COLUMN public.checkpoints.checkpoint IS '序列化的图状态（包含 messages 等）';

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id ON public.checkpoints(thread_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_ns ON public.checkpoints(thread_id, checkpoint_ns);

-- ============================================================
-- Checkpoint Writes 表：存储待写入的检查点（用于事务安全）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

COMMENT ON TABLE public.checkpoint_writes IS 'LangGraph 检查点写入缓冲表';

-- 索引
CREATE INDEX IF NOT EXISTS idx_checkpoint_writes_thread ON public.checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id);

-- ============================================================
-- Checkpoint Blobs 表：存储大型二进制数据（如工具结果）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

COMMENT ON TABLE public.checkpoint_blobs IS 'LangGraph 检查点二进制数据存储';

-- 索引
CREATE INDEX IF NOT EXISTS idx_checkpoint_blobs_thread ON public.checkpoint_blobs(thread_id, checkpoint_ns);

-- ============================================================
-- RLS 策略
-- ============================================================

-- 启用 RLS
ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_blobs ENABLE ROW LEVEL SECURITY;

-- Service Key 完全访问
CREATE POLICY "service_role_checkpoints" ON public.checkpoints
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_checkpoint_writes" ON public.checkpoint_writes
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "service_role_checkpoint_blobs" ON public.checkpoint_blobs
    FOR ALL USING (true) WITH CHECK (true);
