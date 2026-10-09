// 自动格式化行为族接入（工单 #26）：把 src/autoFormatPipeline.ts 注册为
// 平台行为链节点（sdk.behaviors 稳定 API），复用 #25 的注册形态。
//
// 【族形态】单族 `06-autoformat`（localId 数值前缀在 #25 五族（01-05）之后，
// 平台默认有效序 = 完整键字典序）：加入 #25 五族共用的独占组
// `input-rules`——平台按有效序首个返回计划者占用组，复刻上游
// tryProcessInput 的链序语义「规则引擎命中即短路格式化」（上游
// triggerCvtRule 返回 true 时 return，格式化只在规则零命中后运行；#
// 25 集成测试钉住的「中文后键入半角字母规则面零命中」空位由本族承接）。
// 用户侧开关粒度：族级开关 = 上游 AutoFormat 总门的平台承载（设置键
// autoFormat 在族回调内判定，关 → 恒 null 不占组、五族不受影响）；
// autoCapital 等细粒度经 #3 设置门面生效。
//
// 【撤销边界】atomic——键入是外来条目不可并组（#25 全量核对结论，
// joinPrevious 声明必被 history-boundary 拒绝且计划丢弃）；上游 CM6
// 时间窗分组下「键入 + 格式化」一步撤回的平台等价物为两步撤回，
// #21 人工验证按两步口径核对。
//
// 【设置消费】#3 门面 effective（SETTINGS_TOPIC.get）拉取 9 键
//（autoFormat / autoCapital / prefixDictionary / softSpaceLeft·RightSymbols /
// inlineCode·Formula·LinkSpaceMode / inlineLinkSmartSpace），装载时与每次
// behaviors.onChanged 刷新缓存（平台 onChanged 每次输入触发——设置页改
// 动下一次键入即生效）；通道失败保持上次值（首拉前为出厂默认）。语言对
// 与自定义字符类不在 23 键 schema——languagePairs / customScriptCategories
// 出厂种子直取 RICH_STRUCTURE_DEFAULTS（富结构持久化归后续票，运行时
// 消费面此为单一事实源）。
import type { AddonInputContext } from '../types/vendor/shared/addonBehaviors'
import {
  DEFAULT_EFFECTIVE_SETTINGS,
  RICH_STRUCTURE_DEFAULTS,
  SPACE_MODE_VALUES,
  type SpaceMode,
} from './settings/defaults'
import { pickMessages } from './i18n'
import { debugLog } from './logging'
import { SETTINGS_TOPIC } from './settings/store'
import {
  INPUT_RULE_EXCLUSIVE_GROUP,
  type RuleBehaviorRegisterOutcome,
  type RuleBehaviorsFacetSubset,
  type RulePipelineChannelSubset,
} from './ruleBehaviorIntercept'
import { planAutoFormatLineModification } from './autoFormatPipeline'
import { isDocUriExcluded } from './fileExclusion'
import { createThrottledRefresh } from './throttle'
import { SpaceState } from './formatting/inlineParts'
import {
  matchProtectedRanges,
  parseUserDefinedRegExp,
  type UserDefinedRegexRule,
} from './userDefinedRegex'
import type { LineFormatSettings } from './formatting/lineFormatter'
import type { PasteMarker } from './pasteMarker'

/** 行为族 localId（#25 五族 01-05 之后的默认链序位） */
export const AUTO_FORMAT_LOCAL_ID = '06-autoformat'

/** 间距引擎配置：行格式化设置 + 上游 AutoFormat 总门（族回调内判定）+
 * #27 保护区两键（上游 UserDefinedRegSwitch / UserDefinedRegExp——规则表
 * 为解析缓存形态，refresh 时重建）+ #28 文件排除清单（ExcludeFiles 命中
 * → 恒 null，上游 cm_extensions.ts:417 的 `|| isCurrentFileExclude(ctx)`
 * 对应物） */
export interface AutoFormatEngineSettings {
  readonly autoFormat: boolean
  readonly excludeFiles: readonly string[]
  readonly lineFormat: LineFormatSettings
  readonly userDefinedRegSwitch: boolean
  readonly userDefinedRegexRules: readonly UserDefinedRegexRule[]
}

/** SpaceMode（字符串枚举）→ SpaceState（数字枚举；顺序同构，越界回退） */
function spaceModeToState(mode: SpaceMode): SpaceState {
  const idx = SPACE_MODE_VALUES.indexOf(mode)
  return (idx === -1 ? SPACE_MODE_VALUES.indexOf('soft') : idx) as SpaceState
}

/** effective 快照中的行格式化键子集（类型收窄后的读取面） */
interface AutoFormatEffectiveSubset {
  autoCapital: boolean
  prefixDictionary: string
  softSpaceLeftSymbols: string
  softSpaceRightSymbols: string
  inlineCodeSpaceMode: SpaceMode
  inlineFormulaSpaceMode: SpaceMode
  inlineLinkSpaceMode: SpaceMode
  inlineLinkSmartSpace: boolean
  userDefinedRegSwitch: boolean
  userDefinedRegExp: string
  /** #28：文件排除清单（上游 ExcludeFiles 消费） */
  excludeFiles?: readonly string[]
}

