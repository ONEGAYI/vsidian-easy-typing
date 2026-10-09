// SmartPaste 粘贴拦截接入（工单 #12 接入层）——上游 cm_extensions.ts
// 的 SmartPaste 分支在 Obsidian 里经**事务过滤器**重写粘贴事务；本仓改经
// **实验 cm6 domEventHandlers({ paste })** 拦截原生 paste 事件，决策与
// 派发分离（形态对齐 #7/#8 的 intercept 层）：
//
// - planSmartPasteInsert 只读 EditorState：上游命中条件（纯插入 + 行尾 +
//   目标行列表/引用）逐条对齐，驱动纯逻辑算法（smartPasteAlgorithm.ts），
//   返回绝对坐标插入计划；恒等续接（结果 === 原文）返回 null。
// - createSmartPastePasteHandler 产出可直接进 domEventHandlers 的处理器：
//   命中 preventDefault + 派发单笔插入事务并接管（return true），其余
//   return false 透传原生粘贴链（CM6 doPaste 的多光标行分配 / 行复制形态
//   / uri-list 兜底保持平台语义）。
//
// 拦截路径选型（vs transactionFilter / updateListener，规格「平台映射」节
// 详述）：附加组件扩展槽在平台扩展数组**末位**——domEventHandlers 按扩展
// 序执行且后于平台富文本/图片粘贴处理器、先于 CM6 内建 paste，天然获得
// 「平台命中场景已在其前接管、其余落穿到本层」的让位序；transactionFilter
// 逆序先行会先于平台过滤器看到富文本粘贴的分步撤销事务（B/C 阶段计划在
// 根层算定，重写即破坏撤销契约），updateListener 补第二笔事务则一次粘贴
// 拆两笔撤销。
//
// 与上游的差异（规格「与上游的差异」节逐条）：
// - 上游命中即无条件重写事务（userEvent 换 'EasyTyping.change'）；本仓
//   恒等续接透传原生粘贴，命中才派发且 userEvent 保持 'input.paste'
//  （+ scrollIntoView，对齐 CM6 doPaste 形态）。
// - 上游逐 change 判定（多光标纯插入可逐点续接）；本仓单折叠光标命中面
//   （多选区/选区替换透传——原生多光标行分配语义保持）。
// - CRLF 归一显式前置（上游经 CM6 toText 隐式获得）。
// - IME 组合中 / 只读 / 不可编辑不接管（平台 imagePaste 同口径守卫）。
// - 图片剪贴板项防御性透传（平台 imagePaste 在本槽之前已接管，此处复核
//   不吞图片粘贴）。
//
// 设置门控：上游 settings.SmartPaste 开关随设置接线（isSmartPasteEnabled
// 注入；关闭 = 不续接仍透传粘贴），当前缺省恒开。事件可见即置
// pasteDetected（上游 Mod-v 键位标记的事件级等价——纯文本意图不冲掉）。
import type { EditorState } from '@codemirror/state'
import type { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  normalizeClipboardText,
  parseSmartPasteTarget,
  planSmartPasteContinuation,
} from './smartPasteAlgorithm'
import type { PasteMarker } from './pasteMarker'

/** 命中计划：绝对坐标（LF）纯插入与文本 */
export interface SmartPastePlan {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/**
 * 决策：paste 在当前选区下是否命中列表/引用续接。上游命中条件逐条对齐
 *（changeType 含 paste && fromA==fromB && fromA==lineAt(toA).to &&
 * 目标行 listMatch/quoteMatch）；恒等续接（结果 === 归一原文）返回 null
 * ——单行纯文本、全空行等形态交还原生粘贴链。
 */
export function planSmartPasteInsert(state: EditorState, pastedText: string): SmartPastePlan | null {
  const sel = state.selection
  // 多选区不处理（透传：原生多光标行分配归平台）
  if (sel.ranges.length > 1) return null
  const main = sel.main
  // 非空选区不处理（上游 fromA == fromB 纯插入门槛；选区替换归原生链）
  if (!main.empty) return null
  const pos = main.head
  const line = state.doc.lineAt(pos)
  // 行尾门槛（上游 fromA == startState.doc.lineAt(toA).to）
  if (pos !== line.to) return null
  const target = parseSmartPasteTarget(line.text)
  if (target === null) return null
  const normalized = normalizeClipboardText(pastedText)
  if (normalized.length === 0) return null
  const adjusted = planSmartPasteContinuation(target, normalized)
  // 恒等续接：原生粘贴结果相同，透传保留平台粘贴语义（撤销归类/粘贴历史）
  if (adjusted === normalized) return null
  return { from: pos, to: pos, insert: adjusted }
}

/** 剪贴板数据的最小消费面（原生 DataTransfer 与平台合成 clipboardData 共形） */
interface PasteClipboardData {
  getData(type: string): string
  readonly items?: ArrayLike<{ kind: string; type: string }>
}

/** 图片文件项检测（平台 imagePaste 同口径：kind=file 且 mime image/*） */
function hasImageItem(items: ArrayLike<{ kind: string; type: string }> | undefined): boolean {
  if (items === undefined) return false
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return true
  }
  return false
}

/** 拦截依赖（editable facet 与运行时开关由装配方注入） */
export interface SmartPasteInterceptDeps {
  readonly marker: PasteMarker
  /** EditorView.editable facet 值（实验 cm6 运行时注入；测试传真实 facet） */
  readonly editableFacet: Facet<boolean, boolean>
  /** SmartPaste 设置门控（缺省恒开；关闭 = 不续接仍透传） */
  readonly isSmartPasteEnabled?: () => boolean
}

/**
 * 产出 domEventHandlers({ paste }) 处理器：命中接管（preventDefault +
 * 派发单笔插入事务，return true），其余透传（return false 落穿平台与原生
 * 粘贴链）。
 */
export function createSmartPastePasteHandler(deps: SmartPasteInterceptDeps) {
  return (event: Event, view: EditorView): boolean => {
    // IME 组合中 / 只读 / 不可编辑不接管（平台 imagePaste 同口径守卫）
    if (view.compositionStarted || view.state.readOnly || !view.state.facet(deps.editableFacet)) {
      return false
    }
    const clipboard = (event as { clipboardData?: PasteClipboardData | null }).clipboardData
    if (!clipboard) return false
    // 图片粘贴归平台资产管线（imagePaste 处理器在本槽之前；防御性复核）
    if (hasImageItem(clipboard.items)) return false
    const text = clipboard.getData('text/plain')
    if (!text) return false
    // 事件可见即标记（上游 Mod-v 键位标记的事件级等价；透传也标记，
    // plainPasteInProgress 不被此调用清除——markPaste(plain=false) 语义）
    deps.marker.markPaste(false)
    if (deps.isSmartPasteEnabled !== undefined && !deps.isSmartPasteEnabled()) return false
    const plan = planSmartPasteInsert(view.state, text)
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
