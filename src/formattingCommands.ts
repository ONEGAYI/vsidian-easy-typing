// 格式化命令族（工单 #28）：上游 formatting_commands.ts 五命令的 Vsidian
// 移植——全部走平台稳定 commands API（sdk.commands.register：统一快捷键
// 管理 + 命令面板），命令回调无 view 入参，目标视图经 #12 的视图登记表
// 捕获（聚焦者优先）+ views 面 main 句柄回退（命令面板入口）。
//
// 【命令清单与上游对照】
// - format-article（格式化全文，上游 formatArticle / Mod+Shift+S）：
//   全文逐行 formatLine 整行重排（prevCh=0——上游 preFormatOneLine 的
//   formatLine(..., curCh, 0) 同形，键入区间覆盖整行前缀使语言对全量
//   生效）；跳过代码块/frontmatter/表格行/整行公式（文本降级
//   单遍行分类，口径见 classifyFormatSkipLines 头注）；autoCapital 强制
//   关（上游 {...settings, AutoCapital: false} 同形）；光标行经
//   cursorCh 跟踪重定位。
// - format-selection（格式化选区/当前行，上游 formatSelectionOrCurLine /
//   Mod+Shift+L）：无选区 = 光标行；有选区 = 覆盖行区间逐行重排，选区
//   方向感知恢复（上游同-line 选区恢复为整行反向的怪癖原样保留）。
// - delete-blank-lines（删除空行，上游 deleteBlankLines / Mod+Shift+K）：
//   空行 = /^\s*$/（只含空白也算——上游语义核实结论）；保留规则（列表/
//   引用/块 id 后随空行的同类前瞻、水平线前空行回保）逐条移植；
//   strictLineBreaks 分支按 Vsidian 阅读渲染（markdown-it breaks:false，
//   CommonMark 严格换行）恒取 true——单空行是段落结构所需不删，仅收敛
//   连续空行（映射结论见规格「删除空行」节）。
// - toggle-auto-format（切换自动格式化，上游 switchAutoFormatting /
//   Ctrl+Tab）：翻转 #3 生效值 autoFormat 键（SETTINGS_TOPIC.update 写
//   user 层持久），生效面即 #26 行为族总门；经通知通道回执新状态。
// - convert-code-block（选区转代码块，上游 convert2CodeBlock /
//   Mod+Shift+N）：选中内容包裹 ``` 围栏（默认空语言——上游不询问，
//   光标落在语言位 ch=3 直接可输入）；无选区插入空围栏骨架；行首尾
//   非 0/EOL 时前后补 \n（上游同形）。
//
// 【文件排除】上游 ExcludeFiles（排除清单内文件不受自动格式化影响，
// cm_extensions.ts:417 消费）经 #407 的 docUri 在本票解锁：命令侧命中
// → 不执行 + 经通知通道说明原因（i18n）；#26 行为族侧的接入见
// autoFormatIntercept.ts（ctx.docUri 同源消费）。
//
// 【撤销边界】每命令单笔事务（view.dispatch 单次 / applyEdits 单请求），
// 一步还原——测试断言钉住。
import type { EditorView } from '@codemirror/view'
import type { AddonCommandDefinition } from '../types/vendor/shared/addonCommands'
import type { EditorViewRegistry } from './plainPasteCommand'
import type { AutoFormatGate, AutoFormatEngineSettings } from './autoFormatIntercept'
import { formatLine, type LineFormatSettings } from './formatting/lineFormatter'
import { isDocUriExcluded } from './fileExclusion'
import { SETTINGS_TOPIC } from './settings/store'
import { debugLog } from './logging'
import type { Messages } from './i18n'

// ===== 命令局部 ID（平台注入 `<addonId>.<localId>` 命名空间） =====

export const FORMAT_ARTICLE_COMMAND_ID = 'format-article'
export const FORMAT_SELECTION_COMMAND_ID = 'format-selection'
export const DELETE_BLANK_LINES_COMMAND_ID = 'delete-blank-lines'
export const TOGGLE_AUTO_FORMAT_COMMAND_ID = 'toggle-auto-format'
export const CONVERT_CODE_BLOCK_COMMAND_ID = 'convert-code-block'

