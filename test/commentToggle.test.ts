// 注释切换单元测试（工单 #2）——三层承载：注释符表矩阵（上游 25 键逐条
// 钉住）、行注释切换纯函数矩阵（单行符/块符/空白行三态，上游
// comment_toggle.ts:64-128 逐形态对照）、决策单元（真实 EditorState 驱动
// 代码块语言感知与 Markdown %% 语义，含 3+ 语言端到端抽查——矩阵承载，
// 浏览器真实键盘归 #21）+ 命令注册契约（稳定 API 形状与默认键位规范序）。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
import {
  buildToggleCommentCommandDefinition,
  COMMENT_SYMBOLS,
  createToggleCommentCommandHandler,
  getCommentSymbol,
  planCommentToggle,
  planLineCommentToggle,
  TOGGLE_COMMENT_COMMAND_ID,
  TOGGLE_COMMENT_DEFAULT_BINDINGS,
} from '../src/commentToggle'
import { createEditorViewRegistry } from '../src/plainPasteCommand'

/** 规范修饰键序（vsidian normalizeChord 归一序：ctrl→alt→shift→meta） */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta']

/** 每个默认绑定必须已是规范序书写（避开 vsidian#417 的永不命中形态） */
function isCanonicalChord(chord: string): boolean {
  return chord.split(' ').every((step) => {
    const parts = step.split('+')
    const modifiers = parts.slice(0, -1)
    const indices = modifiers.map((m) => MODIFIER_ORDER.indexOf(m))
    return indices.every((i) => i >= 0) &&
      indices.every((i, k) => k === 0 || indices[k - 1]! < i) &&
      parts.length === modifiers.length + 1
  })
}

/** CSS 块符对（矩阵共用） */
const CSS = { start: '/*', end: '*/' } as const

/** 决策并应用计划到真实状态，返回结果文本与主光标（head）落点 */
function applyPlan(doc: string, anchor: number, head = anchor): { doc: string; head: number } {
  const state = EditorState.create({ doc, selection: { anchor, head } })
  const plan = planCommentToggle(state)
  expect(plan).not.toBeNull()
  const tr = state.update({
    changes: plan!.changes,
    ...(plan!.selection !== undefined ? { selection: plan!.selection } : {}),
  })
  return { doc: tr.state.doc.toString(), head: tr.state.selection.main.head }
}

// ---------------------------------------------------------------- 符号表

describe('注释符表（上游 26 键逐条移植钉住）', () => {
  it('表内容与上游 getCommentSymbol 内联表逐键一致', () => {
    expect({ ...COMMENT_SYMBOLS }).toEqual({
      js: '//',
      javascript: '//',
      ts: '//',
      typescript: '//',
      py: '#',
      python: '#',
      rb: '#',
      ruby: '#',
      java: '//',
      c: '//',
      cpp: '//',
      cs: '//',
      go: '//',
      rust: '//',
      swift: '//',
      kotlin: '//',
      php: '//',
      css: CSS,
      scss: CSS,
      sql: '--',
      shell: '#',
      bash: '#',
      powershell: '#',
      html: { start: '<!--', end: '-->' },
      matlab: '%',
      markdown: { start: '%%', end: '%%' },
    })
    expect(Object.keys(COMMENT_SYMBOLS)).toHaveLength(26)
  })

  it('getCommentSymbol：大小写归一、别名同符、未知语言 null', () => {
    expect(getCommentSymbol('Python')).toBe('#')
    expect(getCommentSymbol('JS')).toBe('//')
    expect(getCommentSymbol('javascript')).toBe('//')
    expect(getCommentSymbol('xyz')).toBeNull()
    expect(getCommentSymbol('')).toBeNull()
  })
})

// ------------------------------------------------- 行注释切换（纯函数矩阵）

