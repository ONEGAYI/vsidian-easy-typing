// Tabstop 导航态单元测试（工单 #15）——真实 EditorState（@codemirror/state
// 纯 JS，node 可构造）+ 最小模拟 view（state + dispatch 经 state.update 链）
// 驱动：状态机矩阵、高亮装饰（facet provider 离线调用）、Tab 拦截仲裁
//（含 #7 Tabout 让位）。上游对照 tabstops_state_field.ts
//（consumeAndGotoNextTabstop / tidyTabstops / addTabstopsAndSelect）。
//
// 模拟 view 的 dispatch 语义与 EditorView.dispatch 同构：事务 =
// state.update(spec)，state ← tr.state（CM6 EditorState.update 返回
// Transaction，新状态在 .state——初写时曾误将返回值直接当新状态，此坑
// 由本测试的存在本身钉住）。多选区构造显式启用 allowMultipleSelections
//（vsidian 编辑器宿主侧本就启用多选区面，见 taboutIntercept.test.ts 同注）。
import { describe, expect, it } from 'vitest'
import * as cm6state from '@codemirror/state'
import * as cm6view from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import type { TransactionSpec } from '@codemirror/state'
import { createTabstopNavigation, TABSTOP_DECO_CLASS, type TabstopNavigation } from '../src/tabstopNav'
import type { TabstopSpec } from '../src/rules/rule-engine'

const cm6 = { state: cm6state, view: cm6view }

/** 最小模拟 view：dispatch 经真实事务链更新 state（装饰 provider 可回读） */
function createTestView(doc: string, nav: TabstopNavigation) {
  let state = cm6state.EditorState.create({
    doc,
    extensions: [nav.extension, cm6state.EditorState.allowMultipleSelections.of(true)],
    selection: { anchor: 0 },
  })
  const view = {
    get state() {
      return state
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state
    },
  }
  return view as unknown as EditorView
}

/** 离线收集装饰：facet 输入面的 provider 逐个以 view 调用，迭代 mark */
function collectDecos(view: EditorView): Array<{ from: number; to: number; cls: string }> {
  const out: Array<{ from: number; to: number; cls: string }> = []
  const providers = view.state.facet(cm6view.EditorView.decorations)
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (typeof provider !== 'function') continue
    const set = provider(view)
    for (const ds of Array.isArray(set) ? set : [set]) {
      const it = ds.iter()
      while (it.value !== null) {
        const spec = it.value.spec as { class?: string }
        out.push({ from: it.from, to: it.to, cls: spec.class ?? '' })
        it.next()
      }
    }
  }
  return out
}

function selectionSnapshot(view: EditorView): Array<[number, number]> {
  return view.state.selection.ranges.map((r) => [r.from, r.to] as [number, number])
}

