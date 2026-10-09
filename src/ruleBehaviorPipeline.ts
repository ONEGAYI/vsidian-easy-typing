// onInput → 规则引擎触发管线（工单 #25 Input 类 + 工单 #9 Delete/
// SelectKey 类）：把 #1 内核接进 vsidian 稳定行为链——「执行面无需补
// API」结论的落地层。
//
// 数据流：AddonInputContext（结构子集）→ TxContext（映射表见
// docs/specs/rule-engine.md「平台映射」节）→ RuleEngine.process（Input
// 类）→ ApplyResult → AddonBehaviorInputPlan（{changes, selection}）。
// 上游对照 rule_processor.ts triggerCvtRule 与 cm_extensions.ts
// tryProcessInput 的规则触发段；平台行为链已先行判定的门控（只读 / IME
// 组合中间态 / 表格格区 / 代码上下文 / paste·drop·undo）不在此重复。
//
// 【userEvent 原样保留在入口】区分普通键入（input.type）与 IME 定稿
// （input.type.compose）的信息不在此丢失——#6 compose 去重、#26 格式化
// 管线都从同一入口形状挂接。
//
// 【选区语义】快照 selections 不含主选区标记（平台 AddonEditorSnapshot
// 不携带 mainIndex）：管线取首个（最左）选区，上游取 asSingle().main
// ——单光标（主流形态）两者一致，多光标差异记录于规格。Input 类仅处理
// 塌缩选区（上游 notSelected 同口径；选区替换形态归 SelectKey 管线）。
// 计划 selection 为单一 {anchor, head}，平台按 EditorSelection.single
// 应用——命中即坍缩其余光标，与上游 dispatch 单选区行为等价。
//
// ===== 工单 #9：Delete / SelectKey 触发管线 =====
//
// 【快照是事务后状态】平台 snapshot「已含本次输入」——引擎需要的是上游
// 的 startState（事务前文档 + 事务前光标）。事务前形态经 AddonReplacedRange
// 重建（#400/#401）：delete 侧把被删文本拼回最小包围区间，input 替换侧
// 把被替换选区内容拼回键入文本之前。重建仅对**单一删除/替换区间**精确；
// 多区间（多光标）时 replaced 是最小包围 + 按序拼接（平台语义），重建
// 不可信——两条管线均以「快照选区数 = 1」为前置门，多选区一律返回 null
//（与 #25「仅处理首个选区」口径一致）。
//
// 【Delete 虚拟光标】上游 delete 分支（cm_extensions.ts）以事务前光标
// （被删区间右端 toA）组 TxContext，左正则可命中刚删的字符（匹配的是
// 事务前文档）。本管线的光标映射：backward → replaced.to（上游同口径）、
// forward → replaced.from（Delete 键删光标右侧，镜像）、selection/cut/
// line → replaced.to（上游不处理这三类，按 backward 口径统一，delete.line
// 的空块场景按此口径验证）。引擎产出（matchRange/cursor/tabstops）为
// 事务前坐标，落计划前换算回快照坐标（preOffsetToSnapshot）。
//
// 【SelectKey 包裹目标】键入替换选区时包裹目标从 replaced 读回（#401：
// 按键插入发生在选区销毁之后）。计划替换快照中键入字符占据区
// [replaced.from, replaced.from + inputText.length)；引擎 cursor/tabstops
// 以 matchRange.from（= replaced.from）为基点，与计划基点一致，直接可用
//（换算推导见规格「#9 触发接入」节）。IME 定稿（input.type.compose）
// 补驱动 replaced 恒 null（#399 平台边界）——compose 事件天然不进
// SelectKey 管线，边界用例钉住。
import {
  RuleEngine,
  RuleType,
  type ApplyResult,
  type TabstopSpec,
  type TxContext,
} from './rules/rule-engine'

// intercept 层经本模块取 tabstop 类型（单一来源，避免多点直连引擎内部）
export type { TabstopSpec } from './rules/rule-engine'
import { detectScopeFromText } from './ruleScopeFallback'

// ===== 工单 #27：保护区注入（「用户规则尊重保护区」的判定位） =====
//
// 上游 rule_processor.ts:22-29：UserDefinedRegSwitch &&
// UserRulesRespectUserDefinedRegexBlocks 开启时光标列在用户自定义正则
// 保护区内 → 规则不触发。探针经 options 注入（设置消费在 intercept 层，
// 管线保持纯函数）；检查列公式：事件类以 'input' 为前缀时回退一列（刚
// 键入字符所在列），否则用列本身。上游仅 Input 类有此检查，Delete/
// SelectKey 为本票对 #9 管线的对称扩展（票面范围，规格记录）。

