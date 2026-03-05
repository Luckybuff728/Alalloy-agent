<template>
  <div class="tool-status-widget" :class="{ 'inline-mode': inline }">
    <div v-for="tool in tools" :key="tool.name" class="tool-card" :class="toolBlockClass(tool)">
      
      <!-- 1. Header: 名字与状态 -->
      <div class="tool-header" @click="toggleExpand(tool.name)">
        <div class="header-left">
          <!-- isBuilding: LLM 正在流式构建工具参数 -->
          <span class="status-icon building" v-if="tool.isBuilding">
            <span class="spinner"></span>
          </span>
          <span class="status-icon" v-else-if="tool.isRunning">
            <span class="spinner"></span>
          </span>
          <span class="status-icon error" v-else-if="tool.hasError">
            <el-icon><CircleClose /></el-icon>
          </span>
          <span class="status-icon confirmed" v-else-if="isLocallyConfirmed(tool)">
            <el-icon><Check /></el-icon>
          </span>
          <span class="status-icon paused" v-else-if="tool.isPaused">
            <el-icon><SemiSelect /></el-icon>
          </span>
          <span class="status-icon cancelled" v-else-if="tool.isCancelled || isLocallyCancelled(tool)">
            <el-icon><Close /></el-icon>
          </span>
          <span class="status-icon success" v-else>
            <el-icon><Check /></el-icon>
          </span>
          <span class="tool-name">{{ getToolDisplayName(tool.name) }}</span>
          <span class="expand-icon" v-if="!tool.isRunning && !tool.isBuilding">
            <el-icon v-if="expandedTools[tool.name]"><CaretBottom /></el-icon>
            <el-icon v-else><CaretRight /></el-icon>
          </span>
        </div>
        <span class="time-tag error-tag" v-if="tool.hasError">执行失败</span>
        <span class="time-tag confirmed-tag" v-else-if="isLocallyConfirmed(tool)">已确认 ✓</span>
        <span class="time-tag cancelled-tag" v-else-if="isLocallyCancelled(tool)">已取消</span>
        <span class="time-tag pending-tag" v-else-if="tool.isPaused">
          等待确认
          <span class="pulse-dot"></span>
        </span>
        <span class="time-tag" v-else-if="tool.isCancelled">已取消</span>
        <span class="time-tag building-tag" v-else-if="tool.isBuilding">构建参数中...</span>
        <span class="time-tag" v-else-if="!tool.isRunning">已完成</span>
        <span class="time-tag" v-else>执行中...</span>
      </div>

      <!-- 2. Body: 展开后显示确认卡片或参数详情 -->
      <transition name="fade">
        <div class="tool-body" v-if="!tool.isRunning && expandedTools[tool.name]">
          <!-- 暂停时 + 未本地决策: 嵌入确认卡片 -->
          <ToolConfirmWidget
            v-if="tool.isPaused && tool.interruptPayload && !isLocallyDecided(tool)"
            :payload="tool.interruptPayload"
            @confirm="onToolConfirm(tool, $event)"
            @cancel="onToolCancel(tool, $event)"
          />
          <!-- 本地已决策，等待其他工具 -->
          <div v-else-if="tool.isPaused && isLocallyDecided(tool)" class="decision-indicator">
            <el-tag :type="isLocallyConfirmed(tool) ? 'success' : 'info'" size="small">
              {{ isLocallyConfirmed(tool) ? '✓ 参数已确认' : '已取消' }}
              <template v-if="pausedTools.length > 1">，等待其他工具确认...</template>
            </el-tag>
          </div>
          <!-- 错误信息 -->
          <div class="error-box" v-if="tool.hasError && tool.errorMessage">
            <div class="error-header">
              <el-icon color="#f56c6c"><WarningFilled /></el-icon>
              <span>工具执行失败</span>
            </div>
            <div class="error-message">{{ tool.errorMessage }}</div>
          </div>
          <!-- 非暂停时: 参数/结果 JSON -->
          <div class="json-box" v-if="!tool.isPaused && !tool.hasError">
            <!-- 构建状态: 显示流式 JSON 字符串 -->
            <div class="json-section" v-if="tool.isBuilding && tool.inputJson">
              <div class="json-label">构建参数中 (Arguments):</div>
              <pre class="json-content">{{ tool.inputJson }}</pre>
            </div>
            <!-- 正常状态: 显示解析后的输入 -->
            <div class="json-section" v-else-if="tool.input && Object.keys(tool.input).length > 0">
              <div class="json-label">Arguments (Input):</div>
              <pre class="json-content">{{ formatJson(tool.input) }}</pre>
            </div>
            <div class="json-section" v-if="tool.result">
              <div class="json-label">Result (Output):</div>
              <pre class="json-content">{{ formatJson(tool.result) }}</pre>
            </div>
          </div>
        </div>
      </transition>
      
      <!-- 3. 运行中/构建中状态条 -->
      <div class="tool-progress" v-if="tool.isRunning || tool.isBuilding">
        <div class="progress-bar"></div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { reactive, computed, watch } from 'vue'