describe('导航态状态机：激活与前进（$0 → $1 → $2，最后一组收尾）', () => {
  // 文档 'a①b②c③d'（7 字符）：$0=(6,6) $1=(2,3) $2=(4,5)（乱序传入）
  const threeGroups: TabstopSpec[] = [
    { number: 1, from: 2, to: 3 },
    { number: 2, from: 4, to: 5 },
    { number: 0, from: 6, to: 6 },
  ]

  it('激活：首组（$0）选中、导航态在场、当前组高亮', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, threeGroups)
    expect(selectionSnapshot(view)).toEqual([[6, 6]])
    expect(collectDecos(view)).toEqual([]) // $0 零宽 → 无可见 mark
  })

  it('Tab 前进：$0 → $1，选区全选默认值、高亮随当前组', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, threeGroups)
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[2, 3]])
    expect(collectDecos(view)).toEqual([{ from: 2, to: 3, cls: TABSTOP_DECO_CLASS }])
  })

  it('Tab 至最后一组（$2）：选区落位且导航态同事务收尾（上游 tidyTabstops）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, threeGroups)
    nav.tabCommand(view)
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[4, 5]])
    // 收尾后：再 Tab 不再接管（恢复普通 Tab 语义，透传平台链）
    expect(nav.tabCommand(view)).toBe(false)
    expect(collectDecos(view)).toEqual([]) // 导航态已清，无残留高亮
  })

  it('多占位符替换体的完整跳转链：默认值逐个全选到终点（端到端矩阵承载嵌套与默认值）', () => {
    // 模拟 ${1:foo}bar${2:baz}（无 $0——两占位符都非零宽，组 [1,2]）
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('xxxfoobarbazxxx', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 3, to: 6 },
      { number: 2, from: 9, to: 12 },
    ])
    // 首组 $1 全选
    expect(selectionSnapshot(view)).toEqual([[3, 6]])
    expect(nav.tabCommand(view)).toBe(true)
    // 末组 $2：选区落位即收尾（最后一组，无论编号是否为 0）
    expect(selectionSnapshot(view)).toEqual([[9, 12]])
    expect(nav.tabCommand(view)).toBe(false)
  })

  it('激活即覆盖旧导航态（新替换产生新占位符组）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, threeGroups)
    // 只激活两组的新替换体
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 3, from: 4, to: 5 },
    ])
    nav.tabCommand(view) // → $3 组 (4,5)（最后一组收尾）
    expect(selectionSnapshot(view)).toEqual([[4, 5]])
    expect(nav.tabCommand(view)).toBe(false)
  })
})

describe('导航态状态机：后退与边界', () => {
  const threeGroups: TabstopSpec[] = [
    { number: 1, from: 2, to: 3 },
    { number: 2, from: 4, to: 5 },
    { number: 0, from: 6, to: 6 },
  ]

  it('Shift-Tab 后退：$1 → $0（上游无此能力，票面新增）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, threeGroups)
    nav.tabCommand(view) // → $1
    expect(nav.shiftTabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[6, 6]])
    // 再后退：首组无路可退，透传平台 Shift-Tab（导航态保持）
    expect(nav.shiftTabCommand(view)).toBe(false)
    expect(selectionSnapshot(view)).toEqual([[6, 6]])
    // 导航仍在：Tab 继续接管
    expect(nav.tabCommand(view)).toBe(true)
  })

  it('未激活导航态：Tab / Shift-Tab 一律透传（return false）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('abc', nav)
    expect(nav.tabCommand(view)).toBe(false)
    expect(nav.shiftTabCommand(view)).toBe(false)
  })

  it('单组替换体（仅 $0）：不进导航态，仅选区落位（上游单组态滞留 quirk 不移植）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, [{ number: 0, from: 4, to: 5 }])
    expect(selectionSnapshot(view)).toEqual([[4, 5]])
    expect(nav.tabCommand(view)).toBe(false)
    expect(collectDecos(view)).toEqual([]) // 无导航态即无高亮
  })

  it('同号多光标组：多选区落位、组内 range 全部高亮', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    // 三组：$0、$1（同号两处，非末组）、$2——Tab 一次进入 $1 组，
    // 多光标选区与逐 range mark 同时在场
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 1, from: 6, to: 7 },
      { number: 0, from: 5, to: 5 },
      { number: 2, from: 4, to: 5 },
    ])
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([
      [2, 3],
      [6, 7],
    ])
    expect(collectDecos(view)).toEqual([
      { from: 2, to: 3, cls: TABSTOP_DECO_CLASS },
      { from: 6, to: 7, cls: TABSTOP_DECO_CLASS },
    ])
  })

  it('末组为同号多光标组：跳到即收尾——选区多光标落位、高亮随态清（上游到达即清行为）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    // 两组：$0 → $1（两处，末组）
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 1, from: 6, to: 7 },
      { number: 0, from: 5, to: 5 },
    ])
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([
      [2, 3],
      [6, 7],
    ])
    expect(collectDecos(view)).toEqual([])
    expect(nav.tabCommand(view)).toBe(false)
  })

  it('空 tabstops 激活为 no-op（#25 管线空占位符替换不建态）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('abc', nav)
    const before = view.state
    nav.activateTabstops(view, [])
    expect(view.state).toBe(before)
  })
})

