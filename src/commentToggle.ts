// 注释切换（工单 #2）——上游 comment_toggle.ts（223 行）的平台化移植：
// 语言注释符表（单行符 / 块符对两态）+ 代码块内按语言行注释切换 + Markdown
// 正文 `%%` 注释切换，经平台稳定 commands API 注册为单一命令（上游命令
// `easy-typing-toggle-comment`，默认热键 Mod+/）。
//
// 语义（对齐上游）：
// - **代码块内**（光标选区起点处围栏语言已知）：单行符（`//`、`#`、`--`、
//   `%`）在缩进后插入/移除 `符号 + 空格`；块符对（`/* */`、`<!-- -->`）在
//   缩进后包裹整行/解包；空选区落在空白行时在光标处插入 `符号 + 空格 +
//   配对符` 并把光标移入其间；有选区时对跨到的每一行独立切换（空白行跳过），
//   全部变更**单事务**派发（撤销一笔回退）。
// - **Markdown 正文**：空选区插入 `%%  %%`（光标落两空格之间；光标已在
//   `%%  %%` 正中时整对删除）；选中文本以 `%%` 包裹/解包（紧贴无空格）。
// - **未知语言**（表外语言或无信息串围栏）：无操作（上游 return false）。
//
// 代码块语言感知：复用 #25 的 `detectScopeFromText`（文本正则降级版，
// `src/ruleScopeFallback.ts`）——围栏状态机（```/~~~ 同字符关闭、长度不短于
// 开栏）提取信息串首 token 作语言。#5（语法树版围栏识别）落地后随
// ruleScopeFallback 同步升级，调用面（scope + language 形状）不变。
// 降级口径与上游树版的差异见 docs/specs/comment-toggle.md「降级口径」：
// 围栏标记行按 Text 走 `%%` 分支（上游树版把围栏行划入代码块区间，会在
// 围栏行写注释前缀破坏围栏——降级版语义更稳）。
//
// 命令注册（平台稳定 API）：mode=live（注释编辑仅 Live 正文有意义）、
// writes=true（写操作快捷键仅在 Live 正文接管宿主绑定）。默认键位
// Mod+/（`ctrl+slash` / `meta+slash`，规范键序 + 平台词形键名——裸 `/`
// 不在平台 validKey 表内）。与平台内建 htmlComment（#139，默认
// ctrl+slash）同弦并存的核对结论见规格「平台键位冲突核对」节。
//
// 与上游的差异：
// - **视图路由**：上游 editorCallback 直收 editor.cm；平台命令回调携带
//   目标视图句柄（PR #432），句柄实例 ID 经 #12 的 createEditorViewRegistry
//   （ViewPlugin 登记在场编辑器）解析本页 CM6 视图后派发。
// - **IME 组合中与只读不动作**（上游无此判定；平台惯例，对齐 #12/#13）。
// - **userEvent 用 CM6 惯例 'input.comment'**（上游自定义
//   'EasyTyping.toggleComment'，对齐 #13 采用 input.* 族的先例——撤销
//   分组按事件族聚合）。
// - 多选区只处理主选区（上游同口径只取 selection.main）；空白行选区批量
//   切换产生空 changes 事务（无操作，上游同样派发）。
import type { EditorState } from '@codemirror/state'
import type { AddonCommandDefinition } from '../types/vendor/shared/addonCommands'
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
import type { EditorViewRegistry } from './plainPasteCommand'
import { detectScopeFromText } from './ruleScopeFallback'
import { debugLog } from './logging'
import { RuleScope } from './rules/rule-engine'

// ---- 语言注释符表（上游 commentSymbols 逐条移植；键为小写语言标识） ----

/** 注释符形态：单行符字符串，或块注释起止对 */
export type CommentSymbol = string | { readonly start: string; readonly end: string }

/**
 * 语言注释符表（上游 getCommentSymbol 内联表逐条移植，26 键 / 21 语言 +
 * 别名）：单行注释（js/ts/java/c/cpp/cs/go/rust/swift/kotlin/php 用
 * C 风式双斜线，py/rb/shell/bash/powershell 井号，sql 双连字符，matlab
 * 百分号）与块注释对（css/scss C 风式起止、html SGML 注释起止；markdown
 * 的 %% 对仅上游表在场，正文分支不走表查询——见 planMarkdownCommentToggle）。
 */
export const COMMENT_SYMBOLS: Readonly<Record<string, CommentSymbol>> = {
  js: '//',
  javascript: '//',
  ts: '//',
  typescript: '//',
  py: '#',
  python: '#',
  rb: '#',
  ruby: '#',
  java: '//',
  c: '//',
  cpp: '//',
  cs: '//',
  go: '//',
  rust: '//',
  swift: '//',
  kotlin: '//',
  php: '//',
  css: { start: '/*', end: '*/' },
  scss: { start: '/*', end: '*/' },
  sql: '--',
  shell: '#',
  bash: '#',
  powershell: '#',
  html: { start: '<!--', end: '-->' },
  matlab: '%',
  markdown: { start: '%%', end: '%%' },
}

