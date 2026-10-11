// 树版行级扫描单元测试（工单 #5 切片 A——#11 正则降级版升级为平台查询版）。
// 上游对照：
// - 行类型判定 keyboard_handlers.ts:748-788（getPosLineType2——平台
//   experimental.syntax.lineTypeAt 经映射表投影，判定链由 test/syntaxFake.ts
//   的 fake 驱动，近似口径见其头注释）；
// - 引用块信息 syntax.ts:155-201（getQuoteInfoInPos，上游本就是纯正则，
//   逐字移植，本组用例不动）；
// - 段块边界 keyboard_handlers.ts:783-809（getBlockLinesInPos 的邻行判定）。
// 平台语义翻转的降级差异用例（原「降级口径」随正则状态机一并消除）：
// - 单行 `$$x$$` 现识别 formula；
// - 围栏 ``` 与 ~~~ 混用不互闭（未闭合延至文末）；
// - 未闭合 `$$` 块不产出（后续行按普通文本）；
// - 未闭合 frontmatter 不视为 fm（按普通 Markdown）。
import { describe, expect, it } from 'vitest'
import {
  paragraphBlockAt,
  quoteInfoAt,
  scanLines,
  type LineInfo,
  type LineKind,
} from '../src/blockScan'
import { makeRejectingQuery, makeSyntaxFake } from './syntaxFake'

/** 查询版扫描入口：fake 判定链驱动（doc 与 query 同一文本，坐标一致） */
function scanOf(texts: readonly string[]): LineInfo[] {
  const { query } = makeSyntaxFake(texts.join('\n'))
  return scanLines(texts, query)
}

/** kinds 简写断言：逐行核对扫描类型序列 */
function expectKinds(texts: readonly string[], kinds: readonly LineKind[]): void {
  expect(scanOf(texts).map((l) => l.kind)).toEqual(kinds)
}

describe('scanLines：基础行类型', () => {
  it('普通文本 / 标题 / 空行（平台 heading 映射 text，空行本地判 empty）', () => {
    expectKinds(
      ['plain', '# heading', '#no-space-hash', '', '  '],
      ['text', 'text', 'text', 'empty', 'empty'],
    )
  })

  it('列表标记三形态：无序 / 有序 / 任务项', () => {
    const scan = scanOf(['- a', '* b', '+ c', '1. d', '12. e', '- [x] done', '- [ ] todo'])
    expect(scan.map((l) => l.kind)).toEqual(['list', 'list', 'list', 'list', 'list', 'list', 'list'])
    // markerEnd = 缩进 + 标记 + 其后一个分隔空白（上游 match[0].length）
    expect(scan.map((l) => l.markerEnd)).toEqual([2, 2, 2, 3, 4, 6, 6])
  })

  it('强调符与缩进数字不误判为列表', () => {
    expectKinds(['*emphasis*', '1.no-space', '-nospace', '2026-10-09'], ['text', 'text', 'text', 'text'])
  })

  it('引用行（含无空格 > 与多级 >>）', () => {
    const scan = scanOf(['> a', '>b', '> > deep', 'plain'])
    expect(scan.map((l) => l.kind)).toEqual(['quote', 'quote', 'quote', 'text'])
    // quoteContentStart：跳过 > 前缀与其后一个可选空格（上游 quote_regex
    // 只剥离首个 > 组——嵌套 > 留在内容中，上游语义）
    expect(scan[0]!.quoteContentStart).toBe(2)
    expect(scan[1]!.quoteContentStart).toBe(1)
    expect(scan[2]!.quoteContentStart).toBe(2)
    expect(scan[3]!.quoteContentStart).toBe(null)
  })

  it('缩进列表与缩进引用的 indent 计数', () => {
    const scan = scanOf(['  - nested', '\t- tabbed', '  > quote'])
    expect(scan.map((l) => l.kind)).toEqual(['list', 'list', 'quote'])
    expect(scan.map((l) => l.indent)).toEqual([2, 1, 2])
  })

  it('引用内列表：代表位置取内容区（平台优先级 list > quote，对齐上游 v2 行内任一 list）', () => {
    const scan = scanOf(['> - qlist'])
    expect(scan[0]!.kind).toBe('list')
    // markerEnd 含引用前缀；quoteContentStart 归 null（quoteInfoAt 只消费 quote 行）
    expect(scan[0]!.markerEnd).toBe(4)
    expect(scan[0]!.quoteContentStart).toBe(null)
  })
})