describe('行注释切换矩阵（planLineCommentToggle，上游 64-128 行逐形态）', () => {
  describe('单行注释符', () => {
    it.each([
      ['js', '//'],
      ['python', '#'],
      ['sql', '--'],
      ['matlab', '%'],
    ] as const)('无注释行 → 缩进后插入「符号 + 空格」（%s）', (_lang, symbol) => {
      expect(planLineCommentToggle(0, 6, 'let a', symbol)).toEqual({
        from: 0,
        to: 0,
        insert: symbol + ' ',
      })
    })

    it('缩进行 → 插入点在缩进之后（保留缩进）', () => {
      expect(planLineCommentToggle(0, 8, '  let a', '//')).toEqual({ from: 2, to: 2, insert: '// ' })
    })

    it('已注释行（带尾空格）→ 移除「符号 + 一个空格」', () => {
      expect(planLineCommentToggle(0, 6, '// let', '//')).toEqual({ from: 0, to: 3, insert: '' })
    })

    it('已注释行（无尾空格）→ 只移除符号', () => {
      expect(planLineCommentToggle(0, 5, '//let', '//')).toEqual({ from: 0, to: 2, insert: '' })
    })

    it('已注释行带缩进 → 移除点跟随实际符号位置（缩进保留）', () => {
      expect(planLineCommentToggle(0, 8, '  // x', '//')).toEqual({ from: 2, to: 5, insert: '' })
    })

    it('行中段出现符号但行首无符号 → 按无注释行插入（startsWith 判定）', () => {
      expect(planLineCommentToggle(0, 18, 'https://example.com', '//')).toEqual({
        from: 0,
        to: 0,
        insert: '// ',
      })
    })
  })

  describe('块注释符对', () => {
    it('无注释行 → 缩进后整行包裹「start␣text␣end」', () => {
      expect(planLineCommentToggle(0, 10, 'color: red', CSS)).toEqual({
        from: 0,
        to: 10,
        insert: '/* color: red */',
      })
    })

    it('缩进行 → 包裹起点在缩进之后', () => {
      expect(planLineCommentToggle(0, 8, '  color', CSS)).toEqual({
        from: 2,
        to: 8,
        insert: '/* color */',
      })
    })

    it('已包裹行 → 解包还原（start 后与 end 前各一个空格）', () => {
      expect(planLineCommentToggle(0, 13, '/* color: red */', CSS)).toEqual({
        from: 0,
        to: 13,
        insert: 'color: red',
      })
    })

    it('已包裹行带缩进 → 解包起点在缩进之后（缩进保留）', () => {
      expect(planLineCommentToggle(0, 9, '  /* x */', CSS)).toEqual({ from: 2, to: 9, insert: 'x' })
    })

    it('无空格包裹形态沿用上游切片口径（trim 后按固定位切片，已知边界）', () => {
      // 上游 trimmedText.slice(start.length+1, -end.length-1) 对 '/*foo*/'
      // 切出 'o'（按「start␣ / ␣end」位型切，不含空格时丢字符）——忠实移植
      expect(planLineCommentToggle(0, 7, '/*foo*/', CSS)).toEqual({ from: 0, to: 7, insert: 'o' })
    })

    it('尾随文本未被 end 收束 → 不算已包裹，二次包裹（上游口径）', () => {
      expect(planLineCommentToggle(0, 11, '/* x */ foo', CSS)).toEqual({
        from: 0,
        to: 11,
        insert: '/* /* x */ foo */',
      })
    })
  })

  describe('空白行三态', () => {
    it('空白行 + 光标（单行符）→ 光标处插入「符号 + 空格」，光标移到其后', () => {
      expect(planLineCommentToggle(5, 5, '', '//', 5)).toEqual({
        from: 5,
        to: 5,
        insert: '// ',
        selection: { anchor: 8, head: 8 },
      })
    })

    it('空白行 + 光标（块符）→ 光标处插入 start + 两空格 + end，光标在首空格后', () => {
      expect(planLineCommentToggle(5, 5, '', CSS, 5)).toEqual({
        from: 5,
        to: 5,
        insert: '/*  */',
        selection: { anchor: 8, head: 8 },
      })
    })

    it('纯空白行（空格/制表）同样按空白处理', () => {
      expect(planLineCommentToggle(5, 8, '   ', '//', 6)).toEqual({
        from: 6,
        to: 6,
        insert: '// ',
        selection: { anchor: 9, head: 9 },
      })
    })

    it('空白行无光标位置 → null（批量切换跳过该行）', () => {
      expect(planLineCommentToggle(0, 0, '', '//')).toBeNull()
      expect(planLineCommentToggle(0, 3, '   ', CSS)).toBeNull()
    })
  })
})

