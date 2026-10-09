// CollapsePersistentEnter 折叠标题 Enter 拦截（工单 #18 接入层）——上游
// keyboard_handlers.ts enterCollapsedHeading 的平台化移植。
//
// 语义（对齐上游）：光标在「被折叠的标题行」上按 Enter → 在折叠区间
// 末尾之后新建同级标题行（不展开折叠、不进入折叠内容内部）；非折叠
// 态、非标题行一律透传（return false 落穿平台 Enter 链）。
//
// 折叠判定消费 sdk.experimental.headingFold.folds()（#410）——Live 视图
// 有效折叠的派生视图，防御性拷贝可安全消费。每键实时查询（查询前有
// 零开销行门槛，见 createFoldEnterCommand）；平台折叠是派生模型（键集
// 合 + 查询时按当前 doc 重派生区间），插入新标题行后键集合不动（插入
// 点在键之后）、新标题行自动成为折叠区间的新边界——**无需上游的
// toggleFold 展开重折 hack**（Obsidian CM5 API 限制），折叠态天然保持。
//
// 层归属（票面 #402 分层核对，见 docs/specs/fold-enter.md「层归属与
// 平台 Enter 仲裁」）：**抢先层 Prec.high**——先于平台 Enter 情境链
// （列表续行/表格/普通换行）尝试。接管面 = 功能开 + 光标在被折叠的
// ATX 标题行；其余 return false 落穿（平台链照旧）。标题行不是列表项，
// 与列表续行无接管交集。
//
// 与上游的差异：
// - 上游 StrictModeEnter × strictLineBreaks 分支（折叠末行非空白时前置
//   空行）不移植：strictLineBreaks 是 Obsidian 阅读渲染概念，vsidian
//   无此设置（规格记录）。
// - 上游折叠区间命中判定 pos ∈ [l.from, l.to]（含隐藏区内部——CM5
//   折叠下光标可达性靠 toggleFold hack 保证）；平台折叠隐藏区不可达
//   （落点展开），本仓判定收紧为「光标行行首 == 折叠键」（即可见标题
//   行上），语义等价且不依赖折叠区间终点形状。
// - 多选区显式透传（上游在 handleEnter 主入口检查，本层在 plan 内）。
// - userEvent 用 CM6 惯例 'input.newline'（上游自定义
//   'EasyTyping.handleEnter'）+ scrollIntoView（新标题行在折叠末尾，
//   不滚动易脱视）。
//
// 设置门控：上游默认关——消费 #3 门面 effective.collapsePersistentEnter
//（SETTINGS_TOPIC.get，宿主侧 attachSettings 合成）。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import type {
  AddonHeadingFoldQueryResult,
  AddonHeadingFoldSpan,
} from '../types/vendor/shared/addonFoldApi'
import { SETTINGS_TOPIC } from './settings/store'

/** 命中计划：折叠区间末尾处的插入文本与光标落点（LF 偏移） */
export interface FoldEnterPlan {
  /** 插入点 = 折叠区间末尾（hideTo：下一同级或更高级标题行行首，或文档末尾） */
  readonly insertAt: number
  /** 插入文本 = 同级标题行（`#` 串 + 一个空格，上游口径；非两空格），按插入点前后补换行使其成为独立行 */
  readonly insert: string
  /** 光标落点 = 新标题行行尾（`#` 串 + 空格之后，上游 ch = level + 1 等价位） */
  readonly cursor: number
}

