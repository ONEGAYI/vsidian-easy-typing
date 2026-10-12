// BetterCodeEdit 代码块粘贴缩进对齐（工单 #10 接入层 + 决策）——上游
// easy-typing-obsidian cm_extensions.ts:112-166（transactionFilter 的代码块
// 粘贴分支）的移植。上游经事务过滤器重写粘贴事务；本仓改经**实验 cm6
// domEventHandlers({ paste })** 拦截原生 paste 事件（#12 SmartPaste 同款
// 选型与三守卫——smartPasteIntercept.ts 头注释记录的三条理由：附加组件
// filter 逆序先行会破坏富文本粘贴的分步撤销契约 / updateListener 补第二
// 笔拆两次撤销 / domEventHandlers 天然获得平台让位序）。
//
// - planCodeBlockPaste 只读 EditorState + 语法查询 + 剪贴板文本：上游
//   命中条件逐条对齐（betterCodeEdit 门 + 纯插入无选区 + codeBlockAt
//   ViaQuery 命中 + 多行粘贴），返回绝对坐标插入计划；未命中返回 null。
// - createCodeBlockPasteHandler 产出可直接进 domEventHandlers 的处理器：
//   命中 preventDefault + 派发单笔插入事务（return true），其余 return
//   false 透传原生粘贴链。
//
// 执行序（对齐上游 cm_extensions.ts 分支顺序 112 → 168）：代码块判定在
// SmartPaste **之前**——page-editor 装配处本 handler 注册在 #12 之前
//（domEventHandlers 按扩展序执行，先注册先执行），命中即接管，代码块内
// 行尾粘贴不会被 SmartPaste 的列表/引用续接抢走。
//
// 与上游的差异（规格 docs/specs/better-code-edit.md「实施决策点」节）：
// - **\t 替换目标固定 2 空格**：上游把行内 \t 替换为「默认缩进字符」
//   （ctx.getDefaultIndentChar()，读 Obsidian vault 的 useTab/tabSize 配置，
//   默认 \t）；vsidian 无 vault 配置源，固定 2 空格对齐内核 indentUnit
//   与 #120 整行缩进口径。
// - userEvent 用平台惯例 'input.paste'（上游换 'EasyTyping.change'——
//   撤销归类脱离 paste 语义，上游如此；本仓保持粘贴撤销归类，#12 同款
//   口径）+ scrollIntoView。
// - 上游逐 change 判定（transactionFilter 形态）；本仓事件层单折叠光标
//   命中面，多选区/选区替换透传（#12 同款）。
// - IME 组合中 / 只读 / 不可编辑不接管；图片剪贴板项防御性透传（平台
//   imagePaste 在本槽之前已接管，此处复核不吞图片粘贴）。
//
// 设置门控：上游 settings.BetterCodeEdit；本仓 betterCodeEdit 键（出厂
// 默认开）经 isBetterCodeEditEnabled 注入（关闭 = 透传仍粘贴原生语义）。
// 事件可见即置 pasteDetected（#26 联动缝——上游 Mod-v 键位标记的事件级
// 等价；本 handler 注册在 #12 之前，接管时 #12 不再执行，此处补标记，
// 透传时 #12 随后亦标记，两处幂等）。
import type { EditorState } from '@codemirror/state'
import type { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { codeBlockAtViaQuery, type SyntaxQuery } from './syntaxTreeQuery'
import { normalizeClipboardText } from './smartPasteAlgorithm'
import { hasImageItem, type PasteClipboardData } from './smartPasteIntercept'
import type { PasteMarker } from './pasteMarker'

/** 行内 \t 的替换目标（实施决策点：固定 2 空格，不读外部配置） */
const TAB_REPLACEMENT = '  '

/** 命中计划：绝对坐标（LF）纯插入与对齐后文本 */
export interface CodePastePlan {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/**
 * 决策：paste 在当前选区/光标下是否命中代码块缩进对齐。上游命中条件
 * 逐条对齐（changeType 含 paste && fromA == fromB 纯插入 &&
 * isCodeBlockInPos && inserted_lines.length > 1 多行）；命中返回剥最小
 * 共同缩进（忽略空行计算）+ \t 替换 + base_indent 重排的插入计划。
 *
 * 上游实然边界照抄：全空行多行文本 min_indent 为 Infinity，
 * substring(Infinity) 得空串——各行规整为空行（其余行加 base_indent）；
 * 空行不参与最小缩进计算但同样被剥 + 加前缀（变 base_indent 串）。
 */
export function planCodeBlockPaste(
  state: EditorState,
  query: SyntaxQuery,
  pastedText: string,
): CodePastePlan | null {
  const sel = state.selection
  // 多选区不处理（透传：原生多光标行分配归平台）
  if (sel.ranges.length > 1) return null
  const main = sel.main
  // 非空选区不处理（上游 fromA == fromB 纯插入门槛；选区替换归原生链）
  if (!main.empty) return null
  const pos = main.head
  const block = codeBlockAtViaQuery(state.doc, query, pos)
  if (block === null) return null // 未命中/查询拒绝：不接管
  const insertedLines = normalizeClipboardText(pastedText).split('\n')
  // 单行粘贴不接管（上游 inserted_lines.length > 1 门槛）
  if (insertedLines.length <= 1) return null

  // 最小共同缩进（忽略空行；全空行保持 Infinity → substring 得空串）
  let minIndent = Infinity
  for (const line of insertedLines) {
    if (/^\s*$/.test(line)) continue
    minIndent = Math.min(minIndent, line.match(/^\s*/)![0]!.length)
  }
  // base_indent = 块围栏缩进列（列表下缩进代码块场景由此对齐）
  const baseIndent = block.indent === 0 ? '' : ' '.repeat(block.indent)
  const adjusted = insertedLines.map((line, index) => {
    // 先剥共同缩进、再替换行内 \t（上游两步顺序：剥的长度按原字符计数）
    const trimmed = line.substring(minIndent).replace(/\t/g, TAB_REPLACEMENT)
    // 第一行不加前缀（粘贴点已在光标处），其余行前缀 base_indent
    return index === 0 ? trimmed : baseIndent + trimmed
  })
  return { from: pos, to: pos, insert: adjusted.join('\n') }
}

/** 拦截依赖（editable facet、粘贴标记、查询工厂与运行时开关由装配方注入） */
export interface CodeBlockPasteDeps {
  readonly marker: PasteMarker
  /** EditorView.editable facet 值（实验 cm6 运行时注入；测试传真实 facet） */
  readonly editableFacet: Facet<boolean, boolean>
  /** #5 语法查询工厂（view → 查询；null = 反查失败/语法面缺席 → 透传） */
  readonly queryOf: (view: EditorView) => SyntaxQuery | null
  /** betterCodeEdit 设置门控（缺省恒开；关闭 = 透传仍粘贴） */
  readonly isBetterCodeEditEnabled?: () => boolean
}

/**
 * 产出 domEventHandlers({ paste }) 处理器：命中接管（preventDefault +
 * 派发单笔插入事务，return true），其余透传（return false 落穿 #12
 * SmartPaste 与原生粘贴链）。
 */
export function createCodeBlockPasteHandler(deps: CodeBlockPasteDeps) {
  return (event: Event, view: EditorView): boolean => {
    // IME 组合中 / 只读 / 不可编辑不接管（#12 三守卫同款）
    if (view.compositionStarted || view.state.readOnly || !view.state.facet(deps.editableFacet)) {
      return false
    }
    const clipboard = (event as { clipboardData?: PasteClipboardData | null }).clipboardData
    if (!clipboard) return false
    // 图片粘贴归平台资产管线（imagePaste 处理器在本槽之前；防御性复核）
    if (hasImageItem(clipboard.items)) return false
    const text = clipboard.getData('text/plain')
    if (!text) return false
    // 事件可见即标记（上游 Mod-v 键位标记的事件级等价；本 handler 在 #12
    // 之前注册，接管路径需自置，透传路径 #12 随后亦标记——幂等）
    deps.marker.markPaste(false)
    if (deps.isBetterCodeEditEnabled !== undefined && !deps.isBetterCodeEditEnabled()) return false
    const query = deps.queryOf(view)
    if (query === null) return false
    const plan = planCodeBlockPaste(view.state, query, text)
    if (plan === null) return false
    event.preventDefault()
    view.dispatch({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      selection: { anchor: plan.from + plan.insert.length, head: plan.from + plan.insert.length },
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    return true
  }
}
