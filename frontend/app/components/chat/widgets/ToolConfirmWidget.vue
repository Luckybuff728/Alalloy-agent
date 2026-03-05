<template>
  <div class="tool-confirm-widget" :class="{ 'is-submitted': submitted }">
    <div class="confirm-header" :class="{ 'is-pending': !submitted }">
      <el-icon :size="16"><WarningOutline /></el-icon>
      <span class="confirm-title">{{ headerText }}</span>
    </div>

    <div class="actions-container">
      <div v-for="(action, ai) in actions" :key="ai" class="action-section">
        <h5 class="section-title" v-if="actions.length > 1">{{ action.name }}</h5>

        <div class="param-grid">
          <template v-for="(val, key) in (action.args || action.arguments || {})" :key="key">
            <!-- dict → 展开子项 -->
            <template v-if="isPlainObject(val)">
              <div v-for="(sv, sk) in val" :key="`${key}.${sk}`" class="param-item">
                <div class="param-label">{{ key }}<span class="sub-key">.{{ sk }}</span></div>
                <div class="param-input-wrapper">
                  <template v-if="!submitted">
                    <el-input-number
                      v-if="typeof sv === 'number'"
                      v-model="editableArgs[ai][`${key}.${sk}`]"
                      :controls="false"
                      :precision="guessPrecision(sv)"
                      size="small"
                      class="auto-input"
                    />
                    <el-input v-else v-model="editableArgs[ai][`${key}.${sk}`]" size="small" class="auto-input" />
                  </template>
                  <span v-else class="value-text">{{ editableArgs[ai][`${key}.${sk}`] }}</span>
                </div>
              </div>
            </template>

            <!-- list → tags（只读） -->
            <div v-else-if="Array.isArray(val)" class="param-item">
              <div class="param-label">{{ key }}</div>
              <div class="tag-group">
                <el-tag v-for="item in val" :key="item" size="small" class="arg-tag">{{ item }}</el-tag>
              </div>
            </div>

            <!-- boolean → switch -->
            <div v-else-if="typeof val === 'boolean'" class="param-item">
              <div class="param-label">{{ key }}</div>
              <el-switch v-model="editableArgs[ai][key]" :disabled="submitted" size="small" />
            </div>

            <!-- number → number input -->
            <div v-else-if="typeof val === 'number'" class="param-item">
              <div class="param-label">{{ key }}</div>
              <div class="param-input-wrapper">
                <el-input-number
                  v-if="!submitted"
                  v-model="editableArgs[ai][key]"
                  :controls="false"
                  :precision="guessPrecision(val)"
                  size="small"
                  class="auto-input"
                />
                <span v-else class="value-text">{{ editableArgs[ai][key] }}</span>
              </div>
            </div>

            <!-- string → text input / readonly for long paths -->
            <div v-else class="param-item" :class="{ 'full-width': isLongString(val) }">
              <div class="param-label">{{ key }}</div>
              <div class="param-input-wrapper">
                <template v-if="!submitted && !isLongString(val)">
                  <el-input v-model="editableArgs[ai][key]" size="small" class="auto-input" />
                </template>
                <span v-else class="value-text mono" :title="String(val)">{{ truncate(String(val), 60) }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div class="confirm-actions" v-if="!submitted">
      <el-button @click="handleCancel" size="default" class="action-btn cancel">取消</el-button>
      <el-button type="primary" @click="handleConfirm" :loading="confirming" size="default" class="action-btn confirm">
        确认执行
      </el-button>
    </div>
    <div class="confirm-result" v-else>
      <div class="status-indicator" :class="confirmed ? 'success' : 'info'">
        <el-icon><component :is="confirmed ? CheckmarkCircleOutline : CloseCircleOutline" /></el-icon>
        <span>{{ confirmed ? '参数已确认，正在执行' : '操作已取消' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import {
  WarningOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline
} from '@vicons/ionicons5'

const props = defineProps({
  payload: { type: Object, required: true, default: () => ({}) },
})

const emit = defineEmits(['confirm', 'cancel'])

const submitted = ref(false)
const confirmed = ref(false)
const confirming = ref(false)

const actions = computed(() => props.payload.action_requests || [])

const headerText = computed(() => {
  if (actions.value.length === 0) return '请确认以下操作'
  const names = actions.value.map(a => a.name).join(', ')
  return actions.value.length === 1
    ? `即将执行 ${names}，请确认参数`
    : `即将执行 ${actions.value.length} 项操作，请确认参数`
})

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isLongString = (v) => typeof v === 'string' && v.length > 40
const truncate = (s, n) => s.length > n ? s.slice(0, n) + '…' : s

const guessPrecision = (num) => {
  if (!Number.isFinite(num)) return 2
  const s = String(num)
  const dot = s.indexOf('.')
  if (dot === -1) return 0
  return Math.min(s.length - dot - 1, 6)
}

const getActionArgs = (action) => action.args || action.arguments || {}

const buildEditableArgs = () =>
  actions.value.map(action => {
    const flat = {}
    for (const [key, val] of Object.entries(getActionArgs(action))) {
      if (isPlainObject(val)) {
        for (const [sk, sv] of Object.entries(val)) {
          flat[`${key}.${sk}`] = sv
        }
      } else if (!Array.isArray(val)) {
        flat[key] = val
      }
    }
    return flat
  })

const editableArgs = reactive(buildEditableArgs())

const reconstructArgs = (actionIdx) => {
  const original = getActionArgs(actions.value[actionIdx] || {})
  const edited = editableArgs[actionIdx] || {}
  const result = {}

  for (const [key, val] of Object.entries(original)) {
    if (isPlainObject(val)) {
      result[key] = {}
      for (const sk of Object.keys(val)) {
        const flatKey = `${key}.${sk}`
        result[key][sk] = flatKey in edited ? edited[flatKey] : val[sk]
      }
    } else if (Array.isArray(val)) {
      result[key] = val
    } else {
      result[key] = key in edited ? edited[key] : val
    }
  }
  return result
}

const handleConfirm = () => {
  confirming.value = true
  confirmed.value = true
  submitted.value = true

  const decisions = actions.value.map((action, i) => {
    const newArgs = reconstructArgs(i)
    const original = getActionArgs(action)
    const changed = JSON.stringify(newArgs) !== JSON.stringify(original)

    if (changed) {
      return { type: 'edit', edited_action: { name: action.name, args: newArgs } }
    }
    return { type: 'approve' }
  })

  emit('confirm', { confirmed: true, decisions })
}

const handleCancel = () => {
  confirmed.value = false
  submitted.value = true
  const decisions = actions.value.map(() => ({ type: 'reject' }))
  emit('cancel', { cancelled: true, decisions })
}
</script>

<style scoped>
/* ── 去除卡片外壳，融入父容器 ── */
.tool-confirm-widget {
  padding: 10px 0 2px;
  background: transparent;
  border: none;
  box-shadow: none;
  transition: opacity 0.2s;
}
.tool-confirm-widget.is-submitted {
  opacity: 1;
}

/* ── Header: 分隔线风格（非盒子） ── */
.confirm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 0 0 8px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.28);
}
.confirm-header.is-pending {
  border-bottom-color: rgba(245, 158, 11, 0.35);
}
.confirm-header .el-icon { color: #f59e0b; }
.confirm-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }

.actions-container { display: flex; flex-direction: column; gap: 12px; }

.action-section { padding: 4px 0; }

.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 0 0 10px 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
}
.section-title::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-light);
  margin-left: 10px;
  opacity: 0.5;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px 20px;
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.param-item.full-width { grid-column: 1 / -1; }

