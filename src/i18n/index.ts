// i18n 统一入口（工单 #3 首建，#19 完整化：内置规则描述映射 + 多语言
// 扩展指引）：
// - zh 字典是类型源（Messages = typeof zhMessages），en 以编译期类型对齐
//   键集，parity 测试（test/i18n.test.ts）运行时双保险；
// - 语言检测：宿主侧 vscode.env.language、页面侧经 resolvePageLanguage
//   （#58：SDK locale 优先，旧宿主回落 navigator.language），统一经
//   pickMessages(languageTag)——zh* 取中文，其余（含空串）回落英文
//   （上游 moment.locale 检测的 VSCode 平台等价物；本仓无 moment 依赖）；
// - builtinRuleDescriptions（#19）：内置规则描述按规则 id 的本地化映射，
//   消费点在规则管理页列表预览（previewRuleText 查表优先），数据态
//   description 不随语言改写存储。
// - ruleFamilyNameMap（#45）：规则族注册名构造为「语言键 → 名称」双语
//   映射（zh-cn/en 两键），供行为注册点使用——注册名不再随页面语言变化，
//   由消费端（vsidian）渲染时按语言选值；desc/examples 维持单选。
//
// 【多语言扩展预留】7 语言全量复刻不在 #19 范围（上游 locale 有
// en/ja/ko/ru/zh-CN/zh-TW 六语言包），但结构已为此设计——新增语言 =
// 新增一个字典文件（如 ja-JP.ts，导出满足 Messages 类型的对象，文案
// 对照上游 src/lang/locale/ 对应语言包）+ pickMessages 加一个语言前缀
// 分支。parity 测试与编译期类型自动覆盖新字典（键集不一致即红灯），
// 无需为新语言改测试；规则描述映射的完整性断言（DEFAULT_BUILTIN_RULES
// id 全覆盖）同样自动生效。
import { zhMessages } from './zh-CN'
import { enMessages } from './en-US'

export type Messages = typeof zhMessages

/** 按语言标签取字典（大小写不敏感；zh* → 中文，其余 → 英文） */
export function pickMessages(language: string): Messages {
  return language.toLowerCase().startsWith('zh') ? zhMessages : enMessages
}

/** 页面内枚举档位/双语映射的取值标签（#55 五 Tab 设置页）：与
 *  pickMessages 同一 zh* 检测——enumLabels 等 Record<'zh-cn'|'en',string>
 *  形态的值在自绘页面按本标签选值 */
export function localeTagFor(language: string): 'zh-cn' | 'en' {
  return language.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
}

/** 页面语言源单一出口（#58）：locale 面（vsidian#582，与平台生效语言
 *  同源、跟随主设置）在场则取其快照——首值经 get() 读取，onChange 只
 *  通知变化；空串 = 平台语言包未装配，保持空串交 pickMessages 落英文
 *  （与平台无包时的英文兜底一致；回落 OS 语言会重现页面/平台交杂）。
 *  面缺席（旧宿主）回落 fallback——页面侧传 navigator.language，保持
 *  #58 前既有降级行为。结构化入参不引入 SDK 依赖（宿主/页面双侧可用） */
export function resolvePageLanguage(locale: { get(): string } | undefined, fallback: string): string {
  return locale !== undefined ? locale.get() : fallback
}

/** 规则族注册名的双语映射（#45）：键形对齐 vsidian resolveAddonBehaviorName
 *  候选链——键规整 trim+小写，zh 系页面语言依次试 'zh-cn'→'zh'→'en'，
 *  非 zh 只试 'en'，故 'zh-cn' 与 'en' 两键即可全场景命中；返回形态结构化
 *  兼容 SDK AddonBehaviorName 的映射分支（消费端渲染时选值，注册不预解析） */
export function ruleFamilyNameMap(key: keyof Messages['ruleFamilies']): Record<'zh-cn' | 'en', string> {
  return { 'zh-cn': zhMessages.ruleFamilies[key].name, en: enMessages.ruleFamilies[key].name }
}

/** 设置分组标题双语映射（#477：AddonSettingGroup.title 的构造辅助） */
export function settingGroupTitleMap(key: keyof Messages['settingsGroups']): Record<'zh-cn' | 'en', string> {
  return { 'zh-cn': zhMessages.settingsGroups[key], en: enMessages.settingsGroups[key] }
}

/** 枚举档位标签双语映射（#477：enumLabels 值的构造辅助） */
export function enumLabelMap(key: keyof Messages['enumLabels']): Record<'zh-cn' | 'en', string> {
  return { 'zh-cn': zhMessages.enumLabels[key], en: enMessages.enumLabels[key] }
}

export { zhMessages, enMessages }
