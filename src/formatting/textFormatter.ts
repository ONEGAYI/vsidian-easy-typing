// 文本段格式化算法（工单 #26）：上游 easy-typing-obsidian
// `src/formatting/text_formatter.ts`（573 行）逐行移植——大写（句首/句中）、
// 语言对加空格（token 中心算法 + 前缀词典抑制 + 词典跨脚本扩展 + 延迟
// 边界补插）、边界软空格状态机（detectBoundarySpaceState）。
//
// 每个函数只处理单个 text 分区（InlinePart.type === 'text'）的 content；
// 分区切分见 inlineParts.ts，行级编排见 lineFormatter.ts。
//
// 与上游的偏差（记录于 docs/specs/auto-format.md）：
// - applyLanguagePairSpacing 的 debug console.log 段不移植（开发期噪声，
//   上游由 settings.debug 门控，非行为语义）；
// - SpaceState 自上游 core.ts 移入 inlineParts.ts（本仓模块边界）。
import {
  buildPairRegexps,
  classifyChar,
  resolveCharClass,
  type CustomScriptDef,
} from './scriptCategory'
import { PrefixDictionary } from './prefixDictionary'
import { SpaceState } from './inlineParts'

/** 语言对（a/b 为内置脚本类名或自定义字符类名；上游 LanguagePair 同形） */
export interface LanguagePair {
  a: string
  b: string
}

export interface TextFormatContext {
  content: string
  /** 光标在整行中的位置（行坐标） */
  curCh: number
  /** 光标前一时刻在整行中的位置（undefined = 非键入驱动，如命令重排） */
  prevCh: number | undefined
  /** 本分区起点在行结果坐标中的偏移（formatLine 逐段累计） */
  offset: number
}

const isParamDefined = (p: number | undefined): boolean => p !== undefined

// ──────────── 自动大写 ────────────

/**
 * 行首字母大写（仅首个 text 分区）：句首正则（含任务列表/引用/包裹标记
 * 前缀）与标题正则（#+ / > / 引号开头）两种形态；只对本次键入区间
 * [prevCh, curCh) 内的目标字符生效。
 */
export function capitalizeFirstLetter(
  ctx: TextFormatContext,
  isFirstPart: boolean,
  isCursorInPart: boolean,
): TextFormatContext {
  if (!isFirstPart) return ctx

  const { content, prevCh, curCh } = ctx
  const regFirstSentence = /^\s*(?:\- (?:\[[x ]\] )?)?"?(?:\*{1,3}|_{1,3}|==|~~)?[a-z\u0401\u0451\u0410-\u044f]/g
  const regHeaderSentence = /^(?:#+ |>+ ?|")(?:\*{1,3}|_{1,3}|==|~~)?[a-z\u0401\u0451\u0410-\u044f]/g

  const textcopy = content
  const match = regFirstSentence.exec(textcopy)
  const matchHeader = regHeaderSentence.exec(textcopy)
  let dstCharIndex = -1

  if (match) {
    dstCharIndex = regFirstSentence.lastIndex - 1
  } else if (matchHeader) {
    dstCharIndex = regHeaderSentence.lastIndex - 1
  }

  // 只对刚键入的字符大写（落在 prevCh..curCh 区间内）
  if (isParamDefined(prevCh) && !isCursorInPart) {
    return ctx
  }
  if (!(isParamDefined(prevCh) && dstCharIndex >= prevCh! && dstCharIndex < curCh)) {
    dstCharIndex = -1
  }

  if (dstCharIndex !== -1) {
    const newContent =
      textcopy.substring(0, dstCharIndex) +
      textcopy.charAt(dstCharIndex).toUpperCase() +
      textcopy.substring(dstCharIndex + 1)
    return { ...ctx, content: newContent }
  }
  return ctx
}

/**
 * 句中字母大写：句末标点（.?!。！？）+ 空白后的字母；仅键入区间内生效；
 * " ."（空格加点，缩写守卫）形态跳过。
 */
export function capitalizeMidSentence(ctx: TextFormatContext): TextFormatContext {
  let { content, curCh, prevCh, offset } = ctx
  const reg = /(?:[.?!]\s+|[。！？]\s*)(?:\*{1,3}|_{1,3}|==|~~)?[a-z\u0401\u0451\u0410-\u044f]/g

  while (true) {
    const match = reg.exec(content)
    if (!match) break
    const tempIndex = reg.lastIndex - 1
    const isSpaceDot = tempIndex - 2 < 0 || content.substring(tempIndex - 2, tempIndex) === ' .'

    if (
      isParamDefined(prevCh) &&
      tempIndex >= prevCh! - offset &&
      tempIndex < curCh - offset &&
      !isSpaceDot
    ) {
      content =
        content.substring(0, tempIndex) +
        content.charAt(tempIndex).toUpperCase() +
        content.substring(reg.lastIndex)
    }
  }
  return { ...ctx, content }
}

// ──────────── 语言对间距 ────────────

/**
 * 字符是否属 CJK 语境（CJK 表意文字 + CJK 符号标点/全角标点等区间）。
 * classifyChar 对 CJK 标点（。：、等）返回 Unknown，需显式区间补判。
 */
function isCJKContext(ch: string): boolean {
  const cat = classifyChar(ch)
  if (cat === 'chinese' || cat === 'japanese' || cat === 'korean') {
    return true
  }
  if (ch.length > 0) {
    const code = ch.charCodeAt(0)
    // CJK Symbols and Punctuation (U+3000–U+303F)：。、【】、《》等
    // 全角标点：U+FF01–U+FF0F, U+FF1A–U+FF20, U+FF3B–U+FF40, U+FF5B–U+FF60
    //   （不含全角数字 U+FF10–FF19 与全角字母）
    // CJK Compatibility Forms：U+FE30–U+FE4F；全角符号：U+FFE0–U+FFE6
    if (
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff01 && code <= 0xff0f) ||
      (code >= 0xff1a && code <= 0xff20) ||
      (code >= 0xff3b && code <= 0xff40) ||
      (code >= 0xff5b && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0xfe30 && code <= 0xfe4f)
    ) {
      return true
    }
  }
  return false
}

