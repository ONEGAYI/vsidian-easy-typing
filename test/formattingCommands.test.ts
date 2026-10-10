// 格式化命令族测试（工单 #28）：五命令契约（注册形状/键位规范序）、
// 行分类跳过口径、四 planner 的真实 EditorState 状态迁移断言（上游
// formatting_commands.ts 逐条对照）、handler 执行流（目标句柄视图派发
// 单事务 / 主正文句柄快照提交 / 文件排除 / 切换设置写回）。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { TransactionSpec } from '@codemirror/state'
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
import {
  buildConvertCodeBlockCommandDefinition,
  buildDeleteBlankLinesCommandDefinition,
  buildFormatArticleCommandDefinition,
  buildFormatSelectionCommandDefinition,
  buildToggleAutoFormatCommandDefinition,
  classifyFormatSkipLines,
  CONVERT_CODE_BLOCK_COMMAND_ID,
  CONVERT_CODE_BLOCK_DEFAULT_BINDINGS,
  DELETE_BLANK_LINES_COMMAND_ID,
  DELETE_BLANK_LINES_DEFAULT_BINDINGS,
  FORMAT_ARTICLE_COMMAND_ID,
  FORMAT_ARTICLE_DEFAULT_BINDINGS,
  FORMAT_SELECTION_COMMAND_ID,
  FORMAT_SELECTION_DEFAULT_BINDINGS,
  planConvertCodeBlock,
  planDeleteBlankLines,
  planFormatArticle,
  planFormatSelection,
  registerFormattingCommands,
  TOGGLE_AUTO_FORMAT_COMMAND_ID,
  TOGGLE_AUTO_FORMAT_DEFAULT_BINDINGS,
  type FormattingCommandRegistration,
  type FormattingNoticeRequest,
} from '../src/formattingCommands'
import { createEditorViewRegistry, type EditorViewRegistry } from '../src/plainPasteCommand'
import {
  defaultAutoFormatEngineSettings,
  type AutoFormatEngineSettings,
  type AutoFormatGate,
} from '../src/autoFormatIntercept'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { pickMessages } from '../src/i18n'

/** 出厂默认行格式化设置（语言对中英/中数/数英；autoCapital 默认关） */
const SETTINGS = defaultAutoFormatEngineSettings().lineFormat

/** 规范修饰键序（vsidian normalizeChord 归一序：ctrl→alt→shift→meta） */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta']

function isCanonicalChord(chord: string): boolean {
  return chord.split(' ').every((step) => {
    const parts = step.split('+')
    const modifiers = parts.slice(0, -1)
    const indices = modifiers.map((m) => MODIFIER_ORDER.indexOf(m))
    return (
      indices.every((i) => i >= 0) &&
      indices.every((i, k) => k === 0 || indices[k - 1]! < i) &&
      parts.length === modifiers.length + 1
    )
  })
}

// ===== 命令定义契约 =====

