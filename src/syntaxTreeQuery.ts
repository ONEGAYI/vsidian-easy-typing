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
// | quote       | v2 行首 quote；callout_title 平台无枚举    | quote*           | 不跳过    |
// | list        | v2 行内任一 list（先于行首 quote）         | list             | 不跳过    |
// | text        | 兜底                                       | text / empty*    | 不跳过    |
// *empty 为行文本全空白的本地补判（LineKind 既有独立 kind，段块邻行排除
// 消费方依赖）。quote* 为惰性延续行门控（评审 P4）：平台树按 GFM 把引用
// 块的顶格续行判 quote，上游 v2 行首语义判 text——LINE_KIND 维度门控回
// text，跳过维度平台原判不门控（上游 v1 quote 分支兜底 text，两侧行为
// 等价）。list 的空行门控（评审 R2-B3）同款：松散列表项间空行平台判
// list（BulletList 父节点覆盖），门控回 empty。
// table 的跳过维度独立出口 = FORMAT_SKIP_BY_PLATFORM——#28 已验收决策
// 「格式化跳过表格行」在树版换传后保持，不翻案。
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

/** 最小行文档（CM6 Text 结构性满足：lines/length/line(n)/lineAt(pos)）。
 * 越界语义对齐 CM6：line(n) 越界抛 RangeError、lineAt(pos) 钳制。 */
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

/** 从行文本数组构造最小行文档（LF 连接；blockScan.scanLines 适配用）。
 * 越界语义对齐 CM6：line(n) 越界抛 RangeError、lineAt(pos) 钳制——空
 * 数组的 lineAt 恒返回空文档首行 {1, 0, 0, ''}（CM6 Text.empty 同款） */
export function docOfLines(texts: readonly string[]): SyntaxDoc {
  const starts: number[] = []
  let cursor = 0
  for (const text of texts) {
    starts.push(cursor)
    cursor += text.length + 1
  }
  const length = Math.max(0, cursor - 1)
  const lineAt = (pos: number): SyntaxDocLine => {
    // 空文档守卫（评审 R2-A3）：无行时 starts 为空，二分索引越界会以
    // undefined/NaN 坐标抛 TypeError——恒返回空文档首行（对齐 CM6）
    if (starts.length === 0) return { number: 1, from: 0, to: 0, text: '' }
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
    line: (n: number) => {
      // 越界守卫（评审 S7）：对齐 CM6 Text.line 的越界语义——越界/非整数
      // 行号抛 RangeError（无守卫时 starts[n-1] 为 undefined 会以 NaN 坐标
      // 静默落入 lineAt 的首行）；lineAt 侧保持钳制语义，两者分工与 CM6 一致
      if (!Number.isInteger(n) || n < 1 || n > texts.length) {
        throw new RangeError(`Line number ${n} is out of range (1-${texts.length})`)
      }
      return lineAt(starts[n - 1]!)
    },
  }
}

/**
 * 从全文文本构造最小行文档（带单槽缓存；评审 R2-B4）：非 All 用户规则
 * 在场时一次输入被行为链驱动约 6 次（autoformat 1 + Input 五族），每次
 * `docOfLines(text.split('\n'))` 的全文 split + 行表构建在 10 万行文档达
 * ms 级——缓存键 = text 字符串相等（同引用 O(1) 命中；行为链同驱动的
 * ctx.snapshot.text 即同引用）。doc 是 text 的纯函数，缓存值只由键决定、
 * 无陈旧语义风险（与被删的 (text,pos) scopeMemo 性质不同：那类缓存键含
 * 可变外部状态）。共享返回对象按接口约定只读，缓存不改变任何行为语义。
 */
