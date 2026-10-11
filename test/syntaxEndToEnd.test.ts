// 真实文档端到端抽查（工单 #5 切片 C，票面验收项）：以两份真实感
// markdown 文档（非玩具行）跑全消费链——行类型 / 作用域 / 行内分区 /
// 格式化跳过 / ModA 渐进选择，全部经 fake 平台判定链 + 真实模块函数
//（无内部 mock）。期望序列逐行注释手写，与文档结构逐一对应。
//
// fake 近似边界（test/syntaxFake.ts 头注释声明的形态学近似，真实平台
// 判定链不同处）在本文件命中三处，均于用例处显式标注「近似口径，
// 真实宿主联调归 #21」：
// 1. 无首管道 GFM 表格行 fake 不识别（近似 text；真实平台按 GFM 判 table）；
// 2. 货币 `$100 … $200` 的行内 $ 配对无贴字规则（fake 判 formula span；
//    真实平台词字符贴字不开启公式，判 none）；
// 3. 列表续行缩进近似（fake 沿用缩进 ≥2 形态学；真实树按解析归属）。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  detectScopeViaQuery,
  platformLineKindAt,
} from '../src/syntaxTreeQuery'
import type { AddonSyntaxLineKind } from '../types/vendor/shared/addonSyntaxApi'
import { splitLineIntoParts } from '../src/formatting/inlineParts'
import { classifyFormatSkipLines } from '../src/formattingCommands'
import {
  planModASelection as planModASelectionImpl,
  type SelectionRange,
} from '../src/modaSelection'
import { makeSyntaxFake } from './syntaxFake'

// =====================================================================
// 文档样本（真实感笔记：frontmatter 真实字段、多级标题、段落、嵌套与
// 任务列表、引用与 callout、多语言/缩进/未闭合围栏、表格、行内标记
// 混排、单行与跨行公式）
// =====================================================================

/** 文档 A：技术笔记（frontmatter + 全形态语法结构） */
export const DOC_A = [
  '---', // L1 fm 开界
  'title: 语法树查询笔记', // L2 fm
  'date: 2026-10-11', // L3 fm
  'tags: [cm6, lezer]', // L4 fm
  '---', // L5 fm 闭界
  '', // L6 空行
  '# 语法树查询', // L7 一级标题
  '', // L8 空行
  'CM6 增量解析保持树新鲜，', // L9 段落行
  '平台以位置查询暴露判定。', // L10 段落行（与 L9 同段）
  '', // L11 空行
  '## 消费链', // L12 二级标题
  '', // L13 空行
  '    缩进代码一', // L14 缩进代码（4 空格）
  '    缩进代码二', // L15 缩进代码
  '', // L16 空行
  '- 行类型判定', // L17 列表标记行
  '  - ModA 渐进选择', // L18 嵌套列表
  '  - 格式化跳过', // L19 嵌套列表
  '- [x] 映射矩阵', // L20 任务项（完成）
  '- [ ] 真实宿主联调', // L21 任务项（未完成）
  '', // L22 空行
  '> nodeNames 非稳定承诺。', // L23 引用行
  '> [!warning] 不要依赖节点名写分支', // L24 callout 标题行
  '', // L25 空行
  '> - 引用内列表', // L26 引用内列表
  '> - 另一项', // L27 引用内列表
  '', // L28 空行
  '```ts', // L29 围栏开栏（ts）
  'const x = 1', // L30 代码体
  '```', // L31 围栏闭栏
  '', // L32 空行
  '$$', // L33 跨行公式开栏
  'a + b', // L34 公式体
  '$$', // L35 跨行公式闭栏
  '', // L36 空行
  '$$单行闭合$$', // L37 单行闭合公式块
  '', // L38 空行
  '| 模块 | 职责 |', // L39 表头
  '| --- | --- |', // L40 分隔行
  '| 查询 | 判定 |', // L41 表体
  '| 分区 | 行内 |', // L42 表体
  '', // L43 空行
  '混排行：[[00 索引|索引]]、[文档](https://example.com)、`code`、$x$ 与文字。', // L44 行内标记混排
].join('\n')

