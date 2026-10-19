// onInput → 自动格式化管线（工单 #26）：把 src/formatting/ 的行级算法接
// 进 #25 留下的管线入口——消费同一 `RuleInputPipelineContext` 形状（本模块
// 扩展 `replaced` 字段承载替换侧信息），对应上游 cm_extensions.ts
// tryProcessInput 的 autoFormat 段 + core.ts formatLineOfDoc 的坐标换算。
//
// 【上游格式化口径】（cm_extensions.ts:426 + core.ts:142-170 忠实移植）：
// - 格式化**光标所在行**（fromB 所在行，fromB = 插入起点 = 快照光标回退
//   inputText.length），prevCh..curCh 是本次键入的行内区间（上游
//   offsetToPos(doc, fromB/toB).ch）；
// - 仅纯插入 + 塌缩单光标触发（上游 notSelected && changedStr.length < 1；
//   选区替换形态不格式化）；inputText 含 \n 时按上游 Enter 定稿分支
//   （curCh=prevCh=fromB 列，定稿模式 + 光标跨插入段平移）。
//
// 【多光标结论】selections.length > 1 → 不处理：inputText 是多选区拼接、
// 无法归因首光标的插入长度（#25 管线取首光标；本管线因 prevCh 推导依赖
// inputText 长度归因，收窄为单光标，多光标键入不格式化——上游
// asSingle().main 单选区坍缩语义的保守收窄，记录于 docs/specs/auto-format.md）。
//
// 【#12 粘贴联动】粘贴识别 = userEvent 含 paste || marker.pasteDetected
//（上游 cm_extensions.ts:556 同构）；命中即跳过格式化并一次性消费纯文本
// 意图（consumePlainPaste——读即消费）。平台行为链本身对 paste·drop·undo
// 事务不驱动行为（#25 记录），此判定防御覆盖粘贴窗内的普通键入与未来
// 驱动面变化。
//
// 【作用域跳过】（上游 getPosLineType !== text → 不格式化）：#5 切片 B 起
// 走树版 detectScopeViaQuery（平台 experimental.syntax 经 syntaxTreeQuery 适
// 配）——Code（块级围栏/行内代码，链接区段排除）与 Formula 跳过；行级
// frontmatter 由 isInsideFrontmatter 补判（平台行为链已门控 frontmatter/
// 块代码/表格格区，此处为管线级防御重复，表格不另判——依赖平台门控，
// 记录于规格）。行内代码/公式作为分区由 lineFormatter 处理，无需行级跳
// 过。查询拒绝 → detectScopeViaQuery 返回 null（评审 P3：拒绝不静默归
// Text）——作用域门控处即拦截不格式化，不待行内分区的 inlineAt 拒绝兜底。
// 【memo 已删除】（原 (text,pos) 单槽缓存的动机是同一事务 6 次同键重复
// 全文 O(L) 正则扫描，审查 C-P1-1；查询版 µs 级无此成本，保留只会增加
// 陈旧风险——#5 切片 B 决策）。
import { RuleScope } from './rules/rule-engine'
import { detectScopeViaQuery, docOfText, type SyntaxDoc, type SyntaxQuery } from './syntaxTreeQuery'
import {
  pipelineConsumesUserEvent,
  type RuleInputBehaviorPlan,
  type RuleInputPipelineContext,
} from './ruleBehaviorPipeline'
import { formatLine, type LineFormatSettings, type ProtectedInlineRange } from './formatting/lineFormatter'

/** 管线输入面：RuleInputPipelineContext 自带 replaced（#9 并入后的基接口
 *  形态：`| null` 非可选，纯插入为 null；compose 纯塌缩/迟入为 null、定稿
 *  替换侧非 null 但被本链 replaced 门跳过——B27 口径）——直接继承，
 *  不再重声明 */
export type AutoFormatPipelineContext = RuleInputPipelineContext

/** #12 粘贴标记的结构子集（PasteMarker 兼容；经参数注入，勿 import 页面实例） */
export interface AutoFormatPasteSignal {
  readonly pasteDetected: boolean
  consumePlainPaste(): boolean
}

export interface AutoFormatLineOptions {
  readonly settings: LineFormatSettings
  /** 语法查询适配器（#5 树版判定源，必选——无查询不格式化，不 fallback） */
  readonly query: SyntaxQuery
  /** 保护区区间集（**行内坐标**；#27 注入缝，默认无） */
  readonly protectedRanges?: readonly ProtectedInlineRange[]
  /** #12 粘贴标记（不传 = 无粘贴信号，供纯逻辑测试） */
  readonly marker?: AutoFormatPasteSignal
}

