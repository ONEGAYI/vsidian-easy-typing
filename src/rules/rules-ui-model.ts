// 规则管理 UI 纯逻辑模型（工单 #16）：设置页自绘的表单模型、载荷装配、
// 拖拽索引换算、单规则试运行与 JS 词法着色——全部零平台/零 DOM 依赖，
// 供 src/rulesUi.ts（DOM 层）与 vitest 矩阵消费。上游对照：
// - 表单模型与 options 装配：src/settings/rule_edit_modal.ts（表单状态 +
//   buildSimpleRule 的 d/s/T/r/F/t/f/c 旗标拼装与 escape/unescape 换算）；
// - 拖拽索引：easy_typing_settings_tab.ts drop 处理器的 from/to 换算；
// - JS 词法器：rule_edit_modal.ts tokenizeJS 原样移植（CM6 高亮的降级替代
//   ——设置页无 cm6 共享运行时，用 textarea + 着色叠层实现）。
import { RuleEngine, RuleScope, RuleTriggerMode, RuleType, type ApplyResult, type SimpleRule } from './rule-engine'
import { FUNCTION_TABLE_BY_REF, signatureKindForRuleType } from './function-table'

// ===== 表单模型 =====

/** 规则编辑表单状态（上游 RuleEditModal 表单字段的平台化形态） */
export interface RuleFormModel {
  ruleType: RuleType
  triggerMode: RuleTriggerMode
  trigger: string
  triggerRight: string
  replacement: string
  isRegex: boolean
  regexFlags: string
  scopeLanguage: string
  priority: number
  description: string
  enabled: boolean
  scopes: RuleScope[]
  /**
   * 函数式替换开关（#17 解锁）：true 时替换体为预注册函数引用（options
   * 拼F旗标、replacement 装配 {kind:'function', ref}）。仅引用选择，
   * 不含函数体编辑——函数本体在组件代码的函数表（自定义走组件化
   * fork，见 ADR-0003）。
   */
  isFunction: boolean
  /** 选中的函数表 ref（isFunction 为 true 时装配进 replacement；空 = 未选） */
  functionRef: string
}

/** 新建规则的表单初值（上游 create 模式默认值） */
export function defaultRuleFormModel(): RuleFormModel {
  return {
    ruleType: RuleType.Input,
    triggerMode: RuleTriggerMode.Auto,
    trigger: '',
    triggerRight: '',
    replacement: '',
    isRegex: false,
    regexFlags: '',
    scopeLanguage: '',
    priority: 100,
    description: '',
    enabled: true,
    scopes: [RuleScope.All],
    isFunction: false,
    functionRef: '',
  }
}

/**
 * 既有规则 → 表单模型（上游 RuleEditModal 构造器的初值解析）：options
 * 拆解为枚举态；trigger/trigger_right 经 escapeText 转可见转义（非正则
 * 模式下 \n 等真实控制字符与反斜杠须可见可编辑）。函数引用规则取 ref
 * 进 functionRef；遗留字符串函数体（#17 前数据）functionRef 留空，保存
 * 须改选预注册函数。
 */
export function formModelFromSimpleRule(rule: SimpleRule): RuleFormModel {
  const opts = RuleEngine.parseOptions(rule.options)
  const model = defaultRuleFormModel()
  model.ruleType = opts.type
  model.triggerMode = opts.triggerMode
  model.isRegex = opts.isRegex
  model.isFunction = opts.isFunctionReplacement
  model.scopes = opts.scope.length > 0 ? [...opts.scope] : [RuleScope.All]
  model.trigger = RuleEngine.escapeText(rule.trigger, opts.isRegex)
  if (rule.trigger_right !== undefined) {
    model.triggerRight = RuleEngine.escapeText(rule.trigger_right, opts.isRegex)
  }
  model.replacement = typeof rule.replacement === 'string' ? rule.replacement : ''
  if (typeof rule.replacement !== 'string') model.functionRef = rule.replacement.ref
  if (rule.regex_flags !== undefined) model.regexFlags = RuleEngine.normalizeRegexFlags(rule.regex_flags)
  if (typeof rule.priority === 'number') model.priority = rule.priority
  if (rule.description !== undefined) model.description = rule.description
  if (rule.enabled !== undefined) model.enabled = rule.enabled
  if (rule.scope_language !== undefined) model.scopeLanguage = rule.scope_language
  return model
}