/** 默认引擎配置（出厂默认值 + 富结构种子；通道不可用时的兜底） */
export function defaultAutoFormatEngineSettings(): AutoFormatEngineSettings {
  const d = DEFAULT_EFFECTIVE_SETTINGS
  return {
    autoFormat: d.autoFormat,
    excludeFiles: [...d.excludeFiles],
    lineFormat: {
      languagePairs: RICH_STRUCTURE_DEFAULTS.languagePairs.map((p) => ({ a: p.a, b: p.b })),
      customScriptCategories: RICH_STRUCTURE_DEFAULTS.customScriptCategories.map((c) => ({
        name: c.name,
        pattern: c.pattern,
      })),
      prefixDictionary: d.prefixDictionary,
      autoCapital: d.autoCapital,
      softSpaceLeftSymbols: d.softSpaceLeftSymbols,
      softSpaceRightSymbols: d.softSpaceRightSymbols,
      inlineCodeSpaceMode: spaceModeToState(d.inlineCodeSpaceMode),
      inlineFormulaSpaceMode: spaceModeToState(d.inlineFormulaSpaceMode),
      inlineLinkSpaceMode: spaceModeToState(d.inlineLinkSpaceMode),
      inlineLinkSmartSpace: d.inlineLinkSmartSpace,
    },
    userDefinedRegSwitch: d.userDefinedRegSwitch,
    userDefinedRegexRules: parseUserDefinedRegExp(d.userDefinedRegExp),
  }
}

/** 快照值按默认值类型校验（对齐 store.ts pickValidValue 的防御口径） */
function pickOfSameType<T>(fallback: T, raw: unknown): T {
  if (typeof raw === typeof fallback) return raw as T
  return fallback
}

/** excludeFiles 数组校验（字符串数组透传，其余回默认；store.ts 同口径） */
function pickStringArray(fallback: readonly string[], raw: unknown): readonly string[] {
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) return fallback
  return [...(raw as readonly string[])]
}

function readEngineSettings(effective: unknown): AutoFormatEngineSettings {
  const base = defaultAutoFormatEngineSettings()
  const raw = (effective ?? {}) as Partial<AutoFormatEffectiveSubset> & { autoFormat?: unknown }
  return {
    autoFormat: pickOfSameType(base.autoFormat, raw.autoFormat),
    excludeFiles: pickStringArray(base.excludeFiles, raw.excludeFiles),
    lineFormat: {
      ...base.lineFormat,
      autoCapital: pickOfSameType(base.lineFormat.autoCapital, raw.autoCapital),
      prefixDictionary: pickOfSameType(base.lineFormat.prefixDictionary, raw.prefixDictionary),
      softSpaceLeftSymbols: pickOfSameType(base.lineFormat.softSpaceLeftSymbols, raw.softSpaceLeftSymbols),
      softSpaceRightSymbols: pickOfSameType(base.lineFormat.softSpaceRightSymbols, raw.softSpaceRightSymbols),
      inlineCodeSpaceMode: spaceModeToState(pickOfSameType('soft' as SpaceMode, raw.inlineCodeSpaceMode)),
      inlineFormulaSpaceMode: spaceModeToState(pickOfSameType('soft' as SpaceMode, raw.inlineFormulaSpaceMode)),
      inlineLinkSpaceMode: spaceModeToState(pickOfSameType('soft' as SpaceMode, raw.inlineLinkSpaceMode)),
      inlineLinkSmartSpace: pickOfSameType(base.lineFormat.inlineLinkSmartSpace, raw.inlineLinkSmartSpace),
    },
    userDefinedRegSwitch: pickOfSameType(base.userDefinedRegSwitch, raw.userDefinedRegSwitch),
    userDefinedRegexRules: parseUserDefinedRegExp(
      pickOfSameType(DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegExp, raw.userDefinedRegExp),
    ),
  }
}

// ===== 设置门（effective 缓存；对齐 #25 createRulePipelineGate 形态） =====

export interface AutoFormatGate {
  /** 当前生效的引擎配置（通道失败保持上次值；首次返回前为出厂默认） */
  readonly settings: () => AutoFormatEngineSettings
  /** 拉新生效值（装载时与每次输入观察时调用） */
  readonly refresh: () => Promise<void>
}

export function createAutoFormatGate(channel: RulePipelineChannelSubset): AutoFormatGate {
  let current = defaultAutoFormatEngineSettings()
  return {
    settings: () => current,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      current = readEngineSettings(effective)
    },
  }
}

// ===== 注册入口（page-editor 增量块消费） =====

