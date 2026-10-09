// BetterBackspace 空列表/引用清除与重编号算法（工单 #8）——自上游
// easy-typing-obsidian（MIT，v6.0.9）移植。纯逻辑零平台依赖：不 import
// 任何 CM6 / SDK / DOM 符号，以「行数组 + 光标行/列」驱动，可被算法
// 矩阵（test/backspace.test.ts）直接离线驱动。
//
// 上游对照（行号锚点以上游克隆为准，按内容锚点优先）：
// - 入口门槛与空项正则：src/keyboard_handlers.ts:439-472（handleBackspace）
// - 空引用行分支：src/keyboard_handlers.ts:311-374（backspaceEmptyQuote）
// - 空列表项分支与重编号：src/keyboard_handlers.ts:376-437（backspaceEmptyListItem）
//
// 与上游的差异（语义对齐，形态与边界收紧处逐条记录）：
// - 有序项支持 1) 分隔符（上游仅 1.——工单票面显式扩展；上一行列表
//   判定与重编号扫描同步扩展，分隔符保留原文）。
// - 任务项（- [ ] / - [x]）纳入前缀解析（票面范围 1），但行为层**不
//   命中**（上游空项正则本不含任务形态）——让位平台一次清整段前缀。
// - 缩进空列表项（嵌套嫌疑）不接管——让位平台按语法树 dedent 升级；
//   上游按「上一行文本形态」合并会误删子项行（见规格「平台 Backspace
//   冲突核对」节）。
// - 多级引用降级保留引用前导缩进：上游联降分支（temp_line =
//   quote_indent_str + …）带缩进、单行分支不带，属上游内部不一致；
//   本仓取联降语义统一。
// - 重编号替换保留原分隔符与原空白字符（上游写死 `. `，gap 为 tab 时
//   会被改写为空格——本仓只改号）。

/** 空行前缀形态（解析结果；行为分支由 planEmptyPrefixBackspace 决定） */
export type EmptyLinePrefix =
  /** 空列表项：上游 listMatchEmpty（^\s*([-*+]|\d+\.) $）+ 1) 扩展 */
  | { readonly type: 'list'; readonly indent: string; readonly bullet: '-' | '*' | '+' | ''; readonly digits: string; readonly delim: '' | '.' | ')' }
  /** 空任务项：列表标记 + [ ]/[x]（上游不命中，让位平台） */
  | { readonly type: 'task'; readonly indent: string; readonly bullet: '-' | '*' | '+'; readonly checked: boolean }
  /** 空引用行：上游 quoteMatchEmpty（^(\s*)(>+) ?$） */
  | { readonly type: 'quote'; readonly indent: string; readonly level: number }

/** 列表标记后恰好一个空格 + 行尾（上游语义：空项须是「标记 + 空格」形态） */
const EMPTY_LIST_RE = /^(\s*)(?:([-*+])|(\d+)([.)])) $/
/** 列表标记 + 空格 + 任务框 + 可选一个尾空格 + 行尾 */
const EMPTY_TASK_RE = /^(\s*)([-*+]) \[([ xX])\] ?$/
/** > 串（连续，层间空格不认）+ 可选一个尾空格 + 行尾 */
const EMPTY_QUOTE_RE = /^(\s*)(>+) ?$/
/** 上一行是否列表项（上游 prevListMatch ^\s*([-*+]|\d+\.)\s 的 1) 扩展） */
const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/
/** 上一行是否引用（任意层级任意内容，上游 prevQuoteMatch） */
const QUOTE_LINE_RE = /^\s*(>+)/
/** 有序项行（重编号扫描：同层顺延判定） */
const ORDERED_LINE_RE = /^(\s*)(\d+)([.)])(\s)/

/**
 * 解析「无正文的行前缀」：行内容恰好是列表/任务/引用前缀（允许的尾
 * 形态见各正则）。非空项（前缀后有正文）、裸标记（`-`、`1.` 无空格）、
 * 层间带空格的引用（`> >`）返回 null。
 */
export function parseEmptyLinePrefix(line: string): EmptyLinePrefix | null {
  const task = EMPTY_TASK_RE.exec(line)
  if (task) {
    return { type: 'task', indent: task[1]!, bullet: task[2] as '-' | '*' | '+', checked: task[3] !== ' ' }
  }
  const list = EMPTY_LIST_RE.exec(line)
  if (list) {
    return list[2]
      ? { type: 'list', indent: list[1]!, bullet: list[2] as '-' | '*' | '+', digits: '', delim: '' }
      : { type: 'list', indent: list[1]!, bullet: '', digits: list[3]!, delim: list[4] as '.' | ')' }
  }
  const quote = EMPTY_QUOTE_RE.exec(line)
  if (quote) {
    return { type: 'quote', indent: quote[1]!, level: quote[2]!.length }
  }
  return null
}

