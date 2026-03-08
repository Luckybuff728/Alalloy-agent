<template>
  <div class="multi-agent-view" @mousemove="handleMouseMove" @mouseup="stopResize" @mouseleave="stopResize">
    <!-- 主工作区 -->
    <div class="workspace" :class="{ 'embedded-mode': isEmbedded }">
      <!-- 侧边栏 -->
      <AppSidebar 
        v-if="!isEmbedded && !isMobile"
        :current-session-id="sessionId"
        :is-connected="isConnected"
        :collapsed="isSidebarCollapsed"
        :is-agent-typing="isAgentTyping"
        @select-session="handleSessionSelect"
        @new-session="handleNewSession"
        @toggle-collapse="toggleSidebar"
      />

      <!-- 侧边栏展开/收起浮动按钮 -->
      <div v-if="isSidebarCollapsed && !isEmbedded" class="sidebar-floating-toggle">
        <div class="toggle-pill">
          <div class="toggle-btn" @click="toggleSidebar" title="展开侧边栏">
             <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" class="sidebar-icon">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
             </svg>
          </div>
          <div class="divider"></div>
          <div class="toggle-btn" @click="handleNewSession" title="新对话">
             <el-icon><Plus /></el-icon>
          </div>
        </div>
      </div>
      
      <!-- 中间：主内容区 -->
      <div class="center-panel">
        <ChatPanel
          :messages="messages"
          :current-agent="currentAgent"
          :is-agent-typing="isAgentTyping"
          :is-generating="isAgentTyping"
          @send-message="handleSendMessage"
          @stop-generate="handleStopGenerate"
          @widget-action="handleWidgetAction"
          @guidance-select="handleGuidanceSelect"
        />
      </div>
      
      <!-- 右侧调整手柄 -->
      <div class="resize-handle right" @mousedown.prevent="startResizeRight">
        <div class="handle-line"></div>
      </div>
      
      <!-- 右侧：结果展示 -->
      <div class="right-panel" :style="{ width: `${rightPanelWidth}px` }">
        <ResultsPanel 
          :results="results"
          @clear="handleClearResults"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { useMultiAgent } from '../composables/useMultiAgent'
import AppSidebar from '../components/layout/AppSidebar.vue'
import { useSessions } from '../composables/useSessions'
import { CONFIG } from '../config'


const authStore = useAuthStore()
const { fetchSessions } = useSessions()
const route = useRoute()
const router = useRouter()

const isEmbedded = computed(() => route?.query?.embedded === 'true')
const isMobile = ref(false)
const isTablet = ref(false)
const isSidebarCollapsed = ref(false)

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}

const rightPanelWidth = ref(600)
const isResizingRight = ref(false)

