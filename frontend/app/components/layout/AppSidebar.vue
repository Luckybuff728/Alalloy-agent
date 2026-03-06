<template>
  <div class="app-sidebar" :class="{ collapsed: collapsed }">
    <!-- 顶部：Logo 和 Title -->
    <div class="sidebar-branding">
      <div class="brand-logo">
        <img src="/favicon.ico" alt="Logo" class="logo-image" />
      </div>
      <div class="brand-info">
        <span class="brand-name">Alalloy Agent</span>
        <span class="brand-subtitle">铝合金智能设计系统</span>
      </div>
      <!-- 收起按钮 (DeepSeek style) -->
      <div class="sidebar-toggle-btn" @click="$emit('toggle-collapse')" title="收起侧边栏">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="sidebar-icon">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </div>
    </div>

    <!-- 新对话按钮 -->
    <div class="sidebar-header">
      <div 
        class="new-chat-btn" 
        @click="$emit('new-session')"
        v-loading="loading"
      >
        <el-icon><Plus /></el-icon>
        <span>新对话</span>
      </div>
    </div>


    <!-- 历史列表 -->
    <div class="sidebar-content">
      <div v-if="loading && sessions.length === 0" class="loading-state">
        <el-skeleton :rows="5" animated />
      </div>
      
      <div v-else-if="Object.keys(groupedSessions).length === 0" class="empty-state">
        <el-empty description="暂无历史记录" :image-size="60" />
      </div>

      <template v-else>
        <div 
          v-for="(groupList, groupName) in groupedSessions" 
          :key="groupName" 
          class="session-group"
        >
          <div class="group-title">{{ groupName }}</div>
          
          <div 
            v-for="session in groupList" 
            :key="session.id"
            class="session-item"
            :class="{ active: currentSessionId === session.id }"
            @click="$emit('select-session', session.id)"
          >
            <div class="session-icon">
              <!-- 生成中状态 -->
              <div v-if="currentSessionId === session.id && isAgentTyping" class="typing-indicator">
                <el-icon class="is-loading"><Loading /></el-icon>
              </div>
              
              <!-- 静态状态图标 -->
              <el-tooltip v-else :content="getStatusText(session.status)" placement="right">
                <el-icon v-if="session.status === 'completed'" class="status-icon completed"><Trophy /></el-icon>
                <el-icon v-else-if="session.status === 'archived'" class="status-icon archived"><Lock /></el-icon>
                <el-icon v-else class="status-icon active"><ChatDotRound /></el-icon>
              </el-tooltip>
            </div>
            
            <div class="session-info">
              <div class="session-title-row">
                <span class="session-title" :title="session.title">{{ session.title || '未命名会话' }}</span>
                <span v-if="session.metadata?.current_iteration" class="iteration-badge">
                  R{{ session.metadata.current_iteration }}
                </span>
              </div>
              <div class="session-meta">
                {{ formatTime(session.updated_at) }}
              </div>
            </div>
            
            <!-- 悬浮操作菜单 -->
            <div class="session-actions" @click.stop>
              <el-dropdown trigger="click" @command="(cmd) => handleCommand(cmd, session)">
                <div class="action-btn">
                  <el-icon><MoreFilled /></el-icon>
                </div>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="rename">重命名</el-dropdown-item>
                    <el-dropdown-item command="archive" v-if="session.status !== 'archived'">归档</el-dropdown-item>
                    <el-dropdown-item command="delete" divided class="danger-item">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- 底部：用户 -->
    <div class="sidebar-footer">
      <div class="user-profile">
        <div class="avatar-wrapper">
          <div class="avatar">{{ userInitial }}</div>
          <div class="connection-dot" :class="{ connected: isConnected }" :title="isConnected ? '已连接' : '未连接'"></div>
        </div>
        <div class="user-info-col">
          <div class="username" :title="userName">{{ userName }}</div>
          <div class="user-id" v-if="userId">ID: {{ userId }}</div>
        </div>
      </div>
      <div class="footer-actions">
        <!-- <el-tooltip content="设置" placement="top">
          <el-icon class="footer-icon"><Setting /></el-icon>
        </el-tooltip> -->
        <el-tooltip content="退出登录" placement="top">
          <el-icon class="footer-icon logout" @click="handleLogout"><SwitchButton /></el-icon>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, watch, onMounted, onUnmounted } from 'vue'
