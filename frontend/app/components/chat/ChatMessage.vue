<template>
  <!-- 单条消息渲染 (V4: ContentBlocks 模式) -->
  <div
    class="message"
    :class="[message.type, { 'streaming': message.isStreaming, 'welcome-mode': isWelcome }]"
  >
    <!-- Agent 消息显示头像 -->
    <div v-if="message.type === 'agent'" class="message-avatar agent">
      <img src="/favicon.ico" alt="Agent" class="avatar-image" />
    </div>
    
    <div class="message-bubble-wrapper">
      <!-- Agent 消息显示时间 -->
      <div class="message-meta" v-if="message.type === 'agent'">
        <span class="message-time">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div class="message-bubble">
        
        <!-- v3: 按时间顺序渲染 ContentBlocks（基于 blockType） -->
        <!-- thinking 块（可折叠）、chat 块（正常）、pending 块（流式）、tool 块按时序排列 -->
        <template v-if="message.contentBlocks && message.contentBlocks.length > 0">
          <div 
            v-for="(block, idx) in message.contentBlocks" 
            :key="idx"
            class="content-block"
            :class="getBlockClass(block)"
          >
            <!-- Thinking 块（已确定的推理内容，可折叠） -->
            <div v-if="block.type === 'text' && block.blockType === 'thinking'" class="thinking-block">
              <div 
                class="thinking-toggle" 
                @click="toggleBlockThinking(idx)" 
                :class="{ 'expanded': isBlockExpanded(idx, block) }"
              >
                <span class="thinking-label">
                  {{ block.duration ? `已思考 ${block.duration} 秒` : '已思考' }}
                </span>
                <span class="thinking-arrow">›</span>
              </div>
              
              <!-- 推理内容：轻量级 Markdown 渲染 -->
              <div class="thinking-content" v-show="isBlockExpanded(idx, block)">
                <div class="thinking-text">
                  <div class="thinking-lite-markdown" v-html="renderLiteMarkdown(block.content)"></div>
                </div>
              </div>
            </div>
            
            <!-- Pending 块（流式输出中）→ 使用推理框样式，但不可折叠 -->
            <div v-else-if="block.type === 'text' && block.blockType === 'pending'" class="thinking-block">
              <div class="thinking-toggle expanded">
                <span class="thinking-label">
                  思考中<span class="animated-dots"><span>.</span><span>.</span><span>.</span></span>
                </span>
                <span class="thinking-arrow">›</span>
              </div>
              
              <!-- 推理内容：流式显示，始终展开 -->
              <div class="thinking-content">
                <div class="thinking-text streaming-fade-in">
                  <div class="thinking-lite-markdown" v-html="renderLiteMarkdown(block.content)"></div>
                </div>
              </div>
            </div>
            
            <!-- Chat 块：blockType='chat'（最终回复，正常显示） -->
            <MarkdownRenderer 
              v-else-if="block.type === 'text' && block.blockType === 'chat'" 
              :content="block.content" 
              :streaming="false" 
            />
            
            <!-- 工具调用块（含 isBuilding 状态，统一由 ToolStatusWidget 渲染） -->
            <div v-else-if="block.type === 'tool'" class="tool-block-wrapper">
              <ToolStatusWidget
                :tools="[block]"
                :inline="true"
                @confirm-tool="handleWidgetAction({ type: 'TOOL_CONFIRM', value: $event })"
                @cancel-tool="handleWidgetAction({ type: 'TOOL_CANCEL', value: $event })"
              />
            </div>
          </div>
        </template>
        
        <!-- 兼容旧格式：如果有 tools 数组但没有 contentBlocks -->
        <template v-else>
          <ToolStatusWidget 
            v-if="visibleTools.length > 0"
            :tools="visibleTools"
            @open-analysis="handleWidgetAction({ type: 'OPEN_ANALYSIS_STATION', resource_id: $event })"
            @confirm-tool="handleWidgetAction({ type: 'TOOL_CONFIRM', value: $event })"
            @cancel-tool="handleWidgetAction({ type: 'TOOL_CANCEL', value: $event })"
          />
          
          <!-- 旧格式的消息文本内容 -->
          <div class="message-content" v-if="message.content">
            <MarkdownRenderer :content="message.content" :streaming="message.isStreaming" />
          </div>
        </template>
        
        <!-- 加载指示器 -->
        <div v-if="showTypingDots" class="typing-dots">
          <span></span><span></span><span></span><span></span>
        </div>
        
        <!-- 引导挂件（人机协同，显示在消息末尾） -->
        <GuidanceWidget 
          v-if="message.widget"
          :widget="message.widget"
          @select="handleGuidanceSelect"
        />
      </div>
      
      <!-- User 消息显示时间 -->
      <div class="message-meta user-meta" v-if="message.type === 'user'">
        <span class="message-time">{{ formatTime(message.timestamp) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * ChatMessage.vue - 单条消息渲染组件 (V3.0)
 * 
 * 职责：
 * 1. 渲染思考过程 (Thinking Block)
 * 2. 挂载通用工具状态挂件 (ToolStatusWidget)
 * 3. 渲染 Markdown 内容
 * 4. 挂载特定交互 Widget
 */
import { computed, ref, watch } from 'vue'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ToolStatusWidget from './widgets/ToolStatusWidget.vue'
import GuidanceWidget from './GuidanceWidget.vue'
import { renderLiteMarkdown } from '../../utils/markdown-lite.js'

// Props 定义
const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  isGenerating: {
    type: Boolean,
    default: false
  }
})