import { Check, Close, SemiSelect, CaretBottom, CaretRight, CircleClose, WarningFilled } from '@element-plus/icons-vue'
import ToolConfirmWidget from './ToolConfirmWidget.vue'
import { getToolDisplayName } from '~/config/toolRegistry'

const props = defineProps({
  tools: {
    type: Array,
    required: true,
    default: () => []
  },
  inline: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm-tool', 'cancel-tool'])

const expandedTools = reactive({})
const autoExpandedTools = new Set()
const localDecisions = reactive({})

const pausedTools = computed(() => props.tools.filter(t => t.isPaused))

const isLocallyConfirmed = (tool) => !!localDecisions[tool.name]?.confirmed
const isLocallyCancelled = (tool) => !!localDecisions[tool.name]?.cancelled
const isLocallyDecided = (tool) => !!localDecisions[tool.name]

const toolBlockClass = (tool) => ({
  'is-building': tool.isBuilding,
  'is-running': tool.isRunning,
  'is-error': tool.hasError,
  'is-paused': tool.isPaused && !isLocallyDecided(tool),
  'is-confirmed': isLocallyConfirmed(tool),
  'is-cancelled': tool.isCancelled || isLocallyCancelled(tool),
})

const onToolConfirm = (tool, event) => {
  localDecisions[tool.name] = { confirmed: true, decisions: event.decisions || [] }
  expandedTools[tool.name] = false
  autoExpandedTools.delete(tool.name)
  checkBatchComplete()
}

const onToolCancel = (tool, event) => {
  localDecisions[tool.name] = { cancelled: true, decisions: event.decisions || [] }
  expandedTools[tool.name] = false
  autoExpandedTools.delete(tool.name)
  checkBatchComplete()
}

const checkBatchComplete = () => {
  if (pausedTools.value.length === 0) return
  const allDecided = pausedTools.value.every(t => localDecisions[t.name])
  if (!allDecided) return

  const decisionByTool = {}
  let allCancelled = true
  for (const t of pausedTools.value) {
    const d = localDecisions[t.name]
    decisionByTool[t.name] = d?.decisions?.[0] ?? (d?.cancelled ? { type: 'reject' } : { type: 'approve' })
    if (!d?.cancelled) allCancelled = false
  }

  if (allCancelled) {
    emit('cancel-tool', { cancelled: true, decisionByTool })
  } else {
    emit('confirm-tool', { confirmed: true, decisionByTool })
  }
}

watch(() => props.tools, (tools) => {
  for (const t of tools) {
    if (t.isBuilding && !expandedTools[t.name]) {
      expandedTools[t.name] = true
      autoExpandedTools.add(t.name)
    } else if (t.isPaused && t.interruptPayload && !expandedTools[t.name] && !localDecisions[t.name]) {
      expandedTools[t.name] = true
      autoExpandedTools.add(t.name)
    } else if (!t.isPaused && !t.isBuilding && autoExpandedTools.has(t.name)) {
      expandedTools[t.name] = false
      autoExpandedTools.delete(t.name)
    }
  }
  for (const name in localDecisions) {
    const tool = tools.find(t => t.name === name)
    if (!tool || !tool.isPaused) {
      delete localDecisions[name]
    }
  }
}, { deep: true, immediate: true })

const toggleExpand = (name) => {
  expandedTools[name] = !expandedTools[name]
}

const formatJson = (data) => {
  if (!data) return ''
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data), null, 2)
    } catch {
      return data
    }
  }
  return JSON.stringify(data, null, 2)
}
</script>

