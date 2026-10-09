// NewLineBelow——当前行下方新建行（工单 #13）——上游
// keyboard_handlers.ts goNewLineAfterCurLine 的平台化移植。
//
// 语义（对齐上游）：Mod+Enter 在**当前行行尾**插入新行（光标列与行内
// 位置无关），并按当前行形态延续结构前缀：
// - 空白行（纯空白）：新行为纯空行（不继承空白）；
// - 列表行（`- `/`* `/`+ `、任务 `- [x] `、有序 `1. `，标记后须有空格）：
//   延续同标记（有序自动递增、任务项重置为 `[ ]`）；
// - 引用行（`>` 串 + 可选尾空格）：延续同级别引用前缀；
// - 其余行：新行无前缀。
//
// **列位置语义（票面点名核对项）**：上游不保持原光标列——插入点固定在
// 行尾，光标落**新行前缀末尾**（普通行 = 列 0，列表/引用行 = 续前缀之后），
// 与原光标列无关（`keyboard_handlers.ts:764-765`，changes 在 line.to、
// newCursorPos = line.to + insertStr.length）。本仓同口径。
//
// 层归属（#402 四层按键契约，见 docs/specs/new-line-below.md「层归属与
// 平台 Mod+Enter 仲裁」）：**抢先层 Prec.high**——平台侧 Mod+Enter 并非
// 无主键：defaultKeymap（extraExtensions 普通槽）内建绑定
// `Mod-Enter → insertBlankLine`（插入空行 + 自动缩进，无前缀延续）。
// 本层先于它尝试，接管面 = 功能开 + 单选区 + 非组合/非只读——本组件的
// 前缀延续是平台没有的净增量；其余（含功能关）return false 落穿，
// 平台内建 insertBlankLine 照旧兜底（**透传 ≠ 无操作**，键位永不失效）。
// 与 #18（Enter）/#7（Tab）不同键位，无同键竞争。
//
// 与上游的差异：
// - 上游 StrictModeEnter × strictLineBreaks 分支不移植（严格换行待产品
//   决策，见 docs/adr/0002-strict-line-break-mapping.md）——上游在严格
//   渲染下会改为插入两空格/双回车（keyboard_handlers.ts:728-762）。
// - **多选区显式透传**：上游不检查（只取 main、派发单 selection 会把多
//   光标收敛为单光标）；本仓透传回平台——defaultKeymap 的
//   insertBlankLine 经 changeByRange 原生多光标（每光标下方插空行），
//   优于上游收敛口径（对齐 #8 的防御性收紧先例）。
// - **普通缩进行不带缩进**（忠实上游）：上游仅列表/引用延续前缀，普通
//   行 prefix = ''——缩进段落行的新行是顶格的；平台 insertBlankLine
//（透传回退）反而带自动缩进。接管与透传在缩进非列表行上行为不同，
//   规格已知边界记录。
// - 设置门为本仓新增（上游命令恒可用、无门控）：实验层 keymap 不进
//   平台统一快捷键管理（#402 契约，用户无法解绑），功能粒度开关由插件
//   设置承担——消费 #3 门面 effective.newLineBelow（键定义见
//   settings-mapping.md §二表末行）。
// - userEvent 用 CM6 惯例 'input.newline'（上游自定义
//   'EasyTyping.goNewLineAfterCurLine'）+ scrollIntoView（新行在当前行
//   下方，末行场景不滚动易脱视）。
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { SETTINGS_TOPIC } from './settings/store'

/** 命中计划：行尾插入文本与光标落点（LF 偏移） */
export interface NewLineBelowPlan {
  /** 插入点 = 主光标行行尾（上游 line.to 口径——与光标列无关） */
  readonly insertAt: number
  /** 插入文本 = '\n' + 续前缀（空白行/普通行前缀为空串） */
  readonly insert: string
  /** 光标落点 = 新行前缀末尾（insertAt + insert.length——不保持原列） */
  readonly cursor: number
}

/** 空白行判定（上游 /^\s*$/——纯空白行只做一次回车，新行不继承空白） */
const EMPTY_LINE = /^\s*$/

/**
 * 列表标记判定（上游口径）：标记后**须有空白**才认（`- item` 认、`-item`
 * 不认）；任务形态 `[-*+] [.]` 先于裸标记尝试；有序仅 `数字.` 形态（`1)`
 * 不认——#8 票面曾为退格扩 `1)`，本票无此授权，保持上游。
 */