/**
 * 表单 → SimpleRule 装配（上游 buildSimpleRule）：options 旗标拼装、
 * 非正则 trigger 经 unescapeText 还原、空串可选字段归 undefined。
 * isFunction 时 replacement 装配为函数引用对象（ref 经 validateRuleForm
 * 把关在场与签名配对）。
 */
export function buildSimpleRuleFromForm(
  model: RuleFormModel,
  _original?: SimpleRule,
): SimpleRule {
  let options = ''
  if (model.ruleType === RuleType.Delete) options += 'd'
  else if (model.ruleType === RuleType.SelectKey) options += 's'
  if (model.ruleType === RuleType.Input && model.triggerMode === RuleTriggerMode.Tab) options += 'T'
  if (model.isRegex) options += 'r'
  if (model.isFunction) options += 'F'
  if (!model.scopes.includes(RuleScope.All)) {
    if (model.scopes.includes(RuleScope.Text)) options += 't'
    if (model.scopes.includes(RuleScope.Formula)) options += 'f'
    if (model.scopes.includes(RuleScope.Code)) options += 'c'
  }
  const scopes = model.scopes.length > 0 ? model.scopes : [RuleScope.All]
  return {
    trigger: model.isRegex ? model.trigger : RuleEngine.unescapeText(model.trigger),
    trigger_right:
      (model.isRegex ? model.triggerRight : RuleEngine.unescapeText(model.triggerRight)) || undefined,
    replacement: model.isFunction
      ? { kind: 'function', ref: model.functionRef }
      : model.replacement,
    options: options || undefined,
    priority: model.priority,
    description: model.description || undefined,
    enabled: model.enabled,
    scope_language:
      scopes.includes(RuleScope.Code) && model.scopeLanguage ? model.scopeLanguage : undefined,
    regex_flags: model.isRegex ? RuleEngine.normalizeRegexFlags(model.regexFlags) || undefined : undefined,
  }
}

// ===== 表单校验 =====

export type RuleFormError =
  | { field: 'trigger'; kind: 'required' }
  | { field: 'trigger' | 'triggerRight'; kind: 'invalid-regex'; detail: string }
  | { field: 'functionRef'; kind: 'required' }
  | { field: 'functionRef'; kind: 'invalid' }

/** 函数 ref 对规则类型是否有效（在场且签名配对；UI 选择面与校验共用） */
export function functionRefValidForType(ref: string, ruleType: RuleType): boolean {
  const entry = FUNCTION_TABLE_BY_REF.get(ref)
  if (!entry) return false
  return entry.signature === signatureKindForRuleType(ruleType)
}

/** 该规则类型可用的首个函数 ref（函数开关打开时的缺省预选；无可用返回空串） */
export function firstFunctionRefForType(ruleType: RuleType): string {
  const want = signatureKindForRuleType(ruleType)
  for (const entry of FUNCTION_TABLE_BY_REF.values()) {
    if (entry.signature === want) return entry.ref
  }
  return ''
}

/**
 * 保存前校验（上游 Notice 两分支的结构化形态，文案映射归 UI 层）：
 * 触发式必填；函数式替换须选中与规则类型配对的预注册函数；正则模式下
 * 经 RuleEngine.validateRegex 校验两侧模式。
 */
export function validateRuleForm(model: RuleFormModel): RuleFormError | null {
  if (model.trigger.trim().length === 0) return { field: 'trigger', kind: 'required' }
  if (model.isFunction) {
    if (model.functionRef.length === 0) return { field: 'functionRef', kind: 'required' }
    if (!functionRefValidForType(model.functionRef, model.ruleType)) {
      return { field: 'functionRef', kind: 'invalid' }
    }
  }
  const regexError = RuleEngine.validateRegex(buildSimpleRuleFromForm(model))
  if (regexError !== null) {
    const field = regexError.startsWith('trigger_right') ? 'triggerRight' : 'trigger'
    return { field, kind: 'invalid-regex', detail: regexError }
  }
  return null
}