describe('编辑映射与自动退出', () => {
  it('占位符前插入文本：组坐标前移，Tab 跳转位置随文档正确（上游 map 同款联结度）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 2, from: 4, to: 5 },
      { number: 0, from: 6, to: 6 },
    ])
    // 文档头插入 'XY'（非本组件事务，但选区仍在 $0 组内 → 导航保持）
    view.dispatch({ changes: { from: 0, insert: 'XY' }, selection: { anchor: 8 } })
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[4, 5]]) // $1 组 (2,3) 随 +2 前移
    expect(collectDecos(view)).toEqual([{ from: 4, to: 5, cls: TABSTOP_DECO_CLASS }])
  })

  it('组内编辑（输入占位符内容）：导航保持、坐标含新文本', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 2, from: 4, to: 5 },
      { number: 0, from: 6, to: 6 },
    ])
    nav.tabCommand(view) // → $1 组 (2,3)
    // 在 $1 组内追加（选区仍在组内 → 保持）
    view.dispatch({ changes: { from: 3, insert: 'X' }, selection: { anchor: 4 } })
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[5, 6]]) // $2 组 (4,5) → (5,6)
  })

  it('选区整体移出当前组（点击别处）：导航态自动退出，Tab 透传', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 2, from: 4, to: 5 },
      { number: 0, from: 6, to: 6 },
    ])
    view.dispatch({ selection: { anchor: 0 } }) // 点击文档头
    expect(nav.tabCommand(view)).toBe(false)
    expect(collectDecos(view)).toEqual([])
  })

  it('选区在组内移动（组内子区间选择）：导航保持', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, [
      { number: 0, from: 2, to: 6 },
      { number: 1, from: 4, to: 5 },
    ])
    // 首组 $0=(2,6) 全选中；组内改选子区间仍在组内
    view.dispatch({ selection: { anchor: 3, head: 4 } })
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[4, 5]])
  })

  it('撤销替换（选区跳回替换前位置）→ 移出组 → 导航态自动退出', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('a①b②c③d', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 2, to: 3 },
      { number: 2, from: 4, to: 5 },
      { number: 0, from: 6, to: 6 },
    ])
    // 模拟撤销：文档回退 + 选区跳回（一次性事务，无本组件 effects）
    view.dispatch({
      changes: { from: 6, to: 7, insert: '' },
      selection: { anchor: 1 },
    })
    expect(nav.tabCommand(view)).toBe(false)
  })
})

describe('高亮装饰（当前占位符可见性）', () => {
  it('mark 类名与区间：当前组非空 range 逐个 mark（inclusive）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('abcdefg', nav)
    // 首组 $1（number 最小、非零宽）即当前组
    nav.activateTabstops(view, [
      { number: 1, from: 1, to: 3 },
      { number: 2, from: 4, to: 6 },
    ])
    const [mark] = collectDecos(view)
    expect(mark).toEqual({ from: 1, to: 3, cls: 'vsidian-easy-typing-tabstop' })
  })

  it('零宽占位符不画 mark（上游光标 widget 简化为高亮 + 选择，见规格）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('abc', nav)
    nav.activateTabstops(view, [
      { number: 0, from: 1, to: 1 },
      { number: 1, from: 2, to: 3 },
    ])
    // 首组 $0 零宽：当前组无可见区间
    expect(collectDecos(view)).toEqual([])
  })

  it('高亮只随当前组：非当前组区间无 mark', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('abcdefg', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 1, to: 3 },
      { number: 2, from: 4, to: 6 },
    ])
    // Tab 前进到 $2 组（末组）：跳到即收尾，选区落位、高亮清（上游到达即清）
    expect(nav.tabCommand(view)).toBe(true)
    expect(selectionSnapshot(view)).toEqual([[4, 6]])
    expect(collectDecos(view)).toEqual([])
    // 非 Tab 路径钉「只随当前组」：重建态后当前组 $1 的 mark 不含 $2 区间
    nav.activateTabstops(view, [
      { number: 1, from: 1, to: 3 },
      { number: 2, from: 4, to: 6 },
      { number: 3, from: 6, to: 7 },
    ])
    expect(collectDecos(view)).toEqual([{ from: 1, to: 3, cls: TABSTOP_DECO_CLASS }])
    expect(nav.tabCommand(view)).toBe(true)
    expect(collectDecos(view)).toEqual([{ from: 4, to: 6, cls: TABSTOP_DECO_CLASS }])
  })
})

