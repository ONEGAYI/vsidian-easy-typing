// CollapsePersistentEnter 折叠标题 Enter 拦截测试（工单 #18）。
// 拦截单元化模式对齐 #7/#8/#11（taboutIntercept / backspaceIntercept /
// modaIntercept）：真实 EditorState 驱动决策（spans 来自手造 folds 数据
// ——平台派生视图的形状），最小模拟 view（state + dispatch 捕获）驱动
// Command，不依赖 DOM 与真宿主。
//
// 「折叠保持」验收以平台派生口径的 mini 复刻承载（测试内 deriveFolds：
// 键集合 + doc 变更时 ChangeSet.mapPos(key, 1) 映射 + join 区间重派生）
// ——插入事务后断言：键集合原位不脱靶、同一标题仍在折叠集中、新标题行
// 成为折叠区间新边界（可见）、事务零 effects（不触碰折叠 StateField）。
// 浏览器真实键盘端到端归 #21。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import type {
  AddonHeadingFoldQueryResult,
  AddonHeadingFoldSpan,
} from '../types/vendor/shared/addonFoldApi'
import { SETTINGS_TOPIC } from '../src/settings/store'
import {
  createCollapseEnterGate,
  createFoldEnterCommand,
  planFoldHeadingEnter,
} from '../src/foldEnter'

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

/**
 * 测试文档（LF，逐行 from-to 偏移，行尾换行计入下一行行首）：
 * ```
 * # Title        0-7
 *                8
 * ## A           9-13
 * a1             14-16
 * a2             17-19
 *                20
 * ## B           21-25
 * b1             26-28
 *                29
 * ### C          30-35
 * c1             36-38
 * ```            文档长 39（行尾换行）
 */
const DOC = '# Title\n\n## A\na1\na2\n\n## B\nb1\n\n### C\nc1\n'

/** 折叠 `## A` 的派生 span（hideTo = 下一级别 ≤ 2 的标题 `## B` 行首） */
const FOLD_A: AddonHeadingFoldSpan = { key: 9, level: 2, hideFrom: 13, hideTo: 21 }

// ---- 测试内 mini 派生器（复刻平台 headingFold 派生语义的关键面） ----

/** 标题提取（测试文档全 ATX、无 frontmatter——逐行正则即可对齐平台口径） */
function headingsOf(doc: Text): Array<{ key: number; level: number; visibleTo: number }> {
  const out: Array<{ key: number; level: number; visibleTo: number }> = []
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const match = line.text.match(/^(#+) /)
    if (match) {
      out.push({ key: line.from, level: match[1]!.length, visibleTo: line.to })
    }
  }
  return out
}

/** 有效折叠派生（平台 join 口径：hideTo = 右侧第一个 level ≤ 自身标题行首或文档末尾） */
function deriveFolds(doc: Text, keys: readonly number[]): AddonHeadingFoldSpan[] {
  const headings = headingsOf(doc)
  const keySet = new Set(keys)
  const spans: AddonHeadingFoldSpan[] = []
  for (let i = 0; i < headings.length; i++) {
    if (!keySet.has(headings[i]!.key)) continue
    let hideTo = doc.length
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= headings[i]!.level) {
        hideTo = headings[j]!.key
        break
      }
    }
    spans.push({
      key: headings[i]!.key,
      level: headings[i]!.level,
      hideFrom: headings[i]!.visibleTo,
      hideTo,
    })
  }
  return spans
}

// ============================================================
// 决策 planFoldHeadingEnter：折叠命中与插入计划
// ============================================================

