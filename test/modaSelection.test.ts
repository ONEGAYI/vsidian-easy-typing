// 渐进选择状态机矩阵（工单 #11 核心验收）——真实 EditorState 驱动，
// 以「连续按键模拟」承载层级序列端到端：每次 plan 结果回写为新选区再
// plan 一次，直到 null（透传平台全选）。上游对照
// keyboard_handlers.ts:509-676（handleModA 三分支）与 815-825
// （selectBlockInCursor）。边界与降级差异见 docs/specs/enhance-moda.md。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  planModASelection,
  planSelectBlock,
  type SelectionRange,
} from '../src/modaSelection'

/** 折叠光标构造 */
function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } })
}

/** 选区构造 */
function stateWithRange(doc: string, anchor: number, head: number): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } })
}

/** 选区 → 文本区间字符串（anchor<head 归一展示） */
function rangeText(state: EditorState, range: SelectionRange): string {
  const from = Math.min(range.anchor, range.head)
  const to = Math.max(range.anchor, range.head)
  return state.doc.sliceString(from, to)
}

/**
 * 连续 Mod+A 序列：从初始状态起反复 plan + 应用选区，收集每步结果；
 * null 记为 'PASS'（透传平台全选）并终止。
 */
function progressionLabels(initial: EditorState, maxPresses = 6): string[] {
  const labels: string[] = []
  let state = initial
  for (let i = 0; i < maxPresses; i++) {
    const plan = planModASelection(state)
    if (plan === null) {
      labels.push('PASS')
      return labels
    }
    labels.push(rangeText(state, plan))
    state = state.update({ selection: { anchor: plan.anchor, head: plan.head } }).state
  }
  return labels
}

describe('文本分支：行 → 段块 →（透传=平台全选）', () => {
  it('多行段落完整序列', () => {
    // 行1「一二三」(0-3)，全文三行连续文本
    const doc = '一二三\n四五\n六七'
    const labels = progressionLabels(stateAt(doc, 1))
    expect(labels).toEqual(['一二三', '一二三\n四五\n六七', 'PASS'])
  })

  it('段中任意行起步序列一致（以该行为首按目标）', () => {
    const doc = 'aaa\nbbb\nccc'
    // 光标在行2：首按选行2，段块=1..3 行
    const labels = progressionLabels(stateAt(doc, 5))
    expect(labels).toEqual(['bbb', 'aaa\nbbb\nccc', 'PASS'])
  })

  it('单行段块（空行/引用/围栏邻接）：行 → 透传', () => {
    const doc = 'aaa\n\n> q'
    expect(progressionLabels(stateAt(doc, 1))).toEqual(['aaa', 'PASS'])
  })

  it('空文档直接透传；空行光标：恰等空行 → 首按即选合并段块（上游语义）', () => {
    expect(planModASelection(stateAt('', 0))).toBeNull()
    // 空行 {4,4} 恰等于「当前行」→ 段块 walk 不过滤当前行，两侧文本并入
    // （上游 getBlockLinesInPos 从邻行扩展、不排除空当前行）
    expect(planModASelection(stateAt('aaa\n\nbbb', 4))).toEqual({ anchor: 0, head: 8 })
  })

  it('部分选区首按规整为整行（exact-line 判定）', () => {
    // 选 'aa'（行内两字符）→ 首按选整行 aaa
    const plan = planModASelection(stateWithRange('aaa\n\nzzz', 0, 2))
    expect(plan).toEqual({ anchor: 0, head: 3 })
  })

  it('反向整行选区：重新正向选行（上游 exact 等值语义）', () => {
    // anchor=3 head=0（反向）不满足 anchor==line.from && head==line.to
    const plan = planModASelection(stateWithRange('aaa\n\nzzz', 3, 0))
    expect(plan).toEqual({ anchor: 0, head: 3 })
  })

  it('选区已覆盖整块 → 透传（含超集）', () => {
    const doc = 'aaa\nbbb\n\nccc'
    // 已选 0..7（整块 1-2 行）
    expect(planModASelection(stateWithRange(doc, 0, 7))).toBeNull()
    // 超集（全文）
    expect(planModASelection(stateWithRange(doc, 0, doc.length))).toBeNull()
  })

  it('标题行 quirks：首按选标题行，次按并入两侧文本段（上游语义保留）', () => {
    const doc = 'para\n# head\npara2'
    // 光标在标题行 → 段块扩展不排除当前行自身，仅排除邻侧标题
    expect(progressionLabels(stateAt(doc, 6))).toEqual(['# head', 'para\n# head\npara2', 'PASS'])
    // 标题上侧文本行：段块遇标题即止（单行块）
    expect(progressionLabels(stateAt(doc, 1))).toEqual(['para', 'PASS'])
  })

  it('表格行与水平线按上游 v2 归 text（不特判）', () => {
    const doc = 'para\n| a | b |\n---'
    // 表格行与 --- 均为 text → 连续段块
    expect(progressionLabels(stateAt(doc, 1))).toEqual(['para', 'para\n| a | b |\n---', 'PASS'])
  })

  it('围栏行 / 围栏内 / 公式块内 / frontmatter：透传', () => {
    expect(planModASelection(stateAt('```ts\ncode\n```', 6))).toBeNull()
    expect(planModASelection(stateAt('```\nc\n```', 0))).toBeNull()
    expect(planModASelection(stateAt('$$\nx\n$$', 1))).toBeNull()
    expect(planModASelection(stateAt('---\ntitle: x\n---\nbody', 5))).toBeNull()
  })

  it('多选区按主选区处理（对齐上游 selection.main）', () => {
    const doc = 'aaa\nbbb'
    const state = EditorState.create({
      doc,
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(5, 6)], 0),
    })
    const plan = planModASelection(state)
    expect(plan).toEqual({ anchor: 0, head: 3 })
  })
})