describe('命令定义契约（稳定 API 注册形状）', () => {
  it('五命令局部 id 无点号；格式化类 live+writes，切换类 both+非写', () => {
    expect(buildFormatArticleCommandDefinition('t')).toMatchObject({
      id: FORMAT_ARTICLE_COMMAND_ID,
      mode: 'live',
      writes: true,
    })
    expect(buildFormatSelectionCommandDefinition('t')).toMatchObject({
      id: FORMAT_SELECTION_COMMAND_ID,
      mode: 'live',
      writes: true,
    })
    expect(buildDeleteBlankLinesCommandDefinition('t')).toMatchObject({
      id: DELETE_BLANK_LINES_COMMAND_ID,
      mode: 'live',
      writes: true,
    })
    expect(buildToggleAutoFormatCommandDefinition('t')).toMatchObject({
      id: TOGGLE_AUTO_FORMAT_COMMAND_ID,
      mode: 'both',
      writes: false,
    })
    expect(buildConvertCodeBlockCommandDefinition('t')).toMatchObject({
      id: CONVERT_CODE_BLOCK_COMMAND_ID,
      mode: 'live',
      writes: true,
    })
    for (const id of [
      FORMAT_ARTICLE_COMMAND_ID,
      FORMAT_SELECTION_COMMAND_ID,
      DELETE_BLANK_LINES_COMMAND_ID,
      TOGGLE_AUTO_FORMAT_COMMAND_ID,
      CONVERT_CODE_BLOCK_COMMAND_ID,
    ]) {
      expect(id).not.toContain('.')
    }
  })

  it('默认键位：三命令沿用上游弦（规范序 mac 形态避开 #417）；两命令默认未绑定', () => {
    expect(FORMAT_ARTICLE_DEFAULT_BINDINGS).toEqual(['ctrl+shift+s', 'shift+meta+s'])
    expect(DELETE_BLANK_LINES_DEFAULT_BINDINGS).toEqual(['ctrl+shift+k', 'shift+meta+k'])
    expect(CONVERT_CODE_BLOCK_DEFAULT_BINDINGS).toEqual(['ctrl+shift+n', 'shift+meta+n'])
    // format-selection：上游 Mod+Shift+L 与平台内置 findAllOccurrences（#238
    // 默认 ctrl+shift+l，内置先于运行期命令路由）同弦结构性遮蔽 → 默认未绑定
    expect(FORMAT_SELECTION_DEFAULT_BINDINGS).toEqual([])
    // toggle：上游 Ctrl+Tab 被 #125 Tab 固定链注册期拒绝（tab-forbidden）
    expect(TOGGLE_AUTO_FORMAT_DEFAULT_BINDINGS).toEqual([])
    for (const chord of [
      ...FORMAT_ARTICLE_DEFAULT_BINDINGS,
      ...DELETE_BLANK_LINES_DEFAULT_BINDINGS,
      ...CONVERT_CODE_BLOCK_DEFAULT_BINDINGS,
    ]) {
      expect(isCanonicalChord(chord), chord).toBe(true)
      expect(chord.includes('tab')).toBe(false) // Tab 固定链注册期即拒
    }
  })

  it('默认键位与 #12 纯文本粘贴（ctrl+shift+v / shift+meta+v）零重叠；五命令两两不重叠', () => {
    const ours = [
      ...FORMAT_ARTICLE_DEFAULT_BINDINGS,
      ...FORMAT_SELECTION_DEFAULT_BINDINGS,
      ...DELETE_BLANK_LINES_DEFAULT_BINDINGS,
      ...TOGGLE_AUTO_FORMAT_DEFAULT_BINDINGS,
      ...CONVERT_CODE_BLOCK_DEFAULT_BINDINGS,
    ]
    for (const chord of ours) {
      expect(chord === 'ctrl+shift+v' || chord === 'shift+meta+v').toBe(false)
    }
    expect(new Set(ours).size).toBe(ours.length)
  })
})

// ===== 行分类（跳过口径） =====

describe('classifyFormatSkipLines：跳过口径（文本降级单遍）', () => {
  it('frontmatter 全区跳过（含首尾边界）；非 --- 起始无 frontmatter', () => {
    expect(classifyFormatSkipLines(['---', 'title: x', '---', '正文a'])).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(classifyFormatSkipLines(['正文', '---', 'x', '---'])).toEqual([false, false, false, false])
  })

  it('围栏代码块跳过（标记行与内容行；~~~ 与加长关栏；信息串只认开栏）', () => {
    expect(classifyFormatSkipLines(['```js', 'const a=1', '````', '正文a'])).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(classifyFormatSkipLines(['~~~', 'x', '~~~', '正文a'])).toEqual([true, true, true, false])
  })

  it('块级公式跳过（跨行 $$ 与单行完整 $$...$$）；行内 $ 混排文本不跳过', () => {
    expect(classifyFormatSkipLines(['$$', 'x=1', '$$', '中文$x$a'])).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(classifyFormatSkipLines(['$$x=1$$', '中文a'])).toEqual([true, false])
  })

  it('表格行跳过（含引用块内表格）；单个 | 的行不跳过', () => {
    expect(classifyFormatSkipLines(['|表a|格|', '--- | ---', '中文a', '> |引a|用|', 'a | b'])).toEqual(
      [true, true, false, true, false],
    )
  })
})

// ===== planner：真实 EditorState 状态迁移断言 =====

