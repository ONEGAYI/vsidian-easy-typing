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
// （input.type.compose）的信息不在此丢失——#6 核验结论：平台保证定稿
// 单发（事务路径双重门与 compositionend 补发路径物理分离），插件侧
// 无需去重（管线纯函数形态即前提，结论与防御测试见规格「#6 compose
// 去重核验」节）；#26 格式化管线从同一入口形状挂接。
//
// 【选区语义】快照 selections 不含主选区标记（平台 AddonEditorSnapshot
// 不携带 mainIndex）：#47 B 方向起 Input 管线对**每个塌缩 range 分别**
// 构造 TxContext 评估（上游为单选区设计，asSingle().main 收窄不再追随
// ——B2 声明随多 range 语义修订）。逐 range 独立命中/不命中：命中的
// range 各产生一条 change，未命中的 range 无 change、其选区由回设数组
// 经 changes 映射保持。计划 selection 形态与平台 #498 通道同源：单选区
// 快照 → 单对象（旧形态）；多选区快照 → 数组逐 range 回设（mainIndex
// 恒 0 = 首 range 为主，未命中与非塌缩 range 一并保留）。Input 类仅处理
// 塌缩选区（上游 notSelected 同口径；选区替换形态归 SelectKey 管线）。
// 紧邻光标的匹配区间重叠时后 range 放弃修饰（ChangeSet 不允许重叠）。
// Delete/SelectKey 管线不演进：多选区门（selections.length !== 1 →
// null）保留——replaced 按 range 重建需新平台能力，另票跟踪。
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
// 事务前坐标，落计划前换算回快照坐标（preOffsetToSnapshot）；作用域判定
// 例外——打实时快照文档的换算位置（#37，见 resolveScopeForEngine 坐标
// 口径节）。
//
// 【SelectKey 包裹目标】键入替换选区时包裹目标从 replaced 读回（#401：
// 按键插入发生在选区销毁之后）。计划替换快照中键入字符占据区
// [replaced.from, replaced.from + inputText.length)；引擎 cursor/tabstops
// 以 matchRange.from（= replaced.from）为基点，与计划基点一致，直接可用
//（换算推导见规格「#9 触发接入」节）。IME 定稿（input.type.compose）
// 替换侧自平台 #593 起经组合期净变更推导携带——compose 与 input.type
// 双形态进 SelectKey 管线（上游 Selection Replace 分支同门）；纯塌缩与
// 迟入组合的 replaced 仍为 null，天然不进，边界用例钉住。
import {
  RuleEngine,
  RuleType,
  type ApplyResult,
  type TabstopSpec,
  type TxContext,
} from './rules/rule-engine'

// intercept 层经本模块取 tabstop 类型（单一来源，避免多点直连引擎内部）
export type { TabstopSpec } from './rules/rule-engine'
import { RuleScope } from './rules/rule-engine'
import { detectScopeViaQuery, docOfText, type ScopeInfo, type SyntaxQuery } from './syntaxTreeQuery'

// ===== 作用域判定的注入（#5 切片 B：树版换传） =====
//
// 同一输入事务被行为链逐族驱动（5 Input 族 + Delete/SelectKey 族 +
// autoformat）。两层优化/口径：
// 1. **All 短路**：族内全部规则作用域含 All 时（内置 20 条全 All），
//    scopeHint 不参与命中判定（引擎 process 的作用域过滤对含 All 规则
//    恒短路、语言过滤也仅在 scopeHint===Code 时才查）——直接传 All，
//    跳过查询。非 All 规则在场（用户规则）时才真实判定。
// 2. **树版判定**：真实判定走 syntaxTreeQuery.detectScopeViaQuery（平台
//    experimental.syntax 位置查询 + 链接区段排除 + codeBlockAtViaQuery 语言
//    提取）；查询经 options.scopeQuery 注入（#5 切片 B，rule-engine 内核
//    零改动——注入缝换传）。非 All 规则在场而查询缺席（语法面缺席/反查
//    失败）→ 不接管返回 null，不 fallback 正则（原 (text,pos) memo 随
//    降级实现一并删除——查询版 µs 级无重复扫描成本，保留只会增加陈旧
//    风险，#5 切片 B 决策）。

