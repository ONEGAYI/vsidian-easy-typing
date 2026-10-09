// 自动格式化管线测试（工单 #26）：planAutoFormatLineModification 的坐标
// 换算（doc↔行内）、上游触发门控矩阵（纯插入/单光标塌缩/粘贴联动/作用域
// 跳过/Enter 定稿）与计划形状。行级算法等价性由 lineFormatter 上游验证
// 矩阵承载，此处聚焦管线层。
import { describe, expect, it, vi } from 'vitest'
import {
  isInsideFrontmatter,
  planAutoFormatLineModification,
  type AutoFormatLineOptions,
  type AutoFormatPipelineContext,
} from '../src/autoFormatPipeline'
import { SpaceState } from '../src/formatting/inlineParts'
import type { LineFormatSettings } from '../src/formatting/lineFormatter'

function settings(overrides: Partial<LineFormatSettings> = {}): LineFormatSettings {
  return {
    languagePairs: [
      { a: 'chinese', b: 'english' },
      { a: 'chinese', b: 'digit' },
      { a: 'digit', b: 'english' },
    ],
    customScriptCategories: [],
    prefixDictionary: 'n8n, b站',
    autoCapital: false,
    softSpaceLeftSymbols: '-',
    softSpaceRightSymbols: '-',
    inlineCodeSpaceMode: SpaceState.soft,
    inlineFormulaSpaceMode: SpaceState.soft,
    inlineLinkSpaceMode: SpaceState.soft,
    inlineLinkSmartSpace: true,
    ...overrides,
  }
}

function options(o: Partial<AutoFormatLineOptions> = {}): AutoFormatLineOptions {
  return { settings: settings(), ...o }
}

/** 快照后形态的输入上下文（text 已含本次键入；head = 光标位） */
function ctx(
  text: string,
  head: number,
  inputText: string,
  extra: Partial<AutoFormatPipelineContext> = {},
): AutoFormatPipelineContext {
  return {
    userEvent: 'input.type',
    inputText,
    snapshot: { text, selections: [{ anchor: head, head }] },
    replaced: null,
    ...extra,
  }
}

describe('主路径：坐标换算与计划形状', () => {
  it('中文后键入半角字母 → 行内变更 + 光标右移（#25 零命中空位的承接）', () => {
    const plan = planAutoFormatLineModification(ctx('中文a', 3, 'a'), options())
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 3, text: '中文 a' }],
      selection: { anchor: 4, head: 4 },
    })
  })

  it('非行首文档：offset 随行起点平移', () => {
    // '第一行\n中文a'：行起点 4（第 0-2、换行 3）
    const plan = planAutoFormatLineModification(ctx('第一行\n中文a', 7, 'a'), options())
    expect(plan).toEqual({
      changes: [{ offset: 4, length: 3, text: '中文 a' }],
      selection: { anchor: 8, head: 8 },
    })
  })

  it('行内代码邻接的行内空格（天然保护区经分区处理，不跳行）', () => {
    // 键入 x（光标在行内代码之后的 text 尾部）：text→code 与 code→text
    // 双侧软空格（上游 code-both-sides 场景的同构）
    const plan = planAutoFormatLineModification(ctx('中文`a`x', 6, 'x'), options())
    expect(plan).toEqual({
      changes: [
        { offset: 0, length: 2, text: '中文 ' },
        { offset: 5, length: 1, text: ' x' },
      ],
      selection: { anchor: 8, head: 8 },
    })
  })

  it('IME 定稿（input.type.compose）同路径处理', () => {
    const plan = planAutoFormatLineModification(
      ctx('中文あ', 3, 'あ', { userEvent: 'input.type.compose' }),
      options({ settings: settings({ languagePairs: [{ a: 'chinese', b: 'japanese' }] }) }),
    )
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 3, text: '中文 あ' }],
      selection: { anchor: 4, head: 4 },
    })
  })

  it('无变更返回 null（纯英文行）', () => {
    expect(planAutoFormatLineModification(ctx('plain text', 10, 't'), options())).toBeNull()
  })
})

describe('Enter 定稿分支（inputText 含 \\n）', () => {
  it('定稿模式补插词典过期延迟边界；光标跨插入段平移', () => {
    // 回车定稿 "中文 n8"：n8 是 n8n 前缀 → 定稿只认精确命中 → n|8 边界补插
    const plan = planAutoFormatLineModification(ctx('中文 n8\n', 6, '\n'), options())
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 5, text: '中文 n 8' }],
      selection: { anchor: 7, head: 7 },
    })
  })

  it('普通行回车无延迟边界 → null', () => {
    expect(planAutoFormatLineModification(ctx('中文a\n', 4, '\n'), options())).toBeNull()
  })
})