/** 计划应用到真实 EditorState（单事务——命令派发的撤销单位） */
function applyPlan(
  doc: string,
  plan: {
    changes: ReadonlyArray<{ offset: number; length: number; text: string }>
    selection?: { anchor: number; head: number }
  },
) {
  const state = EditorState.create({ doc })
  const tr = state.update({
    changes: plan.changes.map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text })),
    ...(plan.selection !== undefined
      ? { selection: { anchor: plan.selection.anchor, head: plan.selection.head } }
      : {}),
  })
  return { text: tr.state.doc.toString(), selection: tr.state.selection.main }
}

describe('planFormatArticle：格式化全文（上游 formatArticle）', () => {
  it('逐行整行重排；代码块/表格行跳过；光标随插入空格平移', () => {
    const doc = '中文a\n```\ncode内x\n```\n|表a|格|\n中文b'
    const cursor = doc.length // 行尾
    const plan = planFormatArticle(doc, cursor, cursor, SETTINGS)
    expect(plan).not.toBeNull()
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('中文 a\n```\ncode内x\n```\n|表a|格|\n中文 b')
    expect(selection.head).toBe(text.length)
  })

  it('autoCapital 强制关（上游 {...settings, AutoCapital: false}）：句首不大写', () => {
    const plan = planFormatArticle('abc. def', 8, 8, { ...SETTINGS, autoCapital: true })
    expect(plan).toBeNull() // 无变更即不派发
  })

  it('无变更返回 null', () => {
    expect(planFormatArticle('中文 a', 4, 4, SETTINGS)).toBeNull()
  })
})

describe('planFormatSelection：格式化选区/当前行（上游 formatSelectionOrCurLine）', () => {
  it('无选区 = 光标行；光标 ch 跟踪（上游光标行传真实 ch）', () => {
    const doc = '中文abc'
    const plan = planFormatSelection(doc, 3, 3, SETTINGS) // 光标在 abc 词内
    expect(plan).not.toBeNull()
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('中文 abc')
    expect(selection.head).toBe(4) // 插入空格后光标随词头（'中文 a|bc'）
  })

  it('选区跨行：区间行逐行重排（区间内代码行跳过），前向整区间全选恢复', () => {
    const doc = '中文a\n```\ncode\n```\n中文b'
    const plan = planFormatSelection(doc, 0, doc.length, SETTINGS)
    expect(plan).not.toBeNull()
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('中文 a\n```\ncode\n```\n中文 b')
    expect(selection.anchor).toBe(0)
    expect(selection.head).toBe(text.length)
  })

  it('同行选区恢复为整行反向全选（上游 L86-91 怪癖原样保留）', () => {
    const doc = '中文ab'
    const plan = planFormatSelection(doc, 2, 4, SETTINGS) // 前向选 'ab'
    expect(plan).not.toBeNull()
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('中文 ab')
    expect(selection.anchor).toBe(text.length) // anchor 侧行尾
    expect(selection.head).toBe(0) // head 侧行首——反向
  })

  it('反向跨行选区：anchor 侧行尾 → head 侧行首', () => {
    const doc = '中文a\n中文b'
    const plan = planFormatSelection(doc, doc.length, 0, SETTINGS)
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('中文 a\n中文 b')
    expect(selection.anchor).toBe(text.length)
    expect(selection.head).toBe(0)
  })

  it('区间全为跳过行或无变更 → null', () => {
    expect(planFormatSelection('|表a|格|', 0, 0, SETTINGS)).toBeNull()
    expect(planFormatSelection('中文 a', 0, 7, SETTINGS)).toBeNull()
  })
})