// Emits 定义
const emit = defineEmits(['widget-action', 'guidance-select'])

// ==================== 逻辑计算 ====================

// 所有工具都显示在工具状态列表中
const visibleTools = computed(() => {
  return props.message.tools || []
})

const isWelcome = computed(() => {
  return props.message.widget?.type === 'welcome_setup'
})

// 是否显示打字机动画
const showTypingDots = computed(() => {
  return props.message.type === 'agent' 
    && !props.message.content 
    && (!props.message.tools || props.message.tools.length === 0)
    && !props.message.widget 
    && props.isGenerating
})

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 处理交互事件并向上冒泡
const handleWidgetAction = (payload) => {
  emit('widget-action', { messageId: props.message.id, ...payload })
}

// 处理引导挂件选择（人机协同）
const handleGuidanceSelect = (selection) => {
  emit('guidance-select', selection)
}

// ==================== V5: ContentBlocks 思考块逻辑 ====================

// 每个思考块的展开状态（按索引）
const expandedThinkingBlocks = ref({})

// 切换指定思考块的展开状态
const toggleBlockThinking = (idx) => {
  // 切换状态：如果未设置则收起，否则取反
  const current = expandedThinkingBlocks.value[idx]
  expandedThinkingBlocks.value[idx] = current === undefined ? false : !current
}

// 判断块是否展开（考虑 collapsed 标志和用户手动切换）
const isBlockExpanded = (idx, block) => {
  // 用户手动设置优先
  if (expandedThinkingBlocks.value[idx] !== undefined) {
    return expandedThinkingBlocks.value[idx]
  }
  // 否则读取 block.collapsed 标志（来自 response_ready 信号）
  if (block.collapsed) {
    return false
  }
  // 默认展开
  return true
}

// v3: 根据块类型和 blockType 返回 CSS 类名
const getBlockClass = (block) => {
  if (block.type === 'text') {
    switch (block.blockType) {
      case 'thinking': return 'thinking-block-wrapper'
      case 'pending': return 'pending-block-wrapper'
      case 'chat': return 'chat-block-wrapper'
      default: return 'text-block'
    }
  }
  if (block.type === 'tool') {
    return block.isBuilding ? 'tool-block-building' : 'tool-block'
  }
  return ''
}

// ==================== 旧版思考块逻辑（兼容） ====================
const isThinkingExpanded = ref(true)
const thinkingStartTime = ref(null)
const thinkingDuration = ref(0)

watch(() => props.message.isThinking, (newVal) => {
    if (newVal) {
        thinkingStartTime.value = Date.now()
    } else if (thinkingStartTime.value) {
        thinkingDuration.value = Math.round((Date.now() - thinkingStartTime.value) / 1000)
    }
}, { immediate: true })

const toggleThinking = () => {
    isThinkingExpanded.value = !isThinkingExpanded.value
}
</script>

<style scoped>
/* 消息布局 */
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  animation: messageFadeIn 0.3s ease-out;
}

.message.welcome-mode {
  flex-direction: column;
  padding: 0 4px;
}

.message.welcome-mode .message-avatar {
  display: none;
}

