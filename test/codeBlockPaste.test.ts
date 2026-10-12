// BetterCodeEdit 代码块粘贴缩进对齐（工单 #10）——决策纯函数 +
// domEventHandlers({ paste }) 处理器的 fake 层单元测试。上游对照
// cm_extensions.ts:112-166（transactionFilter 代码块分支）：多行纯文本
// 粘贴剥最小共同缩进（忽略空行计算——首行无缩进时共同缩进为 0，各行
// 自身缩进保留）、行内 \t 替换、首行不加前缀、其余行前缀 base_indent
//（块围栏缩进列）。与上游的差异（决策点，规格
// docs/specs/better-code-edit.md 留档）：\t 替换目标固定 2 空格（上游读
// Obsidian vault 配置，vsidian 无配置源——对齐内核 indentUnit 与 #120
// 口径）；userEvent 用平台惯例 'input.paste'（上游 'EasyTyping.change'）。
// 真实剪贴板粘贴手感归 #21 人工验证。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Facet } from '@codemirror/state'
import type { SyntaxQuery } from '../src/syntaxTreeQuery'
import { makeRejectingQuery, makeSyntaxFake } from './syntaxFake'
import { createPasteMarker } from '../src/pasteMarker'
import { createCodeBlockPasteHandler, planCodeBlockPaste } from '../src/codeBlockPaste'

/**
 * 列表下缩进代码块（indent=2）：
 * '- item\n  ```js\n  code\n  ```'
 * 行1 '- item' 0-6；行2 '  ```js' from=7 to=14（startPos=9）；行3 '  code'
 * from=15 to=21（codeStart=17、codeEnd=21）；行4 '  ```' from=22 to=27。
 */
const INDENTED = '- item\n  ```js\n  code\n  ```'

/** 顶格代码块（indent=0）：'```js\nconst a = 1\n```' 行2 from=6 to=17 */
const FLUSH = '```js\nconst a = 1\n```'

function queryOfDoc(text: string): SyntaxQuery {
  return makeSyntaxFake(text).query
}

describe('决策 planCodeBlockPaste：命中条件与文本对齐', () => {
  it('缩进块 × 两行共同缩进文本 → 剥共同缩进后按 base_indent 重排', () => {
    // '  aa\n  bb'：minIndent=2 → 'aa','bb' → 首行无前缀，第二行 '  bb'
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), '  aa\n  bb')).toEqual({
      from: 20,
      to: 20,
      insert: 'aa\n  bb',
    })
  })

  it('首行无缩进时共同缩进为 0：各行自身缩进保留并叠加 base_indent（上游实然）', () => {
    // 'aa\n  bb'：'aa' 缩进 0 → minIndent=0 → 不剥，第二行 '  bb'+base '  '
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\n  bb')).toEqual({
      from: 20,
      to: 20,
      insert: 'aa\n    bb',
    })
  })

  it('缩进块 × 无缩进多行文本 → 除首行外逐行加 base_indent', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\nbb')).toEqual({
      from: 20,
      to: 20,
      insert: 'aa\n  bb',
    })
  })

  it('行内 \\t 替换为固定 2 空格（实施决策点）→ 再叠加 base_indent', () => {
    // 'aa\n\tbb'：minIndent=0（首行无缩进）→ 第二行 '\tbb' 剥 0 后 \t→2 空格
    // '  bb'，再前缀 base_indent '  ' → '    bb'
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\n\tbb')).toEqual({
      from: 20,
      to: 20,
      insert: 'aa\n    bb',
    })
  })

  it('顶格块（indent=0）× 多行文本 → 无 base_indent，仅剥共同缩进', () => {
    const state = EditorState.create({ doc: FLUSH, selection: { anchor: 10 } })
    expect(planCodeBlockPaste(state, queryOfDoc(FLUSH), 'aa\nbb')).toEqual({
      from: 10,
      to: 10,
      insert: 'aa\nbb',
    })
  })

  it('单行粘贴 → null 不接管（上游 inserted_lines.length > 1 门槛）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'single')).toBeNull()
  })

  it('非空选区 → null（上游 fromA == fromB 纯插入门槛；选区替换归原生链）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 17, head: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\nbb')).toBeNull()
  })

  it('光标不在代码块 → null 透传', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 3 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\nbb')).toBeNull()
  })

  it('光标在开栏行 → 仍命中（上游闭区间含围栏两端）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 10 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\nbb')).toEqual({
      from: 10,
      to: 10,
      insert: 'aa\n  bb',
    })
  })

  it('多选区 → null 防御性透传', () => {
    const state = EditorState.create({
      doc: INDENTED,
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.range(20, 20), EditorSelection.range(3, 3)]),
    })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\nbb')).toBeNull()
  })

  it('查询拒绝 → null 不接管（不 fallback 正则）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, makeRejectingQuery(), 'aa\nbb')).toBeNull()
  })
})

describe('决策 planCodeBlockPaste：上游实然边界照抄', () => {
  it('全空行多行文本 → 规整为空行（substring(Infinity) 得空串）+ 其余行 base_indent', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), '  \n  ')).toEqual({
      from: 20,
      to: 20,
      insert: '\n  ',
    })
  })

  it('混合空行 → 空行同样被剥 + 加前缀（变 base_indent 串，上游 map 不跳过空行）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\n\nbb')).toEqual({
      from: 20,
      to: 20,
      insert: 'aa\n  \n  bb',
    })
  })

  it('CRLF 剪贴板文本先归一再决策（对齐 #12 normalizeClipboardText 入口归一）', () => {
    const state = EditorState.create({ doc: INDENTED, selection: { anchor: 20 } })
    expect(planCodeBlockPaste(state, queryOfDoc(INDENTED), 'aa\r\nbb')!.insert).toBe('aa\n  bb')
  })
})

