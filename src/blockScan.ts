// 行级块结构扫描（工单 #11 建立、#5 切片 A 升级为平台语法查询版、切片 B
// 收紧 query 为必选并改懒查询形态）。
//
// 上游事实源：easy-typing-obsidian v6.0.9 的树版判定
// keyboard_handlers.ts:748-788（getPosLineType2）与 syntax.ts:155-201
// （getQuoteInfoInPos——上游本就是纯正则，逐字移植）；段块邻行判定来自
// keyboard_handlers.ts:783-809（getBlockLinesInPos 的 text 判定）。
//
// **树版判定（#5 落地）**：行类型 = 平台 experimental.syntax.lineTypeAt
// （vsidian PR #433/#434，B+ 形态位置查询）经 src/syntaxTreeQuery.ts 的
// 映射表投影；行内几何（indent/markerEnd/quoteContentStart）仍从行文本
// 正则计算（行内形态学与树无关）。映射对照表、查询适配器接口与代码块/
// 作用域 API 见 syntaxTreeQuery.ts——本文件只保留 ModA 消费面的行扫描
// 适配与上游纯正则部分。
//
// #11 的正则状态机全文扫描已随升级删除，不并存两套判定；其 documented
// 降级差异（单行 $$x$$ 不识别、围栏 ```/~~~ 互闭、frontmatter/$$ 未闭合
// 的延续近似）随平台语义消除，口径见 syntaxTreeQuery.ts 头注释。
//
// **懒查询形态（#5 切片 B）**：quoteInfoAt/paragraphBlockAt 收 SyntaxDoc
// （CM6 Text 结构性满足，state.doc 直传）逐行按需查询——上游本来就是
// 行文本正则的判定（getQuoteInfoInPos 的 quote_regex 门与扩展、列表
// 缩进 /^\s*/）保留纯行文本计算，不消耗查询；行类型判定（上游
// getPosLineType2 的消费位）逐行 lineInfoAt 局部查，查询拒绝返回 null
// 由消费方按「不接管」解释（不 fallback 正则——exploration 笔记 §5.4）。
//
// 本模块纯字符串 + 查询适配器输入，不 import CM6——可在 node 下直接
// 单测。行号口径 1-based（与 doc.line(n) 对齐）。
import {
  CALLOUT_PREFIX_RE,
  HEADING_RE,
  docOfLines,
  lineInfoAt,
  scanLinesViaQuery,
  QUOTE_PREFIX_RE,
  type SyntaxDoc,
  type SyntaxQuery,
} from './syntaxTreeQuery'

// 行内形态学正则事实源已移至 syntaxTreeQuery（#5）；此处再导出保持
// modaSelection 等既有导入路径不变。
export { CALLOUT_PREFIX_RE, HEADING_RE, LIST_MARKER_RE, QUOTE_PREFIX_RE } from './syntaxTreeQuery'

/** 行级类型（平台 kind 经 LINE_KIND_BY_PLATFORM 投影的 v2/ModA 消费维度） */
export type LineKind =
  | 'text' // 普通文本（平台 table/heading 投影为 text——上游 v2 不特判；跳过维度出口见 FORMAT_SKIP_BY_PLATFORM）
  | 'empty' // 空行/纯空白（上游 v2 归 text；独立 kind 供段块邻行排除消费）
  | 'list' // 列表标记行或续行（引用内列表含引用前缀计入 markerEnd）
  | 'quote' // 引用前缀行（含 callout 标题行——平台无 callout 枚举）
  | 'code' // 代码块行（含围栏行与缩进代码）
  | 'formula' // $$ 公式块行（含跨行块与单行闭合块）
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

/**
 * 全文档行扫描（查询版）：逐行平台行类型查询 + 映射表投影（实现见
 * syntaxTreeQuery.scanLinesViaQuery）。ModA 按键路径已改懒查询
 * （modaSelection，性能红线），本入口供测试与全量行分类消费。
 * 查询拒绝时抛错——拒绝只发生在非 live/已销毁视图（本就不该接管），
 * 不 fallback 正则（防复活已拆除的降级路径，exploration 笔记 §5.4）。
 */
export function scanLines(texts: readonly string[], query: SyntaxQuery): LineInfo[] {
  const scan = scanLinesViaQuery(docOfLines(texts), query)
  if (scan === null) {
    throw new Error('blockScan.scanLines 语法查询被拒绝（非 live 视图或实例已销毁，不应接管）')
  }
  return scan
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

/**
 * 当前行/引用块信息：纯行文本正则判定（#5 切片 B 对齐上游形态——上游
 * getQuoteInfoInPos 本就是 quote_regex/callout_regex 行文本匹配 + 区间
 * 扩展，不查树、不依赖行类型；frontmatter/围栏内的 `>` 行同上游照样
 * 命中）。非引用行返回 null（上游 quote_regex 不匹配）。
 */
export function quoteInfoAt(doc: SyntaxDoc, lineNumber: number): QuoteInfo | null {
  const line = doc.line(lineNumber)
  const qm = QUOTE_PREFIX_RE.exec(line.text)
  if (qm === null) return null
  const cm = CALLOUT_PREFIX_RE.exec(line.text)
  const contentStart = cm !== null ? cm[0].length : qm[0].length

  // 下方：连续引用行
  let endLine = lineNumber
  for (let i = lineNumber + 1; i <= doc.lines; i++) {
    if (QUOTE_PREFIX_RE.test(doc.line(i).text)) endLine = i
    else break
  }
  // 上方：引用行/callout 行连续扩展；callout 分支不 break（上游注释掉的 break）
  let startLine = lineNumber
  let isCallout = false
  for (let i = lineNumber; i >= 1; i--) {
    const text = doc.line(i).text
    if (CALLOUT_PREFIX_RE.test(text)) {
      isCallout = true
      startLine = i
    } else if (QUOTE_PREFIX_RE.test(text)) {
      startLine = i
    } else {
      break
    }
  }
  return { startLine, endLine, contentStart, isCallout }
}

/** 段块范围（行号 1-based，闭区间） */
export interface BlockRange {
  readonly startLine: number
  readonly endLine: number
}

/**
 * 光标所在文本段块（上游 getBlockLinesInPos）：当前行无条件入块；邻行
 * 仅收纳 kind=text 且非空且非标题（`^#+ `）的行——行类型逐行 lineInfoAt
 * 局部查（懒查询：遇非 text 行即停，不预扫全文）。查询拒绝返回 null
 * （整体不接管，由消费方解释）。
 */
export function paragraphBlockAt(
  doc: SyntaxDoc,
  query: SyntaxQuery,
  lineNumber: number,
): BlockRange | null {
  let startLine = lineNumber
  let endLine = lineNumber
  for (let i = lineNumber - 1; i >= 1; i--) {
    const line = doc.line(i)
    const info = lineInfoAt(doc, query, i)
    if (info === null) return null
    if (info.kind === 'text' && line.text !== '' && !HEADING_RE.test(line.text)) {
      startLine = i
      continue
    }
    break
  }
  for (let i = lineNumber + 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const info = lineInfoAt(doc, query, i)
    if (info === null) return null
    if (info.kind === 'text' && line.text !== '' && !HEADING_RE.test(line.text)) {
      endLine = i
      continue
    }
    break
  }
  return { startLine, endLine }
}
