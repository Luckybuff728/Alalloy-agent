/**
 * useSessions.js - 会话管理 Composable (单例模式)
 * 
 * 提供全局共享的会话列表状态，确保 Sidebar 和 MultiAgentView 同步。
 * 
 * [v3.0 重构]
 * - 会话 CRUD 统一通过后端 REST API (/api/sessions)
 * - 移除前端直连 Supabase 写入，消除双通道冲突
 * - 移除 Supabase Realtime 订阅，由 WS 事件触发刷新
 */

import { ref, readonly } from 'vue'
import { useAuthStore } from '../stores/auth'
import { ElMessage } from 'element-plus'
import { API_BASE_URL } from '../config'

// 单例状态（模块级别，所有组件共享）
const sessions = ref([])
const loading = ref(false)

export function useSessions() {
    const authStore = useAuthStore()

    /**
     * 构建带认证的请求头
     */
    const getHeaders = () => {
        const headers = { 'Content-Type': 'application/json' }
        if (authStore.token) {
            headers['Authorization'] = `Bearer ${authStore.token}`
        }
        return headers
    }

    /**
     * 获取会话列表
     * 
     * 通过后端 GET /api/sessions 获取，后端使用 Service Key 查询，
     * 由 Token 中的 user_id 确定数据归属。
     */
    const fetchSessions = async (timeRange = 'all', background = false) => {
        if (!authStore.user?.id) return

        if (!background) loading.value = true
        try {
            const url = `${API_BASE_URL}/api/sessions`
            if (!background) console.log('[useSessions] Fetching sessions via REST API')
            
            const resp = await fetch(url, { headers: getHeaders() })
            
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${resp.status}`)
            }
            
            const data = await resp.json()
            if (!background) console.log('[useSessions] Fetched sessions:', data.sessions?.length)
            sessions.value = data.sessions || []

        } catch (error) {
            console.error('Fetch sessions error:', error)
            if (!background) ElMessage.error('无法加载历史会话')
        } finally {
            if (!background) loading.value = false
        }
    }

    /**
     * 创建新会话
     * 
     * 通过后端 POST /api/sessions 创建，后端统一处理 user_id 和 normalize。
     * 
     * 参数:
     *   title - 会话标题，默认 '新对话'
     *   metadata - 可选元数据
     * 
     * 返回:
     *   新创建的会话对象 (含 id)，失败返回 null
     */
    const createSession = async (title = '新对话', metadata = {}) => {
        if (!authStore.user?.id) return null

        try {
            const resp = await fetch(`${API_BASE_URL}/api/sessions`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ title, metadata })
            })
            
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${resp.status}`)
            }
            
            const data = await resp.json()
            
            // 乐观更新：添加到列表头部
            if (data) {
                addSession(data)
            }
            return data

        } catch (error) {
            console.error('Create session error:', error)
            ElMessage.error('创建会话失败')
            return null
        }
    }

    /**
     * 归档会话
     */
    const archiveSession = async (sessionId) => {
        try {
            const resp = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: getHeaders(),
                body: JSON.stringify({ status: 'archived' })
            })
            
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${resp.status}`)
            }

            ElMessage.success('会话已归档')
            await fetchSessions()
        } catch (error) {
            console.error('Archive error:', error)
            ElMessage.error('归档失败')
        }
    }

    /**
     * 重命名会话
     */
    const renameSession = async (sessionId, newTitle) => {
        try {
            const resp = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: getHeaders(),
                body: JSON.stringify({ title: newTitle })
            })
            
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${resp.status}`)
            }

            await fetchSessions()
        } catch (error) {
            console.error('Rename error:', error)
            ElMessage.error('重命名失败')
        }
    }

    /**
     * 删除会话
     */
    const deleteSession = async (sessionId) => {
        try {
            const resp = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: getHeaders()
            })
            
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${resp.status}`)
            }

            ElMessage.success('会话已删除')
            // 本地移除
            sessions.value = sessions.value.filter(s => s.id !== sessionId)
        } catch (error) {
            console.error('Delete error:', error)
            ElMessage.error('删除失败')
        }
    }

    /**
     * 刷新会话列表
     */
    const refreshSessions = () => fetchSessions()

    /**
     * 添加会话到列表头部（乐观更新）
     */
    const addSession = (session) => {
        const exists = sessions.value.some(s => s.id === session.id)
        if (!exists) {
            sessions.value.unshift(session)
        }
    }

    /**
     * 更新本地会话状态 (乐观更新)
     */
    const updateSessionStatus = (sessionId, status) => {
        const session = sessions.value.find(s => s.id === sessionId)
        if (session) {
            session.status = status
            session.updated_at = new Date().toISOString()
            // 重新排序（移动到顶端，因为刚刚更新了）
            sessions.value.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        }
    }

    /**
     * 更新本地会话标题 (乐观更新，供 WS 事件触发)
     */
    const updateSessionTitle = (sessionId, title) => {
        const session = sessions.value.find(s => s.id === sessionId)
        if (session) {
            session.title = title
            session.updated_at = new Date().toISOString()
        }
    }

    /**
     * 通过 REST API 更新会话标题（持久化）
     * 
     * 调用时机：收到后端生成的标题 (session_title_updated 事件)
     * 
     * @param {string} sessionId - 会话 ID
     * @param {string} title - 新标题
     */
    const updateSessionTitleViaAPI = async (sessionId, title) => {
        try {
            const resp = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                headers: getHeaders(),
                body: JSON.stringify({ title })
            })
            
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}))
                throw new Error(errData.detail || `HTTP ${resp.status}`)
            }
            
            // API 调用成功后，更新本地状态
            updateSessionTitle(sessionId, title)
            console.log('[useSessions] 会话标题已更新:', sessionId, title)
            
        } catch (error) {
            console.error('[useSessions] 更新会话标题失败:', error)
            ElMessage.error('更新会话标题失败')
        }
    }

    return {
        sessions: readonly(sessions),
        loading: readonly(loading),
        fetchSessions,
        refreshSessions,
        createSession,
        archiveSession,
        renameSession,
        deleteSession,
        addSession,
        updateSessionStatus,
        updateSessionTitle,
        updateSessionTitleViaAPI
    }
}
