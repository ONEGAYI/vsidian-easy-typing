// i18n 统一入口（工单 #3 首建，#19 扩展到文档级时在此结构上生长）：
// - zh 字典是类型源（Messages = typeof zhMessages），en 以编译期类型对齐
//   键集，parity 测试（test/i18n.test.ts）运行时双保险；
// - 语言检测：宿主侧 vscode.env.language、页面侧 navigator.language，
//   统一经 pickMessages(languageTag)——zh* 取中文，其余（含空串）回落英文。
import { zhMessages } from './zh-CN'
import { enMessages } from './en-US'

export type Messages = typeof zhMessages

/** 按语言标签取字典（大小写不敏感；zh* → 中文，其余 → 英文） */
export function pickMessages(language: string): Messages {
  return language.toLowerCase().startsWith('zh') ? zhMessages : enMessages
}

export { zhMessages, enMessages }
