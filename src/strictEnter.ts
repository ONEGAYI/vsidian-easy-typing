// StrictModeEnter 严格换行三模式补偿（工单 #30）——上游
// keyboard_handlers.ts:222-297（enterStrictLineBreak）的平台化移植。
//
// 语义（对齐上游，ADR-0002 §一）：宿主渲染为严格换行（CommonMark 软换行
// 拼段）时，用户按一次 Enter 想要的换行在阅读视图看不见——本层按所选
// 模式改写插入文本使换行可见。三模式（StrictLineMode，默认 enter_twice）：
// - enter_twice：普通文本行插 `\n\n`（分段）；引用行插双行引用
//   （`\n` + 前缀 + `\n` + 前缀）；
// - two_space：行尾两空格硬换行（已有两空格不重复）；引用行同形态 +
//   前缀延续；
// - mix_mode：普通文本按 enter_twice、引用行按 two_space。
//
// 门控（双门 AND，对齐上游 `StrictModeEnter && strictLineBreaks` 原语义）：
// - 组件门：本仓设置 strictModeEnter（默认关，opt-in）；
// - 宿主门：vsidian `experimental.hostSettings` 的 `editor.readingBreaks`
//   读取面（#457，实验入口，清单已声明 ^1.0.0）——false（严格渲染，
//   平台默认）才生效；true（宽松换行）上游补偿前提消失，透传。
//   同步 get 每键实时查询（拉取式跟随热更——宿主保存设置后下次按键即
//   新值，无推送通知，developer-guide §4 契约）；facet 缺席（宿主旧版）
//   或拒绝（view-disposed）按不生效处理（安全侧 = 不改写文本）。
//
// 边界门槛（上游口径原样钉住）：
// - 空白行/光标在行首不处理；纯引用前缀行（前缀后无内容）不处理；
// - 引用行不检查下一行空白（上游 quote 分支先于段中边界）；非 two_space
//   模式且下一行非空白不处理（段中插空行会拆段——上游 267-269）；
// - 只认正文行与引用行（列表/公式/frontmatter/代码块内部落穿，由宿主
//   情境链处理）；
// - callout 标题行落穿：上游 v2 判 callout_title ≠ quote 落穿，平台树判
//   quote（无 callout 枚举）——组件自判 CALLOUT_PREFIX_RE 补齐（忠实上游，
//   非顺宽边界）；
// - 顶格代码块闭栏行行尾特例：插 `\n\n`（上游 282-283 的
//   `codeBlockInfo && pos == end_pos && indent == 0` 半边——顶格块结尾
//   按段落边界处理）。
//
// 层归属（ADR-0002 §三方案 B 风险 2 定案）：**抢先层 Prec.high、同键 Enter 与 #18
// 折叠拦截同层**——装配序保证折叠 keymap 在前（标题行非折叠态本层按
// text 接管，上游 v2 不特判 heading；折叠态折叠层先命中）；列表行本层
// 落穿，先于平台续行链（普通槽）注册即无遮蔽。多选区在 Command 层拦
// （上游 handleEnter 链首检查的对齐形态）。
//
// 与上游的差异：
// - 上游 strictLineBreaks 读 Obsidian vault config；本仓映射为 vsidian
//   宿主设置读取面（见上「宿主门」）——ADR-0002 §四：C 落地后 B 的门控
//   补「仅严格渲染生效」判定，对齐上游条件原意。
// - 行类型判定上游用 CM5 HyperMD 树；本仓用 #5 平台语法查询投影
//   （LINE_KIND 维度，table/heading 归 text 与上游 v2 一致）；查询拒绝
//   （ok:false）→ 不接管（#5 既定口径，不 fallback 正则）。
// - 已知平台口径差异（消费面按平台语义，syntaxTreeQuery 头注先例）：
//   引用内表格/标题行（`> | a |`）平台判 table/heading → 投影 text →
//   本层走正文分支不续引用前缀（上游 v2 判 quote 走引用分支）。
// - userEvent 用 CM6 惯例 'input.newline'（上游自定义
//   'EasyTyping.handleEnter'）+ scrollIntoView（下游新行不滚动易脱视）。
//
// 设置门控：消费 #3 门面 effective.strictModeEnter / effective.strictLineMode
//（SETTINGS_TOPIC.get，装载拉取 + 焦点回归刷新）。
import type { EditorView } from '@codemirror/view'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import type { SyntaxDoc, SyntaxQuery } from './syntaxTreeQuery'
import { CALLOUT_PREFIX_RE, QUOTE_PREFIX_RE, codeBlockAtViaQuery, lineInfoAt } from './syntaxTreeQuery'
import type { StrictLineModeValue } from './settings/defaults'
import { SETTINGS_TOPIC } from './settings/store'

