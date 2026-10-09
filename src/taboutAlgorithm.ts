// Tabout 配对表与栈匹配算法（工单 #7）——自上游 easy-typing-obsidian
// （MIT，v6.0.9）移植。纯逻辑零平台依赖：不 import 任何 CM6 / SDK / DOM
// 符号，可被算法矩阵（test/tabout.test.ts）直接驱动。
//
// 上游对照（行号锚点以上游克隆为准，按内容锚点优先）：
// - 配对表：src/main.ts:45-48（TaboutPairStrs，22 对）
// - 算法：src/utils.ts:168-215（taboutCursorInPairedString）
//
// 与上游的差异（仅形态，语义逐行对齐）：
// - 上游配对表是 "【|】" 串经 string2pairstring 解析（含 isRegexp /
//   convertEscapeChar 转义处理）；22 对全为纯字面量，此处直接写等价的
//   对象形态，顺序保持原序——选中跳出分支对表序敏感（`[[` 在 `[` 前，
//   嵌套 wikilink 选中跳出取最外层闭合）。
// - 类型命名 PairString / 算法函数名与上游一致，便于对照审阅。
//
// 算法语义（两遍扫描 + 栈）：
// - 第一遍扫光标左侧：模拟开闭栈，结束时栈中是「尚未闭合」的 open；
//   栈空即光标不在任何配对内部，不命中。
// - 第二遍扫光标右侧：遇到的第一个「能闭合第一遍栈中 open」的 close 即
//   跳出目标——光标紧贴它则跳到它之后（一步越出），不贴则跳到它之前
//   （再按一次贴上，两步语义）。光标右侧新开的配对压入临时栈，其
//   close 归新开层闭合，不触发跳出。
// - 自反符（open === close，如 $ * _ ` 引号）按出现顺序交替开闭；
//   失配的 close（栈中无对应 open）忽略。
// - 匹配按 open 长度降序：`$$`/`[[`/`__` 等双字符对先于单字符，嵌套
//   时整对跳出（[[a|]] 跳过整个 ]]，不是单个 ]）。

/** 配对串（上游 PairString：left = 开符号，right = 闭符号） */
export interface PairString {
  readonly left: string
  readonly right: string
}

/** Tabout 22 对配符表（上游 main.ts:45-48 等价对象形态，顺序保持原序） */
export const TABOUT_PAIRS: readonly PairString[] = [
  { left: '【', right: '】' },
  { left: '（', right: '）' },
  { left: '《', right: '》' },
  { left: '“', right: '”' },
  { left: '‘', right: '’' },
  { left: '「', right: '」' },
  { left: '『', right: '』' },
  { left: "'", right: "'" },
  { left: '"', right: '"' },
  { left: '$$', right: '$$' },
  { left: '$', right: '$' },
  { left: '__', right: '__' },
  { left: '_', right: '_' },
  { left: '==', right: '==' },
  { left: '~~', right: '~~' },
  { left: '**', right: '**' },
  { left: '*', right: '*' },
  { left: '[[', right: ']]' },
  { left: '[', right: ']' },
  { left: '{', right: '}' },
  { left: '(', right: ')' },
  { left: '<', right: '>' },
]

/** 栈匹配结果（上游 TabOutResult） */
export interface TaboutResult {
  readonly isSuccess: boolean
  /** isSuccess 时为行内目标偏移（闭合符之后/之前，见模块头注释） */
  readonly newPosition: number
}

const TABOUT_FAIL: TaboutResult = { isSuccess: false, newPosition: 0 }

/**
 * 光标在配对串内部时，求右侧跳出目标（行内限定——上游语义，配对
 * 跨行不跳出）。命中返回 newPosition（相对 input 起点的偏移），未
 * 命中返回 isSuccess: false。
 *
 * 算法与上游 utils.ts:168-215 逐行对齐（含第一遍 per-pair「栈非空但
 * 无此 open」时不弹不跳过的保守行为——失配 close 由此忽略）。
 */
export function taboutCursorInPairedString(
  input: string,
  cursorPosition: number,
  symbolPairs: readonly PairString[],
): TaboutResult {
  // 长 open 优先匹配（$$ 先于 $、[[ 先于 [）——正确性关键：嵌套整对跳出
  const sortedPairs = [...symbolPairs].sort((a, b) => b.left.length - a.left.length)
  let stack: string[] = []
  let tempStack: string[] = []

  // 第一遍：光标左侧 [0, cursorPosition) 的开闭模拟
  for (let i = 0; i < cursorPosition; i++) {
    for (const { left: open, right: close } of sortedPairs) {
      if (input.startsWith(open, i) && (open !== close || stack.lastIndexOf(open) === -1)) {
        // 开符号：自反符仅在栈中无同名时算开（交替语义）
        stack.push(open)
        i += open.length - 1
        break
      } else if (input.startsWith(close, i) && stack.length > 0) {
        // 闭符号：栈中有对应 open 则弹出至该 open；无（失配 close）
        // 则不弹不跳过，继续留给后续 pair 判定——全部不中即忽略此字符
        const lastOpenIndex = stack.lastIndexOf(open)
        if (lastOpenIndex !== -1) {
          stack = stack.slice(0, lastOpenIndex)
          i += close.length - 1
          break
        }
      }
    }
  }

  if (stack.length === 0) return TABOUT_FAIL

  // 第二遍：光标右侧 [cursorPosition, end)——首个能闭合第一遍栈中
  // open 的 close 即目标
  for (let i = cursorPosition; i < input.length; i++) {
    for (const { left: open, right: close } of sortedPairs) {
      if (
        input.startsWith(open, i) &&
        (open !== close || (stack.lastIndexOf(open) === -1 && tempStack.lastIndexOf(open) === -1))
      ) {
        // 光标右侧新开的配对：其闭合端归新开层，不触发跳出
        tempStack.push(open)
        i += open.length - 1
        break
      } else if (input.startsWith(close, i)) {
        const lastOpenIndex = tempStack.lastIndexOf(open)
        if (lastOpenIndex === -1 && stack.lastIndexOf(open) !== -1) {
          // 命中：紧贴光标跳闭合符后（一步越出），不贴跳闭合符前（两步）
          return {
            isSuccess: true,
            newPosition: cursorPosition === i ? i + close.length : i,
          }
        } else if (lastOpenIndex !== -1) {
          // 新开层的闭合：弹出临时栈
          tempStack = tempStack.slice(0, lastOpenIndex)
          i += close.length - 1
          break
        }
      }
    }
  }

  return TABOUT_FAIL
}
