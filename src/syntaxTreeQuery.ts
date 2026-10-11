// 树版语法查询核心（工单 #5 切片 A）：平台 experimental.syntax 位置查询 →
// 上游 easy-typing 树版判定语义的适配层。
//
// 事实源指针：
// - 平台查询面：vsidian src/shared/addonSyntaxApi.ts（PR #433/#434，B+
//   形态——位置驱动单点查询，不暴露树/节点句柄；类型经 types/vendor/
//   shared/addonSyntaxApi.ts 快照消费）；语义对照文档 vsidian
//   docs/addons/developer-guide.md §4.8。
// - 上游语义（easy-typing-obsidian v6.0.9）：行级判定 core.ts:748-788
//   （getPosLineType2，v2/ModA 维度）与 core.ts:658-745（getPosLineType，
//   v1/格式化跳过维度）；块信息 syntax.ts:85-153（getCodeBlocksInfos）；
//   作用域 syntax.ts:208-225（detectRuleScope）。
// - 映射分叉决策与已知口径差异：探索笔记 exploration-5-syntax-line-types.md
//   §四（vsidian 平台树与上游树的结构性差异）。
//
// 票面 checkbox 1「HyperMD 节点名 → VSCode Lezer 节点名映射表」的落地
// 形态：#434 不暴露节点名（nodeNames 非稳定诊断载荷），映射的左端是上游
// 判定行为而非节点名串。平台 kind → 消费维度投影的对照表如下（HyperMD
// 节点名/上游行为作语义来源列）：
//
// | 平台 kind   | 上游语义来源（HyperMD 节点/行为）          | v2/ModA LineKind | 格式化跳过 |
// |-------------|------------------------------------------|------------------|-----------|
// | frontmatter | hmd-frontmatter（v1/v2 首查）             | frontmatter      | 跳过      |
// | code        | codeblock-begin/end，全行 codeblock       | code             | 跳过      |
// | formula     | math 全行（v1/v2 全行校验）               | formula          | 跳过      |
// | table       | v1 特判 table；v2 不特判（归 text）        | text             | 跳过（#28 不翻案）|
// | heading     | v1/v2 均不特判（归 text）                  | text             | 不跳过    |
// | quote       | v2 行首 quote；callout_title 平台无枚举    | quote            | 不跳过    |
// | list        | v2 行内任一 list（先于行首 quote）         | list             | 不跳过    |
// | text        | 兜底                                       | text / empty*    | 不跳过    |
// *empty 为行文本全空白的本地补判（LineKind 既有独立 kind，段块邻行排除
// 消费方依赖）。table 的跳过维度独立出口 = FORMAT_SKIP_BY_PLATFORM——#28
// 已验收决策「格式化跳过表格行」在树版换传后保持，不翻案。
//
// 已知平台口径差异（消费面按平台语义，vsidian developer-guide §4.8）：
// - 嵌套优先级 code > table > heading > list > quote：引用内表格/标题行的
//   内容位置判 table/heading（上游 v2 归 quote），v2 维度投影为 text；
// - 平台树无 wikilink/mdlink 节点（反引号是真 InlineCode）：上游
//   !contains('link') 的链接排除由本模块 linkSpansOfLine 组件自判补齐
//   （developer-guide §4.8「组件自判」先例）；
// - fm 是源码态：inlineAt 在 fm 内恒 none；
// - 未闭合 $$ 块与未闭合 frontmatter 按普通文本处理（平台稳定降级）。
import type {
  AddonSyntaxInlineResult,
  AddonSyntaxLineKind,
  AddonSyntaxLineTypeResult,
} from '../types/vendor/shared/addonSyntaxApi'
import type { LineInfo, LineKind } from './blockScan'
import { REG_MDLINK, REG_WIKILINK } from './formatting/inlineParts'
import { RuleScope } from './rules/rule-engine'