/** 文档 B：日志（无 fm、callout、嵌套+续行列表、无首管道表、货币边界、未闭合围栏） */
export const DOC_B = [
  '# 十月十一日', // L1 一级标题
  '', // L2 空行
  '今天开销：午饭 $25，晚饭 $30。', // L3 货币边界行（近似口径见下）
  '', // L4 空行
  '> [!tip] 记账', // L5 callout 标题行
  '> 用 [[预算表]] 核对，模板见 [页面](https://example.com)。', // L6 引用内链接混排
  '', // L7 空行
  '购物清单：', // L8 段落行
  '', // L9 空行
  '- 蔬菜', // L10 列表标记行
  '  - 白菜', // L11 嵌套列表
  '  - 萝卜', // L12 嵌套列表
  '- 水果', // L13 列表标记行
  '  当季优先，续行说明', // L14 列表续行（缩进 2）
  '', // L15 空行
  '无首管道表：', // L16 段落行
  '月份 | 支出', // L17 无首管道表头（近似口径见下）
  '--- | ---', // L18 无首管道分隔行（近似）
  '九月 | 1200', // L19 无首管道表体（近似）
  '', // L20 空行
  '`[[代码]]` 不是双链。', // L21 反引号内 wikilink 形态（已知差异钉住）
  '', // L22 空行
  '草稿如下', // L23 段落行
  '', // L24 空行
  '```text', // L25 未闭合围栏开栏
  '未闭合围栏，其后皆代码', // L26 围栏内容（未闭合延至文末）
].join('\n')

// =====================================================================
// 文档 A：全消费链抽查
// =====================================================================

describe('文档 A（技术笔记）：行类型序列', () => {
  const fake = makeSyntaxFake(DOC_A)
  const { doc, query } = fake

  it('platformLineKindAt 逐行：与文档结构手写期望核对', () => {
    const kinds: AddonSyntaxLineKind[] = []
    for (let n = 1; n <= doc.lines; n++) kinds.push(platformLineKindAt(doc, query, n)!)
    expect(kinds).toEqual([
      'frontmatter', // L1 --- 开界
      'frontmatter', // L2 title
      'frontmatter', // L3 date
      'frontmatter', // L4 tags
      'frontmatter', // L5 --- 闭界
      'text', // L6 空行（empty 为消费面补判，平台 kind 是 text）
      'heading', // L7 # 一级标题
      'text', // L8 空行
      'text', // L9 段落
      'text', // L10 段落
      'text', // L11 空行
      'heading', // L12 ## 二级标题
      'text', // L13 空行
      'code', // L14 缩进代码
      'code', // L15 缩进代码
      'text', // L16 空行
      'list', // L17 - 项
      'list', // L18   - 嵌套项
      'list', // L19   - 嵌套项
      'list', // L20 - [x] 任务项
      'list', // L21 - [ ] 任务项
      'text', // L22 空行
      'quote', // L23 > 引用
      'quote', // L24 > [!warning] callout（平台无枚举，统一 quote）
      'text', // L25 空行
      'list', // L26 > - 引用内列表（代表位置在内容区，list > quote）
      'list', // L27 > - 引用内列表
      'text', // L28 空行
      'code', // L29 ```ts 开栏
      'code', // L30 代码体
      'code', // L31 ``` 闭栏
      'text', // L32 空行
      'formula', // L33 $$ 开栏
      'formula', // L34 公式体
      'formula', // L35 $$ 闭栏
      'text', // L36 空行
      'formula', // L37 $$单行闭合$$（升级收益：降级版不识别）
      'text', // L38 空行
      'table', // L39 表头
      'table', // L40 分隔行
      'table', // L41 表体
      'table', // L42 表体
      'text', // L43 空行
      'text', // L44 混排行（行内标记不改变行类型）
    ])
  })

  it('classifyFormatSkipLines：fm/代码/公式/表格跳过，标题/引用/列表/文本不跳过', () => {
    expect(classifyFormatSkipLines(doc, query)).toEqual([
      true, true, true, true, true, // L1-5 frontmatter
      false, // L6 空行
      false, // L7 heading（上游 v1 不特判）
      false, false, false, false, // L8-11 空行/段落/空行
      false, // L12 heading
      false, // L13 空行
      true, true, // L14-15 缩进代码
      false, // L16 空行
      false, false, false, false, false, // L17-21 列表
      false, // L22 空行
      false, false, // L23-24 引用（callout 不跳过）
      false, // L25 空行
      false, false, // L26-27 引用内列表
      false, // L28 空行
      true, true, true, // L29-31 围栏代码
      false, // L32 空行
      true, true, true, // L33-35 跨行公式
      false, // L36 空行
      true, // L37 单行闭合公式
      false, // L38 空行
      true, true, true, true, // L39-42 表格（#28 跳过表格行不翻案）
      false, // L43 空行
      false, // L44 混排行
    ])
  })
})

