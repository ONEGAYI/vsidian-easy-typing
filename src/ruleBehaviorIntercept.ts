// 行为链接入层（工单 #25）：把 #1 规则内核的 Input 类内置规则按**功能族**
// 注册为平台行为链节点（sdk.behaviors 稳定 API）。
//
// 【族模型与分族依据】上游 triggerCvtRule 单次 process 即全局首命中；平台
// 行为链语义是「按有效序每行为各试、计划逐个提交、后续行为读前序修饰
// 结果」。跨族的首命中语义经**同组件独占组**承载：五族共用一个
// exclusiveGroup，平台按有效序首个返回计划者占用、其后同组跳过（vsidian
// addonBehaviors runtime 语义）——等价于上游「一条输入至多一条规则生效」。
// 族内次序仍由引擎的优先级排序保证。分族（而非一条行为装全部规则）的
// 目的：平台行为冲突管理以行为为粒度逐项开关与调序——族即开关粒度。
//
// 【默认链序 = 上游优先级序】平台默认有效序是完整键（addonId#localId）
// 字典序，localId 数值前缀按上游优先级分层编码：01(3) < 02(5,10) <
// 03(10) < 04(15) < 05(50)，用户在平台侧调序即改变跨族优先级（能力而非
// 偏差）。
//
// 【撤销边界：全部 atomic】joinPrevious 的并组目标须为**同链前序 SDK 原子
// 修饰**（宿主协调器 gateSubmit：撤销栈顶须为附加组件条目；用户键入是外
// 来条目，不可并组）。本链首命中即止（独占组），任何规则命中时同链内都
// 不存在前序 SDK 原子修饰——joinPrevious 声明必然被 history-boundary 拒绝
// 且计划被丢弃（功能性失败）。逐条核对结论（20 条 → atomic）记录在
// docs/specs/rule-engine.md「#25 行为链接入」节。
//
// 【设置门】上游规则触发路径无全局总开关（settings_types.ts 全字段核对，
// 规则启停只有 per-rule enabled + 规则管理器）——#3 生效面 23 键中无
// ruleTriggerEnabled 类键，故插件侧不另建总门；内置规则逐条开关 = 平台
// 行为管理的族粒度开关。本层消费设置面仅 debug（引擎 ctx.debug 日志）。
//
// 【#9 接缝】onInput 适配器透传 ctx.replaced：Input 管线对选区替换形态
//（replaced 非空）返回 null（上游 changedStr.length < 1 同口径），把该
// 触发面让给 #9 的 SelectKey 族——见 ruleBehaviorPipeline.ts 头注。
//
// 【规则存储态接入（审查 B-F1 / C-P1-2 修复）】行为族引擎不再静态取出厂
// DEFAULT_BUILTIN_RULES：注册方经 RuleSnapshotSource 注入动态数据源，
// PageRulesClient 装载/重载成功后喂快照 → 族引擎同步重建——用户规则、
// 内置停用（toggleRuleEnabled 写 enabled=false，引擎 process 门控跳过）、
// 外部改写轮询重载对编辑行为即时生效。装载前 / 通道不可用时回落出厂数据
//（兼容存储不可用）。用户规则归族设计（按触发类并入现有对应族）见
// docs/specs/rule-engine.md「用户规则归族与动态重建」节。
import type {
  AddonBehaviorRegistration,
  AddonInputContext,
} from '../types/vendor/shared/addonBehaviors'
import { RuleEngine, RuleType, type SimpleRule } from './rules/rule-engine'
import {
  RULE_DELETE_SELECTKEY_FAMILY_SEEDS,
  RULE_INPUT_FAMILY_SEEDS,
  RETIRED_RULE_FAMILY_BY_ID,
} from './rules/rule-family-ids'
import { DEFAULT_BUILTIN_RULES } from './rules/default-rules'
import { pickMessages, ruleFamilyNameMap, type Messages } from './i18n'
import { debugLog } from './logging'
import { DEFAULT_EFFECTIVE_SETTINGS } from './settings/defaults'
import { RULE_ERROR_TOPIC, SETTINGS_TOPIC } from './settings/store'
import {
  planDeleteRuleModification,
  planInputRuleWithTabstops,
  planSelectKeyRuleModification,
  type ProtectedZoneProbe,
  type TabstopSpec,
} from './ruleBehaviorPipeline'
import { isPositionProtected, parseUserDefinedRegExp, type UserDefinedRegexRule } from './userDefinedRegex'
import type { SyntaxQuery } from './syntaxTreeQuery'
import { createThrottledRefresh } from './throttle'

