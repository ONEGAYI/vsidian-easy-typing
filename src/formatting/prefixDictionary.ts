// 前缀词典（工单 #26）：上游 easy-typing-obsidian
// `src/formatting/prefix_dictionary.ts`（113 行）逐行移植——防止正在输入的
// 词（如 n8n、python3）内部被过早插入空格。
//
// 原始串形态：逗号 / 空白 / 换行分隔的字面词或 `/正则/旗标` 条目
//（默认词条 `n8n, /[1234][dD]/\npython3, Python3`——python3 与 Python3
// 双写即上游的「大小写并列」手法：字面词匹配是**区分大小写**的，注释里的
// "Case-insensitive" 与实现不符，本移植以实现为准并在此钉住）。
//
// 与上游的唯一偏差：非法正则条目的告警从 console.warn 改经 debugLog
//（logging.ts 约定：业务代码不直接碰 console；词典每次格式化都重建，
// console 直打会在每次键入重复刷屏）。
import { debugLog } from '../logging'

export class PrefixDictionary {
  private literalWords: string[]
  private regexEntries: RegExp[]

  constructor(raw: string) {
    this.literalWords = []
    this.regexEntries = []
    if (!raw || raw.trim() === '') return

    // 先匹配正则条目 /.../（内部可含逗号/空格），再匹配非分隔 token。
    // 分隔符：逗号、空白、换行。
    const tokenPattern = /\/(?:[^/\\]|\\.)+\/[gimsuy]*|[^\s,]+/g
    let match: RegExpExecArray | null
    while ((match = tokenPattern.exec(raw)) !== null) {
      const token = match[0]

      // 正则条目：/pattern/ 或 /pattern/flags
      const regexMatch = /^\/(.+)\/([gimsuy]*)$/.exec(token)
      if (regexMatch) {
        try {
          this.regexEntries.push(new RegExp(regexMatch[1]!, regexMatch[2]))
        } catch (e) {
          debugLog('PrefixDictionary: invalid regex:', token, e)
        }
      } else {
        this.literalWords.push(token)
      }
    }
  }

  /** 精确命中字面词或正则条目（全 token 锚定；字面词区分大小写——上游实现口径） */
  isExactMatch(token: string): boolean {
    for (const word of this.literalWords) {
      if (word === token) return true
    }
    for (const re of this.regexEntries) {
      re.lastIndex = 0
      // 锚定匹配整个 token（非子串）
      const anchored = new RegExp(`^(?:${re.source})$`, re.flags)
      if (anchored.test(token)) return true
    }
    return false
  }

  /** 是否为某字面词的前缀（仅字面词；正则条目不参与前缀判定） */
  isPrefixOfWord(token: string): boolean {
    if (token.length === 0) return false
    for (const word of this.literalWords) {
      if (word.length > token.length && word.startsWith(token)) {
        return true
      }
    }
    return false
  }

  /**
   * 该 token 处是否应抑制空格插入：
   * 1. 精确命中词典词或正则 → 抑制（任意位置）；
   * 2. 是词典词前缀**且**在光标处 → 抑制（输入进行时暂缓）；
   * 3. 是前缀但不在光标处 → 不抑制（插入）；
   * 4. 全不命中 → 不抑制（插入）。
   */
  shouldSuppressSpace(token: string, isAtCursor: boolean): boolean {
    if (this.isExactMatch(token)) return true
    if (isAtCursor && this.isPrefixOfWord(token)) return true
    return false
  }

  /** token 开头的最长词典词长度（字面词与正则条目都查；未命中 -1） */
  findLongestMatchFromStart(token: string): number {
    let maxLen = -1

    for (const word of this.literalWords) {
      if (token.startsWith(word) && word.length > maxLen) {
        maxLen = word.length
      }
    }

    for (const re of this.regexEntries) {
      // 起点锚定匹配（去掉 g 旗标）
      const anchored = new RegExp(`^(?:${re.source})`, re.flags.replace('g', ''))
      const match = anchored.exec(token)
      if (match && match[0].length > maxLen) {
        maxLen = match[0].length
      }
    }

    return maxLen
  }
}
