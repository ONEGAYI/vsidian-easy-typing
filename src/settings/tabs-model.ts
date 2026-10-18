// 设置页五 Tab 归属映射（工单 #55 切片 1）：settingKey / 声明组键 → 页内
// Tab 的纯函数事实源。声明分组（definitions.ts 四组，kebab-case）与自绘页
// 五 Tab 是两套呈现，excludeFiles 声明在 general 组但按上游语义归「自动
// 格式化」Tab（上游「指定文件不自动格式化」卡片）；「内置规则 / 自定义
// 规则」两 Tab 无声明设置行，由规则分区（rulesUi）承载。
//
// 【消费方】切片 1 的 Tab 框架与 24 项设置行渲染、切片 3 的搜索定位
// （{kind:'def', key} → settingKeyToTabId 切 Tab 定位行；{kind:'group',
//  key} → groupKeyToCardAnchor 切 Tab 定位组首卡片）——导出形态保持纯
// 函数 + 只读数据，供后续切片复用，不携带 DOM 依赖。组键 kebab-case 与
// i18n 键 camelCase 两套拼写并存的既有惯例见 A 笔记风险 10。

/** 页内 Tab id（与上游五 Tab 同名同序） */
export const SETTINGS_TAB_IDS = ['edit-enhance', 'auto-format', 'builtin-rules', 'user-rules', 'other'] as const

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number]

/** 默认 Tab（Tab 态不持久化——内存态，页面卸载即复位；对齐上游） */
export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'edit-enhance'

/** 声明组键 → 页内 Tab 路由（general 特例：excludeFiles 卡片随上游归自动格式化） */
const GROUP_TO_TAB: Readonly<Record<string, SettingsTabId>> = {
  'edit-enhance': 'edit-enhance',
  'auto-format': 'auto-format',
  general: 'auto-format',
  experimental: 'other',
}

/** 组键路由表查询（不抛错形态；groupKeyToTabId 与 groupKeyToCardAnchor 共用） */
function lookupGroupTab(groupKey: string): SettingsTabId | undefined {
  return GROUP_TO_TAB[groupKey]
}

/** 声明组键 → 页内 Tab 路由（general 特例：excludeFiles 卡片随上游归自动格式化） */
export function groupKeyToTabId(groupKey: string): SettingsTabId {
  const tab = lookupGroupTab(groupKey)
  if (!tab) throw new Error(`未知设置组键：${groupKey}`)
  return tab
}

/** 组定位落点：组键 → 组首卡片（组内定义键按卡片声明序首个命中的卡片；
 *  组的多卡场景锚到组的入口卡，如 auto-format 组锚总开关卡）。未知组键 /
 *  组内无注册定义 / 组键不落任何卡片均返回 null——搜索定位消费方判空
 *  静默降级，不抛错（与 groupKeyToTabId 的抛错口径分工：后者守配置错误，
 *  前者守运行期外来输入）。 */
export function groupKeyToCardAnchor(
  groupKey: string,
  defs: readonly SettingDefLike[],
): { tabId: SettingsTabId; cardKey: SettingsCardKey } | null {
  const tabId = lookupGroupTab(groupKey)
  if (!tabId) return null
  const groupKeys = new Set(defs.filter((def) => def.group === groupKey).map((def) => def.key))
  if (groupKeys.size === 0) return null
  for (const card of SETTINGS_TAB_CARDS) {
    if (card.tabId !== tabId) continue
    if (card.settingKeys.some((key) => groupKeys.has(key))) return { tabId, cardKey: card.cardKey }
  }
  return null
}

/** 定义的最小消费形状（AddonSettingDefinition 的结构子集——vendor 侧
 *  group 为可选字段，无组定义视为不可路由，避免本模块反向依赖注册面） */
export interface SettingDefLike {
  key: string
  group?: string
}

/** 设置键 → 页内 Tab；未注册键 / 无组定义返回 null（定位消费方判空降级，不抛错） */
export function settingKeyToTabId(key: string, defs: readonly SettingDefLike[]): SettingsTabId | null {
  const def = defs.find((d) => d.key === key)
  if (!def || def.group === undefined) return null
  return groupKeyToTabId(def.group)
}

