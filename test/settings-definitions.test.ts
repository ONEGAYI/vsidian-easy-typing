// 设置定义形状契约（工单 #3）：全量清单防漏项 + 默认值矩阵 + 文案来自字典。
// 全量键清单在本测试独立硬编码（不从实现导入——防同源盲区），与
// docs/specs/settings-mapping.md §二的 23 项一一对应；上游 30 字段中
// 3 项永不移植、3 项归 #14 storage、1 项剔除，均不在此出现。
import { describe, expect, it } from 'vitest'
import type { AddonSettingDefinition } from '../types/vendor/shared/addonSettings'
import { buildSettingDefinitions } from '../src/settings/definitions'
import {
  DEFAULT_EFFECTIVE_SETTINGS,
  SPACE_MODE_VALUES,
  STRICT_LINE_MODE_VALUES,
} from '../src/settings/defaults'
import { pickMessages } from '../src/i18n'

/** 进设置 schema 的 23 键（顺序 = 映射表 §二） */
const EXPECTED_KEYS = [
  'tabout',
  'smartPaste',
  'betterCodeEdit',
  'betterBackspace',
  'autoFormat',
  'autoFormatPaste',
  'excludeFiles',
  'autoCapital',
  'prefixDictionary',
  'softSpaceLeftSymbols',
  'softSpaceRightSymbols',
  'inlineCodeSpaceMode',
  'inlineFormulaSpaceMode',
  'inlineLinkSpaceMode',
  'inlineLinkSmartSpace',
  'userDefinedRegSwitch',
  'userDefinedRegExp',
  'userRulesRespectUserDefinedRegexBlocks',
  'debug',
  'strictModeEnter',
  'strictLineMode',
  'enhanceModA',
  'collapsePersistentEnter',
] as const

const zhDefs = buildSettingDefinitions(pickMessages('zh-CN'))
const enDefs = buildSettingDefinitions(pickMessages('en-US'))

function defByKey(defs: AddonSettingDefinition[], key: string): AddonSettingDefinition {
  const hit = defs.find((d) => d.key === key)
  if (!hit) throw new Error(`设置定义缺失：${key}`)
  return hit
}

describe('定义全量清单（防漏项）', () => {
  it('键集与顺序与映射表 §二完全一致（23 项）', () => {
    expect(zhDefs.map((d) => d.key)).toEqual([...EXPECTED_KEYS])
  })

  it('键唯一', () => {
    expect(new Set(zhDefs.map((d) => d.key)).size).toBe(EXPECTED_KEYS.length)
  })

  it('默认值单一事实源覆盖全部 23 键（defaults 与定义同源）', () => {
    expect(Object.keys(DEFAULT_EFFECTIVE_SETTINGS).sort()).toEqual([...EXPECTED_KEYS].sort())
  })
})