/**
 * 作用域判定（带 All 短路）：unscoped 时免查询传 All；返回 null = 不接管
 * ——两个来源：查询缺席（options.scopeQuery undefined，语法面缺席/反查
 * 失败）与查询拒绝（detectScopeViaQuery ok:false——view-disposed 竞态等；
 * 评审 P3：拒绝不静默归 Text 施加规则修饰，spec §二拒绝口径）。
 *
 * 坐标口径（#37 修复，原评审 R2-A1 近似落档）：判定发生在平台实时
 * （事务后）文档的换算位置上——三条管线统一传 ctx.snapshot.text +
 * 快照坐标（Input 传快照光标本值；Delete 传虚拟光标经 preOffsetToSnapshot
 * 换算的值，五类 delete 事件统一落在 replaced.from；SelectKey 传
 * replaced.from，p ≤ from 恒等的换算不动点）。查询坐标与判定文档自洽，
 * 越界 pos 从此不再发出（换算输出 ≤ 实时长度恒成立）——「越界 pos 的
 * 平台查询行为未声明」的未知数随之从关键路径移除。与事务前实况仍可能
 * 分叉（删除区两侧环境不同的极端形态）：平台查询面只在实时文档上执行，
 * 此为既定口径而非错位；方向二「以事务前快照构造判定文档后映射回」
 * 不可施（无任意文档查询 API，正则 fallback 违背 #5 切片 B 决策），详见
 * docs/specs/rule-engine.md「事务前重建与坐标换算」节。
 */
function resolveScopeForEngine(
  engine: RuleEngine,
  text: string,
  options: PipelineOptions,
  pos: number,
): ScopeInfo | null {
  if (engine.allRulesUnscoped()) return { scope: RuleScope.All }
  const query = options.scopeQuery
  if (query === undefined) return null // 非 All 规则在场而查询缺席：不接管
  // docOfText 带单槽缓存（评审 R2-B4）：行为链同驱动多族对同一快照文本
  // 重复构造行文档的成本收敛为一次
  return detectScopeViaQuery(docOfText(text), query, pos)
}

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
  /** #5 树版作用域查询源：非 All 规则在场时必得（缺席 = 不接管） */
  scopeQuery?: SyntaxQuery
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
 * 形状兼容 SerChange——length 恒显式携带）。selection 双形态与平台
 * #498 通道同源：单选区快照 → 单对象（旧形态，既有消费零迁移）；
 * 多选区快照 → 数组逐 range 回设（mainIndex 恒 0 = 首 range 为主）。 */
export interface RuleInputBehaviorPlan {
  changes: Array<{ offset: number; length: number; text: string }>
  selection: { anchor: number; head: number } | Array<{ anchor: number; head: number }>
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
 *
 * per-range 合成（#47 B 方向）：多 range 命中时 tabstops 为各组拼接——
 * 后方 range 的组坐标按前方 changes 长度差平移；同号并组即多光标同步
 * 编辑单元（tabstopGroup 既有语义，激活面零改动）。
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
  const selections = ctx.snapshot.selections
  if (selections.length === 0) return null
  // 防御：任一选区坐标越界即快照自相矛盾——整体不接管（多 range 下
  // selection 数组须覆盖全部 range，携带越界坐标必被平台拒绝，跳过单个
  // range 则丢其光标；坏数据不做修饰）。
  for (const sel of selections) {
    if (Math.max(sel.anchor, sel.head) > ctx.snapshot.text.length) return null
  }
  // 防御（审查 A-F3）：快照选区须按位置升序（平台契约）——乱序快照下
  // change 升序与 selection 对位双双失效，与越界同口径整体不接管。同位
  // 重复零宽光标（接触放行）双双命中零宽匹配时可产出同 offset 零宽
  // change——平台正常操作不产出重复光标，不构成可达路径，不另设门。
  for (let i = 1; i < selections.length; i++) {
    const prev = selections[i - 1]!
    const cur = selections[i]!
    if (Math.min(cur.anchor, cur.head) < Math.max(prev.anchor, prev.head)) return null
  }