/** 保护区探针（#27 注入形态）：判定行内列是否落在用户自定义正则保护区内 */
export interface ProtectedZoneProbe {
  readonly isProtected: (lineText: string, column: number) => boolean
}

/** 管线 options 公共形态（#27 起三条管线共用保护区探针位） */
interface PipelineOptions {
  debug?: boolean
  protectedZone?: ProtectedZoneProbe
}

/** 行定位 + 检查列换算 + 探针判定（三条管线共用） */
function isPositionInProtectedZone(
  text: string,
  pos: number,
  userEvent: string,
  probe: ProtectedZoneProbe,
): boolean {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  let lineEnd = text.indexOf('\n', lineStart)
  if (lineEnd === -1) lineEnd = text.length
  const column = pos - lineStart
  const checkColumn = userEvent.startsWith('input') ? Math.max(0, column - 1) : column
  return probe.isProtected(text.slice(lineStart, lineEnd), checkColumn)
}

/** 管线输入面：AddonInputContext 的结构子集（管线只消费这些字段）。
 * replaced 为 #400/#401 新增字段——Input 管线以非 null 判定选区替换形态
//（上游 changedStr.length < 1 同口径），Delete/SelectKey 管线为重建源。 */
export interface RuleInputPipelineContext {
  readonly userEvent: string
  readonly inputText: string
  readonly replaced: { from: number; to: number; text: string } | null
  readonly snapshot: {
    readonly text: string
    readonly selections: ReadonlyArray<{ anchor: number; head: number }>
  }
}

/** 行为链修饰计划（对齐 AddonBehaviorInputPlan 的核心两件套；changes
 * 形状兼容 SerChange——length 恒显式携带） */
export interface RuleInputBehaviorPlan {
  changes: Array<{ offset: number; length: number; text: string }>
  selection: { anchor: number; head: number }
}

/** 计划 + 引擎 tabstop 组的伴随形态（Delete/SelectKey 管线返回值） */
export interface RulePlanWithTabstops {
  plan: RuleInputBehaviorPlan
  tabstops: readonly TabstopSpec[]
}

/** Input 类触发面：普通键入 + IME 定稿（delete.* 归 Delete 管线） */
export function pipelineConsumesUserEvent(userEvent: string): boolean {
  return userEvent === 'input.type' || userEvent === 'input.type.compose'
}

/**
 * 单次输入的规则修饰计划：无命中返回 null（行为链照常，链上后续/平台
 * 原生不受影响）。纯函数——多族/多次调用间无共享状态，#6/#26 可无侵入
 * 包裹。
 */
export function planInputRuleModification(
  engine: RuleEngine,
  ctx: RuleInputPipelineContext,
  options: PipelineOptions = {},
): RuleInputBehaviorPlan | null {
  return planInputRuleWithTabstops(engine, ctx, options)?.plan ?? null
}

/**
 * planInputRuleModification 的伴随形态：计划与引擎产出的 tabstop 组一并
 * 返回（#15 导航态激活的数据源——行为链 onInput 暂存 tabstops，页面装配层
 * 在计划应用后喂 tabstopNav.activateTabstops；tabstops 为 applyReplacement
 * 后文档绝对坐标，与平台应用计划后的文档一致，可直接使用）。
 */
export function planInputRuleWithTabstops(
  engine: RuleEngine,
  ctx: RuleInputPipelineContext,
  options: PipelineOptions = {},
): { plan: RuleInputBehaviorPlan; tabstops: readonly TabstopSpec[] } | null {
  if (!pipelineConsumesUserEvent(ctx.userEvent)) return null
  // 选区替换形态（replaced 非空）不进 Input 管线：上游输入路径要求
  // changedStr.length < 1（updateListener 门），选区替换事务只由
  // transactionFilter 的 SelectKey 分支处理——命中与否都不再落入 Input
  // 规则。若放行，替换后快照光标已塌缩，autopair 类会基于残缺上下文
  // 命中并占用独占组，把 SelectKey 管线堵在链外（且被替换内容已丢失）。
  if (ctx.replaced !== null) return null
  const first = ctx.snapshot.selections[0]
  if (first === undefined) return null
  const from = Math.min(first.anchor, first.head)
  const to = Math.max(first.anchor, first.head)
  if (from !== to) return null // 非塌缩选区：Input 类不处理（包裹归 SelectKey）
  if (from > ctx.snapshot.text.length) return null // 防御：越界坐标不进引擎

  const scope = detectScopeFromText(ctx.snapshot.text, from)
  // #27 保护区（上游 triggerCvtRule 同位判定）：检查列回退一列（input.*）
  if (
    options.protectedZone !== undefined &&
    isPositionInProtectedZone(ctx.snapshot.text, from, ctx.userEvent, options.protectedZone)
  ) {
    return null
  }
  const tx: TxContext = {
    kind: RuleType.Input,
    docText: ctx.snapshot.text,
    selection: { from, to },
    inserted: ctx.inputText,
    changeType: ctx.userEvent,
    scopeHint: scope.scope,
    ...(scope.language !== undefined ? { scopeLanguage: scope.language } : {}),
    ...(options.debug === true ? { debug: true } : {}),
  }
  const result = engine.process(tx)
  if (result === null) return null
  return { plan: applyResultToPlan(result), tabstops: result.tabstops }
}