// 规则错误通知通道 topic（宿主 extension.ts 挂 handler 显示 i18n 警告；
// 定义在 settings/store.ts 的共享常量区，此处 re-export 供页面侧同一来源消费）
export { RULE_ERROR_TOPIC }

/** 行为族 i18n 键（字典 ruleFamilies 节） */
export type RuleFamilyI18nKey = keyof Messages['ruleFamilies']

/** 族种子：localId（数值前缀编码默认链序）+ i18n 键 + 规则 id 集 + 归入
 * 本族的用户规则触发类（Input 族收 Input 类用户规则、06 收 Delete、07 收
 * SelectKey——见 resolveRuleFamilies 归族说明）。数据面（localId/ruleIds/
 * userRuleType）自 src/rules/rule-family-ids.ts 单一事实源（#50 抽取，与
 * 规则页灰态判定共用），本侧只附加 i18n 键。 */
interface RuleFamilySeed {
  readonly localId: string
  readonly i18nKey: RuleFamilyI18nKey
  readonly ruleIds: readonly string[]
  readonly userRuleType: RuleType
}

/** 五 Input 族 i18n 键（localId → 键映射，显式对应优于按下标配对——漏键
 *  时注册名缺失被平台拒绝，测试断言映射键集与种子 localId 集一致） */
export const INPUT_FAMILY_I18N_KEY_BY_LOCAL_ID: Readonly<Record<string, RuleFamilyI18nKey>> = {
  '01-punct-collapse': 'punctCollapse',
  '02-autopair': 'autopair',
  '03-symbol-convert': 'symbolConvert',
  '04-punct-expand': 'punctExpand',
  '05-quote': 'quote',
}

const RULE_FAMILY_SEEDS: readonly RuleFamilySeed[] = RULE_INPUT_FAMILY_SEEDS.map((data) => ({
  ...data,
  i18nKey: INPUT_FAMILY_I18N_KEY_BY_LOCAL_ID[data.localId]!,
}))

/** 族定义（种子 + 解析出的规则数据；rules 含按触发类归入的用户规则） */
export interface RuleFamilyDefinition {
  readonly localId: string
  readonly i18nKey: RuleFamilyI18nKey
  readonly ruleIds: readonly string[]
  readonly rules: readonly SimpleRule[]
}

/** 五族共用独占组：一条输入至多一族生效（上游首命中语义的平台承载）。
 * #9 起 Delete/SelectKey 族共用同组——三类触发面互斥（userEvent / replaced
 * 形态不同），不命中不占用组，同组结构化保住「一条输入至多一条规则」
 * 的上游全局首命中语义（设计核对见规格「#9 触发接入」节）。 */
export const INPUT_RULE_EXCLUSIVE_GROUP = 'input-rules'

/**
 * 从内置规则数据 + 用户规则解析族表：
 * - 内置侧按 seed.ruleIds 过滤（规则 id 缺失时该条不装载——完整性由契约
 *   测试钉住）；
 * - 用户侧按**触发类归族**：Input 类用户规则并入全部五个 Input 族（每族
 *   一份实例）、Delete 类并入 06、SelectKey 类并入 07。归族理由（规格
 *   「用户规则归族与动态重建」节）：并入对应触发类的既有族让用户规则
 *   参与族内优先级竞争，跨族链序 + 族内引擎排序合成上游全局首命中语义
 *   （族序按内置优先级分层编码，用户规则在族内按自身 priority 插入排序
 *   ——如 priority 1 的用户规则排入 01 族后先于内置 fw2hw(3) 试配）。
 *   代价是同一条用户规则在多个族引擎各有一份实例（reportError 重复上报
 *   由全局节流窗收敛；匹配开销 = 每输入事务多族各试一次，规则量级用户
 *   自定义、可接受）。
 * - enabled=false 的规则**保留在装载集**：引擎 process 的 `!rule.enabled`
 *   门控跳过（toggleRuleEnabled 停用即不触发，无需装载侧过滤）。
 */
