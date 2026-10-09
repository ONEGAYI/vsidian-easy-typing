// BetterBackspace 算法矩阵（工单 #8，TDD 先行）——移植上游
// easy-typing-obsidian src/keyboard_handlers.ts:311-472
// （backspaceEmptyQuote / backspaceEmptyListItem / handleBackspace）。
// 纯逻辑零平台依赖：以「行数组 + 光标行/列」驱动，期望值按上游语义
// 逐例标注；接入层（EditorState 决策与 keymap Command）见
// test/backspaceIntercept.test.ts。
//
// 矩阵维度（票面验收「列表类型 × 嵌套层级 × 上下文」）：
// - 列表类型：有序（1. / 1)）、无序（- * +）、任务、引用（嵌套层级）；
// - 嵌套层级：顶级（接管）、缩进项与引用内列表（让位平台，见
//   docs/specs/backspace.md「平台 Backspace 冲突核对」节）；
// - 上下文：首行 / 上一行列表 / 上一行引用 / 上一行普通文本；
// - 有序重编号：同层后续项顺延与各类截断。
import { describe, expect, it } from 'vitest'
import {
  applyEmptyPrefixBackspace,
  parseEmptyLinePrefix,
  planEmptyPrefixBackspace,
} from '../src/backspaceAlgorithm'

/** 行尾光标列（= 行长） */
function endCol(lines: readonly string[], line: number): number {
  return lines[line]!.length
}

/** 便捷断言：计划应用到行数组后的结果文本与光标（绝对偏移） */
function applied(
  lines: string[],
  cursorLine: number,
): { text: string; cursor: number } | null {
  const plan = planEmptyPrefixBackspace(lines, cursorLine, endCol(lines, cursorLine))
  if (plan === null) return null
  return applyEmptyPrefixBackspace(lines, plan)
}

// =====================================================
// 前缀解析（票面范围 1）
// =====================================================

describe('前缀解析 parseEmptyLinePrefix：空列表项形态', () => {
  it('无序三种标记 × 恰好一个尾空格 → list（上游 listMatchEmpty）', () => {
    expect(parseEmptyLinePrefix('- ')).toEqual({
      type: 'list', indent: '', bullet: '-', digits: '', delim: '',
    })
    expect(parseEmptyLinePrefix('* ')).toEqual({
      type: 'list', indent: '', bullet: '*', digits: '', delim: '',
    })
    expect(parseEmptyLinePrefix('+ ')).toEqual({
      type: 'list', indent: '', bullet: '+', digits: '', delim: '',
    })
  })

  it('有序 1. 与 1) 两种分隔符（票面扩展，上游仅 1.）', () => {
    expect(parseEmptyLinePrefix('1. ')).toEqual({
      type: 'list', indent: '', bullet: '', digits: '1', delim: '.',
    })
    expect(parseEmptyLinePrefix('1) ')).toEqual({
      type: 'list', indent: '', bullet: '', digits: '1', delim: ')',
    })
    expect(parseEmptyLinePrefix('10. ')).toEqual({
      type: 'list', indent: '', bullet: '', digits: '10', delim: '.',
    })
  })

  it('裸标记（无尾空格）与双空格不命中（上游语义：恰一个空格才算空项）', () => {
    // 上游 /^\s*([-*+]|\d+\.) $/——`-` `1.` 后无空格、或两个空格均不命中
    expect(parseEmptyLinePrefix('-')).toBeNull()
    expect(parseEmptyLinePrefix('1.')).toBeNull()
    expect(parseEmptyLinePrefix('-  ')).toBeNull()
  })

  it('带正文不命中（非空项）', () => {
    expect(parseEmptyLinePrefix('- a')).toBeNull()
    expect(parseEmptyLinePrefix('1. a')).toBeNull()
    expect(parseEmptyLinePrefix('-a')).toBeNull()
  })

  it('缩进空列表项可解析（嵌套形态——行为层让位，见拦截矩阵）', () => {
    expect(parseEmptyLinePrefix('  - ')).toEqual({
      type: 'list', indent: '  ', bullet: '-', digits: '', delim: '',
    })
  })
})

describe('前缀解析 parseEmptyLinePrefix：空任务项形态', () => {
  it('任务标记（勾选与未勾选、大小写 X）', () => {
    expect(parseEmptyLinePrefix('- [ ] ')).toEqual({
      type: 'task', indent: '', bullet: '-', checked: false,
    })
    expect(parseEmptyLinePrefix('- [x] ')).toEqual({
      type: 'task', indent: '', bullet: '-', checked: true,
    })
    expect(parseEmptyLinePrefix('* [X] ')).toEqual({
      type: 'task', indent: '', bullet: '*', checked: true,
    })
  })

  it('任务框后无尾空格同样算空任务项（对齐引用分支的可选空格语义）', () => {
    expect(parseEmptyLinePrefix('- [ ]')).toEqual({
      type: 'task', indent: '', bullet: '-', checked: false,
    })
  })

  it('任务框后带正文不命中', () => {
    expect(parseEmptyLinePrefix('- [ ] a')).toBeNull()
    expect(parseEmptyLinePrefix('- []')).toBeNull()
  })
})