/**
 * ApplyResult → 行为链计划（matchRange + newText → changes；cursor →
 * selection）。#14 落地 $0 解析后 tabstop 组转多光标选区在此换算（规格
 * 「平台映射」节预留）。
 */
export function applyResultToPlan(result: ApplyResult): RuleInputBehaviorPlan {
  return {
    changes: [
      {
        offset: result.matchRange.from,
        length: result.matchRange.to - result.matchRange.from,
        text: result.newText,
      },
    ],
    selection: { anchor: result.cursor, head: result.cursor },
  }
}

// ===== 工单 #9：Delete / SelectKey 触发管线 =====

/** #400 delete 白名单：delete.backward / forward / selection / cut / line
 *（用户删除意图）；delete.dedent 属缩进命令族，不纳入。与平台
 * liveInstance.ts 的 ADDON_BEHAVIOR_DELETE_USER_EVENTS 同集。 */
const DELETE_USER_EVENTS: ReadonlySet<string> = new Set([
  'delete.backward',
  'delete.forward',
  'delete.selection',
  'delete.cut',
  'delete.line',
])

/** Delete 类触发面：白名单五类（inputText 空串的语义前提另由调用方门控） */
export function pipelineConsumesDeleteEvent(userEvent: string): boolean {
  return DELETE_USER_EVENTS.has(userEvent)
}

/** replaced 的结构子集（平台 AddonReplacedRange） */
interface ReplacedRange {
  readonly from: number
  readonly to: number
  readonly text: string
}

/** 事务前文档 + 事务前光标（Delete 管线的引擎输入态） */
interface PreTransactionState {
  readonly docText: string
  readonly cursor: number
}

/**
 * Delete 事务的事务前重建：被删文本拼回最小包围区间得事务前文档；虚拟
 * 光标按 userEvent 取区间端点（backward 上游 toA 同口径、forward 镜像、
 * 其余三类统一 backward 口径——上游不处理，近似记录于规格）。
 */
function rebuildPreDeleteState(
  ctx: RuleInputPipelineContext,
  replaced: ReplacedRange,
): PreTransactionState {
  const docText =
    ctx.snapshot.text.slice(0, replaced.from) + replaced.text + ctx.snapshot.text.slice(replaced.from)
  const cursor = ctx.userEvent === 'delete.forward' ? replaced.from : replaced.to
  return { docText, cursor }
}

/**
 * 事务前坐标 → 快照坐标换算（Delete 管线）：p ≤ from 不变、p ≥ to 平移
 * 被删长度、区间内钳到 from（引擎产出不应落入被删区间，防御值）。
 * 单调，保证换算后 matchRange 长度非负。
 */
function preOffsetToSnapshot(p: number, replaced: ReplacedRange): number {
  if (p <= replaced.from) return p
  if (p >= replaced.to) return p - (replaced.to - replaced.from)
  return replaced.from
}

/**
 * Delete 类规则修饰计划（上游 cm_extensions.ts delete.backward 分支）：
 * delete 白名单事件 + replaced（被删文本）→ 联动删除计划。
 *
 * 门控：inputText 非空（平台契约 delete 事务为空串）不进、replaced 空
 * 区间不进、多选区（快照选区数 > 1，多区间 replaced 重建不可信）不进。
 * 引擎在事务前坐标上匹配；产出换算回快照坐标落计划。换算后空操作
 *（length 0 且空文本——如 cut 已删尽整对）返回 null：原生删除即终态，
 * 不提交无意义计划。
 */