@keyframes messageFadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  justify-content: flex-end;
}

.message-bubble-wrapper {
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.message.user .message-bubble-wrapper {
  align-items: flex-end;
  width: auto;
  max-width: 70%;
}

/* 头像 */
.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 4px;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* 消息元数据 */
.message-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 0 2px;
  margin-bottom: 2px;
}

.message-time {
  color: var(--text-tertiary);
}

/* 消息气泡 */
.message-bubble {
  padding: 0;
  border-radius: 16px;
  line-height: 1.6;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}

.message.agent .message-bubble {
  background: transparent;
  color: var(--text-primary);
  border: none;
  box-shadow: none;
}

.message.user .message-bubble {
  background: var(--primary-lighter);
  color: var(--primary-dark);
  padding: 12px 16px;
  border-top-right-radius: 4px;
}

/* Typing Dots */
.typing-dots {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding-left: 4px;
}

.typing-dots span {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #bbb;
  animation: dotPulse 1.4s infinite ease-in-out both;
}

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.4; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.0); }
}

.message-content {
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.7;
}

/* V4: ContentBlocks 样式 */
.content-block {
  margin-bottom: 4px;
}

.content-block:last-child {
  margin-bottom: 0;
}

.text-block {
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.7;
}

/* 工具调用块的外层容器（内部由 ToolStatusWidget 渲染） */
.tool-block {
  margin: 2px 0;
}

/* v2: 推理块样式（可折叠，类似 DeepSeek/Cursor 风格） */
.reasoning-block {
  margin: 8px 0;
}

.reasoning-block-inline {
  padding-left: 14px;
  border-left: 2px solid var(--border-color, #e4e7ed);
  background: transparent;
}

.reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-tertiary, #909399);
  padding: 2px 0;
  user-select: none;
  width: fit-content;
  transition: color 0.2s;
}

