// NewLineBelow 当前行下方新建行测试（工单 #13）。
// 拦截单元化模式对齐 #7/#8/#11/#18（taboutIntercept / backspaceIntercept /
// modaIntercept / foldEnter）：前缀矩阵（纯逻辑）+ 真实 EditorState 驱动
// 决策（列位置语义——票面点名核对项）+ 最小模拟 view（state + dispatch
// 捕获）驱动 Command，不依赖 DOM 与真宿主。浏览器真实键盘端到端归 #21。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { SETTINGS_TOPIC } from '../src/settings/store'
import {
  createNewLineBelowCommand,
  createNewLineBelowGate,
  newLineBelowPrefix,
  planNewLineBelow,
} from '../src/newLineBelow'

/** 文档 + 光标构造 */
function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } })
}

/** 多选区构造 */
function multiStateAt(doc: string, cursors: number[]): EditorState {
  return EditorState.create({
    doc,
    extensions: [EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(cursors.map((c) => EditorSelection.range(c, c))),
  })
}

// ============================================================
// 前缀矩阵 newLineBelowPrefix：上游 682-726 行逐形态对照
// ============================================================

describe('前缀矩阵 newLineBelowPrefix（上游口径）', () => {
  it('普通文本行：无前缀（含缩进段落——上游仅列表/引用延续）', () => {
    expect(newLineBelowPrefix('abc')).toBe('')
    expect(newLineBelowPrefix('# Heading')).toBe('')
    expect(newLineBelowPrefix('    indented text')).toBe('')
    expect(newLineBelowPrefix('| a | b |')).toBe('')
  })

  it('空白行（纯空白）：无前缀——新行不继承空白', () => {
    expect(newLineBelowPrefix('')).toBe('')
    expect(newLineBelowPrefix('   ')).toBe('')
    expect(newLineBelowPrefix('\t')).toBe('')
  })

  it('无序列表：延续原标记 + 空格（标记后须有空白才认）', () => {
    expect(newLineBelowPrefix('- item')).toBe('- ')
    expect(newLineBelowPrefix('* item')).toBe('* ')
    expect(newLineBelowPrefix('+ item')).toBe('+ ')
    expect(newLineBelowPrefix('  - nested')).toBe('  - ')
    // 标记后无空白不认（上游 \s 口径）
    expect(newLineBelowPrefix('-item')).toBe('')
    expect(newLineBelowPrefix('--')).toBe('')
  })

  it('任务列表：重置为 [ ]（任意括号内字符）；无尾随空白时按裸标记延续', () => {
    expect(newLineBelowPrefix('- [x] done')).toBe('- [ ] ')
    expect(newLineBelowPrefix('* [X] done')).toBe('* [ ] ')
    expect(newLineBelowPrefix('- [ ] todo')).toBe('- [ ] ')
    expect(newLineBelowPrefix('+ [.] any')).toBe('+ [ ] ')
    // 无尾随空白：任务形态不成立，裸标记形态成立（上游交替顺序口径）
    expect(newLineBelowPrefix('- [x]')).toBe('- ')
  })

  it('有序列表：递增加点号空格（parseInt 归一化前导零）；仅「数字.」形态', () => {
    expect(newLineBelowPrefix('1. one')).toBe('2. ')
    expect(newLineBelowPrefix('9. nine')).toBe('10. ')
    expect(newLineBelowPrefix('99. big')).toBe('100. ')
    expect(newLineBelowPrefix('09. padded')).toBe('10. ')
    expect(newLineBelowPrefix('  3. nested')).toBe('  4. ')
    // `1)` 非上游形态（#8 退格票的扩展不带入本票）
    expect(newLineBelowPrefix('1) paren')).toBe('')
  })

  it('引用：延续 `>` 串（含既有尾空格形态），前导缩进保留', () => {
    expect(newLineBelowPrefix('> quote')).toBe('> ')
    expect(newLineBelowPrefix('>quote')).toBe('>')
    expect(newLineBelowPrefix('>> deep')).toBe('>> ')
    expect(newLineBelowPrefix('  > indented')).toBe('  > ')
    // 层间带空格的 `> > ` 上游正则只认首个 `>` 串（保持上游口径）
    expect(newLineBelowPrefix('> > spaced')).toBe('> ')
  })

  it('列表优先于引用（行首互斥，上游判定顺序）', () => {
    // '> - item' 行首是 `>`：列表正则要求行首空白后即标记，不命中 → 引用
    expect(newLineBelowPrefix('> - item')).toBe('> ')
  })
})

// ============================================================
// 决策 planNewLineBelow：真实 EditorState（列位置语义核对）
// ============================================================

describe('决策 planNewLineBelow：插入点恒在行尾，光标落新行前缀末尾', () => {
  it('普通行：插入点 = 行尾（与光标列无关），光标落新行列 0——不保持原列', () => {
    // 'abc\ndef'：光标在 col 1，新行光标在 col 0
    expect(planNewLineBelow(stateAt('abc\ndef', 1))).toEqual({
      insertAt: 3,
      insert: '\n',
      cursor: 4,
    })
    // 行首/行尾光标同一计划（列位置不参与决策）
    expect(planNewLineBelow(stateAt('abc\ndef', 0))).toEqual(
      planNewLineBelow(stateAt('abc\ndef', 3)),
    )
  })

  it('光标后文本留在当前行（插入在行尾，不拆行内文本）', () => {
    // 'abcd' 光标 col 2：'cd' 留在第一行，新行空
    expect(planNewLineBelow(stateAt('abcd', 2))).toEqual({ insertAt: 4, insert: '\n', cursor: 5 })
  })

  it('列表行：新行带续前缀，光标落前缀末尾', () => {
    // '- one\ntwo'：line.to = 5
    expect(planNewLineBelow(stateAt('- one\ntwo', 2))).toEqual({
      insertAt: 5,
      insert: '\n- ',
      cursor: 8,
    })
    expect(planNewLineBelow(stateAt('9. x', 4))).toEqual({
      insertAt: 4,
      insert: '\n10. ',
      cursor: 9,
    })
  })

  it('引用行：新行带引用前缀', () => {
    expect(planNewLineBelow(stateAt('> q', 3))).toEqual({
      insertAt: 3,
      insert: '\n> ',
      cursor: 6,
    })
  })

  it('空白行：插入点在空白之后（line.to），新行纯空', () => {
    // 'a\n  \nb'：第二行 '  '（2-4），插入点 4 = 空白之后
    expect(planNewLineBelow(stateAt('a\n  \nb', 3))).toEqual({
      insertAt: 4,
      insert: '\n',
      cursor: 5,
    })
  })

  it('文档末行无尾随换行：前置换行语义同（行尾插入）', () => {
    expect(planNewLineBelow(stateAt('last', 2))).toEqual({
      insertAt: 4,
      insert: '\n',
      cursor: 5,
    })
  })

  it('非空选区：上游口径不特判（取 main.head 所在行）', () => {
    const state = EditorState.create({ doc: 'abcd', selection: { anchor: 1, head: 3 } })
    expect(planNewLineBelow(state)).toEqual({ insertAt: 4, insert: '\n', cursor: 5 })
  })
})

// ============================================================
// Command：门控、防御面、派发形态
// ============================================================

describe('keymap Command createNewLineBelowCommand：接管/透传与派发形态', () => {
  interface DispatchSpec {
    changes?: Array<{ from: number; to: number; insert: string }>
    selection?: { anchor: number; head: number }
    userEvent?: string
    scrollIntoView?: boolean
    effects?: unknown
  }

  function fakeView(
    state: EditorState,
    compositionStarted = false,
  ): { view: EditorView; calls: DispatchSpec[] } {
    const calls: DispatchSpec[] = []
    const view = {
      state,
      compositionStarted,
      dispatch: (spec: DispatchSpec) => {
        calls.push(spec)
      },
    }
    return { view: view as unknown as EditorView, calls }
  }

  it('功能开：派发单笔插入事务（行尾插入 + 新行光标 + input.newline + scrollIntoView，零 effects）并接管', () => {
    const { view, calls } = fakeView(stateAt('- one\ntwo', 2))
    const command = createNewLineBelowCommand({ isEnabled: () => true })
    expect(command(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.changes).toEqual({ from: 5, to: 5, insert: '\n- ' })
    expect(calls[0]!.selection).toEqual({ anchor: 8, head: 8 })
    expect(calls[0]!.userEvent).toBe('input.newline')
    expect(calls[0]!.scrollIntoView).toBe(true)
    // 纯文本事务，不携带任何 effect
    expect(calls[0]!.effects).toBeUndefined()
  })

  it('功能关 → 透传且零派发（落穿回平台 defaultKeymap insertBlankLine）', () => {
    const { view, calls } = fakeView(stateAt('abc', 1))
    const command = createNewLineBelowCommand({ isEnabled: () => false })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('多选区 → 透传且零派发（上游不检查会收敛为单光标；本仓透传回平台原生多光标）', () => {
    const { view, calls } = fakeView(multiStateAt('abc\ndef', [1, 5]))
    const command = createNewLineBelowCommand({ isEnabled: () => true })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('IME 组合中不接管（组合文本即正文，防御对齐 #8/#18）', () => {
    const { view, calls } = fakeView(stateAt('中文', 1), true)
    const command = createNewLineBelowCommand({ isEnabled: () => true })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('只读状态不接管（零派发落穿）', () => {
    const state = EditorState.create({
      doc: 'abc',
      extensions: [EditorState.readOnly.of(true)],
      selection: { anchor: 1 },
    })
    const { view, calls } = fakeView(state)
    const command = createNewLineBelowCommand({ isEnabled: () => true })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('命中派发的事务可直接应用到真实 EditorState（终态 = plan 期望；选区收敛为单光标）', () => {
    // 双实现对照（对齐 #8/#18 形态）：Command 派发的 changes/selection 喂
    // 真实 state.update，终态与 planNewLineBelow 的插入计划一致
    const state = stateAt('first\nsecond', 3)
    const plan = planNewLineBelow(state)
    const tr = state.update({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
    })
    expect(tr.state.doc.toString()).toBe('first\n\nsecond')
    expect(tr.state.selection.main.head).toBe(6)
    expect(tr.state.doc.lineAt(tr.state.selection.main.head).text).toBe('')
  })

  it('列表行终态：新行落在当前行与下一行之间，前缀延续', () => {
    const state = stateAt('- one\ntwo', 2)
    const plan = planNewLineBelow(state)
    const tr = state.update({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
    })
    expect(tr.state.doc.toString()).toBe('- one\n- \ntwo')
    expect(tr.state.doc.lineAt(tr.state.selection.main.head).text).toBe('- ')
  })
})

// ============================================================
// 设置门 createNewLineBelowGate：newLineBelow 生效值缓存
// ============================================================

describe('设置门 createNewLineBelowGate：newLineBelow 生效值缓存', () => {
  function channelOf(result: unknown, ok = true): VsidianAddonPageSdk['channel'] {
    return {
      request: async () =>
        ok ? { ok: true, result } : ({ ok: false, reason: 'rejected' } as AddonChannelOutcome),
    }
  }

  it('初始关闭（通道返回前一律透传——装载即拉取，窗口可忽略；透传 = 平台内建兜底）', () => {
    expect(createNewLineBelowGate(channelOf(null)).enabled()).toBe(false)
  })

  it('refresh 命中 effective.newLineBelow=true → 开', async () => {
    const gate = createNewLineBelowGate(channelOf({ effective: { newLineBelow: true } }))
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
  })

  it('refresh 返回 false → 关（设置页关闭后回生效）', async () => {
    const gate = createNewLineBelowGate(channelOf({ effective: { newLineBelow: false } }))
    await gate.refresh()
    expect(gate.enabled()).toBe(false)
  })

  it('通道失败（timeout/rejected）→ 保持上次值（fail-safe 不翻转）', async () => {
    let ok = true
    const gate = createNewLineBelowGate({
      request: async () =>
        ok
          ? { ok: true, result: { effective: { newLineBelow: true } } }
          : ({ ok: false, reason: 'timeout' } as AddonChannelOutcome),
    })
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
    ok = false
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
  })

  it('载荷形态异常（缺 effective / 非 boolean）→ 关', async () => {
    const noEffective = createNewLineBelowGate(channelOf({ values: {} }))
    await noEffective.refresh()
    expect(noEffective.enabled()).toBe(false)
    const wrongType = createNewLineBelowGate(channelOf({ effective: { newLineBelow: 'yes' } }))
    await wrongType.refresh()
    expect(wrongType.enabled()).toBe(false)
  })

  it('消费 #3 的设置通道 topic 常量（不自建第二份协议）', async () => {
    const seen: string[] = []
    const gate = createNewLineBelowGate({
      request: async (topic) => {
        seen.push(topic)
        return { ok: true, result: { effective: { newLineBelow: true } } }
      },
    })
    await gate.refresh()
    expect(seen).toEqual([SETTINGS_TOPIC.get])
  })
})
