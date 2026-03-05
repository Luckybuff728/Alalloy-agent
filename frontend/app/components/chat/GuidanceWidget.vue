<template>
  <div class="guidance-widget" :class="[widget.type, { 'is-submitted': submitted }]">

    <!-- 头部：标题 + 辅助说明 -->
    <div class="widget-header">
      <span class="widget-title">{{ widget.title }}</span>
      <span v-if="widget.message" class="widget-message">{{ widget.message }}</span>
    </div>

    <!-- ── 选项卡模式 ── -->
    <template v-if="widget.type === 'options'">
      <!-- 待选择 -->
      <div v-if="!submitted" class="widget-options">
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

      <!-- 已选择：结果反馈 -->
      <div v-else class="submit-result">
        <el-icon class="result-icon"><CheckOutline /></el-icon>
        <span class="result-text">已选择：{{ selectedLabel }}</span>
      </div>
    </template>

    <!-- ── 表单模式 ── -->
    <template v-else-if="widget.type === 'form'">
      <!-- 待填写 -->
      <div v-if="!submitted" class="widget-form">
        <div class="field-grid">
          <div
            v-for="field in widget.form_fields"
            :key="field.key"
            class="field-item"
          >
            <!-- 字段标题行：标签 + 当前值 -->
            <div class="field-header">
              <span class="field-label">{{ field.label }}</span>
              <span v-if="field.current_value !== undefined" class="field-current">
                当前: <span class="current-val">{{ field.current_value }}{{ field.unit || '' }}</span>
              </span>
            </div>

            <!-- 数字输入 -->
            <el-input-number
              v-if="field.type === 'number'"
              v-model="formData[field.key]"
              :min="field.min"
              :max="field.max"
              :step="field.step || 1"
              :controls="false"
              class="field-number-input"
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
            <el-input v-else v-model="formData[field.key]" :placeholder="field.placeholder" />

            <span v-if="field.unit && field.type === 'number'" class="field-unit">{{ field.unit }}</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="form-actions">
          <el-button size="small" class="btn-cancel" @click="handleCancel">取消</el-button>
          <el-button type="primary" size="small" class="btn-confirm" @click="handleSubmit">确认</el-button>
        </div>
      </div>

      <!-- 已提交：结果反馈 -->
      <div v-else class="submit-result">
        <el-icon class="result-icon" :class="cancelled ? 'is-cancelled' : ''">
          <component :is="cancelled ? CloseCircleOutline : CheckOutline" />
        </el-icon>
        <span class="result-text">{{ cancelled ? '已取消' : '参数已提交' }}</span>
      </div>
    </template>

  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ArrowRight, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'

// 借用 element-plus 图标（CheckOutline / CloseCircleOutline 用内联 SVG 兜底）
const CheckOutline = CircleCheckFilled
const CloseCircleOutline = CircleCloseFilled

const props = defineProps({
  widget: { type: Object, required: true }
})

const emit = defineEmits(['select'])

const formData    = ref({})
const submitted   = ref(false)
const cancelled   = ref(false)
const selectedLabel = ref('')

// 初始化表单默认值
watch(() => props.widget, (w) => {
  if (w?.type === 'form' && w.form_fields) {
    const data = {}
    for (const field of w.form_fields) {
      data[field.key] = field.default ?? ''
    }
    formData.value = data
  }
  submitted.value = false
  cancelled.value = false
  selectedLabel.value = ''
}, { immediate: true })

// 选项点击
const handleSelect = (opt) => {
  selectedLabel.value = opt.label
  submitted.value = true
  emit('select', {
    type: 'option',
    id: opt.id,
    label: opt.label,
    params: opt.params || {}
  })
}

// 表单提交
const handleSubmit = () => {
  submitted.value = true
  cancelled.value = false
  emit('select', {
    type: 'form',
    data: { ...formData.value }
  })
}

// 取消
const handleCancel = () => {
  submitted.value = true
  cancelled.value = true
  emit('select', { type: 'cancel' })
}
</script>