/**
 * 默认绑定（规范修饰键序 ctrl→alt→shift→meta）：
 * - format-selection / toggle-auto-format 默认未绑定——前者上游 Mod+Shift+L
 *   与平台内置 findAllOccurrences（#238 默认 ctrl+shift+l，路由序内置先于
 *   运行期命令）同弦结构性遮蔽；后者上游 Ctrl+Tab 被 #125 Tab 固定链
 *   注册期拒绝（tab-forbidden）。绑定入口由平台快捷键管理承担（用户显
 *   式绑定经覆盖优先序仍可自配任意键）。评估记录见规格「键位」节。
 */
export const FORMAT_ARTICLE_DEFAULT_BINDINGS: readonly string[] = ['ctrl+shift+s', 'shift+meta+s']
export const FORMAT_SELECTION_DEFAULT_BINDINGS: readonly string[] = []
export const DELETE_BLANK_LINES_DEFAULT_BINDINGS: readonly string[] = ['ctrl+shift+k', 'shift+meta+k']
export const TOGGLE_AUTO_FORMAT_DEFAULT_BINDINGS: readonly string[] = []
export const CONVERT_CODE_BLOCK_DEFAULT_BINDINGS: readonly string[] = ['ctrl+shift+n', 'shift+meta+n']

/** 命令定义构造（title 经 i18n 字典注入；格式化类 writes=true 仅 Live 正文接管宿主绑定） */
export function buildFormatArticleCommandDefinition(title: string): AddonCommandDefinition {
  return {
    id: FORMAT_ARTICLE_COMMAND_ID,
    title,
    mode: 'live',
    writes: true,
    defaultBindings: FORMAT_ARTICLE_DEFAULT_BINDINGS,
  }
}

export function buildFormatSelectionCommandDefinition(title: string): AddonCommandDefinition {
  return {
    id: FORMAT_SELECTION_COMMAND_ID,
    title,
    mode: 'live',
    writes: true,
    defaultBindings: FORMAT_SELECTION_DEFAULT_BINDINGS,
  }
}

export function buildDeleteBlankLinesCommandDefinition(title: string): AddonCommandDefinition {
  return {
    id: DELETE_BLANK_LINES_COMMAND_ID,
    title,
    mode: 'live',
    writes: true,
    defaultBindings: DELETE_BLANK_LINES_DEFAULT_BINDINGS,
  }
}

export function buildToggleAutoFormatCommandDefinition(title: string): AddonCommandDefinition {
  // 全局开关翻转：不写文档（writes=false 不接管正文键位）、双模式可用
  return {
    id: TOGGLE_AUTO_FORMAT_COMMAND_ID,
    title,
    mode: 'both',
    writes: false,
    defaultBindings: TOGGLE_AUTO_FORMAT_DEFAULT_BINDINGS,
  }
}

export function buildConvertCodeBlockCommandDefinition(title: string): AddonCommandDefinition {
  return {
    id: CONVERT_CODE_BLOCK_COMMAND_ID,
    title,
    mode: 'live',
    writes: true,
    defaultBindings: CONVERT_CODE_BLOCK_DEFAULT_BINDINGS,
  }
}

// ===== 行分类（跳过口径的文本降级单遍实现） =====

/** 围栏标记行（开/关同形；信息串只允许出现在开栏侧——#25 同口径） */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** 表格行（含引用块内表格：> 前缀感知；行首 | 且行内还有第二个 |） */
const TABLE_ROW = /^\s*(?:>\s*)*\|.*\|/

/** 无首管道的表格分隔行（GFM 允许省略首尾管道；纯分隔字符构成） */
const TABLE_DELIM_ROW = /^\s*(?:>\s*)*:?-+:?(\s*\|\s*:?-+:?)+\s*$/

/**
 * 全文行分类（单遍状态机，O(总行数)——命令级全文重排不走
 * detectScopeFromText 的逐位置扫描）：
 * - frontmatter：文档以 --- 起始的围栏区（含首尾边界行——isInsideFrontmatter
 *   同口径），未闭合延至文末；
 * - 代码块：``` / ~~~ 围栏状态机（同字符关闭、长度不小于开栏、缩进 ≤3），
 *   标记行本身跳过；
 * - 整行公式：行首 $$ 进入块级公式（单行 $$...$$ 完整亦跳过），块内行跳过；
 * - 表格行：行首 |（引用前缀感知）——**与 #26 作用域口径一致跳过**
 *   （上游树版会格式化表格行，本票按票面口径跳过，差异记录于规格，
 *   语法树版 #5 换传时的升级点）；
 * - 其余 text 行格式化（行内 code/formula/wikilink 分区由 lineFormatter
 *   的 splitLineIntoParts 处理）。
 */
