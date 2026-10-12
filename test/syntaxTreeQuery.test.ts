// 树版语法查询核心单元测试（工单 #5 切片 A）：映射常量、行类型/块信息/
// 作用域提取 API 的映射矩阵起点。判定链由 test/syntaxFake.ts 的平台 fake
// 驱动（近似口径见其头注释）；拒绝路径用恒拒绝查询。
import { describe, expect, it } from 'vitest'
import {
  codeBlockAtViaQuery,
  codeBlocksViaQuery,
  detectScopeViaQuery,
  docOfLines,
  docOfText,
  FORMAT_SKIP_BY_PLATFORM,
  lineInfoAt,
  LINE_KIND_BY_PLATFORM,
  linkSpansOfLine,
  platformLineKindAt,
  scanLinesViaQuery,
} from '../src/syntaxTreeQuery'
import { RuleScope } from '../src/rules/rule-engine'
import { makeRejectingQuery, makeSyntaxFake } from './syntaxFake'

describe('映射常量（平台 kind → 消费维度投影）', () => {
  it('LINE_KIND_BY_PLATFORM：v2/ModA 维度全枚举（table/heading 归 text——上游 v2 不特判）', () => {
    expect(LINE_KIND_BY_PLATFORM).toEqual({
      frontmatter: 'frontmatter',
      code: 'code',
      formula: 'formula',
      table: 'text',
      heading: 'text',
      quote: 'quote',
      list: 'list',
      text: 'text',
    })
  })

  it('FORMAT_SKIP_BY_PLATFORM：v1/格式化跳过维度（#28 表格行跳过不翻案）', () => {
    expect(FORMAT_SKIP_BY_PLATFORM).toEqual({
      frontmatter: true,
      code: true,
      formula: true,
      table: true,
      heading: false,
      quote: false,
      list: false,
      text: false,
    })
  })
})

describe('lineInfoAt / scanLinesViaQuery：行类型（fake 判定链驱动）', () => {
  const doc = [
    '---',
    'title: x',
    '---',
    '# head',
    '| a | b |',
    'plain',
    '',
    '- item',
    '  cont',
    '> quote',
    '> [!note] T',
    '> - qlist',
    '```ts',
    'const a = 1',
    '```',
    '$$',
    'E',
    '$$',
    '$$x$$',
  ].join('\n')
  const fake = makeSyntaxFake(doc)

  it('kind 序列：平台 kind 经映射表投影（table/heading → text；单行 $$x$$ → formula）', () => {
    const scan = scanLinesViaQuery(fake.doc, fake.query)
    expect(scan).not.toBeNull()
    expect(scan!.map((l) => l.kind)).toEqual([
      'frontmatter', // ---（fm 开界）
      'frontmatter', // title: x
      'frontmatter', // ---（fm 闭界）
      'text', // # head（平台 heading → v2 维度 text）
      'text', // | a | b |（平台 table → v2 维度 text）
      'text',
      'empty',
      'list',
      'list', // 续行（fake 缩进近似，真实树按解析归属）
      'quote',
      'quote', // callout 标题行（平台无 callout 枚举，统一 quote）
      'list', // 引用内列表：代表位置取内容区，平台优先级 list > quote
      'code',
      'code',
      'code',
      'formula',
      'formula',
      'formula',
      'formula', // 单行闭合 $$x$$（升级收益：降级版不识别）
    ])
  })

  it('行内几何：markerEnd / quoteContentStart / indent 从行文本正则计算', () => {
    const scan = scanLinesViaQuery(fake.doc, fake.query)!
    expect(scan[7]).toEqual({ kind: 'list', indent: 0, markerEnd: 2, quoteContentStart: null })
    // 引用内列表：markerEnd 含引用前缀（'- item' 在 '> - qlist' 内从 2 起）
    expect(scan[11]).toEqual({ kind: 'list', indent: 0, markerEnd: 4, quoteContentStart: null })
    expect(scan[9]).toEqual({ kind: 'quote', indent: 0, markerEnd: 0, quoteContentStart: 2 })
    // callout 标题行：内容起点跳过 callout 标记（'> [!note] ' 长 10）
    expect(scan[10]).toEqual({ kind: 'quote', indent: 0, markerEnd: 0, quoteContentStart: 10 })
  })

  it('platformLineKindAt：原始平台 kind（跳过维度消费入口，table/heading 不折叠）', () => {
    expect(platformLineKindAt(fake.doc, fake.query, 4)).toBe('heading')
    expect(platformLineKindAt(fake.doc, fake.query, 5)).toBe('table')
    expect(platformLineKindAt(fake.doc, fake.query, 6)).toBe('text')
    expect(platformLineKindAt(fake.doc, fake.query, 12)).toBe('list')
  })

  it('查询拒绝：lineInfoAt / scanLinesViaQuery / platformLineKindAt 返回 null', () => {
    expect(lineInfoAt(fake.doc, makeRejectingQuery(), 1)).toBeNull()
    expect(scanLinesViaQuery(fake.doc, makeRejectingQuery())).toBeNull()
    expect(platformLineKindAt(fake.doc, makeRejectingQuery(), 1)).toBeNull()
  })
})