/** 卡片分区键（对照上游设置页卡片标题；i18n 键 camelCase 惯例） */
export type SettingsCardKey =
  | 'editEnhance'
  | 'autoFormat'
  | 'inlineSpace'
  | 'prefixDict'
  | 'customRegex'
  | 'excludeFiles'
  | 'experimental'

/** 一张分组卡片的归属规格（键序 = 呈现序） */
export interface SettingsCardSpec {
  cardKey: SettingsCardKey
  tabId: SettingsTabId
  settingKeys: readonly string[]
}

/**
 * 卡片分区总表（对照上游 easy_typing_settings_tab.ts 的卡片结构）：
 * - 编辑增强：单卡「增强编辑设置」（上游序 + 本仓新增 newLineBelow 殿后）；
 * - 自动格式化：总开关卡 → （规则分区的语言间空格策略卡片）→ 行内空格卡
 *   → 前缀词典卡 → 自定义正则区块卡 → 排除文件卡；
 * - 其他设置：实验功能卡（严格换行相邻呈现；debug 殿后）。
 * 与组路由的咬合由 test/settings-tabs-model.test.ts 钉死（每卡键的
 * settingKeyToTabId 落回本卡 tabId；并集 = 24 键恰好一次）。
 */
export const SETTINGS_TAB_CARDS: readonly SettingsCardSpec[] = [
  {
    cardKey: 'editEnhance',
    tabId: 'edit-enhance',
    settingKeys: ['betterCodeEdit', 'betterBackspace', 'tabout', 'enhanceModA', 'smartPaste', 'newLineBelow'],
  },
  {
    cardKey: 'autoFormat',
    tabId: 'auto-format',
    settingKeys: ['autoFormat', 'autoFormatPaste', 'autoCapital'],
  },
  {
    cardKey: 'inlineSpace',
    tabId: 'auto-format',
    settingKeys: [
      'inlineCodeSpaceMode',
      'inlineFormulaSpaceMode',
      'inlineLinkSmartSpace',
      'inlineLinkSpaceMode',
      'softSpaceLeftSymbols',
      'softSpaceRightSymbols',
    ],
  },
  { cardKey: 'prefixDict', tabId: 'auto-format', settingKeys: ['prefixDictionary'] },
  {
    cardKey: 'customRegex',
    tabId: 'auto-format',
    settingKeys: ['userDefinedRegSwitch', 'userDefinedRegExp', 'userRulesRespectUserDefinedRegexBlocks'],
  },
  { cardKey: 'excludeFiles', tabId: 'auto-format', settingKeys: ['excludeFiles'] },
  {
    cardKey: 'experimental',
    tabId: 'other',
    settingKeys: ['strictModeEnter', 'strictLineMode', 'collapsePersistentEnter', 'debug'],
  },
]

/**
 * 五 Tab 归属总表（tabId → 键清单，序 = 卡片声明序）。由卡片分区折叠
 * 而来（单一事实源）；内置/自定义规则两 Tab 恒为空数组（规则分区承载）。
 */
export function settingKeysByTab(defs: readonly SettingDefLike[]): Readonly<Record<SettingsTabId, readonly string[]>> {
  void defs // 参数保留：与 settingKeyToTabId 消费面同形，切片 3 可换用带校验实现
  const result = Object.fromEntries(SETTINGS_TAB_IDS.map((tab) => [tab, [] as string[]])) as Record<
    SettingsTabId,
    string[]
  >
  for (const card of SETTINGS_TAB_CARDS) {
    result[card.tabId].push(...card.settingKeys)
  }
  return result
}

/** 指定 Tab 的卡片清单（渲染入口） */
export function cardsForTab(tabId: SettingsTabId): readonly SettingsCardSpec[] {
  return SETTINGS_TAB_CARDS.filter((card) => card.tabId === tabId)
}
