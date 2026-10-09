// SmartPaste 粘贴拦截单元测试（工单 #12 接入层）——拦截逻辑单元化：真实
// EditorState 驱动决策（planSmartPasteInsert），最小模拟 paste 事件 + view
// 驱动 domEventHandlers 处理器，不依赖 DOM 与真宿主。上游对照
// cm_extensions.ts:168-263 的命中条件（`changeType 含 paste && fromA==fromB
// && 光标在行尾 && 目标行为列表/引用`）。算法矩阵见 test/smartPaste.test.ts；
// 与 vsidian 内核粘贴管线的让位/接管核对结论见 docs/specs/smart-paste.md
//「平台粘贴冲突核对」节，此处用例钉住交界语义。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Facet } from '@codemirror/state'
import { createPasteMarker } from '../src/pasteMarker'
import { createSmartPastePasteHandler, planSmartPasteInsert } from '../src/smartPasteIntercept'

/** 文档 + 折叠光标构造 */
function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } })
}

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
  changes?: Array<{ from: number; to: number; insert: string }>
  selection?: { anchor: number; head: number }
  userEvent?: string
  scrollIntoView?: boolean
}

/** 最小模拟 view（state + dispatch 捕获） */
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
function handlerdeps(overrides: Partial<{ isSmartPasteEnabled: () => boolean }> = {}) {
  const marker = createPasteMarker({ now: () => 0 })
  return {
    deps: {
      marker,
      editableFacet: EditorView.editable as Facet<boolean, boolean>,
      ...overrides,
    },
    marker,
  }
}

describe('决策 planSmartPasteInsert：命中条件与绝对坐标', () => {
  it('列表目标行尾 × 多行纯文本 → 续接插入（from=to=光标）', () => {
    expect(planSmartPasteInsert(stateAt('- item', 6), 'aa\nbb')).toEqual({
      from: 6,
      to: 6,
      insert: 'aa\n- bb',
    })
  })

  it('引用目标行尾 × 多行纯文本 → 引用前缀续接', () => {
    expect(planSmartPasteInsert(stateAt('> quote', 7), 'aa\nbb')).toEqual({
      from: 7,
      to: 7,
      insert: 'aa\n> bb',
    })
  })

  it('CRLF 剪贴板文本先归一再决策（恒等时透传）', () => {
    // 'aa\r\nbb' → 'aa\n- bb'：归一后参与续接
    expect(planSmartPasteInsert(stateAt('- item', 6), 'aa\r\nbb')!.insert).toBe('aa\n- bb')
  })

  it('恒等续接（单行纯文本）→ null 透传（保留原生粘贴语义）', () => {
    expect(planSmartPasteInsert(stateAt('- item', 6), 'plain')).toBeNull()
    expect(planSmartPasteInsert(stateAt('> quote', 7), 'plain')).toBeNull()
  })

  it('全空行粘贴非恒等（剥离公共缩进）→ 仍命中', () => {
    expect(planSmartPasteInsert(stateAt('- item', 6), '  \n  ')).toEqual({
      from: 6,
      to: 6,
      insert: '\n',
    })
  })

  it('光标不在行尾 → null（上游 fromA == lineAt(toA).to 门槛）', () => {
    expect(planSmartPasteInsert(stateAt('- item', 3), 'aa\nbb')).toBeNull()
  })

  it('目标行非列表/引用（普通文本 / 表格行）→ null', () => {
    expect(planSmartPasteInsert(stateAt('plain', 5), 'aa\nbb')).toBeNull()
    expect(planSmartPasteInsert(stateAt('| a | b |', 9), 'aa\nbb')).toBeNull()
  })

  it('非空选区 → null（上游 fromA == fromB 纯插入门槛；选区替换归原生链）', () => {
    const state = EditorState.create({ doc: '- item', selection: { anchor: 0, head: 6 } })
    expect(planSmartPasteInsert(state, 'aa\nbb')).toBeNull()
  })

  it('多选区 → null（防御性收紧：原生多光标粘贴行分配归平台）', () => {
    const state = EditorState.create({
      doc: '- a\n- b',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.range(3, 3),
        EditorSelection.range(7, 7),
      ]),
    })
    expect(state.selection.ranges.length).toBe(2)
    expect(planSmartPasteInsert(state, 'aa\nbb')).toBeNull()
  })

  it('空文本 → null（原生链落 text/uri-list 兜底）', () => {
    expect(planSmartPasteInsert(stateAt('- item', 6), '')).toBeNull()
  })
})

