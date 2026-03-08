/**
 * 铝合金热力学相名美化映射
 * 将 CALPHAD 内部相名转换为材料学标准表达
 *
 * 来源：Al-Si-Mg-Fe-Mn_by_wf.TDB 数据库实际相名
 */
export const PHASE_DISPLAY_NAMES = {
  // ── 液相 & 基体 ──────────────────────────────────────────
  'LIQUID':          '液相 (L)',
  'FCC_A1':          'α-Al (FCC)',
  // ── 共晶硅 ───────────────────────────────────────────────
  'DIAMOND_A4':      'Si (金刚石型)',
  // ── Mg/Si 相关 ──────────────────────────────────────────
  'HCP_A3':          'Mg (HCP)',
  'MG2SI':           'Mg₂Si',
  // ── Mg-Al 相 ────────────────────────────────────────────
  'BETA_ALMG':       'β-Al₃Mg₂',
  'EPSILON_ALMG':    'ε-Al₃₀Mg₂₃',
  'GAMMA_ALMG':      'γ-Al₁₂Mg₁₇',
  // ── Fe/Mn 相关 ──────────────────────────────────────────
  'BCC_A2':          'BCC (Fe,Mn)',
  'BCC_B2':          'BCC_B2',
  'CBCC_A12':        'CBCC_A12 (Mn)',
  'AL5FE2':          'Al₅Fe₂',
  'AL13FE4':         'Al₁₃Fe₄',
  'ALPHA_ALFESI':    'α-AlFeSi',
  'ALPH_ALFESI':     'α-AlFeSi',
  'BETA_ALFESI':     'β-AlFeSi (针状)',
  'DELTA_ALFESI':    'δ-AlFeSi',
  'GAMMA_ALFESI':    'γ-AlFeSi',
  'ALPHA_ALFEMNSI':  'α-Al(Fe,Mn)Si',
  'ALPH_ALFEMNSI':   'α-Al(Fe,Mn)Si',
  'BETA_ALMNSI':     'β-AlMnSi',
  'AL4_FEMN':        'Al₄(Fe,Mn)',
  'FEMN_3AL10':      '(Fe,Mn)₃Al₁₀',
  'FEMN_4AL13':      '(Fe,Mn)₄Al₁₃',
  'AL6MN':           'Al₆Mn',
  'AL8MN5':          'Al₈Mn₅',
  'AL12MN':          'Al₁₂Mn',
  'MU_AL4MN':        'μ-Al₄Mn',
  'LAMBDA_AL4MN':    'λ-Al₄Mn',
  'AL2FE':           'Al₂Fe',
  'AL5FE4':          'Al₅Fe₄',
  // ── 其他 ────────────────────────────────────────────────
  'CUB_A13':         'CUB_A13',
  'HCP_A3_HF':       'HCP_A3 (Hf)',
}

/**
 * 获取相的显示名称，找不到则原样返回
 * @param {string} rawName - CALPHAD 内部相名
 * @returns {string} 显示名称
 */
export const getPhaseDisplayName = (rawName) => {
  if (!rawName) return ''
  return PHASE_DISPLAY_NAMES[rawName] ?? rawName
}

/**
 * 批量美化相名列表
 * @param {string[]} phases
 * @returns {string[]}
 */
export const beautifyPhaseNames = (phases) => {
  return (phases || []).map(getPhaseDisplayName)
}

/**
 * 将 "FCC_A1+BETA_ALFESI+LIQUID" 格式字符串拆开并美化
 * @param {string} phasesStr - 用 + 连接的相名字符串
 * @returns {string} 美化后的字符串
 */
export const beautifyPhaseString = (phasesStr) => {
  if (!phasesStr || typeof phasesStr !== 'string') return phasesStr ?? '—'
  return phasesStr
    .split('+')
    .map(p => getPhaseDisplayName(p.trim()))
    .join(' + ')
}
