<template>
  <div class="tool-status-widget" :class="{ 'inline-mode': inline }">

    <!-- 批量错误 + HITL 确认并存提示：让用户明白可以直接确认，AI 会自动修复失败的工具 -->
    <div
      v-if="pausedTools.length > 0 && errorTools.length > 0"
      class="batch-mixed-warning"
    >
      <el-icon color="#e6a23c" style="flex-shrink:0"><WarningFilled /></el-icon>
      <span>
        批次中有 <strong>{{ errorTools.length }}</strong> 个工具执行失败（参数错误）。
        点击"确认执行"后，AI 将自动分析失败原因并重新提交修正参数。
      </span>
    </div>

    <div v-for="tool in tools" :key="toolKey(tool)" class="tool-card" :class="toolBlockClass(tool)">
      
      <!-- 1. Header: 名字与状态 -->
      <div class="tool-header" @click="toggleExpand(toolKey(tool))">
        <div class="header-left">
          <!-- 左侧状态图标：hasError / isCancelled 优先于 isRunning，避免矛盾显示 -->
          <span class="status-icon building" v-if="tool.isBuilding">
            <span class="spinner"></span>
          </span>
          <!-- ★ hasError 在 isRunning 之前：防止出现"蓝色加载圈 + 执行失败"的矛盾状态 -->
          <span class="status-icon error" v-else-if="tool.hasError">
            <el-icon><CircleClose /></el-icon>
          </span>
          <span class="status-icon cancelled" v-else-if="tool.isCancelled || isLocallyCancelled(tool)">
            <el-icon><Close /></el-icon>
          </span>
          <span class="status-icon" v-else-if="tool.isRunning">
            <span class="spinner"></span>
          </span>
          <span class="status-icon confirmed" v-else-if="isLocallyConfirmed(tool)">
            <el-icon><Check /></el-icon>
          </span>
          <span class="status-icon paused" v-else-if="tool.isPaused">
            <el-icon><SemiSelect /></el-icon>
          </span>
          <span class="status-icon success" v-else>
            <el-icon><Check /></el-icon>
          </span>
          <span class="tool-name">{{ getToolDisplayName(tool.name) }}</span>
          <span class="tool-subtitle" v-if="getToolSubtitle(tool)">{{ getToolSubtitle(tool) }}</span>
          <span class="expand-icon" v-if="!tool.isRunning && !tool.isBuilding">
            <el-icon v-if="expandedTools[toolKey(tool)]"><CaretBottom /></el-icon>
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

      <!-- 2a. 建参流式显示：独立于 expandedTools，isBuilding=false 时立即消失 -->
      <transition name="fade">
        <div class="tool-building-body" v-if="tool.isBuilding && tool.inputJson">
          <div class="json-label">构建参数中 (Arguments):</div>
          <pre class="json-content">{{ tool.inputJson }}</pre>
        </div>
      </transition>

      <!-- 2b. 非建参 Body：由 expandedTools 控制（HITL确认 / 参数查看 / 错误详情） -->
      <transition name="fade">
        <div class="tool-body" v-if="!tool.isBuilding && !tool.isRunning && expandedTools[toolKey(tool)]">
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
              <span
                v-if="tool.errorMessage.length > 160"
                class="error-toggle"
                @click.stop="expandedErrors[toolKey(tool)] = !expandedErrors[toolKey(tool)]"
              >{{ expandedErrors[toolKey(tool)] ? '收起' : '查看详情' }}</span>
            </div>
            <div class="error-message">
              {{ expandedErrors[toolKey(tool)] ? tool.errorMessage : truncateErrorMsg(tool.errorMessage) }}
            </div>
          </div>
          <!-- 非暂停时: 参数/结果 JSON -->
          <div class="json-box" v-if="!tool.isPaused && !tool.hasError">
            <div class="json-section" v-if="tool.input && Object.keys(tool.input).length > 0">
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
const localDecisions = reactive({})

const pausedTools = computed(() => props.tools.filter(t => t.isPaused))
const errorTools  = computed(() => props.tools.filter(t => t.hasError))

// 截断过长的错误消息并去掉常见冗余前缀
const truncateErrorMsg = (msg, maxLen = 160) => {
  if (!msg) return ''
  const cleaned = msg
    .replace(/^工具调用失败\s*\([^)]*\):\s*/i, '')
    .replace(/^Tool execution failed:\s*/i, '')
    .replace(/^McpError:\s*/i, '')
    .trim()
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + ' …' : cleaned
}
const expandedErrors = reactive({})

// ★ 修复：使用 tool_call_id（block.id）作为唯一 key，避免同名工具多次调用时 key 碰撞
//   （LLM 可能并行调用两次 calphamesh_submit_scheil_task，name 相同但 id 不同）
const toolKey = (tool) => tool.id || tool.name