describe('domEventHandlers paste 处理器：接管/透传与派发形态', () => {
  it('命中：preventDefault + 单笔插入事务（input.paste + scrollIntoView）并接管', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const { view, calls } = fakeView(stateAt('- item', 6))
    const event = pasteEvent('aa\nbb')
    expect(handler(event as unknown as Event, view)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(calls).toHaveLength(1)
    // 派发形态对齐 CM6 原生 doPaste（userEvent input.paste + 滚动），
    // 与上游差异：不用自定义 userEvent（平台撤销归类与 #26 观察面一致）
    expect(calls[0]!.changes).toEqual({ from: 6, to: 6, insert: 'aa\n- bb' })
    expect(calls[0]!.selection).toEqual({ anchor: 13, head: 13 })
    expect(calls[0]!.userEvent).toBe('input.paste')
    expect(calls[0]!.scrollIntoView).toBe(true)
  })

  it('命中派发的事务可直接应用到真实 EditorState（终态 = 算法矩阵期望）', () => {
    const plan = planSmartPasteInsert(stateAt('- item', 6), '- x\n- y')!
    const state = stateAt('- item', 6)
    const tr = state.update({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      selection: { anchor: plan.from + plan.insert.length },
    })
    expect(tr.state.doc.toString()).toBe('- itemx\n- y')
    expect(tr.state.selection.main.head).toBe(11)
  })

  it('未命中：零派发不 preventDefault 并透传（恒等/行中/非目标行/选区）', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    for (const [doc, cursor, text] of [
      ['- item', 6, 'plain'],
      ['- item', 3, 'aa\nbb'],
      ['plain', 5, 'aa\nbb'],
    ] as const) {
      const { view, calls } = fakeView(stateAt(doc, cursor))
      const event = pasteEvent(text)
      expect(handler(event as unknown as Event, view)).toBe(false)
      expect(event.defaultPrevented).toBe(false)
      expect(calls).toHaveLength(0)
    }
  })

  it('事件可见即标记 pasteDetected（上游 Mod-v 键位标记的事件级等价；透传也标记）', () => {
    const { deps, marker } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const { view } = fakeView(stateAt('plain', 5))
    handler(pasteEvent('aa\nbb') as unknown as Event, view)
    expect(marker.pasteDetected).toBe(true)
    expect(marker.plainPasteInProgress).toBe(false)
  })

  it('设置门控关闭：标记仍发生但零派发透传（关闭 = 不续接，不吞粘贴）', () => {
    const { deps, marker } = handlerdeps({ isSmartPasteEnabled: () => false })
    const handler = createSmartPastePasteHandler(deps)
    const { view, calls } = fakeView(stateAt('- item', 6))
    const event = pasteEvent('aa\nbb')
    expect(handler(event as unknown as Event, view)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toHaveLength(0)
    expect(marker.pasteDetected).toBe(true)
  })

  it('设置门控显式开（审查 B-F5 装配接线）：命中场景照常接管续接（与缺省恒开同形）', () => {
    const { deps } = handlerdeps({ isSmartPasteEnabled: () => true })
    const handler = createSmartPastePasteHandler(deps)
    const { view, calls } = fakeView(stateAt('- item', 6))
    const event = pasteEvent('aa\nbb')
    expect(handler(event as unknown as Event, view)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('纯文本意图不被事件级标记冲掉（命令置 plain 后合成事件透传仍保留）', () => {
    const { deps, marker } = handlerdeps()
    marker.markPaste(true)
    const handler = createSmartPastePasteHandler(deps)
    const { view } = fakeView(stateAt('plain', 5))
    handler(pasteEvent('aa\nbb') as unknown as Event, view)
    expect(marker.plainPasteInProgress).toBe(true)
  })

  it('图片剪贴板项 → 透传（平台 imagePaste 先接管；防御性复核不吞图片粘贴）', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const { view, calls } = fakeView(stateAt('- item', 6))
    const event = pasteEvent('aa\nbb', [{ kind: 'file', type: 'image/png' }])
    expect(handler(event as unknown as Event, view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('空 text/plain → 透传（原生链落 uri-list 兜底）', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const { view, calls } = fakeView(stateAt('- item', 6))
    expect(handler(pasteEvent('') as unknown as Event, view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('无 clipboardData → 透传', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const { view } = fakeView(stateAt('- item', 6))
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    expect(handler(event as unknown as Event, view)).toBe(false)
  })

  it('IME 组合中不接管（组合文本即正文；平台 imagePaste 同口径）', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const { view, calls } = fakeView(stateAt('- item', 6), { compositionStarted: true })
    expect(handler(pasteEvent('aa\nbb') as unknown as Event, view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('只读状态不接管（零派发落穿）', () => {
    const { deps } = handlerdeps()
    const handler = createSmartPastePasteHandler(deps)
    const state = EditorState.create({
      doc: '- item',
      extensions: [EditorState.readOnly.of(true)],
      selection: { anchor: 6 },
    })
    const { view, calls } = fakeView(state)
    expect(handler(pasteEvent('aa\nbb') as unknown as Event, view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('editable facet 关闭（如只读嵌入）不接管', () => {
    const marker = createPasteMarker({ now: () => 0 })
    const handler = createSmartPastePasteHandler({
      marker,
      editableFacet: EditorView.editable,
    })
    const state = EditorState.create({
      doc: '- item',
      extensions: [EditorView.editable.of(false)],
      selection: { anchor: 6 },
    })
    const { view, calls } = fakeView(state)
    expect(handler(pasteEvent('aa\nbb') as unknown as Event, view)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
