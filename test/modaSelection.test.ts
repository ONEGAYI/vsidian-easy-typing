// 渐进选择状态机矩阵（工单 #11 核心验收；#5 切片 B 起经树版查询判定——
// fake 判定链注入，行为断言不变）——真实 EditorState 驱动，以「连续按键
// 模拟」承载层级序列端到端：每次 plan 结果回写为新选区再 plan 一次，
// 直到 null（透传平台全选）。上游对照 keyboard_handlers.ts:509-676
//（handleModA 三分支）与 815-825（selectBlockInCursor）。边界与降级差异
// 见 docs/specs/enhance-moda.md。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  planModASelection as planModASelectionImpl,
  planSelectBlock as planSelectBlockImpl,
  type SelectionRange,
} from '../src/modaSelection'
import type { SyntaxQuery } from '../src/syntaxTreeQuery'
import { makeRejectingQuery, makeSyntaxFake } from './syntaxFake'

/** 树版判定源：state 文档同文的平台判定链 fake（坐标一致） */
function queryOfState(state: EditorState): SyntaxQuery {
  return makeSyntaxFake(state.doc.toString()).query
}

/** plan 包装：注入 fake 查询（同名遮蔽——测试体保持单参调用形态） */
function planModASelection(state: EditorState): SelectionRange | null {
  return planModASelectionImpl(state, queryOfState(state))
}

function planSelectBlock(state: EditorState): SelectionRange | null {
  return planSelectBlockImpl(state, queryOfState(state))
}

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

describe('懒查询防回潮（#5 切片 B 性能红线：单键不预扫全文）', () => {
  it('文本分支首按：10 行文档的 ModA 决策查询次数有上界（anchor 单点 + 段块局部邻行）', () => {
    // 10 行连续文本、光标行1：决策 = anchor 行 1 次 + 段块邻行判定。
    // 旧全文扫描形态为 10 次起步（每行一查）；懒查询锚定后上界 2 次
    //（anchor 查 1 + 下行邻行查 1——首按段块只在命中 text 行时继续扩展，
    // 本例段块 10 行会全查，故改用「光标行上下紧邻空行」的 3 行文档把
    // 邻行判定收敛为 2 次）。
    const doc3 = 'aaa\n\nbbb'
    const fake3 = makeSyntaxFake(doc3)
    expect(planModASelectionImpl(stateAt(doc3, 1), fake3.query)).toEqual({ anchor: 0, head: 3 })
    // anchor 行查 1 次；下行是空行（kind 判定 1 次）即停 → 共 2 次
    expect(fake3.counts.lineTypeAt).toBe(2)
  })

  it('引用分支：决策只查 anchor 行（quoteInfoAt 纯正则不消耗查询）', () => {
    const doc = '> a\n> b\n> c\nplain'
    const fake = makeSyntaxFake(doc)
    expect(planModASelectionImpl(stateAt(doc, 2), fake.query)).toEqual({ anchor: 2, head: 3 })
    // anchor 行查 1 次（quote 分支不查）；anchor 在 quote 行 kind=quote →
    // 非 text 分支 → quoteInfoAt 纯正则接管。段落判定不发生。
    expect(fake.counts.lineTypeAt).toBe(1)
  })

  it('列表标记行档 3 扩展遇顶格普通行即停（不扫到文末）', () => {
    // 19 行文档：光标行 2 的整列表扩展上行遇行 1 顶格文本（indent 0 非
    // 列表）即停、下行遇行 3 顶格文本即停——总查询次数有上界，不随文档
    // 行数线性增长
    const tail = Array.from({ length: 16 }, (_, i) => `tail${i}`).join('\n')
    const doc = `lead\n- a\nplain\n${tail}`
    const fake = makeSyntaxFake(doc)
    expect(planModASelectionImpl(stateAt(doc, 7), fake.query)).toEqual({ anchor: 7, head: 8 })
    // anchor 查 1 + 档3 上行（lead：indent 0 → 查 kind 1 次非列表停）+
    // 档3 下行（plain：查 1 次非列表停）= 3 次（档 2 子列表扩展为纯缩进
    // 不查；19 行文档查询恰 3 次）
    expect(fake.counts.lineTypeAt).toBe(3)
  })
})

describe('查询拒绝与分支序（评审 R2-A4 测试缺口）', () => {
  it('恒拒绝查询 → planModASelection 返回 null（透传；拒绝不接管不 fallback）', () => {
    // anchor 行单点查即拒绝（lineInfoAt → null）——与 spec §二拒绝口径
    // 一致：非 live/已销毁视图的判定无意义，ModA 不接管
    const doc = 'aaa\nbbb'
    expect(planModASelectionImpl(stateAt(doc, 1), makeRejectingQuery())).toBeNull()
  })

  it('引用内围栏行（> ```js）光标走引用分支：行首引用正则先于 code 不接管判定（上游分支序钉住）', () => {
    // anchorKind 判 code（平台树链 code 优先，围栏行属代码块区间），但
    // 分支序在上游是 文本 → 引用（quoteInfoAt 行首纯正则，不查行类型）
    // → 列表 → 代码不接管：`> ```js` 行首有引用前缀 → 引用分支接管
    //（modaSelection.ts「引用分支」注释声明的行为）。层级：当前行内容
    //（跳过 '> '）→ 引用块 → 透传
    const doc = '> ```js'
    expect(progressionLabels(stateAt(doc, 4))).toEqual(['```js', '> ```js', 'PASS'])
  })

  it('扩展中拒绝（部分行成功后拒绝）→ 整体 null：段块下行扩展遇拒绝即透传', () => {
    // 自定义 query：行 3（'ccc'）起拒绝——anchor 行 1 与段块下行行 2 查询
    // 成功后，行 3 扩展触达拒绝 → paragraphBlockAt 整体 null（不接管），
    // 不以部分成功的段块区间接管
    const doc = 'aaa\nbbb\nccc'
    const fake = makeSyntaxFake(doc)
    const rejectFrom = fake.doc.line(3).from
    const partialReject: SyntaxQuery = {
      lineTypeAt: (pos) =>
        pos >= rejectFrom ? { ok: false, reason: 'view-disposed' } : fake.query.lineTypeAt(pos),
      inlineAt: (pos) =>
        pos >= rejectFrom ? { ok: false, reason: 'view-disposed' } : fake.query.inlineAt(pos),
    }
    expect(planModASelectionImpl(stateAt(doc, 1), partialReject)).toBeNull()
    // 对照：无拒绝时同位置段块升档照常（确认拒绝注入确属扩展中触达）
    expect(planModASelectionImpl(stateAt(doc, 1), fake.query)).toEqual({ anchor: 0, head: 3 })
  })
})
