// 文本段格式化算法测试（工单 #26）：大写（句首/句中）、边界空格状态机、
// 语言对加空格的 token 中心算法单元级断言。端到端全矩阵（语言对 × 字典 ×
// 大写开关 × 分区）见 lineFormatter.test.ts 上游验证矩阵。
import { describe, expect, it } from 'vitest'
import {
  applyLanguagePairSpacing,
  capitalizeFirstLetter,
  capitalizeMidSentence,
  detectBoundarySpaceState,
  type LanguagePair,
} from '../src/formatting/textFormatter'
import { PrefixDictionary } from '../src/formatting/prefixDictionary'
import { SpaceState } from '../src/formatting/inlineParts'

const DEFAULT_PAIRS: LanguagePair[] = [
  { a: 'chinese', b: 'english' },
  { a: 'chinese', b: 'digit' },
  { a: 'digit', b: 'english' },
]

describe('capitalizeFirstLetter（句首）', () => {
  const run = (content: string, curCh: number, prevCh: number | undefined, isCursorInPart: boolean) =>
    capitalizeFirstLetter({ content, curCh, prevCh, offset: 0 }, true, isCursorInPart).content

  it('光标在首分区内且目标字符刚键入 → 大写', () => {
    expect(run('abc', 1, 0, true)).toBe('Abc')
  })

  it('目标字符不在键入区间 → 不改', () => {
    expect(run('abc', 3, 2, true)).toBe('abc')
  })

  it('光标不在首分区 → 不改', () => {
    expect(run('abc', 1, 0, false)).toBe('abc')
  })

  it('prevCh undefined（非键入驱动）→ 不大写（上游守卫把 dstCharIndex 归 -1）', () => {
    expect(run('abc', 3, undefined, false)).toBe('abc')
  })

  it('标题/引用/任务项/包裹标记前缀形态', () => {
    expect(run('# abc', 3, 2, true)).toBe('# Abc')
    expect(run('> abc', 3, 2, true)).toBe('> Abc')
    expect(run('- [ ] abc', 7, 6, true)).toBe('- [ ] Abc')
    expect(run('**abc', 3, 2, true)).toBe('**Abc')
  })

  it('俄文字母在大写目标集内', () => {
    expect(run('привет', 1, 0, true)).toBe('Привет')
  })

  it('非首分区（isFirstPart=false）→ 原样', () => {
    const ctx = capitalizeFirstLetter({ content: 'abc', curCh: 1, prevCh: 0, offset: 0 }, false, true)
    expect(ctx.content).toBe('abc')
  })
})

describe('capitalizeMidSentence（句中）', () => {
  const run = (content: string, curCh: number, prevCh: number, offset = 0) =>
    capitalizeMidSentence({ content, curCh, prevCh, offset }).content

  it('半角句末标点 + 空白后的字母（键入区间内）→ 大写', () => {
    expect(run('end. next', 6, 5)).toBe('end. Next')
  })

  it('全角句末标点后的字母', () => {
    expect(run('结束。next', 4, 3)).toBe('结束。Next')
  })

  it('目标不在键入区间 → 不改', () => {
    expect(run('end. next', 9, 8)).toBe('end. next')
  })

  it('prevCh 经 offset 换算（分区中段）', () => {
    // 分区 offset=5：行坐标 prevCh=9/curCh=10 → 分区内 4/5，目标 w 在 [4,5)
    expect(run('xx. word', 10, 9, 5)).toBe('xx. Word')
  })

  it('包裹标记（加粗/斜体）后的大写仍生效', () => {
    expect(run('a. *b', 5, 4)).toBe('a. *B')
  })
})

