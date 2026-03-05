<template>
  <div class="guidance-widget" :class="widget.type">
    <!-- 标题 -->
    <div class="widget-header">
      <span class="widget-title">{{ widget.title }}</span>
      <span v-if="widget.message" class="widget-message">{{ widget.message }}</span>
    </div>

    <!-- 选项卡模式 -->
    <div v-if="widget.type === 'options'" class="widget-options">
      <div 
        v-for="opt in widget.options" 
        :key="opt.id"
        class="option-card"
        @click="handleSelect(opt)"
      >
        <div class="option-content">
          <div class="option-label">{{ opt.label }}</div>
          <div v-if="opt.description" class="option-desc">{{ opt.description }}</div>
        </div>
        <el-icon class="option-arrow"><ArrowRight /></el-icon>
      </div>
    </div>

    <!-- 表单模式 -->
    <div v-else-if="widget.type === 'form'" class="widget-form">
      <el-form :model="formData" label-position="top" size="small">
        <el-form-item 
          v-for="field in widget.form_fields" 
          :key="field.key" 
          :label="field.label"
        >
          <!-- 数字输入 -->
          <el-input-number 
            v-if="field.type === 'number'" 
            v-model="formData[field.key]"
            :min="field.min"
            :max="field.max"
            style="width: 100%"
          />
          <!-- 下拉选择 -->
          <el-select 
            v-else-if="field.type === 'select'" 
            v-model="formData[field.key]"
            style="width: 100%"
          >
            <el-option 
              v-for="opt in field.options" 
              :key="opt" 
              :label="opt" 
              :value="opt" 
            />
          </el-select>
          <!-- 文本输入 -->
          <el-input v-else v-model="formData[field.key]" />
        </el-form-item>
      </el-form>
      <div class="form-actions">
        <el-button type="primary" size="small" @click="handleSubmit">确认</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 引导挂件组件
 * 
 * 用于在对话区显示人机协同引导选项，支持：
 * - options: 选项卡模式，让用户选择下一步
 * - form: 表单模式，让用户调整参数
 * 
 * 用户选择后会触发 select 事件，父组件将其转换为消息发送
 */
import { ref, watch } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'

const props = defineProps({
  widget: { type: Object, required: true }
})

const emit = defineEmits(['select'])

// 表单数据
const formData = ref({})

// 初始化表单默认值
watch(() => props.widget, (w) => {
  if (w?.type === 'form' && w.form_fields) {
    const data = {}
    for (const field of w.form_fields) {
      data[field.key] = field.default ?? ''
    }
    formData.value = data
  }
}, { immediate: true })

// 选项点击
const handleSelect = (opt) => {
  emit('select', {
    type: 'option',
    id: opt.id,
    label: opt.label,
    params: opt.params || {}
  })
}

// 表单提交
const handleSubmit = () => {
  emit('select', {
    type: 'form',
    data: { ...formData.value }
  })
}
</script>

<style scoped>
.guidance-widget {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg-secondary, #f5f7fa);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-light, #e4e7ed);
}

.widget-header {
  margin-bottom: 12px;
}

.widget-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary, #303133);
}

.widget-message {
  display: block;
  font-size: 13px;
  color: var(--text-secondary, #606266);
  margin-top: 4px;
}

/* 选项卡样式 */
.widget-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color, #dcdfe6);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.2s;
}

.option-card:hover {
  border-color: var(--primary, #409eff);
  background: var(--primary-light, #ecf5ff);
}

.option-content {
  flex: 1;
}

.option-label {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary, #303133);
}

.option-desc {
  font-size: 12px;
  color: var(--text-tertiary, #909399);
  margin-top: 2px;
}

.option-arrow {
  color: var(--text-tertiary, #909399);
  font-size: 14px;
}

/* 表单样式 */
.widget-form {
  padding: 4px 0;
}

.widget-form :deep(.el-form-item) {
  margin-bottom: 12px;
}

.widget-form :deep(.el-form-item__label) {
  font-size: 13px;
  color: var(--text-secondary, #606266);
}

.form-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}
</style>