<style scoped>
.tool-status-widget {
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.tool-status-widget.inline-mode {
  margin: 0;
}

/* ── 默认：中性灰，极低饱和度 ── */
.tool-card {
  background: rgba(255, 255, 255, 0.02);
  border-left: 2px solid #3f3f46;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  transition: all 0.2s;
}

.tool-card:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* ── 构建中：紫色 ── */
.tool-card.is-building {
  border-color: rgba(139, 92, 246, 0.3);
  background: rgba(139, 92, 246, 0.03);
}

/* ── 执行中：蓝色（沿用默认 spinner 蓝） ── */
.tool-card.is-running {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.02);
}

/* ── 失败：红色 ── */
.tool-card.is-error {
  border-color: rgba(245, 108, 108, 0.35);
  background: rgba(245, 108, 108, 0.02);
}

/* ── 等待确认：橙色 ── */
.tool-card.is-paused {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.02);
}

/* ── 已确认：绿色 ── */
.tool-card.is-confirmed {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.02);
}

/* ── 已取消：淡红 ── */
.tool-card.is-cancelled {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.02);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-name {
  font-weight: 500;
  color: #a1a1aa;
}

.expand-icon {
  font-size: 12px;
  color: #71717a;
  display: flex;
  align-items: center;
}

/* ── 状态图标颜色 ── */
.status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
}
.status-icon.building { color: #8b5cf6; }
.status-icon.success  { color: #10b981; }
.status-icon.paused   { color: #f59e0b; }
.status-icon.cancelled{ color: #ef4444; }
.status-icon.confirmed{ color: #10b981; }
.status-icon.error    { color: #f56c6c; }

/* ── 右侧状态标签 ── */
.time-tag {
  font-size: 11px;
  color: #52525b;
}
.time-tag.building-tag {
  color: #8b5cf6;
  font-style: italic;
}
.time-tag.confirmed-tag {
  color: #10b981;
  font-weight: 500;
}
.time-tag.cancelled-tag {
  color: #ef4444;
}
.time-tag.pending-tag {
  color: #f59e0b;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(245, 158, 11, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}
.time-tag.error-tag {
  color: #f56c6c;
  font-weight: 600;
  background: rgba(245, 108, 108, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}

/* ── 呼吸圆点 ── */
.pulse-dot {
  width: 6px;
  height: 6px;
  background-color: #f59e0b;
  border-radius: 50%;
  position: relative;
}
.pulse-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  background-color: inherit;
  border-radius: 50%;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%   { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(3); opacity: 0; }
}

/* ── 展开区域 ── */
.tool-body {
  margin-top: 8px;
  padding: 0;
  background: transparent;
}

.decision-indicator {
  padding: 8px 0;
  text-align: center;
}

/* ── 错误信息 ── */
.error-box {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(245, 108, 108, 0.04);
  border: 1px solid rgba(245, 108, 108, 0.15);
  border-radius: 4px;
}
.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #f56c6c;
  margin-bottom: 6px;
  font-size: 13px;
}
.error-message {
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
  line-height: 1.6;
}

/* ── JSON 区域 ── */
.json-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.json-label {
  font-size: 11px;
  font-weight: 600;
  color: #a1a1aa;
  text-transform: uppercase;
  margin-bottom: 6px;
  letter-spacing: 0.8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.json-label::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 12px;
  background: #3b82f6;
  border-radius: 1px;
}
.json-content {
  margin: 0;
  padding: 12px;
  background: #0c0c0e;
  color: #ffffff;
  font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  max-height: 300px;
  overflow: auto;
  border-radius: 6px;
  border: 1px solid #3f3f46;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  white-space: pre;
}

/* ── Spinner ── */
.spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(59, 130, 246, 0.2);
  border-left-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── 进度条 ── */
.tool-progress {
  height: 1.5px;
  width: 100%;
  background: rgba(59, 130, 246, 0.1);
  margin-top: 6px;
  overflow: hidden;
  position: relative;
}
.progress-bar {
  position: absolute;
  height: 100%;
  width: 30%;
  background: #3b82f6;
  animation: progress-slide 1.5s infinite ease-in-out;
}
@keyframes progress-slide {
  0%   { left: -30%; }
  100% { left: 100%; }
}

/* ── 展开动画 ── */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
