// EnhanceModA 渐进选择状态机与「选择当前块」决策（工单 #11；#5 切片 B
// 懒查询改造）——上游 easy-typing-obsidian keyboard_handlers.ts:509-676
//（handleModA）与 815-825（selectBlockInCursor，原拼写 selectBlockInCurser）移植。
//
// **无外部状态的渐进设计（上游语义）**：状态机不持有跨按键状态——每次
// 按键从「当前选区 vs 层级档位区间」的包含关系推断所在层级并推进一档；
// 连续性断开（光标移动/编辑后选区不再整含任何档位）自然回落首档。返回
// null = 不接管，透传平台原生 Mod+A 全选。
//
// 分支与层级（上游三分支，互斥优先级：文本 → 引用 → 列表）：
// - 文本行：行 → 段块 →（透传=平台全选；「全文」档由透传达成）；
// - 引用行：引用行内容 → 引用块 →（透传）；
// - 列表标记行：内容 → 当前行及子列表 → 整列表 → 全文 →（透传）；
// - 列表续行：内容 → 起点项标记后内容（anchor 落回标记行，此后按标记行
//   分支继续升档）。
//
// **懒查询（#5 切片 B，性能红线）**：行类型判定 = anchor 行单点查 +
// 段块/引用块/列表块邻行逐行局部查（lineInfoAt）——单键成本
// O(anchor 查询 + 块局部行数)，**不预扫全文**（查询版 µs×全文行数在
// 10 万行文档达百毫秒级，不可接受；正则全文扫描的旧形态已随 #5 删除）。
// SyntaxDoc 直接用 state.doc（CM6 Text 结构性满足）。上游本就是行文本
// 正则的判定（getQuoteInfoInPos 的 quote_regex、handleModA 列表扩展的
// /^\s*/ 缩进）保留纯行文本计算，不消耗查询。
// 查询拒绝（非 live/已销毁视图）→ 返回 null 不接管（不 fallback 正则，
// #33 拆防御链先例，exploration 笔记 §5.4）。多选区按主选区处理
// （上游 selection.main），派发后收敛为单选区。
import type { EditorState } from '@codemirror/state'
import { LIST_MARKER_RE, paragraphBlockAt, quoteInfoAt } from './blockScan'
import { lineInfoAt, type SyntaxDoc, type SyntaxQuery } from './syntaxTreeQuery'

/** 选区目标（LF 偏移，anchor/head 与 CM6 语义一致） */
export interface SelectionRange {
  readonly anchor: number
  readonly head: number
}

