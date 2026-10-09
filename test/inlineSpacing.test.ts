// 相邻分区插空格判定测试（工单 #26）：上游 inline_spacing.ts 的
// shouldInsertSpaceBetweenParts / shouldPrependSpaceToText 判定矩阵
//（text/code/formula/link/user × 三档空格策略 × 智能链接开关）。
import { describe, expect, it } from 'vitest'
import { InlineType, SpaceState } from '../src/formatting/inlineParts'
import {
  shouldInsertSpaceBetweenParts,
  shouldPrependSpaceToText,
  type InlineSpacingSettings,
} from '../src/formatting/inlineSpacing'

function settings(overrides: Partial<InlineSpacingSettings> = {}): InlineSpacingSettings {
  return {
    inlineCodeSpaceMode: SpaceState.soft,
    inlineFormulaSpaceMode: SpaceState.soft,
    inlineLinkSpaceMode: SpaceState.soft,
    inlineLinkSmartSpace: true,
    ...overrides,
  }
}

describe('shouldInsertSpaceBetweenParts', () => {
  it('行首（prev none）→ 不插', () => {
    expect(shouldInsertSpaceBetweenParts(InlineType.none, InlineType.code, SpaceState.none, 0, 0, settings())).toBe(
      false,
    )
  })

  it('text → code/formula：策略 > 尾部空格状态才插', () => {
    const s = settings()
    expect(shouldInsertSpaceBetweenParts(InlineType.text, InlineType.code, SpaceState.none, 0, 0, s)).toBe(true)
    expect(shouldInsertSpaceBetweenParts(InlineType.text, InlineType.code, SpaceState.soft, 0, 0, s)).toBe(false)
    expect(shouldInsertSpaceBetweenParts(InlineType.text, InlineType.code, SpaceState.none, 0, 0, settings({ inlineCodeSpaceMode: SpaceState.none }))).toBe(false)
  })

  it('text → user：user 左要求 > 尾部状态', () => {
    const s = settings()
    expect(shouldInsertSpaceBetweenParts(InlineType.text, InlineType.user, SpaceState.none, 0, SpaceState.soft, s)).toBe(true)
    expect(shouldInsertSpaceBetweenParts(InlineType.text, InlineType.user, SpaceState.soft, 0, SpaceState.soft, s)).toBe(false)
  })

  it('user → text：只看 user 右要求 > none（与 text 头部状态的比较归 prepend 判定）', () => {
    const s = settings()
    expect(shouldInsertSpaceBetweenParts(InlineType.user, InlineType.text, SpaceState.none, SpaceState.strict, 0, s)).toBe(true)
    expect(shouldInsertSpaceBetweenParts(InlineType.user, InlineType.text, SpaceState.none, SpaceState.none, 0, s)).toBe(false)
  })

  it('user → user：双侧都 > none 才插', () => {
    const s = settings()
    expect(shouldInsertSpaceBetweenParts(InlineType.user, InlineType.user, 0, SpaceState.soft, SpaceState.soft, s)).toBe(true)
    expect(shouldInsertSpaceBetweenParts(InlineType.user, InlineType.user, 0, SpaceState.none, SpaceState.soft, s)).toBe(false)
  })

  it('非text → 非text（code/formula/link）：任一侧策略 > none 即插', () => {
    const s = settings()
    expect(shouldInsertSpaceBetweenParts(InlineType.code, InlineType.formula, 0, 0, 0, s)).toBe(true)
    expect(
      shouldInsertSpaceBetweenParts(
        InlineType.code,
        InlineType.formula,
        0,
        0,
        0,
        settings({ inlineCodeSpaceMode: SpaceState.none, inlineFormulaSpaceMode: SpaceState.none }),
      ),
    ).toBe(false)
  })
})

describe('shouldPrependSpaceToText', () => {
  it('prev none → false', () => {
    expect(shouldPrependSpaceToText(InlineType.none, SpaceState.none, 0, settings())).toBe(false)
  })

  it('code/formula → text：策略 > text 头部状态', () => {
    const s = settings()
    expect(shouldPrependSpaceToText(InlineType.code, SpaceState.none, 0, s)).toBe(true)
    expect(shouldPrependSpaceToText(InlineType.code, SpaceState.soft, 0, s)).toBe(false)
    expect(shouldPrependSpaceToText(InlineType.formula, SpaceState.none, 0, settings({ inlineFormulaSpaceMode: SpaceState.none }))).toBe(false)
  })

  it('link → text：智能开（链接专属逻辑另行处理，此处 false）；智能关走策略档', () => {
    expect(shouldPrependSpaceToText(InlineType.wikilink, SpaceState.none, 0, settings())).toBe(false)
    expect(
      shouldPrependSpaceToText(InlineType.mdlink, SpaceState.none, 0, settings({ inlineLinkSmartSpace: false })),
    ).toBe(true)
    expect(
      shouldPrependSpaceToText(InlineType.mdlink, SpaceState.soft, 0, settings({ inlineLinkSmartSpace: false })),
    ).toBe(false)
  })

  it('user → text：右要求 > text 头部状态', () => {
    const s = settings()
    expect(shouldPrependSpaceToText(InlineType.user, SpaceState.none, SpaceState.strict, s)).toBe(true)
    expect(shouldPrependSpaceToText(InlineType.user, SpaceState.strict, SpaceState.strict, s)).toBe(false)
  })
})