describe('codeBlocksViaQuery / codeBlockAtViaQuery：代码块信息（上游 getCodeBlocksInfos 查询版）', () => {
  it('语言/缩进/四区间：普通闭合块（语言取信息串 trim 后小写——整串保留）', () => {
    const fake = makeSyntaxFake(['```Python Script', 'code', '```', 'tail'].join('\n'))
    const { doc, query } = fake
    const blocks = codeBlocksViaQuery(doc, query)
    expect(blocks).toEqual([
      {
        startPos: 0,
        endPos: doc.line(3).to,
        codeStartPos: doc.line(2).from,
        codeEndPos: doc.line(2).to,
        language: 'python script',
        indent: 0,
      },
    ])
  })

  it('缩进围栏：indent 为围栏起始列，codeStartPos 加缩进', () => {
    const fake = makeSyntaxFake(['  ```js', '  x', '  ```'].join('\n'))
    const { doc, query } = fake
    expect(codeBlocksViaQuery(doc, query)).toEqual([
      {
        startPos: 2,
        endPos: doc.line(3).to,
        codeStartPos: doc.line(2).from + 2,
        codeEndPos: doc.line(2).to,
        language: 'js',
        indent: 2,
      },
    ])
  })

  it('相邻开闭栏（空代码体）：codeStartPos = codeEndPos = 开栏行尾', () => {
    const fake = makeSyntaxFake(['```', '```', 'tail'].join('\n'))
    const { doc, query } = fake
    expect(codeBlocksViaQuery(doc, query)).toEqual([
      {
        startPos: 0,
        endPos: doc.line(2).to,
        codeStartPos: doc.line(1).to,
        codeEndPos: doc.line(1).to,
        language: '',
        indent: 0,
      },
    ])
  })

  it('未闭合围栏延至文末（``` 与 ~~~ 混用不互闭——平台树语义）', () => {
    const fake = makeSyntaxFake(['```ts', 'a', '~~~', 'b'].join('\n'))
    const { doc, query } = fake
    expect(codeBlocksViaQuery(doc, query)).toEqual([
      {
        startPos: 0,
        endPos: doc.length,
        codeStartPos: doc.line(2).from,
        codeEndPos: doc.line(4).to,
        language: 'ts',
        indent: 0,
      },
    ])
  })

  it('缩进代码（无围栏标记行）不产出 CodeBlockInfo（上游无 codeblock-begin）', () => {
    const fake = makeSyntaxFake(['    indented code', 'text'].join('\n'))
    expect(codeBlocksViaQuery(fake.doc, fake.query)).toEqual([])
  })

  it('codeBlockAtViaQuery：块内/围栏行命中（闭区间含两端），块外 null', () => {
    const fake = makeSyntaxFake(['```py', 'x = 1', '```', 'tail'].join('\n'))
    const { doc, query } = fake
    const expectBlock = (pos: number): void => {
      const hit = codeBlockAtViaQuery(doc, query, pos)
      expect(hit).not.toBeNull()
      expect(hit!.language).toBe('py')
    }
    expectBlock(doc.line(1).from) // 开栏行首（startPos）
    expectBlock(doc.line(2).from + 2) // 代码体
    expectBlock(doc.line(3).to) // 闭栏行尾（endPos，闭区间）
    expect(codeBlockAtViaQuery(doc, query, doc.line(4).from)).toBeNull()
    expect(codeBlockAtViaQuery(doc, query, doc.length + 100)).toBeNull() // 越界钳制
  })

  it('查询拒绝：codeBlocksViaQuery / codeBlockAtViaQuery 返回 null', () => {
    const fake = makeSyntaxFake(['```', 'x', '```'].join('\n'))
    const reject = makeRejectingQuery()
    expect(codeBlocksViaQuery(fake.doc, reject)).toBeNull()
    expect(codeBlockAtViaQuery(fake.doc, reject, 1)).toBeNull()
  })
})

