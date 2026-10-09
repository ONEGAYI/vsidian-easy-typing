// 行内分区（工单 #26）：把一行文本切分为 text / code / formula / wikilink /
// mdlink / user（保护区）六种 InlinePart——上游 core.ts 的
// parseLineWithSyntaxTree（经 CM6 syntaxTree 切 code/formula）+
// splitTextWithLinkAndUserDefined（正则切链接与用户自定义正则区块）的
// **文本降级版**合一实现。
//
// 降级原因与口径（记录于 docs/specs/auto-format.md）：
// - vsidian live 编辑器 syntaxTree 恒为未解析空树（vsidian#406，#25 同源
//   边界），code/formula 分区改用文本扫描——形态学对齐 #25
//   ruleScopeFallback 的行内代码/公式近似：反引号等长配对（同行为限）、
//   $ 单符配对与 $$ 成对（\$ 转义跳过）、行内代码先于公式（代码区内的 $
//   不参与配对）；
// - wikilink/mdlink 识别逐字沿用上游正则（本就是纯文本正则，无树依赖），
//   只在非 code/formula/user 区段上匹配（上游等价：树已把 code/formula
//   从 text part 摘出后才跑链接正则）；
// - **user 分区 = #27 注入缝**：保护区区间集（行内坐标）经参数传入，
//   附左右空格要求（上游 UserDefinedRegExp 行尾 `|xy` 旗标语义，解析归
//   #27）；本票调用侧不传（默认无保护区）。
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

/** 上游 splitTextWithLinkAndUserDefined 的 wikilink 正则（逐字） */
const REG_WIKILINK = /\!{0,2}\[\[[^\[\]]*?\]\]/g
/** 上游 splitTextWithLinkAndUserDefined 的 mdlink 正则（逐字） */
const REG_MDLINK = /\!{0,2}\[[^\[\]]*?\]\([^\s]*\)/g

/** 反引号串长（从 at 起的连续反引号个数） */
function backtickRun(line: string, at: number): number {
  let run = 0
  while (line[at + run] === '`') run++
  return run
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
 * 扫描行内代码/公式区段（降级形态学）：
 * - 反引号等长配对（同行为限；`\\` 不转义反引号——对齐 ruleScopeFallback）；
 * - `\$` 转义跳过；`$$` 成对优先，单 `$` 与下一个 `$` 配对（同行为限）；
 * - 代码区段先落位，其内的 $ 不参与公式配对（扫描游标跳过已落位区段）。
 * 未配对的反引号/$ 按字面处理（不成区段）。
 */
function scanCodeAndFormulaSpans(line: string): Array<{ begin: number; end: number; type: InlineType }> {
  const spans: Array<{ begin: number; end: number; type: InlineType }> = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 2 // \$ 等转义（连同被转义字符跳过）
      continue
    }
    if (ch === '`') {
      const run = backtickRun(line, i)
      const close = line.indexOf('`'.repeat(run), i + run)
      if (close !== -1) {
        spans.push({ begin: i, end: close + run, type: InlineType.code })
        i = close + run
      } else {
        i += run // 未配对：字面反引号
      }
      continue
    }
    if (ch === '$') {
      if (line[i + 1] === '$') {
        const close = line.indexOf('$$', i + 2)
        if (close !== -1) {
          spans.push({ begin: i, end: close + 2, type: InlineType.formula })
          i = close + 2
        } else {
          i += 2 // 未配对 $$：字面处理（块级 $$ 跨行场景由行级 scope 门控排除）
        }
        continue
      }
      const close = line.indexOf('$', i + 1)
      if (close !== -1) {
        spans.push({ begin: i, end: close + 1, type: InlineType.formula })
        i = close + 1
      } else {
        i += 1
      }
      continue
    }
    i += 1
  }
  return spans
}

/**
 * 一行 → InlinePart 列表（按 begin 升序，覆盖整行）。
 *
 * 语义对齐上游：wikilink 先匹配、mdlink 后匹配且**互不冲突检查**
 *（上游 matchWithReg 对 mdlink 不查重叠——`[[a]](b)` 类重叠形态按上游
 * 重建循环的既定怪癖处理，不擅自修复）；保护区（user）与 code/formula
 * 由调用方/扫描器保证不重叠，重叠时的行为与上游重建循环一致。
 */
export function splitLineIntoParts(
  line: string,
  protectedRanges: readonly ProtectedInlineRange[] = [],
): InlinePart[] {
  const spans = scanCodeAndFormulaSpans(line)

  // 保护区（#27 注入缝）：钳制到行内，丢弃空/倒置区间；与 code/formula
  // 天然保护区重叠的段剪除（天然保护区优先——上游树版中 code/formula
  // 由语法树先行摘出，用户正则区块只在剩余 text 上匹配，语义等价）
  const userSpans = protectedRanges
    .filter((r) => r.end > r.begin)
    .flatMap((r) => subtractSpans(
      { begin: Math.max(0, r.begin), end: Math.min(line.length, r.end) },
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
  if (cursor < line.length) freeSegments.push({ begin: cursor, end: line.length })

  // 链接区段（上游顺序：wikilink 全部先收集，mdlink 不查冲突再收集）
  const linkParts: InlinePart[] = []
  for (const seg of freeSegments) {
    const segText = line.slice(seg.begin, seg.end)
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
    ...spans.map((s) => makePart(line.slice(s.begin, s.end), s.type, s.begin, s.end)),
    ...userSpans.map((u) =>
      makePart(line.slice(u.begin, u.end), InlineType.user, u.begin, u.end, u.left, u.right),
    ),
    ...linkParts,
  ].sort((a, b) => a.begin - b.begin)

  const result: InlinePart[] = [...nonText]
  let textBegin = 0
  for (const part of nonText) {
    if (textBegin < part.begin) {
      result.push(makePart(line.slice(textBegin, part.begin), InlineType.text, textBegin, part.begin))
    }
    textBegin = Math.max(textBegin, part.end)
  }
  if (textBegin !== line.length) {
    result.push(makePart(line.slice(textBegin), InlineType.text, textBegin, line.length))
  }
  return result.sort((a, b) => a.begin - b.begin)
}
