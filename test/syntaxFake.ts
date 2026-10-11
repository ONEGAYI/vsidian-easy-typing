// 平台 experimental.syntax 判定链 fake（工单 #5 测试基建；非生产代码——
// 不进产物，仅供 vitest 构造 SyntaxQuery）。
//
// 语义来源与近似口径（按探索笔记 exploration-5-syntax-line-types.md §二/§四）：
// - 判定链骨架照 vsidian src/shared/addonSyntaxApi.ts（#433 产品化）：
//   lineTypeAt = fm 区间 →（块级代码守卫下的）跨行 $$ 块表 → 树链枚举
//   （code>table>heading>list>quote）→ 单行闭合 $$x$$ → text；
//   inlineAt = fm → none → InlineCode → code → 其余代码上下文 → none →
//   跨行块表/当前行扫描 → formula → none。
// - fm 区间照 vsidian markdownDoc.frontmatterRange：首行恰 ---/...（容行尾
//   空白），第 2 行之后存在闭合行则 [0, 闭合行行尾)；未闭合为 null（按
//   普通 Markdown 处理）。不实现 8192 扫描上限（测试文档均短）。
// - 跨行 $$ 块照 vsidian shared/math.ts scanMathRanges 块模式：行首（剥
//   缩进）$$ 开启、首个含 $$ 行闭合（行尾取最后一对，否则取首对）、单行
//   闭合 $$x$$ 不进跨行表（由单行补判口径消费）、未闭合不产出（稳定降级
//   为源码——后续行按普通文本处理）。
// - 树链枚举近似（本仓 node_modules 无 @lezer/markdown，仅 @lezer/common
//   等，无法构造真实树）：围栏代码状态机（同字符、闭栏长度不小于开栏、
//   信息串仅开栏侧；引用前缀先剥——引用内围栏近似 FencedCode in
//   Blockquote）+ 缩进代码（缩进 ≥4 的非空行）近似 FencedCode/CodeBlock；
//   table 以「剥引用后以 | 开头且含第二个 |」近似 GFM 表行；heading 仅
//   ATX 形态；list/quote 用行首形态学；位置粒度只区分「引用前缀区 vs
//   内容区」（`> - item` 内容处 list、前缀处 quote——平台嵌套优先级的
//   两位置语义近似）。列表续行沿用被替换降级实现的缩进近似（缩进 ≥2 且
//   上方最近非空行属列表）——真实树按解析归属，测试用例避免边界形态。
// - 行内 $ 扫描简化：不做贴字（词字符相邻不开启/闭合）与转义判定的完整
//   复刻，测试用例避开货币形态；反引号 span 内的 $ 跳过。
// - 平台树无 wikilink/mdlink 节点（反引号是真 InlineCode）——链接排除由
//   生产侧 linkSpansOfLine 补齐，本 fake 不模拟（如实返回 code）。
import type {
  AddonSyntaxInlineResult,
  AddonSyntaxLineKind,
  AddonSyntaxLineTypeResult,
} from '../types/vendor/shared/addonSyntaxApi'
import type { SyntaxDoc, SyntaxDocLine, SyntaxQuery } from '../src/syntaxTreeQuery'
import { LIST_MARKER_RE, QUOTE_PREFIX_RE } from '../src/syntaxTreeQuery'

/** fake + 配套最小行文档（doc 与 query 同源同一文本，坐标一致） */
export interface SyntaxFake {
  readonly doc: SyntaxDoc
  readonly query: SyntaxQuery
  /** 查询调用计数（#5 切片 B 懒查询防回潮断言用；只增计数不改判定语义） */
  readonly counts: { lineTypeAt: number; inlineAt: number }
}