export function resolveRuleFamilies(
  seeds: readonly RuleFamilySeed[],
  builtin: readonly SimpleRule[] = DEFAULT_BUILTIN_RULES,
  user: readonly SimpleRule[] = [],
): RuleFamilyDefinition[] {
  return seeds.map((seed) => ({
    ...seed,
    rules: [
      ...builtin.filter((r) => {
        if (!('id' in r)) return false
        const id = (r as { id: string }).id
        // 种子 ruleIds（现役）之外，改写的退役副本按退役映射保留执行归属
        // （#56：stripRetiredBuiltins 保留内容有差异的退役条目，而族种子已
        // 删其 id——无此映射时改写副本保留在存储却退出执行链）
        return seed.ruleIds.includes(id) || RETIRED_RULE_FAMILY_BY_ID[id] === seed.localId
      }),
      ...user.filter((r) => RuleEngine.parseOptions(r.options).type === seed.userRuleType),
    ],
  }))
}

/** 功能族清单（默认实例；测试可注入替代数据源） */
export const INPUT_RULE_FAMILIES: readonly RuleFamilyDefinition[] = resolveRuleFamilies(RULE_FAMILY_SEEDS)

/** 族引擎构造：只装载本族规则，reportError 走注入回调（#1 上报缝） */
export function buildFamilyEngine(
  family: RuleFamilyDefinition,
  reportError?: (ruleId: string, message: string) => void,
): RuleEngine {
  const engine = new RuleEngine(reportError === undefined ? {} : { reportError })
  engine.addSimpleRules([...family.rules])
  return engine
}

// ===== 设置门（debug 生效值缓存；对齐 modaIntercept 的通道消费形态） =====

/** 行为注册面的结构子集（真实 AddonBehaviorsFacet 结构兼容） */
export interface RuleBehaviorsFacetSubset {
  register(registration: AddonBehaviorRegistration): { ok: true; key: string } | { ok: false; reason: string }
  onChanged(callback: () => void): () => void
}

/** 通道结构子集（真实 sdk.channel / AddonChannelRegistry.request 兼容） */
export interface RulePipelineChannelSubset {
  request(topic: string, payload: unknown): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }>
}

export interface RulePipelineGate {
  /** 引擎 debug 日志门（通道失败保持上次值；首次返回前为 false） */
  readonly debug: () => boolean
  /** #27「用户规则尊重保护区」探针：UserDefinedRegSwitch 与
   *  UserRulesRespectUserDefinedRegexBlocks 双开时有值（默认关 = undefined）；
   *  通道失败保持上次值 */
  readonly userRulesZone: () => ProtectedZoneProbe | undefined
  /** 拉新生效值（装载时与每次输入观察时调用） */
  readonly refresh: () => Promise<void>
}

/** effective 中 #27 三键的读取面（类型失配回出厂默认） */
interface UserDefinedRegSubset {
  userDefinedRegSwitch?: unknown
  userDefinedRegExp?: unknown
  userRulesRespectUserDefinedRegexBlocks?: unknown
}

/** 双开关 + 规则表 → 探针（undefined = 不启用；上游 rule_processor.ts:22） */
function buildUserRulesZone(effective: UserDefinedRegSubset | null | undefined): ProtectedZoneProbe | undefined {
  const regSwitch =
    typeof effective?.userDefinedRegSwitch === 'boolean'
      ? effective.userDefinedRegSwitch
      : DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegSwitch
  const respect = effective?.userRulesRespectUserDefinedRegexBlocks === true
  if (!regSwitch || !respect) return undefined
  const regExpStr =
    typeof effective?.userDefinedRegExp === 'string'
      ? effective.userDefinedRegExp
      : DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegExp
  const rules: readonly UserDefinedRegexRule[] = parseUserDefinedRegExp(regExpStr)
  return { isProtected: (line, column) => isPositionProtected(line, column, rules) }
}

export function createRulePipelineGate(channel: RulePipelineChannelSubset): RulePipelineGate {
  let debugFlag = false
  let zone: ProtectedZoneProbe | undefined = undefined
  return {
    debug: () => debugFlag,
    userRulesZone: () => zone,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      debugFlag = (effective as { debug?: unknown } | null)?.debug === true
      zone = buildUserRulesZone(effective as UserDefinedRegSubset | null | undefined)
    },
  }
}

