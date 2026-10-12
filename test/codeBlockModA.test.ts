// BetterCodeEdit 代码块 Mod+A 三态选择（工单 #10）——决策纯函数 +
// Command 工厂的 fake 层单元测试。上游对照 syntax.ts:43-83
//（selectCodeBlockInPos）与 keyboard_handlers.ts:672-676（handleModA 链尾
// 调用点）：三态链「内容（首内容行行首 → codeEndPos）→ 整块
//（startPos → endPos）→ 落穿平台全选」；空块一次选整块。真实键位
// 手感与表格格内边界归 #21 人工验证（docs/manual-verification.md）。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { SyntaxQuery } from '../src/syntaxTreeQuery'
import { makeRejectingQuery, makeSyntaxFake } from './syntaxFake'
import { createCodeBlockModACommand, planCodeBlockModA } from '../src/codeBlockModA'

/** 非空代码块文档（顶格）：```
 * intro\n```js\nconst a = 1\nconst b = 2\n```\noutro
 * 行2 ```js from=6 to=11（startPos=6）；行3 from=12 to=23；行4 from=24 to=35；
 * 行5 ``` from=36 to=39（endPos=39）；codeStart=12、codeEnd=35。
 */
const DOC = 'intro\n```js\nconst a = 1\nconst b = 2\n```\noutro'

function queryOfDoc(text: string): SyntaxQuery {
  return makeSyntaxFake(text).query
}

describe('决策 planCodeBlockModA：三态链状态机', () => {
  it('未选中（折叠光标在内容行）→ 选内容（首内容行行首 → codeEndPos）', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: 15 } })
    expect(planCodeBlockModA(state, queryOfDoc(DOC))).toEqual({ anchor: 12, head: 35 })
  })

  it('已选内容 → 升档选整块（startPos → endPos）', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: 12, head: 35 } })
    expect(planCodeBlockModA(state, queryOfDoc(DOC))).toEqual({ anchor: 6, head: 39 })
  })

  it('已选整块 → null 落穿（平台全文全选）', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: 6, head: 39 } })
    expect(planCodeBlockModA(state, queryOfDoc(DOC))).toBeNull()
  })

  it('光标在开栏/闭栏行 → 仍命中（上游闭区间含围栏两端），首按选内容', () => {
    const openFence = EditorState.create({ doc: DOC, selection: { anchor: 8 } })
    expect(planCodeBlockModA(openFence, queryOfDoc(DOC))).toEqual({ anchor: 12, head: 35 })
    const closeFence = EditorState.create({ doc: DOC, selection: { anchor: 37 } })
    expect(planCodeBlockModA(closeFence, queryOfDoc(DOC))).toEqual({ anchor: 12, head: 35 })
  })

  it('反向选区（anchor > head）不匹配内容档 → 规整为正向内容（上游按 anchor/head 原序比对）', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: 35, head: 12 } })
    expect(planCodeBlockModA(state, queryOfDoc(DOC))).toEqual({ anchor: 12, head: 35 })
  })

  it('光标在块外（普通文本行）→ null 透传', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: 2 } })
    expect(planCodeBlockModA(state, queryOfDoc(DOC))).toBeNull()
  })

  it('多选区 → null 防御性透传（照 #11 惯例）', () => {
    const state = EditorState.create({
      doc: DOC,
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.range(15, 15), EditorSelection.range(25, 25)]),
    })
    expect(planCodeBlockModA(state, queryOfDoc(DOC))).toBeNull()
  })

  it('查询拒绝 → null 不接管（不 fallback 正则）', () => {
    const state = EditorState.create({ doc: DOC, selection: { anchor: 15 } })
    expect(planCodeBlockModA(state, makeRejectingQuery())).toBeNull()
  })
})

describe('决策 planCodeBlockModA：空块（codeStart == codeEnd）', () => {
  /** '```\n```'：行1 from=0 to=3；行2 from=4 to=7；startPos=0、endPos=7、codeStart=codeEnd=3 */
  it('折叠光标 → 一次选整块', () => {
    const doc = '```\n```'
    const state = EditorState.create({ doc, selection: { anchor: 1 } })
    expect(planCodeBlockModA(state, queryOfDoc(doc))).toEqual({ anchor: 0, head: 7 })
  })

  it('已选整块 → null 二次落穿（本仓口径，上游实然为重复派发同选区）', () => {
    const doc = '```\n```'
    const state = EditorState.create({ doc, selection: { anchor: 0, head: 7 } })
    expect(planCodeBlockModA(state, queryOfDoc(doc))).toBeNull()
  })

  it('列表下缩进空块：整块区间含缩进列（startPos 落围栏列）', () => {
    // 行1 '- item' 0-6；行2 '  ```' from=7 to=12；行3 '  ```' from=13 to=18
    // startPos=9（indent=2）、endPos=18、codeStart=codeEnd=12
    const doc = '- item\n  ```\n  ```'
    const state = EditorState.create({ doc, selection: { anchor: 10 } })
    expect(planCodeBlockModA(state, queryOfDoc(doc))).toEqual({ anchor: 9, head: 18 })
  })
})

describe('Command createCodeBlockModACommand：门控与派发形态', () => {
  interface DispatchCall {
    selection?: { anchor: number; head?: number }
    changes?: unknown
    userEvent?: string
  }

  function fakeView(state: EditorState): { view: EditorView; calls: DispatchCall[] } {
    const calls: DispatchCall[] = []
    const view = {
      state,
      dispatch: (spec: DispatchCall) => {
        calls.push(spec)
      },
    }
    return { view: view as unknown as EditorView, calls }
  }

  it('门控关（betterCodeEdit）→ 透传（return false 零派发）', () => {
    const command = createCodeBlockModACommand({ isEnabled: () => false, queryOf: () => queryOfDoc(DOC) })
    const { view, calls } = fakeView(EditorState.create({ doc: DOC, selection: { anchor: 15 } }))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('语法查询缺席 → 透传（#5：不接管不 fallback）', () => {
    const command = createCodeBlockModACommand({ isEnabled: () => true, queryOf: () => null })
    const { view, calls } = fakeView(EditorState.create({ doc: DOC, selection: { anchor: 15 } }))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('命中 → 派发纯选区事务（零写回、不带 userEvent——上游三处 dispatch 同款）并接管', () => {
    const command = createCodeBlockModACommand({ isEnabled: () => true, queryOf: () => queryOfDoc(DOC) })
    const { view, calls } = fakeView(EditorState.create({ doc: DOC, selection: { anchor: 15 } }))
    expect(command(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.selection).toEqual({ anchor: 12, head: 35 })
    expect(calls[0]!.changes).toBeUndefined()
    expect(calls[0]!.userEvent).toBeUndefined()
  })

  it('块外 → 透传（return false 零派发）', () => {
    const command = createCodeBlockModACommand({ isEnabled: () => true, queryOf: () => queryOfDoc(DOC) })
    const { view, calls } = fakeView(EditorState.create({ doc: DOC, selection: { anchor: 2 } }))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
