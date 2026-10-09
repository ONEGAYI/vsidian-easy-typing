// 正则降级行级扫描单元测试（工单 #11 列表/引用块边界识别——#5 语法树
// blocked 的先行降级）。上游对照：
// - 行类型判定 keyboard_handlers.ts:512（getPosLineType2 树版——降级为
//   行首形态学扫描，边界差异见 docs/specs/enhance-moda.md「降级口径」）；
// - 引用块信息 syntax.ts:155-201（getQuoteInfoInPos，上游本就是纯正则，
//   逐字移植）；
// - 段块边界 keyboard_handlers.ts:783-809（getBlockLinesInPos 的邻行判定
//   降级为扫描 kind）。
import { describe, expect, it } from 'vitest'
import {
  scanLines,
  quoteInfoAt,
  paragraphBlockAt,
  type LineKind,
} from '../src/blockScan'

/** kinds 简写断言：逐行核对扫描类型序列 */
function expectKinds(texts: readonly string[], kinds: readonly LineKind[]): void {
  expect(scanLines(texts).map((l) => l.kind)).toEqual(kinds)
}

describe('scanLines：基础行类型', () => {
  it('普通文本 / 标题 / 空行（标题按上游 v2 归 text，空行独立 kind）', () => {
    expectKinds(
      ['plain', '# heading', '#no-space-hash', '', '  '],
      ['text', 'text', 'text', 'empty', 'empty'],
    )
  })

  it('列表标记三形态：无序 / 有序 / 任务项', () => {
    const scan = scanLines(['- a', '* b', '+ c', '1. d', '12. e', '- [x] done', '- [ ] todo'])
    expect(scan.map((l) => l.kind)).toEqual(['list', 'list', 'list', 'list', 'list', 'list', 'list'])
    // markerEnd = 缩进 + 标记 + 其后一个分隔空白（上游 match[0].length）
    expect(scan.map((l) => l.markerEnd)).toEqual([2, 2, 2, 3, 4, 6, 6])
  })

  it('强调符与缩进数字不误判为列表', () => {
    expectKinds(['*emphasis*', '1.no-space', '-nospace', '2026-10-09'], ['text', 'text', 'text', 'text'])
  })

  it('引用行（含无空格 > 与多级 >>）', () => {
    const scan = scanLines(['> a', '>b', '> > deep', 'plain'])
    expect(scan.map((l) => l.kind)).toEqual(['quote', 'quote', 'quote', 'text'])
    // quoteContentStart：跳过 > 前缀与其后一个可选空格（上游 quote_regex
    // 只剥离首个 > 组——嵌套 > 留在内容中，上游语义）
    expect(scan[0]!.quoteContentStart).toBe(2)
    expect(scan[1]!.quoteContentStart).toBe(1)
    expect(scan[2]!.quoteContentStart).toBe(2)
    expect(scan[3]!.quoteContentStart).toBe(null)
  })

  it('缩进列表与缩进引用的 indent 计数', () => {
    const scan = scanLines(['  - nested', '\t- tabbed', '  > quote'])
    expect(scan.map((l) => l.kind)).toEqual(['list', 'list', 'quote'])
    expect(scan.map((l) => l.indent)).toEqual([2, 1, 2])
  })
})

describe('scanLines：围栏与代状态（文档级一次扫描）', () => {
  it('代码围栏 ``` 与 ~~~ 开闭（含围栏行本身均 code）', () => {
    expectKinds(
      ['```ts', 'const a = 1', '```', 'plain', '~~~', 'body', '~~~'],
      ['code', 'code', 'code', 'text', 'code', 'code', 'code'],
    )
  })

  it('列表内缩进围栏同样进入 code 态', () => {
    expectKinds(
      ['- a', '  ```', '  code', '  ```', '- b'],
      ['list', 'code', 'code', 'code', 'list'],
    )
  })

  it('围栏态内 - 列表标记 / > 引用 / # 标题均视为 code', () => {
    expectKinds(['```', '- not list', '> not quote', '```'], ['code', 'code', 'code', 'code'])
  })

  it('未闭合围栏延续到文末', () => {
    expectKinds(['```', 'unclosed'], ['code', 'code'])
  })

  it('公式块 $$ 开闭为 formula（行首行尾等值 $$）', () => {
    expectKinds(['$$', 'E=mc^2', '$$', 'inline $x$ ok'], ['formula', 'formula', 'formula', 'text'])
  })

  it('frontmatter：首行 --- 开到闭合 ---（含两边界行）', () => {
    expectKinds(['---', 'title: x', '---', 'body'], ['frontmatter', 'frontmatter', 'frontmatter', 'text'])
  })

  it('非首行 --- 是普通文本（水平线，上游 v2 归 text）', () => {
    expectKinds(['body', '---', 'tail'], ['text', 'text', 'text'])
  })

  it('frontmatter 未闭合延续到文末', () => {
    expectKinds(['---', 'key: v'], ['frontmatter', 'frontmatter'])
  })
})