describe('文档 A：作用域采样（detectScopeViaQuery 关键位置）', () => {
  const fake = makeSyntaxFake(DOC_A)
  const { doc, query } = fake
  const posOf = (lineNo: number, col: number): number => doc.line(lineNo).from + col

  it('代码体与围栏行 → Code 带语言；跨行/单行公式 → Formula', () => {
    expect(detectScopeViaQuery(doc, query, posOf(30, 3))).toEqual({ scope: 'code', language: 'ts' })
    expect(detectScopeViaQuery(doc, query, posOf(29, 3))).toEqual({ scope: 'code', language: 'ts' }) // 开栏行属块区间
    expect(detectScopeViaQuery(doc, query, posOf(34, 1))).toEqual({ scope: 'formula' })
    expect(detectScopeViaQuery(doc, query, posOf(37, 2))).toEqual({ scope: 'formula' })
  })

  it('链接内 → Text；链接外 code span → Code；行内公式 → Formula（同一混排行内）', () => {
    // L44 '混排行：[[00 索引|索引]]、[文档](https://example.com)、`code`、$x$ 与文字。'
    expect(detectScopeViaQuery(doc, query, posOf(44, 7))).toEqual({ scope: 'text' }) // wikilink 内
    expect(detectScopeViaQuery(doc, query, posOf(44, 20))).toEqual({ scope: 'text' }) // mdlink 内
    expect(detectScopeViaQuery(doc, query, posOf(44, 45))).toEqual({ scope: 'code' }) // `code` 反引号内（链接外，无语言）
    expect(detectScopeViaQuery(doc, query, posOf(44, 51))).toEqual({ scope: 'formula' }) // $x$ 内
  })

  it('普通文本 / 表格内 / frontmatter 内 → Text', () => {
    expect(detectScopeViaQuery(doc, query, posOf(9, 3))).toEqual({ scope: 'text' })
    expect(detectScopeViaQuery(doc, query, posOf(41, 3))).toEqual({ scope: 'text' })
    expect(detectScopeViaQuery(doc, query, posOf(2, 5))).toEqual({ scope: 'text' }) // fm 源码态
  })
})

describe('文档 A：行内分区（splitLineIntoParts）', () => {
  const fake = makeSyntaxFake(DOC_A)
  const { doc, query } = fake

  it('混排行 → text / wikilink / mdlink / code / formula 分区序列', () => {
    const parts = splitLineIntoParts(doc, query, 44)
    expect(parts!.map((p) => `${p.type}[${p.begin},${p.end})`)).toEqual([
      'text[0,4)', // '混排行：'
      'wikilink[4,16)', // '[[00 索引|索引]]'
      'text[16,17)', // '、'
      'mdlink[17,42)', // '[文档](https://example.com)'
      'text[42,43)', // '、'
      'code[43,49)', // '`code`'
      'text[49,50)', // '、'
      'formula[50,53)', // '$x$'
      'text[53,58)', // ' 与文字。'
    ])
  })

  it('分区覆盖整行无缺口、内容拼接还原原文', () => {
    const parts = splitLineIntoParts(doc, query, 44)!
    const text = doc.line(44).text
    let cursor = 0
    for (const p of parts) {
      expect(p.begin).toBe(cursor)
      expect(text.slice(p.begin, p.end)).toBe(p.content)
      cursor = p.end
    }
    expect(cursor).toBe(text.length)
  })
})