// ===== 作用域切换（上游 toggleRuleScope） =====

/**
 * 作用域 chip 点击语义：All 与细分互斥（选 All 清其余；取消到空回 All）。
 */
export function toggleFormScope(scopes: RuleScope[], scope: RuleScope): RuleScope[] {
  if (scope === RuleScope.All) return [RuleScope.All]
  const next = scopes.filter((item) => item !== RuleScope.All)
  const has = next.includes(scope)
  const merged = has ? next.filter((item) => item !== scope) : [...next, scope]
  return merged.length > 0 ? merged : [RuleScope.All]
}

// ===== 拖拽索引换算（上游 drop 处理器） =====

/**
 * 拖拽落点 → reorderUserRule 目标索引（splice 后语义）。源在上/下两种
 * 相对位向各自换算；落点等于原位（或源索引非法）返回 null（no-op）。
 * pure 抽取以便矩阵测试（DOM 层只负责把 dragover 的上下半区判断传入）。
 */
export function computeDropIndex(fromIndex: number, targetIndex: number, dropOnBottom: boolean): number | null {
  if (fromIndex < 0 || targetIndex < 0) return null
  let toIndex: number
  if (fromIndex < targetIndex) {
    toIndex = dropOnBottom ? targetIndex : targetIndex - 1
  } else {
    toIndex = dropOnBottom ? targetIndex + 1 : targetIndex
  }
  return fromIndex === toIndex ? null : toIndex
}

// ===== 列表预览（上游 buildRuleItem 的 preview 拼装） =====

/**
 * 规则列表预览行：内置规则描述本地化（#19，上游 builtinRuleDescriptions
 * 模式）——builtinDescriptions[rule.id] 优先于数据态 description；两者皆无
 * 时退化为「触发 → 替换」形态。函数引用显示 fn:<ref>；遗留字符串函数体
 * 原样显示；非正则触发式经 escapeText 转可见。builtinDescriptions 由视图
 * 层传入语言包映射（用户规则 id 不在映射内，天然回落自身 description）。
 */
export function previewRuleText(
  rule: SimpleRule,
  builtinDescriptions?: Record<string, string>,
): string {
  const localized = rule.id ? builtinDescriptions?.[rule.id] : undefined
  if (localized) return localized
  if (rule.description) return rule.description
  const opts = RuleEngine.parseOptions(rule.options)
  const render = (text: string): string => RuleEngine.escapeText(text, opts.isRegex)
  const repl =
    typeof rule.replacement === 'string' ? rule.replacement : `fn:${rule.replacement.ref}`
  const left = render(rule.trigger)
  const right = rule.trigger_right ? ` … ${render(rule.trigger_right)}` : ''
  return `${left}${right} → ${repl}`
}

// ===== 单规则试运行（规则测试编辑器） =====

export interface RuleTestInput {
  /** 测试文档全文 */
  docText: string
  /** 光标/选区（Input 与 Delete 类取光标位；SelectKey 类取选区文本） */
  from: number
  to: number
  /** SelectKey 类模拟按键（缺省取触发键序列首个字符） */
  key?: string
}

export type RuleTestOutcome =
  | { kind: 'hit'; result: ApplyResult; outputText: string; cursor: number }
  | { kind: 'miss' }

/**
 * 单规则试运行：独立引擎装载单条规则后按规则类型构造 TxContext 执行。
 * - Input 类：模拟「光标处刚输入」——scopeHint=All、changeType 常规输入；
 * - Delete 类：同匹配路径，kind=Delete（上游 Delete 触发管线归 #9，此处
 *   试运行语义 = 光标处执行一次删除的匹配判定）；
 * - SelectKey 类：选区文本 + 模拟按键（缺省首触发键）。
 * 输出文本 = 命中区间替换结果；cursor 为结果光标（用于 UI 标注插入位）。
 */