// ===== reportError 适配：全局节流 + 宿主通知通道 =====

/** 上报节流窗口（毫秒）：窗口期内仅首条发通道请求，其余 debugLog 留痕。
 * 引擎对运行时异常已按规则 5 秒节流，此处全局窗防御装载期多条规则同时
 * 解析失败的批量轰炸（#17 起函数替换体为预注册引用形态：未知 ref /
 * 签名失配 / 遗留字符串函数体在装载期拒绝并上报；#1 时代 new Function
 * 在 CSP 页面批量编译失败的场景已随该路径删除根治） */
export const RULE_ERROR_NOTIFY_WINDOW_MS = 5000

/** 通道请求失败（released/timeout）静默——上报是尽力而为通道 */
export function createRuleErrorReporter(
  channel: RulePipelineChannelSubset,
  options: { now?: () => number } = {},
): (ruleId: string, message: string) => void {
  const now = options.now ?? Date.now
  let lastNotifyAt = Number.NEGATIVE_INFINITY
  return (ruleId, message) => {
    const at = now()
    if (at - lastNotifyAt < RULE_ERROR_NOTIFY_WINDOW_MS) {
      debugLog('ruleError(throttled)', ruleId, message)
      return
    }
    lastNotifyAt = at
    void channel.request(RULE_ERROR_TOPIC, { ruleId, message }).then(
      () => {},
      () => {},
    )
  }
}

// ===== 注册入口（page-editor 增量块消费） =====

/** 实例一致性守卫（评审 R2-B1）：true = 本次驱动上下文属本组件接管面
 *  （主正文 Live 实例）。平台行为链同样驱动嵌入（embed）Live 实例——其
 *  AddonInputContext 的 snapshot/docUri 是嵌入实例的，而注入的 queryOf 恒
 *  返回主实例查询（活动视图追踪只见主视图），作用域判定会以主文档同偏移
 *  误判嵌入文档（公式/代码内容可能被错误格式化/修饰）。onInput 入口守卫：
 *  不一致 → 该次行为修饰直接放弃（返回 null，与查询拒绝同一「不接管」
 *  语义，不占独占组）。 */
export type InputContextOwnership = (ctx: AddonInputContext) => boolean

/**
 * 驱动上下文与主实例的一致性判定（守卫闭包的比对核，纯函数）：
 * - mainDocUri 可得（页面装配层经 views 面反查主实例 targetDocUri）时走
 *   docUri 同源比对——AddonInputContext.docUri 与实例 views 句柄的
 *   targetDocUri 同源（#407：embed 驱动时是引用目标文档 URI），短串相等
 *   µs 级，优先于全文比对；
 * - mainDocUri 不可得（views/viewIdentity 面缺席——防御深度；或 views.get
 *   未命中实例的销毁竞态窄窗口）时回退快照
 *   全文比对：主实例驱动时 ctx.snapshot.text 与主视图当前文档一致（行为
 *   链同步驱动，快照描述视图现状）；
 * - 两者皆不可得（mainDocText 亦 null = 活动视图缺席）→ false：驱动只可能
 *   来自登记面外实例，一律不接管。
 * 已知边界：自嵌（embed 目标恰为主文档）时 docUri 相等守卫放行——内容
 * 相同，主实例查询的同偏移判定与嵌入实例一致，无误伤面；**区段 embed**
 * （`![[doc#heading]]` 类）若平台 targetDocUri 仍为全文档 URI，嵌入实例
 * 文档是区段子集、同偏移错位且 docUri 比对放行——vendored 类型无区段语
 * 义说明，#21 联调核对（必要时按快照全文比对收严）。
 */
export function inputContextIsMainInstance(
  ctx: AddonInputContext,
  mainDocUri: string | null,
  mainDocText: string | null,
): boolean {
  if (mainDocUri !== null) return ctx.docUri === mainDocUri
  return mainDocText !== null && ctx.snapshot.text === mainDocText
}