describe('文档 A：ModA 渐进选择三档决策', () => {
  const planWith = (doc: string, cursor: number): SelectionRange | null =>
    planModASelectionImpl(EditorState.create({ doc, selection: { anchor: cursor } }), makeSyntaxFake(doc).query)

  /** 连续按键序列（plan 回写为新选区再 plan，null = PASS 透传终止） */
  const progression = (doc: string, cursor: number, max = 6): string[] => {
    const labels: string[] = []
    let state = EditorState.create({ doc, selection: { anchor: cursor } })
    for (let i = 0; i < max; i++) {
      const plan = planModASelectionImpl(state, makeSyntaxFake(doc).query)
      if (plan === null) {
        labels.push('PASS')
        return labels
      }
      const from = Math.min(plan.anchor, plan.head)
      const to = Math.max(plan.anchor, plan.head)
      labels.push(state.doc.sliceString(from, to))
      state = state.update({ selection: { anchor: plan.anchor, head: plan.head } }).state
    }
    return labels
  }
  const posOf = (lineNo: number, col: number): number =>
    makeSyntaxFake(DOC_A).doc.line(lineNo).from + col

  it('文本行（双行段落）：行 → 段块 → 透传', () => {
    expect(progression(DOC_A, posOf(9, 2))).toEqual([
      'CM6 增量解析保持树新鲜，',
      'CM6 增量解析保持树新鲜，\n平台以位置查询暴露判定。',
      'PASS',
    ])
  })

  it('引用行：行内容 → 引用块（含 callout 行并入）→ 透传', () => {
    expect(progression(DOC_A, posOf(23, 3))).toEqual([
      'nodeNames 非稳定承诺。', // 行内容（跳过 '> ' 前缀）
      '> nodeNames 非稳定承诺。\n> [!warning] 不要依赖节点名写分支', // 引用块 L23-24
      'PASS',
    ])
  })

  it('列表标记行：内容 → 当前行及子列表 → 整列表 → 全文 → 透传', () => {
    expect(progression(DOC_A, posOf(17, 2), 7)).toEqual([
      '行类型判定', // 档 1：内容（不含 '- '）
      '- 行类型判定\n  - ModA 渐进选择\n  - 格式化跳过', // 档 2：当前行及子列表 L17-19
      '- 行类型判定\n  - ModA 渐进选择\n  - 格式化跳过\n- [x] 映射矩阵\n- [ ] 真实宿主联调', // 档 3：整列表 L17-21
      DOC_A, // 档 4：全文
      'PASS',
    ])
  })

  it('frontmatter 与代码块内：不接管（透传平台全选）', () => {
    expect(planWith(DOC_A, posOf(2, 5))).toBeNull()
    expect(planWith(DOC_A, posOf(30, 3))).toBeNull()
  })
})

// =====================================================================
// 文档 B：全消费链抽查（近似边界声明集中处）
// =====================================================================

describe('文档 B（日志）：行类型序列与跳过', () => {
  const fake = makeSyntaxFake(DOC_B)
  const { doc, query } = fake

  it('platformLineKindAt 逐行：无首管道表格行为 fake 近似（真实平台判 table）', () => {
    const kinds: AddonSyntaxLineKind[] = []
    for (let n = 1; n <= doc.lines; n++) kinds.push(platformLineKindAt(doc, query, n)!)
    expect(kinds).toEqual([
      'heading', // L1 # 十月十一日
      'text', // L2 空行
      'text', // L3 货币行（行类型不受行内 $ 影响）
      'text', // L4 空行
      'quote', // L5 > [!tip] callout
      'quote', // L6 > 引用内链接混排
      'text', // L7 空行
      'text', // L8 购物清单：
      'text', // L9 空行
      'list', // L10 - 蔬菜
      'list', // L11   - 白菜
      'list', // L12   - 萝卜
      'list', // L13 - 水果
      'list', // L14   续行（近似口径：fake 缩进 ≥2 形态学；真实树按解析归属——真实宿主联调归 #21）
      'text', // L15 空行
      'text', // L16 无首管道表：段落
      'text', // L17 月份 | 支出（近似口径：fake 不识别无首管道 GFM 表，判 text；真实平台判 table——真实宿主联调归 #21）
      'text', // L18 --- | ---（近似口径同上）
      'text', // L19 九月 | 1200（近似口径同上）
      'text', // L20 空行
      'text', // L21 反引号行
      'text', // L22 空行
      'text', // L23 草稿如下
      'text', // L24 空行
      'code', // L25 ```text 开栏（未闭合）
      'code', // L26 围栏内容（未闭合延至文末）
    ])
  })

  it('classifyFormatSkipLines：仅未闭合围栏两行跳过（无首管道表三行按近似 text 不跳过）', () => {
    const skip = classifyFormatSkipLines(doc, query)
    expect(skip.slice(0, 24).every((b) => !b)).toBe(true)
    expect(skip.slice(24)).toEqual([true, true])
    // 近似口径：真实平台对 L17-19 判 table → FORMAT_SKIP table=true 跳过；
    // fake 判 text 不跳过——期望以 fake 为准，真实宿主联调归 #21
  })
})