/** 命中计划：光标处插入文本与光标落点（LF 偏移） */
export interface StrictEnterPlan {
  /** 插入点 = 主光标位置（上游 pos = selection.main.to 口径） */
  readonly insertAt: number
  /** 插入文本（三模式 × 行形态决定） */
  readonly insert: string
  /** 光标落点 = 插入串末尾（上游 pos + inserted_str.length） */
  readonly cursor: number
}

/** 空白行判定（上游 /^\s*$/——空白行不参与严格改写） */
const EMPTY_LINE = /^\s*$/

/**
 * 决策：三模式 × 行形态 → 严格换行插入计划；未命中返回 null（透传平台
 * Enter 链）。判定序对照上游 enterStrictLineBreak 222-297（空白行 → 行首
 * → callout → quote 分支 → 段中边界 → two_space text → text / 顶格代码
 * 块末尾）——顺序不得重排（引用分支不检查下一行是上游显式行为）。
 *
 * kind 消费 #5 树版投影（LINE_KIND 维度）：text（含 table/heading 投影）、
 * quote、code（顶格闭栏行尾特例）、其余落穿。查询拒绝（lineInfoAt →
 * null）→ null。
 */
export function planStrictEnter(
  doc: SyntaxDoc,
  query: SyntaxQuery,
  mode: StrictLineModeValue,
  pos: number,
): StrictEnterPlan | null {
  const clamped = Math.max(0, Math.min(pos, doc.length))
  const line = doc.lineAt(clamped)
  const info = lineInfoAt(doc, query, line.number)
  if (info === null) return null
  // 空白行不处理（上游 236）
  if (EMPTY_LINE.test(line.text)) return null
  // 光标在行首不处理（上游 239）
  if (clamped === line.from) return null
  // callout 标题行落穿（上游 v2 callout_title ≠ quote；平台判 quote，
  // 组件自判补齐——见模块头注「边界门槛」）
  if (info.kind === 'quote' && CALLOUT_PREFIX_RE.test(line.text)) return null

  if (info.kind === 'quote') {
    // 引用分支（上游 241-262，不检查下一行空白）：前缀原样延续
    //（QUOTE_PREFIX_RE 与 lineInfoAt 的 quote 判定同源正则，命中必有前缀）
    const quoteMatch = QUOTE_PREFIX_RE.exec(line.text)
    if (quoteMatch === null) return null
    const quoteContent = line.text.slice(quoteMatch[0].length)
    // 纯引用前缀行（前缀后无内容）不处理（上游 247）
    if (quoteContent.trim() === '') return null
    // 已有两空格不重复——引用分支检查**前缀后内容**（上游 250）
    const spaceStr = quoteContent.endsWith('  ') ? '' : '  '
    const prefix = quoteMatch[0]
    // enter_twice → 双行引用；two_space / mix_mode → 两空格 + 续前缀
    const insert =
      mode === 'enter_twice' ? `\n${prefix}\n${prefix}` : `${spaceStr}\n${prefix}`
    return { insertAt: clamped, insert, cursor: clamped + insert.length }
  }

  // 段中边界（上游 267-269）：下一行非空白且非 two_space 模式 → 不处理
  //（two_space 只加行尾空白不改段结构，段中安全）
  const hasNextLine = line.number < doc.lines
  if (hasNextLine && !EMPTY_LINE.test(doc.line(line.number + 1).text)) {
    if (mode !== 'two_space') return null
  }

  // two_space 正文行：两空格 + 换行（上游 271-280；行尾已两空格不重复
  //——非引用分支检查**整行**文本，上游 265）
  if (mode === 'two_space' && info.kind === 'text') {
    const spaceStr = line.text.endsWith('  ') ? '' : '  '
    const insert = `${spaceStr}\n`
    return { insertAt: clamped, insert, cursor: clamped + insert.length }
  }

  // 正文行（enter_twice / mix_mode，或 two_space 非 text 落到此处不命中）：
  // 插 \n\n 分段，光标 pos+2（上游 282-293）
  if (info.kind === 'text') {
    return { insertAt: clamped, insert: '\n\n', cursor: clamped + 2 }
  }

  // 顶格代码块闭栏行行尾特例（上游 282-283 的 code 半边）：光标在块末
  //（endPos）且围栏顶格（indent == 0）→ 按段落边界插 \n\n。非顶格
  //（引用内围栏 / 缩进围栏不产块信息）与块内部不适用 → 落穿
  if (info.kind === 'code') {
    const block = codeBlockAtViaQuery(doc, query, clamped)
    if (block !== null && clamped === block.endPos && block.indent === 0) {
      return { insertAt: clamped, insert: '\n\n', cursor: clamped + 2 }
    }
  }

  // 列表/公式/frontmatter/代码块内部：落穿（平台情境链处理）
  return null
}

