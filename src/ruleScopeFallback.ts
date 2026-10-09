// 作用域判定降级实现（工单 #25）：TxContext.scopeHint / scopeLanguage 的
// 文本正则注入源。
//
// 上游 detectRuleScope（syntax.ts:208）经 CM6 syntaxTree 判光标处节点名
// （含 'math' → Formula；含 'code' 且不含 'link' → Code + 语言）。vsidian
// live 编辑器的 experimental.cm6.language.syntaxTree 恒为未解析空树
// （vsidian#406 已知边界），规则引擎内核因此不做语法树判定（#1 设计
// 决策），由本模块提供文本降级版：
// - Code：围栏代码块状态机（```/~~~ 围栏，同字符关闭、长度不小于开栏，
//   缩进 ≤3 空格），光标行本身是围栏标记行 → 不算代码内容（Text）；
// - Formula：$...$（行内，不跨行）与 $$...$$（块级，跨行）区间判定，
//   \$ 转义不计，行内代码 `...` 内容不参与 $ 配对；
// - Text：其余。
//
// 近似边界（vs 语法树版，记录于 docs/specs/rule-engine.md「#25 行为链
// 接入」节）：货币写法 $100 的未配对 $ 按行内开区间处理（该行光标处
// 误判 Formula）；嵌套围栏里的 `` `` 内层围栏等极端形态不追求一致。
// 20 条内置规则作用域全为 All，本判定当前仅影响未来用户规则（#14）与
// Delete/SelectKey 管线（#9）。
import { RuleScope } from './rules/rule-engine'

/** 判定结果（对齐上游 ScopeInfo：scope + 可选代码语言） */
export interface FallbackScopeInfo {
  scope: RuleScope
  language?: string
}

/** 围栏标记行匹配（开栏信息串仅开栏侧解析；Markdown 围栏缩进 ≤3 空格） */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** 关栏行：同字符、长度不小于开栏、余白（信息串只允许出现在开栏） */
function isFenceClose(line: string, open: { char: string; length: number }): boolean {
  const m = FENCE_LINE.exec(line)
  return m !== null && m[1]![0] === open.char && m[1]!.length >= open.length && m[2]!.trim() === ''
}

/** 光标处作用域（pos 为 LF 坐标；越界钳制，防御不抛错） */
export function detectScopeFromText(docText: string, pos: number): FallbackScopeInfo {
  const clamped = Math.max(0, Math.min(pos, docText.length))
  const before = docText.slice(0, clamped)
  const lines = before.split('\n')

  // ---- 围栏状态机：仅扫光标行之前的行；光标行是围栏标记行 → Text ----
  let open: { char: string; length: number; language?: string } | null = null
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!
    if (open === null) {
      const m = FENCE_LINE.exec(line)
      if (m !== null) {
        open = {
          char: m[1]![0]!,
          length: m[1]!.length,
          language: m[2]!.trim().split(/\s+/)[0] || undefined,
        }
      }
    } else if (isFenceClose(line, open)) {
      open = null
    }
  }
  if (open !== null && FENCE_LINE.exec(lines[lines.length - 1]!) === null) {
    return { scope: RuleScope.Code, ...(open.language !== undefined ? { language: open.language } : {}) }
  }

  // ---- 数学区间：扫描光标前全文，$...$ 行内（换行重置）/ $$...$$ 块级 ----
  let inMath = false
  let inlineDollarOpen = false
  let blockDollarOpen = false
  let i = 0
  while (i < before.length) {
    const ch = before[i]!
    if (ch === '\\') {
      i += 2 // 转义（\$ 等）：连同被转义字符跳过
      continue
    }
    if (ch === '`') {
      // 行内代码：等长反引号配对（同行为限）；找不到配对按字面继续
      let run = 0
      while (before[i + run] === '`') run++
      const close = before.indexOf('`'.repeat(run), i + run)
      const lineEnd = before.indexOf('\n', i)
      if (close !== -1 && (lineEnd === -1 || close < lineEnd)) {
        i = close + run
        continue
      }
      i += run
      continue
    }
    if (ch === '$' && i + 1 < before.length && before[i + 1] === '$') {
      blockDollarOpen = !blockDollarOpen
      i += 2
    } else if (ch === '$') {
      inlineDollarOpen = !inlineDollarOpen
      i += 1
    } else if (ch === '\n') {
      inlineDollarOpen = false // 行内区间不跨行；块级 $$ 保持
      i += 1
    } else {
      i += 1
    }
  }
  inMath = inlineDollarOpen || blockDollarOpen
  if (inMath) {
    return { scope: RuleScope.Formula }
  }
  return { scope: RuleScope.Text }
}