describe('前缀解析 parseEmptyLinePrefix：空引用行形态', () => {
  it('> 串 + 可选一个尾空格（上游 quoteMatchEmpty）', () => {
    expect(parseEmptyLinePrefix('>')).toEqual({ type: 'quote', indent: '', level: 1 })
    expect(parseEmptyLinePrefix('> ')).toEqual({ type: 'quote', indent: '', level: 1 })
    expect(parseEmptyLinePrefix('>>')).toEqual({ type: 'quote', indent: '', level: 2 })
    expect(parseEmptyLinePrefix('>>> ')).toEqual({ type: 'quote', indent: '', level: 3 })
  })

  it('> 层间有空格（> >）不命中——上游 (>+ ) 只认连续 >', () => {
    expect(parseEmptyLinePrefix('> > ')).toBeNull()
    expect(parseEmptyLinePrefix('> >')).toBeNull()
  })

  it('带缩进的空引用行可解析（行为层接管，引用嵌套由 > 数表达）', () => {
    expect(parseEmptyLinePrefix('  >> ')).toEqual({ type: 'quote', indent: '  ', level: 2 })
  })

  it('引用带正文不命中', () => {
    expect(parseEmptyLinePrefix('> a')).toBeNull()
    expect(parseEmptyLinePrefix('>> a')).toBeNull()
  })
})

// =====================================================
// 清除与重编号（票面范围 2）——列表类型 × 上下文矩阵
// =====================================================

describe('空列表项清除：上下文分支（上游 backspaceEmptyListItem）', () => {
  it('上一行是列表项 → 删除当前行合并到上一行末尾（含换行）', () => {
    // 上游：prevListMatch 命中 → 删 prevLine.to 到 line.to（吃掉换行与整行）
    expect(applied(['- a', '- '], 1)).toEqual({ text: '- a', cursor: 3 })
  })

  it('上一行列表项的判定含四种有序/无序形态（上游 ^\\s*([-*+]|\\d+\\.)\\s 的 1) 扩展）', () => {
    // 无序 → 有序空项；有序 → 无序空项；1) 与 1. 均认
    expect(applied(['- a', '1. '], 1)).toEqual({ text: '- a', cursor: 3 })
    expect(applied(['1. a', '- '], 1)).toEqual({ text: '1. a', cursor: 4 })
    expect(applied(['1) a', '1) '], 1)).toEqual({ text: '1) a', cursor: 4 })
  })

  it('上一行是普通文本 → 清空当前行内容（留空行，上游同）', () => {
    expect(applied(['abc', '- '], 1)).toEqual({ text: 'abc\n', cursor: 4 })
  })

  it('文档首行 → 清空当前行内容', () => {
    expect(applied(['1. '], 0)).toEqual({ text: '', cursor: 0 })
    expect(applied(['- '], 0)).toEqual({ text: '', cursor: 0 })
  })

  it('清行分支与平台 clear 语义等价（- a 后的空项退格一步清整段前缀）', () => {
    // 上一行非列表：留空行——与 vsidian stripListLayer 顶级 clear 结果一致，
    // 接管不改变结果（核对结论见规格「平台 Backspace 冲突核对」节）
    expect(applied(['a', 'b', '- '], 2)).toEqual({ text: 'a\nb\n', cursor: 4 })
  })
})

describe('有序列表重编号：同层后续项顺延（上游语义）', () => {
  it('删除有序空项后同层后续项各减一（1. 形态）', () => {
    // 上游：删 2. 行后 3. 4. 顺延为 2. 3.
    expect(applied(['1. a', '2. ', '3. b', '4. c'], 1)).toEqual({
      text: '1. a\n2. b\n3. c',
      cursor: 4,
    })
  })

  it('1) 形态同样顺延且保留分隔符（票面 1) 扩展）', () => {
    expect(applied(['1) a', '2) ', '3) b'], 1)).toEqual({
      text: '1) a\n2) b',
      cursor: 4,
    })
  })

  it('编号不连续（跳号）即停——只顺延恰好连续的项（上游 expectedNextNumber 语义）', () => {
    // 3. 之后是 5.（期望 4.）→ 停，5. 保持
    expect(applied(['1. a', '2. ', '3. b', '5. c'], 1)).toEqual({
      text: '1. a\n2. b\n5. c',
      cursor: 4,
    })
  })

  it('缩进不同的后续项不重编号（同层限定）', () => {
    // 2. 删除后：3. 同层顺延为 2.；缩进的 4. 不动
    expect(applied(['1. a', '2. ', '3. b', '  4. c'], 1)).toEqual({
      text: '1. a\n2. b\n  4. c',
      cursor: 4,
    })
  })

  it('后续遇到非有序行即停（无序项/普通文本都截断）', () => {
    expect(applied(['1. a', '2. ', '3. b', '- c'], 1)).toEqual({
      text: '1. a\n2. b\n- c',
      cursor: 4,
    })
    expect(applied(['1. a', '2. ', '3. b', 'text'], 1)).toEqual({
      text: '1. a\n2. b\ntext',
      cursor: 4,
    })
  })

  it('无序空项删除不触发重编号（上游 expectedNextNumber = null）', () => {
    expect(applied(['- a', '- ', '3. b'], 1)).toEqual({
      text: '- a\n3. b',
      cursor: 3,
    })
  })

  it('清行分支（上一行非列表）同样重编号后续同层项', () => {
    // 上游重编号在 backspaceEmptyListItem 尾部无条件执行（当前行有序即扫）
    expect(applied(['abc', '2. ', '3. b'], 1)).toEqual({
      text: 'abc\n\n2. b',
      cursor: 4,
    })
  })

  it('多位数与多空格 gap：编号减一、分隔符与缩进原样保留', () => {
    // 10. → 9.（宽度不保——上游 replace 语义，写什么就是什么）
    expect(applied(['9. a', '10. ', '11. b'], 1)).toEqual({
      text: '9. a\n10. b',
      cursor: 4,
    })
  })
})