export function classifyFormatSkipLines(lines: readonly string[]): boolean[] {
  const skip: boolean[] = new Array<boolean>(lines.length).fill(false)
  let frontmatterOpen = false
  let fence: { char: string; length: number } | null = null
  let formulaOpen = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // frontmatter（仅文档首行 --- 进入；含闭合边界行；未闭合延至文末）
    if (i === 0 && line.trim() === '---') {
      frontmatterOpen = true
      skip[i] = true
      continue
    }
    if (frontmatterOpen) {
      skip[i] = true
      if (line.trim() === '---') frontmatterOpen = false
      continue
    }

    // 代码块围栏状态机
    const fenceMatch = FENCE_LINE.exec(line)
    if (fence !== null) {
      skip[i] = true
      if (
        fenceMatch !== null &&
        fenceMatch[1]![0] === fence.char &&
        fenceMatch[1]!.length >= fence.length &&
        fenceMatch[2]!.trim() === ''
      ) {
        fence = null
      }
      continue
    }
    if (fenceMatch !== null) {
      fence = { char: fenceMatch[1]![0]!, length: fenceMatch[1]!.length }
      skip[i] = true
      continue
    }

    // 块级公式（行首 $$；单行完整 $$...$$ 不改状态）
    const trimmed = line.trim()
    if (formulaOpen) {
      skip[i] = true
      if (trimmed.startsWith('$$')) formulaOpen = false
      continue
    }
    if (trimmed.startsWith('$$')) {
      skip[i] = true
      if (!(trimmed.length > 4 && trimmed.endsWith('$$'))) formulaOpen = true
      continue
    }

    // 表格行（行首管道或无首管道的分隔行形态）
    if (TABLE_ROW.test(line) || TABLE_DELIM_ROW.test(line)) {
      skip[i] = true
      continue
    }
  }
  return skip
}

// ===== 纯计划函数（text + 主选区 → 变更 + 选区；无变更返回 null） =====

/** 命令计划（SerChange 与 CM6 ChangeSpec 换算层各取所需） */
export interface FormattingCommandPlan {
  readonly changes: ReadonlyArray<{ offset: number; length: number; text: string }>
  readonly selection?: { anchor: number; head: number }
}

/** 行起点偏移表（lines 为 split('\n') 结果） */
function lineStarts(lines: readonly string[]): number[] {
  const starts = new Array<number>(lines.length)
  let at = 0
  for (let i = 0; i < lines.length; i++) {
    starts[i] = at
    at += lines[i]!.length + 1
  }
  return starts
}

/** offset 所在行号（0 基；末行哨兵） */
function lineIndexOf(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 单行整行重排（命令形态：prevCh=0 整行重排 + autoCapital 强制关——上游
 *  formatArticle/formatSelectionOrCurLine 经 preFormatOneLine 传
 *  formatLine(..., curCh, 0) 的同形；键入区间 [0, curCh) 覆盖整行前缀，
 *  语言对全量生效。注意 prevCh=undefined 是「不重排间距」的跳过形态，
 *  非整行重排——#26 规格「命令重排入口形态」注记的勘误，见本票规格） */
function reformatCommandLine(
  line: string,
  curCh: number,
  settings: LineFormatSettings,
): { line: string; cursorCh: number } {
  const result = formatLine(line, curCh, 0, { ...settings, autoCapital: false })
  return { line: result.line, cursorCh: result.cursorCh }
}

/** 格式化全文（上游 formatArticle）：光标行经 cursorCh 跟踪重定位。
 *  签名与其余 planner 对齐（anchor/head 主选区）；全文命令的光标取 head
 *  侧（上游 getCursor() 的 CM6 等价——选区在场时 head 即光标位）。 */
export function planFormatArticle(
  text: string,
  anchor: number,
  head: number,
  settings: LineFormatSettings,
): FormattingCommandPlan | null {
  void anchor //（光标语义只认 head 侧；参数保留换取四个 planner 的统一签名）
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  const skip = classifyFormatSkipLines(lines)
  const cursor = Math.min(Math.max(head, 0), text.length)
  const cursorLine = lineIndexOf(starts, cursor)
  const cursorCh = cursor - starts[cursorLine]!

  const newLines: string[] = []
  const changes: Array<{ offset: number; length: number; text: string }> = []
  let newCursor: number | null = null

  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) {
      newLines.push(lines[i]!)
      if (i === cursorLine) newCursor = starts[i]! + Math.min(cursorCh, lines[i]!.length)
      continue
    }
    const curCh = i === cursorLine ? cursorCh : lines[i]!.length
    const { line, cursorCh: newCh } = reformatCommandLine(lines[i]!, curCh, settings)
    newLines.push(line)
    if (i === cursorLine) newCursor = starts[i]! + newCh
    if (line !== lines[i]!) {
      changes.push({ offset: starts[i]!, length: lines[i]!.length, text: line })
    }
  }
  if (changes.length === 0) return null
  // 光标绝对位置按新行前缀重算（前行长度变化时光标行起点平移）
  let at = 0
  for (let i = 0; i < cursorLine; i++) at += newLines[i]!.length + 1
  const finalCursor = at + (newCursor !== null ? newCursor - starts[cursorLine]! : 0)
  return { changes, selection: { anchor: finalCursor, head: finalCursor } }
}