/**
 * 平台查询适配器（instanceId 已闭包绑定的位置查询；测试注入 fake）。
 * 生产装配（切片 B）：page-editor 持 instanceId，包一层
 * sdk.experimental.syntax 的 lineTypeAt/inlineAt 即得本接口；
 * 拒绝（ok:false）语义见 exploration 笔记 §5.4——消费面按「不接管」
 * 处理，不 fallback 正则。
 */
export interface SyntaxQuery {
  lineTypeAt(pos: number): AddonSyntaxLineTypeResult
  inlineAt(pos: number): AddonSyntaxInlineResult
}

/** 最小行文档（CM6 Text 结构性满足：lines/length/line(n)/lineAt(pos)） */
export interface SyntaxDoc {
  readonly lines: number
  readonly length: number
  line(number: number): SyntaxDocLine
  lineAt(pos: number): SyntaxDocLine
}

export interface SyntaxDocLine {
  readonly number: number
  readonly from: number
  readonly to: number
  readonly text: string
}

/** 从行文本数组构造最小行文档（LF 连接；blockScan.scanLines 适配用） */
export function docOfLines(texts: readonly string[]): SyntaxDoc {
  const starts: number[] = []
  let cursor = 0
  for (const text of texts) {
    starts.push(cursor)
    cursor += text.length + 1
  }
  const length = Math.max(0, cursor - 1)
  const lineAt = (pos: number): SyntaxDocLine => {
    const clamped = Math.max(0, Math.min(pos, length))
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= clamped) lo = mid
      else hi = mid - 1
    }
    const from = starts[lo]!
    return { number: lo + 1, from, to: from + texts[lo]!.length, text: texts[lo]! }
  }
  return {
    lines: texts.length,
    length,
    lineAt,
    line: (n: number) => lineAt(starts[n - 1]!),
  }
}

// ---- 行内形态学正则（自 blockScan 移入 #5；行内几何与上游逐字语义不动）----

/** 列表标记（上游 handleModA 的 reg_list 逐字移植：无序/有序/任务项，标记后须有空白） */
export const LIST_MARKER_RE = /^(\s*)([-*+] \[[^\]]\]|[-*+]|\d+\.)\s/
/** 引用前缀（上游 getQuoteInfoInPos 的 quote_regex 逐字移植） */
export const QUOTE_PREFIX_RE = /^(\s*)(>+) ?/
/** callout 标记（上游 getQuoteInfoInPos 的 callout_regex 逐字移植） */
export const CALLOUT_PREFIX_RE = /^(\s*)(>)+ \[![^\s]+\][+-]? ?/
/** 标题行（上游 getBlockLinesInPos 的 reg_headings 逐字移植——仅 ATX 形态） */
export const HEADING_RE = /^#+ /

const EMPTY_RE = /^\s*$/

/** 行首空白长度（空白符计数，制表符计 1） */
function countIndent(text: string): number {
  const match = text.match(/^\s*/)
  return match ? match[0].length : 0
}

/** 剥离行首空白 + 引用前缀（一组 > 与其后一个可选空格）；无引用则原样 */
function stripQuotePrefix(text: string): { text: string; prefix: number } {
  const ws = text.length - text.trimStart().length
  const qm = QUOTE_PREFIX_RE.exec(text.slice(ws))
  const prefix = qm ? ws + qm[0].length : ws
  return { text: text.slice(prefix), prefix }
}

/**
 * 行代表位置：行首空白 + 引用前缀之后的第一个内容位置。平台嵌套优先级
 * 下两位置各判各的（`> - item` 前缀处 quote、内容处 list）——取内容位置
 * 对齐上游 v2「行内任一 list 先于行首 quote」；缩进公式/围栏行也因此落
 * 在块区间内（行首 `$$` 剥缩进起算）。
 */
function representativePosOf(line: SyntaxDocLine): number {
  return line.from + stripQuotePrefix(line.text).prefix
}