// useRouter 由 Nuxt 自动导入，无需显式 import
import { useSessions } from '../../composables/useSessions'
import { useAuthStore } from '../../stores/auth'
import { Plus, ChatDotRound, Trophy, Lock, MoreFilled, Setting, SwitchButton, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  currentSessionId: {
    type: String,
    default: null
  },
  isConnected: {
    type: Boolean,
    default: false
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  isAgentTyping: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['select-session', 'new-session', 'toggle-collapse'])

const { sessions, loading, fetchSessions, archiveSession, renameSession, deleteSession } = useSessions()
const authStore = useAuthStore()
const router = useRouter()

const handleLogout = () => {
  // ★ logout() 内部已将 clearTokens() 提前执行（乐观状态更新）
  // isAuthenticated 立刻变 false，app.vue watcher 会自动触发 /login 路由跳转
  // 因此无需手动 router.push('/login')，由 app.vue 统一管理路由守卫
  authStore.logout()
}

// /api/auth/me 返回 { id, email, username, name, role }
// Supabase 用户: name=full_name, username=email
// FerrisKey 用户: name=姓名, username=preferred_username
const userName = computed(() =>
  authStore.user?.name || authStore.user?.username || authStore.user?.email || 'User'
)
const userId = computed(() => authStore.user?.id)
const userInitial = computed(() => (userName.value || 'U')[0].toUpperCase())

const groupedSessions = computed(() => {
  // 用固定时间点避免 setHours 副作用修改同一对象
  const now = Date.now()
  const todayStart   = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const yesterdayStart = todayStart - 86400000
  const weekStart    = todayStart - 86400000 * 6  // 今天+昨天+5天=近7天

  const groups = { '今天': [], '昨天': [], '近7天': [], '更早': [] }

  for (const session of sessions.value) {
    const t = new Date(session.updated_at).getTime()
    if (t >= todayStart)       groups['今天'].push(session)
    else if (t >= yesterdayStart) groups['昨天'].push(session)
    else if (t >= weekStart)   groups['近7天'].push(session)
    else                       groups['更早'].push(session)
  }

  // 移除空组，保持显示顺序
  for (const key of Object.keys(groups)) {
    if (groups[key].length === 0) delete groups[key]
  }
  return groups
})


// ★ 使用 watch(immediate:true) 统一处理：既覆盖初始加载，也响应登录状态变化
// 不需要额外的 onMounted，避免双重 fetchSessions()
watch(() => authStore.isAuthenticated, (isAuth) => {
  if (isAuth) {
    console.log('[AppSidebar] 认证完成，加载会话列表')
    fetchSessions()
  }
}, { immediate: true })

const getStatusText = (status) => {
  const map = {
    'active': '进行中',
    'completed': '已达标',
    'archived': '已归档'
  }
  return map[status] || status
}

const formatTime = (timeStr) => {
  if (!timeStr) return ''
  const date = new Date(timeStr)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const hhmm = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  if (isToday) return hhmm
  const mm = (date.getMonth() + 1).toString().padStart(2, '0')
  const dd = date.getDate().toString().padStart(2, '0')
  return `${mm}/${dd} ${hhmm}`
}

const handleCommand = async (cmd, session) => {
  if (cmd === 'archive') {
    try {
      await ElMessageBox.confirm('归档后会话仍可查看，但不再显示在默认列表中。', '归档会话', {
        confirmButtonText: '归档',
        cancelButtonText: '取消',
        type: 'info'
      })
      await archiveSession(session.id)
    } catch {
      // 用户取消，忽略
    }
  } else if (cmd === 'rename') {
    ElMessageBox.prompt('请输入新名称', '重命名', {
      inputValue: session.title,
      confirmButtonText: '确定',
      cancelButtonText: '取消'
    }).then(({ value }) => {
      if (value) renameSession(session.id, value)
    }).catch(() => {})
  } else if (cmd === 'delete') {
    ElMessageBox.confirm('确定要删除此会话吗？删除后无法恢复。', '删除会话', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    }).then(async () => {
      await deleteSession(session.id)
      // 如果删除的是当前会话，触发新建会话（这会清理 URL 和状态）
      if (session.id === props.currentSessionId) {
        emit('new-session')
      }
    }).catch(() => {})
  }
}
</script>

<style scoped>
/* ==================== 侧边栏容器 ==================== */
.app-sidebar {
  width: 300px; /* Slight increase for long title */
  height: 100%;
  background: var(--bg-secondary); /* Somewhat darker than main area */
  border-right: none; /* Remove border for cleaner look */
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
  transition: width 0.3s cubic-bezier(0.2, 0, 0, 1), transform 0.3s cubic-bezier(0.2, 0, 0, 1);
  overflow: hidden;
}

.app-sidebar.collapsed {
  width: 0;
  padding: 0;
  border: none;
  transform: translateX(-100%);
}