const isLocallyConfirmed = (tool) => !!localDecisions[toolKey(tool)]?.confirmed
const isLocallyCancelled = (tool) => !!localDecisions[toolKey(tool)]?.cancelled
const isLocallyDecided = (tool) => !!localDecisions[toolKey(tool)]

const toolBlockClass = (tool) => ({
  'is-building': tool.isBuilding,
  'is-running': tool.isRunning,
  'is-error': tool.hasError,
  'is-paused': tool.isPaused && !isLocallyDecided(tool),
  'is-confirmed': isLocallyConfirmed(tool),
  'is-cancelled': tool.isCancelled || isLocallyCancelled(tool),
})

const onToolConfirm = (tool, event) => {
  localDecisions[toolKey(tool)] = { confirmed: true, decisions: event.decisions || [] }
  expandedTools[toolKey(tool)] = false
  checkBatchComplete()
}

const onToolCancel = (tool, event) => {
  localDecisions[toolKey(tool)] = { cancelled: true, decisions: event.decisions || [] }
  expandedTools[toolKey(tool)] = false
  checkBatchComplete()
}

const checkBatchComplete = () => {
  if (pausedTools.value.length === 0) return
  const allDecided = pausedTools.value.every(t => localDecisions[toolKey(t)])
  if (!allDecided) return

  const decisionByTool = {}  // name → decision（兜底兼容旧后端）
  const decisionById = {}    // toolCallId → { name, decision }（精确追踪，优先使用）
  let allCancelled = true
  for (const t of pausedTools.value) {
    const d = localDecisions[toolKey(t)]
    const decision = d?.decisions?.[0] ?? (d?.cancelled ? { type: 'reject' } : { type: 'approve' })
    decisionByTool[t.name] = decision
    // toolKey(t) = t.id（tool_call_id）|| t.name，优先用 id 精确追踪
    decisionById[toolKey(t)] = { name: t.name, decision }
    if (!d?.cancelled) allCancelled = false
  }

  if (allCancelled) {
    emit('cancel-tool', { cancelled: true, decisionByTool, decisionById })
  } else {
    emit('confirm-tool', { confirmed: true, decisionByTool, decisionById })
  }
}

