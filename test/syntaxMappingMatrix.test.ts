// 映射矩阵单测（工单 #5 切片 C，票面验收项）：钉住「上游判定语义 →
// 平台 kind 枚举 → 消费维度投影」全链。上游 = easy-typing-obsidian
// v6.0.9 的树版判定（getPosLineType v1 / getPosLineType2 v2 /
// detectRuleScope / getCodeBlocksInfos）；平台 = experimental.syntax
//（fake 判定链驱动，近似口径见 test/syntaxFake.ts 头注释）。
//
// 与 test/syntaxTreeQuery.test.ts 的分工：切片 A 测试钉 API 行为，
// 本文件钉**映射语义**——每个用例标注上游语义来源（形态名/锚点）与
// 口径差异依据（vsidian developer-guide §4.8 或 syntaxTreeQuery.ts
// 头注释），是 docs/specs/syntax-line-types.md 映射对照表的机器可验
// 副本：改映射表须同步改这里的期望。
import { describe, expect, it } from 'vitest'
import {
  codeBlocksViaQuery,
  detectScopeViaQuery,
  FORMAT_SKIP_BY_PLATFORM,
  lineInfoAt,
  LINE_KIND_BY_PLATFORM,
  platformLineKindAt,
} from '../src/syntaxTreeQuery'
import type { AddonSyntaxLineKind } from '../types/vendor/shared/addonSyntaxApi'
import { quoteInfoAt } from '../src/blockScan'
import { RuleScope } from '../src/rules/rule-engine'
import { makeSyntaxFake } from './syntaxFake'

/** 期望行（matrix 驱动断言的元素）：上游形态名 → 样本行 → 三个维度的期望 */
interface MatrixExpectation {
  /** 上游行类型语义形态（v1 = getPosLineType、v2 = getPosLineType2 的判定对象） */
  readonly upstream: string
  /** 平台 kind 期望（fake 判定链产出；null = 查询拒绝） */
  readonly platform: AddonSyntaxLineKind
  /** v2/ModA 消费维度（LINE_KIND_BY_PLATFORM 投影） */
  readonly lineKind: string
  /** v1/格式化跳过维度（FORMAT_SKIP_BY_PLATFORM 投影） */
  readonly skip: boolean
}

