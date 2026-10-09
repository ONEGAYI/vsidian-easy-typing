// BetterBackspace 拦截决策与 keymap Command 单元测试（工单 #8 接入层）
// ——拦截逻辑单元化：用真实 EditorState（@codemirror/state 纯 JS，node
// 可构造）驱动决策，用最小模拟 view（state + dispatch 捕获）驱动
// Command，不依赖 DOM 与真宿主。上游对照 keyboard_handlers.ts:439-472
//（handleBackspace）。算法矩阵（行数组驱动）见 test/backspace.test.ts。
//
// 层归属（票面评论定案）：**抢先层**（Prec.high）——先于平台 Backspace
// 情境链（symbolAutocomplete 删空对 → listEditing 退格清层 → tableEditing
// 表格删除）尝试。命中接管面（顶级空列表项 + 空引用行）return true；
// 让位面与未命中 return false 落穿平台链。可达性与冲突核对结论见
// docs/specs/backspace.md「平台 Backspace 冲突核对」节，此处用例钉住
// 与平台行为交界处的决策语义（嵌套/任务让位、多选区、选区）。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { betterBackspaceCommand, planBetterBackspace } from '../src/backspaceIntercept'

/** 文档 + 折叠光标构造 */
function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } })
}

describe('决策 planBetterBackspace：绝对坐标换算', () => {
  it('合并分支：删上一行末到当前行末，光标落上一行末尾', () => {
    // `- a\n- `：行 0 to=3，行 1 to=6 → 删 [3,6]，光标 3
    expect(planBetterBackspace(stateAt('- a\n- ', 6))).toEqual({
      changes: [{ from: 3, to: 6, insert: '' }],
      cursor: 3,
    })
  })

  it('合并 + 重编号：变更按文档序（合并段在前、重编号整行替换在后）', () => {
    // `1. a\n2. \n3. b`：合并删 [4,8]，`3. b`（9-12）替换为 `2. b`，光标 4
    expect(planBetterBackspace(stateAt('1. a\n2. \n3. b', 8))).toEqual({
      changes: [
        { from: 4, to: 8, insert: '' },
        { from: 9, to: 13, insert: "2. b" },
      ],
      cursor: 4,
    })
  })

  it('引用联降：两行替换段与光标（新第二行末尾）', () => {
    // `>> \n>> `：行 0（0-2）与行 1（4-6）各替换为 `> `，光标 5
    expect(planBetterBackspace(stateAt('>> \n>> ', 7))).toEqual({
      changes: [
        { from: 0, to: 3, insert: '> ' },
        { from: 4, to: 7, insert: '> ' },
      ],
      cursor: 5,
    })
  })

  it('清行分支：删行内容留空行，光标行首', () => {
    // `abc\n- `：行 1 内容段 [4,6]
    expect(planBetterBackspace(stateAt('abc\n- ', 6))).toEqual({
      changes: [{ from: 4, to: 6, insert: '' }],
      cursor: 4,
    })
  })
})

describe('决策 planBetterBackspace：门槛与让位面（与平台行为交界）', () => {
  it('光标不在行尾 → null（透传）', () => {
    expect(planBetterBackspace(stateAt('- ', 1))).toBeNull()
    expect(planBetterBackspace(stateAt('abc\n- ', 5))).toBeNull()
  })

  it('非空选区 → null（上游 anchor != head 分支）', () => {
    expect(planBetterBackspace(EditorState.create({ doc: '- a', selection: { anchor: 0, head: 3 } }))).toBeNull()
  })

  it('多选区 → null（防御性收紧：上游只查 main，此处整体透传防丢副光标）', () => {
    const state = EditorState.create({
      doc: '- a\n- b',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.range(3, 3),
        EditorSelection.range(7, 7),
      ]),
    })
    expect(state.selection.ranges.length).toBe(2)
    expect(planBetterBackspace(state)).toBeNull()
  })

  it('嵌套让位：缩进空列表项 → null（平台树判 dedent/clear 接手）', () => {
    expect(planBetterBackspace(stateAt('- a\n  - ', 8))).toBeNull()
  })

  it('任务让位：空任务项 → null（平台一次清整段前缀接手）', () => {
    expect(planBetterBackspace(stateAt('- a\n- [ ] ', 10))).toBeNull()
  })

  it('普通文本与空行 → null', () => {
    expect(planBetterBackspace(stateAt('abc', 3))).toBeNull()
    expect(planBetterBackspace(stateAt('', 0))).toBeNull()
  })
})