// =====================================================
// 嵌套层级：让位面与引用层级
// =====================================================

describe('嵌套让位：缩进空列表项与任务项不接管', () => {
  it('缩进空列表项 → null（让位平台 dedent/clear——树判升级更准，上游文本近似在此有破坏性）', () => {
    // 上游会因上一行匹配列表前缀而误删子项行（- a\n  2.  → 合并丢缩进）；
    // 让位后由 vsidian stripListLayer 按语法树 dedent 升一级
    expect(applied(['- a', '  - '], 1)).toBeNull()
    expect(applied(['1. a', '  2. '], 1)).toBeNull()
  })

  it('首行缩进空项同样让位（GFM 顶级缩进由平台树判定）', () => {
    expect(applied(['  - '], 0)).toBeNull()
  })

  it('空任务项 → null（让位平台一次清整段前缀——上游本不命中任务形态）', () => {
    expect(applied(['- a', '- [ ] '], 1)).toBeNull()
    expect(applied(['- [x] '], 0)).toBeNull()
  })

  it('引用内列表空项 → null（上游 quoteMatchEmpty/listMatchEmpty 均不命中 > 开头行）', () => {
    expect(applied(['> a', '> - '], 1)).toBeNull()
  })
})

describe('空引用行清除：层级 × 上下文分支（上游 backspaceEmptyQuote）', () => {
  // 多级引用命中形态是紧凑 > 串（>>、>>>）——层间带空格的 > > 上游
  // 正则 ^(\s*)(>+) ?$ 本就不命中（解析矩阵已钉住），不在本分支

  it('多级 + 上一行是完全相同的空引用行 → 两行同时降一级（联降）', () => {
    // 上游：两行同 indent 同 level → 替换为两行 indent + '>'*(level-1) + ' '，
    // 光标在替换文本末尾（= 新第二行行尾）
    expect(applied(['>> ', '>> '], 1)).toEqual({ text: '> \n> ', cursor: 5 })
  })

  it('多级 + 上一行其他形态 → 当前行降一级', () => {
    expect(applied(['> a', '>> '], 1)).toEqual({ text: '> a\n> ', cursor: 6 })
    expect(applied(['abc', '>> '], 1)).toEqual({ text: 'abc\n> ', cursor: 6 })
    expect(applied(['>> '], 0)).toEqual({ text: '> ', cursor: 2 })
  })

  it('降级保留引用前导缩进（与上游联降分支一致；上游单行分支丢缩进属内部不一致，规格记录）', () => {
    expect(applied(['  >> '], 0)).toEqual({ text: '  > ', cursor: 4 })
  })

  it('单级 + 上一行是引用（任意内容）→ 删除当前行合并到上一行末尾', () => {
    expect(applied(['> a', '> '], 1)).toEqual({ text: '> a', cursor: 3 })
  })

  it('单级 + 上一行非引用 → 清空当前行内容（留空行）', () => {
    expect(applied(['abc', '> '], 1)).toEqual({ text: 'abc\n', cursor: 4 })
    expect(applied(['> '], 0)).toEqual({ text: '', cursor: 0 })
  })

  it('三级引用降二级', () => {
    expect(applied(['>>> '], 0)).toEqual({ text: '>> ', cursor: 3 })
  })
})

// =====================================================
// 入口门槛（上游 handleBackspace）
// =====================================================

describe('入口门槛：光标位置', () => {
  it('光标不在行尾 → null（上游 selection.anchor == line.to）', () => {
    const lines = ['- ']
    expect(planEmptyPrefixBackspace(lines, 0, 0)).toBeNull()
    expect(planEmptyPrefixBackspace(lines, 0, 1)).toBeNull()
  })

  it('行号越界 → null', () => {
    expect(planEmptyPrefixBackspace(['- '], 1, 0)).toBeNull()
    expect(planEmptyPrefixBackspace(['- '], -1, 2)).toBeNull()
  })

  it('普通空行与普通文本 → null（透传）', () => {
    expect(applied(['', ''], 1)).toBeNull()
    expect(applied(['abc'], 0)).toBeNull()
  })
})
