// 相邻分区插空格判定（工单 #26）：上游 easy-typing-obsidian
// `src/formatting/inline_spacing.ts` 逐行移植——formatLine 中原 ~400 行
// switch-case 的判定核心，判定两个相邻 InlinePart 之间是否应插空格。
import { InlineType, SpaceState } from './inlineParts'

/** 空格策略相关设置子集（上游 EasyTypingSettings 的四键） */
export interface InlineSpacingSettings {
  inlineCodeSpaceMode: SpaceState
  inlineFormulaSpaceMode: SpaceState
  inlineLinkSpaceMode: SpaceState
  inlineLinkSmartSpace: boolean
}

/**
 * 相邻分区是否插空格（prevType 为 none = 行首 → 不插）。
 * text→非text / user→X / 非text→非text 三类邻接的通用判定；
 * 非text→text 的判定见 shouldPrependSpaceToText（text 内容可能先被改写）。
 */
export function shouldInsertSpaceBetweenParts(
  prevType: InlineType,
  curType: InlineType,
  prevTextEndSpaceState: SpaceState,
  prevPartRightSpaceRequire: SpaceState,
  curPartLeftSpaceRequire: SpaceState,
  settings: InlineSpacingSettings,
): boolean {
  if (prevType === InlineType.none) return false

  const modeOf = (type: InlineType): SpaceState => {
    switch (type) {
      case InlineType.code:
        return settings.inlineCodeSpaceMode
      case InlineType.formula:
        return settings.inlineFormulaSpaceMode
      case InlineType.wikilink:
      case InlineType.mdlink:
        return settings.inlineLinkSpaceMode
      default:
        return SpaceState.none
    }
  }

  // ── prev 为 text → 比较 cur 的策略与 text 尾部空格状态
  if (prevType === InlineType.text) {
    if (curType === InlineType.user) {
      return curPartLeftSpaceRequire > prevTextEndSpaceState
    }
    const curMode = modeOf(curType)
    return curMode > prevTextEndSpaceState
  }

  // ── prev 为 user（自定义保护区）→ prevPartRight + cur 策略
  if (prevType === InlineType.user) {
    if (curType === InlineType.text) {
      return prevPartRightSpaceRequire > SpaceState.none
    }
    if (curType === InlineType.user) {
      return curPartLeftSpaceRequire > SpaceState.none && prevPartRightSpaceRequire > SpaceState.none
    }
    const curMode = modeOf(curType)
    return curMode > SpaceState.none && prevPartRightSpaceRequire > SpaceState.none
  }

  // ── 双方均为非 text 非 user（code / formula / link）
  const prevMode = modeOf(prevType)
  const curMode = modeOf(curType)

  if (curType === InlineType.user) {
    return prevMode > SpaceState.none && curPartLeftSpaceRequire > SpaceState.none
  }

  return prevMode > SpaceState.none || curMode > SpaceState.none
}

/**
 * 非text→text：text 分区开头是否应前置空格（wikilink/mdlink 的智能空格
 * 由调用方单独处理，此处对链接仅承载非智能模式）。
 */
export function shouldPrependSpaceToText(
  prevType: InlineType,
  txtStartSpaceState: SpaceState,
  prevPartRightSpaceRequire: SpaceState,
  settings: InlineSpacingSettings,
): boolean {
  switch (prevType) {
    case InlineType.none:
      return false
    case InlineType.code:
      return settings.inlineCodeSpaceMode > txtStartSpaceState
    case InlineType.formula:
      return settings.inlineFormulaSpaceMode > txtStartSpaceState
    case InlineType.wikilink:
    case InlineType.mdlink:
      if (!settings.inlineLinkSmartSpace) {
        return settings.inlineLinkSpaceMode > txtStartSpaceState
      }
      // 智能空格由调用方链接专属逻辑处理
      return false
    case InlineType.user:
      return prevPartRightSpaceRequire > txtStartSpaceState
    default:
      return false
  }
}