// ------------------------------------------------ Markdown %% 切换（决策）

describe('Markdown %% 切换（决策单元，上游 toggleMarkdownComment）', () => {
  it('空选区 → 插入 %%  两空格夹层，光标落层间（from+3）', () => {
    expect(applyPlan('abcd', 2)).toEqual({ doc: 'ab%%  %%cd', head: 5 })
  })

  it('空选区且光标正处 %%  %% 层间 → 整对删除，光标回退对首', () => {
    expect(applyPlan('ab%%  %%cd', 5)).toEqual({ doc: 'abcd', head: 2 })
  })

  it('空选区但光标不在正中 → 不删除，按插入处理（恰正中才配对删除）', () => {
    // 光标 4（层间偏左一格）：slice(1,7) = '%  %%' ≠ '%%  %%' → 插入路径
    expect(applyPlan('%%  %%', 4)).toEqual({ doc: '%%  %%  %%%%', head: 7 })
  })

  it('空文档光标 0 → 正常插入（from-3 读取经 CM6 钳制不越界）', () => {
    expect(applyPlan('', 0)).toEqual({ doc: '%%  %%', head: 3 })
  })

  it('选中文本 → 紧贴包裹 %%（无空格）', () => {
    expect(applyPlan('a foo b', 2, 5)).toEqual({ doc: 'a %%foo%% b', head: 9 })
  })

  it('选中已包裹文本 → 解包', () => {
    expect(applyPlan('a %%foo%% b', 2, 9)).toEqual({ doc: 'a foo b', head: 5 })
  })

  it('恰选 %% 两字符 → 删除（startsWith 与 endsWith 同侧命中）', () => {
    expect(applyPlan('%%', 0, 2)).toEqual({ doc: '', head: 0 })
  })
})

// --------------------------------------------- 代码块语言感知（决策 + 端到端）

