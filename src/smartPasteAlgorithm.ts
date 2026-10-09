// SmartPaste 粘贴续接算法（工单 #12 纯逻辑层）——在列表/引用内粘贴时按
// 粘贴内容自身形态决定逐行加前缀与缩进的续接方式。上游对照
// easy-typing-obsidian `src/cm_extensions.ts:168-263`（SmartPaste 分支的
// 纯计算部分，事务/平台依赖剥离到 smartPasteIntercept.ts）：
//
// - 目标行识别：列表标记（无序 / 有序 / 任务）或引用串（上游 listMatch /
//   quoteMatch 两组正则，形态原样保留——含 `> > ` 只取首段的紧凑串语义）；
// - 公共缩进剥离：非空行最小前导空白（min_indent_space），空行短于公共
//   缩进时 substring 越界为空串、长于公共缩进时剥去前缀（上游同——JS
//   区间语义，缺省 end = length）；
// - 列表形态判定（paste_list）：全行为列表项/空行，或缩进 ≥ 公共缩进+2
//   的续行——「列表项 + 换行续文」才算列表形态；
// - 三分支续接：列表目标 × 列表形态 → 首项剥标记并入当前项、其余项带
//   目标缩进保留自身标记；否则 → 首行原样、其余行加目标前缀；粘贴内容
//   中的 Tab 替换为缩进单位。
//
// 与上游的差异（逐条落档 docs/specs/smart-paste.md）：
// - 缩进单位：上游 getDefaultIndentChar 读 Obsidian vault 配置（useTab
//   缺省 '\t'）；本仓缺省两空格——对齐 vsidian 缩进模型（普通行/纯引用行
//   固定 2 空格，listPrefix.ts PLAIN_INDENT_WIDTH 与 CM6 indentUnit 默认），
//   平台无 vault 配置等价物；
// - 上游在事务过滤器内对命中目标行的粘贴**无条件重写**（即使内容不变也
//   换成自定义 userEvent）；本仓恒等续接（结果 === 原文）由拦截层透传原生
//   粘贴，保留平台粘贴语义。

/** 列表项标记形态（上游 `^(\s*)([-*+] \[.\]|[-*+]|\d+\.)\s` 的标记组） */
const LIST_ITEM_PREFIX_RE = /^(\s*)([-*+] \[.\]|[-*+]|\d+\.)\s/
/** 引用行形态（上游 `^(\s*)(>+)(\s)?`——> 串取首个连续段，无尾随空格也算） */
const QUOTE_PREFIX_RE = /^(\s*)(>+)(\s)?/
/** 空行判定（上游 `/^\s*$/`） */
const BLANK_LINE_RE = /^\s*$/
/** 列表形态分支下首项标记剥离（上游 `^([-*+] \[.\]|[-*+]|\d+\.)\s`） */
const LIST_ITEM_HEAD_RE = /^([-*+] \[.\]|[-*+]|\d+\.)\s/
/** 缩进单位缺省：两空格（对齐平台 listPrefix PLAIN_INDENT_WIDTH） */
export const DEFAULT_SMART_PASTE_INDENT_CHAR = '  '

/** 粘贴目标行的结构前缀（上游 listMatch / quoteMatch 的结构化形态） */
export interface SmartPasteTarget {
  readonly kind: 'list' | 'quote'
  /** 前导缩进原文（空格/Tab，上游 m[1]） */
  readonly indent: string
  /** 列表标记（`-` / `*` / `+` / `1.` / `- [x]` 等）或引用标记串（`>` / `>>>`） */
  readonly marker: string
  /** 续接前缀 = 缩进 + 标记 + 一个空格（上游 prefix，尾随空白归一） */
  readonly prefix: string
  /** 列表形态续行的对齐缩进（上游 indent_str——缩进转空格） */
  readonly continuationIndent: string
}

/** 行前导空白长度（上游取行首空白正则匹配串长度） */
function leadingIndentWidth(line: string): number {
  const match = /^\s*/.exec(line)
  return match === null ? 0 : match[0].length
}