export interface RegisterAutoFormatDeps {
  /** 行为注册面（sdk.behaviors） */
  readonly behaviors: RuleBehaviorsFacetSubset
  /** 页面通道（设置读取） */
  readonly channel: RulePipelineChannelSubset
  /** 语言标签（i18n 字典选择，页面侧 navigator.language） */
  readonly language: string
  /** #12 粘贴标记单例（page-editor 装配，经参数注入——勿 import 页面实例） */
  readonly marker: PasteMarker
  /** 保护区区间计算器（#27 注入缝的接入位；返回行内坐标区间集，缺省无保护区） */
  readonly protectedRangesFor?: (line: string) => readonly ProtectedRangeSeed[]
}

/** #27 注入缝种子形状（行内坐标 + 左右空格要求；字符串枚举形态） */
export interface ProtectedRangeSeed {
  readonly begin: number
  readonly end: number
  readonly leftSpaceRequire: 'none' | 'soft' | 'strict'
  readonly rightSpaceRequire: 'none' | 'soft' | 'strict'
}

const SPACE_STATE_BY_NAME: Record<ProtectedRangeSeed['leftSpaceRequire'], SpaceState> = {
  none: SpaceState.none,
  soft: SpaceState.soft,
  strict: SpaceState.strict,
}

/** 种子形态（字符串枚举档）→ 数字档区间（#26 注入缝的映射原样） */
function seedToRange(seed: ProtectedRangeSeed): {
  begin: number
  end: number
  leftSpaceRequire: SpaceState
  rightSpaceRequire: SpaceState
} {
  return {
    begin: seed.begin,
    end: seed.end,
    leftSpaceRequire: SPACE_STATE_BY_NAME[seed.leftSpaceRequire],
    rightSpaceRequire: SPACE_STATE_BY_NAME[seed.rightSpaceRequire],
  }
}

export function registerAutoFormatBehavior(deps: RegisterAutoFormatDeps): RuleBehaviorRegisterOutcome[] {
  const messages = pickMessages(deps.language)
  const gate = createAutoFormatGate(deps.channel)
  void gate.refresh()
  const i18n = messages.ruleFamilies.autoFormat

  const result = deps.behaviors.register({
    id: AUTO_FORMAT_LOCAL_ID,
    name: i18n.name,
    description: i18n.desc,
    examples: [...i18n.examples],
    exclusiveGroup: INPUT_RULE_EXCLUSIVE_GROUP,
    history: 'atomic',
    onInput: (ctx: AddonInputContext) => {
      const engine = gate.settings()
      // 上游 AutoFormat 总门（规则五族不受影响）；文件排除（#407 docUri，
      // #28 接入）——上游 cm_extensions.ts:417 `!AutoFormat || isCurrentFileExclude` 同序
      if (!engine.autoFormat) return null
      if (isDocUriExcluded(ctx.docUri, engine.excludeFiles)) return null
      // #27 保护区：外部注入（#26 注入缝）优先；缺省用设置驱动的内置计算
      //（上游 core.ts:181-183——UserDefinedRegSwitch 开才带 UserDefinedRegExp
      // 进分区解析，关 = 无 user 分区）
      const line = lineOf(ctx)
      const injected = deps.protectedRangesFor?.(line)
      const protectedRanges =
        injected !== undefined
          ? injected.map(seedToRange)
          : engine.userDefinedRegSwitch
            ? matchProtectedRanges(line, engine.userDefinedRegexRules)
            : []
      return planAutoFormatLineModification(
        {
          userEvent: ctx.userEvent,
          inputText: ctx.inputText,
          replaced:
            ctx.replaced === null
              ? null
              : { from: ctx.replaced.from, to: ctx.replaced.to, text: ctx.replaced.text },
          snapshot: { text: ctx.snapshot.text, selections: ctx.snapshot.selections },
        },
        {
          settings: engine.lineFormat,
          marker: deps.marker,
          protectedRanges,
        },
      )
    },
  })
  if (!result.ok) {
    debugLog('autoformat behavior register rejected:', result.reason)
  }

  // 只读观察刷新设置缓存（平台 onChanged 每次输入触发——设置页改动下一次键入生效）
  deps.behaviors.onChanged(createThrottledRefresh(() => gate.refresh()))
  return [
    result.ok
      ? { localId: AUTO_FORMAT_LOCAL_ID, ok: true }
      : { localId: AUTO_FORMAT_LOCAL_ID, ok: false, reason: result.reason },
  ]
}

/** #27 接入位的行文本提取（当前驱动行的原文；接入方据此算行内保护区） */
function lineOf(ctx: AddonInputContext): string {
  const sel = ctx.snapshot.selections[0]
  const pos = sel === undefined ? 0 : Math.min(sel.anchor, sel.head)
  const text = ctx.snapshot.text
  const fromB = Math.max(0, pos - ctx.inputText.length)
  const start = text.lastIndexOf('\n', fromB - 1) + 1
  let end = text.indexOf('\n', start)
  if (end === -1) end = text.length
  return text.slice(start, end)
}