describe('代码块语言感知端到端（决策单元，≥3 语言矩阵）', () => {
  it.each([
    ['python', '# '],
    ['js', '// '],
    ['sql', '-- '],
  ] as const)('%s 围栏内光标行：注释 ↔ 取消一去一回', (lang, prefix) => {
    const doc = '```' + lang + '\nx = 1\n```'
    const once = applyPlan(doc, doc.indexOf('\n') + 2) // 行内光标
    expect(once.doc).toBe('```' + lang + '\n' + prefix + 'x = 1\n```')
    const twice = applyPlan(once.doc, once.head)
    expect(twice.doc).toBe(doc)
  })

  it('css 块符对：包裹 ↔ 解包一去一回', () => {
    const doc = '```css\ncolor: red;\n```'
    const once = applyPlan(doc, 10)
    expect(once.doc).toBe('```css\n/* color: red; */\n```')
    const twice = applyPlan(once.doc, once.head)
    expect(twice.doc).toBe(doc)
  })

  it('html SGML 注释对（第 5 语言抽查）', () => {
    const doc = '```html\n<p>hi</p>\n```'
    const once = applyPlan(doc, 11)
    expect(once.doc).toBe('```html\n<!-- <p>hi</p> -->\n```')
  })

  it('光标在围栏内空白行 → 光标处插入「符号 + 空格」并把光标移入', () => {
    const doc = '```python\n\n```'
    expect(applyPlan(doc, 10)).toEqual({ doc: '```python\n# \n```', head: 12 })
  })

  it('未知语言与无信息串围栏 → 无操作（上游 return false 口径）', () => {
    for (const doc of ['```xyz\ncode\n```', '```\ncode\n```']) {
      const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('code') + 1 } })
      expect(planCommentToggle(state)).toBeNull()
    }
  })

  it('围栏标记行（开栏行）→ 走 Markdown %% 分支（#25 降级口径，与上游树版差异）', () => {
    const doc = '```python\nx = 1\n```'
    const state = EditorState.create({ doc, selection: { anchor: 4 } }) // 开栏行内
    const plan = planCommentToggle(state)
    expect(plan).not.toBeNull()
    expect(plan!.changes).toEqual([{ from: 4, to: 4, insert: '%%  %%' }])
  })

  it('正文（非代码块）→ Markdown %% 分支', () => {
    expect(applyPlan('hello', 2)).toEqual({ doc: 'he%%  %%llo', head: 5 })
  })

  it('多行选区 → 跨到的行逐行切换、空白行跳过、单事务承载', () => {
    const doc = '```python\naa\nbb\n\ncc\n```'
    // 选 line2 行内 到 line5 行尾（line4 空白行应跳过）
    const state = EditorState.create({ doc, selection: { anchor: 11, head: 19 } })
    const plan = planCommentToggle(state)
    expect(plan).not.toBeNull()
    expect(plan!.selection).toBeUndefined() // 批量分支不带显式选区（光标随变更映射）
    expect(plan!.changes).toEqual([
      { from: 10, to: 10, insert: '# ' },
      { from: 13, to: 13, insert: '# ' },
      { from: 17, to: 17, insert: '# ' },
    ])
    const applied = applyPlan(doc, 11, 19)
    expect(applied.doc).toBe('```python\n# aa\n# bb\n\n# cc\n```')
    // 再切一次（选中同区间）→ 整体还原
    const twice = applyPlan(applied.doc, applied.doc.indexOf('# aa') + 1, applied.doc.length - 4)
    expect(twice.doc).toBe(doc)
  })

  it('选区终点恰在行首 → 该行仍计入（上游 lineAt(to) 口径）', () => {
    const doc = '```python\naa\nbb\ncc\n```'
    const state = EditorState.create({ doc, selection: { anchor: 11, head: 16 } }) // head = line4 行首
    const plan = planCommentToggle(state)
    expect(plan!.changes).toHaveLength(3) // aa、bb、cc 三行
  })

  it('全空白行选区 → 空 changes 计划（派发无操作事务，上游同样派发）', () => {
    const doc = '```python\n\n\n```'
    const state = EditorState.create({ doc, selection: { anchor: 10, head: 11 } })
    const plan = planCommentToggle(state)
    expect(plan).not.toBeNull()
    expect(plan!.changes).toEqual([])
  })
})

// ------------------------------------------------------- 命令注册契约

describe('命令定义契约（稳定 API 注册形状）', () => {
  it('id 局部无点号、mode live、writes true（写操作仅 Live 正文接管宿主绑定）', () => {
    const def = buildToggleCommentCommandDefinition('切换注释')
    expect(def.id).toBe(TOGGLE_COMMENT_COMMAND_ID)
    expect(def.id).toBe('toggle-comment')
    expect(def.id).not.toContain('.')
    expect(def.mode).toBe('live')
    expect(def.writes).toBe(true)
    expect(def.title).toBe('切换注释')
  })

  it('默认键位 Mod+/：ctrl+slash / meta+slash，规范序 + 平台词形键名', () => {
    expect(TOGGLE_COMMENT_DEFAULT_BINDINGS).toEqual(['ctrl+slash', 'meta+slash'])
    for (const chord of TOGGLE_COMMENT_DEFAULT_BINDINGS) {
      expect(isCanonicalChord(chord), chord).toBe(true)
    }
    // 裸 '/' 不在平台 validKey 表内（keybindingRouter keyStep 词形归一前的
    // 注册面），chord 里不得出现
    for (const chord of TOGGLE_COMMENT_DEFAULT_BINDINGS) {
      expect(chord.endsWith('/')).toBe(false)
    }
  })
})