/** 格式化选区/当前行（上游 formatSelectionOrCurLine） */
export function planFormatSelection(
  text: string,
  anchor: number,
  head: number,
  settings: LineFormatSettings,
): FormattingCommandPlan | null {
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  const skip = classifyFormatSkipLines(lines)

  if (anchor === head) {
    // 当前行：光标 ch 跟踪（上游无选区分支同形）
    const line = lineIndexOf(starts, anchor)
    if (skip[line]) return null
    const curCh = anchor - starts[line]!
    const { line: newLine, cursorCh } = reformatCommandLine(lines[line]!, curCh, settings)
    if (newLine === lines[line]) return null
    return {
      changes: [{ offset: starts[line]!, length: lines[line]!.length, text: newLine }],
      selection: { anchor: starts[line]! + cursorCh, head: starts[line]! + cursorCh },
    }
  }

  const from = Math.min(anchor, head)
  const to = Math.max(anchor, head)
  const fromLine = lineIndexOf(starts, from)
  const toLine = lineIndexOf(starts, to)

  const changes: Array<{ offset: number; length: number; text: string }> = []
  const newLines = new Map<number, string>()
  for (let i = fromLine; i <= toLine; i++) {
    if (skip[i]) continue
    const { line: newLine } = reformatCommandLine(lines[i]!, lines[i]!.length, settings)
    if (newLine !== lines[i]!) {
      newLines.set(i, newLine)
      changes.push({ offset: starts[i]!, length: lines[i]!.length, text: newLine })
    }
  }
  if (changes.length === 0) return null

  // 选区方向感知恢复（上游 L86-91 原样：严格前向跨行 → 整区间前向全选；
  // 其余（含同行选区）→ anchor 侧行尾、head 侧行首的反向全选——上游怪癖
  // 保留，不擅自修复）。区间内前行变长时行起点平移，行号→新偏移经逐行
  // 前缀重算（上游行/ch 坐标系天然免疫，偏移坐标系必须显式换算）
  const newLineStart = (i: number): number => {
    let at = starts[fromLine]!
    for (let k = fromLine; k < i; k++) at += (newLines.get(k) ?? lines[k]!).length + 1
    return at
  }
  const newLineEnd = (i: number): number => newLineStart(i) + (newLines.get(i) ?? lines[i]!).length
  const anchorLine = lineIndexOf(starts, anchor)
  const headLine = lineIndexOf(starts, head)
  if (anchorLine < headLine) {
    return { changes, selection: { anchor: newLineStart(fromLine), head: newLineEnd(toLine) } }
  }
  return { changes, selection: { anchor: newLineEnd(anchorLine), head: newLineStart(headLine) } }
}

// ---- 删除空行（上游 deleteBlankLines 逐条移植；strictLineBreaks 恒 true） ----

const RE_BLANK = /^\s*$/
const RE_LIST = /^\s*(?:[-*+]|\d+[.)]) /
const RE_QUOTE = /^\s*>/
const RE_BLOCKID = /\s\^[\w-]+\s*$/
const RE_HR = /^\s*(?:---+|\*\*\*+|___+)\s*$/

