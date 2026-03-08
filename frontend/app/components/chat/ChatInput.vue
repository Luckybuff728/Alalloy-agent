<template>
  <div class="chat-input-area">
    <div class="input-wrapper" :class="{ 'is-generating': isGenerating }">
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="1"
        :autosize="{ minRows: 1, maxRows: 10 }"
        placeholder="输入消息... (Enter 发送，Shift + Enter 换行)"
        @keydown.enter="handleEnterKey"
        class="chat-input"
      />

      <!-- 生成中：停止按钮 -->
      <button v-if="isGenerating" class="action-btn stop-btn" @click="handleStop" title="停止生成">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <rect x="4" y="4" width="8" height="8" rx="1.5"/>
        </svg>
      </button>

      <!-- 空闲：发送按钮 -->
      <button v-else class="action-btn send-btn" :class="{ active: hasText }" :disabled="!hasText" @click="handleSend" title="发送">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 12V4M4 8l4-4 4 4"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElInput } from 'element-plus'

const props = defineProps({
  isGenerating: { type: Boolean, default: false },
  modelValue:   { type: String,  default: '' },
})

const emit = defineEmits(['update:modelValue', 'send-message', 'stop-generate'])

const inputText = ref(props.modelValue)
const hasText = computed(() => !!inputText.value.trim())

watch(() => props.modelValue, (v) => { inputText.value = v })
watch(inputText, (v) => emit('update:modelValue', v))

const handleEnterKey = (e) => {
  if (e.shiftKey) return
  e.preventDefault()
  if (!props.isGenerating) handleSend()
}

const handleSend = () => {
  const msg = inputText.value.trim()
  if (!msg) return
  emit('send-message', msg)
  inputText.value = ''
}

const handleStop = () => emit('stop-generate')
</script>

<style scoped>
.chat-input-area {
  padding: 0 40px 28px;
  display: flex;
  justify-content: center;
  position: relative;
  z-index: 20;
}

/* ── 外框 ── */
.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  width: 100%;
  max-width: 800px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 20px;
  padding: 10px 12px 10px 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-wrapper:focus-within {
  border-color: var(--primary-light);
  box-shadow: 0 2px 12px rgba(11, 87, 208, 0.1);
}

/* 生成中：边框带极淡红晕 */
.input-wrapper.is-generating {
  border-color: rgba(200, 50, 50, 0.2);
}

/* ── textarea 重置 ── */
.chat-input { flex: 1; }

.chat-input :deep(.el-textarea__inner) {
  resize: none;
  border: none !important;
  padding: 3px 0;
  font-size: 15px;
  line-height: 24px;
  min-height: 24px !important;
  color: var(--text-primary);
  background: transparent !important;
  box-shadow: none !important;
}

.chat-input :deep(.el-textarea__inner::placeholder) {
  color: var(--text-placeholder);
  font-weight: 300;
}

.chat-input :deep(.el-textarea__inner:focus) {
  box-shadow: none !important;
  border: none !important;
}

.chat-input :deep(.el-input__wrapper) {
  box-shadow: none !important;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
}

/* ── 操作按钮共用基础 ── */
.action-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
  margin-bottom: 1px;
}

.action-btn svg {
  width: 14px;
  height: 14px;
}

.action-btn:active { transform: scale(0.92); }

/* ── 发送按钮：空时灰色，有内容时蓝色 ── */
.send-btn {
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
}

.send-btn.active {
  background: var(--primary);
  color: white;
}

.send-btn.active:hover {
  opacity: 0.88;
  transform: scale(1.05);
}

.send-btn:disabled { cursor: default; }

/* ── 停止按钮：深色实心方块图标 ── */
.stop-btn {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.stop-btn:hover {
  background: rgba(200, 50, 50, 0.1);
  color: rgba(180, 40, 40, 0.9);
  transform: scale(1.05);
}
</style>
