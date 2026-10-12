// 行内分区（工单 #26；#5 切片 B 升级为树版）——把一行文本切分为
// text / code / formula / wikilink / mdlink / user（保护区）六种
// InlinePart，对齐上游 core.ts 的 parseLineWithSyntaxTree + 
// splitTextWithLinkAndUserDefined：
// - code/formula 分区（#5 切片 B）：平台 experimental.syntax.inlineAt 位置
//   查询驱动（上游经 CM6 syntaxTree 逐位置 resolve——本移植的查询版等价
//   形态）。从行首逐位置推进：命中标记后线性右扫定位区间右边界（评审
//   R2-B2：T-F-T 形态非单调，放弃二分——间隙文本会被吞进分区），游标跳
//   边界继续；none 逐字符推进；
// - **链接区段剪除（上游 `!name.contains('link')` 语义）**：平台树无
//   wikilink/mdlink 节点（反引号是真 InlineCode），code/formula span 列表
//   与 syntaxTreeQuery.linkSpansOfLine 的链接区段求差——链接区段优先，
//   其内的 code/formula 按上游语义归链接（由下方链接正则段捕获）；
// - wikilink/mdlink 识别逐字沿用上游正则（本就是纯文本正则，无树依赖；
//   REG_WIKILINK/REG_MDLINK 在本文件定义并经 syntaxTreeQuery.linkSpansOfLine
//   复用——单一事实源），只在非 code/formula/user 区段上匹配（上游等价：
//   树已把 code/formula 从 text part 摘出后才跑链接正则）；
// - **user 分区 = #27 注入缝**：保护区区间集（行内坐标）经参数传入，
//   附左右空格要求（上游 UserDefinedRegExp 行尾 `|xy` 旗标语义）；
//   解析与匹配的默认实现在 src/userDefinedRegex.ts（#27），接入层
//   （autoFormatIntercept）设置驱动注入，缺省无保护区。
// 查询拒绝（inlineAt ok:false——非 live/已销毁视图）→ 返回 null（不
// fallback 正则，exploration 笔记 §5.4）。
import type { SyntaxDoc, SyntaxQuery } from '../syntaxTreeQuery'
import { linkSpansOfLine } from '../syntaxTreeQuery'

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

/** 上游 splitTextWithLinkAndUserDefined 的 wikilink 正则（逐字；#27 保护区
 *  冲突基线复用——单一事实源导出，消费方用后须重置 lastIndex） */
export const REG_WIKILINK = /\!{0,2}\[\[[^\[\]]*?\]\]/g
/** 上游 splitTextWithLinkAndUserDefined 的 mdlink 正则（逐字；同上导出） */
export const REG_MDLINK = /\!{0,2}\[[^\[\]]*?\]\([^\s]*\)/g

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
  let p = 0
  while (p < text.length) {
    const result = query.inlineAt(line.from + p)
    if (!result.ok) return null
    if (result.kind === 'none') {
      p += 1
      continue
    }
    const type = result.kind === 'code' ? InlineType.code : InlineType.formula
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
      if (probe.kind !== result.kind) break
      end += 1
    }
    spans.push({ begin: p, end, type })
    p = end
  }
  return spans
}

/**
 * 一行 → InlinePart 列表（按 begin 升序，覆盖整行）。查询拒绝 → null。
 *
 * 语义对齐上游：wikilink 先匹配、mdlink 后匹配且**互不冲突检查**
 *（上游 matchWithReg 对 mdlink 不查重叠——`[[a]](b)` 类重叠形态按上游
 * 重建循环的既定怪癖处理，不擅自修复）；保护区（user）与 code/formula
 * 由调用方/扫描器保证不重叠，重叠时的行为与上游重建循环一致。
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
  // code/formula span 碎片化剪除（剪空的消失——链接区段由下方正则段捕获）
  const linkSpans = linkSpansOfLine(line.text, line.from).map((s) => ({
    begin: s.from - line.from,
    end: s.to - line.from,
  }))
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

  // 非文本区段总表（code/formula/user），供链接正则跳过
  const occupied = [...spans, ...userSpans.map((u) => ({ begin: u.begin, end: u.end }))].sort(
    (a, b) => a.begin - b.begin,
  )
  const freeSegments: Array<{ begin: number; end: number }> = []
  let cursor = 0
  for (const span of occupied) {
    if (span.begin > cursor) freeSegments.push({ begin: cursor, end: span.begin })
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < line.text.length) freeSegments.push({ begin: cursor, end: line.text.length })

  // 链接区段（上游顺序：wikilink 全部先收集，mdlink 不查冲突再收集）
  const linkParts: InlinePart[] = []
  for (const seg of freeSegments) {
    const segText = line.text.slice(seg.begin, seg.end)
    for (const reg of [REG_WIKILINK, REG_MDLINK]) {
      reg.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = reg.exec(segText)) !== null) {
        linkParts.push(makePart(match[0], reg === REG_WIKILINK ? InlineType.wikilink : InlineType.mdlink, seg.begin + match.index, seg.begin + reg.lastIndex))
      }
    }
  }

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