/** 语言注释符查询（键小写归一；未知语言返回 null = 无操作） */
export function getCommentSymbol(language: string): CommentSymbol | null {
  return COMMENT_SYMBOLS[language.toLowerCase()] ?? null
}

// ---- 行注释切换（上游 toggleCodeBlockLineComment 逐字移植的纯函数） ----

/** 单条变更（LF 坐标；selection 仅空选区空白行插入时携带光标落点） */
export interface CommentToggleChange {
  readonly from: number
  readonly to: number
  readonly insert: string
  readonly selection?: { readonly anchor: number; readonly head: number }
}

/**
 * 行注释切换计划（上游 64-128 行逐字移植）：
 * - 空白行 + 光标位置：光标处插入 `符号 + 空格`（块符为 `start + 两空格 +
 *   end`），光标移到首个空格后；空白行无光标位置 → null（批量切换时跳过）；
 * - 单行符：行首缩进后无符号 → 插入 `符号 + 空格`；有 → 移除符号及至多
 *   一个尾随空格（`// foo` → `foo`、`//foo` → `foo`）；
 * - 块符对：整行 trim 后首尾匹配 → 解包（移除 `start␣` 前缀与 `␣end`
 *   后缀）；否则缩进后整行包裹 `start␣text␣end`。
 */
export function planLineCommentToggle(
  from: number,
  to: number,
  text: string,
  commentSymbol: CommentSymbol,
  cursorPos?: number,
): CommentToggleChange | null {
  if (text.trim() === '' && cursorPos !== undefined) {
    if (typeof commentSymbol === 'string') {
      const newPos = cursorPos + commentSymbol.length + 1
      return {
        from: cursorPos,
        to: cursorPos,
        insert: commentSymbol + ' ',
        selection: { anchor: newPos, head: newPos },
      }
    }
    const newPos = cursorPos + commentSymbol.start.length + 1
    return {
      from: cursorPos,
      to: cursorPos,
      insert: commentSymbol.start + '  ' + commentSymbol.end,
      selection: { anchor: newPos, head: newPos },
    }
  }
  if (text.trim() === '') return null
  if (typeof commentSymbol === 'string') {
    const trimmedText = text.trimStart()
    if (trimmedText.startsWith(commentSymbol)) {
      const commentIndex = text.indexOf(commentSymbol)
      return {
        from: from + commentIndex,
        to: from + commentIndex + commentSymbol.length + (trimmedText.startsWith(commentSymbol + ' ') ? 1 : 0),
        insert: '',
      }
    }
    const indent = text.length - trimmedText.length
    return { from: from + indent, to: from + indent, insert: commentSymbol + ' ' }
  }
  const trimmedText = text.trim()
  if (trimmedText.startsWith(commentSymbol.start) && trimmedText.endsWith(commentSymbol.end)) {
    const commentStartIndex = text.indexOf(commentSymbol.start)
    return {
      from: from + commentStartIndex,
      to,
      insert: trimmedText.slice(commentSymbol.start.length + 1, -commentSymbol.end.length - 1),
    }
  }
  const indent = text.length - text.trimStart().length
  return { from: from + indent, to, insert: `${commentSymbol.start} ${trimmedText} ${commentSymbol.end}` }
}

// ---- 决策核心：代码块分支 + Markdown 分支（上游 toggleComment 编排） ----

/** 切换计划：一次派发的全部变更（单事务）+ 可选光标落点 */
export interface CommentTogglePlan {
  readonly changes: readonly CommentToggleChange[]
  readonly selection?: { readonly anchor: number; readonly head: number }
}

/**
 * 注释切换决策：选区起点处作用域判定（#25 detectScopeFromText 降级版）——
 * 代码块内按围栏语言行切换（未知语言 → null 无操作）；其余（含围栏标记
 * 行，降级口径）走 Markdown `%%` 分支（恒有计划）。多选区只处理主选区
 *（上游口径）；全部变更单事务承载（撤销一笔）。
 */
export function planCommentToggle(state: EditorState): CommentTogglePlan | null {
  const selection = state.selection.main
  const scope = detectScopeFromText(state.doc.toString(), selection.from)
  if (scope.scope === RuleScope.Code) {
    return planCodeBlockCommentToggle(state, scope.language)
  }
  return planMarkdownCommentToggle(state)
}

