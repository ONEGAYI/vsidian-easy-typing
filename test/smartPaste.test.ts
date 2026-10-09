// SmartPaste 纯逻辑矩阵（工单 #12 算法层）——目标行形态 × 粘贴内容形态
// 的续接决策。上游对照 easy-typing-obsidian `src/cm_extensions.ts:168-263`
//（SmartPaste 粘贴事务分支）：listMatch/quoteMatch 目标识别、min_indent
// 公共缩进剥离、paste_list 列表形态判定与三分支续接（列表续行 / 首项并
// 入 / 逐行加前缀）。期望值按上游算法逐例推导；与上游的差异（缩进单位、
// 恒等透传等）在 docs/specs/smart-paste.md「与上游的差异」节逐条落档。
import { describe, expect, it } from 'vitest'
import {
  commonMinIndent,
  isListShapedLines,
  normalizeClipboardText,
  parseSmartPasteTarget,
  planSmartPasteContinuation,
} from '../src/smartPasteAlgorithm'

/** 目标行解析断言简写：kind + prefix + 续行缩进 */
function expectTarget(line: string, kind: 'list' | 'quote', prefix: string, continuationIndent: string) {
  const target = parseSmartPasteTarget(line)
  expect(target).not.toBeNull()
  expect(target).toMatchObject({ kind, prefix, continuationIndent })
}

describe('parseSmartPasteTarget：目标行前缀识别（上游 listMatch/quoteMatch）', () => {
  it('无序列表三种标记与有序列表（含多位数）', () => {
    expectTarget('- item', 'list', '- ', '')
    expectTarget('* item', 'list', '* ', '')
    expectTarget('+ item', 'list', '+ ', '')
    expectTarget('1. item', 'list', '1. ', '')
    expectTarget('10. item', 'list', '10. ', '')
  })

  it('任务项形态（标记含 [ ]/[x]）', () => {
    expectTarget('- [ ] todo', 'list', '- [ ] ', '')
    expectTarget('* [x] done', 'list', '* [x] ', '')
  })

  it('带缩进的列表与引用：prefix 保留缩进原文、续行缩进转空格（长度口径）', () => {
    expectTarget('  - nested', 'list', '  - ', '  ')
    expectTarget('\t- tabbed', 'list', '\t- ', ' ')
    expectTarget('  > quote', 'quote', '  > ', '  ')
  })

  it('引用行：紧凑多级串与层间带空格形态（上游 >+ 只取第一段）', () => {
    expectTarget('> quote', 'quote', '> ', '')
    expectTarget('>> deep', 'quote', '>> ', '')
    expectTarget('>>> deeper', 'quote', '>>> ', '')
    // 上游正则 ^(\s*)(>+)(\s)? 在首个 > 段后停止：`> > q` 视作单级引用
    expectTarget('> > spaced', 'quote', '> ', '')
  })

  it('引用行无尾随空格也算目标（prefix 归一为一个空格）', () => {
    expectTarget('>nospace', 'quote', '> ', '')
  })

  it('非目标行 → null（普通文本 / 表格 / 空行 / 标记无空格）', () => {
    expect(parseSmartPasteTarget('plain text')).toBeNull()
    expect(parseSmartPasteTarget('| a | b |')).toBeNull()
    expect(parseSmartPasteTarget('')).toBeNull()
    expect(parseSmartPasteTarget('-nospace')).toBeNull()
    expect(parseSmartPasteTarget('1.nospace')).toBeNull()
  })
})

describe('commonMinIndent：非空行公共缩进（上游 min_indent_space）', () => {
  it('取非空行前导空白的最小值；全空行 = Infinity（substring 全保留）', () => {
    expect(commonMinIndent(['  a', '    b', '  c'])).toBe(2)
    expect(commonMinIndent(['a', 'b'])).toBe(0)
    expect(commonMinIndent(['', '  ', ''])).toBe(Infinity)
  })

  it('Tab 计一个字符（上游 /^\s*/ 长度口径）', () => {
    expect(commonMinIndent(['\ta', '\t\tb'])).toBe(1)
  })
})

