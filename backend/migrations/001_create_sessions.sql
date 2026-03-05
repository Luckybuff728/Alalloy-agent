-- ============================================================
-- 铝合金 Agent 会话表迁移脚本
-- 版本: 001
-- 日期: 2026-02-24
-- 描述: 创建 sessions 表，用于持久化会话元数据
-- ============================================================

-- 会话表
CREATE TABLE IF NOT EXISTS public.sessions (
    -- 主键：UUID 格式，前端生成或后端生成均可
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 用户关联（可选，DEV_MODE 下可能为空）
    -- 注意：不使用外键约束，因为 DEV_MODE 下可能没有 auth.users
    user_id UUID,
    
    -- 会话元数据
    title TEXT NOT NULL DEFAULT '新的铝合金设计任务',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
    
    -- 扩展元数据（JSON 格式，存储会话参数等）
    metadata JSONB DEFAULT '{}',
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 添加注释
COMMENT ON TABLE public.sessions IS '铝合金 Agent 会话表';
COMMENT ON COLUMN public.sessions.id IS '会话唯一标识（UUID）';
COMMENT ON COLUMN public.sessions.user_id IS '用户 ID（可选，DEV_MODE 下可能为空）';
COMMENT ON COLUMN public.sessions.title IS '会话标题';
COMMENT ON COLUMN public.sessions.status IS '会话状态：active/completed/archived';
COMMENT ON COLUMN public.sessions.metadata IS '扩展元数据（JSON）';

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON public.sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON public.sessions(user_id, status);

-- 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_updated_at ON public.sessions;
CREATE TRIGGER sessions_updated_at
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- RLS 策略（Row Level Security）
-- 注意：使用 Service Key 时会绕过 RLS，这是预期行为
-- 后端使用 Service Key 查询，由 JWT 中的 user_id 过滤
-- ============================================================

-- 启用 RLS（但允许 Service Key 绕过）
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- 允许所有操作（由后端 Service Key 控制访问）
-- 这是因为后端使用 Service Key，而非 anon key
CREATE POLICY "service_role_full_access" ON public.sessions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 如果需要细粒度控制（使用 anon key 时），可启用以下策略：
-- CREATE POLICY "users_select_own" ON public.sessions
--     FOR SELECT USING (auth.uid() = user_id);
-- CREATE POLICY "users_insert_own" ON public.sessions
--     FOR INSERT WITH CHECK (auth.uid() = user_id);
-- CREATE POLICY "users_update_own" ON public.sessions
--     FOR UPDATE USING (auth.uid() = user_id);
-- CREATE POLICY "users_delete_own" ON public.sessions
--     FOR DELETE USING (auth.uid() = user_id);