describe('detectScopeViaQuery：作用域判定（上游 detectRuleScope 查询版）', () => {
  const doc = ['$$', 'x', '$$', 'a $f$ b', 'a `c` b', '[[w `c` e]]', '[`t`](u)', 'plain'].join('\n')
  const fake = makeSyntaxFake(doc)
  const { doc: d, query } = fake
  const posOf = (lineNo: number, col: number): number => d.line(lineNo).from + col

  it('Formula：跨行 $$ 块内与行内 $f$ 命中', () => {
    expect(detectScopeViaQuery(d, query, posOf(2, 0))).toEqual({ scope: RuleScope.Formula })
    expect(detectScopeViaQuery(d, query, posOf(4, 3))).toEqual({ scope: RuleScope.Formula })
  })

  it('Code：行内代码无语言；代码块（含围栏行）带语言', () => {
    // 'a `c` b'——反引号内容位于行内偏移 3..6
    expect(detectScopeViaQuery(d, query, posOf(5, 4))).toEqual({ scope: RuleScope.Code })
    const codeDoc = makeSyntaxFake(['```py', 'z', '```'].join('\n'))
    expect(detectScopeViaQuery(codeDoc.doc, codeDoc.query, codeDoc.doc.line(1).from + 3)).toEqual({
      scope: RuleScope.Code,
      language: 'py',
    })
    expect(detectScopeViaQuery(codeDoc.doc, codeDoc.query, codeDoc.doc.line(2).from)).toEqual({
      scope: RuleScope.Code,
      language: 'py',
    })
  })

  it('链接排除（上游 !contains(link) 语义的组件自判）：wikilink / mdlink 区段内的 code span 判 Text', () => {
    // '[[w `c` e]]'——c 处 inlineAt 为 code，但落在 wikilink 区段内
    expect(detectScopeViaQuery(d, query, posOf(6, 5))).toEqual({ scope: RuleScope.Text })
    // '[`t`](u)'——t 处落在 mdlink 区段内
    expect(detectScopeViaQuery(d, query, posOf(7, 2))).toEqual({ scope: RuleScope.Text })
  })

  it('Text：普通文本位置', () => {
    expect(detectScopeViaQuery(d, query, posOf(8, 2))).toEqual({ scope: RuleScope.Text })
  })

  it('查询拒绝：返回 null（评审 P3——拒绝不静默归 Text，「不接管」由消费方解释）', () => {
    // 拒绝只发生在非 live/已销毁视图（判定无意义）；spec §二「查询拒绝的
    // 处理」口径：返回 null/false 透传平台原生行为，不 fallback 正则
    expect(detectScopeViaQuery(d, makeRejectingQuery(), posOf(2, 0))).toBeNull()
  })

  it('扩展查询拒绝（评审 R2-A2）：code 分支局部扩展中拒绝 → detectScopeViaQuery 整体 null（拒绝不被吞为无语言 Code）', () => {
    // codeBlockAtViaQuery 从 pos 行向上下扩展连续 code 行——首查成功后
    // 扩展行拒绝（同步窗口内实例销毁类竞态）时，「查询拒绝」与「pos 不在
    // 块内」须可区分：拒绝经 codeScopeAt 传播为整体 null（消费方不接管），
    // 而非吞掉拒绝退化为无语言的 {scope: Code}（spec §二「拒绝全路径
    // null」口径——同步不可达窗口 + 后果保守，评审 P3/R2-A2）
    const fake = makeSyntaxFake(['```js', 'a', 'b', 'tail'].join('\n'))
    const { doc, query } = fake
    const rejectFrom = doc.line(3).from // 行 3（'b'，扩展下行触达）起拒绝
    const partialReject: typeof query = {
      lineTypeAt: (pos) => (pos >= rejectFrom ? { ok: false, reason: 'view-disposed' } : query.lineTypeAt(pos)),
      inlineAt: (pos) => (pos >= rejectFrom ? { ok: false, reason: 'view-disposed' } : query.inlineAt(pos)),
    }
    // pos 在行 2（'a'，块内）：首查与上行扩展成功、下行扩展遇拒绝 → null
    expect(detectScopeViaQuery(doc, partialReject, doc.line(2).from)).toBeNull()
    expect(codeBlockAtViaQuery(doc, partialReject, doc.line(2).from)).toBeNull()
    // 对照：无拒绝时同位置带语言命中（确保拒绝注入确属「部分成功后拒绝」）
    expect(detectScopeViaQuery(doc, query, doc.line(2).from)).toEqual({
      scope: RuleScope.Code,
      language: 'js',
    })
  })
})

