// 文字系统（脚本）分类与语言对正则生成（工单 #26）：上游
// easy-typing-obsidian `src/formatting/script_category.ts`（121 行）逐行移植。
//
// 语义要点：
// - CJK 是 Chinese+Japanese+Korean 的并集元类（resolveCharClass 展开为并集
//   字符类；classifyChar 永不返回 CJK，只返回最具体类）；
// - 自定义字符类（CustomScriptDef）以名字引用，pattern 是字符类**内部**
//   片段（如 `Α-Ωα-ω`，不含方括号）；
// - Unknown 的类片段为空串 → buildPairRegexps 返回空数组（该对不参与匹配）。
export enum ScriptCategory {
  Chinese = 'chinese',
  Japanese = 'japanese',
  Korean = 'korean',
  CJK = 'cjk',
  English = 'english',
  Digit = 'digit',
  Russian = 'russian',
  Unknown = 'unknown',
}

/** 各脚本类的 Unicode 字符类片段（上游 SCRIPT_CHAR_CLASSES 原样） */
const SCRIPT_CHAR_CLASSES: Record<ScriptCategory, string> = {
  [ScriptCategory.Chinese]: '\\u4e00-\\u9fff\\u3400-\\u4dbf',
  [ScriptCategory.Japanese]: '\\u3040-\\u309f\\u30a0-\\u30ff\\u31f0-\\u31ff',
  [ScriptCategory.Korean]: '\\uac00-\\ud7af\\u1100-\\u11ff\\u3130-\\u318f',
  [ScriptCategory.CJK]:
    '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3040-\\u309f\\u30a0-\\u30ff\\u31f0-\\u31ff\\uac00-\\ud7af\\u1100-\\u11ff\\u3130-\\u318f',
  [ScriptCategory.English]: 'A-Za-z',
  [ScriptCategory.Digit]: '0-9',
  [ScriptCategory.Russian]: '\\u0400-\\u04ff',
  [ScriptCategory.Unknown]: '',
}

/** 自定义字符类（上游 CustomScriptDef 同形；pattern 为字符类内部片段） */
export interface CustomScriptDef {
  name: string
  pattern: string
}

/** 单字符 → 最具体脚本类（永不返回 CJK；上游 classifyChar 原样） */
export function classifyChar(ch: string): ScriptCategory {
  if (!ch || ch.length === 0) return ScriptCategory.Unknown
  const code = ch.charCodeAt(0)

  // Chinese（CJK Unified Ideographs + Extension A）
  if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
    return ScriptCategory.Chinese
  }
  // Japanese（平假名 + 片假名 + 片假名语音扩展）
  if (
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0x31f0 && code <= 0x31ff)
  ) {
    return ScriptCategory.Japanese
  }
  // Korean（谚文音节 + 字母 + 兼容字母）
  if (
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f)
  ) {
    return ScriptCategory.Korean
  }
  // English
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
    return ScriptCategory.English
  }
  // Digit
  if (code >= 0x30 && code <= 0x39) {
    return ScriptCategory.Digit
  }
  // Russian（西里尔）
  if (code >= 0x0400 && code <= 0x04ff) {
    return ScriptCategory.Russian
  }
  return ScriptCategory.Unknown
}

/** 脚本类名 → 字符类片段（CJK 展开并集；自定义类按名查 pattern；未知 → 空串） */
export function resolveCharClass(
  cat: ScriptCategory | string,
  customCategories?: CustomScriptDef[],
): string {
  if (cat in SCRIPT_CHAR_CLASSES) {
    return SCRIPT_CHAR_CLASSES[cat as ScriptCategory]
  }
  // 自定义类查找
  if (customCategories) {
    const custom = customCategories.find((c) => c.name === cat)
    if (custom) return custom.pattern
  }
  return ''
}

/**
 * 构造两脚本类邻接的正则对：[(A)(B), (B)(A)]，均带 g 旗标。
 * 任一侧类片段为空（Unknown / 未登记自定义类）→ 返回空数组。
 */
export function buildPairRegexps(
  a: ScriptCategory | string,
  b: ScriptCategory | string,
  customCategories?: CustomScriptDef[],
): RegExp[] {
  const classA = resolveCharClass(a, customCategories)
  const classB = resolveCharClass(b, customCategories)
  if (!classA || !classB) return []

  const regAB = new RegExp(`([${classA}])([${classB}])`, 'g')
  const regBA = new RegExp(`([${classB}])([${classA}])`, 'g')
  return [regAB, regBA]
}

/** 全部内置脚本类（含 CJK 元类；不含 Unknown） */
export const BUILTIN_CATEGORIES: ScriptCategory[] = [
  ScriptCategory.Chinese,
  ScriptCategory.Japanese,
  ScriptCategory.Korean,
  ScriptCategory.CJK,
  ScriptCategory.English,
  ScriptCategory.Digit,
  ScriptCategory.Russian,
]