// ---- 映射常量（消费维度投影；对照表见模块头注释） ----

/** 平台 kind → LineKind（v2/ModA 消费维度：table/heading 归 text——上游 v2 不特判） */
export const LINE_KIND_BY_PLATFORM: Readonly<Record<AddonSyntaxLineKind, LineKind>> = Object.freeze({
  frontmatter: 'frontmatter',
  code: 'code',
  formula: 'formula',
  table: 'text',
  heading: 'text',
  quote: 'quote',
  list: 'list',
  text: 'text',
})

/** 平台 kind → 格式化跳过布尔（v1/格式化跳过消费维度；#28「跳过表格行」不翻案） */
export const FORMAT_SKIP_BY_PLATFORM: Readonly<Record<AddonSyntaxLineKind, boolean>> = Object.freeze({
  frontmatter: true,
  code: true,
  formula: true,
  table: true,
  heading: false,
  quote: false,
  list: false,
  text: false,
})

/** 行的平台原始 kind（跳过维度消费入口；查询拒绝返回 null） */
export function platformLineKindAt(
  doc: SyntaxDoc,
  query: SyntaxQuery,
  lineNumber: number,
): AddonSyntaxLineKind | null {
  const result = query.lineTypeAt(representativePosOf(doc.line(lineNumber)))
  return result.ok ? result.kind : null
}

/** 平台 kind → LineKind（含 empty 本地补判） */
function lineKindOf(platform: AddonSyntaxLineKind, lineText: string): LineKind {
  if (platform === 'text' && EMPTY_RE.test(lineText)) return 'empty'
  return LINE_KIND_BY_PLATFORM[platform]
}

/**
 * 单行查询：一行 → LineInfo（查询拒绝返回 null）。kind = 平台 kind 经
 * 映射表投影 + 本地补判；行内几何（indent/markerEnd/quoteContentStart）
 * 从行文本正则计算——行内形态学与树无关（上游同款正则）。
 */
export function lineInfoAt(doc: SyntaxDoc, query: SyntaxQuery, lineNumber: number): LineInfo | null {
  const line = doc.line(lineNumber)
  const platform = platformLineKindAt(doc, query, lineNumber)
  if (platform === null) return null
  const kind = lineKindOf(platform, line.text)

  if (kind === 'quote') {
    const qm = QUOTE_PREFIX_RE.exec(line.text)
    const cm = CALLOUT_PREFIX_RE.exec(line.text)
    return {
      kind,
      indent: qm ? qm[1]!.length : countIndent(line.text),
      markerEnd: 0,
      quoteContentStart: qm ? (cm ? cm[0].length : qm[0].length) : null,
    }
  }
  if (kind === 'list') {
    // 引用内列表：markerEnd 含引用前缀（标记从内容区起算）
    const base = stripQuotePrefix(line.text).prefix
    const lm = LIST_MARKER_RE.exec(line.text.slice(base))
    return {
      kind,
      indent: countIndent(line.text),
      markerEnd: lm ? base + lm[0].length : 0,
      quoteContentStart: null,
    }
  }
  return {
    kind,
    indent: kind === 'code' || kind === 'empty' ? countIndent(line.text) : 0,
    markerEnd: 0,
    quoteContentStart: null,
  }
}

/**
 * 全文档行扫描（查询版，替代 #11 正则状态机）：逐行 lineInfoAt。
 * 任一行查询拒绝 → 整体 null（「不接管」语义由消费方解释）。
 */
export function scanLinesViaQuery(doc: SyntaxDoc, query: SyntaxQuery): LineInfo[] | null {
  const out: LineInfo[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const info = lineInfoAt(doc, query, n)
    if (info === null) return null
    out.push(info)
  }
  return out
}

// ---- 代码块信息（上游 syntax.ts getCodeBlocksInfos 的查询版） ----