/** 光标邻接 token 的边界 [left, right)（脚本感知：CJK/非 CJK 组不跨） */
function findTokenBounds(content: string, pos: number): [number, number] {
  // 钳制到 content 内（光标可能在其他分区）
  pos = Math.max(0, Math.min(pos, content.length))
  // 以光标前一字符的脚本组为参照
  let refIdx = pos > 0 ? pos - 1 : 0
  if (refIdx >= content.length) refIdx = content.length - 1
  if (refIdx < 0) return [0, 0]
  const refIsCJK = isCJKContext(content.charAt(refIdx))

  let left = pos
  while (left > 0 && !/[\s\0]/.test(content.charAt(left - 1))) {
    const ch = content.charAt(left - 1)
    const isCJK = isCJKContext(ch)
    if (!isCJK && !/\w/.test(ch)) break
    if (isCJK !== refIsCJK) break
    left--
  }
  let right = pos
  while (right < content.length && !/[\s\0]/.test(content.charAt(right))) {
    const ch = content.charAt(right)
    const isCJK = isCJKContext(ch)
    if (!isCJK && !/\w/.test(ch)) break
    if (isCJK !== refIsCJK) break
    right++
  }
  return [left, right]
}

function extractToken(content: string, left: number, right: number): string {
  return content.substring(left, right).replace(/\0/g, '')
}

/**
 * 光标 token 的词典引导扩展：捕获跨 CJK↔非 CJK 脚本边界的词典词
 *（如 "b站" = 'b' + '站'——findTokenBounds 按脚本组切开，词典看不到整词）。
 * 在种子周边的（ASCII 词 | CJK）最大游程内，找词典可抑制的最长含种子
 * 子区间；无命中则原样返回种子（下游逻辑不受影响）。
 */
function extendCursorTokenForDict(
  content: string,
  seedL: number,
  seedR: number,
  prefixDict: PrefixDictionary,
  usePrefix: boolean,
): { left: number; right: number; token: string } {
  const seedToken = extractToken(content, seedL, seedR)

  // 宽松游程边界：ASCII 词字符或 CJK 语境字符的最大游程
  let runL = seedL
  while (runL > 0) {
    const ch = content.charAt(runL - 1)
    if (/[\s\0]/.test(ch) || (!/\w/.test(ch) && !isCJKContext(ch))) break
    runL--
  }
  let runR = seedR
  while (runR < content.length) {
    const ch = content.charAt(runR)
    if (/[\s\0]/.test(ch) || (!/\w/.test(ch) && !isCJKContext(ch))) break
    runR++
  }

  let bestL = seedL
  let bestR = seedR
  let bestToken = seedToken
  let bestMatched = prefixDict.shouldSuppressSpace(seedToken, usePrefix)
  let bestSpan = bestMatched ? seedR - seedL : -1

  // 含种子的子区间：l ∈ [runL, seedL]，r ∈ [seedR, runR]，取词典可抑制的
  // 最长者（n 为单分区内的小数字，嵌套扫描代价可忽略）
  for (let l = seedL; l >= runL; l--) {
    for (let r = seedR; r <= runR; r++) {
      if (l === seedL && r === seedR) continue // 种子已查
      const token = extractToken(content, l, r)
      if (prefixDict.shouldSuppressSpace(token, usePrefix)) {
        const span = r - l
        if (span > bestSpan) {
          bestL = l
          bestR = r
          bestToken = token
          bestMatched = true
          bestSpan = span
        }
      }
    }
  }

  if (!bestMatched) {
    // 无扩展（且种子自身）命中——种子原样交回结构逻辑
    return { left: seedL, right: seedR, token: seedToken }
  }
  return { left: bestL, right: bestR, token: bestToken }
}

