// 行内分区（工单 #26；#5 切片 B 升级为树版）——把一行文本切分为
// text / code / formula / wikilink / mdlink / user（保护区）六种
// InlinePart，对齐上游 core.ts 的 parseLineWithSyntaxTree + 
// splitTextWithLinkAndUserDefined：
// - code/formula 分区（#5 切片 B）：平台 experimental.syntax.inlineAt 位置
//   查询驱动（上游经 CM6 syntaxTree 逐位置 resolve——本移植的查询版等价
//   形态）。从行首逐位置推进：命中标记后线性右扫定位区间右边界（评审
//   R2-B2：T-F-T 形态非单调，放弃二分——间隙文本会被吞进分区），游标跳
//   边界继续；none 逐字符推进；
// - **链接区段剪除（上游 `!name.contains('link')` 语义）**：平台查询不暴露
//   链接区段（反引号可判 InlineCode），code/formula span 列表
//   与链接区段求差——链接区段优先，其内的 code/formula 按上游语义归链接；
// - wikilink/mdlink 区段由 scanInlineLinks 单次扫描得出；分区、作用域和
//   用户保护区共用，链接目标内的双链形态不再重复落位；
// - **user 分区 = #27 注入缝**：保护区区间集（行内坐标）经参数传入，
//   附左右空格要求（上游 UserDefinedRegExp 行尾 `|xy` 旗标语义）；
//   解析与匹配的默认实现在 src/userDefinedRegex.ts（#27），接入层
//   （autoFormatIntercept）设置驱动注入，缺省无保护区。
// 查询拒绝（inlineAt ok:false——非 live/已销毁视图）→ 返回 null（不
// fallback 正则，exploration 笔记 §5.4）。
import type { SyntaxDoc, SyntaxQuery } from '../syntaxTreeQuery'

export enum SpaceState {
  none = 0,
  soft = 1,
  strict = 2,
}

export enum InlineType {
  text = 'text',
  code = 'code',
  formula = 'formula',
  wikilink = 'wikilink',
  mdlink = 'mdlink',
  user = 'user-defined',
  none = 'none',
}

/** 行内分区（begin/end 为行内坐标，content 为该区段原文） */
export interface InlinePart {
  content: string
  type: InlineType
  begin: number
  end: number
  leftSpaceRequire: SpaceState
  rightSpaceRequire: SpaceState
}

/** 保护区区间（#27 注入缝；行内坐标 [begin, end) + 左右空格要求） */
export interface ProtectedInlineRange {
  readonly begin: number
  readonly end: number
  readonly leftSpaceRequire: SpaceState
  readonly rightSpaceRequire: SpaceState
}

function makePart(
  content: string,
  type: InlineType,
  begin: number,
  end: number,
  leftSpaceRequire: SpaceState = SpaceState.none,
  rightSpaceRequire: SpaceState = SpaceState.none,
): InlinePart {
  return { content, type, begin, end, leftSpaceRequire, rightSpaceRequire }
}

interface InlineLinkSpan {
  begin: number
  end: number
  type: InlineType.wikilink | InlineType.mdlink
}

function isEscapedAt(line: string, at: number): boolean {
  let start = at
  while (line[start - 1] === '\\') start--
  return (at - start) % 2 === 1
}

/** 预配对无空白的链接目标，避免未闭合的候选反复扫描同一段行尾。 */
function markdownLinkEnds(line: string, from: number): Map<number, number> {
  const ends = new Map<number, number>()
  const parens: number[] = []
  const angles: number[] = []
  for (let at = from; at < line.length; at++) {
    const ch = line[at]!
    if (/\s/.test(ch)) {
      parens.length = 0
      angles.length = 0
    } else if (ch === '(' && !isEscapedAt(line, at)) {
      parens.push(at)
    } else if (ch === ')' && !isEscapedAt(line, at)) {
      const open = parens.pop()
      if (open !== undefined) ends.set(open, at + 1)
    } else if (ch === '<' && line[at - 1] === '(') {
      angles.push(at)
    } else if (ch === '>' && !isEscapedAt(line, at)) {
      // 尖括号目标独立配对：目标中的圆括号是字面量，首个未转义 > 必须紧跟 )。
      if (line[at + 1] === ')') {
        for (const open of angles) ends.set(open, at + 2)
      }
      angles.length = 0
    }
  }
  return ends
}