/** 动态规则源（审查 B-F1 / C-P1-2 修复）：行为族引擎的存储态数据供给面。
 * page-editor 装配 PageRulesClient 后把本源接到 client 的 onReload——装载
 * /重载成功即 update 喂快照，注册方经 onUpdate 同步重建族引擎。 */
export interface RuleSnapshotSource {
  /** 最近一次成功装载的快照（undefined = 从未装载成功，行为族用出厂数据） */
  snapshot(): { builtin: readonly SimpleRule[]; user: readonly SimpleRule[] } | undefined
  /** 快照变化回调（update 时同步触发；页面级一次性接线，无注销需求） */
  onUpdate(callback: () => void): void
}

/** RuleSnapshotSource 的可写端（page-editor 持有，喂给注册函数的是只读面） */
export interface WritableRuleSnapshotSource extends RuleSnapshotSource {
  /** 装载/重载成功后喂快照（同步触发 onUpdate——族引擎即时重建） */
  update(snapshot: { builtin: readonly SimpleRule[]; user: readonly SimpleRule[] }): void
}

export function createRuleSnapshotSource(): WritableRuleSnapshotSource {
  let current: { builtin: readonly SimpleRule[]; user: readonly SimpleRule[] } | undefined
  const listeners = new Set<() => void>()
  return {
    snapshot: () => current,
    onUpdate: (callback) => {
      listeners.add(callback)
    },
    update: (snapshot) => {
      current = { builtin: [...snapshot.builtin], user: [...snapshot.user] }
      for (const listener of [...listeners]) listener()
    },
  }
}

export interface RegisterRuleBehaviorsDeps {
  /** 行为注册面（sdk.behaviors） */
  readonly behaviors: RuleBehaviorsFacetSubset
  /** 页面通道（reportError 通知 + 设置读取） */
  readonly channel: RulePipelineChannelSubset
  /** 语言标签（i18n 字典选择，页面侧 navigator.language） */
  readonly language: string
  /** 时间源（默认 Date.now；测试注入） */
  readonly now?: () => number
  /** 动态规则源（缺省 = 出厂数据，兼容存储不可用与既有测试形态） */
  readonly rulesSource?: RuleSnapshotSource
  /** #5 语法查询工厂（活动视图 → 查询；行为链 onInput 无视图句柄——查询经
   *  活动视图 instanceId 构造。非 All 规则在场而缺席 → 管线不接管） */
  readonly queryOf?: () => SyntaxQuery | null
  /** 实例一致性守卫（评审 R2-B1；缺省 = 不设防，兼容纯管线测试形态）：
   *  返回 false = 本次驱动来自非主实例（嵌入 Live 等）→ onInput 直接放弃
   *  （返回 null 不占独占组）——快照/查询实例错配的修饰整体不发生 */
  readonly ownsContext?: InputContextOwnership
}

/** 注册结果（逐族；普通 API 拒绝不算故障，经 debugLog 留痕） */
export interface RuleBehaviorRegisterOutcome {
  readonly localId: string
  readonly ok: boolean
  readonly reason?: string
}

/** registerRuleInputBehaviors 的返回：注册结果 + tabstop 暂存通道 */
export interface RuleBehaviorRuntime {
  readonly outcomes: readonly RuleBehaviorRegisterOutcome[]
  /**
   * 取走最近一次命中计划携带的 tabstop 组（#15 导航态激活的数据源）。
   * 读即消费（返回后清空）；无待激活时返回空数组。页面装配层在计划应用
   * 后的 docChanged 事务里调用——坐标为应用后文档绝对坐标，可直接喂
   * tabstopNav.activateTabstops。
   *
   * 消费一致性校验（审查 B-F2 修复）：入参 doc 为消费时点的文档读取面
   *（CM6 Text 结构子集，页面侧传 view.state.doc）。暂存时同记计划变更
   *（changes）；消费时逐条核对文档在 [offset, offset + text.length) 处
   * 已呈现替换体——失配（applyEdit 异步回环窗口内用户键入的事务先到、
   * 或计划被平台 stale-snapshot 拒绝）即丢弃本次 tabstop，不激活导航态。
   * 识别面选型（为何不用事务 origin / snapshot revision）见
   * docs/specs/tabstop.md「给 #25 的接线接口」节。
   */
  readonly consumePendingTabstops: (doc: PendingDocText) => readonly TabstopSpec[]
}