.param-label {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 500;
  word-break: break-all;
}
.sub-key { opacity: 0.7; }

.param-input-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}

.auto-input { width: 100% !important; max-width: 140px; }

.tag-group { display: flex; flex-wrap: wrap; gap: 4px; }
.arg-tag { font-family: var(--font-mono, monospace); }

.value-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.value-text.mono {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Input: 始终显示细边框，hover/focus 高亮 ── */
:deep(.el-input__wrapper) {
  background-color: var(--bg-secondary, #f8fafc) !important;
  box-shadow: none !important;
  border: 1px solid var(--border-light, #e8edf3) !important;
  padding: 0 8px !important;
}
:deep(.el-input__wrapper:hover) {
  background-color: #fff !important;
  border-color: var(--primary-light) !important;
}
:deep(.el-input__wrapper.is-focus) {
  background-color: #fff !important;
  border-color: var(--primary) !important;
  box-shadow: 0 0 0 1px var(--primary-light) !important;
}
:deep(.el-input__inner) {
  height: 28px !important;
  line-height: 28px !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  color: var(--text-primary) !important;
}

/* ── 按钮区域 ── */
.confirm-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light);
  justify-content: flex-end;
}
/* 取消按钮：透明背景，中性边框 */
.action-btn.cancel {
  background: transparent !important;
  border-color: #94a3b8 !important;
  color: var(--text-secondary) !important;
  border-radius: 7px;
  font-weight: 600;
  height: 32px;
  padding: 0 16px;
}
.action-btn.cancel:hover {
  background: rgba(148, 163, 184, 0.08) !important;
  border-color: #64748b !important;
}
.action-btn.confirm {
  border-radius: 7px;
  font-weight: 600;
  height: 32px;
  padding: 0 16px;
  min-width: 90px;
}

.confirm-result { margin-top: 10px; display: flex; justify-content: center; }
.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 6px;
}
.status-indicator.success { color: var(--success); background: rgba(16, 185, 129, 0.05); }
.status-indicator.info { color: var(--text-secondary); background: var(--bg-secondary); }
</style>