<style scoped>
/* ── 容器 ── */
.guidance-widget {
  margin-top: 12px;
  padding: 12px 14px;
  background: var(--bg-secondary, #f5f7fa);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-light, #e4e7ed);
  border-left: 3px solid var(--primary-light, #a0c4ff);
  transition: opacity 0.25s, border-color 0.25s;
  max-width: 760px;
  margin-left: 0;
}

.guidance-widget.is-submitted {
  opacity: 0.75;
  border-left-color: var(--border-light, #dcdfe6);
}

/* ── 头部 ── */
.widget-header {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-light, rgba(148, 163, 184, 0.2));
}

.widget-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary, #303133);
}

.widget-message {
  display: block;
  font-size: 12px;
  color: var(--text-secondary, #606266);
  margin-top: 3px;
  line-height: 1.5;
}

/* ── 选项卡 ── */
.widget-options {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.option-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color, #dcdfe6);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s, transform 0.12s;
}

.option-card:hover {
  border-color: var(--primary, #409eff);
  background: var(--primary-lighter, #f0f7ff);
  transform: translateX(2px);
}

.option-card:active {
  transform: scale(0.985);
}

.option-content { flex: 1; }

.option-label {
  font-weight: 500;
  font-size: 13px;
  color: var(--text-primary, #303133);
  line-height: 1.4;
}

.option-desc {
  font-size: 12px;
  color: var(--text-tertiary, #909399);
  margin-top: 2px;
  line-height: 1.3;
}

.option-arrow {
  color: var(--text-tertiary, #b1b3b8);
  font-size: 15px;
  transition: color 0.18s, transform 0.18s;
}

.option-card:hover .option-arrow {
  color: var(--primary, #409eff);
  transform: translateX(2px);
}

/* ── 表单 ── */
.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px 14px;
  margin-bottom: 12px;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  position: relative;
}

/* 字段标题行 */
.field-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--text-tertiary, #909399);
  font-weight: 500;
}

.field-current {
  font-size: 11px;
  color: var(--text-tertiary, #c0c4cc);
  white-space: nowrap;
}

.current-val {
  font-weight: 600;
  color: var(--text-secondary, #606266);
}

.field-unit {
  font-size: 11px;
  color: var(--text-tertiary);
  position: absolute;
  right: 0;
  bottom: 6px;
  pointer-events: none;
}

/* 数字输入框 */
.field-number-input {
  width: 100% !important;
}

:deep(.field-number-input .el-input__wrapper),
:deep(.el-input__wrapper) {
  background-color: var(--bg-primary, #fff) !important;
  box-shadow: none !important;
  border: 1px solid var(--border-light, #dcdfe6) !important;
  border-radius: 6px !important;
  padding: 0 8px !important;
  transition: border-color 0.18s;
}

:deep(.el-input__wrapper:hover),
:deep(.field-number-input .el-input__wrapper:hover) {
  border-color: var(--border-color, #b8c0cc) !important;
}

:deep(.el-input__wrapper.is-focus),
:deep(.field-number-input .el-input__wrapper.is-focus) {
  border-color: var(--primary, #409eff) !important;
  box-shadow: none !important;
}

:deep(.el-input__inner),
:deep(.el-input-number__input) {
  height: 28px !important;
  line-height: 28px !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  color: var(--text-primary) !important;
  text-align: left !important;
}

:deep(.el-form-item) { margin-bottom: 0; }

/* ── 操作按钮 ── */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light, rgba(148, 163, 184, 0.2));
}

.btn-cancel {
  background: transparent !important;
  border-color: var(--border-color, #dcdfe6) !important;
  color: var(--text-secondary) !important;
  border-radius: 6px;
  font-weight: 500;
}

.btn-confirm {
  min-width: 72px;
  border-radius: 6px;
  font-weight: 600;
}

/* ── 结果反馈 ── */
.submit-result {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 13px;
  color: var(--text-secondary, #606266);
}

.result-icon {
  font-size: 15px;
  color: var(--success, #67c23a);
}

.result-icon.is-cancelled {
  color: var(--text-tertiary, #c0c4cc);
}

.result-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