/** Command 依赖（page-editor 注入，测试可替换） */
export interface StrictEnterCommandDeps {
  /** 双门合成开关（组件 strictModeEnter × 宿主严格渲染；false = 透传） */
  readonly isEnabled: () => boolean
  /** 当前严格换行模式（strictLineMode 生效值） */
  readonly mode: () => StrictLineModeValue
  /** 树查询（#5 SyntaxQuery，按视图寻址；null = 反查失败/查询面缺席 → 透传） */
  readonly queryOf: (view: EditorView) => SyntaxQuery | null
}

/**
 * Enter keymap Command：命中接管（派发单笔插入事务，return true），其余
 * 透传（return false 落穿平台 Enter 链——#18 折叠（同层在前先试）/列表续
 * 行/表格/普通换行照旧）。光标取 selection.main.to（上游口径——非空选区
 * 同样按选区终点行处理）。
 */
export function createStrictEnterCommand(
  deps: StrictEnterCommandDeps,
): (view: EditorView) => boolean {
  const { isEnabled, mode, queryOf } = deps
  return (view: EditorView): boolean => {
    // IME 组合中与只读状态不接管（防御对齐 #8/#13/#18）
    if (view.compositionStarted || view.state.readOnly) return false
    if (!isEnabled()) return false
    if (view.state.selection.ranges.length !== 1) return false
    const query = queryOf(view)
    if (query === null) return false
    const pos = view.state.selection.main.to
    const plan = planStrictEnter(view.state.doc, query, mode(), pos)
    if (plan === null) return false
    view.dispatch({
      changes: { from: plan.insertAt, to: plan.insertAt, insert: plan.insert },
      selection: { anchor: plan.cursor, head: plan.cursor },
      userEvent: 'input.newline',
      scrollIntoView: true,
    })
    return true
  }
}

/** strictEnter 设置门（页面侧生效值缓存；形态对齐 #18 collapseEnterGate） */
export interface StrictEnterGate {
  /** strictModeEnter 生效值（通道首次返回前为 false——出厂默认，透传安全方向） */
  readonly enabled: () => boolean
  /** strictLineMode 生效值（非法值保持上次——默认 'enter_twice'） */
  readonly mode: () => StrictLineModeValue
  /** 拉新生效值（装载时与焦点回归时调用） */
  readonly refresh: () => Promise<void>
}

export function createStrictEnterGate(
  channel: VsidianAddonPageSdk['channel'],
): StrictEnterGate {
  let currentEnabled = false
  let currentMode: StrictLineModeValue = 'enter_twice'
  return {
    enabled: () => currentEnabled,
    mode: () => currentMode,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      const record = effective as Record<string, unknown> | null
      currentEnabled = record?.strictModeEnter === true
      const mode = record?.strictLineMode
      if (mode === 'enter_twice' || mode === 'two_space' || mode === 'mix_mode') {
        currentMode = mode
      }
    },
  }
}