/** 收集 content 中全部语言对边界位置（每对两条正则，全量扫描） */
function collectAllBoundaries(
  content: string,
  languagePairs: LanguagePair[],
  customCategories?: CustomScriptDef[],
): Set<number> {
  const positions = new Set<number>()
  for (const pair of languagePairs) {
    const regexps = buildPairRegexps(pair.a, pair.b, customCategories)
    for (const reg of regexps) {
      reg.lastIndex = 0
      while (true) {
        const match = reg.exec(content)
        if (!match) break
        positions.add(reg.lastIndex - 1)
      }
    }
  }
  return positions
}

const FORMATTING_CHARS_RE = /[*_~`^]/

function isFormattingChar(ch: string): boolean {
  return FORMATTING_CHARS_RE.test(ch)
}

/**
 * 收集被 Markdown 格式符号分隔的语言对边界（如 *A*中文 → * 与 中 之间）：
 * 格式符连串两侧的实质字符构成语言对时，按格式符串归属侧（找配对格式符
 * 更近的一侧，等距偏左）决定边界位置；无配对时按两侧 CJK 语境双计。
 */
function collectFormattingSeparatedBoundaries(
  content: string,
  languagePairs: LanguagePair[],
  customCategories?: CustomScriptDef[],
): Set<number> {
  const positions = new Set<number>()
  if (!FORMATTING_CHARS_RE.test(content)) return positions

  // 预编译语言对的单字符类正则（热循环外）
  const pairTests: { test(classA: string, classB: string): boolean }[] = []
  for (const pair of languagePairs) {
    const classA = resolveCharClass(pair.a, customCategories)
    const classB = resolveCharClass(pair.b, customCategories)
    if (!classA || !classB) continue
    const regA = new RegExp(`^[${classA}]$`)
    const regB = new RegExp(`^[${classB}]$`)
    pairTests.push({
      test(a: string, b: string) {
        return (regA.test(a) && regB.test(b)) || (regA.test(b) && regB.test(a))
      },
    })
  }
  if (pairTests.length === 0) return positions

  const len = content.length
  let i = 0
  while (i < len) {
    if (!isFormattingChar(content[i]!)) {
      i++
      continue
    }

    // 连续格式符块
    let blockStart = i
    while (blockStart > 0 && isFormattingChar(content[blockStart - 1]!)) {
      blockStart--
    }
    let blockEnd = i
    while (blockEnd < len - 1 && isFormattingChar(content[blockEnd + 1]!)) {
      blockEnd++
    }
    i = blockEnd + 1

    // 左侧实质字符（跳过格式符与 \0 光标标记）
    let leftIdx = blockStart - 1
    while (leftIdx >= 0 && (isFormattingChar(content[leftIdx]!) || content[leftIdx] === '\0')) {
      leftIdx--
    }
    if (leftIdx < 0) continue

    // 右侧实质字符
    let rightIdx = blockEnd + 1
    while (rightIdx < len && (isFormattingChar(content[rightIdx]!) || content[rightIdx] === '\0')) {
      rightIdx++
    }
    if (rightIdx >= len) continue

    const leftChar = content[leftIdx]!
    const rightChar = content[rightIdx]!

    let pairMatched = false
    for (const pt of pairTests) {
      if (pt.test(leftChar, rightChar)) {
        pairMatched = true
        break
      }
    }
    if (!pairMatched) continue

    // 格式符块归属侧：向两侧找同字符配对格式符（跨非格式符内容扫描），
    // 取更近者（等距偏左）
    const fmtChar = content[blockStart]!
    let matchedLeftDist = -1
    let matchedRightDist = -1
    for (let j = blockStart - 1; j >= 0; j--) {
      if (content[j] === fmtChar) {
        matchedLeftDist = blockStart - j
        break
      }
      if (/[\s\0]/.test(content[j]!)) break
    }
    for (let j = blockEnd + 1; j < len; j++) {
      if (content[j] === fmtChar) {
        matchedRightDist = j - blockEnd
        break
      }
      if (/[\s\0]/.test(content[j]!)) break
    }
    if (matchedLeftDist >= 0 && (matchedRightDist < 0 || matchedLeftDist <= matchedRightDist)) {
      positions.add(blockEnd + 1)
    } else if (matchedRightDist >= 0) {
      positions.add(blockStart)
    } else {
      if (isCJKContext(leftChar)) positions.add(blockStart)
      if (isCJKContext(rightChar)) positions.add(blockEnd + 1)
    }
  }

  return positions
}

/**
 * 语言对边界插空格（token 中心算法）：
 *  1. 找光标处/邻接的 token（脚本感知边界；空 token 回退左邻已完成 token）；
 *  2. 查前缀词典（跨脚本词典词扩展）；
 *  3. 未抑制 → token 内**全部**命中边界都插（含键入区间外的延迟边界）；
 *  4. token 外的边界只按 prevCh..curCh 键入区间插。
 */
export function applyLanguagePairSpacing(
  ctx: TextFormatContext,
  languagePairs: LanguagePair[],
  prefixDict: PrefixDictionary,
  customCategories?: CustomScriptDef[],
): TextFormatContext {
  let { content, curCh, prevCh, offset } = ctx
  if (!isParamDefined(prevCh)) return ctx

  const cursorInContent = curCh - offset

  // 1. 收集原始 content 的全部边界（含格式符分隔边界）
  const allBoundaries = collectAllBoundaries(content, languagePairs, customCategories)
  const fmtBoundaries = collectFormattingSeparatedBoundaries(content, languagePairs, customCategories)
  for (const pos of fmtBoundaries) {
    allBoundaries.add(pos)
  }
  if (allBoundaries.size === 0) return ctx

  // 2. 光标 token 边界
  let [tokLeft, tokRight] = findTokenBounds(content, cursorInContent)
  let cursorToken = extractToken(content, tokLeft, tokRight)

  // 光标在词边界（空 token，如刚键入空格）→ 回退左邻 token：它刚定稿，
  // 可能需要补插词典过期后的延迟边界
  let tokenIsFinalized = false
  if (cursorToken.length === 0 && cursorInContent > 0) {
    let searchPos = cursorInContent - 1
    while (searchPos >= 0 && /[\s\0]/.test(content.charAt(searchPos))) {
      searchPos--
    }
    if (searchPos >= 0) {
      ;[tokLeft, tokRight] = findTokenBounds(content, searchPos)
      cursorToken = extractToken(content, tokLeft, tokRight)
      tokenIsFinalized = true
    }
  }

  // 2b. 词典引导的跨脚本 token 扩展（如 "b站"）
  const isActivelyTyping = curCh !== prevCh
  const usePrefix = isActivelyTyping && !tokenIsFinalized
  const extended = extendCursorTokenForDict(content, tokLeft, tokRight, prefixDict, usePrefix)
  const tokLeftExt = extended.left
  const tokRightExt = extended.right
  const cursorTokenExt = extended.token

  // 3. 前缀词典判定：prevCh === curCh（Enter/命令重排定稿）或 token 已
  // 定稿（刚键入空格）→ 只认精确命中，不认前缀
  const cursorTokenSuppressed = prefixDict.shouldSuppressSpace(cursorTokenExt, usePrefix)

  // protectedUpTo：token 内 [0, protectedUpTo) 的边界受词典词保护不插
  let protectedUpTo = -1
  if (cursorTokenSuppressed) {
    // 整 token 精确命中或前缀 → 全保护
    protectedUpTo = cursorTokenExt.length
  } else {
    // token 以一个完整词典词开头 → 词内边界受保护（后继字符须异脚本）
    const matchLen = prefixDict.findLongestMatchFromStart(cursorTokenExt)
    if (matchLen > 0 && matchLen < cursorTokenExt.length) {
      const lastCharOfMatch = cursorTokenExt.charAt(matchLen - 1)
      const firstCharAfterMatch = cursorTokenExt.charAt(matchLen)
      if (classifyChar(lastCharOfMatch) !== classifyChar(firstCharAfterMatch)) {
        protectedUpTo = matchLen
      }
      // 同脚本 → 词已不适用 → 不保护
    }
  }

  // 4. 决定保留哪些边界
  const toInsert: number[] = []
  const prevChInContent = prevCh! - offset

  // 词典刚过期：前一键的 token 被抑制而当前不再被抑制 → token 内延迟
  // 边界即使超出键入区间也应补插
  let prefixDictExpired = false
  if (!cursorTokenSuppressed) {
    if (isActivelyTyping && prevChInContent > tokLeftExt) {
      // 键入继续中：查本键之前的 token 是否被抑制
      const prevToken = cursorTokenExt.substring(0, prevChInContent - tokLeftExt)
      prefixDictExpired = prefixDict.shouldSuppressSpace(prevToken, true)
    } else if (!isActivelyTyping || tokenIsFinalized) {
      // token 定稿（Enter/空格）：查整个 token 此前是否作为前缀被抑制
      prefixDictExpired = prefixDict.shouldSuppressSpace(cursorTokenExt, true)
    }
  }

  for (const pos of allBoundaries) {
    const inCursorToken = pos >= tokLeftExt && pos < tokRightExt

    if (inCursorToken) {
      const posInToken = pos - tokLeftExt
      if (posInToken > 0 && posInToken < protectedUpTo) {
        continue // 词典词保护
      }
      // 键入区间内，或词典刚过期（延迟边界补插）
      if ((pos >= prevChInContent && pos < cursorInContent) || prefixDictExpired) {
        toInsert.push(pos)
      }
    } else {
      // token 外：常规键入区间检查
      if (pos >= prevChInContent && pos < cursorInContent) {
        // 该边界所在 token 也查词典（含跨脚本扩展——光标左侧的 "b站" 类
        // 词典词按整词匹配，不被 findTokenBounds 切开）
        const [seedL, seedR] = findTokenBounds(content, pos)
        const ext = extendCursorTokenForDict(content, seedL, seedR, prefixDict, false)
        if (!prefixDict.shouldSuppressSpace(ext.token, false)) {
          toInsert.push(pos)
        }
      }
    }
  }

  if (toInsert.length === 0) return ctx

  // 5. 升序排序后从右往左插入
  toInsert.sort((a, b) => a - b)

  for (let i = toInsert.length - 1; i >= 0; i--) {
    content = content.substring(0, toInsert[i]) + ' ' + content.substring(toInsert[i])
  }

  // 6. 光标位移：光标前的插入数
  let shift = 0
  for (const pos of toInsert) {
    if (pos < cursorInContent) shift++
  }
  curCh += shift

  return { ...ctx, content, curCh }
}

// ──────────── 边界空格状态机 ────────────

/**
 * 分区两端空格状态（供相邻分区插空格判定）：
 * - strict：端点已有真实空白；
 * - soft：端点是软空格符号（自定义符号 + 内置全角标点/引号/括号集）；
 * - none：无。
 * `<br>` 视为两端均满足软空格前提。
 */
export function detectBoundarySpaceState(
  content: string,
  leftSymbols: string,
  rightSymbols: string,
): { start: SpaceState; end: SpaceState } {
  const builtInBothSymbols = '"\''
  const builtInLeftSoftSymbols = `【】（）《》，。、？：；‘’“”「『』」！${builtInBothSymbols}[({`
  const builtInRightSoftSymbols = `【】（）《》，。、？：；‘’“”「『』」！${builtInBothSymbols},.?!:;])}`
  const escapedStart = escapeForCharClass(rightSymbols + builtInRightSoftSymbols)
  const escapedEnd = escapeForCharClass(leftSymbols + builtInLeftSoftSymbols)

  const regStrictSpaceStart = /^\0?\s/
  const regStrictSpaceEnd = /\s\0?$/
  const regStartWithSpace = new RegExp(`^\\0?[\\s${escapedStart}]`)
  const regEndWithSpace = new RegExp(`[\\s${escapedEnd}]\\0?$`)

  let start = SpaceState.none
  let end = SpaceState.none

  if (regStartWithSpace.test(content) || content.startsWith('<br>')) {
    start = regStrictSpaceStart.test(content) ? SpaceState.strict : SpaceState.soft
  }

  if (regEndWithSpace.test(content) || content.endsWith('<br>')) {
    end = regStrictSpaceEnd.test(content) ? SpaceState.strict : SpaceState.soft
  }

  return { start, end }
}

/** 字符类内特殊字符转义（[...] 内使用） */
function escapeForCharClass(symbols: string): string {
  return symbols.replace(/[\\\]^-]/g, '\\$&')
}