describe('planDeleteBlankLines：删除空行（上游 deleteBlankLines，strict 恒 true）', () => {
  it('段落间单空行保留（CommonMark 严格换行映射）；连续空行收敛为一', () => {
    expect(planDeleteBlankLines('p1\n\np2', 0, 0)).toBeNull() // 单空行 = 段落结构
    const doc = 'p1\n\n\np2'
    const plan = planDeleteBlankLines(doc, 0, 0)
    expect(plan).not.toBeNull()
    expect(applyPlan(doc, plan!).text).toBe('p1\n\np2')
  })

  it('空行 = 只含空白也算（上游 /^\\s*$/ 语义核实）', () => {
    const doc = 'p1\n \t \n \t \np2'
    const plan = planDeleteBlankLines(doc, 0, 0)
    expect(plan).not.toBeNull()
    expect(applyPlan(doc, plan!).text).toBe('p1\n \t \np2')
  })

  it('同类块（列表/列表）间空行删除；异类块（列表/引用）间保留', () => {
    const same = '- a\n\n- b'
    expect(applyPlan(same, planDeleteBlankLines(same, 0, 0)!).text).toBe('- a\n- b')
    expect(planDeleteBlankLines('- a\n\n> b', 0, 0)).toBeNull()
  })

  it('块 id 行后空行保留；水平线前被删空行回保', () => {
    expect(planDeleteBlankLines('段落 ^blockid\n\nnext', 0, 0)).toBeNull()
    // 三空行收敛为二：第 2 空行删除后被水平线回保（pop），仅第 2 空行前的
    // 首个保留 + 回保者之外的一条被删（上游 L235-237 pop 语义）
    const doc = 'x\n\n\n\n---'
    const plan = planDeleteBlankLines(doc, 0, 0)
    expect(applyPlan(doc, plan!).text).toBe('x\n\n\n---')
  })

  it('选区模式：只扫选区行，域外空行不动', () => {
    const doc = 'a\n\n\nb\n\nc'
    const head = doc.indexOf('b') + 1 // 覆盖到 'b'（行 0-3）
    const plan = planDeleteBlankLines(doc, 0, head)
    expect(plan).not.toBeNull()
    expect(applyPlan(doc, plan!).text).toBe('a\n\nb\n\nc')
  })

  it('单空行文档保留（严格模式结构行）；双空行文档收敛为一；无可删返回 null', () => {
    // 严格映射下唯一空行是结构行不删；连续空行才收敛
    expect(planDeleteBlankLines('   ', 0, 0)).toBeNull()
    expect(applyPlan('  \n  ', planDeleteBlankLines('  \n  ', 0, 0)!).text).toBe('  ')
    expect(planDeleteBlankLines('a\nb', 0, 0)).toBeNull()
  })
})

describe('planConvertCodeBlock：选区转代码块（上游 convert2CodeBlock）', () => {
  it('整行选区：围栏包裹、无前后补行、光标落语言位 ch3（默认空语言不询问）', () => {
    const doc = 'xx中文a'
    const plan = planConvertCodeBlock(doc, 0, doc.length)
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('```\nxx中文a\n```')
    expect(selection.head).toBe(3)
  })

  it('行中选区：前后补 \\n 隔离；光标 = 围栏行语言位', () => {
    const doc = 'aaBBcc'
    const plan = planConvertCodeBlock(doc, 2, 4)
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('aa\n```\nBB\n```\ncc')
    expect(selection.head).toBe(6) // 'aa\\n```|'
  })

  it('无选区：插入空围栏骨架（光标行中同样前后补行）', () => {
    const doc = 'abcd'
    const plan = planConvertCodeBlock(doc, 2, 2)
    const { text, selection } = applyPlan(doc, plan!)
    expect(text).toBe('ab\n```\n```\ncd')
    expect(selection.head).toBe(6)
  })
})

// ===== handler 执行流 =====

/** 模拟 view：真实 EditorState + dispatch 捕获（对齐 modaIntercept 测试模式） */
function fakeCmdView(options: {
  doc: string
  anchor: number
  head?: number
  compositionStarted?: boolean
  readOnly?: boolean
}): { view: EditorView; specs: TransactionSpec[] } {
  const state = EditorState.create({
    doc: options.doc,
    ...(options.readOnly ? { extensions: [EditorState.readOnly.of(true)] } : {}),
    selection: { anchor: options.anchor, head: options.head ?? options.anchor },
  })
  const specs: TransactionSpec[] = []
  const view = {
    id: 'main',
    state,
    compositionStarted: options.compositionStarted ?? false,
    dispatch: (spec: TransactionSpec) => {
      specs.push(spec)
    },
  } as unknown as EditorView
  return { view, specs }
}

/** 设置门替身（固定引擎配置） */
function stubGate(engine: Partial<AutoFormatEngineSettings> = {}): AutoFormatGate {
  const current: AutoFormatEngineSettings = { ...defaultAutoFormatEngineSettings(), ...engine }
  return {
    settings: () => current,
    refresh: async () => {},
  }
}