describe('一、上游行类型 × 平台 kind 全枚举（形态样本 → 两消费维度投影）', () => {
  // 矩阵文档：22 行覆盖上游 v1/v2 全部行类型语义形态，每种形态至少一个
  // 真实文档行样本（引用内围栏与顶层围栏之间空行分隔——「相邻代码块零
  // 分隔行 run 合并」的边界形态见第四组显式钉住）。
  const MATRIX_DOC = [
    '---', // L1 frontmatter 开界
    'title: m', // L2 frontmatter（hmd-frontmatter，v1/v2 首查）
    '---', // L3 frontmatter 闭界
    '# 标题', // L4 heading（v1/v2 均不特判，归 text）
    '| a | b |', // L5 table（v1 特判跳过；v2 归 text）
    '普通段落', // L6 text
    '', // L7 空行（v2 归 text；本仓 empty 补判）
    '- 列表项', // L8 list（v2 行内任一 list）
    '  续行', // L9 list 续行（v2：上方列表项的缩进续行）
    '> 引用', // L10 quote（v2 行首 quote）
    '> [!note] 标题', // L11 callout_title（平台无枚举——组件自判见下）
    '> - 引用内列表', // L12 list（引用内列表，平台优先级 list > quote）
    '> ```js', // L13 quote 内 callout 代码块（v1 判 codeblock 的形态）
    '> const a = 1', // L14 codeblock 内容
    '> ```', // L15 codeblock 闭栏
    '', // L16 空行（分隔相邻代码块——run 分组边界，见第四组）
    '```ts', // L17 codeblock 围栏行（code+block 节点）
    'const b = 2', // L18 codeblock 内容
    '```', // L19 codeblock 闭栏
    '$$', // L20 formula 跨行块开栏（math 全行）
    'c = d', // L21 formula 块体
    '$$', // L22 formula 跨行块闭栏
    '$$x$$', // L23 formula 单行闭合块（升级收益：降级版不识别）
  ].join('\n')
  const fake = makeSyntaxFake(MATRIX_DOC)
  const { doc, query } = fake

  // 行号 → 三维度期望（对照 docs/specs/syntax-line-types.md 映射对照表）
  const matrix: readonly (readonly [number, MatrixExpectation])[] = [
    [1, { upstream: 'frontmatter 开界（hmd-frontmatter）', platform: 'frontmatter', lineKind: 'frontmatter', skip: true }],
    [2, { upstream: 'frontmatter 内容（hmd-frontmatter）', platform: 'frontmatter', lineKind: 'frontmatter', skip: true }],
    [3, { upstream: 'frontmatter 闭界（hmd-frontmatter）', platform: 'frontmatter', lineKind: 'frontmatter', skip: true }],
    [4, { upstream: 'heading（v1/v2 均不特判，归 text）', platform: 'heading', lineKind: 'text', skip: false }],
    [5, { upstream: 'table（v1 特判跳过；v2 归 text）', platform: 'table', lineKind: 'text', skip: true }],
    [6, { upstream: 'text', platform: 'text', lineKind: 'text', skip: false }],
    [7, { upstream: 'text（空行；empty 为 lineInfoAt 本地补判，见下）', platform: 'text', lineKind: 'text', skip: false }],
    [8, { upstream: 'list 标记行', platform: 'list', lineKind: 'list', skip: false }],
    [9, { upstream: 'list 续行', platform: 'list', lineKind: 'list', skip: false }],
    [10, { upstream: 'quote（v2 行首 quote）', platform: 'quote', lineKind: 'quote', skip: false }],
    [11, { upstream: 'callout_title（平台无枚举，统一 quote）', platform: 'quote', lineKind: 'quote', skip: false }],
    [12, { upstream: '引用内 list（v2 行内任一 list 先于行首 quote）', platform: 'list', lineKind: 'list', skip: false }],
    [13, { upstream: 'quote 内 callout 代码块围栏（v1 判 codeblock）', platform: 'code', lineKind: 'code', skip: true }],
    [14, { upstream: 'codeblock 内容行', platform: 'code', lineKind: 'code', skip: true }],
    [15, { upstream: 'codeblock 闭栏行', platform: 'code', lineKind: 'code', skip: true }],
    [17, { upstream: 'codeblock 围栏行（code+block 节点）', platform: 'code', lineKind: 'code', skip: true }],
    [18, { upstream: 'codeblock 内容行', platform: 'code', lineKind: 'code', skip: true }],
    [19, { upstream: 'codeblock 闭栏行', platform: 'code', lineKind: 'code', skip: true }],
    [20, { upstream: 'formula 跨行块开栏（math 全行）', platform: 'formula', lineKind: 'formula', skip: true }],
    [21, { upstream: 'formula 跨行块体（math 全行）', platform: 'formula', lineKind: 'formula', skip: true }],
    [22, { upstream: 'formula 跨行块闭栏', platform: 'formula', lineKind: 'formula', skip: true }],
    [23, { upstream: 'formula 单行闭合块（升级收益）', platform: 'formula', lineKind: 'formula', skip: true }],
  ] as const

  it.each(matrix)('L%i %s → %s / %s / skip=%s', (lineNo, exp) => {
    expect(platformLineKindAt(doc, query, lineNo)).toBe(exp.platform)
    // 消费维度投影 = 映射常量逐项核对（映射表与投影常量同步的防回潮）
    expect(LINE_KIND_BY_PLATFORM[exp.platform]).toBe(exp.lineKind)
    expect(FORMAT_SKIP_BY_PLATFORM[exp.platform]).toBe(exp.skip)
  })

  it('callout_title 的组件自判：平台缺口由 quoteInfoAt 纯正则细分（上游 getQuoteInfoInPos 同款）', () => {
    // 平台 kind 对 callout 标题行统一 quote（无 callout 枚举）；isCallout
    // 细分走 blockScan.quoteInfoAt 的 CALLOUT_PREFIX_RE 纯正则——上游
    // syntax.ts:155-201 本就是纯正则，语义一致（developer-guide §4.8
    // 「组件自判」先例）
    expect(platformLineKindAt(doc, query, 11)).toBe('quote')
    expect(quoteInfoAt(doc, 11)!.isCallout).toBe(true)
    expect(quoteInfoAt(doc, 11)!.contentStart).toBe(10) // 跳过 '> [!note] '
    // 普通引用行 isCallout=false；同引用块内 callout 标题行上溯并入（上游语义）
    expect(quoteInfoAt(doc, 12)!.isCallout).toBe(true)
    expect(quoteInfoAt(doc, 10)!.isCallout).toBe(false)
  })

  it('空行的 empty 补判：平台 kind 是 text，lineInfoAt 按行文本全空白补判 empty（段块邻行排除消费面）', () => {
    // empty 不在映射常量内（上游 v2 归 text）——是 LineKind 既有独立 kind
    // 的本地补判（syntaxTreeQuery.lineKindOf），供段块邻行排除消费
    expect(lineInfoAt(doc, query, 7)!.kind).toBe('empty')
    expect(lineInfoAt(doc, query, 6)!.kind).toBe('text')
  })
})