/** 从左到右消费完整链接；返回不重叠的行内半开区间。 */
export function scanInlineLinks(line: string): InlineLinkSpan[] {
  const starts = /\[\[[^\[\]]*\]\]|\[[^\[\]]*\]\(/g
  const spans: InlineLinkSpan[] = []
  let ends: Map<number, number> | undefined
  for (let match = starts.exec(line); match !== null; match = starts.exec(line)) {
    const bracket = match.index
    if (isEscapedAt(line, bracket)) continue
    const wiki = line[bracket + 1] === '['
    const target = starts.lastIndex
    if (!wiki && isEscapedAt(line, target - 2)) continue
    const end = wiki
      ? target
      : (ends ??= markdownLinkEnds(line, target - 1)).get(line[target] === '<' ? target : target - 1)
    if (end === undefined) continue
    let begin = bracket
    while (bracket - begin < 2 && line[begin - 1] === '!' && !isEscapedAt(line, begin - 1)) begin--
    spans.push({ begin, end, type: wiki ? InlineType.wikilink : InlineType.mdlink })
    starts.lastIndex = end
  }
  return spans
}

/** 区间减法：range 剪除 occupied 各段后的剩余段列表 */
function subtractSpans(
  range: { begin: number; end: number },
  occupied: ReadonlyArray<{ begin: number; end: number }>,
): Array<{ begin: number; end: number }> {
  let segments = [range]
  for (const span of occupied) {
    const next: Array<{ begin: number; end: number }> = []
    for (const seg of segments) {
      if (span.end <= seg.begin || span.begin >= seg.end) {
        next.push(seg)
        continue
      }
      if (span.begin > seg.begin) next.push({ begin: seg.begin, end: span.begin })
      if (span.end < seg.end) next.push({ begin: span.end, end: seg.end })
    }
    segments = next
  }
  return segments
}

/**
 * 扫描行内代码/公式区段（树版查询驱动；行内坐标 [begin, end)）：
 * - 行首起逐位置推进：inlineAt 命中 code/formula → 线性右扫找区间右边界
 *   （首个不同 kind 处停，见函数内注释），span 右边界 = 游标停点，游标跳
 *   边界；none 逐字符推进（正确性优先——上游 parseLineWithSyntaxTree
 *   同为逐位置 resolve）；
 * - 输出为**剪除链接区段前**的原始 span；链接剪除在 splitLineIntoParts
 *   统一做（上游 !contains('link') 语义）。
 * 查询拒绝 → null。
 */
function scanSpansViaQuery(
  doc: SyntaxDoc,
  query: SyntaxQuery,
  lineNumber: number,
): Array<{ begin: number; end: number; type: InlineType }> | null {
  const line = doc.line(lineNumber)
  const text = line.text
  const spans: Array<{ begin: number; end: number; type: InlineType }> = []
  let closedCodeEnd = -1
  let p = 0
  while (p < text.length) {
    const result = query.inlineAt(line.from + p)
    if (!result.ok) return null
    let kind = result.kind
    if (p === closedCodeEnd && kind === 'code') {
      // 已知代码在此结束。旧宿主可能仍判 code，连相邻公式的开 $ 也会盖住。
      kind = 'none'
      if (text[p] === '$') {
        const next = query.inlineAt(line.from + p + 1)
        if (!next.ok) return null
        if (next.kind === 'formula') kind = 'formula'
      }
    }
    if (kind === 'none') {
      p += 1
      continue
    }
    const type = kind === 'code' ? InlineType.code : InlineType.formula
    if (kind === 'code') {
      // 在相邻语法节点末端，旧宿主也可能漏报开反引号的第一位。
      const prevEnd = spans.at(-1)?.end ?? 0
      const begin = p > prevEnd && text[p - 1] === '`' && !isEscapedAt(text, p - 1) ? p - 1 : p
      if (text[begin] === '`') {
        const preceding = begin === 0 && line.from > 0 ? query.inlineAt(line.from - 1) : null
        if (preceding?.ok === false) return null
        if (preceding?.kind !== 'code') {
          const marks = /`+/g
          marks.lastIndex = begin
          const width = marks.exec(text)![0].length
          for (let mark = marks.exec(text); mark !== null; mark = marks.exec(text)) {
            if (mark[0].length !== width) continue
            const close = query.inlineAt(line.from + marks.lastIndex - 1)
            if (!close.ok) return null
            if (close.kind === 'code') {
              closedCodeEnd = marks.lastIndex
              spans.push({ begin, end: closedCodeEnd, type })
              p = closedCodeEnd
            }
            break
          }
          if (p === closedCodeEnd) continue
        }
      }
    }
    // 命中后线性右扫找区间右边界（评审 R2-B2）：end 从 p 逐位推进直到
    // inlineAt 不同 kind 或行尾。原实现二分找「最右同 kind 位置」依赖谓词
    // 前缀单调——同一行内 T-F-T 形态（两个同 kind span 短间隙，如
    // `a`和`bc`）不单调，二分会收敛到第二 span 末尾把间隙文本吞进分区；
    // 线性右扫在首个不同 kind 处停，间隙由外层游标走 none 路径逐字符推进。
    // span 内逐位查询 O(span) 次且 µs 级（none 路径本就逐字符推进同阶，
    // 上游 parseLineWithSyntaxTree 同为逐位置 resolve——正确性优先）。
    let end = p + 1
    while (end < text.length) {
      const probe = query.inlineAt(line.from + end)
      if (!probe.ok) return null
      if (probe.kind !== kind) break
      end += 1
    }
    // 跨行代码在本行没有开标记；若宿主把闭标记后一位纳入，仍可收回该位。
    if (kind === 'code' && end - p > 1 && text[end - 2] === '`' && text[end - 1] !== '`') {
      const next = end === text.length ? query.inlineAt(line.to) : null
      if (next?.ok === false) return null
      if (next?.kind !== 'code') closedCodeEnd = --end
    }
    spans.push({ begin: p, end, type })
    p = end
  }
  return spans
}

/**
 * 一行 → InlinePart 列表（按 begin 升序，覆盖整行）。查询拒绝 → null。
 *
 * 链接不相互重叠。注入的保护区与 code/formula 冲突时剪除重叠部分；
 * 与链接冲突时不再单独格式化该链接。
 */
export function splitLineIntoParts(
  doc: SyntaxDoc,
  query: SyntaxQuery,
  lineNumber: number,
  protectedRanges: readonly ProtectedInlineRange[] = [],
): InlinePart[] | null {
  const line = doc.line(lineNumber)
  const rawSpans = scanSpansViaQuery(doc, query, lineNumber)
  if (rawSpans === null) return null

  // 链接区段剪除（上游 !contains('link')）：链接区段优先，其内的
  // code/formula span 碎片化剪除（剪空的消失）。
  const linkSpans = scanInlineLinks(line.text)
  const spans = rawSpans.flatMap((s) =>
    subtractSpans({ begin: s.begin, end: s.end }, linkSpans).map((seg) => ({
      begin: seg.begin,
      end: seg.end,
      type: s.type,
    })),
  )

  // 保护区（#27 注入缝）：钳制到行内，丢弃空/倒置区间；与 code/formula
  // 天然保护区重叠的段剪除（天然保护区优先——上游树版中 code/formula
  // 由语法树先行摘出，用户正则区块只在剩余 text 上匹配，语义等价）
  const userSpans = protectedRanges
    .filter((r) => r.end > r.begin)
    .flatMap((r) => subtractSpans(
      { begin: Math.max(0, r.begin), end: Math.min(line.text.length, r.end) },
      spans,
    ).map((seg) => ({
      begin: seg.begin,
      end: seg.end,
      type: InlineType.user as const,
      left: r.leftSpaceRequire,
      right: r.rightSpaceRequire,
    })))
    .filter((r) => r.end > r.begin)

  const linkParts = linkSpans
    .filter((link) => !userSpans.some((user) => link.begin < user.end && user.begin < link.end))
    .map(({ begin, end, type }) => makePart(line.text.slice(begin, end), type, begin, end))

  // 非文本 part 合总 + 上游重建循环：按 begin 排序，缝隙填 text part
  const nonText: InlinePart[] = [
    ...spans.map((s) => makePart(line.text.slice(s.begin, s.end), s.type, s.begin, s.end)),
    ...userSpans.map((u) =>
      makePart(line.text.slice(u.begin, u.end), InlineType.user, u.begin, u.end, u.left, u.right),
    ),
    ...linkParts,
  ].sort((a, b) => a.begin - b.begin)

  const result: InlinePart[] = [...nonText]
  let textBegin = 0
  for (const part of nonText) {
    if (textBegin < part.begin) {
      result.push(makePart(line.text.slice(textBegin, part.begin), InlineType.text, textBegin, part.begin))
    }
    textBegin = Math.max(textBegin, part.end)
  }
  if (textBegin !== line.text.length) {
    result.push(makePart(line.text.slice(textBegin), InlineType.text, textBegin, line.text.length))
  }
  return result.sort((a, b) => a.begin - b.begin)
}