const LIST_MARKER = /^(\s*)([-*+] \[.\]|[-*+]|\d+\.)\s/

/** 引用标记判定（上游口径）：`>` 串 + 可选一个尾空格，前导缩进保留 */
const QUOTE_MARKER = /^(\s*)(>+ ?)/

/**
 * 新行续前缀（上游 682-726 行的纯逻辑拆出，便于矩阵测试）：
 * - 无序列表 → 缩进 + 原标记 + 空格；
 * - 任务列表 → 缩进 + 原标记且 `[.]` 重置为 `[ ]`；
 * - 有序列表 → 缩进 + 递增数字 + '. '（parseInt 归一：`09.` → `10.`）；
 * - 引用 → 缩进 + 原引用串（含既有尾空格形态）；
 * - 空白行/其余 → ''。
 */
export function newLineBelowPrefix(lineText: string): string {
  if (EMPTY_LINE.test(lineText)) return ''
  const listMatch = lineText.match(LIST_MARKER)
  if (listMatch !== null) {
    const indent = listMatch[1] ?? ''
    const listMarker = listMatch[2] ?? ''
    if (listMarker === '-' || listMarker === '*' || listMarker === '+') {
      return indent + listMarker + ' '
    }
    if (/^[-*+] \[.\]$/.test(listMarker)) {
      // 任务标记（正则分组形态固定为单括号），重置为未完成
      return indent + listMarker.replace(/\[.\]/g, '[ ]') + ' '
    }
    return indent + (parseInt(listMarker, 10) + 1) + '. '
  }
  const quoteMatch = lineText.match(QUOTE_MARKER)
  if (quoteMatch !== null) {
    return (quoteMatch[1] ?? '') + (quoteMatch[2] ?? '')
  }
  return ''
}

/**
 * 决策：按主光标行（上游 selection.main.head 口径）产出「行尾插入 +
 * 新行前缀末尾光标」计划。恒有计划（本命令非情境命中型——任何行上都
 * 可下方新建行）；多选区门控在 Command 层（透传回平台多光标原生语义）。
 * 非空选区不特判（上游口径：取 main.head 所在行，派发后选区被新光标取代）。
 */
export function planNewLineBelow(state: EditorState): NewLineBelowPlan {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  const insert = '\n' + newLineBelowPrefix(line.text)
  return { insertAt: line.to, insert, cursor: line.to + insert.length }
}

/** Command 依赖（page-editor 注入，测试可替换） */
export interface NewLineBelowCommandDeps {
  /** 功能开关（newLineBelow 生效值；false = 透传回平台内建） */
  readonly isEnabled: () => boolean
}

/**
 * Mod-Enter keymap Command：接管面（功能开 + 单选区 + 非组合/非只读）
 * 派发单笔插入事务（return true）；其余 return false 落穿——平台
 * defaultKeymap 的 insertBlankLine 兜底（空白行插入 + 自动缩进，多光标
 * 原生），键位永不失效。
 */
export function createNewLineBelowCommand(
  deps: NewLineBelowCommandDeps,
): (view: EditorView) => boolean {
  const { isEnabled } = deps
  return (view: EditorView): boolean => {
    // IME 组合中与只读状态不接管（组合取消交默认路径；只读不写）
    if (view.compositionStarted || view.state.readOnly) return false
    if (!isEnabled()) return false
    if (view.state.selection.ranges.length > 1) return false
    const plan = planNewLineBelow(view.state)
    view.dispatch({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
      userEvent: 'input.newline',
      scrollIntoView: true,
    })
    return true
  }
}

/** newLineBelow 设置门（页面侧生效值缓存；形态对齐 #11 modAGate/#18） */
export interface NewLineBelowSettingsGate {
  /** 当前生效值（通道首次返回前为 false——装载即拉取，窗口可忽略；
   *  透传方向统一为安全侧：回平台内建行为） */
  readonly enabled: () => boolean
  /** 拉新生效值（装载时与焦点回归时调用） */
  readonly refresh: () => Promise<void>
}

export function createNewLineBelowGate(
  channel: VsidianAddonPageSdk['channel'],
): NewLineBelowSettingsGate {
  let current = false
  return {
    enabled: () => current,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      current = (effective as { newLineBelow?: unknown } | null)?.newLineBelow === true
    },
  }
}