describe('二、上游作用域 × 平台查询组合（detectRuleScope 三值）', () => {
  // 上游 syntax.ts:208-225：resolveInner 节点名——含 math → Formula；
  // 含 code 且不含 link → Code（+语言）；否则 Text
  const doc = [
    '$$', // L1
    'x', // L2 跨行公式块体
    '$$', // L3
    'a $f$ b', // L4 行内公式
    'a `c` b', // L5 行内代码
    '[[a|`b`]]', // L6 wikilink 别名内 code span（上游 link 排除 → Text）
    '[`t`](url)', // L7 mdlink 文本内 code span（同上）
    '`[[c]]`', // L8 反引号内 wikilink 形态（已知差异，见下）
    'plain', // L9
    '| p | q |', // L10 表格行
  ].join('\n')
  const fake = makeSyntaxFake(doc)
  const { doc: d, query } = fake
  const posOf = (lineNo: number, col: number): number => d.line(lineNo).from + col

  it('Formula：跨行块内、行内 $f$、单行闭合块', () => {
    expect(detectScopeViaQuery(d, query, posOf(2, 0))).toEqual({ scope: RuleScope.Formula })
    expect(detectScopeViaQuery(d, query, posOf(4, 3))).toEqual({ scope: RuleScope.Formula })
    const single = makeSyntaxFake('$$x$$')
    expect(detectScopeViaQuery(single.doc, single.query, 2)).toEqual({ scope: RuleScope.Formula })
  })

  it('Code：行内代码无语言；块级代码（含围栏行）带语言；缩进代码无语言（无围栏标记不产块信息）', () => {
    expect(detectScopeViaQuery(d, query, posOf(5, 4))).toEqual({ scope: RuleScope.Code })
    const block = makeSyntaxFake('```Python\nz = 1\n```')
    expect(detectScopeViaQuery(block.doc, block.query, block.doc.line(2).from)).toEqual({
      scope: RuleScope.Code,
      language: 'python',
    })
    expect(detectScopeViaQuery(block.doc, block.query, block.doc.line(1).from + 3)).toEqual({
      scope: RuleScope.Code,
      language: 'python', // 围栏行属块区间（上游 getCodeBlockInfoInPos 闭区间同款）
    })
    const indented = makeSyntaxFake('    indented code')
    expect(detectScopeViaQuery(indented.doc, indented.query, 4)).toEqual({ scope: RuleScope.Code })
  })

  it('链接排除（上游 !contains(link) 的组件自判）：wikilink 别名与 mdlink 文本内的 code span 判 Text', () => {
    // '[[a|`b`]]'——`b` 处 inlineAt=code，但落在 REG_WIKILINK 区段内 → Text
    expect(detectScopeViaQuery(d, query, posOf(6, 5))).toEqual({ scope: RuleScope.Text })
    // '[`t`](url)'——`t` 处落在 REG_MDLINK 区段内 → Text
    expect(detectScopeViaQuery(d, query, posOf(7, 2))).toEqual({ scope: RuleScope.Text })
    // 链接内普通文字（无 code span）：上游 link 节点不含 code → Text，一致
    expect(detectScopeViaQuery(d, query, posOf(6, 2))).toEqual({ scope: RuleScope.Text })
  })

  it('已知差异钉住：反引号内的 [[..]] 被链接区段正则圈走判 Text（上游树版判 Code）', () => {
    // '`[[c]]`'——上游：code span 内的 [[..]] 不构成链接节点，resolve →
    // InlineCode（含 code 不含 link）→ Code；本移植 linkSpansOfLine 纯
    // 正则不感知 code span，[[c]] 命中 REG_WIKILINK → 区段优先剪除 → Text。
    // 规格 docs/specs/syntax-line-types.md「已知口径差异」节落档
    expect(detectScopeViaQuery(d, query, posOf(8, 3))).toEqual({ scope: RuleScope.Text })
  })

  it('Text：普通文本、表格行内、frontmatter 内', () => {
    expect(detectScopeViaQuery(d, query, posOf(9, 2))).toEqual({ scope: RuleScope.Text })
    expect(detectScopeViaQuery(d, query, posOf(10, 3))).toEqual({ scope: RuleScope.Text })
    const fm = makeSyntaxFake('---\na: `x`\n---')
    expect(detectScopeViaQuery(fm.doc, fm.query, 5)).toEqual({ scope: RuleScope.Text })
  })
})