describe('keymap Command betterBackspaceCommand：接管/透传与派发形态', () => {
  interface DispatchSpec {
    changes?: Array<{ from: number; to: number; insert: string }>
    selection?: { anchor: number; head: number }
    userEvent?: string
    scrollIntoView?: boolean
  }

  function fakeView(state: EditorState): { view: EditorView; calls: DispatchSpec[] } {
    const calls: DispatchSpec[] = []
    const view = {
      state,
      compositionStarted: false,
      dispatch: (spec: DispatchSpec) => {
        calls.push(spec)
      },
    }
    return { view: view as unknown as EditorView, calls }
  }

  it('命中：派发删除事务（changes + 折叠光标 + delete.backward + scrollIntoView）并接管', () => {
    const { view, calls } = fakeView(stateAt('1. a\n2. \n3. b', 8))
    expect(betterBackspaceCommand(view)).toBe(true)
    expect(calls).toHaveLength(1)
    // 派发形态对齐平台 stripListLayer 惯例（userEvent/scrollIntoView），
    // 变更语义对齐上游（合并 + 重编号单笔事务，一次撤销整体回退）
    expect(calls[0]!.changes).toEqual([
      { from: 4, to: 8, insert: '' },
      { from: 9, to: 13, insert: "2. b" },
    ])
    expect(calls[0]!.selection).toEqual({ anchor: 4, head: 4 })
    expect(calls[0]!.userEvent).toBe('delete.backward')
    expect(calls[0]!.scrollIntoView).toBe(true)
  })

  it('命中派发的事务可直接应用到真实 EditorState（终态 = 算法矩阵期望）', () => {
    // 双实现对照：Command 派发的 changes/selection 喂真实 state.update，
    // 终态与 test/backspace.test.ts 的应用器期望一致
    const state = stateAt('1. a\n2. \n3. b', 8)
    const plan = planBetterBackspace(state)!
    const tr = state.update({
      changes: plan.changes,
      selection: { anchor: plan.cursor, head: plan.cursor },
    })
    expect(tr.state.doc.toString()).toBe('1. a\n2. b')
    expect(tr.state.selection.main.head).toBe(4)
  })

  it('未命中：零派发并透传（return false 落穿平台 Backspace 链）', () => {
    const { view, calls } = fakeView(stateAt('abc', 1))
    expect(betterBackspaceCommand(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('让位面同样零派发透传（嵌套/任务归平台）', () => {
    for (const doc of ['- a\n  - ', '- a\n- [ ] ']) {
      const { view, calls } = fakeView(stateAt(doc, doc.length))
      expect(betterBackspaceCommand(view)).toBe(false)
      expect(calls).toHaveLength(0)
    }
  })

  it('IME 组合中不接管（组合文本即正文，此处显式防御）', () => {
    const view = {
      state: stateAt('- a\n- ', 6),
      compositionStarted: true,
      dispatch: () => {
        throw new Error('组合中不应派发')
      },
    }
    expect(betterBackspaceCommand(view as unknown as EditorView)).toBe(false)
  })

  it('只读状态不接管（零派发落穿）', () => {
    const state = EditorState.create({
      doc: '- a\n- ',
      extensions: [EditorState.readOnly.of(true)],
      selection: { anchor: 6 },
    })
    const { view, calls } = fakeView(state)
    expect(betterBackspaceCommand(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
