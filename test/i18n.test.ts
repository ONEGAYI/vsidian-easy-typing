// i18n 契约（工单 #3）：中英两键集 parity + 语言检测口径 + 设置文案完整性。
// parity 双保险：en 字典以 `Messages`（typeof zh）类型钉住编译期键集，
// 本测试再以运行时深度键集对比防绕过（as 断言 / 动态键注入）。
// #19 增：内置规则描述映射（builtinRuleDescriptions）完整性——键集必须
// 覆盖全部内置规则 id（default-rules.ts 是单一事实源），防新增规则漏登记。
import { describe, expect, it } from 'vitest'
import { pickMessages, zhMessages, enMessages } from '../src/i18n'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'

/** 收集对象的深度键路径（叶子为非对象值；数组视为叶子） */
function deepKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }
  const out: string[] = []
  for (const key of Object.keys(value).sort()) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(...deepKeys((value as Record<string, unknown>)[key], path))
  }
  return out
}

describe('语言检测（pickMessages）', () => {
  it('zh* 语言标签取中文字典', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-cn', 'zh-TW', 'zh_Hans']) {
      expect(pickMessages(tag), tag).toBe(zhMessages)
    }
  })

  it('非中文标签（含空串）回落英文', () => {
    for (const tag of ['en', 'en-US', 'ja-JP', 'fr', 'ru', '']) {
      expect(pickMessages(tag), tag).toBe(enMessages)
    }
  })

  it('大小写不敏感（宿主 vscode.env.language / 页面 navigator.language 同入口）', () => {
    expect(pickMessages('ZH-CN')).toBe(zhMessages)
    expect(pickMessages('EN-us')).toBe(enMessages)
  })
})

describe('中英键集 parity', () => {
  it('深度键路径完全一致', () => {
    expect(deepKeys(enMessages)).toEqual(deepKeys(zhMessages))
  })

  it('数组键长度一致（deepKeys 视数组为叶子，长度差异需独立钉住——审查 F4）', () => {
    // 沿 deepKeys 的叶子路径取两侧数组值对比长度（如 ruleFamilies.*.examples）
    const zh = zhMessages as unknown as Record<string, unknown>
    const en = enMessages as unknown as Record<string, unknown>
    for (const path of deepKeys(zhMessages)) {
      const get = (source: Record<string, unknown>): unknown =>
        path.split('.').reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], source)
      const fromZh = get(zh)
      if (!Array.isArray(fromZh)) continue
      expect(get(en), path).toHaveLength(fromZh.length)
      expect(fromZh.length, path).toBeGreaterThan(0)
    }
  })

  it('设置文案条目 name/desc 均为非空字符串（两语言全量）', () => {
    for (const messages of [zhMessages, enMessages]) {
      for (const [key, entry] of Object.entries(messages.settings)) {
        expect(entry.name, `${key}.name`).toMatch(/\S/)
        expect(entry.desc, `${key}.desc`).toMatch(/\S/)
      }
    }
  })
})

describe('内置规则描述映射（builtinRuleDescriptions，#19）', () => {
  it('两语言键集覆盖全部内置规则 id 且值为非空字符串', () => {
    for (const messages of [zhMessages, enMessages]) {
      // 展开为宽松索引形态（字典类型是字面量键集，string 索引需显式放宽）
      const table: Record<string, string> = { ...messages.builtinRuleDescriptions }
      for (const rule of DEFAULT_BUILTIN_RULES) {
        expect(table[rule.id], rule.id).toMatch(/\S/)
      }
      // 反向：映射内不残留已不存在的内置规则 id（防改名后留孤儿键）
      const builtinIds = new Set(DEFAULT_BUILTIN_RULES.map((rule) => rule.id))
      for (const key of Object.keys(messages.builtinRuleDescriptions)) {
        expect(builtinIds.has(key), `orphan key ${key}`).toBe(true)
      }
    }
  })
})