type TrailingBlankType = 'list' | 'quote' | 'blockid' | null

function trailingBlankType(text: string): TrailingBlankType {
  if (RE_LIST.test(text)) return 'list'
  if (RE_QUOTE.test(text)) return 'quote'
  if (RE_BLOCKID.test(text)) return 'blockid'
  return null
}

/** 删除空行计划：空行=只含空白也算；同类块（列表/引用/块 id）间空行删除、
 * 异类块间保留；水平线前被删空行回保；严格换行（Vsidian 阅读渲染恒严格）
 * 连续空行保首个。选区非空时只扫选区行（前一行上下文感知）。 */
export function planDeleteBlankLines(text: string, anchor: number, head: number): FormattingCommandPlan | null {
  const lines = text.split('\n')
  const starts = lineStarts(lines)
  const last = lines.length - 1

  let begin = 0
  let end = last
  if (anchor !== head) {
    begin = lineIndexOf(starts, Math.min(anchor, head))
    end = lineIndexOf(starts, Math.max(anchor, head))
  }

  // 上游边界处理：选区首行前一行是同类块 → 其后空行进入保留判定；
  // 选区末行后一行非空 → 扫描区间右扩一行（尾随空行链的收口上下文）
  let remainNextBlank = false
  let remainType: TrailingBlankType = null
  if (begin !== 0) {
    const prevType = trailingBlankType(lines[begin - 1]!)
    if (prevType !== null) {
      remainNextBlank = true
      remainType = prevType
    }
  }
  if (end !== last && !RE_BLANK.test(lines[end + 1]!)) {
    end += 1
  }

  const deleteIndex: number[] = []
  let consecutiveBlanks = 0

  for (let i = begin; i <= end; i++) {
    const line = lines[i]!
    if (RE_BLANK.test(line)) {
      consecutiveBlanks++
      if (remainNextBlank) {
        // 前瞻：仅前后同类块时删；异类保留（上游 L206-223）
        let nextNonBlankType: TrailingBlankType = null
        for (let j = i + 1; j <= end; j++) {
          if (!RE_BLANK.test(lines[j]!)) {
            nextNonBlankType = trailingBlankType(lines[j]!)
            break
          }
        }
        if (remainType !== null && nextNonBlankType === remainType) {
          deleteIndex.push(i)
        }
        remainNextBlank = false
        remainType = null
        continue
      }
      if (consecutiveBlanks === 1) continue // 严格换行：连续空行保首个
      deleteIndex.push(i)
      continue
    }
    consecutiveBlanks = 0
    if (RE_HR.test(line) && deleteIndex[deleteIndex.length - 1] === i - 1) {
      deleteIndex.pop() // 水平线前空行回保（上游 L235-237）
    } else if (trailingBlankType(line) !== null) {
      remainNextBlank = true
      remainType = trailingBlankType(line)
    } else {
      remainNextBlank = false
      remainType = null
    }
  }
  if (deleteIndex.length === 0) return null

  // 变更构造：非末行删 [行首, 次行首)（含换行）；末行删 [前行尾, 行尾]
  //（含前置换行）；仅一行文档的空行整删。相邻删除区间端点相接不重叠，
  // 升序排序即可
  const changes: Array<{ offset: number; length: number; text: string }> = []
  for (const i of deleteIndex) {
    if (i < last) {
      changes.push({ offset: starts[i]!, length: lines[i]!.length + 1, text: '' })
    } else if (i > 0) {
      changes.push({ offset: starts[i]! - 1, length: lines[i]!.length + 1, text: '' })
    } else {
      changes.push({ offset: 0, length: lines[i]!.length, text: '' })
    }
  }
  changes.sort((a, b) => a.offset - b.offset)
  return { changes }
}

