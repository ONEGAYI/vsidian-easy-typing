// 预注册变换函数表（工单 #17）——函数替换体的函数本体承载。
//
// 【决策背景（vsidian#405 平台结论，用户确认 2026-10-08）】附加组件页面
// CSP 不放行 unsafe-eval，上游经 new Function 动态构造函数体的路径在真实
// webview 必被拦截（#25 实测 6 条 Input 函数体规则装载期整链降级）。等价
// 能力走预注册函数表：规则 JSON 只存声明性数据与函数引用（SimpleRule 的
// `replacement: {kind:'function', ref:'xxx'}`——票面 {"replace":{"kind":
// "function","ref":...}} 示例的字段化形态），函数本体是本模块内的真函数，
// 组件代码经构建桥打包在场。表达力不损，只改函数的物理位置；与 vsidian
// ADR-0012「载荷与结果是可传输数据，函数不过桥」原则同构。本项目决策
// 落档见 docs/adr/0003-function-replacement-preregistered-table.md。
//
// 【函数语义对照】每条函数与上游 easy-typing-obsidian v6.0.9
// src/default_rules.ts 的内置函数体规则逐条对照：参数签名（Input/Delete
// 类 leftMatches/rightMatches；SelectKey 类 selectionText/key）、返回串中
// 的 $n / [[n]] / ${SEL} 标记、返回 undefined 跳过语义原样（标记的展开
// 与 tabstop 解析仍在引擎 applyReplacement 后处理，函数只产出替换串）。
//
// 【纯数据 + 纯函数】本模块零平台依赖（src/rules 导入纪律扫描钉住），
// 可被引擎（装载查表）与设置页 UI（ref 选择面）同时消费。用户自定义
// 函数体场景由「规则组件化 fork」承接：fork 本组件把函数加入本表并
// 注册 ref，规则 JSON 按 ref 引用（详见 ADR-0003）。
//
// 【与上游函数体的两处无害收紧】上游函数体对映射表缺键直接下标访问
// （如 map[k][0]）触发 TypeError 走引擎运行时异常路径；此处改为显式
// undefined 返回（等价于规则跳过）。触发正则 / 触发键均保证键在场，
// 实际不可达——收紧只是让畸形输入的失败更可读，命中路径逐字符一致。

/** Input / Delete 类变换函数签名（左右捕获组两侧匹配） */
export type TextTransformFn = (leftMatches: string[], rightMatches: string[]) => string | void

/** SelectKey 类变换函数签名（选区文本 + 触发键） */
export type SelectKeyTransformFn = (selectionText: string, key: string) => string | void

/** 函数表条目签名种类：须与规则类型配对（SelectKey ↔ selectKey，Input/Delete ↔ text） */
export type FunctionSignatureKind = 'text' | 'selectKey'

export interface FunctionTableEntry {
  /** 引用名（规则 JSON 的 ref 值；表内唯一） */
  ref: string
  /** 签名种类（装载时与规则类型校验） */
  signature: FunctionSignatureKind
  /** 变换函数本体（参数与返回语义见上方对照说明） */
  fn: TextTransformFn | SelectKeyTransformFn
}

// ===== 上游内置函数体规则 → 真函数（10 条） =====

/** 上游 builtin-autopair-input：键入全角开符号 → 补全配对（$0 落配对间） */
const autopairInput: TextTransformFn = (leftMatches) => {
  // 上游替换表含重复键 '《'（同值，后者覆盖）——此处去重，语义一致
  const p: Record<string, string> = {
    '【': '【$0】',
    '（': '（$0）',
    '《': '《$0》',
    '「': '「$0」',
    '『': '『$0』',
    '“': '“$0”',
    '”': '“$0”',
    '‘': '‘$0’',
    '’': '‘$0’',
  }
  return p[leftMatches[0]!]
}

/** 上游 builtin-autopair-jump：右侧恰为配对端 → 吃掉刚键入的重复右符 */
const autopairJump: TextTransformFn = (leftMatches, rightMatches) => {
  const map: Record<string, [string, string]> = {
    '《》': ['》', '《》'],
    '（）': ['）', '（）'],
    '“”': ['”', '“”'],
    '““': ['”', '“”'],
    '‘’': ['’', '‘’'],
    '‘‘': ['’', '‘’'],
  }
  const pair = map[leftMatches[0]!]
  if (pair === undefined) return undefined // 上游此处 TypeError（触发正则保证在场，不可达）
  if (pair[0] == rightMatches[0]) return pair[1]
  return undefined
}

/** 上游 builtin-autopair-delete：删除开符号且右侧恰为配对端 → 连带删除 */
const autopairDelete: TextTransformFn = (leftMatches, rightMatches) => {
  const p: Record<string, string> = {
    '【': '】',
    '（': '）',
    '《': '》',
    '「': '」',
    '『': '』',
    '“': '”',
    '‘': '’',
  }
  return p[leftMatches[0]!] === rightMatches[0] ? '' : undefined
}

/** 上游 builtin-conv-formula：￥/$ 组合 → 行内公式；右侧恰为 $ → 块级公式 */
const convFormula: TextTransformFn = (_leftMatches, rightMatches) =>
  rightMatches[0] === '$' ? '$$\n$0\n$$' : '$$0$'

/** 上游 builtin-conv-linestart：行首 》 转引用标记、行首 、 转斜杠（[[1]] 回行首前缀） */
const convLinestart: TextTransformFn = (leftMatches) => {
  const m: Record<string, string> = { '》': '[[1]]> $0', '、': '[[1]]/$0' }
  return m[leftMatches[2]!]
}