/** 目标视图句柄替身（info 形状对齐 AddonViewInfo；快照/写回捕获） */
function fakeTargetHandle(
  entry: { id: string; uri: string; text: string; editable?: boolean; sel?: number },
): {
  handle: AddonViewHandle
  applyEditsCalls: Array<{
    instanceId: string
    request: { revision: number; changes: unknown; selection?: unknown; history?: string }
  }>
} {
  const applyEditsCalls: Array<{
    instanceId: string
    request: { revision: number; changes: unknown; selection?: unknown; history?: string }
  }> = []
  const handle: AddonViewHandle = {
    info: {
      instanceId: entry.id,
      targetDocUri: entry.uri,
      mode: 'live',
      viewType: entry.id === 'main' ? 'main' : 'embed',
      editable: entry.editable ?? true,
    },
    editor: {
      getSnapshot: () => ({
        ok: true as const,
        snapshot: {
          text: entry.text,
          selections: [{ anchor: entry.sel ?? 0, head: entry.sel ?? 0 }],
          version: 1,
          revision: 7,
        },
      }),
      applyEdits: (request: {
        revision: number
        changes: unknown
        selection?: unknown
        history?: string
      }) => {
        applyEditsCalls.push({ instanceId: entry.id, request })
        return Promise.resolve({ ok: true as const, credential: {} })
      },
    } as AddonViewHandle['editor'],
  }
  return { handle, applyEditsCalls }
}

/** commands 面替身（可选拒绝集合模拟注册失败） */
function fakeCommands(rejectIds: ReadonlySet<string> = new Set()) {
  const defs: Array<{ def: { id: string }; handler: (target: AddonViewHandle | null) => void }> = []
  const disposed: string[] = []
  const facet = {
    register: (def: { id: string }, handler: (target: AddonViewHandle | null) => void) => {
      if (rejectIds.has(def.id)) {
        return { ok: false, reason: 'duplicate-command', dispose: () => {} }
      }
      defs.push({ def, handler })
      return { ok: true, commandId: `ONEGAYI.vsidian-easy-typing.${def.id}`, dispose: () => disposed.push(def.id) }
    },
  }
  return { facet, defs, disposed }
}

/** handler 级组装：注册 + 视图登记 + 通道/通知捕获 */
function harness(options: {
  engine?: Partial<AutoFormatEngineSettings>
  views?: EditorViewRegistry
}) {
  const commands = fakeCommands()
  const channelCalls: Array<{ topic: string; payload: unknown }> = []
  const notices: FormattingNoticeRequest[] = []
  const registration = registerFormattingCommands({
    commands: commands.facet,
    channel: {
      request: (topic, payload) => {
        channelCalls.push({ topic, payload })
        return Promise.resolve({ ok: true, result: null })
      },
    },
    gate: stubGate(options.engine),
    views: options.views ?? createEditorViewRegistry((view) => (view as unknown as { id?: string }).id ?? null),
    notify: (request) => notices.push(request),
    messages: pickMessages('zh-CN'),
  })
  const handlerOf = (id: string): ((target: AddonViewHandle | null) => void) | undefined =>
    commands.defs.find((d) => d.def.id === id)?.handler
  return {
    outcomes: registration.outcomes as readonly FormattingCommandRegistration[],
    handlerOf,
    notices,
    channelCalls,
    disposed: commands.disposed,
    dispose: registration.dispose,
  }
}

/** 微任务冲刷（refresh().then 链落定） */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('registerFormattingCommands：注册面', () => {
  it('五命令注册全 ok（默认绑定随定义）；dispose 逐命令注销', () => {
    const h = harness({})
    expect(h.outcomes.map((o) => o.localId)).toEqual([
      FORMAT_ARTICLE_COMMAND_ID,
      FORMAT_SELECTION_COMMAND_ID,
      DELETE_BLANK_LINES_COMMAND_ID,
      TOGGLE_AUTO_FORMAT_COMMAND_ID,
      CONVERT_CODE_BLOCK_COMMAND_ID,
    ])
    expect(h.outcomes.every((o) => o.ok)).toBe(true)
    h.dispose()
    expect(h.disposed).toHaveLength(5)
  })

  it('单命令注册失败记录 ok:false 不是故障（其余继续）', () => {
    const commands = fakeCommands(new Set([FORMAT_ARTICLE_COMMAND_ID]))
    const registration = registerFormattingCommands({
      commands: commands.facet,
      channel: { request: () => Promise.resolve({ ok: true, result: null }) },
      gate: stubGate(),
      views: createEditorViewRegistry(() => null),
      messages: pickMessages('zh-CN'),
    })
    expect(registration.outcomes.find((o) => o.localId === FORMAT_ARTICLE_COMMAND_ID)).toMatchObject({
      ok: false,
      reason: 'duplicate-command',
    })
    expect(registration.outcomes.filter((o) => o.ok)).toHaveLength(4)
  })
})