watch(() => props.tools, (tools) => {
  for (const t of tools) {
    const k = toolKey(t)

    // 建参中：跳过（建参 JSON 已通过独立的 v-if="tool.isBuilding" 显示，无需 expandedTools）
    if (t.isBuilding) continue

    // HITL 等待确认：自动展开确认卡片
    if (t.isPaused && t.interruptPayload && !isLocallyDecided(t) && !expandedTools[k]) {
      expandedTools[k] = true
    }
  }

  // 清理已不再 paused 的 localDecisions
  for (const key in localDecisions) {
    const tool = tools.find(t => toolKey(t) === key)
    if (!tool || !tool.isPaused) {
      delete localDecisions[key]
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

// ── 工具参数摘要（显示在行头，免去展开操作）──────────────────────────────

// 成分对象 → "Al-7.7Si-0.31Mg" 风格
// 兼容：分数形式(0~1) / 百分比形式(0~100)；元素名全大写(AL/SI) → 科学格式(Al/Si)
const _fmtComp = (comp) => {
  if (!comp || typeof comp !== 'object' || Array.isArray(comp)) return null
  const entries = Object.entries(comp)
    .map(([el, v]) => [el, Number(v)])
    .filter(([, v]) => v > 0)
  if (!entries.length) return null

  // 检测是分数(max≤1)还是百分比(max>1)
  const maxVal = Math.max(...entries.map(([, v]) => v))
  const scale = maxVal <= 1.0 ? 100 : 1

  // 元素名规范化：AL→Al, SI→Si, MG→Mg, FE→Fe, MN→Mn
  const capEl = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

  // 换算为 wt% 并过滤微量（< 0.05%）
  const pcts = entries
    .map(([el, v]) => [capEl(el), v * scale])
    .filter(([, pct]) => pct >= 0.05)
    .sort((a, b) => b[1] - a[1])

  if (!pcts.length) return null
  const [[baseEl, basePct], ...rest] = pcts

  const fmtNum = (pct) => {
    if (pct >= 10) return Math.round(pct).toString()
    if (pct >= 1)  return parseFloat(pct.toFixed(1)).toString()
    return parseFloat(pct.toFixed(2)).toString()
  }

  const parts = [
    basePct > 50 ? baseEl : `${fmtNum(basePct)}${baseEl}`,
    ...rest.map(([el, pct]) => `${fmtNum(pct)}${el}`),
  ]
  return parts.join('-')
}

// 元素数组 → "Al-Si-Mg" 系统名（用于二元/三元/line 任务）
const _compSystem = (components) => {
  if (!Array.isArray(components) || !components.length) return null
  return components
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('-')
}

// 温度范围：兼容所有已知字段名变体
const _getTemp = (input) => {
  const s = input.start_temp ?? input.start_temperature ?? input.temperature_start
  const e = input.end_temp   ?? input.end_temperature   ?? input.temperature_end
  const t = input.temperature
  const range = input.temperature_range // [800, 4000]
  if (s != null && e != null) return `${s}~${e} K`
  if (t != null) return `${t} K`
  if (Array.isArray(range) && range.length >= 2) return `${range[0]}~${range[1]} K`
  return null
}

const getToolSubtitle = (tool) => {
  const input = tool.input
  if (!input || typeof input !== 'object') return null
  const name = tool.name

  // ── 温度扫描：固定成分 line scan ──
  // 成分在 composition / compositions_start；温度在 temperature_start/end
  if (name === 'calphamesh_submit_line_task') {
    const comp = _fmtComp(input.composition || input.start_composition || input.compositions_start)
               || _compSystem(input.components)
    const t = _getTemp(input)
    return [comp, t].filter(Boolean).join(' · ') || null
  }

  // ── 含 composition 对象的单点/Scheil/热力学 ──
  if (['calphamesh_submit_scheil_task',
       'calphamesh_submit_point_task',
       'calphamesh_submit_thermodynamic_properties_task'].includes(name)) {
    const comp = _fmtComp(input.composition || input.start_composition || input.compositions_start)
               || _compSystem(input.components)
    const t = _getTemp(input)
    return [comp, t].filter(Boolean).join(' · ') || null
  }

  // ── 二元相图：components: ["AL","SI"] ──
  if (name === 'calphamesh_submit_binary_task') {
    const sys = _compSystem(input.components)
             || [input.component1, input.component2].filter(Boolean).join('-')
    const t = _getTemp(input)
    return [sys, t].filter(Boolean).join(' · ') || null
  }

  // ── 三元截面：components: ["AL","MG","SI"] ──
  if (name === 'calphamesh_submit_ternary_task') {
    const sys = _compSystem(input.components)
             || [input.component1, input.component2, input.component3].filter(Boolean).join('-')
    const t = _getTemp(input)
    return [sys, t].filter(Boolean).join(' · ') || null
  }

  // ── 熔点/沸点：compositions / composition 对象，或 components 数组 ──
  if (name === 'calphamesh_submit_boiling_point_task') {
    // 优先成分对象（区分合金与纯元素）
    const comp = _fmtComp(input.compositions || input.composition)
               || _compSystem(input.components)
    return comp || null
  }

  // ── 获取任务结果/状态 ──
  if (['calphamesh_get_task_result', 'calphamesh_get_task_status'].includes(name)) {
    return input.task_id != null ? `#${input.task_id}` : null
  }

  // ── 知识库 / iDME 查询 ──
  if (['query_idme', 'query_knowledge_base'].includes(name)) {
    const q = input.query || input.text || input.keyword || ''
    return q ? (q.length > 28 ? q.slice(0, 28) + '…' : q) : null
  }

  // ── ONNX / ML 预测 ──
  if (['onnx_model_inference', 'predict_ml_performance_tool', 'predict_onnx_performance'].includes(name)) {
    return _fmtComp(input.composition || input.alloy_composition)
  }

  // ── 成分校验/归一化 ──
  if (['validate_composition_tool', 'normalize_composition_tool'].includes(name)) {
    return _fmtComp(input.composition)
  }

  return null
}
</script>

<style scoped>
/* ── 批量错误 + HITL 并存提示横幅 ─────────────────── */
.batch-mixed-warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 6px;
  font-size: 12px;
  color: #906000;
  line-height: 1.5;
}

/* ── 错误展开/收起 ────────────────────────────────── */
.error-toggle {
  margin-left: auto;
  font-size: 11px;
  color: #909399;
  cursor: pointer;
  text-decoration: underline;
  flex-shrink: 0;
}
.error-toggle:hover {
  color: #f56c6c;
}

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
  min-width: 0;
  flex: 1;
}

.tool-name {
  font-weight: 500;
  color: #a1a1aa;
}

/* ── 参数摘要：工具名后面的小字，快速区分同类工具 ── */
.tool-subtitle {
  font-size: 11px;
  color: #52525b;
  font-weight: 400;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  padding: 1px 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 3px;
  line-height: 1.4;
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

/* ── 建参流式区域（独立，isBuilding=false 时自动消失）── */
.tool-building-body {
  margin-top: 6px;
  padding: 0;
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