describe('处理器 createCodeBlockPasteHandler：守卫与派发形态', () => {
  /** 最小模拟剪贴板数据（原生 DataTransfer / 平台合成 clipboardData 共形） */
  function clipboardData(text: string, items: Array<{ kind: string; type: string }> = []) {
    return {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      types: text ? ['text/plain'] : [],
      items,
    }
  }

  /** 最小模拟 paste 事件 */
  function pasteEvent(text: string, items: Array<{ kind: string; type: string }> = []) {
    const event = {
      clipboardData: clipboardData(text, items),
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    return event
  }

  interface DispatchSpec {
    changes?: { from: number; to: number; insert: string }
    selection?: { anchor: number; head: number }
    userEvent?: string
    scrollIntoView?: boolean
  }

  /** 最小模拟 view（state + dispatch 捕获；#12 同款形态） */
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

  /** 处理器工厂缺省依赖（真实 editable facet——node 下 facet 默认 true） */
  function handlerDeps(overrides: Partial<{ isBetterCodeEditEnabled: () => boolean }> = {}) {
    const marker = createPasteMarker({ now: () => 0 })
    return {
      deps: {
        marker,
        editableFacet: EditorView.editable as Facet<boolean, boolean>,
        // view → 同文 fake 查询（page-editor queryOfView 接线形态）
        queryOf: (view: EditorView) => makeSyntaxFake(view.state.doc.toString()).query,
        ...overrides,
      },
      marker,
    }
  }

  function stateAt(doc: string, cursor: number): EditorState {
    return EditorState.create({ doc, selection: { anchor: cursor } })
  }

  it('命中 → preventDefault + 单笔插入事务（userEvent input.paste + scrollIntoView）并接管', () => {
    const { deps } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const { view, calls } = fakeView(stateAt(INDENTED, 20))
    const event = pasteEvent('aa\nbb')
    expect(handler(event as unknown as Event, view)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.changes).toEqual({ from: 20, to: 20, insert: 'aa\n  bb' })
    expect(calls[0]!.userEvent).toBe('input.paste')
    expect(calls[0]!.scrollIntoView).toBe(true)
    expect(calls[0]!.selection).toEqual({ anchor: 27, head: 27 })
  })

  it('事件可见即置粘贴标记（markPaste(false)——#26 联动缝同款语义）', () => {
    const { deps, marker } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const { view } = fakeView(stateAt(INDENTED, 20))
    handler(pasteEvent('aa\nbb') as unknown as Event, view)
    expect(marker.pasteDetected).toBe(true)
    expect(marker.plainPasteInProgress).toBe(false)
  })

  it('语法查询缺席 → 透传（#5：不接管不 fallback）', () => {
    const marker = createPasteMarker({ now: () => 0 })
    const handler = createCodeBlockPasteHandler({
      marker,
      editableFacet: EditorView.editable as Facet<boolean, boolean>,
      queryOf: () => null,
    })
    const { view, calls } = fakeView(stateAt(INDENTED, 20))
    const event = pasteEvent('aa\nbb')
    expect(handler(event as unknown as Event, view)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('单行粘贴 → 透传（return false，不 preventDefault，零派发）', () => {
    const { deps } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const { view, calls } = fakeView(stateAt(INDENTED, 20))
    const event = pasteEvent('single')
    expect(handler(event as unknown as Event, view)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('门控关（betterCodeEdit）→ 透传（零派发，不 preventDefault）', () => {
    const { deps } = handlerDeps({ isBetterCodeEditEnabled: () => false })
    const handler = createCodeBlockPasteHandler(deps)
    const { view, calls } = fakeView(stateAt(INDENTED, 20))
    const event = pasteEvent('aa\nbb')
    expect(handler(event as unknown as Event, view)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('IME 组合中 / 只读 → 透传（#12 三守卫同款）', () => {
    const { deps } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const composing = fakeView(stateAt(INDENTED, 20), { compositionStarted: true })
    expect(handler(pasteEvent('aa\nbb') as unknown as Event, composing.view)).toBe(false)
    const readOnly = fakeView(
      EditorState.create({
        doc: INDENTED,
        selection: { anchor: 20 },
        extensions: [EditorState.readOnly.of(true)],
      }),
    )
    expect(handler(pasteEvent('aa\nbb') as unknown as Event, readOnly.view)).toBe(false)
  })

  it('不可编辑 facet → 透传', () => {
    const { deps } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const state = EditorState.create({
      doc: INDENTED,
      selection: { anchor: 20 },
      extensions: [EditorView.editable.of(false)],
    })
    const { view, calls } = fakeView(state)
    expect(handler(pasteEvent('aa\nbb') as unknown as Event, view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('图片剪贴板项 → 透传（平台资产管线在前，防御性复核不吞图片）', () => {
    const { deps } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const { view, calls } = fakeView(stateAt(INDENTED, 20))
    const event = pasteEvent('aa\nbb', [{ kind: 'file', type: 'image/png' }])
    expect(handler(event as unknown as Event, view)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('剪贴板数据缺失 / 空文本 → 透传', () => {
    const { deps } = handlerDeps()
    const handler = createCodeBlockPasteHandler(deps)
    const { view } = fakeView(stateAt(INDENTED, 20))
    const noData = { defaultPrevented: false, preventDefault() {} }
    expect(handler(noData as unknown as Event, view)).toBe(false)
    expect(handler(pasteEvent('') as unknown as Event, view)).toBe(false)
  })
})