// ------------------------------------------------------------ 命令 handler

describe('命令 handler（目标句柄路由 + 守卫 + 单事务派发）', () => {
  interface FakeSpec {
    changes: unknown
    selection?: { anchor: number; head: number }
    userEvent?: string
  }

  function fakeCmdView(
    doc: string,
    anchor: number,
    head = anchor,
    overrides: Partial<{ compositionStarted: boolean; readOnly: boolean }> = {},
  ) {
    const state = EditorState.create({
      doc,
      ...(overrides.readOnly ? { extensions: [EditorState.readOnly.of(true)] } : {}),
      selection: { anchor, head },
    })
    const dispatched: FakeSpec[] = []
    const view = {
      id: 'main',
      state,
      compositionStarted: false,
      ...overrides,
      dispatch: (spec: FakeSpec) => {
        dispatched.push(spec)
      },
    } as unknown as EditorView
    return { view, dispatched }
  }

  /** 平台命令回调的目标视图句柄替身（info 形状对齐 AddonViewInfo） */
  function fakeHandle(instanceId: string, viewType: 'main' | 'embed' = 'main'): AddonViewHandle {
    return {
      info: {
        instanceId,
        targetDocUri: `doc:${instanceId}`,
        mode: 'live',
        viewType,
        editable: true,
      },
      editor: {} as AddonViewHandle['editor'],
    }
  }

  /** 登记表替身：登记视图恒映射实例 ID 'main'（扩展槽只挂主正文） */
  function setup(view: EditorView | null) {
    const registry = createEditorViewRegistry((v) => (v as unknown as { id: string }).id)
    if (view !== null) registry.register(view)
    return createToggleCommentCommandHandler({ views: registry })
  }

  it('命中：单事务派发（changes + selection + userEvent input.comment）', () => {
    const { view, dispatched } = fakeCmdView('hello', 2)
    setup(view)(fakeHandle('main'))
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]!.changes).toEqual([{ from: 2, to: 2, insert: '%%  %%' }])
    expect(dispatched[0]!.selection).toEqual({ anchor: 5, head: 5 })
    expect(dispatched[0]!.userEvent).toBe('input.comment')
  })

  it('代码块内按语言派发（python 行注释，单事务单变更）', () => {
    const { view, dispatched } = fakeCmdView('```python\nx = 1\n```', 12)
    setup(view)(fakeHandle('main'))
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]!.changes).toEqual([{ from: 10, to: 10, insert: '# ' }])
    expect(dispatched[0]!.userEvent).toBe('input.comment')
  })

  it('无活动视图（target null）/ IME 组合中 / 只读 → 静默不动作', () => {
    const noTarget = setup(fakeCmdView('hello', 2).view)
    noTarget(null)
    for (const overrides of [{ compositionStarted: true }, { readOnly: true }] as const) {
      const { view, dispatched } = fakeCmdView('hello', 2, 2, overrides)
      setup(view)(fakeHandle('main'))
      expect(dispatched).toHaveLength(0)
    }
  })

  it('未知语言 → 计划为 null，不派发（上游 return false 口径）', () => {
    const { view, dispatched } = fakeCmdView('```xyz\ncode\n```', 10)
    setup(view)(fakeHandle('main'))
    expect(dispatched).toHaveLength(0)
  })

  it('目标为嵌入实例句柄（扩展槽未装配、登记面外）→ 无动作，不误写主文档', () => {
    // 嵌入实例无本组件扩展实例（平台装配契约），登记表解析不到视图即
    // 无执行载体；句柄目标保持嵌入文档语义，不向主文档兜底派发
    const { view: main, dispatched } = fakeCmdView('hello', 2)
    setup(main)(fakeHandle('embed:host-1', 'embed'))
    expect(dispatched).toHaveLength(0)
  })
})