describe('引用分支：引用行内容 → 引用块 →（透传=平台全选）', () => {
  it('单行引用完整序列', () => {
    const doc = '> hello'
    expect(progressionLabels(stateAt(doc, 4))).toEqual(['hello', '> hello', 'PASS'])
  })

  it('多行引用：中间行视角', () => {
    const doc = '> a\n> b\n> c'
    expect(progressionLabels(stateAt(doc, 5))).toEqual(['b', '> a\n> b\n> c', 'PASS'])
  })

  it('callout 标题行：内容跳过 callout 标记', () => {
    const doc = '> [!note] Title\n> body'
    expect(progressionLabels(stateAt(doc, 8))).toEqual(['Title', doc, 'PASS'])
  })

  it('引用块邻接非引用行即止', () => {
    const doc = '> a\nplain\n> b'
    expect(progressionLabels(stateAt(doc, 2))).toEqual(['a', '> a', 'PASS'])
  })

  it('引用分支用精确等值判定：跨行选区回落为首按（上游语义）', () => {
    const doc = '> a\n> b'
    // 选区 {2,6} 跨行1-2 内容（非整块亦非当前行内容）→ 以 head 所在行
    // （行2）内容为首按目标
    const plan = planModASelection(stateWithRange(doc, 2, 6))
    expect(plan).toEqual({ anchor: 6, head: 7 })
  })
})