/** 上游 builtin-conv-hw2fw：CJK 字符后半角标点转全角（( 转全角配对括号） */
const convHw2fw: TextTransformFn = (leftMatches) => {
  const m: Record<string, string> = {
    ',': '，',
    '.': '。',
    '?': '？',
    '!': '！',
    ':': '：',
    ';': '；',
    '(': '（$0）',
  }
  // 触发类 [,.:?!;\(] 与表键一一对应，m[...] 恒在场（上游同构）
  return leftMatches[1]! + m[leftMatches[2]!]!
}

/** 上游 builtin-fw2hw-double：连续两个相同全角标点转半角（右侧配对端特例先判） */
const fw2hwDouble: TextTransformFn = (leftMatches, rightMatches) => {
  const p: Record<string, [string, string]> = {
    '（': ['）', '($0)'],
    '《': ['》', '<$0'],
  }
  const m: Record<string, string> = {
    '。': '.$0',
    '！': '!$0',
    '；': ';$0',
    '，': ',$0',
    '：': ':$0',
    '？': '?$0',
    '》': '>$0',
    '｜': '|$0',
    '（': '($0)',
    '《': '<$0',
  }
  const c = leftMatches[1]!
  const r = rightMatches[0] || ''
  const e = p[c]
  return e && e[0] === r ? e[1] : m[c]
}

/** 上游 builtin-sel-wrap-symbols：选中后键入 【/¥/￥ → [] / $$ 包裹（$0 覆盖选区） */
const selWrapSymbols: SelectKeyTransformFn = (_selectionText, key) => {
  const m: Record<string, [string, string]> = {
    '¥': ['$', '$'],
    '￥': ['$', '$'],
    '【': ['[', ']'],
  }
  const pair = m[key]
  if (pair === undefined) return undefined // 触发键保证在场，不可达（上游此处 TypeError）
  return pair[0] + '${0:${SEL}}' + pair[1]
}

/** 上游 builtin-sel-wrap-quotes：选中后键入全角引号 → 配对引号包裹 */
const selWrapQuotes: SelectKeyTransformFn = (_selectionText, key) => {
  const m: Record<string, [string, string]> = {
    '“': ['“', '”'],
    '”': ['“', '”'],
    '‘': ['‘', '’'],
    '’': ['‘', '’'],
  }
  const pair = m[key]
  if (pair === undefined) return undefined
  return pair[0] + '${0:${SEL}}' + pair[1]
}

/** 上游 builtin-sel-wrap-cjk-brackets：选中后键入 《（ → 配对括号包裹 */
const selWrapCjkBrackets: SelectKeyTransformFn = (_selectionText, key) => {
  const m: Record<string, [string, string]> = {
    '《': ['《', '》'],
    '（': ['（', '）'],
  }
  const pair = m[key]
  if (pair === undefined) return undefined
  return pair[0] + '${0:${SEL}}' + pair[1]
}

/**
 * 组件内置函数表（ref 升序登记；fork 扩展时在此追加条目并保持 ref 唯一）。
 * ref → 上游规则 id 映射：
 * - autopairInput        ↔ builtin-autopair-input（rF/10）
 * - autopairJump         ↔ builtin-autopair-jump（rF/5）
 * - autopairDelete       ↔ builtin-autopair-delete（drF/10）
 * - convFormula          ↔ builtin-conv-formula（rF/10）
 * - convHw2fw            ↔ builtin-conv-hw2fw（rF/15，默认关）
 * - convLinestart        ↔ builtin-conv-linestart（rF/10）
 * - fw2hwDouble          ↔ builtin-fw2hw-double（rF/3）
 * - selWrapCjkBrackets   ↔ builtin-sel-wrap-cjk-brackets（sF/40）
 * - selWrapQuotes        ↔ builtin-sel-wrap-quotes（sF/40）
 * - selWrapSymbols       ↔ builtin-sel-wrap-symbols（sF/40）
 */
export const FUNCTION_TABLE: readonly FunctionTableEntry[] = [
  { ref: 'autopairInput', signature: 'text', fn: autopairInput },
  { ref: 'autopairJump', signature: 'text', fn: autopairJump },
  { ref: 'autopairDelete', signature: 'text', fn: autopairDelete },
  { ref: 'convFormula', signature: 'text', fn: convFormula },
  { ref: 'convHw2fw', signature: 'text', fn: convHw2fw },
  { ref: 'convLinestart', signature: 'text', fn: convLinestart },
  { ref: 'fw2hwDouble', signature: 'text', fn: fw2hwDouble },
  { ref: 'selWrapCjkBrackets', signature: 'selectKey', fn: selWrapCjkBrackets },
  { ref: 'selWrapQuotes', signature: 'selectKey', fn: selWrapQuotes },
  { ref: 'selWrapSymbols', signature: 'selectKey', fn: selWrapSymbols },
]

/** ref 查表（组件内置表；引擎缺省函数表） */
export const FUNCTION_TABLE_BY_REF: ReadonlyMap<string, FunctionTableEntry> = new Map(
  FUNCTION_TABLE.map((entry) => [entry.ref, entry]),
)

/** 规则类型 → 所需签名种类（装载校验与 UI 选择面共用口径） */
export function signatureKindForRuleType(
  type: 'input' | 'delete' | 'selectKey',
): FunctionSignatureKind {
  return type === 'selectKey' ? 'selectKey' : 'text'
}