describe('scanLines：列表续行（降级近似树版 LineType.list 的成员行）', () => {
  it('缩进 ≥2 且上方最近非空行属列表 → 续行归 list（markerEnd=0）', () => {
    const scan = scanLines(['- a', '  cont', '- b'])
    expect(scan.map((l) => l.kind)).toEqual(['list', 'list', 'list'])
    expect(scan[1]!.markerEnd).toBe(0)
  })

  it('续行与标记行间的空行不阻断（松散列表）', () => {
    expectKinds(['- a', '', '  cont'], ['list', 'empty', 'list'])
  })

  it('上方最近非空行非列表 → 缩进文本仍是 text', () => {
    expectKinds(['plain', '  indented'], ['text', 'text'])
  })

  it('续行链：续行之下更深缩进仍归 list', () => {
    expectKinds(['- a', '  cont', '    deeper'], ['list', 'list', 'list'])
  })

  it('缩进 1 空格不算续行（阈值 ≥2，对齐上游整列表扫描的 indent>=2）', () => {
    expectKinds(['- a', ' x'], ['list', 'text'])
  })
})

describe('quoteInfoAt：引用块信息（上游 getQuoteInfoInPos 逐字移植）', () => {
  it('单行引用：块即当前行', () => {
    const texts = ['> hello']
    const info = quoteInfoAt(texts, scanLines(texts), 1)
    expect(info).toEqual({ startLine: 1, endLine: 1, contentStart: 2, isCallout: false })
  })

  it('多行引用：中间行视角覆盖全块', () => {
    const texts = ['> a', '> b', '> c', 'plain']
    expect(quoteInfoAt(texts, scanLines(texts), 2)).toEqual({
      startLine: 1,
      endLine: 3,
      contentStart: 2,
      isCallout: false,
    })
  })

  it('callout 标题行：内容起点跳过 callout 标记，isCallout=true', () => {
    const texts = ['> [!note] Title', '> body']
    const info = quoteInfoAt(texts, scanLines(texts), 1)
    // '> [!note] ' 长度 10
    expect(info).toEqual({ startLine: 1, endLine: 2, contentStart: 10, isCallout: true })
  })

  it('callout 体内行的内容起点只跳过 > 前缀（仍归该 callout 块）', () => {
    const texts = ['> [!note] T', '> body', '> more']
    const info = quoteInfoAt(texts, scanLines(texts), 2)
    expect(info).toEqual({ startLine: 1, endLine: 3, contentStart: 2, isCallout: true })
  })

  it('非引用行返回 null', () => {
    expect(quoteInfoAt(['plain'], scanLines(['plain']), 1)).toBeNull()
  })

  it('引用链中间夹非引用行时下行扩展停止', () => {
    const texts = ['> a', 'plain', '> b']
    expect(quoteInfoAt(texts, scanLines(texts), 1)).toEqual({
      startLine: 1,
      endLine: 1,
      contentStart: 2,
      isCallout: false,
    })
  })
})

describe('paragraphBlockAt：段块邻行扩展（上游 getBlockLinesInPos 降级）', () => {
  it('连续文本行聚为一段块', () => {
    const texts = ['one', 'two', 'three']
    expect(paragraphBlockAt(texts, scanLines(texts), 2)).toEqual({ startLine: 1, endLine: 3 })
  })

  it('空行 / 引用 / 列表 / 围栏是段块边界', () => {
    const texts = ['para', '', 'quote below', '> q', '- l', '```', 'c', '```']
    const scan = scanLines(texts)
    expect(paragraphBlockAt(texts, scan, 1)).toEqual({ startLine: 1, endLine: 1 })
  })

  it('标题行不并入邻侧段块（上游 reg_headings 排除）', () => {
    const texts = ['para', '# head', 'para2']
    const scan = scanLines(texts)
    // 标题行自身视角：邻行扩展仍并入两侧文本（上游语义——当前行无排除）
    expect(paragraphBlockAt(texts, scan, 2)).toEqual({ startLine: 1, endLine: 3 })
    // 文本行视角：上行遇标题即止
    expect(paragraphBlockAt(texts, scan, 1)).toEqual({ startLine: 1, endLine: 1 })
    expect(paragraphBlockAt(texts, scan, 3)).toEqual({ startLine: 3, endLine: 3 })
  })

  it('首尾行扩展越界安全', () => {
    const texts = ['only']
    expect(paragraphBlockAt(texts, scanLines(texts), 1)).toEqual({ startLine: 1, endLine: 1 })
  })
})
