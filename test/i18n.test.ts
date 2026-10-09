// i18n 契约（工单 #3）：中英两键集 parity + 语言检测口径 + 设置文案完整性。
// parity 双保险：en 字典以 `Messages`（typeof zh）类型钉住编译期键集，
// 本测试再以运行时深度键集对比防绕过（as 断言 / 动态键注入）。
import { describe, expect, it } from 'vitest'
import { pickMessages, zhMessages, enMessages } from '../src/i18n'

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

  it('设置文案条目 name/desc 均为非空字符串（两语言全量）', () => {
    for (const messages of [zhMessages, enMessages]) {
      for (const [key, entry] of Object.entries(messages.settings)) {
        expect(entry.name, `${key}.name`).toMatch(/\S/)
        expect(entry.desc, `${key}.desc`).toMatch(/\S/)
      }
    }
  })
})
