// i18n 契约（工单 #3）：中英两键集 parity + 语言检测口径 + 设置文案完整性。
// parity 双保险：en 字典以 `Messages`（typeof zh）类型钉住编译期键集，
// 本测试再以运行时深度键集对比防绕过（as 断言 / 动态键注入）。
// #19 增：内置规则描述映射（builtinRuleDescriptions）完整性——键集必须
// 覆盖全部内置规则 id（default-rules.ts 是单一事实源），防新增规则漏登记。
import { describe, expect, it } from 'vitest'
import { localeTagFor, pickMessages, resolvePageLanguage, zhMessages, enMessages } from '../src/i18n'
import { BUILTIN_CATEGORIES } from '../src/formatting/scriptCategory'
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

// ===== 页面语言源单一出口（#58：SDK locale 跟随主设置） =====

describe('页面语言解析（resolvePageLanguage，#58）', () => {
  // 语言链路契约：locale 面（vsidian#582）在场 → 平台快照优先（跟随主设置，
  // 不读 OS 语言）；面缺席（旧宿主）→ 调用方回退值（页面侧 navigator.language，
  // 保持 #58 前既有行为）。返回值统一经 pickMessages/localeTagFor 映射。
  const facetOf = (value: string) => ({ get: () => value })

  it('locale 面在场：取平台快照，不取回退值（首值经 get 读取）', () => {
    expect(resolvePageLanguage(facetOf('en'), 'zh-CN')).toBe('en')
    expect(resolvePageLanguage(facetOf('zh-cn'), 'en-US')).toBe('zh-cn')
  })

  it('locale 面缺席（旧宿主）：回落调用方回退值（降级路径钉住）', () => {
    expect(resolvePageLanguage(undefined, 'zh-CN')).toBe('zh-CN')
    expect(resolvePageLanguage(undefined, 'en-US')).toBe('en-US')
  })

  it('空串（平台语言包未装配）不回落 OS 语言：整链落英文，与平台无包兜底一致', () => {
    // 空串若回落 navigator.language 会重现页面/平台交杂（票面诊断的病灶），
    // 故钉死：facet 空串 → pickMessages 英文、localeTagFor 'en'
    expect(resolvePageLanguage(facetOf(''), 'zh-CN')).toBe('')
    expect(pickMessages(resolvePageLanguage(facetOf(''), 'zh-CN'))).toBe(enMessages)
    expect(localeTagFor(resolvePageLanguage(facetOf(''), 'zh-CN'))).toBe('en')
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


// ===== scriptNames 覆盖（#49：内置脚本类显示名映射完整性） =====

describe('scriptNames 覆盖内置脚本类', () => {
  it('两语言 scriptNames 键集 ⊇ BUILTIN_CATEGORIES 值集（新增脚本类漏配双语名即红）', () => {
    for (const messages of [zhMessages, enMessages]) {
      const keys = Object.keys(messages.rulesPage.scriptNames)
      for (const category of BUILTIN_CATEGORIES) {
        expect(keys, `${category} 缺显示名`).toContain(category)
      }
    }
  })
})
