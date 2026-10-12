// StrictModeEnter 严格换行三模式补偿测试（工单 #30）。
// 拦截单元化模式对齐 #7/#8/#11/#13/#18：决策矩阵（纯逻辑，makeSyntaxFake
// 供树判定）+ 真实 EditorState 驱动决策 + 最小模拟 view（state + dispatch
// 捕获）驱动 Command，不依赖 DOM 与真宿主。浏览器真实键盘端到端归 #21
//（补项已落 docs/manual-verification.md 与 #21 票面）。
//
// 上游事实源：easy-typing-obsidian 6.0.9 keyboard_handlers.ts:222-297
//（enterStrictLineBreak）——判定序（空白行 → 行首 → quote 分支 → 段中
// 边界 → two_space text → text/顶格代码块末尾）逐用例对照。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import type { SyntaxQuery } from '../src/syntaxTreeQuery'
import { makeSyntaxFake } from './syntaxFake'
import { SETTINGS_TOPIC } from '../src/settings/store'
import type { StrictLineModeValue } from '../src/settings/defaults'
import {
  createStrictEnterCommand,
  createStrictEnterGate,
  planStrictEnter,
} from '../src/strictEnter'
import type { LineKind } from '../src/blockScan'
import { strictNewLineBelowInsert } from '../src/newLineBelow'

const MODES: readonly StrictLineModeValue[] = ['enter_twice', 'two_space', 'mix_mode']

/** 文档 + 光标构造 */
function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } })
}

