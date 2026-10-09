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
import type {
  AddonBehaviorRegistration,
  AddonInputContext,
} from '../types/vendor/shared/addonBehaviors'
import { RuleEngine, type SimpleRule } from './rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from './rules/default-rules'
import { pickMessages, type Messages } from './i18n'
import { debugLog } from './logging'
import { RULE_ERROR_TOPIC, SETTINGS_TOPIC } from './settings/store'
import { planInputRuleModification } from './ruleBehaviorPipeline'

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

/** 五族共用独占组：一条输入至多一族生效（上游首命中语义的平台承载） */
export const INPUT_RULE_EXCLUSIVE_GROUP = 'input-rules'

/** 从内置规则数据解析族表（规则 id 缺失时该条不装载——完整性由契约测试钉住） */
export function resolveRuleFamilies(
  builtin: readonly SimpleRule[] = DEFAULT_BUILTIN_RULES,
): RuleFamilyDefinition[] {
  return RULE_FAMILY_SEEDS.map((seed) => ({
    ...seed,
    rules: builtin.filter((r) => 'id' in r && seed.ruleIds.includes((r as { id: string }).id)),
  }))
}

/** 功能族清单（默认实例；测试可注入替代数据源） */
export const INPUT_RULE_FAMILIES: readonly RuleFamilyDefinition[] = resolveRuleFamilies()

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
  /** 拉新生效值（装载时与每次输入观察时调用） */
  readonly refresh: () => Promise<void>
}

export function createRulePipelineGate(channel: RulePipelineChannelSubset): RulePipelineGate {
  let debugFlag = false
  return {
    debug: () => debugFlag,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      debugFlag = (effective as { debug?: unknown } | null)?.debug === true
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

export function registerRuleInputBehaviors(deps: RegisterRuleBehaviorsDeps): RuleBehaviorRegisterOutcome[] {
  const messages = pickMessages(deps.language)
  const gate = createRulePipelineGate(deps.channel)
  void gate.refresh()
  const reportRuleError = createRuleErrorReporter(deps.channel, { now: deps.now })

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
      onInput: (ctx: AddonInputContext) =>
        planInputRuleModification(
          engine,
          {
            userEvent: ctx.userEvent,
            inputText: ctx.inputText,
            snapshot: { text: ctx.snapshot.text, selections: ctx.snapshot.selections },
          },
          { debug: gate.debug() },
        ),
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
  return outcome
}
