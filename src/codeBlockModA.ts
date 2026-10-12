// BetterCodeEdit 代码块 Mod+A 三态选择（工单 #10）——上游 easy-typing
// -obsidian syntax.ts:43-83（selectCodeBlockInPos）与 keyboard_handlers.ts
// :672-676（handleModA 链尾调用点）的移植。决策与派发分离（形态对齐
// #11 modaSelection/modaIntercept）：
//
// - planCodeBlockModA 只读 EditorState + 语法查询：pos 所在代码块
//   （codeBlockAtViaQuery，闭区间含围栏两端——上游 getCodeBlockInfoInPos
//   同语义）上的三态链状态机，返回 null = 不接管（透传平台全文全选）。
// - createCodeBlockModACommand 产出可直接进 keymap 的 Command：门控关闭、
//   查询缺席（反查失败/语法面缺席——不接管透传，#5 切片 B）或状态机失配
//   → return false；命中 → 派发纯选区事务（零写回零 dirty，**不带
//   userEvent**——上游三处 dispatch 均无，纯选区事务口径）。
//
// 三态链（上游语义）：未选中 → 选**内容** `[首内容行.from, codeEndPos]`
//（首内容行行首，不含 code 行自身缩进列——与 codeStartPos「行首+indent」
// 不同，上游取 code_line_start.from）；已选内容 → 选**整块**
// `[startPos, endPos]`；已选整块 → 透传（平台全文全选）。选区比对按
// anchor/head 原序（上游口径：反向选区不匹配内容档，首按规整为正向）。
// 多选区防御性透传（照 #11 惯例，上游 asSingle 取 main）。
//
// 与上游的差异（规格 docs/specs/better-code-edit.md「实施决策点」节）：
// 空块（codeStartPos == codeEndPos）二次按下——上游无条件重复派发同选区
// （return true，无可见变化）；本仓改为「已选整块 → 落穿」，三态链闭环
// 与非空块一致（否则空块内 Mod+A 永远到不了平台全选）。
//
// 设置门控：上游 settings.BetterCodeEdit（**不是** EnhanceModA——上游两
// 开关独立，EnhanceModA 关闭时代码块三态仍生效）；本仓 betterCodeEdit
// 键（出厂默认开）经 page-editor behaviorGates 注入（关闭 = 透传，不注册
// 等价）。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { codeBlockAtViaQuery, type SyntaxQuery } from './syntaxTreeQuery'
import type { SelectionRange } from './modaSelection'

/**
 * 决策：Mod+A 在当前选区下命中代码块三态链的档位。null = 透传平台
 * 全文全选。上游 selectCodeBlockInPos 逐分支移植（见模块头注释）。
 */
export function planCodeBlockModA(state: EditorState, query: SyntaxQuery): SelectionRange | null {
  const sel = state.selection
  // 多选区不处理（透传：#11 惯例的防御性收紧）
  if (sel.ranges.length > 1) return null
  const main = sel.main
  // pos 取 anchor（上游 selection.anchor）
  const block = codeBlockAtViaQuery(state.doc, query, main.anchor)
  if (block === null) return null // 未命中/查询拒绝：不接管

  // 空块（相邻开闭栏）：一次选整块；已选整块 → 落穿（本仓口径，上游为
  // 无条件重复派发——见模块头「与上游的差异」）
  if (block.codeStartPos === block.codeEndPos) {
    if (main.anchor === block.startPos && main.head === block.endPos) return null
    return { anchor: block.startPos, head: block.endPos }
  }

  // 非空块三态：内容档取首内容行行首（非 codeStartPos 的「行首+indent」）
  const codeLineStart = state.doc.lineAt(block.codeStartPos)
  if (main.anchor === codeLineStart.from && main.head === block.codeEndPos) {
    return { anchor: block.startPos, head: block.endPos }
  }
  if (main.anchor === block.startPos && main.head === block.endPos) return null
  return { anchor: codeLineStart.from, head: block.codeEndPos }
}

/**
 * keymap Command 工厂：门控关闭、查询缺席或状态机失配 → return false
 * 透传（平台原生 Mod+A 全选）；命中 → 派发纯选区事务并接管。
 */
export function createCodeBlockModACommand(options: {
  /** betterCodeEdit 设置门（page-editor behaviorGates 注入） */
  isEnabled: () => boolean
  /** #5 语法查询工厂（view → 查询；null = 反查失败/语法面缺席） */
  queryOf: (view: EditorView) => SyntaxQuery | null
}): (view: EditorView) => boolean {
  const { isEnabled, queryOf } = options
  return (view: EditorView): boolean => {
    if (!isEnabled()) return false
    const query = queryOf(view)
    if (query === null) return false
    const plan = planCodeBlockModA(view.state, query)
    if (plan === null) return false
    view.dispatch({ selection: { anchor: plan.anchor, head: plan.head } })
    return true
  }
}