describe('决策 planFoldHeadingEnter：命中面（真实 EditorState + 手造 folds 数据）', () => {
  it('中间折叠区：插入点 = 折叠区间末尾（下一同级标题行首前），新标题行独立成行', () => {
    // 光标在 `## A` 行内各位置（行首/标记后/文本中/行尾）均命中；插入点
    // 21 前是行分隔 → `## \n`（内容 + 换行，`## B` 行原样独立）
    for (const cursor of [9, 11, 13]) {
      expect(planFoldHeadingEnter(stateAt(DOC, cursor), [FOLD_A])).toEqual({
        insertAt: 21,
        insert: '## \n',
        cursor: 24,
      })
    }
  })

  it('文档末尾折叠区（hideTo = 文档末尾，文档以换行结尾）：追加新标题行', () => {
    // 折叠 `# Title`（level 1，右侧无 ≤1 级标题 → hideTo = docLength）；
    // 插入点前是尾随换行 → 新行自带尾部换行（尾部空行与上游等价场景一致）
    const fold: AddonHeadingFoldSpan = { key: 0, level: 1, hideFrom: 7, hideTo: DOC.length }
    expect(planFoldHeadingEnter(stateAt(DOC, 5), [fold])).toEqual({
      insertAt: 39,
      insert: '# \n',
      cursor: 41,
    })
  })

  it('文档末尾折叠区（文档不以换行结尾）：前置换行，无尾部空行', () => {
    const doc = '# T\ncontent' // 无尾随换行（长 11）
    const fold: AddonHeadingFoldSpan = { key: 0, level: 1, hideFrom: 3, hideTo: doc.length }
    expect(planFoldHeadingEnter(stateAt(doc, 2), [fold])).toEqual({
      insertAt: 11,
      insert: '\n# ',
      cursor: 14,
    })
  })

  it('各级标题级别直取自折叠标题行（1–6 级 `#` 数）', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const doc = `${'#'.repeat(level)} T\ncontent\n`
      // 标题行 `#`x level + ' T'：行尾 = level + 2；右侧无 ≤ 级标题 → hideTo = 末尾
      const span: AddonHeadingFoldSpan = { key: 0, level, hideFrom: level + 2, hideTo: doc.length }
      const marker = `${'#'.repeat(level)} `
      expect(planFoldHeadingEnter(stateAt(doc, 2), [span])).toEqual({
        insertAt: doc.length,
        insert: `${marker}\n`,
        cursor: doc.length + marker.length,
      })
    }
  })

  it('非空选区在折叠标题行上：上游口径不特判（pos = main.to，选区保留）', () => {
    // 上游 enterCollapsedHeading 只看 s.main.to，不要求空选区
    const state = EditorState.create({ doc: DOC, selection: { anchor: 9, head: 13 } })
    expect(planFoldHeadingEnter(state, [FOLD_A])).toEqual({ insertAt: 21, insert: '## \n', cursor: 24 })
  })
})

describe('决策 planFoldHeadingEnter：透传面（null）', () => {
  it('展开态（folds 为空集）：标题行 Enter 完全透传', () => {
    expect(planFoldHeadingEnter(stateAt(DOC, 11), [])).toBeNull()
  })

  it('标题行未折叠（span 是其他标题）：透传', () => {
    // 光标在 `## A`，折叠集中只有 `### C`
    const foldC: AddonHeadingFoldSpan = { key: 30, level: 3, hideFrom: 35, hideTo: 39 }
    expect(planFoldHeadingEnter(stateAt(DOC, 11), [foldC])).toBeNull()
  })

  it('光标在折叠隐藏内容行上（行首 ≠ 折叠键）：透传（折叠态隐藏区不可达的防御面）', () => {
    expect(planFoldHeadingEnter(stateAt(DOC, 15), [FOLD_A])).toBeNull()
  })

  it('非标题行（正文/列表行）与下一标题行首（hideTo 处）：透传', () => {
    expect(planFoldHeadingEnter(stateAt(DOC, 15), [FOLD_A])).toBeNull() // a1 行（同上，显式语义名）
    expect(planFoldHeadingEnter(stateAt(DOC, 27), [FOLD_A])).toBeNull() // b1 行
    expect(planFoldHeadingEnter(stateAt(DOC, 21), [FOLD_A])).toBeNull() // `## B` 行首（不是折叠键行）
  })

  it('Setext 标题折叠（key 行非 ATX 形态）：透传（上游 `/^#+ /` 口径）', () => {
    const doc = 'Title\n=====\ncontent\n'
    // Setext 折叠 span：key = 内容首行行首（平台口径）
    const span: AddonHeadingFoldSpan = { key: 0, level: 1, hideFrom: 11, hideTo: 19 }
    expect(planFoldHeadingEnter(stateAt(doc, 3), [span])).toBeNull()
  })

  it('多选区：整体透传（上游 handleEnter 主入口口径）', () => {
    expect(planFoldHeadingEnter(multiStateAt(DOC, [11, 25]), [FOLD_A])).toBeNull()
  })

  it('span 形状异常防御：pos 超出 hideFrom（可见区外）不命中', () => {
    // 手造形状畸变的 span（hideFrom 落在本行行首之前），安全方向透传
    const odd: AddonHeadingFoldSpan = { key: 9, level: 2, hideFrom: 9, hideTo: 21 }
    expect(planFoldHeadingEnter(stateAt(DOC, 11), [odd])).toBeNull()
  })
})