/** 跨行文本变更（行号 + 行内列，均相对变更前的行数组；拦截层换算绝对坐标） */
export interface BackspaceChange {
  readonly fromLine: number
  readonly fromCol: number
  readonly toLine: number
  readonly toCol: number
  readonly insert: string
}

/** 清除计划：changes 按文档序排列，cursor 相对应用后的新文本 */
export interface EmptyPrefixBackspacePlan {
  readonly changes: readonly BackspaceChange[]
  readonly cursorLine: number
  readonly cursorCol: number
}

/**
 * 决策：空列表项/空引用行上、光标在行尾时的一次性清除计划。
 *
 * 命中面（返回计划，上游语义完整移植）：
 * - 顶级空列表项（缩进为空）：上一行是列表项 → 删当前行合并到上一行
 *   末尾；否则清空当前行内容（留空行）。有序项删除后同层后续连续项
 *   各减一（断号/缩进不同/非有序即停）。
 * - 空引用行（任意缩进与层级）：多级 + 上一行是完全相同的空引用行 →
 *   两行同时降一级（联降）；多级其他 → 当前行降一级；单级 + 上一行
 *   是引用 → 删当前行合并；否则清空当前行内容。
 *
 * 让位面（返回 null，接入层 return false 落穿平台链）：空任务项、缩进
 * 空列表项（嵌套）、引用内列表（`> - ` 不被解析命中）、非空项与光标
 * 非行尾。上游正则本不命中后三者；前两者是本仓有意让位（平台已有更
 * 准确的处理，避免双重接管）。
 */
export function planEmptyPrefixBackspace(
  lines: readonly string[],
  cursorLine: number,
  cursorCol: number,
): EmptyPrefixBackspacePlan | null {
  // 入口门槛（上游 handleBackspace）：光标在行尾
  if (cursorLine < 0 || cursorLine >= lines.length) return null
  const lineContent = lines[cursorLine]!
  if (cursorCol !== lineContent.length) return null

  const prefix = parseEmptyLinePrefix(lineContent)
  if (prefix === null) return null
  // 让位：任务项（平台一次清整段前缀含任务标记）；缩进列表项（嵌套
  // 嫌疑——平台按语法树 dedent 升级，上游文本近似在此会误删子项行）
  if (prefix.type === 'task') return null
  if (prefix.type === 'list' && prefix.indent !== '') return null

  return prefix.type === 'list'
    ? planListClear(lines, cursorLine, lineContent, prefix)
    : planQuoteClear(lines, cursorLine, prefix)
}

/** 空列表项清除 + 有序重编号（上游 backspaceEmptyListItem） */
function planListClear(
  lines: readonly string[],
  cursorLine: number,
  lineContent: string,
  prefix: Extract<EmptyLinePrefix, { type: 'list' }>,
): EmptyPrefixBackspacePlan {
  const changes: BackspaceChange[] = []
  let cursorPlanLine = cursorLine
  let cursorPlanCol = 0

  if (cursorLine > 0 && LIST_LINE_RE.test(lines[cursorLine - 1]!)) {
    // 上一行是列表项：删上一行末到当前行末（吃掉换行与整行），光标
    // 移到上一行末尾（上游同）
    const prev = lines[cursorLine - 1]!
    changes.push({ fromLine: cursorLine - 1, fromCol: prev.length, toLine: cursorLine, toCol: lineContent.length, insert: '' })
    cursorPlanLine = cursorLine - 1
    cursorPlanCol = prev.length
  } else {
    // 首行或上一行非列表：清空当前行内容（留空行）
    changes.push({ fromLine: cursorLine, fromCol: 0, toLine: cursorLine, toCol: lineContent.length, insert: '' })
    cursorPlanLine = cursorLine
    cursorPlanCol = 0
  }

  // 重编号：当前行是有序项时，同层后续「恰好连续」的有序项各减一
  //（上游 expectedNextNumber 语义；无序项不触发）
  let expectedNextNumber = prefix.digits === '' ? null : Number(prefix.digits) + 1
  for (let n = cursorLine + 1; n < lines.length && expectedNextNumber !== null; n++) {
    const next = lines[n]!
    const m = ORDERED_LINE_RE.exec(next)
    if (!m) break // 非有序行截断
    const [, nextIndent, digits, delim, gap] = m
    if (nextIndent !== prefix.indent) break // 缩进不同：越层截断
    const nextNumber = Number(digits)
    if (nextNumber !== expectedNextNumber) break // 断号截断
    changes.push({
      fromLine: n, fromCol: 0, toLine: n, toCol: next.length,
      insert: `${nextIndent}${nextNumber - 1}${delim}${gap}${next.slice(m[0].length)}`,
    })
    expectedNextNumber++
  }

  return { changes, cursorLine: cursorPlanLine, cursorCol: cursorPlanCol }
}

