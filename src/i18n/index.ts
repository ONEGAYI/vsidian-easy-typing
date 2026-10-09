// i18n 统一入口（工单 #3 首建，#19 完整化：内置规则描述映射 + 多语言
// 扩展指引）：
// - zh 字典是类型源（Messages = typeof zhMessages），en 以编译期类型对齐
//   键集，parity 测试（test/i18n.test.ts）运行时双保险；
// - 语言检测：宿主侧 vscode.env.language、页面侧 navigator.language，
//   统一经 pickMessages(languageTag)——zh* 取中文，其余（含空串）回落英文
//   （上游 moment.locale 检测的 VSCode 平台等价物；本仓无 moment 依赖）；
// - builtinRuleDescriptions（#19）：内置规则描述按规则 id 的本地化映射，
//   消费点在规则管理页列表预览（previewRuleText 查表优先），数据态
//   description 不随语言改写存储。
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

export { zhMessages, enMessages }