export function planDeleteRuleModification(
  engine: RuleEngine,
  ctx: RuleInputPipelineContext,
  options: PipelineOptions = {},
): RulePlanWithTabstops | null {
  if (!pipelineConsumesDeleteEvent(ctx.userEvent)) return null
  if (ctx.inputText !== '') return null // delete 事务 inputText 恒空串（平台契约，防御）
  const replaced = ctx.replaced
  if (replaced === null || replaced.from >= replaced.to) return null // 无删除侧
  if (ctx.snapshot.selections.length !== 1) return null // 多区间 replaced 最小包围语义，重建不可信
  const { docText, cursor } = rebuildPreDeleteState(ctx, replaced)
  if (cursor > docText.length) return null // 防御：越界坐标不进引擎

  const scope = detectScopeFromText(docText, cursor)
  // #27 保护区（票面对称扩展；delete.* 检查列不回退）：事务前文档 + 虚拟光标
  if (
    options.protectedZone !== undefined &&
    isPositionInProtectedZone(docText, cursor, ctx.userEvent, options.protectedZone)
  ) {
    return null
  }
  const tx: TxContext = {
    kind: RuleType.Delete,
    docText,
    selection: { from: cursor, to: cursor },
    inserted: '',
    changeType: ctx.userEvent,
    scopeHint: scope.scope,
    ...(scope.language !== undefined ? { scopeLanguage: scope.language } : {}),
    ...(options.debug === true ? { debug: true } : {}),
  }
  const result = engine.process(tx)
  if (result === null) return null

  const from = preOffsetToSnapshot(result.matchRange.from, replaced)
  const to = preOffsetToSnapshot(result.matchRange.to, replaced)
  if (to - from === 0 && result.newText === '') return null // 空操作：原生删除即终态
  const cursorSnapshot = preOffsetToSnapshot(result.cursor, replaced)
  return {
    plan: {
      changes: [{ offset: from, length: to - from, text: result.newText }],
      selection: { anchor: cursorSnapshot, head: cursorSnapshot },
    },
    tabstops: result.tabstops.map((t) => ({
      number: t.number,
      from: preOffsetToSnapshot(t.from, replaced),
      to: preOffsetToSnapshot(t.to, replaced),
    })),
  }
}

/**
 * SelectKey 类规则修饰计划（上游 cm_extensions.ts Selection Replace 分支
 * + rule_engine.ts applySelectKeyRule）：键入替换选区时以 replaced.text
 * 为包裹目标（`${SEL}` 展开的选中文本）、inputText 为触发键。
 *
 * 门控：仅 input.type（IME 定稿 replaced 恒 null——compose 事件天然不进，
 * 平台 #399 边界）；replaced 空区间不进；多选区不进（重建不可信）。
 * 上游对触发键有 `fromB+1===toB` 单字符门（——/…… 例外）——本管线不设
 * 长度门：引擎 triggerKeys 逐字符解析（parseSelectKeyRuleTriggerKeys），
 * 多字符键必然不中任何规则，与上游门控结果等价（规格记录）。
 *
 * 计划替换快照中键入文本占据区；引擎 cursor/tabstops 以 matchRange.from
 * （= replaced.from）为基点、与计划基点一致，直接透传。
 */
export function planSelectKeyRuleModification(
  engine: RuleEngine,
  ctx: RuleInputPipelineContext,
  options: PipelineOptions = {},
): RulePlanWithTabstops | null {
  if (ctx.userEvent !== 'input.type') return null // compose 定稿 replaced 恒 null，天然排除
  const replaced = ctx.replaced
  if (replaced === null || replaced.from >= replaced.to) return null // 纯插入无包裹目标
  if (ctx.inputText.length === 0) return null // 无键入内容（防御）
  if (ctx.snapshot.selections.length !== 1) return null // 多选区：单计划无法忠实表达多区间替换
  // 事务前文档重建：被替换选区内容拼回键入文本之前（单区间精确）
  const docText =
    ctx.snapshot.text.slice(0, replaced.from) +
    replaced.text +
    ctx.snapshot.text.slice(replaced.from + ctx.inputText.length)
  if (replaced.to > docText.length) return null // 防御：越界坐标不进引擎

  const scope = detectScopeFromText(docText, replaced.from)
  // #27 保护区（票面对称扩展；input.type 检查列回退一列）：事务前文档 + 替换起点
  if (
    options.protectedZone !== undefined &&
    isPositionInProtectedZone(docText, replaced.from, ctx.userEvent, options.protectedZone)
  ) {
    return null
  }
  const tx: TxContext = {
    kind: RuleType.SelectKey,
    docText,
    selection: { from: replaced.from, to: replaced.to },
    inserted: ctx.inputText,
    changeType: ctx.userEvent,
    scopeHint: scope.scope,
    ...(scope.language !== undefined ? { scopeLanguage: scope.language } : {}),
    key: ctx.inputText,
    ...(options.debug === true ? { debug: true } : {}),
  }
  const result = engine.process(tx)
  if (result === null) return null
  return {
    plan: {
      changes: [
        { offset: replaced.from, length: ctx.inputText.length, text: result.newText },
      ],
      selection: { anchor: result.cursor, head: result.cursor },
    },
    tabstops: result.tabstops,
  }
}