const startResizeRight = () => {
  isResizingRight.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

const stopResize = () => {
  if (isResizingRight.value) {
    isResizingRight.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
}

const handleWindowResize = () => {
  if (process.client) {
    const width = window.innerWidth
    isMobile.value = width < 768
    isTablet.value = width >= 768 && width < 992
  }
}

const handleMouseMove = (e) => {
  if (isResizingRight.value) {
    const newWidth = window.innerWidth - e.clientX - 16
    if (newWidth >= 350 && newWidth <= 800) {
      rightPanelWidth.value = newWidth
    }
  }
}

const {
  connect,
  createAndConnect,
  disconnect,
  reconnect,
  isConnected,
  sessionId,
  currentAgent,
  isAgentTyping,
  activeTool,
  messages,
  results,
  sendMessage,
  sendResume,
  clearSession: clearResults,
  stopGenerate,
  connectionState,
  reconnectAttempts,
  shouldReconnect
} = useMultiAgent()

// 追踪待发送 watcher，切换会话时可主动取消
let _pendingSendUnwatch = null
let _pendingSendTimer = null

const _clearPendingSend = () => {
  if (_pendingSendUnwatch) { _pendingSendUnwatch(); _pendingSendUnwatch = null }
  if (_pendingSendTimer) { clearTimeout(_pendingSendTimer); _pendingSendTimer = null }
}

const handleSendMessage = async (message) => {
  if (!isConnected.value) {
    // 取消上一个未完成的等待（防止消息发到错误会话）
    _clearPendingSend()

    const session = await createAndConnect(authStore.token)
    if (!session) return  // createAndConnect 已弹错误提示

    // 等待连接就绪后发送，10s 超时防止永久挂起
    _pendingSendUnwatch = watch(
      () => isConnected.value && sessionId.value,
      (ready) => {
        if (!ready) return
        _clearPendingSend()
        sendMessage(message)
      }
    )
    _pendingSendTimer = setTimeout(() => {
      _clearPendingSend()
      ElMessage.warning('连接超时，请重试')
    }, 10000)
  } else {
    sendMessage(message)
  }
}

const handleStopGenerate = () => {
  stopGenerate()
}

const handleClearResults = () => {
  results.value = []
}

const handleOptimizationSelect = (option) => {
  sendMessage(`我选择 ${option} 优化方案，请帮我生成实验工单`)
  ElMessage.success(`已选择 ${option}`)
  results.value = results.value.filter(r => r.type !== 'optimization')
}

// 处理引导挂件选择（人机协同），使用 sendResume 恢复图执行
const handleGuidanceSelect = (selection) => {
  console.log('[index.vue] 引导挂件选择:', selection)
  
  // 清除消息中的 widget（用户已选择）
  const lastAgentMsg = messages.value.findLast(m => m.type === 'agent' && m.widget)
  if (lastAgentMsg) {
    lastAgentMsg.widget = null
  }
  
  // 使用 sendResume 恢复图执行，传递用户选择
  sendResume(selection)
}

const handleWidgetAction = (payload) => {
  const { type, value, label } = payload
  switch (type) {
    case 'EXPERIMENT_DATA_ENTRY':
      const parts = []
      if (value.tensile_strength != null) parts.push(`抗拉强度: ${value.tensile_strength} MPa`)
      if (value.yield_strength != null) parts.push(`屈服强度: ${value.yield_strength} MPa`)
      if (value.elongation != null) parts.push(`延伸率: ${value.elongation} %`)
      if (value.hardness != null) parts.push(`硬度: ${value.hardness} HV`)
      if (value.notes) parts.push(`备注: ${value.notes}`)
      sendMessage(parts.length > 0 ? `实验数据已完成，测试结果如下：\n${parts.join('\n')}` : '实验数据已提交')
      break
    case 'USER_CHOICE':
      if (value === 'confirm_termination') sendMessage('任务已确认结束')
      else if (value === 'continue_optimization') sendMessage('继续优化')
      else if (label) sendMessage(String(label))
      break
    case 'TOOL_CONFIRM':
      // 用户确认工具参数 → 通过 resume 恢复 interrupt
      sendResume(value)
      break
    case 'TOOL_CANCEL':
      // 用户取消工具执行 → 通过 resume 发送取消指令
      sendResume(value)
      break
    default:
      if (label || value) sendMessage(String(label || value))
  }
}

const handleSessionSelect = (id) => {
  if (sessionId && id === sessionId.value) return
  router.replace({ query: { ...route.query, session_id: id } })
  if (isConnected.value) disconnect()
  connect(authStore.token, id)
}

const handleNewSession = () => {
    // 取消任何待发送的消息 watcher，防止发到新会话
    _clearPendingSend()
    router.replace({ query: { ...route.query, session_id: undefined } })
    if (isConnected.value) disconnect()
    sessionId.value = null
    if (messages) messages.value = []
    if (clearResults) clearResults()
    currentAgent.value = 'System'
}

onMounted(() => {
  const querySessionId = route.query.session_id || route.params.id
  if (authStore.isAuthenticated && !isConnected.value) {
    if (querySessionId && querySessionId !== 'new') {
      connect(authStore.token, querySessionId)
    } else {
      clearResults()
    }
  }
  window.addEventListener('mouseup', stopResize)
  window.addEventListener('resize', handleWindowResize)
  handleWindowResize()
})

onUnmounted(() => {
  _clearPendingSend()
  disconnect()
  window.removeEventListener('mouseup', stopResize)
  window.removeEventListener('resize', handleWindowResize)
})

watch(sessionId, (newId) => {
  if (newId && route.query.session_id !== newId) {
     router.replace({ query: { ...route.query, session_id: newId } })
  }
})

let isConnecting = false
watch(() => authStore.isAuthenticated, (authed) => {
  if (authed && !isConnected.value && !isConnecting) {
    const querySessionId = route.query.session_id || route.params.id
    if (querySessionId && querySessionId !== 'new') {
      isConnecting = true
      connect(authStore.token, querySessionId)
      setTimeout(() => { isConnecting = false }, 1000)
    }
  } else if (!authed && isConnected.value) {
    disconnect()
    isConnecting = false
  }
}, { immediate: true })

// 样式提取 (保持与原 MultiAgentView 一致)
</script>

<style scoped>
.multi-agent-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}
.workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: var(--bg-primary, #fff);
}
.center-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.right-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.resize-handle {
  width: 1px;
  background: var(--border-color, #e5e7eb);
  cursor: col-resize;
  z-index: 10;
}
.handle-line {
  width: 4px;
  height: 24px;
  background: #9ca3af;
  opacity: 0.3;
  margin: auto;
  border-radius: 2px;
}
.sidebar-floating-toggle {
  position: fixed;
  left: 20px;
  top: 20px;
  z-index: 200;
}
.toggle-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  padding: 6px;
  border-radius: 24px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  border: 1px solid #e5e7eb;
}
.toggle-btn {
  padding: 8px;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  transition: background 0.2s;
}
.toggle-btn:hover {
  background: #f3f4f6;
}
.divider {
  width: 1px;
  height: 20px;
  background: #e5e7eb;
}

/* 仿真工作台抽屉样式优化 */
:deep(.simulation-drawer) .el-drawer__body {
  padding: 0;
  overflow: hidden;
}

/* 抽屉打开时的遮罩层优化 */
:deep(.el-overlay) {
  backdrop-filter: blur(2px);
}

</style>