let docTextCache: { text: string; doc: SyntaxDoc } | null = null
export function docOfText(text: string): SyntaxDoc {
  if (docTextCache !== null && docTextCache.text === text) return docTextCache.doc
  const doc = docOfLines(text.split('\n'))
  docTextCache = { text, doc }
  return doc
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

/**
 * 平台 kind → LineKind（含 empty 本地补判与两处门控）。
 * 惰性延续行门控（评审 P4）：平台树按 GFM 把引用块的惰性延续行（`> a`
 * 下一行顶格 `b`，无 `>` 前缀）判 quote；上游 v2 是行首 quote 语义
 * （getQuoteInfoInPos 的 quote_regex `^(\s*)(>+) ?` 不匹配 → 判 text）。
 * LINE_KIND 消费维度对 quote kind 且行首无引用前缀的行门控回 text，
 * 对齐上游。松散列表空行门控（评审 R2-B3，与 P4 同款形态）：平台树对
 * 松散列表（loose list）的项间空行判 list（BulletList 父节点区间覆盖
 * 空行）；上游 v2 无父节点语义，空行按行文本判 text——list kind 且
 * 行文本全空白门控回 empty，对齐上游。两处门控都只影响本维度——
 * FORMAT_SKIP（v1/跳过）维度保持平台 kind 原判：上游 v1 的 quote 分支
 * 兜底本就是 text（core.ts:698-742，仅 callout 内代码块升 codeblock，
 * 普通引用行一律 text 不跳过），平台 quote 不跳过，两侧行为等价；
 * list 与 text 的跳过维度均 false，亦无行为差，无需门控。
 */
function lineKindOf(platform: AddonSyntaxLineKind, lineText: string): LineKind {
  if (platform === 'quote' && QUOTE_PREFIX_RE.exec(lineText) === null) return 'text'
  if (platform === 'list' && EMPTY_RE.test(lineText)) return 'empty'
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
    // 惰性延续行（行首无 > 前缀）已由 lineKindOf 门控回 text——进入本分支
    // 的行必有引用前缀，quoteContentStart 的 qm===null 退化口径随之不可达
    const qm = QUOTE_PREFIX_RE.exec(line.text)!
    const cm = CALLOUT_PREFIX_RE.exec(line.text)
    return {
      kind,
      indent: qm[1]!.length,
      markerEnd: 0,
      quoteContentStart: cm ? cm[0].length : qm[0].length,
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

/**
 * 开栏围栏检测（评审 R2-B5）：返回 null = 非开栏；命中返回围栏起始列
 * （含引用前缀）。缩进限 0-3 空格——对齐 CommonMark 围栏缩进上限与仓内
 * ruleScopeFallback 时代 FENCE_LINE `/^ {0,3}/` 先例（原 `/^(\s*)/` 无
 * 上限：4 空格缩进的 ``` 是缩进代码的字面内容，会被误产 CodeBlockInfo，
 * 上游对缩进代码无 codeblock-begin 不产出；制表符计 4 空格同超限拒绝）。
 * 引用前缀先剥（引用内围栏），剥后内容同样受 0-3 上限约束。注意不能经
 * stripQuotePrefix 剥后检测：它对无引用行会连行首缩进一并剥掉，上限就
 * 测不到了——此处只剥引用标记（含其行首空白），保留待检缩进原文。
 */
const FENCE_OPEN_RE = /^( {0,3})([`~]{3,})/
function fenceOpenIndentOf(lineText: string): number | null {
  const ws = lineText.length - lineText.trimStart().length
  const qm = QUOTE_PREFIX_RE.exec(lineText.slice(ws))
  const prefixLen = qm !== null ? ws + qm[0].length : 0
  const open = FENCE_OPEN_RE.exec(lineText.slice(prefixLen))
  return open === null ? null : prefixLen + open[1]!.length
}
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
    const indent = fenceOpenIndentOf(doc.line(n).text)
    if (indent !== null) {
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

/**
 * pos 所在代码块（上游 getCodeBlockInfoInPos：闭区间含围栏两端）；未命中/
 * 查询拒绝 → null。
 *
 * 局部扩展实现（评审 S6 前半，热路径口径）：autoformat 每键入可能经
 * detectScopeViaQuery 的 code 分支触达本函数——原实现经 codeBlocksViaQuery
 * 全文档逐行查询（µs 级查询 × 全文行数，10 万行文档达百毫秒级，与 ModA
 * 的懒查询性能红线同性质）。改为从 pos 行向上下扩展连续 code 行 run：
 * 单次成本 O(pos 行查询 + 所在块行数)。上游 getCodeBlockInfoInPos 消费
 * getCodeBlocksInfos 的全树 iterate 同阶但为树遍历（非查询调用），局部化
 * 对齐其消费语义而避免全文枚举。run 边界与 codeBlocksViaQuery 的「连续
 * code 行」分组完全一致（相邻代码块零分隔行 run 合并语义不变，矩阵第四组
 * 钉住）；run 首行须是围栏标记行（缩进代码无 codeblock-begin，不产出——
 * 上游同款）。
 */
/** codeBlockAtViaQuery 的内部形态（评审 R2-A2）：「查询拒绝」与「pos 不在
 *  块内」可区分——拒绝经 codeScopeAt 传播为整体 null，不吞为无语言 Code */
type CodeBlockLookup = { rejected: true } | { rejected: false; block: CodeBlockInfo | null }

export function codeBlockAtViaQuery(doc: SyntaxDoc, query: SyntaxQuery, pos: number): CodeBlockInfo | null {
  const result = lookupCodeBlockAt(doc, query, pos)
  return result.rejected ? null : result.block
}

function lookupCodeBlockAt(doc: SyntaxDoc, query: SyntaxQuery, pos: number): CodeBlockLookup {
  const clamped = Math.max(0, Math.min(pos, doc.length))
  const posLine = doc.lineAt(clamped).number
  const posKind = platformLineKindAt(doc, query, posLine)
  if (posKind === null) return { rejected: true } // 查询拒绝：不接管
  if (posKind !== 'code') return { rejected: false, block: null }

  // 从 pos 行向上下扩展连续 code 行 run（与 codeBlocksViaQuery 的 run 分组
  // 同一边界；查询拒绝传播为整体拒绝，与全量版拒绝语义一致）
  let startLine = posLine
  for (let i = posLine - 1; i >= 1; i--) {
    const kind = platformLineKindAt(doc, query, i)
    if (kind === null) return { rejected: true }
    if (kind !== 'code') break
    startLine = i
  }
  let endLine = posLine
  for (let i = posLine + 1; i <= doc.lines; i++) {
    const kind = platformLineKindAt(doc, query, i)
    if (kind === null) return { rejected: true }
    if (kind !== 'code') break
    endLine = i
  }

  // run 首行须是围栏标记行（上游同款：缩进代码无 codeblock-begin 不产出
  // ——缩进限 0-3 空格见 fenceOpenIndentOf）
  const indent = fenceOpenIndentOf(doc.line(startLine).text)
  if (indent === null) return { rejected: false, block: null }
  const block = blockInfoOf(doc, startLine, endLine, indent)
  // 闭区间核对（对齐全量版 find 的 [startPos, endPos] 判定与上游
  // start_pos 语义）：pos 在开栏行的围栏前缀内（缩进/引用前缀段，
  // clamped < startPos）不算命中——此时返回 null 而非该块
  return clamped >= block.startPos && clamped <= block.endPos
    ? { rejected: false, block }
    : { rejected: false, block: null }
}

// ---- 作用域判定（上游 syntax.ts detectRuleScope 的查询版） ----

/** 判定结果（对齐上游 ScopeInfo / ruleScopeFallback 的 FallbackScopeInfo） */
export interface ScopeInfo {
  readonly scope: RuleScope
  readonly language?: string
}

/**
 * 光标处作用域；查询拒绝返回 null（「不接管」由消费方解释——拒绝只
 * 发生在非 live/已销毁视图，判定无意义；spec §二拒绝口径：不 fallback
 * 正则）。拒绝来源两处（评审 R2-A2）：首查 lineTypeAt/inlineAt ok:false，
 * 与 code 分支内 codeBlockAtViaQuery 局部扩展中的逐行拒绝——全路径
 * null，不吞为无语言 Code。判定序（上游语义：math 先于 code&&!link）：
 * 1. lineTypeAt formula 或 inlineAt formula → Formula；
 * 2. inlineAt code 且不在链接区段内，或 lineTypeAt code（块级代码上下文，
 *    含围栏行——inlineAt 在其中恒 none）→ Code（语言经
 *    codeBlockAtViaQuery 提取；行内代码无语言）；
 * 3. 其余 → Text。
 * 链接排除（上游 !contains('link') 的组件自判，平台树无 link 节点）：
 * 当前行 wikilink/mdlink 区段内的 code span 判 Text。
 */
export function detectScopeViaQuery(doc: SyntaxDoc, query: SyntaxQuery, pos: number): ScopeInfo | null {
  const clamped = Math.max(0, Math.min(pos, doc.length))
  const line = doc.lineAt(clamped)
  const lineType = query.lineTypeAt(clamped)
  const inline = query.inlineAt(clamped)
  if (!lineType.ok || !inline.ok) return null
  if (lineType.kind === 'formula' || inline.kind === 'formula') {
    return { scope: RuleScope.Formula }
  }
  const inLink = linkSpansOfLine(line.text, line.from).some((s) => clamped >= s.from && clamped < s.to)
  if ((inline.kind === 'code' && !inLink) || lineType.kind === 'code') {
    return codeScopeAt(doc, query, clamped)
  }
  return { scope: RuleScope.Text }
}

/** Code 作用域 + 语言（上游 language || undefined：空串归 undefined）。
 * 查询拒绝（含 codeBlockAtViaQuery 局部扩展中的拒绝，评审 R2-A2）返回
 * null 由 detectScopeViaQuery 传播——spec §二「拒绝全路径 null」口径 */
function codeScopeAt(doc: SyntaxDoc, query: SyntaxQuery, pos: number): ScopeInfo | null {
  const result = lookupCodeBlockAt(doc, query, pos)
  if (result.rejected) return null
  const block = result.block
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
