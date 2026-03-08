<template>
  <div class="preview-page">
    <div class="preview-header">
      <h2>ReportCard 组件测试预览</h2>
      <p class="preview-note">此页面仅用于开发测试，生产环境不可见。点击「下载 PDF」验证 PDF 输出效果。</p>
    </div>
    <div class="preview-body">
      <ReportCard :data="mockReportData" />
    </div>
  </div>
</template>

<script setup>
import ReportCard from '../components/results/ReportCard.vue'

/** 与 generate_report 工具返回的 JSON 结构完全一致 */
const mockReportData = {
  report_type: 'alloy_design_report',
  title: 'Al-Si-Mg 系铝合金设计可行性报告',
  saved_at: new Date().toISOString(),
  filename: 'report_AlSiMg_test.md',
  content: `# Al-Si-Mg 系铝合金设计可行性报告

---

## 1. 设计目标概述

**应用场景**：新能源汽车一体化压铸车身后地板结构件

**性能目标**：
- 抗拉强度（UTS）≥ 330 MPa
- 延伸率（EL）≥ 15%

**候选成分**：
- Al-7.0Si-0.35Mg-0.12Fe-0.45Mn（成分 1）
- Al-8.5Si-0.45Mg-0.10Fe-0.50Mn-0.02Sr（成分 2）
- Al-9.0Si-0.30Mg-0.08Fe-0.55Mn-0.015Sr（成分 3）

---

## 2. 候选合金评估

### （1）Al-7.0Si-0.35Mg-0.12Fe-0.45Mn

**预测力学性能**：
- 抗拉强度（UTS）：**312.4 MPa** ❌ 未达标（目标 ≥ 330 MPa）
- 屈服强度（YS）：**178.6 MPa**
- 延伸率（EL）：**16.2 %** ✅ 达标

**热力学特性**：

热力学计算待补充（当前数据库不支持 AL 体系）

> ⚠️ EL 达标但 UTS 不足，Si 含量较低导致强化相析出有限；延伸率优势突出，Fe/Mn 比控制良好。

---

### （2）Al-8.5Si-0.45Mg-0.10Fe-0.50Mn-0.02Sr

**预测力学性能**：
- 抗拉强度（UTS）：**348.7 MPa** ✅ 达标
- 屈服强度（YS）：**196.3 MPa**
- 延伸率（EL）：**15.4 %** ✅ 达标

**热力学特性**：

热力学计算待补充（当前数据库不支持 AL 体系）

> ✅ UTS 和 EL 均达标，Sr 微量变质细化共晶 Si 可进一步改善延伸率；综合性能最优。

---

### （3）Al-9.0Si-0.30Mg-0.08Fe-0.55Mn-0.015Sr

**预测力学性能**：
- 抗拉强度（UTS）：**355.1 MPa** ✅ 达标
- 屈服强度（YS）：**201.8 MPa**
- 延伸率（EL）：**13.7 %** ❌ 未达标（目标 ≥ 15%）

**热力学特性**：

热力学计算待补充（当前数据库不支持 AL 体系）

> ⚠️ UTS 最高但 EL 未达标；Si 含量偏高在未充分变质时延伸率有所下降。

---

## 3. 最优方案推荐

推荐成分：**Al-8.5Si-0.45Mg-0.10Fe-0.50Mn-0.02Sr**

推荐理由：

1. **UTS 348.7 MPa** 超过目标值 330 MPa，余量 5.7%
2. **EL 15.4 %** 超过目标值 15%，余量充足
3. Si = 8.5% 平衡流动性与延伸率，避免成分 3 的 EL 不达标问题
4. Sr 0.02% 微量变质细化共晶 Si 形貌（针状→纤维状），有效提升塑性
5. Fe ≤ 0.10%、Mn/Fe ≥ 5，β-Al₅FeSi 相风险显著降低

与其他候选对比：

| 成分 | UTS (MPa) | EL (%) | UTS 达标 | EL 达标 | 综合评级 |
|------|-----------|--------|:--------:|:--------:|:--------:|
| Al-7.0Si-0.35Mg-0.12Fe-0.45Mn | 312.4 | 16.2 | ❌ | ✅ | ⚠️ 待改进 |
| **Al-8.5Si-0.45Mg-0.10Fe-0.50Mn-0.02Sr** | **348.7** | **15.4** | **✅** | **✅** | **✅ 推荐** |
| Al-9.0Si-0.30Mg-0.08Fe-0.55Mn-0.015Sr | 355.1 | 13.7 | ✅ | ❌ | ⚠️ 待改进 |

---

## 4. 工艺建议

### 4.1 压铸工艺

| 工序 | 参数建议 | 依据 |
|------|---------|------|
| 熔炼温度 | 720–750 °C | 高于 Al-Si-Mg 系典型液相线约 140–170 °C |
| 浇注温度 | 630–660 °C | 液相线以上约 50–80 °C，减少冷隔和气孔 |
| 变质处理 | Sr 0.02–0.04 wt.% | 细化共晶 Si，延伸率提升 2–4% |
| 高真空压铸 | 推荐（< 50 mbar） | Fe ≤ 0.10% 时高真空有效抑制气孔 |
| 模具预热 | 200–250 °C | 防止冷隔，保证充型完整 |

### 4.2 热处理工艺

| 制度 | 适用条件 | 典型参数 |
|------|---------|---------|
| 免热处理（F 态）| Mg ≤ 0.4%，大型薄壁件 | 铸态使用 |
| **T6**（推荐）| Mg = 0.45%，追求高强度 | 固溶 540 °C × 8 h + 时效 160 °C × 6 h |
| T7 | 平衡强度与延伸率 | 固溶 540 °C × 8 h + 过时效 200 °C × 4 h |

---

## 5. 风险提示与改进方向

**存在风险**：

- **β-Al₅FeSi 相风险（已控制）**：推荐成分 Fe = 0.10%，Mn/Fe = 5，延伸率影响小
- **Mg 烧损**：熔炼时须使用覆盖剂，控制烧损 ≤ 0.05%
- **共晶 Si 粗化**：Sr 变质不充分时针状 Si 急剧降低延伸率
- **预测不确定性**：ONNX 模型外推误差约 ±8–10%，EL 余量有限，建议实验验证

**改进方向**：

- **CalphaMesh 热力学补充**：待 AL 热力学数据库（\`al-default.TDB\`）恢复后，补充平衡相计算和 Scheil 凝固模拟
- **Sr 变质工艺优化**：验证 0.02%、0.03%、0.04% 三档对 EL 的实际影响
- **高压压铸参数验证**：优化浇注温度与压射速度，确保 EL ≥ 15% 批次稳定性

---

## 结论

综合 ONNX 性能预测，**Al-8.5Si-0.45Mg-0.10Fe-0.50Mn-0.02Sr** 同时满足 UTS ≥ 330 MPa（预测 **348.7 MPa**）和 EL ≥ 15%（预测 **15.4 %**），为三候选成分中唯一全达标方案，推荐作为首选成分进行实验验证。热力学分析待 CalphaMesh AL 数据库恢复后补充。
`,
}
</script>

<style scoped>
.preview-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 24px;
}

.preview-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.preview-header h2 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
}

.preview-note {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 8px 12px;
}

.preview-body {
  max-width: 860px;
}
</style>
