<template>
  <el-dialog
    :model-value="visible"
    title="操作确认"
    width="520px"
    :close-on-click-modal="false"
    @close="$emit('cancel')"
  >
    <!-- 提示消息 -->
    <div class="hitl-message">
      <el-icon :size="20" color="var(--warning)"><WarningFilled /></el-icon>
      <div>
        <div class="hitl-title">{{ payload?.display_name || '确认执行' }}</div>
        <div class="hitl-desc">{{ payload?.message || '请确认以下操作参数' }}</div>
      </div>
    </div>

    <!-- 参数组 -->
    <div v-for="(group, gIdx) in (payload?.param_groups || [])" :key="gIdx" class="param-group">
      <div class="group-title">{{ group.title }}</div>
      <div class="group-params">
        <div v-for="param in group.params" :key="param.key" class="param-row">
          <label class="param-label">{{ param.label }}</label>
          <el-input
            v-if="param.editable && group.editable"
            v-model="editableParams[param.key]"
            :type="typeof param.value === 'number' ? 'number' : 'text'"
            size="small"
          />
          <span v-else class="param-value">{{ param.value }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('cancel')">取消</el-button>
      <el-button type="primary" @click="handleConfirm">
        <el-icon><Check /></el-icon>
        确认执行
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { WarningFilled, Check } from '@element-plus/icons-vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  payload: { type: Object, default: null }
})

const emit = defineEmits(['confirm', 'cancel'])

const editableParams = ref({})

watch(() => props.payload, (newPayload) => {
  if (!newPayload) return
  editableParams.value = {}
  for (const group of newPayload.param_groups || []) {
    for (const param of group.params || []) {
      if (param.editable) {
        editableParams.value[param.key] = param.value
      }
    }
  }
}, { immediate: true })

const handleConfirm = () => {
  // ★ 参数验证
  const validated = {}
  for (const group of props.payload?.param_groups || []) {
    for (const param of group.params || []) {
      if (param.editable && param.key in editableParams.value) {
        const value = editableParams.value[param.key]
        // 类型验证
        if (typeof param.value === 'number') {
          validated[param.key] = Number(value) || 0
        } else {
          validated[param.key] = String(value || '')
        }
      }
    }
  }
  emit('confirm', validated)
}
</script>

<style scoped>
.hitl-message {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: var(--spacing-lg);
}
.hitl-title {
  font-size: var(--font-md);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.hitl-desc {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}
.param-group {
  margin-bottom: var(--spacing-md);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.group-title {
  padding: 8px 12px;
  background: var(--bg-secondary);
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
}
.group-params {
  padding: 8px 12px;
}
.param-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.param-label {
  width: 100px;
  flex-shrink: 0;
  font-size: var(--font-sm);
  color: var(--text-tertiary);
}
.param-value {
  font-size: var(--font-sm);
  color: var(--text-primary);
  background: var(--bg-secondary);
  padding: 4px 10px;
  border-radius: 4px;
}
</style>