describe('detectBoundarySpaceState（边界空格状态机）', () => {
  it('端点真实空白 → strict；端点软空格符号 → soft；否则 none', () => {
    expect(detectBoundarySpaceState(' 中文', '', '')).toEqual({ start: SpaceState.strict, end: SpaceState.none })
    expect(detectBoundarySpaceState('中文 ', '', '')).toEqual({ start: SpaceState.none, end: SpaceState.strict })
    expect(detectBoundarySpaceState('中文', '', '')).toEqual({ start: SpaceState.none, end: SpaceState.none })
    expect(detectBoundarySpaceState('。中文', '', '')).toEqual({ start: SpaceState.soft, end: SpaceState.none })
    expect(detectBoundarySpaceState('中文，', '', '')).toEqual({ start: SpaceState.none, end: SpaceState.soft })
  })

  it('自定义软空格符号：起点查右符号集、终点查左符号集（上游原样语义）', () => {
    // 起点侧消费 rightSymbols、终点侧消费 leftSymbols（上游命名如此，非笔误）
    expect(detectBoundarySpaceState('-中文', '', '-')).toEqual({ start: SpaceState.soft, end: SpaceState.none })
    expect(detectBoundarySpaceState('中文-', '-', '').end).toBe(SpaceState.soft)
    // 票面默认 '-' 是字面普通字符，不进任何符号集
    expect(detectBoundarySpaceState('-中文', '-', '')).toEqual({ start: SpaceState.none, end: SpaceState.none })
    expect(detectBoundarySpaceState('中文-', '', '-')).toEqual({ start: SpaceState.none, end: SpaceState.none })
  })

  it('<br> 视为软空格前提（无真实空白时 soft）', () => {
    expect(detectBoundarySpaceState('<br>中文', '', '')).toEqual({ start: SpaceState.soft, end: SpaceState.none })
    expect(detectBoundarySpaceState('中文<br>', '', '').end).toBe(SpaceState.soft)
  })

  it('内置集合：全角标点在起点/终点双侧命中；右括号与半角标点只在起点侧（右符号集）', () => {
    expect(detectBoundarySpaceState('（中文', '', '').start).toBe(SpaceState.soft) // （ 在右符号内置集
    expect(detectBoundarySpaceState('中文，', '', '').end).toBe(SpaceState.soft) // ， 在左符号内置集
    expect(detectBoundarySpaceState('中文)', '', '').end).toBe(SpaceState.none) // ) 不在左符号集
    expect(detectBoundarySpaceState(')中文', '', '').start).toBe(SpaceState.soft) // ) 在右符号集
    expect(detectBoundarySpaceState('.中文', '', '').start).toBe(SpaceState.soft) // . 在右符号集
  })

  it('\\0 光标标记不阻挡端点判定', () => {
    expect(detectBoundarySpaceState('\0中文', '', '').start).toBe(SpaceState.none)
    expect(detectBoundarySpaceState(' \0中文', '', '').start).toBe(SpaceState.strict)
  })
})

describe('applyLanguagePairSpacing（token 中心算法）', () => {
  const dict = new PrefixDictionary('n8n, b站')
  const run = (content: string, curCh: number, prevCh: number) =>
    applyLanguagePairSpacing({ content, curCh, prevCh, offset: 0 }, DEFAULT_PAIRS, dict)

  it('键入区间内的边界插入 + 光标右移', () => {
    const ctx = run('中文a\0', 3, 2)
    expect(ctx.content).toBe('中文 a\0')
    expect(ctx.curCh).toBe(4)
  })

  it('token 外的边界只按键入区间插（区间外不动）', () => {
    const ctx = run('中文 abc\0', 6, 5)
    expect(ctx.content).toBe('中文 abc\0')
  })

  it('词典词内部边界保护（n8n 的 n|8 在 token 内不插）', () => {
    const ctx = run('中文 n8\0', 5, 4)
    expect(ctx.content).toBe('中文 n8\0')
  })

  it('词典过期补插：越过词典词的首键 → 词内延迟边界补插', () => {
    // 键入 s（n8ns 的末字符）：prevToken=n8n 曾被抑制 → 边界 3、4 补插
    const ctx = run('中文 n8ns\0', 6, 5)
    expect(ctx.content).toBe('中文 n 8 ns\0')
    expect(ctx.curCh).toBe(8)
  })

  it('prevCh === curCh（Enter 定稿）→ 前缀不再抑制，词典过期的延迟边界补插', () => {
    // token 'n8' 是 n8n 的前缀：定稿模式只认精确命中 → 不抑制 → 过期成立
    // → token 内 n|8 边界越出（空的）键入区间补插
    const ctx = run('中文 n8\0', 5, 5)
    expect(ctx.content).toBe('中文 n 8\0')
    // 对照：精确命中（n8n）在定稿模式仍抑制
    const exact = run('中文 n8n\0', 6, 6)
    expect(exact.content).toBe('中文 n8n\0')
  })

  it('跨脚本词典词扩展：b站 作为整词抑制内部边界', () => {
    const ctx = run('中文 b站\0', 5, 4)
    expect(ctx.content).toBe('中文 b站\0')
  })

  it('无 prevCh（undefined）→ 原样返回', () => {
    const ctx = applyLanguagePairSpacing({ content: '中文a\0', curCh: 3, prevCh: undefined, offset: 0 }, DEFAULT_PAIRS, dict)
    expect(ctx.content).toBe('中文a\0')
  })

  it('空语言对 → 无边界可插', () => {
    const ctx = applyLanguagePairSpacing({ content: '中文a\0', curCh: 3, prevCh: 2, offset: 0 }, [], dict)
    expect(ctx.content).toBe('中文a\0')
  })
})