/**
 * 单次输入的自动格式化计划：无变更返回 null（行为链照常）。纯函数——
 * 与 #25 planInputRuleModification 同形态（该函数经独占组承载上游
 * 「规则命中即短路格式化」的链序，见 autoFormatIntercept.ts）。
 */
export function planAutoFormatLineModification(
  ctx: AutoFormatPipelineContext,
  options: AutoFormatLineOptions,
): RuleInputBehaviorPlan | null {
  // 粘贴识别先于 userEvent 门（paste 事务不在 Input 触发面内，但纯文本
  // 意图的一次性消费须在粘贴命中时发生——读即消费，错过窗口即失效）
  const marker = options.marker
  if (ctx.userEvent.includes('paste') || (marker !== undefined && marker.pasteDetected)) {
    marker?.consumePlainPaste()
    return null
  }
  if (!pipelineConsumesUserEvent(ctx.userEvent)) return null

  // 多光标不处理（见头注【多光标结论】）；非塌缩选区 = 上游 notSelected 同口径
  const selections = ctx.snapshot.selections
  if (selections.length !== 1) return null
  const sel = selections[0]!
  if (sel.anchor !== sel.head) return null
  const head = sel.head

  // 纯插入门控（上游 changedStr.length < 1）：替换侧非空 = 选区替换形态
  const replaced = ctx.replaced ?? null
  if (replaced !== null && replaced.text.length > 0) return null

  const text = ctx.snapshot.text
  const inputText = ctx.inputText
  if (inputText.length === 0) return null
  if (head > text.length) return null // 防御：越界坐标不进算法

  // fromB = 插入起点（上游 compose_begin_pos / fromB 的快照回推形态）
  const fromB = head - inputText.length
  if (fromB < 0) return null // 防御：inputText 与光标失配（多选区拼接等）

  // 作用域门控（树版）：Code / Formula / frontmatter 行不格式化；查询拒绝
  //（null，评审 P3）→ 不接管不格式化。docOfText 带单槽缓存（评审 R2-B4）
  const doc: SyntaxDoc = docOfText(text)
  const scope = detectScopeViaQuery(doc, options.query, head)
  if (scope === null || scope.scope !== RuleScope.Text) return null
  if (isInsideFrontmatter(text, fromB)) return null

  // 行定位与行内坐标（上游 formatLineOfDoc 的 offsetToPos 换算；行结构
  // 直接从 SyntaxDoc 取——与查询同一坐标源）
  const lineInfo = doc.lineAt(fromB)
  const lineStart = lineInfo.from
  const line = lineInfo.text

  // Enter 定稿分支（上游 insertedStr.contains('\n')）：curCh=prevCh=fromB
  // 列（定稿模式——词典只认精确命中、延迟边界补插）；光标跨插入段平移
  const hasNewline = inputText.includes('\n')
  const curCh = hasNewline ? fromB - lineStart : head - lineStart
  const prevCh = fromB - lineStart

  const result = formatLine(
    line,
    curCh,
    prevCh,
    options.settings,
    { doc, query: options.query, lineNumber: lineInfo.number },
    { protectedRanges: [...(options.protectedRanges ?? [])] },
  )
  if (result === null) return null // 行内分区查询拒绝：不格式化
  if (result.changes.length === 0) return null

  const cursorShift = hasNewline ? inputText.length : 0
  const cursor = lineStart + result.cursorCh + cursorShift
  return {
    changes: result.changes.map((c) => ({
      offset: lineStart + c.begin,
      length: c.end - c.begin,
      text: c.text,
    })),
    selection: { anchor: cursor, head: cursor },
  }
}

/** frontmatter（--- 围栏，未闭合延至文末）内不格式化——上游 hmd-frontmatter
 * 令牌判定的文本降级；边界行（含闭合 ---）计入。 */
export function isInsideFrontmatter(text: string, pos: number): boolean {
  if (!text.startsWith('---\n')) return false
  let searchFrom = 4
  while (searchFrom <= text.length) {
    const nl = text.indexOf('\n', searchFrom)
    const lineEnd = nl === -1 ? text.length : nl
    if (text.slice(searchFrom, lineEnd) === '---') return pos <= lineEnd
    if (nl === -1) return true // 未闭合 → 全文 frontmatter
    searchFrom = nl + 1
  }
  return true
}