/** 选区转代码块（上游 convert2CodeBlock）：默认空语言围栏 + 光标落语言位 */
export function planConvertCodeBlock(
  text: string,
  anchor: number,
  head: number,
): FormattingCommandPlan | null {
  const lines = text.split('\n')
  const starts = lineStarts(lines)

  if (anchor !== head) {
    const from = Math.min(anchor, head)
    const to = Math.max(anchor, head)
    const selected = text.slice(from, to)
    const fromLine = lineIndexOf(starts, from)
    const toLine = lineIndexOf(starts, to)
    const fromCh = from - starts[fromLine]!
    const toCh = to - starts[toLine]!
    let replacement = '```\n' + selected + '\n```'
    if (fromCh !== 0) replacement = '\n' + replacement
    if (toCh !== lines[toLine]!.length) replacement = replacement + '\n'
    const fenceAt = from + (fromCh !== 0 ? 1 : 0)
    const cursor = fenceAt + 3
    return {
      changes: [{ offset: from, length: to - from, text: replacement }],
      selection: { anchor: cursor, head: cursor },
    }
  }

  const cs = Math.min(Math.max(anchor, 0), text.length)
  const csLine = lineIndexOf(starts, cs)
  const csCh = cs - starts[csLine]!
  let replacement = '```\n```'
  if (csCh !== 0) replacement = '\n' + replacement
  if (csCh !== lines[csLine]!.length) replacement = replacement + '\n'
  const fenceAt = cs + (csCh !== 0 ? 1 : 0)
  const cursor = fenceAt + 3
  return {
    changes: [{ offset: cs, length: 0, text: replacement }],
    selection: { anchor: cursor, head: cursor },
  }
}

// ===== 注册接入（page-editor 消费；依赖全部可注入） =====

/** views 面结构子集（真实 AddonViewsFacet 兼容；测试可注入替身） */
export interface FormattingFacetViewsSubset {
  list(): ReadonlyArray<{
    instanceId: string
    targetDocUri: string
    mode: 'live' | 'reading'
    viewType: 'main' | 'embed' | 'hover'
    editable: boolean
  }>
  get(instanceId: string): {
    info: { instanceId: string; targetDocUri: string; mode: 'live' | 'reading'; editable: boolean }
    editor: {
      getSnapshot(): { ok: true; snapshot: { text: string; selections: Array<{ anchor: number; head: number }>; version: number; revision: number } } | { ok: false; reason: string }
      applyEdits(request: {
        revision: number
        changes: ReadonlyArray<{ offset: number; length: number; text: string }>
        selection?: { anchor: number; head: number }
        history?: 'atomic' | 'joinPrevious'
      }): Promise<{ ok: true; credential: unknown } | { ok: false; reason: string }>
    }
  } | null
}

/** commands 面结构子集（真实 AddonSdkCommandsFacet 兼容） */
export interface FormattingCommandsFacetSubset {
  register(
    def: AddonCommandDefinition,
    handler: () => void,
  ): { ok: boolean; reason?: string; commandId?: string; dispose(): void }
}

/** 通知请求（宿主 NOTICE_TOPIC 承接——上游 Obsidian Notice 的等价通道） */
export type FormattingNoticeRequest =
  | { kind: 'auto-format-toggled'; enabled: boolean }
  | { kind: 'command-file-excluded' }

/** 通道子集（设置写入/拉取 + 通知；真实 sdk.channel 兼容） */
export interface FormattingChannelSubset {
  request(topic: string, payload: unknown, opts?: { timeoutMs?: number }): Promise<
    { ok: true; result: unknown } | { ok: false; reason: string }
  >
}

export interface RegisterFormattingCommandsDeps {
  readonly commands: FormattingCommandsFacetSubset
  readonly channel: FormattingChannelSubset
  /** 设置门（#26 createAutoFormatGate——命令族各建实例，装载拉取 + 每次执行前刷新） */
  readonly gate: AutoFormatGate
  /** #12 视图登记表（page-editor 共享实例注入） */
  readonly views: EditorViewRegistry
  /** 当前焦点 CM6 视图探测（page-editor 经 EditorView.findFromDOM(activeElement)
   *  注入；审查 B-F3 嵌入视图拒绝口径用；缺省视为无焦点信息，不拦兜底路径） */
  readonly getFocusedView?: () => EditorView | null
  /** views 面（命令面板入口的 main 回退 + docUri 解析；缺省则无回退） */
  readonly facetViews?: FormattingFacetViewsSubset
  /** 通知发送（宿主 NOTICE_TOPIC；缺省静默——纯逻辑测试） */
  readonly notify?: (request: FormattingNoticeRequest) => void
  /** i18n 文案（命令标题） */
  readonly messages: Pick<Messages, 'commands'>
}

/** 注册结果观测面 */
export interface FormattingCommandRegistration {
  readonly localId: string
  readonly ok: boolean
  readonly reason?: string
}

