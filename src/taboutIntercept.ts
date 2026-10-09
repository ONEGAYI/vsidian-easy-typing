// Tabout Tab 按键拦截决策与 Command（工单 #7 接入层）——上游
// keyboard_handlers.ts:97-135 tabPairStringTabout 移植。
//
// 决策与派发分离：
// - planTabout 只读 EditorState（真实状态可在 node 下离线构造，单测
//   直接驱动）；命中返回折叠选区目标，未命中返回 null。
// - taboutCommand 是可直接进 keymap 的 Command：命中派发**纯选区事务**
//   （零写回零 dirty，对齐平台 fenceEscape 的事务口径）并接管，未命中
//   返回 false 透传。
//
// 层归属（工单 #7 评论定案）：**落穿层为主**——经 page-editor 挂普通
// 扩展槽 keymap（不用 Prec 抢先）。平台 Tab 三段链（围栏越界
// fenceEscape → 表格导航 tableEditing → 正文缩进 indentEditing）先于
// 本组件处理；本 Command 只在命中配对场景时接管。可达性边界（普通正文
// 行 Tab 被平台缩进链消费、落穿层实际可达场景为 frontmatter / 表格边界
// 放行等）与完整冲突核对结论见 docs/specs/tabout.md「平台 Tab 冲突
// 核对」节。
//
// 与上游的差异：上游从 PluginContext 读 settings.Tabout 开关——本组件
// 经 #3 设置通道门控（审查 B-F5 修复）：page-editor 装配处按
// createTaboutCommand({ isEnabled }) 注入运行时门（「恒注册 + 设置门控
// 透传」形态，对齐 #11 modAGate——关闭时 return false，行为与不注册本
// keymap 等价）。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { TABOUT_PAIRS, taboutCursorInPairedString } from './taboutAlgorithm'

/** 跳出计划：目标为折叠选区（anchor === head——上游命中后光标折叠） */
export interface TaboutPlan {
  readonly anchor: number
  readonly head: number
}

/**
 * 决策：Tab 在当前选区下是否命中 Tabout 跳出场景。
 *
 * 分支与上游 tabPairStringTabout 逐一对齐：
 * - 多选区：不处理（null，透传）；
 * - 非空选区：仅当两侧紧贴**同一对**配对符时跳出（按表序首个命中，
 *   嵌套取最外层；不做栈匹配——上游互斥分支）；
 * - 折叠光标：当前行内栈匹配（行内限定，配对跨行不跳出）。
 */
export function planTabout(state: EditorState): TaboutPlan | null {
  const sel = state.selection
  // 上游语义：多选区不处理
  if (sel.ranges.length > 1) return null
  const main = sel.main

  // 选区场景：两侧紧贴同一对配对符
  if (!main.empty) {
    const from = Math.min(main.anchor, main.head)
    const to = Math.max(main.anchor, main.head)
    for (const pair of TABOUT_PAIRS) {
      // 左区间起点为负时显式不命中（不依赖 sliceString 的 clamp 细节；
      // 右区间越过文档尾时 sliceString 返回到尾子串，天然不等于 right）
      const leftEdge = from - pair.left.length
      if (
        leftEdge >= 0 &&
        state.doc.sliceString(leftEdge, from) === pair.left &&
        state.doc.sliceString(to, to + pair.right.length) === pair.right
      ) {
        const target = to + pair.right.length
        return { anchor: target, head: target }
      }
    }
    return null
  }

  // 光标场景：行内栈匹配
  const line = state.doc.lineAt(main.to)
  const result = taboutCursorInPairedString(line.text, main.to - line.from, TABOUT_PAIRS)
  if (!result.isSuccess) return null
  const target = result.newPosition + line.from
  return { anchor: target, head: target }
}

/**
 * keymap Command：命中接管（派发纯选区事务，return true），其余透传
 * （return false 落穿平台 Tab 链——缩进/列表/越界照旧）。
 */
export const taboutCommand = (view: EditorView): boolean => {
  const plan = planTabout(view.state)
  if (plan === null) return false
  view.dispatch({ selection: { anchor: plan.anchor, head: plan.head } })
  return true
}

/**
 * 设置门控包装（审查 B-F5 修复，对齐 #11 createModACommand 形态）：门控
 * 关闭 → return false 透传（行为与不注册本 keymap 等价）；开启 → 原
 * Command 语义。isEnabled 由 page-editor 注入（装载拉取 + 焦点回归刷新）。
 */
export function createTaboutCommand(options: { isEnabled: () => boolean }): (view: EditorView) => boolean {
  const { isEnabled } = options
  return (view) => (isEnabled() ? taboutCommand(view) : false)
}