/** 消费时点文档读取面（CM6 Text 的结构子集；webview 全程 LF 坐标） */
export interface PendingDocText {
  sliceString(from: number, to: number): string
}

/** 暂存槽：tabstop 组 + 计划变更（消费一致性校验的比对基准） */
interface PendingTabstopEntry {
  readonly tabstops: readonly TabstopSpec[]
  readonly changes: ReadonlyArray<{ offset: number; length: number; text: string }>
}

/**
 * 暂存条目消费：读即消费 + 一致性校验。计划应用后文档在每条变更的
 * [offset, offset + text.length) 区间应恰为替换体文本——任一失配即丢弃
 *（不激活导航态；下次输入恢复，不视为故障）。校验通过的语义等价于
 * 「本组件计划已确实应用」：计划被拒（stale-snapshot/conflict）或被
 * 无关事务抢先消费时，文档不会呈现该形态。
 *
 * 坐标基准（#52 多命中修复）：changes 暂存的是**快照坐标**，校验打在
 * **应用后**文档上——第 i 条变更的应用后位置 = 快照 offset 加前方变更
 * 长度差累计（多光标 per-range 计划的合成口径，与 synthesizeTabstops
 * 平移同源）；单条变更（#25 以来形态）前方 delta 恒 0，行为不变。
 */
function consumePendingEntry(
  state: { pending: PendingTabstopEntry | null },
  doc: PendingDocText,
): readonly TabstopSpec[] {
  const entry = state.pending
  state.pending = null
  if (entry === null) return []
  // 空文本变更（纯删除计划）区间恒零宽，sliceString(x, x) === '' 天然通过
  let precedingDelta = 0
  let applied = true
  for (const c of entry.changes) {
    const at = c.offset + precedingDelta
    if (doc.sliceString(at, at + c.text.length) !== c.text) {
      applied = false
      break
    }
    precedingDelta += c.text.length - c.length
  }
  return applied ? entry.tabstops : []
}

export function registerRuleInputBehaviors(deps: RegisterRuleBehaviorsDeps): RuleBehaviorRuntime {
  const messages = pickMessages(deps.language)
  const gate = createRulePipelineGate(deps.channel)
  void gate.refresh()
  const reportRuleError = createRuleErrorReporter(deps.channel, { now: deps.now })

  // 独占组保证一次输入至多一族命中——单一暂存槽足够（B-F2 起：暂存时
  // 同记计划变更，消费时按文档形态校验一致性）
  const pendingState = { pending: null as PendingTabstopEntry | null }

  // 族引擎动态重建（存储态接入）：装载/重载喂快照即同步重建；装载前
  //（source 缺省或未装载）用出厂数据——存储不可用时编辑行为不失效
  const engines: RuleEngine[] = RULE_FAMILY_SEEDS.map(() => new RuleEngine())
  const rebuildEngines = (): void => {
    const snap = deps.rulesSource?.snapshot()
    const families = resolveRuleFamilies(RULE_FAMILY_SEEDS, snap?.builtin ?? DEFAULT_BUILTIN_RULES, snap?.user ?? [])
    for (let i = 0; i < families.length; i++) {
      engines[i] = buildFamilyEngine(families[i]!, reportRuleError)
    }
  }
  rebuildEngines()
  deps.rulesSource?.onUpdate(rebuildEngines)

  const outcome: RuleBehaviorRegisterOutcome[] = []
  RULE_FAMILY_SEEDS.forEach((family, familyIndex) => {
    const i18n = messages.ruleFamilies[family.i18nKey]
    const result = deps.behaviors.register({
      id: family.localId,
      name: ruleFamilyNameMap(family.i18nKey),
      description: i18n.desc,
      examples: [...i18n.examples],
      exclusiveGroup: INPUT_RULE_EXCLUSIVE_GROUP,
      history: 'atomic',
      onInput: (ctx: AddonInputContext) => {
        // 实例一致性守卫（评审 R2-B1）：嵌入实例驱动（快照非主实例文档）
        // → 放弃该次行为修饰（null 不占独占组）
        if (deps.ownsContext !== undefined && !deps.ownsContext(ctx)) return null
        const withTabstops = planInputRuleWithTabstops(
          engines[familyIndex]!,
          {
            userEvent: ctx.userEvent,
            inputText: ctx.inputText,
            replaced: ctx.replaced,
            snapshot: { text: ctx.snapshot.text, selections: ctx.snapshot.selections },
          },
          { debug: gate.debug(), protectedZone: gate.userRulesZone(), scopeQuery: deps.queryOf?.() ?? undefined },
        )
        if (withTabstops === null) return null
        if (withTabstops.tabstops.length > 0) {
          pendingState.pending = { tabstops: withTabstops.tabstops, changes: withTabstops.plan.changes }
        }
        return withTabstops.plan
      },
    })
    if (!result.ok) {
      debugLog('rule behavior register rejected:', family.localId, result.reason)
    }
    outcome.push(
      result.ok
        ? { localId: family.localId, ok: true }
        : { localId: family.localId, ok: false, reason: result.reason },
    )
  })

  // 只读观察刷新设置缓存：设置页改 debug 后下一次输入生效（平台 onChanged
  // 每次输入触发，3s 节流窗压缩——C-R4-2，与 vsidian input-behavior 样例同形态）
  deps.behaviors.onChanged(createThrottledRefresh(() => gate.refresh()))
  return {
    outcomes: outcome,
    consumePendingTabstops: (doc: PendingDocText) => consumePendingEntry(pendingState, doc),
  }
}

