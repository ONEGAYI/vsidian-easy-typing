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
import type {
  AddonBehaviorRegistration,
  AddonInputContext,
} from '../types/vendor/shared/addonBehaviors'
import { RuleEngine, type SimpleRule } from './rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from './rules/default-rules'
import { pickMessages, type Messages } from './i18n'
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

// 规则错误通知通道 topic（宿主 extension.ts 挂 handler 显示 i18n 警告；
// 定义在 settings/store.ts 的共享常量区，此处 re-export 供页面侧同一来源消费）
export { RULE_ERROR_TOPIC }

/** 行为族 i18n 键（字典 ruleFamilies 节） */
export type RuleFamilyI18nKey = keyof Messages['ruleFamilies']

/** 族种子：localId（数值前缀编码默认链序）+ i18n 键 + 规则 id 集 */
interface RuleFamilySeed {
  readonly localId: string
  readonly i18nKey: RuleFamilyI18nKey
  readonly ruleIds: readonly string[]
}

const RULE_FAMILY_SEEDS: readonly RuleFamilySeed[] = [
  // 上游优先级 3：连续全角标点转半角
  { localId: '01-punct-collapse', i18nKey: 'punctCollapse', ruleIds: ['builtin-fw2hw-double'] },
  // 上游优先级 5 + 10：配对跳过 + 配对补全（同族：同一触发域，族内按引擎优先级）
  { localId: '02-autopair', i18nKey: 'autopair', ruleIds: ['builtin-autopair-jump', 'builtin-autopair-input'] },
  // 上游优先级 10：·· 转行内代码 / `· 升级代码块 / ￥$ 转公式 / 行首 》、 转换
  {
    localId: '03-symbol-convert',
    i18nKey: 'symbolConvert',
    ruleIds: ['builtin-conv-backtick', 'builtin-conv-codeblock', 'builtin-conv-formula', 'builtin-conv-linestart'],
  },
  // 上游优先级 15：CJK 后半角标点转全角（上游数据默认关——enabled 字段留引擎数据态）
  { localId: '04-punct-expand', i18nKey: 'punctExpand', ruleIds: ['builtin-conv-hw2fw'] },
  // 上游优先级 50：引用标记转换与补空格
  { localId: '05-quote', i18nKey: 'quote', ruleIds: ['builtin-quote-convert', 'builtin-quote-space'] },
]

/** 族定义（种子 + 解析出的规则数据） */
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

