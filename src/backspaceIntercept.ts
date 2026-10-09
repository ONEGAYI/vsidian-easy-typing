// BetterBackspace Backspace 按键拦截决策与 Command（工单 #8 接入层）
// ——上游 keyboard_handlers.ts:439-472（handleBackspace）的 EditorState
// 适配。决策与派发分离（形态对齐工单 #7 的 taboutIntercept）：
//
// - planBetterBackspace 只读 EditorState：先做零开销单行门槛（行尾 +
//   空项前缀 + 让位判定），命中才拆行数组驱动纯逻辑（大文档退格的主
//   路径不进拆行），返回绝对坐标变更与光标；未命中返回 null。
// - betterBackspaceCommand 是可直接进 keymap 的 Command：命中派发**单笔
//   删除事务**（合并/清除/重编号一次撤销整体回退，对齐平台
//   stripListLayer 的事务口径）并接管，未命中返回 false 透传。
//
// 层归属（工单 #8 评论定案）：**抢先层**（Prec.high）——先于平台
// Backspace 情境链尝试。接管面 = 顶级空列表项（上游合并/清行 + 有序
// 重编号语义，平台无此能力）与空引用行（上游联降/降级/合并语义）。
// 让位面（return false 落穿平台链）：缩进空列表项（平台按语法树
// dedent 升级，上游文本近似会误删子项行）、空任务项（平台一次清整段
// 前缀含任务标记）、其余未命中。可达性与逐项核对结论见
// docs/specs/backspace.md「平台 Backspace 冲突核对」节。
//
// 与上游的差异：
// - 上游 userEvent 为自定义 'EasyTyping.handleBackspace'；本仓对齐平台
//   惯例用 'delete.backward'（撤销归类正确，且平台行为链 delete 白名单
//   可观察到本次删除）并加 scrollIntoView（上游无；合并分支光标跨行，
//   不滚动易脱视）。
// - 多选区显式透传（上游只检查 main 折叠，多光标下派发会丢副光标——
//   防御性收紧）。
// - IME 组合中与只读状态不接管（组合文本即正文、只读实例不该写——
//   平台 listEditing 同口径）。
//
// 设置门控（审查 B-F5 修复）：上游 settings.BetterBackspace 开关经 #3
// 设置通道接线——page-editor 装配处按 createBetterBackspaceCommand({
// isEnabled }) 注入运行时门（「恒注册 + 设置门控透传」形态，对齐 #11
// modAGate——关闭时 return false，行为与不注册本 keymap 等价）。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { parseEmptyLinePrefix, planEmptyPrefixBackspace } from './backspaceAlgorithm'

/** 命中计划：绝对坐标（LF）变更与折叠光标落点 */
export interface BetterBackspacePlan {
  readonly changes: ReadonlyArray<{ from: number; to: number; insert: string }>
  readonly cursor: number
}

/**
 * 决策：Backspace 在当前选区下是否命中空列表项/空引用行清除场景。
 *
 * 两级判定：先用当前行做零开销门槛（行尾 + 前缀解析 + 让位形态——
 * 常规退格的主路径在此返回 null，不拆全文行数组），命中再拆行数组
 * 驱动纯逻辑算法（罕见路径；大文档拆行开销仅由命中场景承担）。
 */
export function planBetterBackspace(state: EditorState): BetterBackspacePlan | null {
  const sel = state.selection
  // 多选区/非空选区不处理（透传）
  if (sel.ranges.length > 1) return null
  const main = sel.main
  if (!main.empty) return null

  const line = state.doc.lineAt(main.head)
  // 行尾门槛（上游 selection.anchor == line.to）
  if (main.head !== line.to) return null
  // 零开销单行预判：空项前缀 + 让位形态（任务/缩进列表项——与算法层
  // planEmptyPrefixBackspace 的让位判定同源，此处前移避免命中面外拆行）
  const prefix = parseEmptyLinePrefix(line.text)
  if (prefix === null) return null
  if (prefix.type === 'task') return null
  if (prefix.type === 'list' && prefix.indent !== '') return null

  // 命中面：逐行迭代构造行数组驱动纯逻辑（0 基行号；iterLines 免全文复制）
  const lines = Array.from(state.doc.iterLines())
  const cursorLine = line.number - 1
  const plan = planEmptyPrefixBackspace(lines, cursorLine, line.text.length)
  if (plan === null) return null

  // 行内坐标 → 绝对偏移（doc.line 带 1 基行号）。变更按文档序且不重叠。
  const changes = plan.changes.map((c) => ({
    from: state.doc.line(c.fromLine + 1).from + c.fromCol,
    to: state.doc.line(c.toLine + 1).from + c.toCol,
    insert: c.insert,
  }))
  // 光标按**变更后**文档换算：联降分支前一行长度变化会移动后续行偏移
  //（cursorLine/cursorCol 语义相对新文本，见 applyEmptyPrefixBackspace）
  const cursor = state.update({ changes }).state.doc.line(plan.cursorLine + 1).from + plan.cursorCol
  return { changes, cursor }
}

/**
 * keymap Command：命中接管（派发单笔删除事务，return true），其余
 * 透传（return false 落穿平台 Backspace 链——退格清层/删空对/表格
 * 删除/默认逐字符删除照旧）。
 */
export const betterBackspaceCommand = (view: EditorView): boolean => {
  // IME 组合中与只读状态不接管（组合取消交默认路径；只读实例不写）
  if (view.compositionStarted || view.state.readOnly) return false
  const plan = planBetterBackspace(view.state)
  if (plan === null) return false
  view.dispatch({
    changes: plan.changes,
    selection: { anchor: plan.cursor, head: plan.cursor },
    userEvent: 'delete.backward',
    scrollIntoView: true,
  })
  return true
}

/**
 * 设置门控包装（审查 B-F5 修复，对齐 #11 createModACommand 形态）：门控
 * 关闭 → return false 透传（行为与不注册本 keymap 等价）；开启 → 原
 * Command 语义。isEnabled 由 page-editor 注入（装载拉取 + 焦点回归刷新）。
 */
export function createBetterBackspaceCommand(options: { isEnabled: () => boolean }): (view: EditorView) => boolean {
  const { isEnabled } = options
  return (view) => (isEnabled() ? betterBackspaceCommand(view) : false)
}
