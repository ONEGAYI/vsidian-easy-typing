// BetterCodeEdit 列表下缩进代码块删除优化（工单 #10）——决策纯函数 +
// Command 工厂的 fake 层单元测试。上游对照 cm_extensions.ts:279-324
//（transactionFilter 删除分支，改 keymap 拦截——理由见规格
// docs/specs/better-code-edit.md「平台映射」节）：仅 indent ≠ 0 的块接管，
// 两分支——边界列删换行合并（连换行带缩进一起删）、跨边界删除裁剪（缩进
// 列保留）。userEvent 用平台惯例 'delete.backward'（#8 先例，不用上游
// 'EasyTyping.change'）。真实退格手感与 #8 让位共存归 #21 人工验证。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxQuery } from '../src/syntaxTreeQuery'
import { makeRejectingQuery, makeSyntaxFake } from './syntaxFake'
import { createCodeBlockBackspaceCommand, planCodeBlockBackspace } from '../src/codeBlockBackspace'

/**
 * 列表下缩进代码块（indent=2）：
 * '- item\n  ```js\n  code\n  x\n  ```'
 * 行1 '- item' 0-6；行2 '  ```js' from=7 to=14（startPos=9，开栏行尾=14）；
 * 行3 '  code' from=15 to=21；行4 '  x' from=22 to=25（边界列=24）；行5
 * '  ```' from=26 to=31（endPos=31）。
 */
const INDENTED = '- item\n  ```js\n  code\n  x\n  ```'

/** 顶格代码块（indent=0，完全不接管）：行2 'const a = 1' from=6 to=17 */
const FLUSH = '```js\nconst a = 1\nconst b = 2\n```'

function queryOfDoc(text: string): SyntaxQuery {
  return makeSyntaxFake(text).query
}

describe('决策 planCodeBlockBackspace：分支①（光标恰在缩进边界列）', () => {
  it('内容行边界列 → 删除范围改为「上一行行尾 → toA」（连换行带缩进一起删）', () => {
    // 光标 24 = 行4.from(22)+indent(2)：删除 [行3.to=21, 24]，光标落 21
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 24 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toEqual({
      changes: [{ from: 21, to: 24, insert: '' }],
      cursor: 21,
    })
  })

  it('未闭合块首内容行边界列 → 同样合并到上一行（上一行是开栏行，上游实然）', () => {
    // '- item\n  ```js\n  code'：行3 from=15 to=21，边界列 17；开栏行尾 14
    const doc = '- item\n  ```js\n  code'
    const state = EditorState.create({ doc, selection: { anchor: 17 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(doc))).toEqual({
      changes: [{ from: 14, to: 17, insert: '' }],
      cursor: 14,
    })
  })

  it('闭栏行缩进边界列 → 合并到上一内容行（上游闭区间命中，实然行为）', () => {
    // 行5 '  ```' 边界列 = 26+2 = 28 → 删除 [行4.to=25, 28]
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 28 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toEqual({
      changes: [{ from: 25, to: 28, insert: '' }],
      cursor: 25,
    })
  })
})

describe('决策 planCodeBlockBackspace：分支②（删除跨越缩进边界 → 裁剪保留缩进列）', () => {
  it('单选区跨边界（选中「缩进+内容」）→ 裁剪为 [行首+indent, toA]', () => {
    // 选区 [22, 25] 选中行4 整行 '  x'：from ∈ [22,24) 且 to > 24 → 裁剪 [24,25]
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 22, head: 25 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toEqual({
      changes: [{ from: 24, to: 25, insert: '' }],
      cursor: 24,
    })
  })

  it('选区只在缩进段内（to 不越边界）→ null 透传（默认删选区空白）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 22, head: 24 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })
})

describe('决策 planCodeBlockBackspace：让位面（null 透传平台链）', () => {
  it('顶格块（indent=0）→ 完全不接管', () => {
    // 光标 6 = 'const a = 1' 行首列（indent=0 时边界列即行首）
    const state = EditorState.create({ doc: FLUSH, selection: { anchor: 6 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(FLUSH))).toBeNull()
  })

  it('光标在开栏行（toA ≤ 开栏行行尾）→ 不接管', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 10 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })

  it('光标在缩进段中间（非边界列、折叠删除不跨界）→ null（默认删一个空白）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 23 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })

  it('光标在内容区行尾 → null（普通删字符归平台）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 25 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })

  it('光标在行首列 0（折叠删除跨行 fromA < 行首）→ null（归平台 joinLineBackward）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 22 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })

  it('光标不在代码块 → null', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 3 } })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })

  it('多选区 → null 防御性透传', () => {
    const state = EditorState.create({
      doc: INDENTED,
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.range(24, 24), EditorSelection.range(20, 20)]),
    })
    expect(planCodeBlockBackspace(state, queryOfDoc(INDENTED))).toBeNull()
  })

  it('查询拒绝 → null 不接管（不 fallback 正则）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 24 } })
    expect(planCodeBlockBackspace(state, makeRejectingQuery())).toBeNull()
  })
})

describe('Command createCodeBlockBackspaceCommand：门控与派发形态', () => {
  interface DispatchSpec {
    changes?: Array<{ from: number; to: number; insert: string }>
    selection?: { anchor: number; head: number }
    userEvent?: string
    scrollIntoView?: boolean
  }

  function fakeView(state: EditorState, overrides: Partial<{ compositionStarted: boolean }> = {}) {
    const calls: DispatchSpec[] = []
    const view = {
      state,
      compositionStarted: false,
      dispatch: (spec: DispatchSpec) => {
        calls.push(spec)
      },
      ...overrides,
    }
    return { view: view as unknown as EditorView, calls }
  }

  function stateAt(doc: string, cursor: number): EditorState {
    return EditorState.create({ doc, selection: { anchor: cursor } })
  }

  it('命中 → 派发单笔删除事务（userEvent delete.backward + scrollIntoView）并接管', () => {
    const command = createCodeBlockBackspaceCommand({ isEnabled: () => true, queryOf: () => queryOfDoc(INDENTED) })
    const { view, calls } = fakeView(stateAt(INDENTED, 24))
    expect(command(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.changes).toEqual([{ from: 21, to: 24, insert: '' }])
    expect(calls[0]!.selection).toEqual({ anchor: 21, head: 21 })
    expect(calls[0]!.userEvent).toBe('delete.backward')
    expect(calls[0]!.scrollIntoView).toBe(true)
  })

  it('门控关（betterCodeEdit）→ 透传（return false 零派发）', () => {
    const command = createCodeBlockBackspaceCommand({ isEnabled: () => false, queryOf: () => queryOfDoc(INDENTED) })
    const { view, calls } = fakeView(stateAt(INDENTED, 24))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('语法查询缺席 → 透传（#5：不接管不 fallback）', () => {
    const command = createCodeBlockBackspaceCommand({ isEnabled: () => true, queryOf: () => null })
    const { view, calls } = fakeView(stateAt(INDENTED, 24))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('IME 组合中 / 只读 → 透传（#8 同款守卫）', () => {
    const command = createCodeBlockBackspaceCommand({ isEnabled: () => true, queryOf: () => queryOfDoc(INDENTED) })
    const composing = fakeView(stateAt(INDENTED, 24), { compositionStarted: true })
    expect(command(composing.view)).toBe(false)
    const readOnly = fakeView(
      EditorState.create({
        doc: INDENTED,
        selection: { anchor: 24 },
        extensions: [EditorState.readOnly.of(true)],
      }),
    )
    expect(command(readOnly.view)).toBe(false)
  })
})