// ===== 工单 #9：Delete / SelectKey 族注册 =====
//
// 【分族依据】同 #25 三条：开关粒度（平台行为冲突管理以行为为粒度）、
// 触发域（Delete 族同管联动删除、SelectKey 族同管选中包裹）、链序保真
//（localId 数值前缀延续上游优先级分层：Delete 规则 10/30 < SelectKey 40
// —— 排在 01-05 Input 族之后；三类触发面互斥，跨族序无实际仲裁作用，
// 编号仅延续「上游优先级分层编码」的既有约定）。
//
// 【独占组】与 #25 五族共用 'input-rules'：平台语义（addonBehaviors
// runtime）按有效序首个**返回计划**者占用组、返回 null 不占用——Input
// 族对 delete.*（userEvent 门）与选区替换形态（replaced 门）一律 null，
// Delete/SelectKey 族对 input.type 纯插入与 compose 一律 null，三面互斥
// 下同组等价于上游「一条输入至多一条规则生效」的全局首命中语义。
//
// 【撤销】Delete/SelectKey 规则同为用户输入直接触发的单发修饰，无同链
// 前序 SDK 原子修饰可并组——与 #25 结论同口径，一律 atomic（删除联动与
// 选中包裹各自成独立撤回步；真实撤销验证归 #21）。
//
// 【tabstop 暂存】SelectKey 包裹计划携带 ${0:${SEL}} → $0 组覆盖选中文本
//（#15 导航态数据源）。独立暂存槽（与 #25 的槽互不干扰——独占组保证
// 一次输入至多一族命中）；页面装配层以独立 docChanged 监听消费，读即
// 消费语义与 #25 通道一致。

/** #9 Delete/SelectKey 族 i18n 键（同上 localId 映射形态） */
export const DELETE_SELECTKEY_I18N_KEY_BY_LOCAL_ID: Readonly<Record<string, RuleFamilyI18nKey>> = {
  '06-delete-rules': 'deletePair',
  '07-selectkey-rules': 'selectKeyWrap',
}

/** #9 族种子（数据面同上单一事实源；上游优先级 10 配对删除 + 30 联动删除
 *  的 Delete 族与上游优先级 40 选中替换的 SelectKey 族） */
const DELETE_SELECTKEY_FAMILY_SEEDS: readonly RuleFamilySeed[] =
  RULE_DELETE_SELECTKEY_FAMILY_SEEDS.map((data) => ({
    ...data,
    i18nKey: DELETE_SELECTKEY_I18N_KEY_BY_LOCAL_ID[data.localId]!,
  }))

/** #9 功能族清单（默认实例；测试可注入替代数据源） */
export const DELETE_SELECTKEY_RULE_FAMILIES: readonly RuleFamilyDefinition[] =
  resolveRuleFamilies(DELETE_SELECTKEY_FAMILY_SEEDS)