describe('文档 B：作用域与分区（货币边界与反引号 wikilink 形态）', () => {
  const fake = makeSyntaxFake(DOC_B)
  const { doc, query } = fake
  const posOf = (lineNo: number, col: number): number => doc.line(lineNo).from + col

  it('货币行：span 外 Text；span 内 Formula 为 fake 近似（真实平台贴字规则判 none）', () => {
    expect(detectScopeViaQuery(doc, query, posOf(3, 2))).toEqual({ scope: 'text' })
    // '今天开销：午饭 $25，晚饭 $30。'——$25 的 $ 到 $30 的 $ 被 fake 的
    // 行内 $ 配对圈为 span（无贴字规则）→ 光标在内判 Formula。真实平台：
    // $ 后邻数字（词字符）不开启公式 → none → Text。
    // 近似口径，真实宿主联调归 #21
    expect(detectScopeViaQuery(doc, query, posOf(3, 10))).toEqual({ scope: 'formula' })
  })

  it('反引号内 [[..]]：链接区段优先剪除判 Text（已知差异：上游树版判 Code）', () => {
    // '`[[代码]]` 不是双链。'——上游 code span 内的 [[..]] 不构成链接节点
    // → Code；本移植 linkSpansOfLine 纯正则圈走 [[代码]] → Text。
    // 规格 docs/specs/syntax-line-types.md「已知口径差异」节落档
    expect(detectScopeViaQuery(doc, query, posOf(21, 3))).toEqual({ scope: 'text' })
  })

  it('未闭合围栏内 → Code 带开栏语言（text），块区间延至文末', () => {
    expect(detectScopeViaQuery(doc, query, posOf(26, 4))).toEqual({ scope: 'code', language: 'text' })
  })

  it('引用内链接混排行分区：text / wikilink / text / mdlink / text', () => {
    const parts = splitLineIntoParts(doc, query, 6)
    expect(parts!.map((p) => `${p.type}[${p.begin},${p.end})`)).toEqual([
      'text[0,4)', // '> 用 '
      'wikilink[4,11)', // '[[预算表]]'
      'text[11,19)', // ' 核对，模板见 '
      'mdlink[19,44)', // '[页面](https://example.com)'
      'text[44,45)', // '。'
    ])
  })

  it('反引号包 [[..]] 行分区：code span 被链接区段剪除碎化（已知差异形态钉住）', () => {
    // rawSpan = code[0,8)，链接区段 [1,7) 优先剪除 → 左右反引号各成 code
    // 碎片、[[代码]] 归 wikilink——上游树版整段是 InlineCode（code 分区）
    const parts = splitLineIntoParts(doc, query, 21)
    expect(parts!.map((p) => `${p.type}[${p.begin},${p.end})`)).toEqual([
      'code[0,1)', // 左反引号（链接剪除后的碎片）
      'wikilink[1,7)', // '[[代码]]'（链接区段优先——上游归 code）
      'code[7,8)', // 右反引号（碎片）
      'text[8,14)', // ' 不是双链。'
    ])
  })
})

describe('文档 B：ModA 列表续行档', () => {
  it('续行：内容 → 起点项标记后内容 → 标记行升档（子列表 → 整列表 → 全文 → 透传）', () => {
    const fake = makeSyntaxFake(DOC_B)
    const cursor = fake.doc.line(14).from + 3
    const labels: string[] = []
    let state = EditorState.create({ doc: DOC_B, selection: { anchor: cursor } })
    for (let i = 0; i < 8; i++) {
      const plan = planModASelectionImpl(state, makeSyntaxFake(DOC_B).query)
      if (plan === null) {
        labels.push('PASS')
        break
      }
      const from = Math.min(plan.anchor, plan.head)
      const to = Math.max(plan.anchor, plan.head)
      labels.push(state.doc.sliceString(from, to))
      state = state.update({ selection: { anchor: plan.anchor, head: plan.head } }).state
    }
    expect(labels).toEqual([
      '当季优先，续行说明', // 首按：续行内容（跳过缩进）
      '水果\n  当季优先，续行说明', // 起点项（- 水果）标记后内容
      '- 水果\n  当季优先，续行说明', // anchor 落回标记行：档 2 当前行及子列表
      '- 蔬菜\n  - 白菜\n  - 萝卜\n- 水果\n  当季优先，续行说明', // 档 3：整列表 L10-14
      DOC_B, // 档 4：全文
      'PASS',
    ])
  })
})