/**
 * 解析粘贴目标行：列表/引用前缀结构。非列表/引用行返回 null
 *（含表格、代码围栏、普通文本——上游同：不匹配即整支跳过）。
 */
export function parseSmartPasteTarget(line: string): SmartPasteTarget | null {
  const listMatch = LIST_ITEM_PREFIX_RE.exec(line)
  if (listMatch !== null) {
    const indent = listMatch[1]!
    return {
      kind: 'list',
      indent,
      marker: listMatch[2]!,
      prefix: `${indent}${listMatch[2]!} `,
      continuationIndent: indent.length === 0 ? '' : ' '.repeat(indent.length),
    }
  }
  const quoteMatch = QUOTE_PREFIX_RE.exec(line)
  if (quoteMatch !== null) {
    const indent = quoteMatch[1]!
    return {
      kind: 'quote',
      indent,
      marker: quoteMatch[2]!,
      prefix: `${indent}${quoteMatch[2]!} `,
      continuationIndent: indent.length === 0 ? '' : ' '.repeat(indent.length),
    }
  }
  return null
}

/** 非空行公共缩进（上游 min_indent_space）：全空行时为 Infinity */
export function commonMinIndent(lines: readonly string[]): number {
  let minIndent = Infinity
  for (const line of lines) {
    if (BLANK_LINE_RE.test(line)) continue
    minIndent = Math.min(minIndent, leadingIndentWidth(line))
  }
  return minIndent
}

/**
 * 粘贴内容是否为列表形态（上游 paste_list）：每行为列表项/空行，或为
 * 缩进 ≥ 公共缩进 + 2 的列表项续行。续行门槛 +2 = 一级标记宽度对齐。
 */
export function isListShapedLines(lines: readonly string[]): boolean {
  const minIndent = commonMinIndent(lines)
  for (const line of lines) {
    if (LIST_ITEM_PREFIX_RE.test(line) || BLANK_LINE_RE.test(line)) continue
    if (leadingIndentWidth(line) < minIndent + 2) return false
  }
  return true
}

/** 续接选项 */
export interface SmartPasteContinuationOptions {
  /** 粘贴内容中 Tab 的替换串（缺省两空格，对齐平台缩进模型） */
  readonly indentChar?: string
}

/**
 * 计算续接后的插入文本（LF；入口文本须先经 normalizeClipboardText）。
 * 三分支语义与上游逐行对齐；恒等（结果 === 原文）由调用方透传。
 */
export function planSmartPasteContinuation(
  target: SmartPasteTarget,
  pastedText: string,
  options: SmartPasteContinuationOptions = {},
): string {
  const indentChar = options.indentChar ?? DEFAULT_SMART_PASTE_INDENT_CHAR
  const insertedLines = pastedText.split('\n')
  const minIndent = commonMinIndent(insertedLines)
  const listShaped = isListShapedLines(insertedLines)

  const adjusted = insertedLines.map((line, index) => {
    // substring 越界为空串、长于公共缩进的空行剥去前缀（上游同——JS 缺省
    // end = length 的区间语义）
    const trimmed = line.substring(minIndent).replace(/[\t]/g, indentChar)
    if (target.kind === 'list' && listShaped) {
      if (index === 0) {
        // 首项剥标记并入当前项（当前项已持前缀）
        return trimmed.replace(LIST_ITEM_HEAD_RE, '')
      }
      return target.continuationIndent + trimmed
    }
    if (index === 0) {
      // 首行原样（并入当前项尾，前缀已在行内）
      return trimmed
    }
    return target.prefix + trimmed
  })
  return adjusted.join('\n')
}

/**
 * 剪贴板文本换行归一：CRLF / CR → LF。平台全程 LF 坐标（CM6 文本模型），
 * 原生 paste 事件携带的 text/plain 可能是 CRLF（Windows 源）；原生路径由
 * CM6 toText 归一，本仓拦截/命令路径在入口显式归一。
 */
export function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}
