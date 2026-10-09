// 自定义正则保护区（工单 #27）：用户声明正则区块，区内文本不做任何
// 格式化——格式化精度的重要逃生舱。上游 easy-typing-obsidian
// src/core.ts:525-634（splitTextWithLinkAndUserDefined +
// isCursorInUserDefinedRegexBlock）与 str2SpaceState（L636-647）的移植。
//
// 【纯逻辑边界】本模块零平台依赖（仅 formatting/inlineParts 相对导入 +
// logging），解析与逐行匹配均不触及平台——设置消费在接入层
//（autoFormatIntercept / ruleBehaviorIntercept）。
//
// 【解析语义】（上游 core.ts:536-570 忠实移植）：
// - UserDefinedRegExp 按行拆分；空行/纯空白行与 `//` 开头的注释行跳过
//   （上游 regNull `/^\s*$|^\/\//`；g 标志跨行 lastIndex 状态怪癖是无意
//   bug，取其意图语义的无状态实现——每行独立判定，默认模板行为两侧一致，
//   记录于 docs/specs/protected-zones.md）；
// - 每行行尾必须是 `|xy` 旗标（x/y ∈ {+,-,=}），前段为正则体；无旗标或
//   长度 ≤ 3 的行跳过（上游 regSRequire + Notice → 本仓 debugLog）；
// - 旗标映射（上游 str2SpaceState）：`+` strict、`=` soft、`-` none；
// - 非法正则跳过不抛出（上游 try/catch console.error → debugLog）。
//
// 【匹配语义】（上游 matchWithReg checkArray=true）：
// - wikilink / mdlink 命中（上游正则逐字，inlineParts 单一事实源）先落位
//   作为冲突基线，与基线重叠的用户正则命中弃用；
// - 多用户规则先到先得：后序规则的命中与已落位区间重叠即弃；
// - 同一正则的多次命中由 g 标志游标推进天然不重叠，互不检查（上游同构）。
//
// 【防御差异】可零宽匹配的正则（如 `x*`）上游会死循环（exec 零宽命中
// lastIndex 不前进）；本移植跳过零宽命中并手动推进游标——上游默认模板
// 无零宽形态，行为只在用户自写零宽正则时分歧（记录于规格）。
import { debugLog } from './logging'
import { REG_MDLINK, REG_WIKILINK, SpaceState, type ProtectedInlineRange } from './formatting/inlineParts'

/** 解析后的一条用户自定义正则（旗标已折算为空格要求三档） */
export interface UserDefinedRegexRule {
  /** 正则体原文（不含行尾 |xy 旗标） */
  readonly source: string
  readonly leftSpaceRequire: SpaceState
  readonly rightSpaceRequire: SpaceState
}

/** 行尾旗标（|xy）与空行/注释行判定（上游 regNull / regSRequire 的无状态形） */
const REG_SKIP_LINE = /^\s*$|^\/\//
const REG_SPACE_FLAG = /\|[\-=\+][\-=\+]$/

/** 旗标字符 → 空格要求（上游 str2SpaceState 逐字） */
function flagToSpaceState(ch: string): SpaceState {
  switch (ch) {
    case '+':
      return SpaceState.strict
    case '=':
      return SpaceState.soft
    case '-':
    default:
      return SpaceState.none
  }
}

/**
 * 解析 UserDefinedRegExp 多行字符串 → 规则列表（保留行序——匹配冲突
 * 检查按「先到先得」依赖此序）。非法行 debugLog 留痕后跳过，不抛出。
 */
export function parseUserDefinedRegExp(regExps: string): readonly UserDefinedRegexRule[] {
  const rules: UserDefinedRegexRule[] = []
  const lines = regExps.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (REG_SKIP_LINE.test(line)) continue
    if (!REG_SPACE_FLAG.test(line) || line.length <= 3) {
      debugLog(`easy-typing: 第${i}行自定义正则不符合规范\n${line}`)
      continue
    }
    const source = line.substring(0, line.length - 3)
    const flag = line.substring(line.length - 3)
    try {
      new RegExp(source, 'g') // 试构校验（上游同构；规则结构不存 regexp，匹配时现构防 lastIndex 跨调用泄漏）
    } catch (error) {
      debugLog('easy-typing: invalid user defined regexp:', source, error)
      continue
    }
    rules.push({
      source,
      leftSpaceRequire: flagToSpaceState(flag.charAt(1)),
      rightSpaceRequire: flagToSpaceState(flag.charAt(2)),
    })
  }
  return rules
}

/** 重叠判定（上游 matchWithReg：严格相交，端点相接不算） */
function overlaps(
  a: { begin: number; end: number },
  b: { begin: number; end: number },
): boolean {
  return a.end > b.begin && b.end > a.begin
}

/**
 * 一行文本 → 保护区区间集（行内坐标 [begin, end)，按 begin 升序）。
 *
 * 上游 matchWithReg(checkArray=true) 语义：wikilink/mdlink 命中先落位为
 * 冲突基线，用户规则逐条匹配、与已落位区间重叠的命中弃用；零宽命中跳过
 * （防上游死循环的防御差异，见头注）。
 */
export function matchProtectedRanges(
  line: string,
  rules: readonly UserDefinedRegexRule[],
): readonly ProtectedInlineRange[] {
  // 冲突基线：wikilink 全部先收集，mdlink 后收集（上游顺序，互不检查）
  const occupied: Array<{ begin: number; end: number }> = []
  for (const reg of [REG_WIKILINK, REG_MDLINK]) {
    reg.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = reg.exec(line)) !== null) {
      occupied.push({ begin: match.index, end: reg.lastIndex })
    }
  }

  const result: ProtectedInlineRange[] = []
  for (const rule of rules) {
    let regexp: RegExp
    try {
      regexp = new RegExp(rule.source, 'g')
    } catch {
      continue // parse 已校验；此处防御（source 手改后仍不抛）
    }
    while (true) {
      const match = regexp.exec(line)
      if (match === null) break
      const span = { begin: match.index, end: regexp.lastIndex }
      if (span.end === span.begin) {
        regexp.lastIndex += 1 // 零宽命中：跳过并推进（防死循环防御）
        continue
      }
      if (!occupied.some((o) => overlaps(span, o))) {
        occupied.push(span)
        result.push({
          begin: span.begin,
          end: span.end,
          leftSpaceRequire: rule.leftSpaceRequire,
          rightSpaceRequire: rule.rightSpaceRequire,
        })
      }
    }
  }
  return result.sort((a, b) => a.begin - b.begin)
}

/**
 * 行内列是否落在保护区内（上游 isCursorInUserDefinedRegexBlock：
 * column ∈ [begin, end) 半开区间）。「用户规则尊重保护区」开关的判定核。
 */
export function isPositionProtected(
  line: string,
  column: number,
  rules: readonly UserDefinedRegexRule[],
): boolean {
  return matchProtectedRanges(line, rules).some((r) => column >= r.begin && column < r.end)
}