describe('列表分支（标记行）：内容 → 当前行及子列表 → 整列表 → 全文 →（透传）', () => {
  it('嵌套列表完整序列：内容 → 当前行及子列表 → 整列表/全文 → 透传', () => {
    const doc = '- one\n  - one-a\n- two'
    // 行1 `- one`(0-5)：内容 {2,5}；子列表=行1..2；整列表=行1..3（恰为
    // 全文区间——档位与全文同区间时逐档推进后透传）
    expect(progressionLabels(stateAt(doc, 3))).toEqual([
      'one',
      '- one\n  - one-a',
      doc,
      'PASS',
    ])
  })

  it('单行单项列表：内容 → 整行（子列表=整列表=全文区间，逐档收敛后透传）', () => {
    const doc = '- only'
    expect(progressionLabels(stateAt(doc, 3))).toEqual(['only', '- only', 'PASS'])
  })

  it('有序列表与任务列表的标记长度', () => {
    const ordered = '1. item'
    expect(progressionLabels(stateAt(ordered, 4))).toEqual(['item', '1. item', 'PASS'])
    const task = '- [x] done'
    expect(progressionLabels(stateAt(task, 8))).toEqual(['done', '- [x] done', 'PASS'])
  })

  it('子列表扩展：下行缩进严格更深才纳入，兄弟项止步', () => {
    const doc = '- a\n  - sub\n- b'
    // 光标行1：子列表=行1..2（行3 缩进 0 不纳）；整列表=行1..3
    const labels = progressionLabels(stateAt(doc, 2))
    expect(labels).toEqual(['a', '- a\n  - sub', doc, 'PASS'])
  })

  it('子列表含普通续行（缩进更深即纳入）', () => {
    const doc = '- a\n  cont\n- b'
    const labels = progressionLabels(stateAt(doc, 2))
    expect(labels).toEqual(['a', '- a\n  cont', doc, 'PASS'])
  })

  it('整列表边界：上方普通文本止步，缩进 ≥2 的非列表行并入', () => {
    const doc = 'lead\n- a\n  cont\n- b\ntail'
    // 光标行2 `- a`：内容 {7,8}；子列表 {5,15}；整列表=行2..4 {5,19}；全文
    const labels = progressionLabels(stateAt(doc, 7))
    expect(labels).toEqual(['a', '- a\n  cont', '- a\n  cont\n- b', doc, 'PASS'])
  })

  it('标记行首按前选区跨行（未整含任一档）→ 首档内容', () => {
    const doc = '- aaa\n- bbb'
    // 选 'aa'（标记后两字符）
    const plan = planModASelection(stateWithRange(doc, 2, 4))
    expect(plan).toEqual({ anchor: 2, head: 5 })
  })

  it('列表内容行（无标记续行）：内容 → 起点项标记后内容 → 整项 → 透传', () => {
    const doc = '- a\n  cont'
    // 光标行2 `  cont`(4-10)：内容 {6,10}；第二档 {2,10}（起点项标记后，
    // anchor 落回标记行）→ 第三按起按标记行分支继续升档（整项 {0,10} =
    // 全文区间）→ 透传
    expect(progressionLabels(stateAt(doc, 8))).toEqual(['cont', 'a\n  cont', doc, 'PASS'])
  })

  it('续行上的缩进围栏行：透传', () => {
    const doc = '- a\n  ```\n  c\n  ```'
    // 光标在行2 围栏行：降级扫描归 code → 三分支均不命中
    expect(planModASelection(stateAt(doc, 7))).toBeNull()
  })

  it('全文档档后透传（已选全文再按）', () => {
    const doc = '- a\n- b'
    // 从全文选区起步：覆盖末档 → 透传
    expect(planModASelection(stateWithRange(doc, 0, doc.length))).toBeNull()
  })
})

describe('planSelectBlock：「选择当前块」决策（上游 selectBlockInCursor）', () => {
  it('段中折叠光标 → 整段块', () => {
    const doc = 'aaa\nbbb\n\nccc'
    expect(planSelectBlock(stateAt(doc, 1))).toEqual({ anchor: 0, head: 7 })
  })

  it('空行 → null（命令无操作）', () => {
    expect(planSelectBlock(stateAt('aaa\n\nbbb', 4))).toBeNull()
  })

  it('标题行调用并入两侧文本（与 ModA 同一 quirks）', () => {
    const doc = 'para\n# head\npara2'
    expect(planSelectBlock(stateAt(doc, 6))).toEqual({ anchor: 0, head: doc.length })
  })

  it('列表行：邻行列表不计段块 → 仅当前行', () => {
    const doc = '- a\n- b'
    expect(planSelectBlock(stateAt(doc, 2))).toEqual({ anchor: 0, head: 3 })
  })

  it('带选区调用：以 head 所在行为准', () => {
    const doc = 'aaa\nbbb'
    expect(planSelectBlock(stateWithRange(doc, 0, 5))).toEqual({ anchor: 0, head: 7 })
  })
})