describe('三、口径差异钉住（探索笔记 §四差异表逐条）', () => {
  it('段内 text $$x$$ tail 是 text；单行闭合 $$x$$ 独占行是 formula（依据：上游 v1/v2 全行校验 + 平台判定链单行闭合块补判）', () => {
    const inline = makeSyntaxFake('text $$x$$ tail')
    expect(platformLineKindAt(inline.doc, inline.query, 1)).toBe('text')
    const alone = makeSyntaxFake('$$x$$')
    expect(platformLineKindAt(alone.doc, alone.query, 1)).toBe('formula') // 升级收益：#11 降级版不识别
  })

  it('frontmatter 内 inlineAt 恒 none（依据：developer-guide §4.8「fm 是源码态」）', () => {
    const fm = makeSyntaxFake('---\na: `x` $y$\n---')
    const inFm = fm.query.inlineAt(6)
    expect(inFm.ok && inFm.kind).toBe('none')
  })

  it('嵌套优先级：> - item 两位置各判各的（前缀处 quote、内容处 list；依据：developer-guide §4.8）', () => {
    const f = makeSyntaxFake('> - item')
    const line = f.doc.line(1)
    const prefix = f.query.lineTypeAt(line.from) // '>' 处
    const content = f.query.lineTypeAt(line.from + 2) // '-' 内容处
    expect(prefix.ok && prefix.kind).toBe('quote')
    expect(content.ok && content.kind).toBe('list')
  })

  it('引用内表格/标题行的内容位置判 table/heading（上游 v2 归 quote；v2 维度投影回 text）', () => {
    const f = makeSyntaxFake('> | a | b |\n> # H')
    expect(platformLineKindAt(f.doc, f.query, 1)).toBe('table')
    expect(platformLineKindAt(f.doc, f.query, 2)).toBe('heading')
    // 消费维度：两者 v2 投影 text、跳过维度 table 跳过 / heading 不跳过
    expect(LINE_KIND_BY_PLATFORM.table).toBe('text')
    expect(FORMAT_SKIP_BY_PLATFORM.table).toBe(true)
    expect(FORMAT_SKIP_BY_PLATFORM.heading).toBe(false)
  })

  it('未闭合 $$ 块按普通文本处理（依据：syntaxTreeQuery 头注释「未闭合不产出（稳定降级为源码）」）', () => {
    const f = makeSyntaxFake(['$$', 'x'].join('\n'))
    expect(platformLineKindAt(f.doc, f.query, 1)).toBe('text')
    expect(platformLineKindAt(f.doc, f.query, 2)).toBe('text')
  })

  it('未闭合 frontmatter 按普通 Markdown 处理（同上稳定降级）', () => {
    const f = makeSyntaxFake(['---', 'title: x'].join('\n'))
    expect(platformLineKindAt(f.doc, f.query, 1)).toBe('text')
    expect(platformLineKindAt(f.doc, f.query, 2)).toBe('text')
  })

  it('优先级 code > table：围栏内的表格式行判 code', () => {
    const f = makeSyntaxFake(['```', '| a |', '```'].join('\n'))
    expect(platformLineKindAt(f.doc, f.query, 2)).toBe('code')
  })
})

