// 行级格式化编排（工单 #26）：上游 easy-typing-obsidian `src/core.ts`
// LineFormater.formatLine / formatLineOfDoc 的移植——逐分区跑大写、语言对
// 加空格，再经边界空格状态机与分区空格策略处理分区邻接，产出行内变更表。
//
// 与上游的平台映射差异（记录于 docs/specs/auto-format.md）：
// - 分区切分：上游 parseLineWithSyntaxTree 经 CM6 syntaxTree 切
//   code/formula，本移植用文本降级版 splitLineIntoParts（见 inlineParts.ts）
//   ——保护区（user）区间集经 options.protectedRanges 注入（#27 缝）；
// - 输入输出：上游 formatLine(state, lineNum, ...) 从 EditorState 取行，
//   本移植收纯字符串（curCh/prevCh 行内坐标）返回
//   {line, cursorCh, changes}——坐标换算（doc↔行内）归管线层
//   （autoFormatPipeline.ts，对应上游 formatLineOfDoc 的职责）；
// - 行级重排的 \0 光标标记、$\\qquad$ 计为文本空隔、链接智能空格双分支
//   等行为语义逐行保留。
import { InlinePart, InlineType, SpaceState, splitLineIntoParts, type ProtectedInlineRange } from './inlineParts'

/** 保护区注入缝类型再导出（管线与接入层经 lineFormatter 单一入口消费） */
export type { ProtectedInlineRange }
import {
  applyLanguagePairSpacing,
  capitalizeFirstLetter,
  capitalizeMidSentence,
  detectBoundarySpaceState,
  type LanguagePair,
  type TextFormatContext,
} from './textFormatter'
import { PrefixDictionary } from './prefixDictionary'
import { shouldInsertSpaceBetweenParts, shouldPrependSpaceToText } from './inlineSpacing'
import type { CustomScriptDef } from './scriptCategory'

/** 行格式化设置（上游 EasyTypingSettings 中行格式化消费的子集） */
export interface LineFormatSettings {
  languagePairs: LanguagePair[]
  customScriptCategories?: CustomScriptDef[]
  prefixDictionary: string
  autoCapital: boolean
  softSpaceLeftSymbols: string
  softSpaceRightSymbols: string
  inlineCodeSpaceMode: SpaceState
  inlineFormulaSpaceMode: SpaceState
  inlineLinkSpaceMode: SpaceState
  inlineLinkSmartSpace: boolean
}

/** 行内变更（begin/end 为**原行**坐标；text 为新内容） */
export interface InlineChange {
  text: string
  begin: number
  end: number
  origin: string
}

export interface FormatLineResult {
  /** 格式化后的整行（重建结果；变更以 changes 表达） */
  line: string
  /** 格式化后光标行内位置 */
  cursorCh: number
  /** 内容变更（按 begin 升序；空表 = 无变更） */
  changes: InlineChange[]
}

export interface FormatLineOptions {
  /** 保护区区间集（行内坐标；#27 注入缝，默认无） */
  protectedRanges?: readonly ProtectedInlineRange[]
}

const stringInsertAt = (s: string, at: number, ch: string): string =>
  s.substring(0, at) + ch + s.substring(at)

const stringDeleteAt = (s: string, at: number): string =>
  s.substring(0, at) + s.substring(at + 1)

/**
 * 格式化单行：
 * @param line 行文本（不含换行符）
 * @param curCh 光标行内位置
 * @param prevCh 光标前一时刻行内位置（undefined = 非键入驱动的整行重排）
 */