describe('视图命令执行流：目标句柄视图单事务派发', () => {
  function harnessWithView(options: {
    doc: string
    anchor: number
    head?: number
    uri?: string
    engine?: Partial<AutoFormatEngineSettings>
    viewOverrides?: { compositionStarted?: boolean; readOnly?: boolean }
  }) {
    const registry = createEditorViewRegistry((view) => (view as unknown as { id: string }).id)
    const { view, specs } = fakeCmdView({
      doc: options.doc,
      anchor: options.anchor,
      head: options.head,
      ...options.viewOverrides,
    })
    registry.register(view)
    const { handle } = fakeTargetHandle({
      id: 'main',
      uri: options.uri ?? 'file:///v/free/a.md',
      text: options.doc,
    })
    const h = harness({ engine: options.engine, views: registry })
    return { view, specs, handle, ...h }
  }

  it('格式化全文：单事务派发（撤销一步还原）+ 真实 EditorState 状态迁移', async () => {
    const doc = '中文a\n中文b'
    const { view, specs, handle, handlerOf } = harnessWithView({ doc, anchor: doc.length })
    handlerOf(FORMAT_ARTICLE_COMMAND_ID)!(handle)
    await flush()
    expect(specs).toHaveLength(1) // 单笔事务 = 单撤销单位（票面验收）
    const tr = view.state.update(specs[0]!)
    expect(tr.state.doc.toString()).toBe('中文 a\n中文 b')
    let rangeCount = 0
    tr.changes.iterChanges(() => {
      rangeCount++
    })
    expect(rangeCount).toBe(2) // 两行替换在同一事务（非逐行多事务）
    expect((specs[0]! as { userEvent?: string }).userEvent).toBe('input.easyTyping.formatArticle')
  })

  it('文件排除命中（句柄 targetDocUri 权威归属）：不派发 + command-file-excluded 通知', async () => {
    const doc = '中文a'
    const { specs, handle, handlerOf, notices } = harnessWithView({
      doc,
      anchor: 0,
      uri: 'file:///v/DailyNote/a.md',
      engine: { excludeFiles: ['DailyNote/'] },
    })
    handlerOf(FORMAT_ARTICLE_COMMAND_ID)!(handle)
    await flush()
    expect(specs).toHaveLength(0)
    expect(notices).toEqual([{ kind: 'command-file-excluded' }])
  })

  it('IME 组合中 / 只读视图：不派发不通知', async () => {
    for (const viewOverrides of [{ compositionStarted: true }, { readOnly: true }] as const) {
      const { specs, handle, handlerOf, notices } = harnessWithView({
        doc: '中文a',
        anchor: 0,
        viewOverrides,
      })
      handlerOf(FORMAT_SELECTION_COMMAND_ID)!(handle)
      await flush()
      expect(specs).toHaveLength(0)
      expect(notices).toHaveLength(0)
    }
  })

  it('目标为嵌入实例句柄（扩展槽未装配、登记面外）→ 无动作：不派发不走句柄回退，不误写主文档', async () => {
    // 嵌入实例无本组件扩展实例（平台装配契约），登记表解析不到视图；
    // 句柄路径仅服务主正文句柄，嵌入目标不向主文档兜底
    const registry = createEditorViewRegistry((view) => (view as unknown as { id: string }).id)
    const { view: main, specs } = fakeCmdView({ doc: '中文a', anchor: 0 })
    registry.register(main)
    const { handle: embedHandle, applyEditsCalls } = fakeTargetHandle({
      id: 'embed:host-1',
      uri: 'file:///v/free/b.md',
      text: '中文b',
    })
    const h = harness({ views: registry })
    h.handlerOf(FORMAT_ARTICLE_COMMAND_ID)!(embedHandle)
    await flush()
    expect(specs).toHaveLength(0)
    expect(applyEditsCalls).toHaveLength(0)
  })

  it('执行链路异常（gate.refresh reject）→ .catch 吞掉：命令可重试，不产生 unhandledrejection（审查 C-P3-2）', async () => {
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const gate: AutoFormatGate = {
        settings: () => defaultAutoFormatEngineSettings(),
        refresh: async () => {
          throw new Error('gate channel broken')
        },
      }
      const commands = fakeCommands()
      registerFormattingCommands({
        commands: commands.facet,
        channel: { request: () => Promise.resolve({ ok: true, result: null }) },
        gate,
        views: createEditorViewRegistry(() => null),
        messages: pickMessages('zh-CN'),
      })
      const handler = commands.defs.find((d) => d.def.id === FORMAT_ARTICLE_COMMAND_ID)!.handler
      handler(null) // void refresh().then(...) 无 .catch → unhandledrejection 防回归
      await flush()
      await flush()
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('切换自动格式化：读现值 → 写 user 层翻转 → 通知新状态（不经视图）', async () => {
    const h = harness({})
    h.handlerOf(TOGGLE_AUTO_FORMAT_COMMAND_ID)!(null)
    await flush()
    const update = h.channelCalls.find((c) => c.topic === SETTINGS_TOPIC.update)
    expect(update?.payload).toEqual({ scope: 'user', patch: { autoFormat: false } }) // 默认开 → 翻转关
    expect(h.notices).toEqual([{ kind: 'auto-format-toggled', enabled: false }])
  })

  it('切换写入失败：不通知（静默，命令可重试）', async () => {
    const commands = fakeCommands()
    const failed = { ok: false as const, reason: 'rejected' }
    const notices: FormattingNoticeRequest[] = []
    registerFormattingCommands({
      commands: commands.facet,
      channel: { request: () => Promise.resolve(failed) },
      gate: stubGate(),
      views: createEditorViewRegistry(() => null),
      notify: (request) => notices.push(request),
      messages: pickMessages('zh-CN'),
    })
    commands.defs.find((d) => d.def.id === TOGGLE_AUTO_FORMAT_COMMAND_ID)!.handler(null)
    await flush()
    expect(notices).toHaveLength(0)
  })
})

describe('句柄路径：登记面外的主正文句柄快照提交', () => {
  it('登记表无视图（如命令在视图构造前触发）→ 目标句柄快照 → applyEdits 单请求（atomic）', async () => {
    const { handle, applyEditsCalls } = fakeTargetHandle({
      id: 'main',
      uri: 'file:///v/free/a.md',
      text: '中文a\n中文b',
      sel: 7,
    })
    const h = harness({})
    h.handlerOf(FORMAT_ARTICLE_COMMAND_ID)!(handle)
    await flush()
    expect(applyEditsCalls).toHaveLength(1)
    expect(applyEditsCalls[0]!.instanceId).toBe('main')
    expect(applyEditsCalls[0]!.request.history).toBe('atomic')
    expect(applyEditsCalls[0]!.request.revision).toBe(7)
    // 快照文本逐行重排（两行都在同一请求内）
    const payload = JSON.stringify(applyEditsCalls[0]!.request.changes)
    expect(payload).toContain('中文 a')
    expect(payload).toContain('中文 b')
  })

  it('句柄目标排除命中：不写回 + 通知', async () => {
    const { handle, applyEditsCalls } = fakeTargetHandle({
      id: 'main',
      uri: 'file:///v/DailyNote/a.md',
      text: '中文a',
    })
    const h = harness({ engine: { excludeFiles: ['DailyNote/'] } })
    h.handlerOf(CONVERT_CODE_BLOCK_COMMAND_ID)!(handle)
    await flush()
    expect(applyEditsCalls).toHaveLength(0)
    expect(h.notices).toEqual([{ kind: 'command-file-excluded' }])
  })

  it('无活动视图（target null）→ 静默无动作（不抛错）', async () => {
    const commands = fakeCommands()
    registerFormattingCommands({
      commands: commands.facet,
      channel: { request: () => Promise.resolve({ ok: true, result: null }) },
      gate: stubGate(),
      views: createEditorViewRegistry(() => null),
      messages: pickMessages('zh-CN'),
    })
    expect(() =>
      commands.defs.find((d) => d.def.id === DELETE_BLANK_LINES_COMMAND_ID)!.handler(null),
    ).not.toThrow()
    await flush()
  })
})
