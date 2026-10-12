// BetterCodeEdit 列表下缩进代码块删除优化（工单 #10 接入层 + 决策）——
// 上游 easy-typing-obsidian cm_extensions.ts:279-324（transactionFilter 的
// 删除优化分支）的移植。上游经事务过滤器改写 Backspace 事务；本仓改经
// **抢先层 keymap 拦截**（探索笔记 §4.3 定案）：a) 本仓 filter 层无先例
// 且 #12 已论证附加组件 filter 逆序先行的撤销契约风险；b) 按键时刻状态
// 完备（codeBlockAtViaQuery + 行坐标都是按键时可读的），无事务改写必要。
//
// - planCodeBlockBackspace 只读 EditorState + 语法查询：上游命中条件逐条
//  对齐（无选区门槛 + codeBlockAtViaQuery 命中，pos 取删除落点 to + 光标
//  不在开栏行 + 仅 indent ≠ 0——顶格块完全不接管），返回改写后的删除
//  范围与光标；未命中返回 null。
// - createCodeBlockBackspaceCommand 产出可直接进 keymap 的 Command：门控
//   关闭 / IME / 只读 / 查询缺席 / 未命中 → return false 透传平台链。
//
// 删除范围语义（上游 iterChanges 的 fromA/toA 适配，按分支分形态）：
// - 分支①是**光标语义**（上游 toA == 行.from + indent）：仅折叠光标消费
//  （to 即光标位）；
// - 分支②是**删除范围语义**（上游 fromA ∈ [行首, 行首+indent) 且 toA >
//   行首+indent）：单选区消费（Backspace 删除选区即 [sel.from, sel.to]）。
//   实施决策点（规格留档）：上游 `!selected` 门槛排除非空选区、折叠光标
//   单字符删除 [to-1, to] 又经数理推演不满足分支②条件（两条件对整数
//   矛盾）——分支②在上游 filter 形态不可达；本仓把消费面定为单选区删除
//   使「跨边界裁剪保留缩进列」语义可达，行为净增量且与分支①意图一致。
//   选区未越边界（缩进段内纯空白选区）仍透传，与上游 !selected 的保守
//   方向一致。折叠光标下分支②形态不可达（不另行模拟）。
//
// 两分支（上游 L295-322 逐字语义）：
// - 分支①（光标恰在缩进边界列，to == 行.from + indent）：删除范围改为
//   「上一行行尾 → to」——连换行带缩进一起删，当前行合并到上一行。效果：
//   缩进块里逐行 Backspace 收敛时直接并行走，不残留缩进空白。
// - 分支②（删除跨越缩进边界，from ∈ [行首, 行首+indent) 且 to > 行首+
//   indent）：删除范围裁剪为 [行首+indent, to]——只删内容列以右，缩进
//   列保留。
//
// 与上游的差异（规格 docs/specs/better-code-edit.md「实施决策点」节）：
// - userEvent 用平台惯例 'delete.backward'（#8 先例：撤销归类正确 + 平台
//   行为链 delete 白名单可观察；上游换自定义 'EasyTyping.change'）+
//   scrollIntoView（合并分支光标跨行，不滚动易脱视）。
// - 多选区显式透传（上游只检查 main，多光标下派发会丢副光标——防御性
//   收紧，#12 惯例同款）。
//
// 层归属（#402 四层契约第 2 层）：**抢先层 Prec.high**，注册序在 #8
// BetterBackspace 之后（page-editor 装配序即尝试序）——接管面极窄（仅
// indent ≠ 0 块的两类边界删除），与 #8 的空列表/引用项、平台删空对/退格
// 清层场景互斥，#8 先试。设置门控：上游 settings.BetterCodeEdit；本仓
// betterCodeEdit 键经 isEnabled 注入（关闭 = 透传，不注册等价）。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { codeBlockAtViaQuery, type SyntaxQuery } from './syntaxTreeQuery'

/** 命中计划：绝对坐标（LF）删除范围与折叠光标落点 */
export interface CodeBackspacePlan {
  readonly changes: ReadonlyArray<{ from: number; to: number; insert: string }>
  readonly cursor: number
}

/**
 * 决策：Backspace 在当前选区下是否命中缩进代码块的边界删除优化。
 * 上游 cm_extensions.ts:282-323 命中条件逐条对齐；null = 透传平台链
 *（普通逐字符删除 / joinLineBackward 照旧）。
 */
export function planCodeBlockBackspace(state: EditorState, query: SyntaxQuery): CodeBackspacePlan | null {
  const sel = state.selection
  // 多选区不处理（透传：多光标删除归平台原生语义，防御性收紧）
  if (sel.ranges.length > 1) return null
  const main = sel.main
  // 删除落点 to（上游 pos 取 toA；文首无删除面）
  const to = main.to
  if (to <= 0) return null

  const block = codeBlockAtViaQuery(state.doc, query, to)
  if (block === null) return null // 未命中/查询拒绝：不接管
  // 光标不在开栏行（上游 toA > lineAt(start_pos).to——即首内容行及之后）
  if (to <= state.doc.lineAt(block.startPos).to) return null
  // 仅列表下缩进代码块（顶格块 indent=0 完全不接管，上游 L293）
  const indent = block.indent
  if (indent === 0) return null

  const line = state.doc.lineAt(to)
  const boundary = line.from + indent
  if (main.empty) {
    // 分支①（光标语义）：折叠光标恰在缩进边界列 → 连换行带缩进一起删
    //（合并到上一行；line.number ≥ 2 由「不在开栏行」保证）
    if (to !== boundary) return null
    const prevEnd = state.doc.line(line.number - 1).to
    return { changes: [{ from: prevEnd, to, insert: '' }], cursor: prevEnd }
  }
  // 分支②（删除范围语义，单选区）：跨越缩进边界 → 裁剪保留缩进列
  if (main.from >= line.from && main.from < boundary && to > boundary) {
    return { changes: [{ from: boundary, to, insert: '' }], cursor: boundary }
  }
  return null
}

/**
 * keymap Command 工厂：命中接管（派发单笔删除事务，return true），其余
 * 透传（return false 落穿 #8 与平台 Backspace 链——退格清层/删空对/表格
 * 删除/默认逐字符删除照旧）。
 */
export function createCodeBlockBackspaceCommand(options: {
  /** betterCodeEdit 设置门（page-editor behaviorGates 注入） */
  isEnabled: () => boolean
  /** #5 语法查询工厂（view → 查询；null = 反查失败/语法面缺席） */
  queryOf: (view: EditorView) => SyntaxQuery | null
}): (view: EditorView) => boolean {
  const { isEnabled, queryOf } = options
  return (view: EditorView): boolean => {
    // IME 组合中与只读状态不接管（组合取消交默认路径；只读实例不写）
    if (view.compositionStarted || view.state.readOnly) return false
    if (!isEnabled()) return false
    const query = queryOf(view)
    if (query === null) return false
    const plan = planCodeBlockBackspace(view.state, query)
    if (plan === null) return false
    view.dispatch({
      changes: plan.changes,
      selection: { anchor: plan.cursor, head: plan.cursor },
      userEvent: 'delete.backward',
      scrollIntoView: true,
    })
    return true
  }
}
