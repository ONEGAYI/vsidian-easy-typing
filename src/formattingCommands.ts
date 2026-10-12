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
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
import type { EditorViewRegistry } from './plainPasteCommand'
import type { AutoFormatGate, AutoFormatEngineSettings } from './autoFormatIntercept'
import { formatLine, type LineFormatSettings } from './formatting/lineFormatter'
import { docOfLines, FORMAT_SKIP_BY_PLATFORM, platformLineKindAt, type SyntaxDoc, type SyntaxQuery } from './syntaxTreeQuery'
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

// ===== 行分类（#5 切片 B 树版：平台 kind 经 FORMAT_SKIP_BY_PLATFORM 投影） =====

/**
 * 全文行分类（跳过口径）：逐行 platformLineKindAt（代表位置查询）经
 * FORMAT_SKIP_BY_PLATFORM 投影——frontmatter/code/formula/table 跳过、
 * heading/quote/list/text 不跳过。表格行跳过是 #28 已验收决策（上游树版
 * 会格式化表格行），树版换传后保持不翻案；单行闭合 `$$x$$`、``` 与 ~~~
 * 不互闭等原降级状态机差异随平台语义消除（口径见 syntaxTreeQuery.ts 头
 * 注释）。行内 code/formula/wikilink 分区由 lineFormatter 的
 * splitLineIntoParts 处理。查询拒绝的行按跳过处理（保守：不格式化）。
 */
