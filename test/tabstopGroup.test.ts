// Tabstop 分组纯逻辑单元测试（工单 #15）——上游 tabstop.ts
// tabstopSpecsToTabstopGroups / containsSelection 的纯数据移植矩阵。
// 输入形态对齐 #14 引擎 ApplyResult.tabstops（文档绝对坐标），末组含
// 「引擎真实输出 → 分组」端到端（规则替换体 ${1:默认}...$0 的完整链）。
import { describe, expect, it } from 'vitest'
import type { TabstopSpec } from '../src/rules/rule-engine'
import { RuleEngine, RuleScope, RuleType, type TxContext } from '../src/rules/rule-engine'
import { groupSelectionRanges, groupTabstops, rangesWithinGroup } from '../src/tabstopGroup'

/** Input 触发上下文（对齐 rule-engine-core.test.ts 的 inputCtx） */
function inputCtx(docText: string, cursor: number): TxContext {
  return {
    kind: RuleType.Input,
    docText,
    selection: { from: cursor, to: cursor },
    inserted: '',
    changeType: 'input.type',
    scopeHint: RuleScope.Text,
  }
}

function specs(...items: [number, number, number][]): TabstopSpec[] {
  return items.map(([number, from, to]) => ({ number, from, to }))
}

describe('groupTabstops：按编号分组（升序，$0 恒首组）', () => {
  it('升序输入原样成组', () => {
    expect(groupTabstops(specs([0, 8, 8], [1, 2, 3], [2, 4, 5]))).toEqual([
      { number: 0, ranges: [{ from: 8, to: 8 }] },
      { number: 1, ranges: [{ from: 2, to: 3 }] },
      { number: 2, ranges: [{ from: 4, to: 5 }] },
    ])
  })

  it('乱序输入按 number 升序重排（不依赖引擎输出有序）', () => {
    const groups = groupTabstops(specs([3, 10, 11], [1, 2, 3], [2, 6, 7], [0, 12, 12]))
    expect(groups.map((g) => g.number)).toEqual([0, 1, 2, 3])
  })

  it('同号多占位符并为组（多光标同步编辑单元），组内保持出现序', () => {
    const groups = groupTabstops(specs([1, 6, 7], [2, 9, 10], [1, 2, 3]))
    expect(groups).toEqual([
      { number: 1, ranges: [{ from: 6, to: 7 }, { from: 2, to: 3 }] },
      { number: 2, ranges: [{ from: 9, to: 10 }] },
    ])
  })

  it('空输入 → 空组', () => {
    expect(groupTabstops([])).toEqual([])
  })

  it('跳转顺序语义钉住：$0 → $1 → $2（上游 CustomRules 文档口径，与 VSCode snippet 的 $0 终点相反）', () => {
    const groups = groupTabstops(specs([2, 0, 1], [0, 6, 6], [1, 3, 4]))
    expect(groups.map((g) => g.number)).toEqual([0, 1, 2])
  })
})

describe('groupSelectionRanges：组 → 选区计划', () => {
  it('非空 range 全选（默认值整体被选中，键入即覆盖）', () => {
    expect(groupSelectionRanges({ number: 1, ranges: [{ from: 2, to: 5 }] })).toEqual([{ from: 2, to: 5 }])
  })

  it('零宽 range 即光标落位（from === to）', () => {
    expect(groupSelectionRanges({ number: 0, ranges: [{ from: 8, to: 8 }] })).toEqual([{ from: 8, to: 8 }])
  })

  it('多 range 组输出多光标序（顺序即组内出现序）', () => {
    expect(
      groupSelectionRanges({ number: 1, ranges: [{ from: 6, to: 7 }, { from: 2, to: 3 }] }),
    ).toEqual([{ from: 6, to: 7 }, { from: 2, to: 3 }])
  })
})

describe('rangesWithinGroup：选区整体在组内判定（自动退出的依据）', () => {
  const group = { number: 1, ranges: [{ from: 2, to: 5 }, { from: 8, to: 9 }] }

  it('选区落在组内 range 之上 → 在内', () => {
    expect(rangesWithinGroup([{ from: 2, to: 5 }], group)).toBe(true)
    expect(rangesWithinGroup([{ from: 3, to: 4 }], group)).toBe(true) // 组内子区间
    expect(rangesWithinGroup([{ from: 8, to: 9 }], group)).toBe(true)
  })

  it('光标折叠在组内（含边界）→ 在内', () => {
    expect(rangesWithinGroup([{ from: 2, to: 2 }], group)).toBe(true)
    expect(rangesWithinGroup([{ from: 5, to: 5 }], group)).toBe(true)
  })

  it('越出组边界（点击组外 / 跨组 / 全选）→ 不在内', () => {
    expect(rangesWithinGroup([{ from: 0, to: 1 }], group)).toBe(false)
    expect(rangesWithinGroup([{ from: 4, to: 8 }], group)).toBe(false) // 跨两个 range 的选区
    expect(rangesWithinGroup([{ from: 0, to: 99 }], group)).toBe(false)
  })

  it('多选区部分在内 → 整体不在内（every 语义）', () => {
    expect(
      rangesWithinGroup([{ from: 2, to: 5 }, { from: 6, to: 7 }], group),
    ).toBe(false)
  })

  it('组零宽塌缩（占位符内容被删空）后光标原地 → 在内（导航保持）', () => {
    const collapsed = { number: 1, ranges: [{ from: 4, to: 4 }] }
    expect(rangesWithinGroup([{ from: 4, to: 4 }], collapsed)).toBe(true)
  })
})

describe('端到端：#14 引擎真实输出 → 分组（#25 接线形态预演）', () => {
  it('规则替换体 ${1:默认}...${2:x}...$0 的 tabstops 分组正确（含默认值区间与 $0 零宽）', () => {
    const engine = new RuleEngine()
    engine.addSimpleRule({ trigger: 'lorem', replacement: 'Lorem ${1:ipsum} dolor ${2:amet}.$0', priority: 10 })
    const result = engine.process(inputCtx('lorem', 5))
    expect(result).not.toBeNull()
    // 替换体展开：'Lorem ipsum dolor amet.'，matchRange.from = 0
    // $1=(6,11) $2=(18,22) $0=(23,23)
    const groups = groupTabstops(result!.tabstops)
    expect(groups.map((g) => g.number)).toEqual([0, 1, 2])
    expect(groups[0]).toEqual({ number: 0, ranges: [{ from: 23, to: 23 }] })
    expect(groups[1]).toEqual({ number: 1, ranges: [{ from: 6, to: 11 }] })
    expect(groups[2]).toEqual({ number: 2, ranges: [{ from: 18, to: 22 }] })
  })

  it('同号占位符经引擎解析后并为组', () => {
    const engine = new RuleEngine()
    engine.addSimpleRule({ trigger: 'sym', replacement: '${1:a} and ${1:b} end$0', priority: 10 })
    const result = engine.process(inputCtx('sym', 3))
    const groups = groupTabstops(result!.tabstops)
    expect(groups).toEqual([
      { number: 0, ranges: [{ from: 11, to: 11 }] },
      { number: 1, ranges: [{ from: 0, to: 1 }, { from: 6, to: 7 }] },
    ])
  })
})