/** 代码块分支（上游 toggleCodeBlockComment 的计划化） */
function planCodeBlockCommentToggle(
  state: EditorState,
  language: string | undefined,
): CommentTogglePlan | null {
  const commentSymbol = language !== undefined ? getCommentSymbol(language) : null
  if (commentSymbol === null) return null // 无信息串或表外语言：无操作（上游 return false）

  const selection = state.selection.main
  if (selection.from === selection.to) {
    const line = state.doc.lineAt(selection.from)
    const change = planLineCommentToggle(line.from, line.to, line.text, commentSymbol, selection.from)
    if (change === null) return { changes: [] } // 防御：此分支光标恒在场，不可达
    return change.selection !== undefined
      ? { changes: [change], selection: change.selection }
      : { changes: [change] }
  }
  const changes: CommentToggleChange[] = []
  const fromLine = state.doc.lineAt(selection.from)
  const toLine = state.doc.lineAt(selection.to)
  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = state.doc.line(i)
    const change = planLineCommentToggle(line.from, line.to, line.text, commentSymbol)
    if (change !== null) changes.push(change)
  }
  return { changes }
}

/**
 * Markdown `%%` 分支（上游 toggleMarkdownComment 的计划化）：
 * - 空选区：光标正处 `%%␣|␣%%`（前后各 3 字符恰为 `%%  %%`）→ 整对删除、
 *   光标回退到对首；否则光标处插入 `%%  %%`、光标落两空格之间（from+3）；
 * - 选中文本：首尾已 `%%` → 解包（slice(2, -2)；恰选 `%%` 两字符 → 删除）；
 *   否则紧贴包裹 `%%文本%%`（无空格——上游口径）。
 * sliceString 越界钳制（CM6 Text.clip），文档首光标 from-3 不越界成错。
 */
function planMarkdownCommentToggle(state: EditorState): CommentTogglePlan {
  const doc = state.doc
  const { from, to } = state.selection.main
  if (from === to) {
    if (doc.sliceString(from - 3, to + 3) === '%%  %%') {
      return {
        changes: [{ from: from - 3, to: to + 3, insert: '' }],
        selection: { anchor: from - 3, head: from - 3 },
      }
    }
    return {
      changes: [{ from, to, insert: '%%  %%' }],
      selection: { anchor: from + 3, head: from + 3 },
    }
  }
  const selectedText = doc.sliceString(from, to)
  if (selectedText.startsWith('%%') && selectedText.endsWith('%%')) {
    return { changes: [{ from, to, insert: selectedText.slice(2, -2) }] }
  }
  return { changes: [{ from, to, insert: `%%${selectedText}%%` }] }
}

// ---- 命令层（平台稳定 commands API） ----

/** 命令局部 ID（平台注入命名空间前缀成完整命令 ID） */
export const TOGGLE_COMMENT_COMMAND_ID = 'toggle-comment'

/**
 * 默认绑定（上游 Mod+/；规范修饰键序 ctrl→alt→shift→meta，单词形键名
 * slash——裸 `/` 不在平台 validKey 表内会被注册拒绝）。
 */
export const TOGGLE_COMMENT_DEFAULT_BINDINGS: readonly string[] = ['ctrl+slash', 'meta+slash']

/** 命令定义（title 经 i18n 字典注入） */
export function buildToggleCommentCommandDefinition(title: string): AddonCommandDefinition {
  return {
    id: TOGGLE_COMMENT_COMMAND_ID,
    title,
    mode: 'live',
    writes: true,
    defaultBindings: TOGGLE_COMMENT_DEFAULT_BINDINGS,
  }
}

/** 命令依赖（页面装配注入生产实现，测试接替身） */
export interface ToggleCommentCommandDeps {
  readonly views: EditorViewRegistry
}

/**
 * 产出命令回调（target = 平台解析的目标视图句柄，PR #432 起命令回调
 * 携带）：句柄实例 ID 经登记表解析本页 CM6 视图 → 计划 → 单事务派发
 *（changes + 可选 selection，userEvent input.comment）。无活动视图
 *（target null）/目标实例不在登记面（嵌入/悬停——扩展槽未装配，无执行
 * 载体）/组合中/只读/未知语言一律静默无动作（上游未知语言 return false
 * 同口径）。
 */
export function createToggleCommentCommandHandler(
  deps: ToggleCommentCommandDeps,
): (target: AddonViewHandle | null) => void {
  return (target) => {
    // 违约防御深度：undefined 按无活动视图降级（同 plainPaste 口径）
    if (target === null || target === undefined) return
    const view = deps.views.viewForInstance(target.info.instanceId)
    if (view === null) {
      // 留痕面（对齐拆除前 B-F3 诊断口径）：登记面外目标静默放弃
      debugLog('comment-toggle skipped: target view not registered (embed/hover or viewIdentity unavailable)')
      return
    }
    if (view.compositionStarted || view.state.readOnly) return
    const plan = planCommentToggle(view.state)
    if (plan === null) return
    view.dispatch({
      changes: plan.changes,
      ...(plan.selection !== undefined ? { selection: plan.selection } : {}),
      userEvent: 'input.comment',
    })
  }
}