describe('isListShapedLines：粘贴内容列表形态判定（上游 paste_list）', () => {
  it('全部为列表项 / 空行 → 列表形态', () => {
    expect(isListShapedLines(['- a', '- b'])).toBe(true)
    expect(isListShapedLines(['1. a', '', '2. b'])).toBe(true)
    expect(isListShapedLines(['', ''])).toBe(true)
  })

  it('列表项 + 缩进 ≥ 公共缩进+2 的续行 → 列表形态', () => {
    expect(isListShapedLines(['- a', '  wrapped', '- b'])).toBe(true)
    expect(isListShapedLines(['  - a', '    wrapped'])).toBe(true)
  })

  it('非列表行缩进不足（< min+2）→ 非列表形态', () => {
    expect(isListShapedLines(['- a', 'wrapped', '- b'])).toBe(false)
    expect(isListShapedLines(['  - a', '  zz'])).toBe(false)
    expect(isListShapedLines(['plain', '    indented'])).toBe(false)
  })
})

describe('planSmartPasteContinuation：列表目标 × 粘贴内容矩阵', () => {
  const listTarget = parseSmartPasteTarget('- item')!
  const indentedListTarget = parseSmartPasteTarget('  - item')!
  const orderedTarget = parseSmartPasteTarget('1. item')!
  const taskTarget = parseSmartPasteTarget('- [ ] todo')!

  it('纯文本单行 → 原样（首行不加前缀；恒等由拦截层透传）', () => {
    expect(planSmartPasteContinuation(listTarget, 'plain')).toBe('plain')
  })

  it('纯文本多行 → 首行原样、其余行加列表前缀', () => {
    expect(planSmartPasteContinuation(listTarget, 'aa\nbb\ncc')).toBe('aa\n- bb\n- cc')
  })

  it('粘贴列表单行 → 剥标记并入当前项（上游首项去标记）', () => {
    expect(planSmartPasteContinuation(listTarget, '- x')).toBe('x')
    expect(planSmartPasteContinuation(orderedTarget, '9. x')).toBe('x')
    expect(planSmartPasteContinuation(taskTarget, '- [x] done')).toBe('done')
  })

  it('粘贴列表多行 → 首项剥标记并入、其余项保留自身标记（不重编号）', () => {
    expect(planSmartPasteContinuation(listTarget, '- x\n- y')).toBe('x\n- y')
    expect(planSmartPasteContinuation(listTarget, '1. x\n2. y\n3. z')).toBe('x\n2. y\n3. z')
  })

  it('带公共缩进的粘贴列表 → 先剥公共缩进再续接', () => {
    expect(planSmartPasteContinuation(listTarget, '  - a\n  - b')).toBe('a\n- b')
  })

  it('缩进列表目标 → 续行加目标缩进（缩进转空格）', () => {
    expect(planSmartPasteContinuation(indentedListTarget, '- x\n- y')).toBe('x\n  - y')
    expect(planSmartPasteContinuation(indentedListTarget, 'aa\nbb')).toBe('aa\n  - bb')
  })

  it('粘贴列表带续行（wrapped）→ 续行保持自身缩进随项走', () => {
    expect(planSmartPasteContinuation(listTarget, '- a\n  wrapped\n- b')).toBe('a\n  wrapped\n- b')
  })

  it('首行为空行 → 空行不加前缀（上游 index===0 分支）', () => {
    expect(planSmartPasteContinuation(listTarget, '\n- x')).toBe('\n- x')
  })

  it('粘贴内容混入非列表行（缩进不足）→ 整体退回逐行加前缀', () => {
    expect(planSmartPasteContinuation(listTarget, '- a\nwrapped')).toBe('- a\n- wrapped')
  })

  it('粘贴列表带 Tab 续行 → Tab 按缩进单位替换（缺省两空格，对齐平台缩进模型）', () => {
    // '\t\t' 宽 2 ≥ min+2 → 列表形态续行；每个 Tab 替换为缩进单位
    expect(planSmartPasteContinuation(listTarget, '- a\n\t\twrapped', { indentChar: '  ' })).toBe('a\n    wrapped')
    expect(planSmartPasteContinuation(listTarget, '- a\n\t\twrapped', { indentChar: '\t' })).toBe('a\n\t\twrapped')
    // 单 Tab 缩进不足 min+2 → 整体退回逐行前缀分支，Tab 仍替换
    expect(planSmartPasteContinuation(listTarget, '- a\n\twrapped')).toBe('- a\n-   wrapped')
  })
})

