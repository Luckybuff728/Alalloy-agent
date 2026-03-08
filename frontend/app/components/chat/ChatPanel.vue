<template>
  <!-- 聊天面板主容器 - 重构后 -->
  <div class="chat-panel">
    <!-- 顶部栏 Removed per user request -->
    <!-- <ChatHeader :current-agent="currentAgent" /> -->
    
    <!-- 消息区域（滚动由 useChatScroll 统一管理） -->
    <div class="chat-messages" ref="messagesContainer">
      <!-- 欢迎界面：当没有消息时，前端独立渲染 -->
      <div v-if="messages.length === 0" class="welcome-state">
        <WelcomeHero @send-example="handleSendExample" />
      </div>
      
      <ChatMessage
        v-for="(msg, index) in messages"
        :key="index"
        :message="msg"
        :is-generating="isAgentTyping && index === messages.length - 1"
        @widget-action="handleWidgetAction"
        @guidance-select="handleGuidanceSelect"
      />
    </div>
    
    <!-- 回到底部浮动按钮 -->
    <transition name="fade-slide">
      <div 
        v-if="showScrollToBottomBtn" 
        class="scroll-to-bottom-btn"
        @click="forceScrollToBottom"
      >
        <el-icon :size="18"><ArrowDown /></el-icon>
        <span v-if="isGenerating">正在生成...</span>
      </div>
    </transition>
    
    <!-- 输入区域 -->
    <ChatInput
      v-model="userInput"
      :is-generating="isGenerating"
      @send-message="sendMessage"
      @stop-generate="stopGenerate"
    />
    
    <!-- 版本号 -->
    <div class="version-hint">v0.1.0</div>
  </div>
</template>

<script setup>
/**
 * ChatPanel.vue - 聊天面板主容器
 * 
 * 重构后职责：
 * - 状态管理（消息列表、滚动状态、展开状态）
 * - 子组件协调
 * - 滚动逻辑
 */
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { ElIcon } from 'element-plus'
import { ChatboxEllipsesOutline, ArrowDown } from '@vicons/ionicons5'

// 子组件
// import ChatHeader from './ChatHeader.vue' // Removed
import ChatMessage from './ChatMessage.vue'
import ChatInput from './ChatInput.vue'
import WelcomeHero from './WelcomeHero.vue'
import { useChatScroll } from '../../composables/useChatScroll'

// Props 定义
const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  currentAgent: {
    type: String,
    default: 'System'
  },
  isAgentTyping: {
    type: Boolean,
    default: false
  },
  isGenerating: {
    type: Boolean,
    default: false
  },
})

const emit = defineEmits(['send-message', 'stop-generate', 'widget-action', 'guidance-select'])

// ==================== 状态管理 ====================

const userInput = ref('')
const messagesContainer = ref(null)

// ==================== 滚动逻辑 (统一由 useChatScroll 管理) ====================
const { 
  isLocked, 
  isNearBottom, 
  scrollToBottom,
  forceScroll 
} = useChatScroll(messagesContainer)

// 显示"回到底部"按钮
const showScrollToBottomBtn = computed(() => !isNearBottom.value)

// 用户点击"回到底部"按钮
const forceScrollToBottom = () => {
  forceScroll()
}


// ==================== 事件处理 ====================

const sendMessage = (message) => {
  emit('send-message', message)
  userInput.value = ''
  forceScrollToBottom()
}

const stopGenerate = () => {
  emit('stop-generate')
}

const handleWidgetAction = (payload) => {
  emit('widget-action', payload)
}

// 处理引导挂件选择（人机协同），向上传递给 useMultiAgent 的 sendResume
const handleGuidanceSelect = (selection) => {
  emit('guidance-select', selection)
}

// 欢迎页示例问题点击：直接作为用户消息发送
const handleSendExample = (example) => {
  sendMessage(example)
}

// 欢迎表单已移除

// Alias for safety against potential cache/template issues
const handleUiAction = handleWidgetAction

// ==================== 监听与生命周期 ====================

// 用户发送消息时，强制滚动到底部
watch(() => props.messages.length, (newLen, oldLen) => {
  if (newLen > oldLen) {
    const lastMsg = props.messages[newLen - 1]
    if (lastMsg && lastMsg.type === 'user') {
      forceScroll()
    }
  }
})

// 开始生成时，如果用户在底部附近，自动锁定
watch(() => props.isGenerating, (val) => {
  if (val && isNearBottom.value) {
    isLocked.value = true
  }
})

// 注：内容高度变化的检测现在由 useChatScroll 的 scrollHeight 轮询处理
// 不再需要单独监听 content/reasoning/widget 的变化
</script>

<style scoped>
/* 主容器 */
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent; /* No card bg */
  border-radius: 0;
  box-shadow: none; /* No shadow */
  overflow: hidden;
}

.chat-panel:hover {
  box-shadow: none;
}

/* 消息区域 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 0; /* Remove horizontal padding from container */
  background: transparent; /* Remove solid background for unified look */
  display: flex;
  flex-direction: column;
  align-items: center; /* Center content */
}

.chat-messages > * {
  width: 100%;
  max-width: 900px; /* Constrain width similar to input */
  padding-left: 20px;
  padding-right: 20px;
  box-sizing: border-box;
}

/* 欢迎界面容器：垂直居中 */
.welcome-state {
  flex: 1;                    /* 占满 chat-messages 剩余高度 */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-bottom: 80px;       /* 向上偏移，光学对齐输入框上方 */
  padding-top: 20px;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

/* 回到底部按钮 */
.scroll-to-bottom-btn {
  position: absolute;
  bottom: 110px;
  right: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 42px;
  min-width: 42px;
  padding: 0 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 21px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--primary);
  z-index: 100;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.scroll-to-bottom-btn:hover {
  background: var(--bg-primary);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
  color: var(--primary-dark);
  border-color: var(--primary-light);
}

.scroll-to-bottom-btn .el-icon {
  font-size: 20px;
}

/* 过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* 版本号 */
.version-hint {
  position: absolute;
  bottom: 4px;
  right: 8px;
  font-size: 10px;
  color: var(--text-quaternary);
  opacity: 0.3;
  user-select: none;
}

</style>