  // per-range 评估（#47 B 方向）：每个塌缩 range 独立构造 TxContext 跑
  // 引擎；非塌缩 range 跳过（Input 类只处理塌缩选区，包裹归 SelectKey），
  // 其选区经 changes 映射保留。作用域/保护区逐 range 判定。
  const hits: PerRangeHit[] = []
  for (let rangeIndex = 0; rangeIndex < selections.length; rangeIndex++) {
    const sel = selections[rangeIndex]!
    const from = Math.min(sel.anchor, sel.head)
    const to = Math.max(sel.anchor, sel.head)
    if (from !== to) continue // 非塌缩：不评估，选区进回设数组
    const scope = resolveScopeForEngine(engine, ctx.snapshot.text, options, from)
    if (scope === null) continue // 查询缺席/查询拒绝（评审 P3）：该 range 不修饰
    // #27 保护区（上游 triggerCvtRule 同位判定）：检查列回退一列（input.*）
    if (
      options.protectedZone !== undefined &&
      isPositionInProtectedZone(ctx.snapshot.text, from, ctx.userEvent, options.protectedZone)
    ) {
      continue
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
    if (result === null) continue // 该 range 未命中：无 change，光标映射保留
    // change 区间重叠防御：per-range 引擎在各自 leftDoc 上匹配，紧邻光标
    // 下后 range 的 matchRange 可与前 change 重叠——ChangeSet 不允许重叠
    // 区间，后者放弃修饰（按未命中处理，光标经映射保留）。matchRange 含
    // 右侧匹配延伸（trigger_right），与前一命中比 changeEnd 而非光标。
    const prev = hits[hits.length - 1]
    if (prev !== undefined && result.matchRange.from < prev.changeEnd) continue
    // 吞并防御（审查 A-F1/B-F2 修复）：matchRange 不允许吞掉**其他 range**
    // 的光标/选区——CM6 选区不重叠只约束 ranges 彼此，不约束 change 区
    // 间；长回退规则（用户多字符 trigger）可把前方未命中光标吞进替换区
    // 间，映射夹取会产生乱序 selection（EditorSelection.create 要求升
    // 序，违反即平台事务整体失败）。端点接触（range 恰在 matchRange 端
    // 点）不触发：正常映射分支保持有序。零宽塌缩光标即「严格内部」。
    let swallowsOtherRange = false
    for (let other = 0; other < selections.length; other++) {
      if (other === rangeIndex) continue
      const o = selections[other]!
      const oFrom = Math.min(o.anchor, o.head)
      const oTo = Math.max(o.anchor, o.head)
      if (result.matchRange.from < oTo && oFrom < result.matchRange.to) {
        swallowsOtherRange = true
        break
      }
    }
    if (swallowsOtherRange) continue
    hits.push({
      rangeIndex,
      cursor: result.cursor,
      change: {
        offset: result.matchRange.from,
        length: result.matchRange.to - result.matchRange.from,
        text: result.newText,
      },
      changeEnd: result.matchRange.to,
      tabstops: result.tabstops,
    })
  }
  if (hits.length === 0) return null
  return { plan: synthesizePlan(ctx, hits), tabstops: synthesizeTabstops(hits) }
}

/** per-range 命中条目（评估收集 → 计划合成的中间形态） */
interface PerRangeHit {
  /** 快照 range 下标（selection 数组对位用；命中序 = hits 数组下标） */
  readonly rangeIndex: number
  /** 引擎 cursor：本 change 替换后形态的快照坐标 */
  readonly cursor: number
  readonly change: { offset: number; length: number; text: string }
  /** 本 change 快照区间末端（重叠防御基准） */
  readonly changeEnd: number
  readonly tabstops: readonly TabstopSpec[]
}

/** 前方 changes 长度差累计：命中 cursor / tabstop 已是本 change 替换后
 * 形态，只平移**前方**（rangeIndex 个）change 的 delta。 */
function shiftByPreceding(pos: number, hits: readonly PerRangeHit[], ownIndex: number): number {
  let shifted = pos
  for (let i = 0; i < ownIndex; i++) {
    const c = hits[i]!.change
    shifted += c.text.length - c.length
  }
  return shifted
}

/** 未命中/非塌缩 range 的选区坐标经**全部** changes 映射：p ≤ change 起点
 * 不变、p ≥ 末端平移、区间内按替换后末端防御夹取。区间内分支正常不可
 * 达——前提是吞并防御（收集阶段保证 change 不覆盖其他 range 的选区，
 * CM6 选区不重叠只约束 ranges 彼此、不约束 change 区间，须显式防御）；
 * 保留夹取作为该防御失效时的兜底（宁选区错位不产出越界坐标）。changes
 * 按 offset 升序，可线性累计。 */
function mapPosThroughChanges(pos: number, hits: readonly PerRangeHit[]): number {
  let mapped = pos
  for (const hit of hits) {
    const c = hit.change
    if (pos <= c.offset) break // 后方 changes 更远，不再影响
    if (pos >= c.offset + c.length) {
      mapped += c.text.length - c.length
    } else {
      mapped = c.offset + c.text.length // 防御：夹到替换后末端
      break
    }
  }
  return mapped
}

/** 计划合成：changes 逐命中拼接；selection 按快照选区数取形态（单选区
 * → 单对象，多选区 → 数组逐 range 回设，顺序保持快照 range 原序）。 */
function synthesizePlan(
  ctx: RuleInputPipelineContext,
  hits: readonly PerRangeHit[],
): RuleInputBehaviorPlan {
  const changes = hits.map((h) => ({ ...h.change }))
  if (ctx.snapshot.selections.length === 1) {
    // 唯一 range 且已命中（无命中早返回 null）
    return { changes, selection: { anchor: hits[0]!.cursor, head: hits[0]!.cursor } }
  }
  const selection = ctx.snapshot.selections.map((sel, index) => {
    const hitIndex = hits.findIndex((h) => h.rangeIndex === index)
    if (hitIndex >= 0) {
      const cursor = shiftByPreceding(hits[hitIndex]!.cursor, hits, hitIndex)
      return { anchor: cursor, head: cursor }
    }
    return { anchor: mapPosThroughChanges(sel.anchor, hits), head: mapPosThroughChanges(sel.head, hits) }
  })
  return { changes, selection }
}

/** tabstops 合成：per-range 组拼接 + 前方 delta 平移（同号并组归
 * tabstopNav 激活面，坐标为应用后文档绝对坐标——与计划 selection 同基准）。 */
function synthesizeTabstops(hits: readonly PerRangeHit[]): readonly TabstopSpec[] {
  const out: TabstopSpec[] = []
  hits.forEach((hit, index) => {
    for (const t of hit.tabstops) {
      out.push({ number: t.number, from: shiftByPreceding(t.from, hits, index), to: shiftByPreceding(t.to, hits, index) })
    }
  })
  return out
}

/**
 * ApplyResult → 行为链计划（matchRange + newText → changes；cursor →
 * selection）的单命中换算语义（公开钉子：#25 时代为管线主体，#47 B 方向
 * 起 Input 管线改 per-range 合成（synthesizePlan，含多 range 平移），
 * 本函数保留单命中形态的换算口径——单选区命中路径与之等价）。
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
 * 引擎在事务前坐标上匹配；产出换算回快照坐标落计划；作用域判定打实时
 * 快照文档的换算位置（#37，见 resolveScopeForEngine 坐标口径节）。换算
 * 后空操作（length 0 且空文本——如 cut 已删尽整对）返回 null：原生删除
 * 即终态，不提交无意义计划。
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

  const scope = resolveScopeForEngine(
    engine,
    ctx.snapshot.text,
    options,
    preOffsetToSnapshot(cursor, replaced),
  )
  if (scope === null) return null // 查询缺席/查询拒绝（评审 P3）：不接管
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
 * 门控：input.type 与 input.type.compose 双形态（上游 Selection Replace
 * 分支同门，cm_extensions.ts L62-67；IME 定稿替换侧自平台 #593 起经组合
 * 期净变更推导携带）；replaced 空区间不进（纯塌缩与迟入组合的 compose
 * 定稿 replaced 为 null，天然不进）；多选区不进（重建不可信）。
 * 上游对触发键有 `fromB+1===toB` 单字符门（——/…… 例外）——本管线不设
 * 长度门：引擎 triggerKeys 逐字符解析（parseSelectKeyRuleTriggerKeys），
 * 多字符键必然不中任何规则，与上游门控结果等价（规格记录）。
 *
 * 作用域判定打实时快照文档的 replaced.from（#37 换算不动点，见
 * resolveScopeForEngine 坐标口径节）——引擎 TxContext 与保护区判定仍用
 * 事务前重建文档。
 *
 * 计划替换快照中键入文本占据区；引擎 cursor/tabstops 以 matchRange.from
 * （= replaced.from）为基点、与计划基点一致，直接透传。
 */
export function planSelectKeyRuleModification(
  engine: RuleEngine,
  ctx: RuleInputPipelineContext,
  options: PipelineOptions = {},
): RulePlanWithTabstops | null {
  if (ctx.userEvent !== 'input.type' && ctx.userEvent !== 'input.type.compose') return null // 上游双形态门（#64）：compose 定稿替换侧自平台 #593 起可达
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

  const scope = resolveScopeForEngine(engine, ctx.snapshot.text, options, replaced.from)
  if (scope === null) return null // 查询缺席/查询拒绝（评审 P3）：不接管
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