.reasoning-toggle:hover {
  color: var(--text-secondary, #606266);
}

.reasoning-toggle.expanded .reasoning-arrow {
  transform: rotate(90deg);
}

.reasoning-arrow {
  font-size: 12px;
  transition: transform 0.2s;
}

.reasoning-label {
  font-weight: 500;
}

.reasoning-content {
  padding: 8px 0 4px 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-tertiary, #909399);  /* 灰色文字 */
}

/* 推理内容中的 Markdown 元素也用灰色 */
.reasoning-content :deep(p),
.reasoning-content :deep(li),
.reasoning-content :deep(h1),
.reasoning-content :deep(h2),
.reasoning-content :deep(h3),
.reasoning-content :deep(h4) {
  color: var(--text-tertiary, #909399);
}

.reasoning-content :deep(code) {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-tertiary, #909399);
}

/* v3: Thinking 块样式（可折叠，灰色，类似 DeepSeek/Cursor 风格） */
.thinking-block-wrapper {
  margin: 2px 0;
}

.thinking-block {
  margin: 2px 0;
  padding: 6px 12px;
  border-left: 2px solid var(--border-color, #e4e7ed);
  background: transparent;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-tertiary, #909399);
  padding: 2px 0;
  user-select: none;
  width: fit-content;
  transition: color 0.2s;
}

.thinking-toggle:hover {
  color: var(--text-secondary, #606266);
}

.thinking-toggle.expanded .thinking-arrow {
  transform: rotate(90deg);
}

.thinking-arrow {
  font-size: 12px;
  transition: transform 0.2s;
}

.thinking-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  transition: color 0.3s ease;
}

.thinking-icon {
  font-size: 14px;
  color: var(--text-secondary, #606266);
}

/* 图标旋转动画 */
.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.thinking-content {
  padding: 8px 0 4px 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-tertiary, rgb(196, 197, 199));
  transition: opacity 0.3s ease, max-height 0.3s ease;
  overflow: hidden;
}

/* ==================== 渐进式流式渲染优化 ==================== */
/* 流式内容渐进淡入效果（无光标）- 组合优化版本 */
.streaming-fade-in {
  animation: text-fade-in 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

@keyframes text-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 轻量级 Markdown 内联显示，确保内容紧凑 */
.thinking-lite-markdown {
  display: inline;
  margin: 0;
  padding: 0;
  font-size: 13.5px;
  font-style: italic;
  line-height: 1.6;
  color: inherit;
}

/* 将文本包装改为内联，使内容自然流式追加 */
.thinking-text {
  margin: 0;
  padding: 0;
  font-size: 13.5px;
  font-style: italic;
  line-height: 1.6;
  color: var(--text-tertiary, #909399);
  display: block;
  word-wrap: break-word;
  transition: color 0.3s ease, opacity 0.3s ease;
}

/* 渐变式显现动画：当新内容块被添加时有一个平滑的淡入上浮效果 */
@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.thinking-block {
  animation: fade-in-up 0.3s ease-out forwards;
}

/* pending 块到普通内容的丝滑过渡 */
.content-block {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 轻量级 Markdown 行内格式优化 */
.thinking-lite-markdown strong {
  font-weight: 600;
  color: var(--text-secondary, #606266);
  font-style: normal;
}

.thinking-lite-markdown code {
  font-size: 12px;
  padding: 1px 4px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-secondary, #606266);
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Monaco', monospace;
  font-style: normal;
}

/* 段落间距控制 */
.thinking-lite-markdown p {
  display: inline;
}

.thinking-lite-markdown p + p {
  display: block;
  margin-top: 6px;
}

/* 轻量代码块样式：透明底 + 细边框，与推理框调性一致 */
.thinking-lite-markdown :deep(.lite-code) {
  margin: 6px 0;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-left: 2px solid rgba(100, 116, 139, 0.3);
  border-radius: 4px;
  overflow-x: auto;
  font-style: normal;
}

.thinking-lite-markdown :deep(.lite-code)::before {
  content: attr(data-lang);
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 5px;
  font-style: normal;
}

.thinking-lite-markdown :deep(.lite-code[data-lang=""])::before,
.thinking-lite-markdown :deep(.lite-code:not([data-lang]))::before {
  display: none;
}

.thinking-lite-markdown :deep(.lite-code code) {
  background: transparent;
  padding: 0;
  font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-secondary, #606266);
  white-space: pre;
  display: block;
  font-style: normal;
}

/* 轻量表格：滚动容器防溢出 */
.thinking-lite-markdown :deep(.lite-table-wrap) {
  width: 100%;
  overflow-x: auto;
  margin: 6px 0;
  border-radius: 6px;
  border: 1px solid rgba(100, 116, 139, 0.15);
}

.thinking-lite-markdown :deep(.lite-table) {
  border-collapse: collapse;
  width: 100%;
  min-width: 300px;
  font-size: 12.5px;
  font-style: normal;
  line-height: 1.5;
}

.thinking-lite-markdown :deep(.lite-table th),
.thinking-lite-markdown :deep(.lite-table td) {
  padding: 5px 10px;
  border: 1px solid rgba(100, 116, 139, 0.15);
  text-align: left;
  vertical-align: top;
  white-space: normal;      /* 允许换行，防止溢出 */
  word-break: break-word;
  color: var(--text-tertiary, #909399);
}

.thinking-lite-markdown :deep(.lite-table th) {
  background: rgba(100, 116, 139, 0.06);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.02em;
  white-space: nowrap;      /* 表头不换行，保持紧凑 */
}

.thinking-lite-markdown :deep(.lite-table tr:nth-child(even) td) {
  background: rgba(100, 116, 139, 0.03);
}

/* v3: Pending 块样式（流式中，使用推理风格） */
.pending-block-wrapper {
  margin: 8px 0;
}

.pending-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--primary-color, #1a73e8);
  font-weight: 500;
}

/* v3: Chat 块样式（最终回复） */
.chat-block-wrapper {
  /* 最终回复，正常显示 */
}

/* v3: 工具块外层容器 */
.tool-block-wrapper {
  margin: 2px 0;
}

/* 动态省略号：用于 pending 思考状态 */
.animated-dots span {
  display: inline-block;
  animation: dot-blink 1.4s infinite both;
  color: var(--text-tertiary, #909399);
}
.animated-dots span:nth-child(1) { animation-delay: 0s; }
.animated-dots span:nth-child(2) { animation-delay: 0.2s; }
.animated-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-blink {
  0%, 80%, 100% { opacity: 0.2; }
  40%            { opacity: 1; }
}

.dot {
    width: 4px;
    height: 4px;
    background: #dcdfe6;
    border-radius: 50%;
    animation: dotPulse 1.4s infinite ease-in-out both;
}
.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }
</style>