export function formatLine(
  line: string,
  curCh: number,
  prevCh: number | undefined,
  settings: LineFormatSettings,
  options: FormatLineOptions = {},
): FormatLineResult {
  if (/^\s*$/.test(line)) return { line, cursorCh: curCh, changes: [] }

  // 1. 行内分区（上游 parseLineWithSyntaxTree + splitTextWithLinkAndUserDefined）
  const lineParts = splitLineIntoParts(line, options.protectedRanges ?? [])

  const linePartsOrigin = lineParts.map((p) => ({ ...p }))
  const inlineChangeList: InlineChange[] = []

  // 2. 光标分区定位 + text 分区插入 \0 光标标记
  let cursorLinePartIndex = -1
  let cursorRelativeIndex = -1
  let resultCursorCh = 0

  for (let i = 0; i < lineParts.length; i++) {
    if (curCh > lineParts[i]!.begin && curCh <= lineParts[i]!.end) {
      cursorLinePartIndex = i
      cursorRelativeIndex = curCh - lineParts[i]!.begin
      if (lineParts[i]!.type === InlineType.text) {
        lineParts[i]!.content = stringInsertAt(lineParts[i]!.content, cursorRelativeIndex, '\0')
      }
      break
    }
  }

  // 词典每次重建（上游同形态：formatLine 内 new PrefixDictionary(...)）
  const prefixDict = new PrefixDictionary(settings.prefixDictionary)

  let resultLine = ''
  let offset = 0
  let prevPartType: InlineType = InlineType.none
  let prevTextEndSpaceState = SpaceState.none

  // 3. 逐分区处理
  for (let i = 0; i < lineParts.length; i++) {
    if (lineParts[i]!.type === InlineType.text) {
      let content = lineParts[i]!.content
      let ctx: TextFormatContext = { content, curCh, prevCh, offset }

      // 3.1 自动大写
      if (settings.autoCapital) {
        if (i === 0) {
          ctx = capitalizeFirstLetter(ctx, true, cursorLinePartIndex === 0)
        }
        ctx = capitalizeMidSentence(ctx)
        content = ctx.content
        curCh = ctx.curCh
      }

      // 3.2 语言对加空格
      if (settings.languagePairs && settings.languagePairs.length > 0) {
        ctx = { ...ctx, content, curCh }
        ctx = applyLanguagePairSpacing(
          ctx,
          settings.languagePairs,
          prefixDict,
          settings.customScriptCategories,
        )
        content = ctx.content
        curCh = ctx.curCh
      }

      lineParts[i]!.content = content

      // 3.5 分区边界空格状态
      const boundary = detectBoundarySpaceState(
        content,
        settings.softSpaceLeftSymbols || '',
        settings.softSpaceRightSymbols || '',
      )

      // 3.6 前一分区 → 本 text 的间距
      if (prevPartType !== InlineType.none) {
        if (prevPartType === InlineType.wikilink || prevPartType === InlineType.mdlink) {
          // 链接 → text：智能空格（上游链接专属逻辑原样保留）
          if (!settings.inlineLinkSmartSpace && settings.inlineLinkSpaceMode > boundary.start) {
            lineParts[i]!.content = ' ' + lineParts[i]!.content
            content = lineParts[i]!.content
          } else if (settings.inlineLinkSmartSpace && boundary.start === SpaceState.none) {
            const charAtTextBegin =
              content.charAt(0) === '\0' ? content.charAt(1) : content.charAt(0)
            const regMdLinkEnd = /\]/
            const charAtLinkEndIndex = lineParts[i - 1]!.content.search(regMdLinkEnd) - 1
            const charAtLinkEnd = lineParts[i - 1]!.content.charAt(charAtLinkEndIndex)
            if (charAtLinkEnd !== '[') {
              const twoNeighborChars = charAtLinkEnd + charAtTextBegin
              const regNotNeedSpace = /[\u4e00-\u9fa5，。？：；""''\-）}][\u4e00-\u9fa5]/g
              if (!regNotNeedSpace.test(twoNeighborChars)) {
                lineParts[i]!.content = ' ' + lineParts[i]!.content
                content = lineParts[i]!.content
              }
            }
          }
        } else if (
          shouldPrependSpaceToText(
            prevPartType,
            boundary.start,
            i > 0 ? lineParts[i - 1]!.rightSpaceRequire : SpaceState.none,
            settings,
          )
        ) {
          lineParts[i]!.content = ' ' + lineParts[i]!.content
          content = lineParts[i]!.content
        }
      }

      // 3.7 光标位置（\0 标记实测位）
      if (i === cursorLinePartIndex) {
        const n = content.search('\0')
        resultCursorCh = offset + n
        lineParts[i]!.content = stringDeleteAt(content, n)
      }

      resultLine += lineParts[i]!.content
      offset += lineParts[i]!.content.length
      prevPartType = InlineType.text
      prevTextEndSpaceState = boundary.end
    } else {
      // 非 text 分区（code / formula / link / user）

      // $\qquad$ 公式计为文本空隔（上游特例原样）
      if (lineParts[i]!.type === InlineType.formula && lineParts[i]!.content === '$\\qquad$') {
        prevPartType = InlineType.text
        prevTextEndSpaceState = SpaceState.strict
        resultLine += lineParts[i]!.content
        offset += lineParts[i]!.content.length
        continue
      }

      // text → 链接：智能空格双分支（上游链接专属逻辑原样保留）
      if (
        (lineParts[i]!.type === InlineType.wikilink || lineParts[i]!.type === InlineType.mdlink) &&
        prevPartType === InlineType.text
      ) {
        const prevEnd = prevTextEndSpaceState
        if (prevEnd >= settings.inlineLinkSpaceMode && !settings.inlineLinkSmartSpace) {
          // 已有足够空格
        } else if (prevEnd === SpaceState.strict && settings.inlineLinkSpaceMode === SpaceState.strict) {
          // 已是严格
        } else if (settings.inlineLinkSpaceMode === SpaceState.strict && prevEnd < SpaceState.strict) {
          lineParts[i - 1]!.content += ' '
          resultLine += ' '
          offset += 1
        } else if (settings.inlineLinkSmartSpace && lineParts[i - 1]!.content.endsWith(' ')) {
          // 智能空格：可能回退两中文字符间的空格
          const charAtLinkBegin = getLinkBeginChar(lineParts[i]!)
          if (charAtLinkBegin) {
            const tempContent = lineParts[i - 1]!.content + charAtLinkBegin
            const regRevertSpace = /[\u4e00-\u9fa5] [\u4e00-\u9fa5]$/
            if (regRevertSpace.test(tempContent)) {
              lineParts[i - 1]!.content = lineParts[i - 1]!.content.substring(
                0,
                lineParts[i - 1]!.content.length - 1,
              )
              resultLine = resultLine.substring(0, resultLine.length - 1)
              offset -= 1
            }
          }
        } else if (settings.inlineLinkSmartSpace && prevEnd === SpaceState.none) {
          const charAtTextEnd = lineParts[i - 1]!.content.charAt(lineParts[i - 1]!.content.length - 1)
          const charAtLinkBegin = getLinkBeginChar(lineParts[i]!)
          if (charAtLinkBegin) {
            const regNoNeedSpace = /[\u4e00-\u9fa5][\u4e00-\u9fa5]/g
            const twoNeighborChars = charAtTextEnd + charAtLinkBegin
            if (!regNoNeedSpace.test(twoNeighborChars)) {
              lineParts[i - 1]!.content += ' '
              resultLine += ' '
              offset += 1
            }
          }
        } else if (!settings.inlineLinkSmartSpace && settings.inlineLinkSpaceMode > prevEnd) {
          lineParts[i - 1]!.content += ' '
          resultLine += ' '
          offset += 1
        }
      } else if (prevPartType === InlineType.text) {
        // text → 非链接：前 text 尾部是否补空格
        if (
          shouldInsertSpaceBetweenParts(
            InlineType.text,
            lineParts[i]!.type,
            prevTextEndSpaceState,
            i > 0 ? lineParts[i - 1]!.rightSpaceRequire : SpaceState.none,
            lineParts[i]!.leftSpaceRequire,
            settings,
          )
        ) {
          lineParts[i - 1]!.content += ' '
          resultLine += ' '
          offset += 1
        }
      } else if (prevPartType !== InlineType.none) {
        // 非text → 非text：经变更表插空格
        if (
          shouldInsertSpaceBetweenParts(
            prevPartType,
            lineParts[i]!.type,
            prevTextEndSpaceState,
            i > 0 ? lineParts[i - 1]!.rightSpaceRequire : SpaceState.none,
            lineParts[i]!.leftSpaceRequire,
            settings,
          )
        ) {
          inlineChangeList.push({
            text: ' ',
            begin: lineParts[i]!.begin,
            end: lineParts[i]!.begin,
            origin: '',
          })
          resultLine += ' '
          offset += 1
        }
      }

      // 光标在非 text 分区
      if (i === cursorLinePartIndex) {
        resultCursorCh = offset + cursorRelativeIndex
      }

      resultLine += lineParts[i]!.content
      offset += lineParts[i]!.content.length
      prevPartType = lineParts[i]!.type
      prevTextEndSpaceState = SpaceState.none
    }
  }

  // 4. 收集 text 分区变更（与原始内容比对）
  for (let i = 0; i < lineParts.length; i++) {
    if (
      lineParts[i]!.type === InlineType.text &&
      lineParts[i]!.content !== linePartsOrigin[i]!.content
    ) {
      inlineChangeList.push({
        text: lineParts[i]!.content,
        begin: linePartsOrigin[i]!.begin,
        end: linePartsOrigin[i]!.end,
        origin: linePartsOrigin[i]!.content,
      })
    }
  }

  inlineChangeList.sort((a, b) => a.begin - b.begin)
  return { line: resultLine, cursorCh: resultCursorCh, changes: inlineChangeList }
}

/** 链接分区的展示首字符（别名/锚点感知；空链接返回 null）——上游 getLinkBeginChar 原样 */
function getLinkBeginChar(part: InlinePart): string | null {
  if (part.type === InlineType.wikilink) {
    const regAlias = /\|/
    const charOfAliasBegin = part.content.search(regAlias)
    let beginIndex = 2
    if (part.content.charAt(0) === '!') beginIndex = 3
    if (charOfAliasBegin !== -1) {
      beginIndex = charOfAliasBegin + 1
    } else if (part.content.charAt(beginIndex) === '#') {
      beginIndex += 1
    }
    const ch = part.content.charAt(beginIndex)
    return ch === ']' ? null : ch
  } else {
    const regMdLinkBegin = /\[/
    const charAtLinkBeginIndex = part.content.search(regMdLinkBegin) + 1
    const ch = part.content.charAt(charAtLinkBeginIndex)
    return ch === ']' ? null : ch
  }
}