// ============================================================
// Command：门控、查询节流、派发形态与防御面
// ============================================================

describe('keymap Command createFoldEnterCommand：接管/透传与派发形态', () => {
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

  /** mock folds：记录寻址的实例 ID（断言按反查实例 ID 寻址） */
  function foldsOf(result: AddonHeadingFoldQueryResult): {
    folds: (instanceId: string) => AddonHeadingFoldQueryResult
    calls: string[]
  } {
    const calls: string[] = []
    return {
      folds: (instanceId: string) => {
        calls.push(instanceId)
        return result
      },
      calls,
    }
  }

  /** mock 视图身份反查：固定返回 'main'（生产装配为 viewIdentity.instanceIdOf） */
  const mainIdentityOf = (): string | null => 'main'

  it('功能开 + 命中：派发插入事务（changes + 光标 + input.newline + scrollIntoView，零 effects）并接管', () => {
    const { view, calls } = fakeView(stateAt(DOC, 11))
    const { folds } = foldsOf({ ok: true, spans: [FOLD_A] })
    const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
    expect(command(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.changes).toEqual({ from: 21, to: 21, insert: '## \n' })
    expect(calls[0]!.selection).toEqual({ anchor: 24, head: 24 })
    expect(calls[0]!.userEvent).toBe('input.newline')
    expect(calls[0]!.scrollIntoView).toBe(true)
    // 折叠保持的先决条件：纯文本事务，不携带任何 effect（不触碰折叠 StateField）
    expect(calls[0]!.effects).toBeUndefined()
  })

  it('折叠查询按反查实例 ID 寻址（instanceIdOf 透传语义，不再推定 main）', () => {
    const { view } = fakeView(stateAt(DOC, 11))
    const { folds, calls: foldCalls } = foldsOf({ ok: true, spans: [FOLD_A] })
    // 反查返回非 'main' 的 ID 同样原样寻址——证明查询路由来自反查面而非硬编码
    const command = createFoldEnterCommand({
      folds,
      instanceIdOf: () => 'embed:host-1',
      isEnabled: () => true,
    })
    command(view)
    expect(foldCalls).toEqual(['embed:host-1'])
  })

  it('反查 null（非平台实例——扩展槽装配范围演进的防御面）→ 透传且零查询', () => {
    const { view, calls } = fakeView(stateAt(DOC, 11))
    const { folds, calls: foldCalls } = foldsOf({ ok: true, spans: [FOLD_A] })
    const command = createFoldEnterCommand({
      folds,
      instanceIdOf: () => null,
      isEnabled: () => true,
    })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
    expect(foldCalls).toHaveLength(0)
  })

  it('功能关 → 透传且零查询（设置门在折叠查询之前）', () => {
    const { view, calls } = fakeView(stateAt(DOC, 11))
    const { folds, calls: foldCalls } = foldsOf({ ok: true, spans: [FOLD_A] })
    const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => false })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
    expect(foldCalls).toHaveLength(0)
  })

  it('光标行非 ATX 标题 → 透传且零查询（零开销行门槛：非标题行 Enter 主路径不付 folds 调用开销）', () => {
    for (const cursor of [15, 27, 37]) {
      const { view, calls } = fakeView(stateAt(DOC, cursor))
      const { folds, calls: foldCalls } = foldsOf({ ok: true, spans: [FOLD_A] })
      const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
      expect(command(view), `cursor=${cursor}`).toBe(false)
      expect(calls).toHaveLength(0)
      expect(foldCalls).toHaveLength(0)
    }
  })

  it('标题行但展开态（folds 命中空集）→ 透传零派发（展开态 Enter 完全归平台链）', () => {
    const { view, calls } = fakeView(stateAt(DOC, 11))
    const { folds } = foldsOf({ ok: true, spans: [] })
    const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('folds 拒绝（read-only = 阅读态 Live-only 边界 / view-disposed）→ 静默透传零派发，不算故障', () => {
    for (const reason of ['read-only', 'view-disposed'] as const) {
      const { view, calls } = fakeView(stateAt(DOC, 11))
      const { folds } = foldsOf({ ok: false, reason })
      const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
      expect(command(view), reason).toBe(false)
      expect(calls).toHaveLength(0)
    }
  })

  it('多选区 → 透传且零查询', () => {
    const { view, calls } = fakeView(multiStateAt(DOC, [11, 27]))
    const { folds, calls: foldCalls } = foldsOf({ ok: true, spans: [FOLD_A] })
    const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
    expect(foldCalls).toHaveLength(0)
  })

  it('IME 组合中不接管（组合文本即正文，防御对齐 #8）', () => {
    const view = {
      state: stateAt(DOC, 11),
      compositionStarted: true,
      dispatch: () => {
        throw new Error('组合中不应派发')
      },
    }
    const { folds } = foldsOf({ ok: true, spans: [FOLD_A] })
    const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
    expect(command(view as unknown as EditorView)).toBe(false)
  })

  it('只读状态不接管（零派发落穿）', () => {
    const state = EditorState.create({
      doc: DOC,
      extensions: [EditorState.readOnly.of(true)],
      selection: { anchor: 11 },
    })
    const { view, calls } = fakeView(state)
    const { folds } = foldsOf({ ok: true, spans: [FOLD_A] })
    const command = createFoldEnterCommand({ folds, instanceIdOf: mainIdentityOf, isEnabled: () => true })
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('命中派发的事务可直接应用到真实 EditorState（终态 = plan 期望）', () => {
    // 双实现对照（对齐 #8 形态）：Command 派发的 changes/selection 喂真实
    // state.update，终态与 planFoldHeadingEnter 的插入计划一致
    const state = stateAt(DOC, 11)
    const plan = planFoldHeadingEnter(state, [FOLD_A])!
    const tr = state.update({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
    })
    expect(tr.state.doc.toString()).toBe(
      '# Title\n\n## A\na1\na2\n\n## \n## B\nb1\n\n### C\nc1\n',
    )
    expect(tr.state.selection.main.head).toBe(24)
  })
})

// ============================================================
// 折叠保持验证：插入事务前后 folds 不变（平台派生口径 mini 复刻）
// ============================================================

describe('折叠保持验证：插入不展开折叠（真实 EditorState 模拟 folds 数据）', () => {
  it('中间折叠区：键集合原位、同一标题仍折叠、新标题行成为区间新边界（可见）', () => {
    // 初始态：折叠 `## A`（键 = 9 = 标题行行首——平台折叠 StateField 的值形态）
    const state = stateAt(DOC, 11)
    const keys = [9]
    const spans1 = deriveFolds(state.doc, keys)
    expect(spans1).toEqual([FOLD_A]) // mini 派生器与手造 span 对齐（自检）

    const plan = planFoldHeadingEnter(state, spans1)!
    expect(plan).not.toBeNull()

    // 应用插入事务（Command 派发的同款事务）
    const tr = state.update({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
    })

    // 平台键映射口径：doc 变更时键随 ChangeSet.mapPos(key, 1)——插入点
    //（21）在键（9）之后，键原位不动、零脱靶
    const mappedKeys = keys.map((k) => tr.changes.mapPos(k, 1))
    expect(mappedKeys).toEqual([9])

    // 重派生 folds：`## A` 仍在折叠集（折叠保持），hideTo 收缩到新插入的
    // `## ` 标题行行首（新标题可见，折叠内容仍隐藏到它为止）
    const spans2 = deriveFolds(tr.state.doc, mappedKeys)
    expect(spans2).toHaveLength(1)
    expect(spans2[0]!.key).toBe(9)
    expect(spans2[0]!.level).toBe(2)
    // 新标题行自插入点（21）起（插入 `## \n`，前已是行分隔）→ 行首 21
    expect(spans2[0]!.hideTo).toBe(21)

    // 终态文本：新标题行落在折叠内容之后、`## B` 之前（独立成行）；光标在新标题行尾
    expect(tr.state.doc.toString()).toBe(
      '# Title\n\n## A\na1\na2\n\n## \n## B\nb1\n\n### C\nc1\n',
    )
    expect(tr.state.doc.lineAt(tr.state.selection.main.head).text).toBe('## ')
    expect(tr.state.selection.main.head).toBe(24)
  })

  it('文档末尾折叠区：折叠保持，新标题行追加在文档末尾（可见）', () => {
    const state = stateAt(DOC, 5)
    const keys = [0] // 折叠 `# Title`
    const spans1 = deriveFolds(state.doc, keys)
    expect(spans1).toEqual([{ key: 0, level: 1, hideFrom: 7, hideTo: DOC.length }])

    const plan = planFoldHeadingEnter(state, spans1)!
    const tr = state.update({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
    })

    const mappedKeys = keys.map((k) => tr.changes.mapPos(k, 1))
    expect(mappedKeys).toEqual([0]) // 键在插入点之前，原位

    const spans2 = deriveFolds(tr.state.doc, mappedKeys)
    expect(spans2).toHaveLength(1)
    expect(spans2[0]!.key).toBe(0)
    // 全文档折叠（level 1）下新标题同级 → hideTo 收缩到新标题行行首
    expect(spans2[0]!.hideTo).toBe(39)
    expect(tr.state.doc.toString()).toBe(
      '# Title\n\n## A\na1\na2\n\n## B\nb1\n\n### C\nc1\n# \n',
    )
    // 光标在新标题行（尾部空行前一行）行尾
    expect(tr.state.doc.lineAt(tr.state.selection.main.head).text).toBe('# ')
    expect(tr.state.selection.main.head).toBe(41)
  })

  it('展开两态对照：空键集（展开态）派生空集，Enter 透传（不进插入分支）', () => {
    const state = stateAt(DOC, 11)
    const spans = deriveFolds(state.doc, [])
    expect(spans).toEqual([])
    expect(planFoldHeadingEnter(state, spans)).toBeNull()
  })
})

// ============================================================
// 设置门 createCollapseEnterGate：collapsePersistentEnter 生效值缓存
// ============================================================

describe('设置门 createCollapseEnterGate：collapsePersistentEnter 生效值缓存', () => {
  function channelOf(result: unknown, ok = true): VsidianAddonPageSdk['channel'] {
    return {
      request: async () =>
        ok ? { ok: true, result } : ({ ok: false, reason: 'rejected' } as AddonChannelOutcome),
    }
  }

  it('初始关闭（通道返回前一律透传——上游默认关）', () => {
    expect(createCollapseEnterGate(channelOf(null)).enabled()).toBe(false)
  })

  it('refresh 命中 effective.collapsePersistentEnter=true → 开', async () => {
    const gate = createCollapseEnterGate(channelOf({ effective: { collapsePersistentEnter: true } }))
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
  })

  it('refresh 返回 false → 关（设置页关闭后回生效）', async () => {
    const gate = createCollapseEnterGate(channelOf({ effective: { collapsePersistentEnter: false } }))
    await gate.refresh()
    expect(gate.enabled()).toBe(false)
  })

  it('通道失败（timeout/rejected）→ 保持上次值（fail-safe 不翻转）', async () => {
    let ok = true
    const gate = createCollapseEnterGate({
      request: async () =>
        ok
          ? { ok: true, result: { effective: { collapsePersistentEnter: true } } }
          : ({ ok: false, reason: 'timeout' } as AddonChannelOutcome),
    })
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
    ok = false
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
  })

  it('载荷形态异常（缺 effective / 非 boolean）→ 关', async () => {
    const noEffective = createCollapseEnterGate(channelOf({ values: {} }))
    await noEffective.refresh()
    expect(noEffective.enabled()).toBe(false)
    const wrongType = createCollapseEnterGate(channelOf({ effective: { collapsePersistentEnter: 'yes' } }))
    await wrongType.refresh()
    expect(wrongType.enabled()).toBe(false)
  })

  it('消费 #3 的设置通道 topic 常量（不自建第二份协议）', async () => {
    const seen: string[] = []
    const gate = createCollapseEnterGate({
      request: async (topic) => {
        seen.push(topic)
        return { ok: true, result: { effective: { collapsePersistentEnter: true } } }
      },
    })
    await gate.refresh()
    expect(seen).toEqual([SETTINGS_TOPIC.get])
  })
})