/** 注册 #9 Delete/SelectKey 族（page-editor 增量块消费；deps 形状与
 * registerRuleInputBehaviors 一致，返回形态同构） */
export function registerRuleDeleteSelectKeyBehaviors(deps: RegisterRuleBehaviorsDeps): RuleBehaviorRuntime {
  const messages = pickMessages(deps.language)
  const gate = createRulePipelineGate(deps.channel)
  void gate.refresh()
  const reportRuleError = createRuleErrorReporter(deps.channel, { now: deps.now })

  // 独占组保证一次输入至多一族命中——单一暂存槽足够（B-F2 起带一致性校验）
  const pendingState = { pending: null as PendingTabstopEntry | null }

  // 族引擎动态重建（存储态接入，与 #25 五族同一形态）
  const engines: RuleEngine[] = DELETE_SELECTKEY_FAMILY_SEEDS.map(() => new RuleEngine())
  const rebuildEngines = (): void => {
    const snap = deps.rulesSource?.snapshot()
    const families = resolveRuleFamilies(
      DELETE_SELECTKEY_FAMILY_SEEDS,
      snap?.builtin ?? DEFAULT_BUILTIN_RULES,
      snap?.user ?? [],
    )
    for (let i = 0; i < families.length; i++) {
      engines[i] = buildFamilyEngine(families[i]!, reportRuleError)
    }
  }
  rebuildEngines()
  deps.rulesSource?.onUpdate(rebuildEngines)

  const outcome: RuleBehaviorRegisterOutcome[] = []
  DELETE_SELECTKEY_FAMILY_SEEDS.forEach((family, familyIndex) => {
    const i18n = messages.ruleFamilies[family.i18nKey]
    const result = deps.behaviors.register({
      id: family.localId,
      name: ruleFamilyNameMap(family.i18nKey),
      description: i18n.desc,
      examples: [...i18n.examples],
      exclusiveGroup: INPUT_RULE_EXCLUSIVE_GROUP,
      history: 'atomic',
      onInput: (ctx: AddonInputContext) => {
        // 实例一致性守卫（评审 R2-B1）：嵌入实例驱动（快照非主实例文档）
        // → 放弃该次行为修饰（null 不占独占组）
        if (deps.ownsContext !== undefined && !deps.ownsContext(ctx)) return null
        // Delete 族只面对 delete.* 事件；SelectKey 族只面对 input.type
        // 选区替换——两条管线对不属己方的触发面返回 null，不占用独占组
        const pipelineCtx = {
          userEvent: ctx.userEvent,
          inputText: ctx.inputText,
          replaced: ctx.replaced,
          snapshot: { text: ctx.snapshot.text, selections: ctx.snapshot.selections },
        }
        const deleteResult = planDeleteRuleModification(engines[familyIndex]!, pipelineCtx, {
          debug: gate.debug(),
          protectedZone: gate.userRulesZone(),
          scopeQuery: deps.queryOf?.() ?? undefined,
        })
        if (deleteResult !== null) {
          if (deleteResult.tabstops.length > 0) {
            pendingState.pending = { tabstops: deleteResult.tabstops, changes: deleteResult.plan.changes }
          }
          return deleteResult.plan
        }
        const selectKeyResult = planSelectKeyRuleModification(engines[familyIndex]!, pipelineCtx, {
          debug: gate.debug(),
          protectedZone: gate.userRulesZone(),
          scopeQuery: deps.queryOf?.() ?? undefined,
        })
        if (selectKeyResult !== null) {
          if (selectKeyResult.tabstops.length > 0) {
            pendingState.pending = { tabstops: selectKeyResult.tabstops, changes: selectKeyResult.plan.changes }
          }
          return selectKeyResult.plan
        }
        return null
      },
    })
    if (!result.ok) {
      debugLog('rule behavior register rejected:', family.localId, result.reason)
    }
    outcome.push(
      result.ok
        ? { localId: family.localId, ok: true }
        : { localId: family.localId, ok: false, reason: result.reason },
    )
  })

  deps.behaviors.onChanged(createThrottledRefresh(() => gate.refresh()))
  return {
    outcomes: outcome,
    consumePendingTabstops: (doc: PendingDocText) => consumePendingEntry(pendingState, doc),
  }
}