describe('scanLines：围栏与块级上下文（fake 围栏状态机近似平台树）', () => {
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

  it('围栏 ``` 与 ~~~ 混用不互闭（平台树语义——原降级差异已消除）', () => {
    expectKinds(['```ts', 'a', '~~~', 'b'], ['code', 'code', 'code', 'code'])
  })

  it('公式块 $$ 开闭为 formula（跨行块表）', () => {
    expectKinds(['$$', 'E=mc^2', '$$', 'inline $x$ ok'], ['formula', 'formula', 'formula', 'text'])
  })

  it('单行闭合 $$x$$ 识别为 formula（平台单行补判——原降级差异已消除）', () => {
    expectKinds(['$$x$$', 'tail'], ['formula', 'text'])
  })

  it('段内 text $$x$$ tail 仍是 text（上游 v1/v2 全行校验同款口径）', () => {
    expectKinds(['text $$x$$ tail'], ['text'])
  })

  it('未闭合 $$ 块不产出（后续行按普通文本——平台稳定降级语义）', () => {
    expectKinds(['$$', 'E=mc^2'], ['text', 'text'])
  })

  it('frontmatter：首行 --- 开到闭合 ---（含两边界行）', () => {
    expectKinds(['---', 'title: x', '---', 'body'], ['frontmatter', 'frontmatter', 'frontmatter', 'text'])
  })

  it('非首行 --- 是普通文本（水平线，平台树归 text）', () => {
    expectKinds(['body', '---', 'tail'], ['text', 'text', 'text'])
  })

  it('未闭合 frontmatter 不视为 fm（平台按普通 Markdown 处理）', () => {
    expectKinds(['---', 'key: v'], ['text', 'text'])
  })
})

describe('scanLines：列表续行（fake 缩进近似——真实树按解析归属）', () => {
  it('缩进 ≥2 且上方最近非空行属列表 → 续行归 list（markerEnd=0）', () => {
    const scan = scanOf(['- a', '  cont', '- b'])
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

  it('缩进 1 空格不算续行（阈值 ≥2）', () => {
    expectKinds(['- a', ' x'], ['list', 'text'])
  })
})

describe('scanLines：查询适配器边界', () => {
  it('缺省 query 抛错（哨兵：切片 B 接线前无判定路径，不并存降级实现）', () => {
    expect(() => scanLines(['plain'])).toThrow(/query/i)
  })

  it('查询拒绝抛错（非 live/已销毁视图——拒绝只发生在不该接管的场景）', () => {
    expect(() => scanLines(['plain'], makeRejectingQuery())).toThrow(/拒绝|reject/i)
  })
})

describe('quoteInfoAt：引用块信息（上游 getQuoteInfoInPos 逐字移植）', () => {
  it('单行引用：块即当前行', () => {
    const texts = ['> hello']
    const info = quoteInfoAt(texts, scanOf(texts), 1)
    expect(info).toEqual({ startLine: 1, endLine: 1, contentStart: 2, isCallout: false })
  })

  it('多行引用：中间行视角覆盖全块', () => {
    const texts = ['> a', '> b', '> c', 'plain']
    expect(quoteInfoAt(texts, scanOf(texts), 2)).toEqual({
      startLine: 1,
      endLine: 3,
      contentStart: 2,
      isCallout: false,
    })
  })

  it('callout 标题行：内容起点跳过 callout 标记，isCallout=true', () => {
    const texts = ['> [!note] Title', '> body']
    const info = quoteInfoAt(texts, scanOf(texts), 1)
    // '> [!note] ' 长度 10
    expect(info).toEqual({ startLine: 1, endLine: 2, contentStart: 10, isCallout: true })
  })

  it('callout 体内行的内容起点只跳过 > 前缀（仍归该 callout 块）', () => {
    const texts = ['> [!note] T', '> body', '> more']
    const info = quoteInfoAt(texts, scanOf(texts), 2)
    expect(info).toEqual({ startLine: 1, endLine: 3, contentStart: 2, isCallout: true })
  })

  it('非引用行返回 null', () => {
    expect(quoteInfoAt(['plain'], scanOf(['plain']), 1)).toBeNull()
  })

  it('引用链中间夹非引用行时下行扩展停止', () => {
    const texts = ['> a', 'plain', '> b']
    expect(quoteInfoAt(texts, scanOf(texts), 1)).toEqual({
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
    expect(paragraphBlockAt(texts, scanOf(texts), 2)).toEqual({ startLine: 1, endLine: 3 })
  })

  it('空行 / 引用 / 列表 / 围栏是段块边界', () => {
    const texts = ['para', '', 'quote below', '> q', '- l', '```', 'c', '```']
    const scan = scanOf(texts)
    expect(paragraphBlockAt(texts, scan, 1)).toEqual({ startLine: 1, endLine: 1 })
  })

  it('标题行不并入邻侧段块（上游 reg_headings 排除）', () => {
    const texts = ['para', '# head', 'para2']
    const scan = scanOf(texts)
    // 标题行自身视角：邻行扩展仍并入两侧文本（上游语义——当前行无排除）
    expect(paragraphBlockAt(texts, scan, 2)).toEqual({ startLine: 1, endLine: 3 })
    // 文本行视角：上行遇标题即止
    expect(paragraphBlockAt(texts, scan, 1)).toEqual({ startLine: 1, endLine: 1 })
    expect(paragraphBlockAt(texts, scan, 3)).toEqual({ startLine: 3, endLine: 3 })
  })

  it('首尾行扩展越界安全', () => {
    const texts = ['only']
    expect(paragraphBlockAt(texts, scanOf(texts), 1)).toEqual({ startLine: 1, endLine: 1 })
  })
})