/** 空引用行清除（上游 backspaceEmptyQuote） */
function planQuoteClear(
  lines: readonly string[],
  cursorLine: number,
  prefix: Extract<EmptyLinePrefix, { type: 'quote' }>,
): EmptyPrefixBackspacePlan {
  const lineContent = lines[cursorLine]!
  const demoted = `${prefix.indent}${'>'.repeat(prefix.level - 1)} `

  if (prefix.level > 1) {
    const prev = cursorLine > 0 ? lines[cursorLine - 1]! : null
    const prevEmpty = prev === null ? null : parseEmptyLinePrefix(prev)
    if (
      prevEmpty !== null && prevEmpty.type === 'quote' &&
      prevEmpty.indent === prefix.indent && prevEmpty.level === prefix.level
    ) {
      // 多级 + 上一行是完全相同的空引用行：两行同时降一级（联降），
      // 光标在降级后的当前行（第二行）末尾
      return {
        changes: [
          { fromLine: cursorLine - 1, fromCol: 0, toLine: cursorLine - 1, toCol: prev!.length, insert: demoted },
          { fromLine: cursorLine, fromCol: 0, toLine: cursorLine, toCol: lineContent.length, insert: demoted },
        ],
        cursorLine,
        cursorCol: demoted.length,
      }
    }
    // 多级其他：当前行降一级（保留引用前导缩进——取上游联降分支语义）
    return {
      changes: [{ fromLine: cursorLine, fromCol: 0, toLine: cursorLine, toCol: lineContent.length, insert: demoted }],
      cursorLine,
      cursorCol: demoted.length,
    }
  }

  // 单级：上一行是引用 → 删当前行合并到上一行末尾；否则清空当前行内容
  if (cursorLine > 0 && QUOTE_LINE_RE.test(lines[cursorLine - 1]!)) {
    const prev = lines[cursorLine - 1]!
    return {
      changes: [{ fromLine: cursorLine - 1, fromCol: prev.length, toLine: cursorLine, toCol: lineContent.length, insert: '' }],
      cursorLine: cursorLine - 1,
      cursorCol: prev.length,
    }
  }
  return {
    changes: [{ fromLine: cursorLine, fromCol: 0, toLine: cursorLine, toCol: lineContent.length, insert: '' }],
    cursorLine,
    cursorCol: 0,
  }
}

/**
 * 把清除计划应用到行数组（测试断言便利与双实现对照基准）：返回新文本
 * 与光标的绝对偏移（cursor 相对新文本，按新文本的行偏移换算）。
 */
export function applyEmptyPrefixBackspace(
  lines: readonly string[],
  plan: EmptyPrefixBackspacePlan,
): { text: string; cursor: number } {
  const offsets: number[] = []
  let acc = 0
  for (const line of lines) {
    offsets.push(acc)
    acc += line.length + 1
  }
  // 变更区间重叠/乱序非计划契约（拦截层按文档序构造）；此处按倒序应用
  const abs = plan.changes
    .map((c) => ({
      from: offsets[c.fromLine]! + c.fromCol,
      to: offsets[c.toLine]! + c.toCol,
      insert: c.insert,
    }))
    .sort((a, b) => b.from - a.from)
  let text = lines.join('\n')
  for (const c of abs) {
    text = text.slice(0, c.from) + c.insert + text.slice(c.to)
  }
  // 光标相对新文本换算（合并/联降后行号语义见 planQuoteClear/planListClear）
  const newLines = text.split('\n')
  const newOffsets: number[] = []
  let newAcc = 0
  for (const line of newLines) {
    newOffsets.push(newAcc)
    newAcc += line.length + 1
  }
  return { text, cursor: newOffsets[plan.cursorLine]! + plan.cursorCol }
}