/**
 * 目标视图的 docUri 解析：单一可写视图 → 其 URI；多视图经内容比对关联
 *（快照 text === 视图 doc——#407「按实际触发文档判定」的多视图近似），
 * 关联失败回退 main。解析不出（无视图面/无 main）→ null（不判排除，
 * fail-open——可得才判的防御口径）。
 */
export function resolveDocUriForView(
  view: EditorView,
  facetViews: FormattingFacetViewsSubset | undefined,
): string | null {
  if (facetViews === undefined) return null
  const editable = facetViews.list().filter((info) => info.mode === 'live' && info.editable)
  if (editable.length === 0) return null
  if (editable.length === 1) return editable[0]!.targetDocUri
  const doc = view.state.doc.toString()
  const matched: Array<{ instanceId: string; targetDocUri: string }> = []
  for (const info of editable) {
    const handle = facetViews.get(info.instanceId)
    if (handle === null) continue
    const snap = handle.editor.getSnapshot()
    if (snap.ok && snap.snapshot.text === doc) {
      matched.push({ instanceId: info.instanceId, targetDocUri: info.targetDocUri })
    }
  }
  if (matched.length === 1) return matched[0]!.targetDocUri
  const main = matched.find((m) => m.instanceId === 'main')
  if (main !== undefined) return main.targetDocUri
  return matched[0]?.targetDocUri ?? editable.find((i) => i.instanceId === 'main')?.targetDocUri ?? null
}

/** 视图命令公共守卫：组合中/只读/排除命中（通知）→ true 表示不执行 */
function guardedSkip(
  view: EditorView,
  engine: AutoFormatEngineSettings,
  deps: RegisterFormattingCommandsDeps,
): boolean {
  if (view.compositionStarted || view.state.readOnly) return true
  const docUri = resolveDocUriForView(view, deps.facetViews)
  if (docUri !== null && isDocUriExcluded(docUri, engine.excludeFiles)) {
    deps.notify?.({ kind: 'command-file-excluded' })
    return true
  }
  return false
}

/** 视图路径执行：view.dispatch 单事务（撤销一步还原） */
function dispatchPlan(
  view: EditorView,
  plan: FormattingCommandPlan,
  userEvent: string,
): void {
  view.dispatch({
    changes: plan.changes.map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text })),
    ...(plan.selection !== undefined
      ? { selection: { anchor: plan.selection.anchor, head: plan.selection.head } }
      : {}),
    userEvent,
    scrollIntoView: true,
  })
}

/** 视图命令执行流：刷新设置 → 嵌入视图口径校验 → 目标视图（登记表聚焦
 *  优先）→ 排除 → 计划 → 派发；无在场视图走 main 句柄回退（命令面板
 *  入口）。焦点元素属于 CM6 视图但不在登记表（嵌入/悬停实例——附加组件
 *  扩展槽仅挂主正文 Live 实例）时拒绝执行并 debugLog 留痕（审查 B-F3
 *  修复）：用户意图是嵌入文档，兜底目标会误写主文档。 */
function runViewCommand(
  deps: RegisterFormattingCommandsDeps,
  planner: (text: string, anchor: number, head: number, settings: LineFormatSettings) => FormattingCommandPlan | null,
  userEvent: string,
): void {
  void deps.gate
    .refresh()
    .then(() => {
      const focused = deps.getFocusedView?.() ?? null
      if (focused !== null && !deps.views.contains(focused)) {
        debugLog('formatting command skipped: focused view not registered (embed/hover) — refuse fallback target')
        return
      }
      const engine = deps.gate.settings()
      const view = deps.views.activeView()
      if (view !== null) {
        if (guardedSkip(view, engine, deps)) return
        const sel = view.state.selection.main
        const plan = planner(view.state.doc.toString(), sel.anchor, sel.head, engine.lineFormat)
        if (plan !== null) dispatchPlan(view, plan, userEvent)
        return
      }
      // 无聚焦视图（命令面板入口）：main 句柄快照 → applyEdits 单请求
      const main = deps.facetViews?.get('main')
      if (main === null || main === undefined || !main.info.editable) return
      if (isDocUriExcluded(main.info.targetDocUri, engine.excludeFiles)) {
        deps.notify?.({ kind: 'command-file-excluded' })
        return
      }
      const snap = main.editor.getSnapshot()
      if (!snap.ok) return
      const primary = snap.snapshot.selections[0]
      if (primary === undefined) return
      const plan = planner(snap.snapshot.text, primary.anchor, primary.head, engine.lineFormat)
      if (plan === null) return
      void main.editor
        .applyEdits({
          revision: snap.snapshot.revision,
          changes: plan.changes.map((c) => ({ offset: c.offset, length: c.length, text: c.text })),
          ...(plan.selection !== undefined
            ? { selection: { anchor: plan.selection.anchor, head: plan.selection.head } }
            : {}),
          history: 'atomic',
        })
        .then((outcome) => {
          if (!outcome.ok) debugLog('formatting command applyEdits rejected:', outcome.reason)
        })
    })
    .catch(() => {
      // 通道/快照链路异常静默 + debugLog 留痕（对齐同文件 runToggleAutoFormat
      // 的 .catch 形态；审查 C-P3-2 修复——裸 then 链的 rejection 会成为
      // 页面 unhandledrejection）
      debugLog('formatting command pipeline failed (channel/gate) — command dropped, retryable')
    })
}