/** 从内置规则数据解析族表（规则 id 缺失时该条不装载——完整性由契约测试钉住） */
export function resolveRuleFamilies(
  seeds: readonly RuleFamilySeed[],
  builtin: readonly SimpleRule[] = DEFAULT_BUILTIN_RULES,
): RuleFamilyDefinition[] {
  return seeds.map((seed) => ({
    ...seed,
    rules: builtin.filter((r) => 'id' in r && seed.ruleIds.includes((r as { id: string }).id)),
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
 * 引擎对运行时异常已按规则 5 秒节流，此处全局窗防御 CSP 环境下装载期
 * 多条函数体规则同时编译失败的批量轰炸（#405 定案：webview 不放行
 * unsafe-eval，函数体规则在真实页面编译失败——按 #1 现状跳过并上报） */
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

export interface RegisterRuleBehaviorsDeps {
  /** 行为注册面（sdk.behaviors） */
  readonly behaviors: RuleBehaviorsFacetSubset
  /** 页面通道（reportError 通知 + 设置读取） */
  readonly channel: RulePipelineChannelSubset
  /** 语言标签（i18n 字典选择，页面侧 navigator.language） */
  readonly language: string
  /** 时间源（默认 Date.now；测试注入） */
  readonly now?: () => number
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
   */
  readonly consumePendingTabstops: () => readonly TabstopSpec[]
}

export function registerRuleInputBehaviors(deps: RegisterRuleBehaviorsDeps): RuleBehaviorRuntime {
  const messages = pickMessages(deps.language)
  const gate = createRulePipelineGate(deps.channel)
  void gate.refresh()
  const reportRuleError = createRuleErrorReporter(deps.channel, { now: deps.now })

  // 独占组保证一次输入至多一族命中——单一暂存槽足够
  let pendingTabstops: readonly TabstopSpec[] = []

  const outcome: RuleBehaviorRegisterOutcome[] = []
  for (const family of INPUT_RULE_FAMILIES) {
    const engine = buildFamilyEngine(family, reportRuleError)
    const i18n = messages.ruleFamilies[family.i18nKey]
    const result = deps.behaviors.register({
      id: family.localId,
      name: i18n.name,
      description: i18n.desc,
      examples: [...i18n.examples],
      exclusiveGroup: INPUT_RULE_EXCLUSIVE_GROUP,
      history: 'atomic',
      onInput: (ctx: AddonInputContext) => {
        const withTabstops = planInputRuleWithTabstops(
          engine,
          {
            userEvent: ctx.userEvent,
            inputText: ctx.inputText,
            replaced: ctx.replaced,
            snapshot: { text: ctx.snapshot.text, selections: ctx.snapshot.selections },
          },
          { debug: gate.debug(), protectedZone: gate.userRulesZone() },
        )
        if (withTabstops === null) return null
        if (withTabstops.tabstops.length > 0) {
          pendingTabstops = withTabstops.tabstops
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
  }

  // 只读观察刷新设置缓存：设置页改 debug 后下一次输入即生效（平台 onChanged
  // 每次输入触发——与 vsidian input-behavior 样例同形态）
  deps.behaviors.onChanged(() => {
    void gate.refresh()
  })
  return {
    outcomes: outcome,
    consumePendingTabstops: () => {
      const pending = pendingTabstops
      pendingTabstops = []
      return pending
    },
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

/** #9 族种子：Delete 族（上游优先级 10 配对删除 + 30 联动删除）与
 * SelectKey 族（上游优先级 40 选中替换） */
const DELETE_SELECTKEY_FAMILY_SEEDS: readonly RuleFamilySeed[] = [
  // 上游优先级 10（autopair-delete）+ 30（五条联动删除）：删除成对结构一端时联动删除
  {
    localId: '06-delete-rules',
    i18nKey: 'deletePair',
    ruleIds: [
      'builtin-autopair-delete',
      'builtin-del-inline-formula',
      'builtin-del-highlight',
      'builtin-del-block-formula',
      'builtin-del-codeblock',
      'builtin-del-wikilink',
    ],
  },
  // 上游优先级 40：选中文本后按键包裹
  {
    localId: '07-selectkey-rules',
    i18nKey: 'selectKeyWrap',
    ruleIds: [
      'builtin-sel-wrap-backtick',
      'builtin-sel-wrap-symbols',
      'builtin-sel-wrap-quotes',
      'builtin-sel-wrap-cjk-brackets',
    ],
  },
]

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

  // 独占组保证一次输入至多一族命中——单一暂存槽足够
  let pendingTabstops: readonly TabstopSpec[] = []

  const outcome: RuleBehaviorRegisterOutcome[] = []
  for (const family of DELETE_SELECTKEY_RULE_FAMILIES) {
    const engine = buildFamilyEngine(family, reportRuleError)
    const i18n = messages.ruleFamilies[family.i18nKey]
    const result = deps.behaviors.register({
      id: family.localId,
      name: i18n.name,
      description: i18n.desc,
      examples: [...i18n.examples],
      exclusiveGroup: INPUT_RULE_EXCLUSIVE_GROUP,
      history: 'atomic',
      onInput: (ctx: AddonInputContext) => {
        // Delete 族只面对 delete.* 事件；SelectKey 族只面对 input.type
        // 选区替换——两条管线对不属己方的触发面返回 null，不占用独占组
        const pipelineCtx = {
          userEvent: ctx.userEvent,
          inputText: ctx.inputText,
          replaced: ctx.replaced,
          snapshot: { text: ctx.snapshot.text, selections: ctx.snapshot.selections },
        }
        const deleteResult = planDeleteRuleModification(engine, pipelineCtx, {
          debug: gate.debug(),
          protectedZone: gate.userRulesZone(),
        })
        if (deleteResult !== null) {
          if (deleteResult.tabstops.length > 0) pendingTabstops = deleteResult.tabstops
          return deleteResult.plan
        }
        const selectKeyResult = planSelectKeyRuleModification(engine, pipelineCtx, {
          debug: gate.debug(),
          protectedZone: gate.userRulesZone(),
        })
        if (selectKeyResult !== null) {
          if (selectKeyResult.tabstops.length > 0) pendingTabstops = selectKeyResult.tabstops
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
  }

  deps.behaviors.onChanged(() => {
    void gate.refresh()
  })
  return {
    outcomes: outcome,
    consumePendingTabstops: () => {
      const pending = pendingTabstops
      pendingTabstops = []
      return pending
    },
  }
}