describe('planSmartPasteContinuation：引用目标 × 粘贴内容矩阵', () => {
  const quoteTarget = parseSmartPasteTarget('> quote')!
  const deepQuoteTarget = parseSmartPasteTarget('>> quote')!
  const indentedQuoteTarget = parseSmartPasteTarget('  > quote')!

  it('纯文本单行 → 原样', () => {
    expect(planSmartPasteContinuation(quoteTarget, 'plain')).toBe('plain')
  })

  it('纯文本多行 → 首行原样、其余行加引用前缀（多级/缩进引用同构）', () => {
    expect(planSmartPasteContinuation(quoteTarget, 'aa\nbb')).toBe('aa\n> bb')
    expect(planSmartPasteContinuation(deepQuoteTarget, 'aa\nbb')).toBe('aa\n>> bb')
    expect(planSmartPasteContinuation(indentedQuoteTarget, 'aa\nbb')).toBe('aa\n  > bb')
  })

  it('粘贴列表入引用目标 → 非列表目标走逐行前缀分支（第二行起含标记加前缀）', () => {
    // 上游 `paste_list && listMatch`：引用目标 listMatch 为 null → else 分支
    expect(planSmartPasteContinuation(quoteTarget, '- x\n- y')).toBe('- x\n> - y')
  })

  it('粘贴引用内容 → 不做引用特判，逐行加目标前缀（上游语义保持）', () => {
    expect(planSmartPasteContinuation(quoteTarget, '>> a\n>> b')).toBe('>> a\n> >> b')
  })

  it('首行为空行 → 空行不加前缀', () => {
    expect(planSmartPasteContinuation(quoteTarget, '\naa')).toBe('\n> aa')
  })
})

describe('planSmartPasteContinuation：边界形态', () => {
  const listTarget = parseSmartPasteTarget('- item')!

  it('空串 → 空串', () => {
    expect(planSmartPasteContinuation(listTarget, '')).toBe('')
  })

  it('全空行粘贴 → 公共缩进 Infinity，substring 越界为空串（上游同）', () => {
    expect(planSmartPasteContinuation(listTarget, '  \n  ')).toBe('\n')
    expect(planSmartPasteContinuation(listTarget, '\n')).toBe('\n')
  })

  it('比公共缩进长的空行剥去公共缩进、短的剥至空串（substring 缺省 end=length）', () => {
    // min=2（'  - a' 定义）：'   '（3 空格）→ 剥 2 剩 ' '；' '（1 空格）→ 越界 ''
    expect(planSmartPasteContinuation(listTarget, '  - a\n   \n  - b')).toBe('a\n \n- b')
    expect(planSmartPasteContinuation(listTarget, '  - a\n \n  - b')).toBe('a\n\n- b')
  })

  it('行尾粘贴带尾随换行（复制整行常见形态）→ 产出新空项行', () => {
    expect(planSmartPasteContinuation(listTarget, 'abc\n')).toBe('abc\n- ')
  })
})

describe('normalizeClipboardText：剪贴板换行归一', () => {
  it('CRLF / CR → LF（CM6 文档坐标全程 LF，算法只收 LF）', () => {
    expect(normalizeClipboardText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
    expect(normalizeClipboardText('')).toBe('')
  })
})