/** 切换自动格式化：刷新读现值 → 写翻转（user 层持久）→ 通知回执 */
function runToggleAutoFormat(deps: RegisterFormattingCommandsDeps): void {
  void deps.gate
    .refresh()
    .then(() => {
      const engine = deps.gate.settings()
      const next = !engine.autoFormat
      return deps.channel
        .request(SETTINGS_TOPIC.update, { scope: 'user', patch: { autoFormat: next } })
        .then((outcome) => {
          if (!outcome.ok) {
            debugLog('toggle autoFormat settings update rejected:', outcome.reason)
            return
          }
          deps.notify?.({ kind: 'auto-format-toggled', enabled: next })
          // 本地缓存即刻对齐（不等 onChanged——下一次命令读到新值）
          void deps.gate.refresh()
        })
    })
    .catch(() => {
      // 通道异常静默（无用户可行动提示面；命令可重试）
    })
}

/** 注册全部五命令；返回观测面 + 聚合 dispose */
export function registerFormattingCommands(
  deps: RegisterFormattingCommandsDeps,
): { outcomes: readonly FormattingCommandRegistration[]; dispose(): void } {
  const m = deps.messages.commands
  const registrations: Array<{ localId: string; handle: { dispose(): void }; ok: boolean; reason?: string }> = []

  const register = (
    localId: string,
    def: AddonCommandDefinition,
    handler: () => void,
  ): void => {
    const handle = deps.commands.register(def, handler)
    registrations.push({ localId, handle, ok: handle.ok, reason: handle.reason })
    if (!handle.ok) debugLog(`command ${localId} register rejected:`, handle.reason)
  }

  register(
    FORMAT_ARTICLE_COMMAND_ID,
    buildFormatArticleCommandDefinition(m.formatArticleTitle),
    () => runViewCommand(deps, planFormatArticle, 'input.easyTyping.formatArticle'),
  )
  register(
    FORMAT_SELECTION_COMMAND_ID,
    buildFormatSelectionCommandDefinition(m.formatSelectionTitle),
    () => runViewCommand(deps, planFormatSelection, 'input.easyTyping.formatSelection'),
  )
  register(
    DELETE_BLANK_LINES_COMMAND_ID,
    buildDeleteBlankLinesCommandDefinition(m.deleteBlankLinesTitle),
    () => runViewCommand(deps, planDeleteBlankLines, 'input.easyTyping.deleteBlankLines'),
  )
  register(
    TOGGLE_AUTO_FORMAT_COMMAND_ID,
    buildToggleAutoFormatCommandDefinition(m.toggleAutoFormatTitle),
    () => runToggleAutoFormat(deps),
  )
  register(
    CONVERT_CODE_BLOCK_COMMAND_ID,
    buildConvertCodeBlockCommandDefinition(m.convertCodeBlockTitle),
    () => runViewCommand(deps, planConvertCodeBlock, 'input.easyTyping.convertCodeBlock'),
  )

  return {
    outcomes: registrations.map((r) => ({ localId: r.localId, ok: r.ok, ...(r.reason !== undefined ? { reason: r.reason } : {}) })),
    dispose() {
      for (const r of registrations) r.handle.dispose()
    },
  }
}