describe('Tab 拦截仲裁（#7 Tabout 让位与平台链恢复）', () => {
  // 场景构造：当前占位符两侧被 Tabout 配对符包围（taboutCommand 也会命中）
  // ——导航态激活时抢先层（Prec.high）先收到 Tab，return true 即止，
  // #7 落穿层 keymap 不会执行（CM6 keymap 首个 return true 后短路）。
  it('导航态激活：Tab 被导航消费（return true），跳转派发为纯选区事务', () => {
    const nav = createTabstopNavigation(cm6)
    // 文档 '【x】y②z'（6 字符：【=0 x=1 】=2 y=3 ②=4 z=5）：$1 组 (1,2)
    // 在配对符内（Tabout 同场景可命中），$0 落文档尾
    const view = createTestView('【x】y②z', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 1, to: 2 },
      { number: 2, from: 3, to: 4 },
      { number: 0, from: 6, to: 6 },
    ])
    // 先进 $1 组（当前在 $0）；此刻 Tabout 场景在场（光标在 (1,2) 选区）
    nav.tabCommand(view) // → $1 (1,2)
    const dispatches: TransactionSpec[] = []
    const wrapped = {
      get state() {
        return view.state
      },
      dispatch(spec: TransactionSpec) {
        dispatches.push(spec)
        view.dispatch(spec)
      },
    } as unknown as EditorView
    expect(nav.tabCommand(wrapped)).toBe(true)
    expect(dispatches).toHaveLength(1)
    // 跳转事务零写回（纯选区 + effect），Tabout 场景被抢先层让渡
    expect(dispatches[0]!.changes).toBeUndefined()
  })

  it('导航态未激活：同场景 Tab 透传（return false）——#7 落穿层照常收键', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('【x】y', nav)
    // 未激活：即使 Tabout 会命中，导航 command 也不抢（让位测试的镜像）
    expect(nav.tabCommand(view)).toBe(false)
    expect(nav.shiftTabCommand(view)).toBe(false)
  })

  it('导航收尾后同场景立即恢复透传（平台 Tab 情境链回归）', () => {
    const nav = createTabstopNavigation(cm6)
    const view = createTestView('【x】y②z', nav)
    nav.activateTabstops(view, [
      { number: 1, from: 1, to: 2 },
      { number: 2, from: 3, to: 4 },
      { number: 0, from: 6, to: 6 },
    ])
    nav.tabCommand(view) // → $1
    nav.tabCommand(view) // → $2（最后一组）收尾
    // 收尾后同一文档位置：导航不再接管，Tab 落穿（#7 / 平台链恢复）
    expect(nav.tabCommand(view)).toBe(false)
    expect(nav.shiftTabCommand(view)).toBe(false)
  })

  it('多实例隔离：两个导航模块（两个编辑器视图）互不串扰', () => {
    const navA = createTabstopNavigation(cm6)
    const navB = createTabstopNavigation(cm6)
    const viewA = createTestView('a①b②c③d', navA)
    const viewB = createTestView('a①b②c③d', navB)
    navA.activateTabstops(viewA, [
      { number: 1, from: 2, to: 3 },
      { number: 2, from: 4, to: 5 },
    ])
    // B 未激活：透传；A 导航独立推进
    expect(navB.tabCommand(viewB)).toBe(false)
    expect(navA.tabCommand(viewA)).toBe(true)
    expect(selectionSnapshot(viewA)).toEqual([[4, 5]])
  })
})