describe('定义形状与默认值矩阵', () => {
  it('布尔项：type/default 与默认事实源一致', () => {
    const booleanKeys = EXPECTED_KEYS.filter(
      (key) => typeof DEFAULT_EFFECTIVE_SETTINGS[key] === 'boolean',
    )
    expect(booleanKeys.length).toBe(14)
    for (const key of booleanKeys) {
      const def = defByKey(zhDefs, key)
      expect(def.type, key).toBe('boolean')
      expect(def.default, key).toBe(DEFAULT_EFFECTIVE_SETTINGS[key])
    }
  })

  it('普通字符串项：type/default 一致（4 项）', () => {
    for (const key of [
      'prefixDictionary',
      'softSpaceLeftSymbols',
      'softSpaceRightSymbols',
      'userDefinedRegExp',
    ] as const) {
      const def = defByKey(zhDefs, key)
      expect(def.type, key).toBe('string')
      expect(def.default, key).toBe(DEFAULT_EFFECTIVE_SETTINGS[key])
      expect(typeof def.default, key).toBe('string')
    }
  })

  it('三档空格策略枚举：enum 顺序 none/soft/strict，默认 soft（3 项）', () => {
    for (const key of [
      'inlineCodeSpaceMode',
      'inlineFormulaSpaceMode',
      'inlineLinkSpaceMode',
    ] as const) {
      const def = defByKey(zhDefs, key)
      expect(def.type, key).toBe('string')
      if (def.type !== 'string') continue
      expect(def.enum, key).toEqual([...SPACE_MODE_VALUES])
      expect(SPACE_MODE_VALUES).toContain(def.default as string)
      expect(def.default, key).toBe('soft')
    }
  })

  it('严格换行模式枚举：上游三值原样直映，默认 enter_twice', () => {
    const def = defByKey(zhDefs, 'strictLineMode')
    expect(def.type).toBe('string')
    if (def.type !== 'string') return
    expect(def.enum).toEqual([...STRICT_LINE_MODE_VALUES])
    expect(def.default).toBe('enter_twice')
  })

  it('ExcludeFiles：字符串数组（拆平上游多行字符串），默认空数组', () => {
    const def = defByKey(zhDefs, 'excludeFiles')
    expect(def.type).toBe('array')
    if (def.type !== 'array') return
    expect(def.items).toEqual({ kind: 'string' })
    expect(def.default).toEqual([])
  })

  it('上游默认值锚点抽查（对照 settings_types.ts DEFAULT_SETTINGS）', () => {
    expect(DEFAULT_EFFECTIVE_SETTINGS.tabout).toBe(true)
    expect(DEFAULT_EFFECTIVE_SETTINGS.autoCapital).toBe(false)
    expect(DEFAULT_EFFECTIVE_SETTINGS.prefixDictionary).toBe(
      'n8n, /[1234][dD]/\npython3, Python3',
    )
    expect(DEFAULT_EFFECTIVE_SETTINGS.softSpaceLeftSymbols).toBe('-')
    expect(DEFAULT_EFFECTIVE_SETTINGS.softSpaceRightSymbols).toBe('-')
    expect(DEFAULT_EFFECTIVE_SETTINGS.inlineLinkSmartSpace).toBe(true)
    expect(DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegSwitch).toBe(true)
    expect(DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegExp).toContain('{{.*?}}|++')
    expect(DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegExp).toContain(
      '(file:///|https?://|ftp://|obsidian://|zotero://|www.)',
    )
    expect(DEFAULT_EFFECTIVE_SETTINGS.userRulesRespectUserDefinedRegexBlocks).toBe(false)
    expect(DEFAULT_EFFECTIVE_SETTINGS.debug).toBe(false)
    expect(DEFAULT_EFFECTIVE_SETTINGS.strictModeEnter).toBe(false)
    expect(DEFAULT_EFFECTIVE_SETTINGS.enhanceModA).toBe(false)
    expect(DEFAULT_EFFECTIVE_SETTINGS.collapsePersistentEnter).toBe(false)
  })
})

describe('文案来自 i18n 字典（禁止硬编码字面量散落）', () => {
  const cases: Array<[string, ReturnType<typeof pickMessages>]> = [
    ['zh-CN', pickMessages('zh-CN')],
    ['en-US', pickMessages('en-US')],
  ]

  for (const [tag, messages] of cases) {
    it(`${tag}：每项 title/description 与字典逐字相等`, () => {
      const defs = tag === 'zh-CN' ? zhDefs : enDefs
      for (const key of EXPECTED_KEYS) {
        const entry = messages.settings[key as keyof typeof messages.settings]
        const def = defByKey(defs, key)
        expect(def.title, `${tag}:${key}.title`).toBe(entry.name)
        expect(def.description, `${tag}:${key}.description`).toBe(entry.desc)
      }
    })
  }

  it('字符串默认值不含 CJK（默认值是数据不是文案）', () => {
    expect(DEFAULT_EFFECTIVE_SETTINGS.prefixDictionary).not.toMatch(/[\u4e00-\u9fff]/)
    expect(DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegExp).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