describe('docOfLines：line(n) 越界守卫（评审 S7）', () => {
  it('正常行号返回行结构（from/to/text 与 LF 坐标一致）', () => {
    const doc = docOfLines(['ab', 'cd'])
    expect(doc.line(1)).toEqual({ number: 1, from: 0, to: 2, text: 'ab' })
    expect(doc.line(2)).toEqual({ number: 2, from: 3, to: 5, text: 'cd' })
  })

  it.each([0, 3, 1.5, Number.NaN])('越界/非整数行号 %s → 抛 RangeError（对齐 CM6 Text.line 的越界语义；lineAt 仍钳制）', (n) => {
    const doc = docOfLines(['ab', 'cd'])
    expect(() => doc.line(n)).toThrow(RangeError)
  })

  it('lineAt 越界钳制文末不变（与 line 的抛错语义分工一致）', () => {
    const doc = docOfLines(['ab', 'cd'])
    expect(doc.lineAt(999).number).toBe(2)
    expect(doc.lineAt(-1).number).toBe(1)
  })

  it('空数组（评审 R2-A3）：lineAt 返回 CM6 空文档首行 {1,0,0,""}（任意 pos 钳制）；line(n) 仍抛 RangeError', () => {
    // 对齐 CM6 Text.empty.lineAt(pos) 语义——空文档恒有首行 {number:1,
    // from:0, to:0, text:''}；修复前 starts[0] 越界以 undefined/NaN 坐标
    // 静默抛 TypeError。line(n) 越界行为不变（1 行也没有，任何 n 均越界）
    const doc = docOfLines([])
    expect(doc.lines).toBe(0)
    expect(doc.length).toBe(0)
    expect(doc.lineAt(0)).toEqual({ number: 1, from: 0, to: 0, text: '' })
    expect(doc.lineAt(5)).toEqual({ number: 1, from: 0, to: 0, text: '' })
    expect(() => doc.line(1)).toThrow(RangeError)
  })
})

describe('docOfText：单槽缓存（评审 R2-B4：行为链一次输入 ~6 次全文 split 的去重）', () => {
  it('同 text 二次构造命中缓存（同一对象 = ≤1 次真实计算）；换 text 重建后旧 text 再进亦重建', () => {
    const a = docOfText('l1\nl2')
    // 命中：同一对象返回——同 text 的第二次调用无真实计算（split + 行表
    // 构建），行为链同驱动内多族重复构造由此收敛为 1 次
    expect(docOfText('l1\nl2')).toBe(a)
    const b = docOfText('other')
    expect(b).not.toBe(a)
    expect(docOfText('other')).toBe(b)
    // 单槽：a 被逐出后再进重建（新对象、语义等价——doc 是 text 的纯函数）
    const a2 = docOfText('l1\nl2')
    expect(a2).not.toBe(a)
    expect(a2.lines).toBe(2)
    expect(a2.line(2).text).toBe('l2')
    expect(a2.length).toBe(5)
  })
})

describe('linkSpansOfLine：链接区段（行内坐标 → 全文偏移；切片 B inlineParts 复用）', () => {
  it('wikilink 区段列表（全文偏移）', () => {
    expect(linkSpansOfLine('a [[x]] b [[y]]', 10)).toEqual([
      { from: 12, to: 17 },
      { from: 20, to: 25 },
    ])
  })

  it('mdlink 与嵌入形态（![[...]] / ![](...)）', () => {
    expect(linkSpansOfLine('[a](u) tail', 0)).toEqual([{ from: 0, to: 6 }])
    expect(linkSpansOfLine('![[img.png]]', 0)).toEqual([{ from: 0, to: 12 }])
  })

  it('g 旗标 lastIndex 用后重置（重复调用结果一致）', () => {
    const once = linkSpansOfLine('[[a]] [[b]]', 0)
    const twice = linkSpansOfLine('[[a]] [[b]]', 0)
    expect(once).toEqual(twice)
  })

  it('无链接行返回空数组', () => {
    expect(linkSpansOfLine('plain `code` text', 5)).toEqual([])
  })
})