describe('四、CodeBlockInfo 提取矩阵（上游 getCodeBlocksInfos 查询版）', () => {
  it('语言整串 trim 后小写（上游整串保留，不取首 token）', () => {
    const f = makeSyntaxFake(['```Python Script', 'x', '```'].join('\n'))
    expect(codeBlocksViaQuery(f.doc, f.query)![0]!.language).toBe('python script')
  })

  it('缩进围栏：indent = 围栏起始列，codeStartPos 加缩进', () => {
    const f = makeSyntaxFake(['  ```js', '  x', '  ```'].join('\n'))
    const block = codeBlocksViaQuery(f.doc, f.query)![0]!
    expect(block.indent).toBe(2)
    expect(block.startPos).toBe(2)
    expect(block.codeStartPos).toBe(f.doc.line(2).from + 2)
  })

  it('相邻开闭栏（空代码体）：codeStartPos = codeEndPos = 开栏行尾', () => {
    const f = makeSyntaxFake(['```', '```'].join('\n'))
    const block = codeBlocksViaQuery(f.doc, f.query)![0]!
    expect(block.codeStartPos).toBe(f.doc.line(1).to)
    expect(block.codeEndPos).toBe(f.doc.line(1).to)
  })

  it('未闭合围栏延至文末（``` 与 ~~~ 混用不互闭——平台树语义）', () => {
    const f = makeSyntaxFake(['```ts', 'a', '~~~', 'b'].join('\n'))
    const block = codeBlocksViaQuery(f.doc, f.query)![0]!
    expect(block.endPos).toBe(f.doc.length)
    expect(block.codeEndPos).toBe(f.doc.line(4).to)
    expect(block.language).toBe('ts')
  })

  it('引用内围栏：语言提取剥引用前缀；indent/startPos 含引用前缀；codeStart/codeEnd 取内容行', () => {
    const f = makeSyntaxFake(['> ```js', '> const a = 1', '> ```'].join('\n'))
    const block = codeBlocksViaQuery(f.doc, f.query)![0]!
    expect(block.language).toBe('js')
    expect(block.indent).toBe(2) // '> ' 计入围栏起始列（上游 start_pos - line.from 同义）
    expect(block.startPos).toBe(f.doc.line(1).from + 2)
    expect(block.endPos).toBe(f.doc.line(3).to)
    expect(block.codeStartPos).toBe(f.doc.line(2).from + 2) // 内容行首 + 缩进
    expect(block.codeEndPos).toBe(f.doc.line(2).to)
  })

  it('已知形态学边界钉住：相邻代码块零分隔行时连续 code 行 run 合并为一块（上游 iterate begin/end 节点为两块）', () => {
    // '> ```' 闭栏行与下一行顶层 '```ts' 开栏之间无非 code 行——查询版按
    // 连续 code run 分组取首行开栏，两块合一；上游树是两个 codeblock
    // begin/end 节点。消费面影响：相邻异语言块的后者经 codeBlockAtViaQuery
    // 取到首块语言。罕见形态（Markdown 笔记中两块间通常有空行），#5 切片 A
    // 既定形态学，规格「已知口径差异」节落档，如需拆分另开票
    const f = makeSyntaxFake(['> ```js', '> a', '> ```', '```ts', 'b'].join('\n'))
    const blocks = codeBlocksViaQuery(f.doc, f.query)!
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.language).toBe('js')
  })
})