/** 从 LF 文本构造平台判定链 fake（fm/围栏/缩进代码/跨行 $$ 表预计算） */
export function makeSyntaxFake(text: string): SyntaxFake {
  const lines = text.split('\n')
  const starts: number[] = []
  let cursor = 0
  for (const line of lines) {
    starts.push(cursor)
    cursor += line.length + 1
  }
  const total = Math.max(0, cursor - 1)

  const lineAtPos = (pos: number): SyntaxDocLine => {
    const clamped = Math.max(0, Math.min(pos, total))
    let lo = 0
    let hi = lines.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= clamped) lo = mid
      else hi = mid - 1
    }
    const from = starts[lo]!
    return { number: lo + 1, from, to: from + lines[lo]!.length, text: lines[lo]! }
  }

  const doc: SyntaxDoc = {
    lines: lines.length,
    length: total,
    lineAt: lineAtPos,
    line: (n: number) => lineAtPos(starts[n - 1]!),
  }

  // ---- 预计算：fm 区间（frontmatterRange 语义） ----
  const FM_LINE = /^(-{3}|\.{3})\s*$/
  const fmTo =
    lines.length >= 3 && FM_LINE.test(lines[0]!)
      ? (() => {
          for (let i = 2; i < lines.length; i++) {
            if (FM_LINE.test(lines[i]!)) return starts[i]! + lines[i]!.length
          }
          return -1
        })()
      : -1
  const fm = fmTo >= 0 ? { from: 0, to: fmTo } : null
  const inFm = (i: number): boolean => fm !== null && i < lines.length && starts[i]! >= fm.from && starts[i]! + lines[i]!.length <= fm.to

  // ---- 预计算：跨行 $$ 块表 + 单行闭合 $$x$$（scanMathRanges 块模式） ----
  const mathBlocks: Array<{ from: number; to: number }> = []
  const singleLineFormula: boolean[] = lines.map(() => false)
  {
    let blockOpen: { from: number } | null = null
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!
      const trimmed = raw.trim()
      if (blockOpen) {
        if (!trimmed.includes('$$')) continue
        const closeAt = trimmed.endsWith('$$')
          ? raw.lastIndexOf('$$')
          : raw.indexOf('$$', raw.length - trimmed.length)
        mathBlocks.push({ from: blockOpen.from, to: starts[i]! + closeAt + 2 })
        blockOpen = null
        continue
      }
      const indent = raw.length - raw.trimStart().length
      if (!trimmed.startsWith('$$')) continue
      const rest = trimmed.slice(2)
      const pairs = [...rest.matchAll(/\$\$/g)]
      const lastAtEnd = pairs.length > 0 && pairs[pairs.length - 1]!.index === rest.length - 2
      if (!lastAtEnd) {
        blockOpen = { from: starts[i]! + indent }
      } else if (pairs.length === 1 && rest.slice(0, -2).trim() !== '') {
        singleLineFormula[i] = true
      }
      // 多对 $$ 在段内：不进跨行表，由行内扫描口径消费
    }
  }

  // ---- 预计算：行内形态（引用前缀 / 围栏与缩进代码 / 内容形态学） ----
  const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
  const wsLen: number[] = []
  const quotePrefixLen: number[] = [] // 行首空白 + > 组 + 其后一个可选空格
  const codeLine: boolean[] = []
  const isTable: boolean[] = []
  const isHeading: boolean[] = []
  const isList: boolean[] = []
  const isContinuation: boolean[] = []
  {
    let fence: { char: string; length: number } | null = null
    let lastNonBlankListLike = false
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!
      codeLine[i] = false
      isTable[i] = false
      isHeading[i] = false
      isList[i] = false
      isContinuation[i] = false
      wsLen[i] = raw.length - raw.trimStart().length
      const qm = QUOTE_PREFIX_RE.exec(raw.slice(wsLen[i]!))
      quotePrefixLen[i] = qm ? wsLen[i]! + qm[0].length : wsLen[i]!
      const eff = raw.slice(quotePrefixLen[i]!)

      // fm 区间内不推进围栏状态（fm 不按 Markdown 解析）
      if (inFm(i)) continue

      // 围栏状态机（引用前缀已剥；行首缩进 ≤3 才是围栏——更深缩进归缩进代码）
      if (fence) {
        codeLine[i] = true
        const close = /^ {0,3}([`~]{3,})\s*$/.exec(eff)
        if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null
        continue
      }
      const rawIndent = wsLen[i]!
      const open = rawIndent <= 3 ? FENCE_OPEN.exec(eff) : null
      if (open) {
        codeLine[i] = true
        fence = { char: open[1]![0]!, length: open[1]!.length }
        continue
      }
      // 内容形态学（树链优先级 code>table>heading>list>quote 的行近似）。
      // 续行判定先于缩进代码：列表项内的深缩进续行树归 BulletList
      //（CommonMark 缩进代码不能打断段落）；续行缩进以行首空白计（与被
      // 替换的降级实现同款，真实树按解析归属）
      const t = eff.trimStart()
      isTable[i] = /^\|.*\|/.test(t)
      isHeading[i] = /^#{1,6} /.test(eff)
      isList[i] = LIST_MARKER_RE.test(eff)
      const nonBlank = raw.trim() !== ''
      if (nonBlank && !isTable[i] && !isHeading[i] && !isList[i] && qm === null) {
        if (lastNonBlankListLike && rawIndent >= 2) isContinuation[i] = true
      }
      // 缩进代码近似（行首缩进 ≥4 的非空行且非列表续行）
      if (nonBlank && rawIndent >= 4 && !isContinuation[i]) {
        codeLine[i] = true
        lastNonBlankListLike = false
        continue
      }
      if (nonBlank) lastNonBlankListLike = isList[i] || isContinuation[i]
    }
  }

  // ---- 预计算：行内代码 span 与行内 $ span ----
  const backtickSpans = lines.map((line, i) => findBacktickSpans(line, starts[i]!))
  const dollarSpans = lines.map((line, i) => findDollarSpans(line, starts[i]!, backtickSpans[i]!))

  const inFmPos = (pos: number): boolean => {
    const line = lineAtPos(pos)
    return fm !== null && line.from >= fm.from && line.to <= fm.to
  }
  const inMathBlock = (pos: number): boolean => mathBlocks.some((m) => pos >= m.from && pos < m.to)

  const counts = { lineTypeAt: 0, inlineAt: 0 }
  const query: SyntaxQuery = {
    lineTypeAt(pos: number): AddonSyntaxLineTypeResult {
      counts.lineTypeAt += 1
      const line = lineAtPos(pos)
      const i = line.number - 1
      const ok = (kind: AddonSyntaxLineKind): AddonSyntaxLineTypeResult => ({ ok: true, kind, nodeNames: [`fake:${kind}`] })
      if (inFmPos(pos)) return ok('frontmatter')
      if (codeLine[i]) return ok('code')
      if (inMathBlock(pos)) return ok('formula')
      // 树链近似：引用前缀区（> 组与其后一个空格）判 quote，内容区按形态学
      if (pos >= line.from + wsLen[i]! && pos < line.from + quotePrefixLen[i]!) return ok('quote')
      if (isTable[i]) return ok('table')
      if (isHeading[i]) return ok('heading')
      if (isList[i] || isContinuation[i]) return ok('list')
      if (quotePrefixLen[i]! > wsLen[i]!) return ok('quote')
      if (singleLineFormula[i]) return ok('formula')
      return ok('text')
    },
    inlineAt(pos: number): AddonSyntaxInlineResult {
      counts.inlineAt += 1
      const i = lineAtPos(pos).number - 1
      const ok = (kind: 'code' | 'formula' | 'none'): AddonSyntaxInlineResult => ({ ok: true, kind, nodeNames: [`fake:${kind}`] })
      if (inFmPos(pos)) return ok('none')
      if (backtickSpans[i]!.some((s) => pos >= s.from && pos < s.to)) return ok('code')
      if (codeLine[i]) return ok('none')
      if (inMathBlock(pos)) return ok('formula')
      if (dollarSpans[i]!.some((s) => pos >= s.from && pos < s.to)) return ok('formula')
      return ok('none')
    },
  }
  return { doc, query, counts }
}

/** 反引号等长配对 span（同行为限；未配对按字面跳过） */
function findBacktickSpans(line: string, base: number): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = []
  let at = 0
  while (at < line.length) {
    if (line[at] !== '`') {
      at += 1
      continue
    }
    let run = 1
    while (line[at + run] === '`') run += 1
    let close = -1
    for (let j = at + run; j < line.length; j++) {
      if (line[j] !== '`') continue
      let size = 1
      while (line[j + size] === '`') size += 1
      if (size === run) {
        close = j
        break
      }
      j += size - 1
    }
    if (close >= 0) {
      spans.push({ from: base + at, to: base + close + run })
      at = close + run
    } else {
      at += run
    }
  }
  return spans
}

/** 行内 $ / $$ span（简化口径：跳过反引号 span 与 \$ 转义；无贴字规则） */
function findDollarSpans(
  line: string,
  base: number,
  codeSpans: ReadonlyArray<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const inCode = (at: number): boolean => codeSpans.some((s) => at >= s.from - base && at < s.to - base)
  const spans: Array<{ from: number; to: number }> = []
  let at = 0
  while (at < line.length) {
    const ch = line[at]!
    if (ch === '\\') {
      at += 2
      continue
    }
    if (inCode(at)) {
      at += 1
      continue
    }
    if (ch !== '$') {
      at += 1
      continue
    }
    if (line[at + 1] === '$') {
      const close = line.indexOf('$$', at + 2)
      if (close > at + 2) {
        spans.push({ from: base + at, to: base + close + 2 })
        at = close + 2
        continue
      }
      at += 2
      continue
    }
    let close = -1
    for (let j = at + 1; j < line.length; j++) {
      if (line[j] === '$' && line[j + 1] !== '$') {
        close = j
        break
      }
    }
    if (close > at) {
      spans.push({ from: base + at, to: base + close + 1 })
      at = close + 1
    } else {
      at += 1
    }
  }
  return spans
}

/** 恒拒绝的查询（read-only）——拒绝路径测试用 */
export function makeRejectingQuery(): SyntaxQuery {
  const reject = () => ({ ok: false as const, reason: 'read-only' as const })
  return { lineTypeAt: reject, inlineAt: reject }
}
