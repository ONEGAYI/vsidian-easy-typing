// 正则降级的行级块结构扫描（工单 #11——列表/引用块边界识别）。
//
// 上游事实源：easy-typing-obsidian v6.0.9 的树版判定
// keyboard_handlers.ts:512（getPosLineType2）与 syntax.ts:155-201
// （getQuoteInfoInPos——上游本就是纯正则，逐字移植）；段块邻行判定来自
// keyboard_handlers.ts:783-809（getBlockLinesInPos 的 text 判定）。
//
// **降级原因与升级点**：#5（列表/引用块边界的语法树识别）blocked——平台
// experimental.cm6.language 的 syntaxTree 在 live 状态恒为未解析空树
// （vsidian #406 诚实边界），行类型判定退化为行首形态学扫描（对齐 #2/#7
// 正则降级先例）。#5 落地（或平台补树查询能力）后，本模块整体替换为树版
// 判定，调用面（kind/quoteInfoAt/paragraphBlockAt 的形状）保持不变。
//
// 与上游树版的已 documented 差异见 docs/specs/enhance-moda.md「降级口径」：
// - 单行 `$$x$$` 不识别为公式块（树版识别）；
// - 围栏开闭不校验围栏字符/长度配对（``` 与 ~~~ 互相闭合、短 fence 闭合
//   长 fence 均按开闭切换近似）；
// - 列表续行（缩进 ≥2 且上方最近非空行属列表）按形态学归 list——树版按
//   解析归属，边界情形（如缩进 < 2 的续行、续行后接顶格文本）可能不同。
//
// 本模块纯字符串输入（CM6 doc 行文本数组），不 import CM6——可在 node
// 下直接单测。行号口径 1-based（与 doc.line(n) 对齐），数组下标 = 行号-1。

/** 行级类型（降级形态学口径；上游 LineType 的子集 + empty 独立） */
export type LineKind =
  | 'text' // 普通文本（含标题、表格行、水平线——上游 v2 均归 text，不特判）
  | 'empty' // 空行/纯空白（上游 v2 归 text；独立 kind 供段块邻行排除消费）
  | 'list' // 列表标记行或续行
  | 'quote' // 引用前缀行（含 callout 标题行）
  | 'code' // 代码围栏内部（含围栏行）
  | 'formula' // $$ 公式块内部（含围栏行）
  | 'frontmatter' // 文首 --- 围栏内部（含边界行）

/** 单行扫描结果（偏移均为行内偏移） */
export interface LineInfo {
  readonly kind: LineKind
  /** 行首空白长度（空白符计数，制表符计 1） */
  readonly indent: number
  /** 列表标记整长（缩进 + 标记 + 其后一个分隔空白）；续行与非列表行为 0 */
  readonly markerEnd: number
  /** 引用行内容起点（跳过 > 前缀或 callout 标记）；非引用行为 null */
  readonly quoteContentStart: number | null
}

