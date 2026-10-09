// 行内分区测试（工单 #26）：文本降级版切分（code/formula 扫描 + wikilink/
// mdlink 正则 + #27 保护区注入缝）与边界空格状态机。切分形态学是本移植
// 自有降级（上游走语法树），用形态断言钉住；分区间的格式化等价性由
// lineFormatter 上游验证矩阵承载。
import { describe, expect, it } from 'vitest'
import {
  SpaceState,
  splitLineIntoParts,
  type InlinePart,
} from '../src/formatting/inlineParts'

function parts(line: string, protectedRanges?: Parameters<typeof splitLineIntoParts>[1]): InlinePart[] {
  return splitLineIntoParts(line, protectedRanges)
}

function shape(list: InlinePart[]): Array<[string, string, number, number]> {
  return list.map((p) => [p.content, p.type, p.begin, p.end])
}

describe('纯文本行', () => {
  it('整行一个 text 分区', () => {
    expect(shape(parts('中文abc，。'))).toEqual([['中文abc，。', 'text', 0, 7]])
  })
})

describe('行内代码扫描', () => {
  it('反引号配对成 code 分区，两侧 text 填充', () => {
    expect(shape(parts('中文`a`后'))).toEqual([
      ['中文', 'text', 0, 2],
      ['`a`', 'code', 2, 5],
      ['后', 'text', 5, 6],
    ])
  })

  it('双反引号等长配对（内含单反引号不成对）', () => {
    expect(shape(parts('a`` ` ``b'))).toEqual([
      ['a', 'text', 0, 1],
      ['`` ` ``', 'code', 1, 8],
      ['b', 'text', 8, 9],
    ])
  })

  it('未配对反引号按字面处理（不成分区）', () => {
    expect(shape(parts('a`b'))).toEqual([['a`b', 'text', 0, 3]])
  })
})

describe('公式扫描', () => {
  it('单 $ 配对成 formula 分区', () => {
    expect(shape(parts('中文$x$后'))).toEqual([
      ['中文', 'text', 0, 2],
      ['$x$', 'formula', 2, 5],
      ['后', 'text', 5, 6],
    ])
  })

  it('$$ 成对优先（单行内闭合）', () => {
    expect(shape(parts('a$$x$$b'))).toEqual([
      ['a', 'text', 0, 1],
      ['$$x$$', 'formula', 1, 6],
      ['b', 'text', 6, 7],
    ])
  })

  it('反斜杠转义的 \\$ 不参与配对', () => {
    expect(shape(parts('价格\\$5和$6$'))).toEqual([
      ['价格\\$5和', 'text', 0, 6],
      ['$6$', 'formula', 6, 9],
    ])
  })

  it('代码分区内的 $ 不参与公式配对（代码优先）', () => {
    expect(shape(parts('`$x$`'))).toEqual([['`$x$`', 'code', 0, 5]])
  })

  it('未配对 $ 按字面处理', () => {
    expect(shape(parts('价格$100'))).toEqual([['价格$100', 'text', 0, 6]])
  })
})

describe('链接识别（上游正则逐字）', () => {
  it('wikilink（含嵌入与别名形态字符类）', () => {
    expect(shape(parts('看[[笔记A]]完'))).toEqual([
      ['看', 'text', 0, 1],
      ['[[笔记A]]', 'wikilink', 1, 8],
      ['完', 'text', 8, 9],
    ])
  })

  it('mdlink', () => {
    expect(shape(parts('看[标题](https://a.b)完'))).toEqual([
      ['看', 'text', 0, 1],
      ['[标题](https://a.b)', 'mdlink', 1, 18],
      ['完', 'text', 18, 19],
    ])
  })

  it('代码/公式区段内的链接形态不识别（上游树版等价位）', () => {
    expect(shape(parts('`[[a]]`'))).toEqual([['`[[a]]`', 'code', 0, 7]])
  })
})

describe('保护区注入缝（#27）', () => {
  it('user 分区按区间落位，携带左右空格要求', () => {
    const ranges = [
      { begin: 2, end: 5, leftSpaceRequire: SpaceState.none, rightSpaceRequire: SpaceState.strict },
    ]
    const result = parts('中文abc后', ranges)
    expect(shape(result)).toEqual([
      ['中文', 'text', 0, 2],
      ['abc', 'user-defined', 2, 5],
      ['后', 'text', 5, 6],
    ])
    expect(result[1]!.rightSpaceRequire).toBe(SpaceState.strict)
  })

  it('越界/空/倒置区间钳制与丢弃', () => {
    expect(shape(parts('abc', [{ begin: -5, end: 2, leftSpaceRequire: 0, rightSpaceRequire: 0 }]))).toEqual([
      ['ab', 'user-defined', 0, 2],
      ['c', 'text', 2, 3],
    ])
    expect(shape(parts('abc', [{ begin: 2, end: 2, leftSpaceRequire: 0, rightSpaceRequire: 0 }]))).toEqual([
      ['abc', 'text', 0, 3],
    ])
    expect(shape(parts('abc', [{ begin: 2, end: 1, leftSpaceRequire: 0, rightSpaceRequire: 0 }]))).toEqual([
      ['abc', 'text', 0, 3],
    ])
  })

  it('保护区与 code/formula 重叠时剪除重叠段（天然保护区优先）', () => {
    // [0,5) 保护区盖住 `a`[0,3)：剪除后只剩 [3,5)
    const ranges = [{ begin: 0, end: 5, leftSpaceRequire: 0, rightSpaceRequire: 0 }]
    expect(shape(parts('`a`bc', ranges))).toEqual([
      ['`a`', 'code', 0, 3],
      ['bc', 'user-defined', 3, 5],
    ])
  })
})

describe('分区覆盖完整性', () => {
  it('分区按 begin 升序且无缝覆盖整行', () => {
    for (const line of ['中文`a`$x$[[b]]c', 'a``b$c$`d`', 'mixed123文']) {
      let cursor = 0
      for (const p of parts(line)) {
        expect(p.begin).toBe(cursor)
        cursor = p.end
      }
      expect(cursor).toBe(line.length)
    }
  })
})