/* ==================== 品牌区域 (Logo + Title) ==================== */
.sidebar-branding {
  padding: 20px 16px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  /* border-bottom: 1px solid var(--border-light); Remove border */
  position: relative;
}

.sidebar-toggle-btn {
  margin-left: auto;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: all 0.2s;
}

.sidebar-toggle-btn:hover {
  background: var(--bg-tertiary);
  color: var(--primary);
}

.brand-logo {
  width: 24px; /* Reduced from 32px for better sharpness if low-res ico */
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.brand-info {
  display: flex;
  flex-direction: column;
  gap: 0px; /* Tighter gap */
  flex: 1; /* Take remaining space */
  overflow: hidden; /* Prevent spill */
}

.brand-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.3px; /* Tighter tracking */
  line-height: 1.2;
  white-space: nowrap; /* Force single line */
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-subtitle {
  font-size: 13px; /* Increased from 10px */
  color: var(--text-tertiary);
  font-weight: 400;
/* } */
  color: var(--text-tertiary);
  transform: scale(0.95);
  transform-origin: left;
}

.brand-version {
  display: none; /* Hide version to clean up */
}

/* ==================== 头部 (新对话按钮) ==================== */
.sidebar-header {
  padding: 8px 16px 16px;
  flex-shrink: 0;
}

.new-chat-btn {
  background: var(--primary-lighter);
  color: var(--primary-dark);
  border-radius: 16px; /* Pill shape */
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 16px;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
  font-weight: 500;
  font-size: 14px;
  /* box-shadow: var(--shadow-sm); */
}

.new-chat-btn:hover {
  background: var(--primary-light); /* Blue hover */
  box-shadow: var(--shadow-md);
}

.new-chat-btn .el-icon {
  font-size: 20px;
}

/* ==================== 工具导航 ==================== */
.sidebar-nav {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.nav-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.nav-item.active {
  background: var(--primary-lighter);
  color: var(--primary-dark);
}

.nav-item .el-icon {
  font-size: 18px;
}
.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px; /* Reduce padding */
}

.session-group {
  margin-bottom: 16px;
}

.group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 4px;
  padding-left: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 20px; /* Rounded items */
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  height: 36px;
}

.session-item:hover {
  background: var(--bg-tertiary); /* Darker hover */
}

.session-item.active {
  background: var(--primary-lighter);
  color: var(--primary-dark);
  font-weight: 500;
}

.session-icon {
  display: none; /* Remove icon for cleaner text list like ChatGPT/Gemini */
}

/* Only show essential icons if really needed, but generally text is enough for history */

.session-info {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-title {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.session-item.active .session-title {
  color: var(--primary-dark);
}

.iteration-badge {
  display: none; /* Hide for cleaner look */
}

.session-meta {
  display: none; /* Hide time for cleaner look */
}

.session-actions {
  display: none; /* Hide default, show on hover */
  position: absolute;
  right: 8px;
  background: linear-gradient(90deg, transparent, var(--bg-secondary) 20%);
  padding-left: 10px;
}

.session-item:hover .session-actions {
  display: flex;
  background: inherit; /* Match hover bg */
}

.action-btn {
  padding: 4px;
  border-radius: 50%;
  color: var(--text-tertiary);
}

.action-btn:hover {
  background: rgba(0,0,0,0.1);
  color: var(--text-primary);
}

/* ==================== 底部 (用户信息) ==================== */
.sidebar-footer {
  padding: 16px;
  /* border-top: 1px solid var(--border-light); Remove border */
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary); /* Use primary color */
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}

.username {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.footer-actions {
  color: var(--text-tertiary);
  cursor: pointer;
}

.footer-actions:hover {
  color: var(--text-primary);
}

/* ==================== 滚动条 ==================== */
.sidebar-content::-webkit-scrollbar {
  width: 4px;
}
.sidebar-content::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
}
.sidebar-content:hover::-webkit-scrollbar-thumb {
  background: var(--bg-quaternary);
}

/* ==================== 空状态 & 加载态 ==================== */
.loading-state {
  padding: 16px;
}

.empty-state {
  padding: 32px 16px;
  text-align: center;
}

.avatar-wrapper {
  position: relative;
}

.connection-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-tertiary); 
  background: var(--text-tertiary); 
  border: 2px solid var(--bg-secondary);
  transition: background-color 0.3s;
}

.connection-dot.connected {
  background: var(--success); 
}


.footer-icon.logout:hover {
  color: var(--danger);
}

.user-info-col {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.user-id {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: -2px;
}
</style>