/** 列表标记（上游 handleModA 的 reg_list 逐字移植：无序/有序/任务项，标记后须有空白） */
export const LIST_MARKER_RE = /^(\s*)([-*+] \[[^\]]\]|[-*+]|\d+\.)\s/
/** 引用前缀（上游 getQuoteInfoInPos 的 quote_regex 逐字移植） */
export const QUOTE_PREFIX_RE = /^(\s*)(>+) ?/
/** callout 标记（上游 getQuoteInfoInPos 的 callout_regex 逐字移植） */
export const CALLOUT_PREFIX_RE = /^(\s*)(>)+ \[![^\s]+\][+-]? ?/
/** 标题行（上游 getBlockLinesInPos 的 reg_headings 逐字移植——仅 ATX 形态） */
export const HEADING_RE = /^#+ /
/** 代码围栏标记（降级口径：任意缩进的 ```/~~~ 开行；上游树版不涉正则） */
export const FENCE_MARKER_RE = /^\s*(?:`{3,}|~{3,})/
/** 公式块围栏标记（降级口径：整行为 $$；单行 $$x$$ 不识别） */
export const FORMULA_MARKER_RE = /^\s*\$\$\s*$/

const EMPTY_RE = /^\s*$/
/** 列表续行的缩进阈值（对齐上游整列表扫描的 `indent >= 2` 判定） */
const CONTINUATION_MIN_INDENT = 2

const PLAIN_LINE: LineInfo = Object.freeze({
  kind: 'text',
  indent: 0,
  markerEnd: 0,
  quoteContentStart: null,
}) as LineInfo

/**
 * 全文档行扫描：围栏/公式/frontmatter 代状态 + 列表标记/续行 + 引用前缀。
 * O(行数) 单遍；调用方（按键/命令）每次决策扫描一次，与上游树版单次
 * 查询的代价模型同阶（不缓存——文档随时变更，正确性优先）。
 */
export function scanLines(texts: readonly string[]): LineInfo[] {
  const result: LineInfo[] = []
  let inCode = false
  let inFormula = false
  let inFrontmatter = texts.length > 0 && texts[0]!.trim() === '---'

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!

    // frontmatter 代（含边界行；未闭合延续到文末）
    if (inFrontmatter) {
      result.push(frontmatterLine())
      if (i > 0 && text.trim() === '---') inFrontmatter = false
      continue
    }

    // 围栏代：标记行切换，内部行一律 code（优先于一切行首形态）
    if (FENCE_MARKER_RE.test(text)) {
      result.push(codeLine(text))
      inCode = !inCode
      continue
    }
    if (inCode) {
      result.push(codeLine(text))
      continue
    }

    // 公式块代（$$ 整行开闭；不嵌套、不与围栏并存）
    if (FORMULA_MARKER_RE.test(text)) {
      result.push(formulaLine())
      inFormula = !inFormula
      continue
    }
    if (inFormula) {
      result.push(formulaLine())
      continue
    }

    if (EMPTY_RE.test(text)) {
      result.push(emptyLine(text))
      continue
    }

    const quoteMatch = text.match(QUOTE_PREFIX_RE)
    if (quoteMatch) {
      const calloutMatch = text.match(CALLOUT_PREFIX_RE)
      result.push({
        kind: 'quote',
        indent: quoteMatch[1]!.length,
        markerEnd: 0,
        quoteContentStart: calloutMatch ? calloutMatch[0].length : quoteMatch[0].length,
      })
      continue
    }

    const listMatch = text.match(LIST_MARKER_RE)
    if (listMatch) {
      result.push({
        kind: 'list',
        indent: listMatch[1]!.length,
        markerEnd: listMatch[0].length,
        quoteContentStart: null,
      })
      continue
    }

    // 续行近似：缩进 ≥2 且上方最近非空行已属列表结构（标记行或续行）
    const indent = countIndent(text)
    if (indent >= CONTINUATION_MIN_INDENT && nearestNonEmptyKind(result) === 'list') {
      result.push({ kind: 'list', indent, markerEnd: 0, quoteContentStart: null })
      continue
    }

    result.push({ ...PLAIN_LINE, indent })
  }
  return result
}

/** 引用块信息（上游 getQuoteInfoInPos 逐字移植；行号 1-based） */
export interface QuoteInfo {
  /** 整个引用块首行（callout 上溯不 break——上游语义：上方 callout 标题行并入） */
  readonly startLine: number
  /** 末行（下方连续引用行） */
  readonly endLine: number
  /** 当前行内容起点（行内偏移；callout 标题行跳过 callout 标记） */
  readonly contentStart: number
  /** 当前行或上方邻接行含 callout 标记 */
  readonly isCallout: boolean
}

/** 当前行的引用块信息；非引用行返回 null（上游：lineAt(pos) 不匹配 quote_regex） */
export function quoteInfoAt(
  texts: readonly string[],
  scan: readonly LineInfo[],
  lineNumber: number,
): QuoteInfo | null {
  const idx = lineNumber - 1
  const info = scan[idx]
  if (!info || info.kind !== 'quote') return null

  // 下方：连续引用行
  let endLine = lineNumber
  for (let i = idx + 1; i < texts.length; i++) {
    if (scan[i]!.kind === 'quote') endLine = i + 1
    else break
  }
  // 上方：引用行/callout 行连续扩展；callout 分支不 break（上游注释掉的 break）
  let startLine = lineNumber
  let isCallout = false
  for (let i = idx; i >= 0; i--) {
    if (CALLOUT_PREFIX_RE.test(texts[i]!)) {
      isCallout = true
      startLine = i + 1
    } else if (QUOTE_PREFIX_RE.test(texts[i]!)) {
      startLine = i + 1
    } else {
      break
    }
  }
  return { startLine, endLine, contentStart: info.quoteContentStart ?? 0, isCallout }
}

/** 段块范围（行号 1-based，闭区间） */
export interface BlockRange {
  readonly startLine: number
  readonly endLine: number
}

/**
 * 光标所在文本段块（上游 getBlockLinesInPos 降级）：当前行无条件入块；
 * 邻行仅收纳 kind=text 且非空且非标题（`^#+ `）的行。
 */
export function paragraphBlockAt(
  texts: readonly string[],
  scan: readonly LineInfo[],
  lineNumber: number,
): BlockRange {
  let startLine = lineNumber
  let endLine = lineNumber
  for (let i = lineNumber - 2; i >= 0; i--) {
    const line = texts[i]!
    if (scan[i]!.kind === 'text' && line !== '' && !HEADING_RE.test(line)) {
      startLine = i + 1
      continue
    }
    break
  }
  for (let i = lineNumber; i < texts.length; i++) {
    const line = texts[i]!
    if (scan[i]!.kind === 'text' && line !== '' && !HEADING_RE.test(line)) {
      endLine = i + 1
      continue
    }
    break
  }
  return { startLine, endLine }
}

// ---- 内部工具 ----

function countIndent(text: string): number {
  const match = text.match(/^\s*/)
  return match ? match[0].length : 0
}

/** 上方最近非空行的 kind（无则 null）——续行归属判定 */
function nearestNonEmptyKind(scan: readonly LineInfo[]): LineKind | null {
  for (let i = scan.length - 1; i >= 0; i--) {
    if (scan[i]!.kind !== 'empty') return scan[i]!.kind
  }
  return null
}

function codeLine(text: string): LineInfo {
  return { kind: 'code', indent: countIndent(text), markerEnd: 0, quoteContentStart: null }
}

function formulaLine(): LineInfo {
  return { kind: 'formula', indent: 0, markerEnd: 0, quoteContentStart: null }
}

function frontmatterLine(): LineInfo {
  return { kind: 'frontmatter', indent: 0, markerEnd: 0, quoteContentStart: null }
}

function emptyLine(text: string): LineInfo {
  return { kind: 'empty', indent: countIndent(text), markerEnd: 0, quoteContentStart: null }
}