/** 缩进围栏（上游列表续行分支的 reg_code_block：≥1 空白后 ```） */
const INDENTED_FENCE_RE = /^\s+```/

/** Mod+A 渐进选择决策：null = 透传平台全选 */
export function planModASelection(state: EditorState, query: SyntaxQuery): SelectionRange | null {
  const selection = state.selection.main
  const doc = state.doc
  const anchorLine = doc.lineAt(selection.anchor)
  const headLine = doc.lineAt(selection.head)
  const anchorInfo = lineInfoAt(doc, query, anchorLine.number)
  if (anchorInfo === null) return null // 查询拒绝：不接管
  const anchorKind = anchorInfo.kind

  // ---- 文本分支（空行与标题行按上游 v2 归 text 参与本分支）----
  // 「当前行」取 anchor 所在行、「段块」取 head 所在行扩展（上游口径）。
  if (anchorKind === 'text' || anchorKind === 'empty') {
    const block = paragraphBlockAt(doc, query, headLine.number)
    if (block === null) return null // 查询拒绝：不接管
    const blockStart = doc.line(block.startLine)
    const blockEnd = doc.line(block.endLine)
    // 已整含段块（含超集）→ 透传
    if (selection.anchor <= blockStart.from && selection.head >= blockEnd.to) return null
    // 恰选当前行 → 升档为段块；单行段块无处可升 → 透传
    if (selection.anchor === anchorLine.from && selection.head === anchorLine.to) {
      if (block.startLine !== block.endLine) {
        return { anchor: blockStart.from, head: blockEnd.to }
      }
      return null
    }
    // 首按：规整为当前整行（正向）
    return { anchor: anchorLine.from, head: anchorLine.to }
  }

  // ---- 引用分支（head 所在行匹配引用前缀即接管；上游 getQuoteInfoInPos
  // 纯行文本正则，不查行类型；callout 标题行含内）----
  const quote = quoteInfoAt(doc, headLine.number)
  if (quote !== null) {
    const blockStart = doc.line(quote.startLine).from
    const blockEnd = doc.line(quote.endLine).to
    const curStart = headLine.from + quote.contentStart
    const curEnd = headLine.to
    // 精确等值判定（上游口径，非包含判定）：整块 → 透传；当前行内容 → 整块；
    // 其余（含跨行/超集选区）→ 首按当前行内容
    if (selection.anchor === blockStart && selection.head === blockEnd) return null
    if (selection.anchor === curStart && selection.head === curEnd) {
      return { anchor: blockStart, head: blockEnd }
    }
    return { anchor: curStart, head: curEnd }
  }

  // ---- 列表分支（anchor 所在行为列表标记行或续行）----
  if (anchorKind === 'list') {
    return planListSelection(state, doc, query, anchorLine)
  }

  // 代码围栏 / 公式块 / frontmatter 内：不接管（上游 BetterCodeEdit 的
  // 代码块选中属另一功能族，不在本票范围）
  return null
}

/** 「选择当前块」决策：空/纯空白行无操作（null），否则段块整选 */
export function planSelectBlock(state: EditorState, query: SyntaxQuery): SelectionRange | null {
  const selection = state.selection.main
  const headLine = state.doc.lineAt(selection.head)
  if (/^\s*$/.test(headLine.text)) return null
  const block = paragraphBlockAt(state.doc, query, headLine.number)
  if (block === null) return null // 查询拒绝：不接管
  return {
    anchor: state.doc.line(block.startLine).from,
    head: state.doc.line(block.endLine).to,
  }
}

// ---- 列表分支（上游 handleModA L569-670 逐段移植）----

/** 行是否列表行（懒查询；查询拒绝返回 null——整体不接管） */
function isListLine(doc: SyntaxDoc, query: SyntaxQuery, lineNumber: number): boolean | null {
  const info = lineInfoAt(doc, query, lineNumber)
  return info === null ? null : info.kind === 'list'
}

function planListSelection(
  state: EditorState,
  doc: SyntaxDoc,
  query: SyntaxQuery,
  anchorLine: { number: number; from: number; to: number },
): SelectionRange | null {
  const selection = state.selection.main
  const anchorText = doc.line(anchorLine.number).text
  const listMatch = anchorText.match(LIST_MARKER_RE)

  // 续行（无标记）：内容 → 起点项标记后内容（此后 anchor 落回标记行）
  if (!listMatch) {
    if (INDENTED_FENCE_RE.test(anchorText)) return null
    const curIndent = countIndent(anchorText)
    const content: SelectionRange = { anchor: anchorLine.from + curIndent, head: anchorLine.to }
    // 上溯最近列表行（上游 getPosLineType2 == list——逐行局部查询）
    let startLine = anchorLine.number
    for (let i = anchorLine.number - 1; i >= 1; i--) {
      const isList = isListLine(doc, query, i)
      if (isList === null) return null // 查询拒绝：不接管
      if (isList) {
        startLine = i
        break
      }
    }
    const startMatch = doc.line(startLine).text.match(LIST_MARKER_RE)
    const startOffset = startMatch ? startMatch[0].length : 0
    const fromItem: SelectionRange = { anchor: doc.line(startLine).from + startOffset, head: anchorLine.to }
    if (selection.anchor <= content.anchor && selection.head >= content.head) return fromItem
    return content
  }

  // 标记行：内容 → 当前行及子列表 → 整列表（与子列表同区间时去重）→ 全文
  const curIndent = listMatch[1]!.length
  const levels: SelectionRange[] = []
  // 档 1：当前行内容（不含标记）
  levels.push({ anchor: anchorLine.from + listMatch[0].length, head: anchorLine.to })
  // 档 2：当前行及其子列表（下方缩进严格更深者连续纳入——行文本 /^\s*/
  // 缩进，上游同款，不消耗查询）
  let childEndLine = anchorLine.number
  for (let i = anchorLine.number + 1; i <= doc.lines; i++) {
    if (countIndent(doc.line(i).text) <= curIndent) break
    childEndLine = i
  }
  const childRange: SelectionRange = { anchor: anchorLine.from, head: doc.line(childEndLine).to }
  levels.push(childRange)
  // 档 3：整列表（上方/下方按「列表行或缩进 ≥2」连续扩展；缩进先行短路
  // 减少查询次数）
  let startLine = anchorLine.number
  for (let i = anchorLine.number - 1; i >= 1; i--) {
    const text = doc.line(i).text
    if (countIndent(text) >= 2) {
      startLine = i
      continue
    }
    const isList = isListLine(doc, query, i)
    if (isList === null) return null // 查询拒绝：不接管
    if (isList) startLine = i
    else break
  }
  let endLine = anchorLine.number
  for (let i = anchorLine.number + 1; i <= doc.lines; i++) {
    const text = doc.line(i).text
    if (countIndent(text) >= 2) {
      endLine = i
      continue
    }
    const isList = isListLine(doc, query, i)
    if (isList === null) return null // 查询拒绝：不接管
    if (isList) endLine = i
    else break
  }
  const wholeRange: SelectionRange = { anchor: doc.line(startLine).from, head: doc.line(endLine).to }
  if (wholeRange.anchor !== childRange.anchor || wholeRange.head !== childRange.head) {
    levels.push(wholeRange)
  }
  // 档 4：全文
  levels.push({ anchor: 0, head: doc.length })

  // 从后往前找被整含的档，推进一档；末档之上 → 透传
  let hit = -1
  for (let i = levels.length - 1; i >= 0; i--) {
    const level = levels[i]!
    if (selection.anchor <= level.anchor && selection.head >= level.head) {
      hit = i
      break
    }
  }
  if (hit + 1 < levels.length) return levels[hit + 1]!
  return null
}

// ---- 内部工具 ----

function countIndent(text: string): number {
  const match = text.match(/^\s*/)
  return match ? match[0].length : 0
}