export function classifyFormatSkipLines(doc: SyntaxDoc, query: SyntaxQuery): boolean[] {
  const skip: boolean[] = new Array<boolean>(doc.lines)
  for (let n = 1; n <= doc.lines; n++) {
    const kind = platformLineKindAt(doc, query, n)
    skip[n - 1] = kind === null ? true : FORMAT_SKIP_BY_PLATFORM[kind]
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
 *  非整行重排——#26 规格「命令重排入口形态」注记的勘误，见本票规格。
 *  查询拒绝返回 null（该行保持原样）。 */
function reformatCommandLine(
  doc: SyntaxDoc,
  query: SyntaxQuery,
  lineNumber: number,
  line: string,
  curCh: number,
  settings: LineFormatSettings,
): { line: string; cursorCh: number } | null {
  const result = formatLine(line, curCh, 0, { ...settings, autoCapital: false }, { doc, query, lineNumber })
  if (result === null) return null
  return { line: result.line, cursorCh: result.cursorCh }
}

/** 格式化全文（上游 formatArticle）：光标行经 cursorCh 跟踪重定位。
 *  签名与其余 planner 对齐（anchor/head 主选区）；全文命令的光标取 head
 *  侧（上游 getCursor() 的 CM6 等价——选区在场时 head 即光标位）。
 *  行分类走树版 classifyFormatSkipLines（#5——query 必选）。 */
export function planFormatArticle(
  text: string,
  anchor: number,
  head: number,
  settings: LineFormatSettings,
  query: SyntaxQuery | null,
): FormattingCommandPlan | null {
  void anchor //（光标语义只认 head 侧；参数保留换取四个 planner 的统一签名）
  if (query === null) return null // 语法查询缺席：不执行（不 fallback 正则）
  const lines = text.split('\n')
  const doc = docOfLines(lines)
  const starts = lineStarts(lines)
  const skip = classifyFormatSkipLines(doc, query)
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
    const result = reformatCommandLine(doc, query, i + 1, lines[i]!, curCh, settings)
    if (result === null) {
      // 行内分区查询拒绝：该行保持原样（保守跳过）
      newLines.push(lines[i]!)
      if (i === cursorLine) newCursor = starts[i]! + Math.min(cursorCh, lines[i]!.length)
      continue
    }
    newLines.push(result.line)
    if (i === cursorLine) newCursor = starts[i]! + result.cursorCh
    if (result.line !== lines[i]!) {
      changes.push({ offset: starts[i]!, length: lines[i]!.length, text: result.line })
    }
  }
  if (changes.length === 0) return null
  // 光标绝对位置按新行前缀重算（前行长度变化时光标行起点平移）
  let at = 0
  for (let i = 0; i < cursorLine; i++) at += newLines[i]!.length + 1
  const finalCursor = at + (newCursor !== null ? newCursor - starts[cursorLine]! : 0)
  return { changes, selection: { anchor: finalCursor, head: finalCursor } }
}

/** 格式化选区/当前行（上游 formatSelectionOrCurLine；行分类树版 #5） */
export function planFormatSelection(
  text: string,
  anchor: number,
  head: number,
  settings: LineFormatSettings,
  query: SyntaxQuery | null,
): FormattingCommandPlan | null {
  if (query === null) return null // 语法查询缺席：不执行（不 fallback 正则）
  const lines = text.split('\n')
  const doc = docOfLines(lines)
  const starts = lineStarts(lines)
  const skip = classifyFormatSkipLines(doc, query)

  if (anchor === head) {
    // 当前行：光标 ch 跟踪（上游无选区分支同形）
    const line = lineIndexOf(starts, anchor)
    if (skip[line]) return null
    const curCh = anchor - starts[line]!
    const result = reformatCommandLine(doc, query, line + 1, lines[line]!, curCh, settings)
    if (result === null || result.line === lines[line]) return null
    return {
      changes: [{ offset: starts[line]!, length: lines[line]!.length, text: result.line }],
      selection: { anchor: starts[line]! + result.cursorCh, head: starts[line]! + result.cursorCh },
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
    const result = reformatCommandLine(doc, query, i + 1, lines[i]!, lines[i]!.length, settings)
    if (result === null || result.line === lines[i]!) continue
    newLines.set(i, result.line)
    changes.push({ offset: starts[i]!, length: lines[i]!.length, text: result.line })
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
 *  异类块间保留；水平线前被删空行回保；严格换行（Vsidian 阅读渲染恒严格）
 *  连续空行保首个。选区非空时只扫选区行（前一行上下文感知）。纯正则
 *  planner——settings/query 参数仅为统一 planner 签名（不消费）。 */
export function planDeleteBlankLines(
  text: string,
  anchor: number,
  head: number,
  _settings?: LineFormatSettings,
  _query?: SyntaxQuery | null,
): FormattingCommandPlan | null {
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

/** 选区转代码块（上游 convert2CodeBlock）：默认空语言围栏 + 光标落语言位。
 *  纯正则 planner——settings/query 参数仅为统一 planner 签名（不消费）。 */
export function planConvertCodeBlock(
  text: string,
  anchor: number,
  head: number,
  _settings?: LineFormatSettings,
  _query?: SyntaxQuery | null,
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

/** commands 面结构子集（真实 AddonSdkCommandsFacet 兼容；回调签名 =
 *  平台命令回调的目标视图句柄（PR #432）） */
export interface FormattingCommandsFacetSubset {
  register(
    def: AddonCommandDefinition,
    handler: (target: AddonViewHandle | null) => void,
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
  /** #12 视图登记表（page-editor 共享实例注入；目标句柄 → 本页 CM6 视图解析） */
  readonly views: EditorViewRegistry
  /** #5 语法查询工厂（instanceId → 查询；null = 反查失败/语法面缺席——
   *  需要行分类的 planner 不执行，纯正则 planner 不受影响） */
  readonly queryOf: (instanceId: string) => SyntaxQuery | null
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

/** 视图命令公共守卫：组合中/只读/排除命中（通知，排除判定用句柄的权威
 *  targetDocUri——#407「按实际触发文档判定」的平台句柄形态）→ true 表示不执行 */
function guardedSkip(
  view: EditorView,
  docUri: string,
  engine: AutoFormatEngineSettings,
  deps: RegisterFormattingCommandsDeps,
): boolean {
  if (view.compositionStarted || view.state.readOnly) return true
  if (isDocUriExcluded(docUri, engine.excludeFiles)) {
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

/** 视图命令执行流（target = 平台命令回调携带的目标视图句柄，PR #432）：
 *  刷新设置 → 视图路径（句柄实例 ID 经登记表解析本页 CM6 视图，单事务
 *  派发）→ 句柄路径（登记面外目标——主正文命令面板回退或嵌入实例，快照
 *  + applyEdits 单请求 + reveal 滚动定位，#34 起对嵌入句柄开放）。
 *  语法查询经句柄 instanceId 构造（#5）：查询缺席时需要行分类的 planner
 *  返回 null 不执行（delete-blank-lines / convert-code-block 为纯正则
 *  planner 不受影响）。无活动视图（target null）或只读句柄（hover 只读 /
 *  reading 态主正文，editable=false）静默无动作——句柄即命令语义的目标
 *  文档，不向主文档兜底误写。 */
function runViewCommand(
  deps: RegisterFormattingCommandsDeps,
  planner: (
    text: string,
    anchor: number,
    head: number,
    settings: LineFormatSettings,
    query: SyntaxQuery | null,
  ) => FormattingCommandPlan | null,
  userEvent: string,
): (target: AddonViewHandle | null) => void {
  return (target) => {
    void deps.gate
      .refresh()
      .then(() => {
        // 违约防御深度：undefined 按无活动视图降级（同 plainPaste 口径）
        if (target === null || target === undefined) return
        const engine = deps.gate.settings()
        const query = deps.queryOf(target.info.instanceId)
        const view = deps.views.viewForInstance(target.info.instanceId)
        if (view !== null) {
          if (guardedSkip(view, target.info.targetDocUri, engine, deps)) return
          const sel = view.state.selection.main
          const plan = planner(view.state.doc.toString(), sel.anchor, sel.head, engine.lineFormat, query)
          if (plan !== null) dispatchPlan(view, plan, userEvent)
          return
        }
        // 句柄路径：登记面外目标。主正文句柄 = 命令面板入口回退（视图构造
        // 前）；嵌入句柄 = 平台句柄面支持安全提交（嵌入实例在平台视图注册
        // 表与 main 同表分派，applyEdits atomic 撤销语义一致——#34 泛化，
        // 原 main 门拆除）。只读目标（hover / reading 态）无执行权。
        if (!target.info.editable) {
          debugLog('formatting command skipped: read-only target (hover/reading) — no fallback to main')
          return
        }
        if (isDocUriExcluded(target.info.targetDocUri, engine.excludeFiles)) {
          deps.notify?.({ kind: 'command-file-excluded' })
          return
        }
        const snap = target.editor.getSnapshot()
        if (!snap.ok) return
        const primary = snap.snapshot.selections[0]
        if (primary === undefined) return
        const plan = planner(snap.snapshot.text, primary.anchor, primary.head, engine.lineFormat, query)
        if (plan === null) return
        void target.editor
          .applyEdits({
            revision: snap.snapshot.revision,
            changes: plan.changes.map((c) => ({ offset: c.offset, length: c.length, text: c.text })),
            ...(plan.selection !== undefined
              ? { selection: { anchor: plan.selection.anchor, head: plan.selection.head } }
              : {}),
            history: 'atomic',
          })
          .then((outcome) => {
            if (!outcome.ok) {
              debugLog('formatting command applyEdits rejected:', outcome.reason)
              return
            }
            // 滚动定位（视图路径 scrollIntoView 的句柄面等价——reveal 零
            // 文本变更只滚动不移动光标）：显式选区落点取光标侧，无选区
            // 命令（delete-blank-lines）取首个变更起点；拒绝（false）静默
            target.editor.reveal(
              plan.selection !== undefined ? plan.selection.head : plan.changes[0]!.offset,
            )
          })
      })
      .catch(() => {
        // 通道/快照链路异常静默 + debugLog 留痕（对齐同文件 runToggleAutoFormat
        // 的 .catch 形态；审查 C-P3-2 修复——裸 then 链的 rejection 会成为
        // 页面 unhandledrejection）
        debugLog('formatting command pipeline failed (channel/gate) — command dropped, retryable')
      })
  }
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
    handler: (target: AddonViewHandle | null) => void,
  ): void => {
    const handle = deps.commands.register(def, handler)
    registrations.push({ localId, handle, ok: handle.ok, reason: handle.reason })
    if (!handle.ok) debugLog(`command ${localId} register rejected:`, handle.reason)
  }

  register(
    FORMAT_ARTICLE_COMMAND_ID,
    buildFormatArticleCommandDefinition(m.formatArticleTitle),
    runViewCommand(deps, planFormatArticle, 'input.easyTyping.formatArticle'),
  )
  register(
    FORMAT_SELECTION_COMMAND_ID,
    buildFormatSelectionCommandDefinition(m.formatSelectionTitle),
    runViewCommand(deps, planFormatSelection, 'input.easyTyping.formatSelection'),
  )
  register(
    DELETE_BLANK_LINES_COMMAND_ID,
    buildDeleteBlankLinesCommandDefinition(m.deleteBlankLinesTitle),
    runViewCommand(deps, planDeleteBlankLines, 'input.easyTyping.deleteBlankLines'),
  )
  register(
    TOGGLE_AUTO_FORMAT_COMMAND_ID,
    buildToggleAutoFormatCommandDefinition(m.toggleAutoFormatTitle),
    (target) => {
      void target
      runToggleAutoFormat(deps)
    },
  )
  register(
    CONVERT_CODE_BLOCK_COMMAND_ID,
    buildConvertCodeBlockCommandDefinition(m.convertCodeBlockTitle),
    runViewCommand(deps, planConvertCodeBlock, 'input.easyTyping.convertCodeBlock'),
  )

  return {
    outcomes: registrations.map((r) => ({ localId: r.localId, ok: r.ok, ...(r.reason !== undefined ? { reason: r.reason } : {}) })),
    dispose() {
      for (const r of registrations) r.handle.dispose()
    },
  }
}