export function testSingleRule(rule: SimpleRule, input: RuleTestInput): RuleTestOutcome {
  // 空触发式 = 表单未完成（引擎对空 trigger 会空匹配，试运行如实视为未命中）
  if (rule.trigger.length === 0) return { kind: 'miss' }
  const engine = new RuleEngine()
  engine.addSimpleRule(rule)
  const opts = RuleEngine.parseOptions(rule.options)
  const from = Math.max(0, Math.min(input.from, input.docText.length))
  const to = Math.max(from, Math.min(input.to, input.docText.length))
  let ctxKind: RuleType
  let key: string | undefined
  if (opts.type === RuleType.SelectKey) {
    ctxKind = RuleType.SelectKey
    key = input.key ?? RuleEngine.parseSelectKeyRuleTriggerKeys(rule.trigger)[0]
    if (key === undefined) return { kind: 'miss' }
  } else {
    ctxKind = opts.type
  }
  const result = engine.process({
    kind: ctxKind,
    docText: input.docText,
    selection: { from, to },
    inserted: '',
    changeType: '',
    scopeHint: RuleScope.All,
    key,
  })
  if (result === null) return { kind: 'miss' }
  const outputText =
    input.docText.slice(0, result.matchRange.from) +
    result.newText +
    input.docText.slice(result.matchRange.to)
  return { kind: 'hit', result, outputText, cursor: result.cursor }
}

// ===== JS 词法着色（上游 tokenizeJS 移植，输出语义类名） =====

export interface JsToken {
  from: number
  to: number
  /** 语义类（comment/string/number/keyword）——视图层加 scoped 前缀后成 CSS 类 */
  cls: 'comment' | 'string' | 'number' | 'keyword'
}

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'new', 'this', 'true', 'false',
  'null', 'undefined', 'typeof', 'instanceof', 'in', 'of', 'try', 'catch',
  'finally', 'throw', 'async', 'await',
])

/** 轻量 JS 词法分析（关键字/注释/字符串/数字 → 语义类区间） */
export function tokenizeJs(text: string): JsToken[] {
  const tokens: JsToken[] = []
  let i = 0
  while (i < text.length) {
    // 行注释
    if (text[i] === '/' && text[i + 1] === '/') {
      const start = i
      while (i < text.length && text[i] !== '\n') i++
      tokens.push({ from: start, to: i, cls: 'comment' })
      continue
    }
    // 块注释
    if (text[i] === '/' && text[i + 1] === '*') {
      const start = i
      i += 2
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++
      if (i < text.length - 1) i += 2
      else i = text.length
      tokens.push({ from: start, to: i, cls: 'comment' })
      continue
    }
    // 字符串
    if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      const quote = text[i]
      const start = i
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++
        i++
      }
      if (i < text.length) i++
      tokens.push({ from: start, to: i, cls: 'string' })
      continue
    }
    // 数字
    if (/\d/.test(text[i]) && (i === 0 || /[^a-zA-Z_$]/.test(text[i - 1]))) {
      const start = i
      if (text[i] === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
        i += 2
        while (i < text.length && /[0-9a-fA-F]/.test(text[i])) i++
      } else {
        while (i < text.length && /\d/.test(text[i])) i++
        if (i < text.length && text[i] === '.') {
          i++
          while (i < text.length && /\d/.test(text[i])) i++
        }
      }
      tokens.push({ from: start, to: i, cls: 'number' })
      continue
    }
    // 词（仅关键字着色）
    if (/[a-zA-Z_$]/.test(text[i])) {
      const start = i
      while (i < text.length && /[a-zA-Z0-9_$]/.test(text[i])) i++
      if (JS_KEYWORDS.has(text.slice(start, i))) {
        tokens.push({ from: start, to: i, cls: 'keyword' })
      }
      continue
    }
    i++
  }
  return tokens
}