describe('触发门控矩阵', () => {
  it('delete.* 事件不消费', () => {
    expect(
      planAutoFormatLineModification(ctx('中文a', 3, '', { userEvent: 'delete.backward' }), options()),
    ).toBeNull()
  })

  it('多光标不处理（inputText 多选区拼接无法归因）', () => {
    const plan = planAutoFormatLineModification(
      {
        userEvent: 'input.type',
        inputText: 'aa',
        snapshot: { text: '中文a中文a', selections: [{ anchor: 3, head: 3 }, { anchor: 8, head: 8 }] },
        replaced: null,
      },
      options(),
    )
    expect(plan).toBeNull()
  })

  it('非塌缩选区（选区替换形态）不处理（上游 notSelected 口径）', () => {
    const plan = planAutoFormatLineModification(
      {
        userEvent: 'input.type',
        inputText: 'a',
        snapshot: { text: 'a', selections: [{ anchor: 0, head: 1 }] },
        replaced: null,
      },
      options(),
    )
    expect(plan).toBeNull()
  })

  it('替换侧非空（键入替换选区）不处理（上游 changedStr.length < 1）', () => {
    const plan = planAutoFormatLineModification(
      ctx('中文a', 3, 'a', { replaced: { from: 2, to: 3, text: 'b' } }),
      options(),
    )
    expect(plan).toBeNull()
  })

  it('替换侧为空串（防御形态的纯插入）照常处理', () => {
    expect(
      planAutoFormatLineModification(ctx('中文a', 3, 'a', { replaced: { from: 2, to: 2, text: '' } }), options()),
    ).not.toBeNull()
  })

  it('inputText 为空不处理', () => {
    expect(planAutoFormatLineModification(ctx('中文', 2, ''), options())).toBeNull()
  })

  it('光标越界防御不处理', () => {
    expect(planAutoFormatLineModification(ctx('中文', 99, 'a'), options())).toBeNull()
  })

  it('inputText 与光标失配（fromB < 0）防御不处理', () => {
    expect(planAutoFormatLineModification(ctx('a', 1, 'ab'), options())).toBeNull()
  })
})

describe('#12 粘贴联动', () => {
  function markerWith(overrides: Partial<{ pasteDetected: boolean; plain: boolean }>) {
    const consumed: boolean[] = []
    let plain = overrides.plain === true
    const pasteDetected = overrides.pasteDetected === true
    return {
      marker: {
        get pasteDetected() {
          return pasteDetected
        },
        consumePlainPaste() {
          if (!plain) return false
          plain = false
          consumed.push(true)
          return true
        },
      },
      consumed,
    }
  }

  it('粘贴事务 userEvent（input.paste）→ 跳过并消费纯文本意图', () => {
    const { marker, consumed } = markerWith({ pasteDetected: true, plain: true })
    const plan = planAutoFormatLineModification(
      ctx('中文a', 3, 'a', { userEvent: 'input.paste' }),
      options({ marker }),
    )
    expect(plan).toBeNull()
    expect(consumed).toEqual([true])
  })

  it('粘贴标记窗内的普通键入 → 跳过（上游 pasteDetected 同构）', () => {
    const { marker } = markerWith({ pasteDetected: true, plain: false })
    expect(planAutoFormatLineModification(ctx('中文a', 3, 'a'), options({ marker }))).toBeNull()
  })

  it('无纯文本意图的粘贴命中：consumePlainPaste 返回 false、不抛错', () => {
    const { marker } = markerWith({ pasteDetected: true, plain: false })
    expect(marker.consumePlainPaste()).toBe(false)
  })

  it('粘贴窗过期后恢复正常格式化', () => {
    const { marker } = markerWith({ pasteDetected: false, plain: false })
    expect(planAutoFormatLineModification(ctx('中文a', 3, 'a'), options({ marker }))).not.toBeNull()
  })
})

describe('作用域跳过（文本降级版 getPosLineType）', () => {
  it('围栏代码块内不格式化', () => {
    const doc = '```js\nconst a = 1中文a\n```\n'
    // 光标在代码内容行尾（键入 a）
    const lineStart = 7
    const lineText = 'const a = 1中文a'
    const head = lineStart + lineText.length
    expect(planAutoFormatLineModification(ctx(doc, head, 'a'), options())).toBeNull()
  })

  it('块级公式（$$）内不格式化', () => {
    const doc = '$$\nx = 1中文a\n$$\n'
    const head = 3 + 'x = 1中文a'.length
    expect(planAutoFormatLineModification(ctx(doc, head, 'a'), options())).toBeNull()
  })

  it('frontmatter 内不格式化（闭合 --- 行计入，其后不计）', () => {
    // '---\ntitle: x\n---\n正文'：闭合行 [13,16)，其上 pos 计入；pos 17 起（正文）不计
    expect(isInsideFrontmatter('---\ntitle: x\n---\n正文', 4)).toBe(true)
    expect(isInsideFrontmatter('---\ntitle: x\n---\n正文', 14)).toBe(true)
    expect(isInsideFrontmatter('---\ntitle: x\n---\n正文', 17)).toBe(false)
    expect(isInsideFrontmatter('---\n未闭合', 8)).toBe(true)
    expect(isInsideFrontmatter('正文', 0)).toBe(false)
    // 管线侧：frontmatter 行内键入 → null
    expect(planAutoFormatLineModification(ctx('---\ntitle: 中文a', 13, 'a'), options())).toBeNull()
  })

  it('表格行依赖平台行为链门控，管线不重复判定（规格记录的口径）', () => {
    // 管线对表格行不做行级排除——平台表格格区门控先行；正文管道的表格式
    // 行照样走格式化（键入 a 于光标 9）
    const plan = planAutoFormatLineModification(ctx('| a | 中文a |', 9, 'a'), options())
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 11, text: '| a | 中文 a |' }],
      selection: { anchor: 10, head: 10 },
    })
  })
})

describe('保护区注入缝（#27）', () => {
  it('经 options.protectedRanges 传入行内区间 → 区段内不加空格', () => {
    const plan = planAutoFormatLineModification(
      ctx('中文abc', 5, 'c'),
      options({
        protectedRanges: [
          { begin: 2, end: 5, leftSpaceRequire: SpaceState.none, rightSpaceRequire: SpaceState.none },
        ],
      }),
    )
    expect(plan).toBeNull()
  })
})

describe('间谍形态核验（consumePlainPaste 单次性）', () => {
  it('纯文本意图一次性消费：第二次 consume 返回 false', () => {
    const consume = vi.fn(() => true)
    const marker = { pasteDetected: true, consumePlainPaste: consume }
    planAutoFormatLineModification(ctx('中文a', 3, 'a'), options({ marker }))
    expect(consume).toHaveBeenCalledTimes(1)
  })
})