/** 代码块信息（上游 CodeBlockInfo 同形状，camelCase；start/end 为闭区间端点） */
export interface CodeBlockInfo {
  /** 开栏围栏起始位置（含引用前缀后的围栏列） */
  readonly startPos: number
  /** 闭栏行尾（未闭合为文末） */
  readonly endPos: number
  readonly codeStartPos: number
  readonly codeEndPos: number
  /** 开栏信息串 trim 后小写（上游整串保留，不取首词） */
  readonly language: string
  /** 围栏起始列（含引用前缀；上游 start_pos - line.from 同义） */
  readonly indent: number
}

/** 开栏围栏（上游 fenceMatch [`~]{3,} 同款；引用前缀先剥——引用内围栏） */
const FENCE_OPEN_RE = /^(\s*)([`~]{3,})/
/** 闭栏形态（围栏字符 + 余白；信息串只允许出现在开栏） */
const FENCE_CLOSE_RE = /^\s*[`~]{3,}\s*$/

/**
 * 全部代码块信息（查询版）：按行平台 kind 分组连续 code 行，run 首行须
 * 是围栏标记行（缩进代码无 codeblock-begin，不产出——上游同款）；语言/
 * 缩进从开栏行文本提取；run 末行是闭栏形态则闭合，否则未闭合延至文末
 * （``` 与 ~~~ 混用不互闭由平台树保证）。查询拒绝 → null。
 */
export function codeBlocksViaQuery(doc: SyntaxDoc, query: SyntaxQuery): CodeBlockInfo[] | null {
  const kinds: AddonSyntaxLineKind[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const platform = platformLineKindAt(doc, query, n)
    if (platform === null) return null
    kinds.push(platform)
  }
  const out: CodeBlockInfo[] = []
  let n = 1
  while (n <= doc.lines) {
    if (kinds[n - 1] !== 'code') {
      n += 1
      continue
    }
    let end = n
    while (end + 1 <= doc.lines && kinds[end] === 'code') end += 1
    const openLine = doc.line(n)
    const openEff = stripQuotePrefix(openLine.text)
    const open = FENCE_OPEN_RE.exec(openEff.text)
    if (open) {
      const indent = openEff.prefix + open[1]!.length
      out.push(blockInfoOf(doc, n, end, indent))
    }
    n = end + 1
  }
  return out
}

/** 单块区间计算（上游 getCodeBlocksInfos 的开闭分支同款语义） */
function blockInfoOf(doc: SyntaxDoc, startLine: number, endLine: number, indent: number): CodeBlockInfo {
  const openLine = doc.line(startLine)
  const closeLine = doc.line(endLine)
  const language = stripQuotePrefix(openLine.text)
    .text.trim()
    .replace(/^[`~]{3,}/, '')
    .trim()
    .toLowerCase()
  const closed =
    endLine > startLine && FENCE_CLOSE_RE.test(stripQuotePrefix(closeLine.text).text)
  const startPos = openLine.from + indent
  const endPos = closeLine.to
  // 相邻开闭栏（空代码体）：codeStart = codeEnd = 开栏行尾（上游同款）；
  // 多行体：codeStart = 首内容行行首 + 缩进（超短行钳制行尾），codeEnd =
  // 闭栏前一行行尾；未闭合块 codeEnd = 文末（= 末行行尾）
  const codeStartPos =
    endLine <= startLine + 1
      ? openLine.to
      : Math.min(doc.line(startLine + 1).from + indent, doc.line(startLine + 1).to)
  const codeEndPos = endLine <= startLine + 1 ? openLine.to : closed ? doc.line(endLine - 1).to : closeLine.to
  return { startPos, endPos, codeStartPos, codeEndPos, language, indent }
}

/** pos 所在代码块（上游 getCodeBlockInfoInPos：闭区间含围栏两端）；未命中/查询拒绝 → null */
export function codeBlockAtViaQuery(doc: SyntaxDoc, query: SyntaxQuery, pos: number): CodeBlockInfo | null {
  const blocks = codeBlocksViaQuery(doc, query)
  if (blocks === null) return null
  const clamped = Math.max(0, Math.min(pos, doc.length))
  return blocks.find((b) => clamped >= b.startPos && clamped <= b.endPos) ?? null
}

// ---- 作用域判定（上游 syntax.ts detectRuleScope 的查询版） ----

/** 判定结果（对齐上游 ScopeInfo / ruleScopeFallback 的 FallbackScopeInfo） */
export interface ScopeInfo {
  readonly scope: RuleScope
  readonly language?: string
}

/**
 * 光标处作用域。判定序（上游语义：math 先于 code&&!link）：
 * 1. lineTypeAt formula 或 inlineAt formula → Formula；
 * 2. inlineAt code 且不在链接区段内 → Code（语言经 codeBlockAtViaQuery
 *    提取；行内代码无语言）；
 * 3. lineTypeAt code（块级代码上下文，含围栏行；inlineAt 在其中恒 none）
 *    → Code（语言同上）；
 * 4. 其余 → Text。
 * 链接排除（上游 !contains('link') 的组件自判，平台树无 link 节点）：
 * 当前行 wikilink/mdlink 区段内的 code span 判 Text。查询拒绝 → Text
 * （拒绝只发生在非 live/已销毁视图，判定无意义；「不接管」由消费方解释）。
 */
export function detectScopeViaQuery(doc: SyntaxDoc, query: SyntaxQuery, pos: number): ScopeInfo {
  const clamped = Math.max(0, Math.min(pos, doc.length))
  const line = doc.lineAt(clamped)
  const lineType = query.lineTypeAt(clamped)
  const inline = query.inlineAt(clamped)
  if (!lineType.ok || !inline.ok) {
    return { scope: RuleScope.Text }
  }
  if (lineType.kind === 'formula' || inline.kind === 'formula') {
    return { scope: RuleScope.Formula }
  }
  const inLink = linkSpansOfLine(line.text, line.from).some((s) => clamped >= s.from && clamped < s.to)
  if (inline.kind === 'code' && !inLink) {
    return codeScopeAt(doc, query, clamped)
  }
  if (lineType.kind === 'code') {
    return codeScopeAt(doc, query, clamped)
  }
  return { scope: RuleScope.Text }
}

/** Code 作用域 + 语言（上游 language || undefined：空串归 undefined） */
function codeScopeAt(doc: SyntaxDoc, query: SyntaxQuery, pos: number): ScopeInfo {
  const block = codeBlockAtViaQuery(doc, query, pos)
  return block && block.language !== ''
    ? { scope: RuleScope.Code, language: block.language }
    : { scope: RuleScope.Code }
}

// ---- 链接区段（链接排除的单一事实源；切片 B inlineParts 树版分区复用） ----

/** 链接区段（全文偏移，[from, to)） */
export interface LinkSpan {
  readonly from: number
  readonly to: number
}

/**
 * 一行文本的 wikilink/mdlink 区段列表（上游 splitTextWithLinkAndUserDefined
 * 正则逐字，经 inlineParts 的 REG_WIKILINK/REG_MDLINK 单一事实源；g 旗标
 * 用前用后重置 lastIndex）。平台树无 link 节点——链接排除的组件自判统一
 * 走本函数，detectScopeViaQuery 与切片 B 的 inlineParts 不各写一份。
 */
export function linkSpansOfLine(lineText: string, lineFrom: number): LinkSpan[] {
  const spans: LinkSpan[] = []
  for (const reg of [REG_WIKILINK, REG_MDLINK]) {
    reg.lastIndex = 0
    for (let m = reg.exec(lineText); m !== null; m = reg.exec(lineText)) {
      spans.push({ from: lineFrom + m.index, to: lineFrom + reg.lastIndex })
    }
    reg.lastIndex = 0
  }
  return spans
}
