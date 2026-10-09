// 设置默认值单一事实源（工单 #3）：docs/specs/settings-mapping.md §二 的
// 代码侧镜像。上游 DEFAULT_SETTINGS（settings_types.ts:52-95）中 23 个可
// 映射字段的默认值在此落位（newLineBelow 为 #13 新增本仓键，非上游字段）；定义构建（definitions.ts）与生效值合成
// （store.ts）都引用本模块，一致性由 test/settings-definitions.test.ts 钉住。
// 注意 ExcludeFiles 上游为多行字符串，此处按映射表拆平为字符串数组；
// SpaceState 数字枚举（none=0/soft=1/strict=2）转为字符串枚举，顺序即上游
// 数字值顺序（功能票需要数字语义时按下标换算）。

/** 行内元素与文本的空格策略三档（上游 SpaceState 的字符串形态） */
export const SPACE_MODE_VALUES = ['none', 'soft', 'strict'] as const
export type SpaceMode = (typeof SPACE_MODE_VALUES)[number]

/** 严格换行模式的回车形态（上游 StrictLineMode 枚举原值直映） */
export const STRICT_LINE_MODE_VALUES = ['enter_twice', 'two_space', 'mix_mode'] as const
export type StrictLineModeValue = (typeof STRICT_LINE_MODE_VALUES)[number]

/** 本组件经平台设置 schema 暴露的 24 键生效值形状
 *（23 个上游映射键 + 1 个本仓新增门控键 newLineBelow，见映射表 §二） */
export interface EffectiveEasyTypingSettings {
  tabout: boolean
  smartPaste: boolean
  betterCodeEdit: boolean
  betterBackspace: boolean
  autoFormat: boolean
  autoFormatPaste: boolean
  excludeFiles: string[]
  autoCapital: boolean
  prefixDictionary: string
  softSpaceLeftSymbols: string
  softSpaceRightSymbols: string
  inlineCodeSpaceMode: SpaceMode
  inlineFormulaSpaceMode: SpaceMode
  inlineLinkSpaceMode: SpaceMode
  inlineLinkSmartSpace: boolean
  userDefinedRegSwitch: boolean
  userDefinedRegExp: string
  userRulesRespectUserDefinedRegexBlocks: boolean
  debug: boolean
  strictModeEnter: boolean
  strictLineMode: StrictLineModeValue
  enhanceModA: boolean
  collapsePersistentEnter: boolean
  /** 本仓新增门控键（#13，无上游字段）：上游 Mod+Enter 命令恒可用、
   * 无设置门；实验层 keymap 不进平台统一快捷键管理，用户无法解绑，
   * 按 #402 契约「组件内功能粒度开关由插件设置承担」补本键。默认开
   * = 上游「命令恒可用」的等价默认；关闭时透传回平台内建 Mod+Enter
   *（defaultKeymap insertBlankLine）。 */
  newLineBelow: boolean
}

/** 出厂默认值（对照上游 DEFAULT_SETTINGS 逐字段；newLineBelow 例外见接口注） */
export const DEFAULT_EFFECTIVE_SETTINGS: EffectiveEasyTypingSettings = {
  tabout: true,
  smartPaste: true,
  betterCodeEdit: true,
  betterBackspace: true,
  autoFormat: true,
  autoFormatPaste: true,
  excludeFiles: [],
  autoCapital: false,
  prefixDictionary: 'n8n, /[1234][dD]/\npython3, Python3',
  softSpaceLeftSymbols: '-',
  softSpaceRightSymbols: '-',
  inlineCodeSpaceMode: 'soft',
  inlineFormulaSpaceMode: 'soft',
  inlineLinkSpaceMode: 'soft',
  inlineLinkSmartSpace: true,
  userDefinedRegSwitch: true,
  // 上游 DEFAULT_SETTINGS.UserDefinedRegExp 逐字保留（正则数据，非文案）
  userDefinedRegExp:
    '{{.*?}}|++\n' +
    '<.*?>|--\n' +
    '\\[\\!.*?\\][-+]{0,1}|-+\n' +
    '(file:///|https?://|ftp://|obsidian://|zotero://|www.)[^\\s（）《》。,，！？;；：“”‘’\\)\\(\\[\\]\\{\\}]+|--\n' +
    '\n[a-zA-Z0-9_\\-.]+@[a-zA-Z0-9_\\-.]+|++\n' +
    '// Tags in Obsidian' +
    '//(?<!#)#[\\u4e00-\\u9fa5\\w-\\/]+|++',
  userRulesRespectUserDefinedRegexBlocks: false,
  debug: false,
  strictModeEnter: false,
  strictLineMode: 'enter_twice',
  enhanceModA: false,
  collapsePersistentEnter: false,
  newLineBelow: true,
}

// ---- 归 #14 storage 的富结构出厂值（映射表 §三；本票只交付种子，不建持久化） ----

/** 全部设置键（顺序 = 映射表 §二 = 默认值对象插入序；新增字段改接口与默认值两处，并同步测试全量清单） */
export const EFFECTIVE_SETTING_KEYS = Object.keys(
  DEFAULT_EFFECTIVE_SETTINGS,
) as readonly (keyof EffectiveEasyTypingSettings)[]

/** 上游 LanguagePair 的字符串形态（ScriptCategory 枚举值或自定义类名） */
export interface LanguagePairSeed {
  a: string
  b: string
}

/** 上游 CustomScriptDef 同形（{name, pattern}） */
export interface CustomScriptCategorySeed {
  name: string
  pattern: string
}

/**
 * 富结构出厂值（#14 以此为缺省种子持久化用户编辑）：
 * - languagePairs：默认三组语言对（中英 / 中数 / 数英），值用上游
 *   ScriptCategory 枚举字符串（chinese/english/digit）；
 * - customScriptCategories：默认空；
 * - deletedBuiltinRuleIds：默认空（规则管理伴随状态，随规则文件存储）。
 */
export const RICH_STRUCTURE_DEFAULTS = {
  languagePairs: [
    { a: 'chinese', b: 'english' },
    { a: 'chinese', b: 'digit' },
    { a: 'digit', b: 'english' },
  ] as LanguagePairSeed[],
  customScriptCategories: [] as CustomScriptCategorySeed[],
  deletedBuiltinRuleIds: [] as string[],
}
