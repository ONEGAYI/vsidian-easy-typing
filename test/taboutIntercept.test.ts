// Tabout 拦截决策与 keymap Command 单元测试（工单 #7 接入层）——
// 拦截逻辑单元化：用真实 EditorState（@codemirror/state 纯 JS，node 可
// 构造）驱动决策，用最小模拟 view（state + dispatch 捕获）驱动 Command，
// 不依赖 DOM 与真宿主。上游对照 keyboard_handlers.ts:97-135
// （tabPairStringTabout）。
//
// 层归属（票面评论定案）：落穿层为主——本 Command 命中配对场景才
// return true 接管，其余 return false 透传平台 Tab 行为。平台 Tab 三段链
// （围栏越界 → 表格导航 → 正文缩进）先于本组件处理——可达性边界与
// 冲突核对结论见 docs/specs/tabout.md「平台 Tab 冲突核对」节，此处
// 以用例钉住与平台行为交界处的决策语义（选区/多选区/跨行）。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { planTabout, taboutCommand } from '../src/taboutIntercept'

/** 文档 + 折叠光标构造 */
function stateAt(doc: string, cursor: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: cursor } })
}

/** 文档 + 单选区构造 */
function stateWithRange(doc: string, anchor: number, head: number): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } })
}

describe('决策 planTabout：光标场景（行内栈匹配）', () => {
  it('单行紧贴闭合符 → 跳闭合符后（折叠选区）', () => {
    expect(planTabout(stateAt('【x】', 2))).toEqual({ anchor: 3, head: 3 })
  })

  it('多行文档行内偏移换算正确', () => {
    // 行 2 从 offset 2 起：2=【 3=x 4=】；光标 4（】 前）→ 行内 2 → 行内 3 + 行基 2 = 5
    expect(planTabout(stateAt('前\n【x】\n后', 4))).toEqual({ anchor: 5, head: 5 })
  })

  it('行内限定（上游语义）：配对跨行不跳出', () => {
    // 光标在行 2 起始，行 2 = y】——栈在行内为空
    expect(planTabout(stateAt('【x\ny】', 3))).toBeNull()
  })

  it('无配对与已闭合场景不命中', () => {
    expect(planTabout(stateAt('abc', 1))).toBeNull()
    expect(planTabout(stateAt('【x】', 3))).toBeNull()
  })
})

describe('决策 planTabout：选区场景（两侧紧贴包围才跳出，不做栈匹配）', () => {
  it('22 对逐对选区包围跳出（跳右闭合符后，光标折叠）', () => {
    // 以三对代表不同形态：全角括号、自反符、双字符对——全表逐对在
    // 算法矩阵已覆盖配对语义，此处钉选区分支的三种形态换算
    // 【x】 选 x → 3
    expect(planTabout(stateWithRange('【x】', 1, 2))).toEqual({ anchor: 3, head: 3 })
    // *x* 选 x → 3
    expect(planTabout(stateWithRange('*x*', 1, 2))).toEqual({ anchor: 3, head: 3 })
    // [[x]] 选 x → 5（双字符对）
    expect(planTabout(stateWithRange('[[x]]', 2, 3))).toEqual({ anchor: 5, head: 5 })
  })

  it('反向选区同样命中（anchor/head 归一）', () => {
    expect(planTabout(stateWithRange('【x】', 2, 1))).toEqual({ anchor: 3, head: 3 })
  })

  it('只贴左不贴右 → 不命中', () => {
    // 【x（无右闭合）：选 x，右邻是文档尾空串
    expect(planTabout(stateWithRange('【x', 1, 2))).toBeNull()
  })

  it('不贴左（含文档起点负区间）→ 不命中且不抛错', () => {
    // 选区从 0 起：left 区间起点为负——显式保护，不依赖 sliceString clamp
    expect(planTabout(stateWithRange('【x】', 0, 1))).toBeNull()
  })

  it('两侧为普通文本 → 不命中', () => {
    expect(planTabout(stateWithRange('axyb', 1, 3))).toBeNull()
  })

  it('嵌套 wikilink 选区取最外层（表序敏感：[[ 先于 [）', () => {
    // [[ab]] 选 ab：若 [ 先试会错跳 5——钉住 6
    expect(planTabout(stateWithRange('[[ab]]', 2, 4))).toEqual({ anchor: 6, head: 6 })
  })

  it('选区存在时不回退栈匹配（上游互斥分支）', () => {
    // 【abc】 选 ab：右邻是 c 不是 】——选区分支不命中即结束，即使
    // 光标栈匹配（假想在 head=3 处）会命中
    expect(planTabout(stateWithRange('【abc】', 1, 3))).toBeNull()
  })

  it('多选区不处理（上游语义，透传）', () => {
    // 注意：EditorState.create 在未启用 allowMultipleSelections 时会把
    // selection.asSingle() 折叠为单选区——多 range 状态必须显式声明该
    // facet（vsidian 编辑器宿主侧本就启用多选区面）
    const state = EditorState.create({
      doc: '【a】【b】',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.range(1, 2),
        EditorSelection.range(5, 6),
      ]),
    })
    expect(state.selection.ranges.length).toBe(2)
    expect(planTabout(state)).toBeNull()
  })
})

describe('keymap Command taboutCommand：接管/透传与派发形态', () => {
  interface DispatchCall {
    selection?: { anchor: number; head?: number }
    changes?: unknown
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

  it('命中：派发纯选区事务（零写回零 dirty）并接管（return true）', () => {
    const { view, calls } = fakeView(stateAt('【x】', 2))
    expect(taboutCommand(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.selection).toEqual({ anchor: 3, head: 3 })
    // 纯选区事务：不带 changes（对齐平台 fenceEscape 的事务口径）
    expect(calls[0]!.changes).toBeUndefined()
  })

  it('未命中：零派发并透传（return false 落穿平台 Tab 链）', () => {
    const { view, calls } = fakeView(stateAt('abc', 1))
    expect(taboutCommand(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