function multiStateAt(doc: string, cursors: number[]): EditorState {
  return EditorState.create({
    doc,
    extensions: [EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(cursors.map((c) => EditorSelection.range(c, c))),
  })
}

/** 查询拒绝 fake（lineTypeAt 恒 ok:false——拒绝语义：不接管） */
const rejectedQuery: SyntaxQuery = {
  lineTypeAt: () => ({ ok: false, reason: 'read-only' }),
  inlineAt: () => ({ ok: false, reason: 'read-only' }),
}

/** 决策速记：doc 文本 + 光标 → plan 序列化（null 透传） */
function planOf(text: string, cursor: number, mode: StrictLineModeValue) {
  const fake = makeSyntaxFake(text)
  return planStrictEnter(fake.doc, fake.query, mode, cursor)
}

// ============================================================
// 边界门槛（上游 222-297 判定序逐条）
// ============================================================

describe('planStrictEnter 边界门槛（上游口径原样钉住）', () => {
  it('空白行不处理（三模式，上游 /^\s*$/ 先拦）', () => {
    for (const mode of MODES) {
      expect(planOf('  \nplain', 2, mode)).toBeNull()
      expect(planOf('\nplain', 0, mode)).toBeNull()
    }
  })

  it('光标在行首不处理（上游 pos == line.from）', () => {
    for (const mode of MODES) {
      expect(planOf('para\n\nnext', 0, mode)).toBeNull()
      expect(planOf('> quote\n\nnext', 0, mode)).toBeNull()
    }
  })

  it('纯引用前缀行（前缀后无内容）不处理（上游 quote_content.trim() == ""）', () => {
    for (const mode of MODES) {
      expect(planOf('> \nplain', 1, mode)).toBeNull()
      expect(planOf('>\nplain', 1, mode)).toBeNull()
    }
  })

  it('callout 标题行落穿（上游 v2 判 callout_title ≠ quote；平台判 quote，组件自判补齐）', () => {
    for (const mode of MODES) {
      expect(planOf('> [!note] 标题\nplain', 6, mode)).toBeNull()
    }
  })

  it('非 two_space 模式且下一行非空白不处理（段中边界——避免段中插空行拆段）', () => {
    expect(planOf('para one\npara two', 4, 'enter_twice')).toBeNull()
    expect(planOf('para one\npara two', 4, 'mix_mode')).toBeNull()
  })

  it('two_space 模式下一行非空白仍接管（两空格不改段结构，上游不拦）', () => {
    expect(planOf('para one\npara two', 4, 'two_space')).toEqual({
      insertAt: 4,
      insert: '  \n',
      cursor: 7,
    })
  })

  it('查询拒绝（ok:false）→ null（#5 拒绝口径：不接管，不 fallback 正则）', () => {
    const fake = makeSyntaxFake('para\n\nnext')
    expect(planStrictEnter(fake.doc, rejectedQuery, 'enter_twice', 2)).toBeNull()
  })

  it('pos 超界钳制防御（负值 → 0 即行首不处理；超长 → 末行行尾照常决策）', () => {
    const fake = makeSyntaxFake('hello\nworld')
    expect(planStrictEnter(fake.doc, fake.query, 'enter_twice', -5)).toBeNull()
    expect(planStrictEnter(fake.doc, fake.query, 'enter_twice', 999)).toEqual({
      insertAt: 11,
      insert: '\n\n',
      cursor: 13,
    })
  })
})

// ============================================================
// 正文行（text：table/heading 投影同维度——上游 v2 不特判）
// ============================================================

describe('planStrictEnter 正文行（LineKind text）', () => {
  it('enter_twice：下一行空白/文档末行 → 插 \\n\\n 分段，光标 pos+2', () => {
    expect(planOf('para\n\nnext', 2, 'enter_twice')).toEqual({
      insertAt: 2,
      insert: '\n\n',
      cursor: 4,
    })
    expect(planOf('para', 2, 'enter_twice')).toEqual({ insertAt: 2, insert: '\n\n', cursor: 4 })
  })

  it('two_space：插两空格 + 换行；行尾已有两空格不重复（整行 endsWith 检查）', () => {
    expect(planOf('para\n\nnext', 2, 'two_space')).toEqual({
      insertAt: 2,
      insert: '  \n',
      cursor: 5,
    })
    // 行尾两空格 + 光标在行尾：space_str 为空
    expect(planOf('para  \nnext', 6, 'two_space')).toEqual({
      insertAt: 6,
      insert: '\n',
      cursor: 7,
    })
  })

  it('mix_mode 正文行同 enter_twice（ADR-0002 §一表格）', () => {
    expect(planOf('para\n\nnext', 2, 'mix_mode')).toEqual({
      insertAt: 2,
      insert: '\n\n',
      cursor: 4,
    })
  })

  it('标题行投影 text：同正文语义（上游 v2 不特判 heading；折叠仲裁在装配层）', () => {
    expect(planOf('## title\n\nbody', 4, 'enter_twice')).toEqual({
      insertAt: 4,
      insert: '\n\n',
      cursor: 6,
    })
  })

  it('表格行投影 text：同正文语义（上游 v2 不特判 table）', () => {
    expect(planOf('| a | b |\n\nc', 4, 'two_space')).toEqual({
      insertAt: 4,
      insert: '  \n',
      cursor: 7,
    })
  })
})

// ============================================================
// 引用行（quote：不检查下一行空白——上游先于段中边界分支）
// ============================================================

describe('planStrictEnter 引用行（LineKind quote，内容非空）', () => {
  it('enter_twice：双行引用（\\n + 前缀 + \\n + 前缀），光标新前缀末尾', () => {
    expect(planOf('> quote text\nplain', 6, 'enter_twice')).toEqual({
      insertAt: 6,
      insert: '\n> \n> ',
      cursor: 12,
    })
  })

  it('two_space：两空格 + 续前缀；quote_content 已两空格不重复（前缀后内容检查）', () => {
    expect(planOf('> quote text\nplain', 6, 'two_space')).toEqual({
      insertAt: 6,
      insert: '  \n> ',
      cursor: 11,
    })
    expect(planOf('> text  \nplain', 8, 'two_space')).toEqual({
      insertAt: 8,
      insert: '\n> ',
      cursor: 11,
    })
  })

  it('mix_mode 引用行同 two_space（ADR-0002 §一表格）', () => {
    expect(planOf('> quote text\nplain', 6, 'mix_mode')).toEqual({
      insertAt: 6,
      insert: '  \n> ',
      cursor: 11,
    })
  })

  it('引用行不检查下一行空白（上游 quote 分支先于段中边界）', () => {
    expect(planOf('> quote\nplain', 5, 'enter_twice')).toEqual({
      insertAt: 5,
      insert: '\n> \n> ',
      cursor: 11,
    })
  })

  it('前缀原样延续（无尾空格形态 >text → >；多级 > > 仅取首级——上游 quote_regex 同口径）', () => {
    expect(planOf('>text\n\nnext', 3, 'enter_twice')).toEqual({
      insertAt: 3,
      insert: '\n>\n>',
      cursor: 7,
    })
    // QUOTE_PREFIX_RE 的 (>+ ?) 单串语义：'> > deep' 前缀提取 '> '（首级），
    // 双行引用各带一级前缀——上游 enterStrictLineBreak 正则同款行为
    expect(planOf('> > deep\n\nnext', 6, 'enter_twice')).toEqual({
      insertAt: 6,
      insert: '\n> \n> ',
      cursor: 12,
    })
  })

  it('引用行末行（无下一行）同样接管', () => {
    expect(planOf('> tail', 4, 'enter_twice')).toEqual({
      insertAt: 4,
      insert: '\n> \n> ',
      cursor: 10,
    })
  })
})

// ============================================================
// 落穿面（列表/公式/frontmatter/代码块内部——上游只认正文与引用）
// ============================================================

describe('planStrictEnter 落穿面', () => {
  it('列表行：三模式全落穿（上游由宿主续行链处理）', () => {
    for (const mode of MODES) {
      expect(planOf('- item\n\nnext', 3, mode)).toBeNull()
      expect(planOf('1. item\n\nnext', 3, mode)).toBeNull()
      expect(planOf('- [x] done\n\nnext', 5, mode)).toBeNull()
      expect(planOf('> - item\n\nnext', 5, mode)).toBeNull()
    }
  })

  it('公式块行：落穿（上游 codeblock/formula 排除）', () => {
    for (const mode of MODES) {
      expect(planOf('$$\nx = 1\n$$\nafter', 7, mode)).toBeNull()
      expect(planOf('$$\nx = 1\n$$\nafter', 1, mode)).toBeNull()
    }
  })

  it('frontmatter 行：落穿', () => {
    for (const mode of MODES) {
      expect(planOf('---\ntitle: x\n---\nbody', 8, mode)).toBeNull()
    }
  })

  it('代码块内部（内容行/闭栏行中部）：落穿', () => {
    for (const mode of MODES) {
      expect(planOf('```\ncode\n```\nafter', 6, mode)).toBeNull()
      // 闭栏行中部（pos != endPos）
      expect(planOf('```\ncode\n```\nafter', 11, mode)).toBeNull()
    }
  })

  it('顶格代码块闭栏行行尾特例：下一行空白时插 \\n\\n（上游 lineType text || codeBlockInfo end_pos 分支的 code 半边）', () => {
    // 行3 '```' from=9 to=12；endPos=12、indent=0 → 接管（段中边界不拦：
    // 行4 为空白行）
    for (const mode of MODES) {
      expect(planOf('```\ncode\n```\n\nafter', 12, mode)).toEqual({
        insertAt: 12,
        insert: '\n\n',
        cursor: 14,
      })
    }
  })

  it('顶格闭栏 + 下一行非空白：enter_twice/mix 死于段中边界（上游 267-269 先拦），two_space 走 code 特例', () => {
    expect(planOf('```\ncode\n```\nafter', 12, 'enter_twice')).toBeNull()
    expect(planOf('```\ncode\n```\nafter', 12, 'mix_mode')).toBeNull()
    expect(planOf('```\ncode\n```\nafter', 12, 'two_space')).toEqual({
      insertAt: 12,
      insert: '\n\n',
      cursor: 14,
    })
  })

  it('非顶格闭栏（引用内围栏 indent≠0）与缩进代码（无围栏块）：不适用特例', () => {
    // 引用内围栏闭栏行行尾：indent 含引用前缀 ≠ 0
    for (const mode of MODES) {
      expect(planOf('> ```\ncode\n> ```\nafter', 16, mode)).toBeNull()
      // 4 空格缩进围栏 = 缩进代码（无 codeblock-begin，不产块信息）
      expect(planOf('    ```\nx\n    ```\nafter', 12, mode)).toBeNull()
    }
  })
})

// ============================================================
// Mod+Enter 严格插入串（goNewLineAfterCurLine 728-762 的纯逻辑拆出）
// ============================================================

describe('strictNewLineBelowInsert（上游 goNewLineAfterCurLine 严格分支矩阵）', () => {
  const cases: ReadonlyArray<{ text: string; mode: StrictLineModeValue; kind: LineKind; want: string | null }> = [
    // 空白行不参与严格改写（上游空白行分支先 return）
    { text: '', mode: 'enter_twice', kind: 'empty', want: null },
    { text: '   ', mode: 'two_space', kind: 'empty', want: null },
    // 代码/公式行不改写（上游排除 codeblock/formula）
    { text: 'code line', mode: 'enter_twice', kind: 'code', want: null },
    { text: 'x = 1', mode: 'two_space', kind: 'formula', want: null },
    // 列表行所有模式不额外处理（上游 listMatch 恒 '\n'+prefix）
    { text: '- item', mode: 'two_space', kind: 'list', want: null },
    { text: '1. item', mode: 'enter_twice', kind: 'list', want: null },
    { text: '- [x] done', mode: 'mix_mode', kind: 'list', want: null },
    // 正文行
    { text: 'para', mode: 'two_space', kind: 'text', want: '  \n' },
    { text: 'para  ', mode: 'two_space', kind: 'text', want: '\n' },
    { text: 'para', mode: 'enter_twice', kind: 'text', want: '\n\n' },
    { text: 'para', mode: 'mix_mode', kind: 'text', want: '\n\n' },
    // 引用行（two_space 优先于 quoteMatch——正文引用同形态）
    { text: '> q', mode: 'two_space', kind: 'quote', want: '  \n> ' },
    { text: '> q  ', mode: 'two_space', kind: 'quote', want: '\n> ' },
    { text: '> q', mode: 'enter_twice', kind: 'quote', want: '\n> \n> ' },
    { text: '> q', mode: 'mix_mode', kind: 'quote', want: '  \n> ' },
    // 缩进引用：前缀含缩进延续
    { text: '  > deep', mode: 'enter_twice', kind: 'quote', want: '\n  > \n  > ' },
    // callout 标题行在 Mod+Enter 侧不排除（上游 quoteMatch 不查 callout）
    { text: '> [!note] t', mode: 'enter_twice', kind: 'quote', want: '\n> \n> ' },
  ]

  it('模式 × 行形态 × kind 全矩阵（上游 744-761 决策序）', () => {
    for (const c of cases) {
      expect(strictNewLineBelowInsert(c.text, c.mode, c.kind), `${c.mode} | ${JSON.stringify(c.text)} | ${c.kind}`).toBe(c.want)
    }
  })
})

// ============================================================
// Command：门控、防御面、派发形态
// ============================================================

describe('keymap Command createStrictEnterCommand：接管/透传与派发形态', () => {
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

  /** 严格开 + 指定模式的 Command 工厂（queryOf 用 makeSyntaxFake 与 state 同源文本） */
  function commandOn(mode: StrictLineModeValue, doc: string, enabled = true) {
    const fake = makeSyntaxFake(doc)
    return createStrictEnterCommand({
      isEnabled: () => enabled,
      mode: () => mode,
      queryOf: () => fake.query,
    })
  }

  it('命中（enter_twice 段尾）：派发单笔插入事务（input.newline + scrollIntoView，零 effects）并接管', () => {
    const { view, calls } = fakeView(stateAt('para\n\nnext', 4), false)
    expect(commandOn('enter_twice', 'para\n\nnext')(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.changes).toEqual({ from: 4, to: 4, insert: '\n\n' })
    expect(calls[0]!.selection).toEqual({ anchor: 6, head: 6 })
    expect(calls[0]!.userEvent).toBe('input.newline')
    expect(calls[0]!.scrollIntoView).toBe(true)
    expect(calls[0]!.effects).toBeUndefined()
  })

  it('双门关（isEnabled=false，装配侧合成 strictModeEnter × 宿主严格渲染）→ 透传且零派发', () => {
    const { view, calls } = fakeView(stateAt('para\n\nnext', 4))
    expect(commandOn('enter_twice', 'para\n\nnext', false)(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('决策未命中（段中 enter_twice）→ 透传且零派发（落穿平台 Enter 链）', () => {
    const { view, calls } = fakeView(stateAt('para one\npara two', 4))
    expect(commandOn('enter_twice', 'para one\npara two')(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('多选区 → 透传（上游 handleEnter 链首检查的对齐形态）', () => {
    const { view, calls } = fakeView(multiStateAt('para\n\nnext', [2, 8]))
    expect(commandOn('enter_twice', 'para\n\nnext')(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('非空选区：插入点取 main.to，选区文本保留原处（上游怪行为钉住，防顺手修正）', () => {
    const state = EditorState.create({ doc: 'abcd\n\nnext', selection: { anchor: 2, head: 4 } })
    const { view, calls } = fakeView(state)
    expect(commandOn('enter_twice', 'abcd\n\nnext')(view)).toBe(true)
    expect(calls[0]!.changes).toEqual({ from: 4, to: 4, insert: '\n\n' })
    const tr = state.update({
      changes: { from: 4, to: 4, insert: '\n\n' },
      selection: { anchor: 6, head: 6 },
    })
    expect(tr.state.doc.toString()).toBe('abcd\n\n\n\nnext')
    expect(tr.state.doc.sliceString(2, 4)).toBe('cd')
  })

  it('IME 组合中不接管（防御对齐 #8/#13/#18）', () => {
    const { view, calls } = fakeView(stateAt('中文段落\n\nnext', 3), true)
    expect(commandOn('enter_twice', '中文段落\n\nnext')(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('只读状态不接管（零派发落穿）', () => {
    const state = EditorState.create({
      doc: 'para\n\nnext',
      extensions: [EditorState.readOnly.of(true)],
      selection: { anchor: 4 },
    })
    const { view, calls } = fakeView(state)
    expect(commandOn('enter_twice', 'para\n\nnext')(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('queryOf 返回 null（反查失败/查询面缺席）→ 透传（#5 拒绝口径同源）', () => {
    const { view, calls } = fakeView(stateAt('para\n\nnext', 4))
    const command = createStrictEnterCommand({
      isEnabled: () => true,
      mode: () => 'enter_twice',
      queryOf: () => null,
    })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('引用行 two_space 终态：行尾两空格 + 新引用前缀行（光标行尾口径）', () => {
    const state = stateAt('> quote text\nplain', 12)
    const plan = planOf('> quote text\nplain', 12, 'two_space')!
    const tr = state.update({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
    })
    expect(tr.state.doc.toString()).toBe('> quote text  \n> \nplain')
    expect(tr.state.doc.lineAt(tr.state.selection.main.head).text).toBe('> ')
  })
})

// ============================================================
// 设置门：strictModeEnter + strictLineMode 双值缓存
// ============================================================

describe('设置门 createStrictEnterGate：生效值缓存', () => {
  function channelOf(result: unknown, ok = true): VsidianAddonPageSdk['channel'] {
    return {
      request: async () =>
        ok ? { ok: true, result } : ({ ok: false, reason: 'rejected' } as AddonChannelOutcome),
    }
  }

  it('初始关闭 + 默认 enter_twice（通道返回前不翻转出厂默认）', () => {
    const gate = createStrictEnterGate(channelOf(null))
    expect(gate.enabled()).toBe(false)
    expect(gate.mode()).toBe('enter_twice')
  })

  it('refresh 命中 effective.strictModeEnter=true + strictLineMode=two_space', async () => {
    const gate = createStrictEnterGate(
      channelOf({ effective: { strictModeEnter: true, strictLineMode: 'two_space' } }),
    )
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
    expect(gate.mode()).toBe('two_space')
  })

  it('refresh 返回 strictModeEnter=false → 关', async () => {
    const gate = createStrictEnterGate(
      channelOf({ effective: { strictModeEnter: false, strictLineMode: 'mix_mode' } }),
    )
    await gate.refresh()
    expect(gate.enabled()).toBe(false)
    expect(gate.mode()).toBe('mix_mode')
  })

  it('通道失败 → 保持上次值（fail-safe 不翻转）', async () => {
    let ok = true
    const gate = createStrictEnterGate({
      request: async () =>
        ok
          ? { ok: true, result: { effective: { strictModeEnter: true, strictLineMode: 'two_space' } } }
          : ({ ok: false, reason: 'timeout' } as AddonChannelOutcome),
    })
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
    ok = false
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
    expect(gate.mode()).toBe('two_space')
  })

  it('载荷形态异常（缺 effective / 非 boolean / 非法模式值）→ 关 + 模式保持上次', async () => {
    const gate = createStrictEnterGate(channelOf({ values: {} }))
    await gate.refresh()
    expect(gate.enabled()).toBe(false)
    const wrongType = createStrictEnterGate(
      channelOf({ effective: { strictModeEnter: 'yes', strictLineMode: 'magic' } }),
    )
    await wrongType.refresh()
    expect(wrongType.enabled()).toBe(false)
    expect(wrongType.mode()).toBe('enter_twice')
  })

  it('消费 #3 的设置通道 topic 常量（不自建第二份协议）', async () => {
    const seen: string[] = []
    const gate = createStrictEnterGate({
      request: async (topic) => {
        seen.push(topic)
        return { ok: true, result: { effective: { strictModeEnter: true } } }
      },
    })
    await gate.refresh()
    expect(seen).toEqual([SETTINGS_TOPIC.get])
  })
})
