<template>
  <div class="welcome-hero">

    <!-- 标题区 -->
    <div class="hero-header stagger-0">
      <div class="hero-logo-wrapper">
        <!-- 原子轨道图标，契合材料科学主题 -->
        <svg class="hero-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle class="atom-nucleus" cx="12" cy="12" r="2" fill="currentColor"/>
          <ellipse class="atom-orbit orbit-1" cx="12" cy="12" rx="9" ry="3.8"
            stroke="currentColor" stroke-width="1.4"/>
          <ellipse class="atom-orbit orbit-2" cx="12" cy="12" rx="9" ry="3.8"
            stroke="currentColor" stroke-width="1.4"
            style="transform: rotate(60deg); transform-origin: 12px 12px;"/>
          <ellipse class="atom-orbit orbit-3" cx="12" cy="12" rx="9" ry="3.8"
            stroke="currentColor" stroke-width="1.4"
            style="transform: rotate(120deg); transform-origin: 12px 12px;"/>
        </svg>
      </div>
      <div class="hero-text">
        <h1 class="hero-title">
          <span class="brand-name">Alalloy</span>
          <span class="text-gradient">铝合金智能设计专家</span>
        </h1>
        <p class="hero-tagline">
          <span class="tag-item">成分设计</span>
          <span class="tag-dot">·</span>
          <span class="tag-item">热力学计算</span>
          <span class="tag-dot">·</span>
          <span class="tag-item">性能预测</span>
          <span class="tag-dot">·</span>
          <span class="tag-item">知识检索</span>
        </p>
      </div>
    </div>

    <!-- 能力卡片网格：图标 + 名称 + 描述，可见内容更丰富 -->
    <div class="cap-grid stagger-1">
      <div
        v-for="(cap, i) in capabilities"
        :key="cap.name"
        class="cap-card"
        :style="{ '--stagger': i }"
      >
        <div class="cap-icon-wrap" v-html="cap.svg"></div>
        <div class="cap-body">
          <div class="cap-name">{{ cap.name }}</div>
          <div class="cap-desc">{{ cap.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 快速提问：竖排卡片，适合长问题 -->
    <div class="quick-ask-section stagger-2">
      <div class="section-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="label-icon">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        试试直接点击提问
      </div>
      <div class="question-list">
        <button
          v-for="(ex, i) in examples"
          :key="ex"
          class="question-card"
          :style="{ '--card-idx': i }"
          :disabled="isSending"
          @click="handleSend(ex)"
        >
          <div class="q-num">0{{ i + 1 }}</div>
          <span class="q-text">{{ ex }}</span>
          <svg class="q-arrow" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref } from 'vue'
import { CONFIG } from '../../config'

const { BRAND, CAPABILITIES, EXAMPLE_QUESTIONS } = CONFIG

const emit = defineEmits(['send-example'])
const isSending = ref(false)

const handleSend = (ex) => {
  if (isSending.value) return
  isSending.value = true
  emit('send-example', ex)
  setTimeout(() => { isSending.value = false }, 2000)
}

const capabilities = [
  {
    name: CAPABILITIES[0].name,
    desc: CAPABILITIES[0].desc,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path class="anim-path" d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
    </svg>`
  },
  {
    name: CAPABILITIES[1].name,
    desc: CAPABILITIES[1].desc,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline class="anim-path" points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>`
  },
  {
    name: CAPABILITIES[2].name,
    desc: CAPABILITIES[2].desc,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle class="anim-path" cx="12" cy="12" r="3"/>
      <path class="anim-path" d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
    </svg>`
  },
  {
    name: CAPABILITIES[3].name,
    desc: CAPABILITIES[3].desc,
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path class="anim-path" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path class="anim-path" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      <path class="anim-path" d="M8 7h8M8 11h6"/>
    </svg>`
  },
]

const examples = EXAMPLE_QUESTIONS
</script>

<style scoped>
/* ────────────────────────────────────
   Keyframes
──────────────────────────────────── */
@keyframes heroIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes orbitSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes nucleusPulse {
  0%, 100% { opacity: 1; r: 2; }
  50%       { opacity: 0.7; r: 2.4; }
}

@keyframes cardIn {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes drawPath {
  from { stroke-dashoffset: 300; }
  to   { stroke-dashoffset: 0; }
}

@keyframes qCardIn {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}


/* ────────────────────────────────────
   Layout root
──────────────────────────────────── */
.welcome-hero {
  padding: 0;
  width: 100%;
  max-width: 780px;
}

.stagger-0 { animation: heroIn 0.5s ease-out both; animation-delay: 0ms; }
.stagger-1 { animation: heroIn 0.5s ease-out both; animation-delay: 90ms; }
.stagger-2 { animation: heroIn 0.5s ease-out both; animation-delay: 200ms; }


/* ────────────────────────────────────
   Hero header
──────────────────────────────────── */
.hero-header {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 28px;
}

/* ── 原子轨道 Logo ── */
.hero-logo-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border-radius: 16px;
  background: linear-gradient(135deg, #d3e3fd, #ecf3fe);
  color: var(--primary);
  flex-shrink: 0;
  box-shadow: 0 4px 20px rgba(11, 87, 208, 0.15), 0 0 0 1px rgba(11, 87, 208, 0.06);
}

.hero-logo {
  width: 28px;
  height: 28px;
  overflow: visible;
}

.atom-nucleus {
  animation: nucleusPulse 3s ease-in-out infinite;
}

.atom-orbit {
  transform-origin: 12px 12px;
  opacity: 0.7;
}
.orbit-1 { animation: orbitSpin 8s linear infinite; }
.orbit-2 {
  transform: rotate(60deg);
  animation: orbitSpin 10s linear infinite reverse;
}
.orbit-3 {
  transform: rotate(120deg);
  animation: orbitSpin 12s linear infinite;
}

/* ── 标题文字 ── */
.hero-title {
  font-size: 21px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  line-height: 1.25;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.brand-name {
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.text-gradient {
  background: linear-gradient(120deg, var(--primary) 20%, #7c3aed);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ── 标签行 ── */
.hero-tagline {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  flex-wrap: wrap;
}

.tag-item {
  font-size: 12px;
  color: var(--text-tertiary);
  letter-spacing: 0.2px;
}

.tag-dot {
  font-size: 11px;
  color: var(--border-light);
  line-height: 1;
}


/* ────────────────────────────────────
   Capability cards (2×2)
──────────────────────────────────── */
.cap-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 28px;
}

.cap-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  cursor: default;
  animation: cardIn 0.45s ease-out both;
  animation-delay: calc(90ms + var(--stagger, 0) * 60ms);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.cap-card:hover {
  border-color: #a8c4f8;
  background: linear-gradient(135deg, rgba(11, 87, 208, 0.03), transparent);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
}

/* 图标框 */
.cap-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: rgba(11, 87, 208, 0.08);
  color: var(--primary);
  flex-shrink: 0;
  margin-top: 1px;
  transition: background 0.2s;
}

.cap-card:hover .cap-icon-wrap {
  background: rgba(11, 87, 208, 0.14);
}

.cap-icon-wrap :deep(svg) {
  width: 16px;
  height: 16px;
  overflow: visible;
}

.cap-icon-wrap :deep(.anim-path) {
  stroke-dasharray: 300;
  stroke-dashoffset: 0;
}

.cap-card:hover .cap-icon-wrap :deep(.anim-path) {
  stroke-dashoffset: 300;
  animation: drawPath 0.65s ease forwards;
}

/* 文字内容 */
.cap-body {
  flex: 1;
  min-width: 0;
}

.cap-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  line-height: 1.3;
}

.cap-desc {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}


/* ────────────────────────────────────
   Quick question cards (vertical list)
──────────────────────────────────── */
.quick-ask-section {
  margin-top: 4px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.label-icon {
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
}

.question-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.question-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 18px;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-light);
  border-radius: 11px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  animation: qCardIn 0.4s ease-out both;
  animation-delay: calc(200ms + var(--card-idx, 0) * 55ms);
}

.question-card:hover:not(:disabled) {
  border-style: solid;
  border-color: #a8c4f8;
  background: var(--bg-primary);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.04);
  transform: translateX(3px);
}

.question-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.q-num {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  opacity: 0.5;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  width: 18px;
  transition: opacity 0.2s;
}

.question-card:hover:not(:disabled) .q-num {
  opacity: 1;
}

.q-text {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
  transition: color 0.2s;
}

.question-card:hover:not(:disabled) .q-text {
  color: var(--text-primary);
}

.q-arrow {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-quaternary);
  opacity: 0;
  transform: translateX(-4px);
  transition: all 0.2s ease;
}

.question-card:hover:not(:disabled) .q-arrow {
  opacity: 1;
  color: var(--primary);
  transform: translateX(0);
}
</style>