/** ATX 标题前缀（`#` 串后须有空格——上游 `/^#+ /` 口径；Setext 内容行不匹配，自然透传） */
function atxLevelOf(text: string): number | null {
  const match = text.match(/^#+(?= )/)
  return match === null ? null : match[0].length
}

/**
 * 决策：光标是否在「被折叠的 ATX 标题行」上，命中返回同级标题插入计划。
 *
 * spans 来自平台 folds()（Live 实例的有效折叠派生视图）；判定口径：
 * 光标行行首 == 折叠键 span.key（折叠态下隐藏区不可达，光标只能停在
 * 可见标题行——等价上游的区间内判定）。
 *
 * 插入文本换算：平台 hideTo = 下一标题**行首**（换行符之后），上游
 * CM5 的插入点在折叠末行**行尾**（换行符之前）——同一物理间隙的两侧。
 * 在行首前插入独立行须携带尾部换行（`'## \n'`），否则新行与下一标题
 * 拼行；文档末尾无尾随换行时改 `'## '` 前置换行。文档以换行结尾时新行
 * 之后留尾部空行——与上游在等价场景的文本结果一致（规格记录）。
 */
export function planFoldHeadingEnter(
  state: EditorState,
  spans: readonly AddonHeadingFoldSpan[],
): FoldEnterPlan | null {
  const sel = state.selection
  if (sel.ranges.length > 1) return null
  const pos = sel.main.to
  const line = state.doc.lineAt(pos)
  const level = atxLevelOf(line.text)
  if (level === null) return null
  const span = spans.find((s) => s.key === line.from)
  if (span === undefined) return null
  // 光标须在折叠标题的可见区内（ATX 单行时 hideFrom = 本行行尾，
  // lineAt 已保证 pos ≤ line.to——此分支防 span 形状异常，安全方向为透传）
  if (pos > span.hideFrom) return null
  const marker = `${'#'.repeat(level)} `
  const insertAt = span.hideTo
  // 插入点前已是行分隔 → 新行自成一整行（内容 + 换行，后续行原样独立）；
  // 否则（文档末尾无尾随换行）→ 前置换行
  const atLineStart =
    insertAt === 0 || state.doc.sliceString(insertAt - 1, insertAt) === '\n'
  const insert = atLineStart ? `${marker}\n` : `\n${marker}`
  const cursor = atLineStart ? insertAt + marker.length : insertAt + 1 + marker.length
  return { insertAt, insert, cursor }
}

/** Command 依赖（page-editor 注入，测试可替换） */
export interface FoldEnterCommandDeps {
  /** 折叠查询（experimental.headingFold 的 folds 方法，按实例 ID 寻址） */
  readonly folds: (instanceId: string) => AddonHeadingFoldQueryResult
  /** 视图身份反查（experimental.viewIdentity 的 instanceIdOf，经 page-editor
   *  箭头包装注入）：回调 view → 实例 ID；null = 非平台实例 */
  readonly instanceIdOf: (view: EditorView) => string | null
  /** 功能开关（collapsePersistentEnter 生效值；false = 透传） */
  readonly isEnabled: () => boolean
}

/**
 * Enter keymap Command：命中接管（派发单笔插入事务，return true），
 * 其余透传（return false 落穿平台 Enter 链——列表续行/表格/普通换行照旧）。
 *
 * 寻址：回调 view 经 instanceIdOf 反查实例 ID 后按 ID 查 folds（平台
 * developer-guide §4.2 契约——不依赖「扩展槽仅挂主正文」的装配范围推定，
 * 装配范围演进时寻址自动跟随）；反查 null（非平台实例）透传。
 *
 * 查询节流：先做零开销行门槛（光标行是 ATX 标题才调 folds()——平台侧
 * folds 走共享缓存过滤并逐项拷贝返回，非标题行 Enter 主路径不付这笔
 * 每键调用开销）；folds() 拒绝（read-only/view-disposed，含阅读态
 * Live-only 边界）一律静默透传，不算故障。
 */
export function createFoldEnterCommand(
  deps: FoldEnterCommandDeps,
): (view: EditorView) => boolean {
  const { folds, instanceIdOf, isEnabled } = deps
  return (view: EditorView): boolean => {
    // IME 组合中与只读状态不接管（组合取消交默认路径；只读实例不写）
    if (view.compositionStarted || view.state.readOnly) return false
    if (!isEnabled()) return false
    const sel = view.state.selection
    if (sel.ranges.length !== 1) return false
    // 零开销行门槛：非 ATX 标题行零 API 调用直接透传
    if (atxLevelOf(view.state.doc.lineAt(sel.main.to).text) === null) return false
    const instanceId = instanceIdOf(view)
    if (instanceId === null) return false
    const outcome = folds(instanceId)
    if (!outcome.ok) return false
    const plan = planFoldHeadingEnter(view.state, outcome.spans)
    if (plan === null) return false
    view.dispatch({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
      userEvent: 'input.newline',
      scrollIntoView: true,
    })
    return true
  }
}

/** collapsePersistentEnter 设置门（页面侧生效值缓存；形态对齐 #11 modAGate） */
export interface CollapseEnterSettingsGate {
  /** 当前生效值（通道首次返回前为 false——默认关，透传安全方向） */
  readonly enabled: () => boolean
  /** 拉新生效值（装载时与焦点回归时调用） */
  readonly refresh: () => Promise<void>
}

export function createCollapseEnterGate(
  channel: VsidianAddonPageSdk['channel'],
): CollapseEnterSettingsGate {
  let current = false
  return {
    enabled: () => current,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      current =
        (effective as { collapsePersistentEnter?: unknown } | null)?.collapsePersistentEnter === true
    },
  }
}
