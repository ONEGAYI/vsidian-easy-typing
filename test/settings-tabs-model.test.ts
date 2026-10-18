// 设置页五 Tab 归属映射纯函数契约（工单 #55 切片 1）：Tab 框架与规则分区
// 挂载之前的映射事实源——24 键全覆盖无遗漏、excludeFiles 特例归自动格式化、
// 卡片分区与组路由两套口径互相咬合。全量键清单在本测试独立硬编码（不从
// 实现导入——防同源盲区，对齐 test/settings-definitions.test.ts 的
// EXPECTED_KEYS 约定）；后续切片 3（搜索定位）消费同一映射面，导出形态
// 契约在此钉住。
import { describe, expect, it } from 'vitest'
import { buildSettingDefinitions } from '../src/settings/definitions'
import { zhMessages } from '../src/i18n'
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TAB_CARDS,
  SETTINGS_TAB_IDS,
  groupKeyToCardAnchor,
  groupKeyToTabId,
  settingKeyToTabId,
  settingKeysByTab,
  type SettingsTabId,
} from '../src/settings/tabs-model'

/** 进设置 schema 的 24 键（顺序 = 映射表 §二；与 settings-definitions 测试同源硬编码） */
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
  'newLineBelow',
] as const

const defs = buildSettingDefinitions(zhMessages)

describe('五 Tab 清单与默认态', () => {
  it('Tab id 集与顺序对照上游五 Tab（同名同序）', () => {
    expect([...SETTINGS_TAB_IDS]).toEqual(['edit-enhance', 'auto-format', 'builtin-rules', 'user-rules', 'other'])
  })

  it('默认 Tab 为编辑增强（Tab 态不持久化，每次装载复位）', () => {
    expect(DEFAULT_SETTINGS_TAB).toBe('edit-enhance')
  })
})

describe('声明组键 → 页内 Tab 路由', () => {
  it('四组路由正确（general 特例归自动格式化）', () => {
    expect(groupKeyToTabId('edit-enhance')).toBe('edit-enhance')
    expect(groupKeyToTabId('auto-format')).toBe('auto-format')
    expect(groupKeyToTabId('general')).toBe('auto-format')
    expect(groupKeyToTabId('experimental')).toBe('other')
  })

  it('未知组键抛错（保持配置错误可闻）', () => {
    expect(() => groupKeyToTabId('unknown-group')).toThrow()
  })
})

describe('组键 → 组卡片锚点（切片 3 搜索定位 group 落点）', () => {
  it('四组锚到组首卡片：auto-format 组锚总开关卡、general 组锚排除文件卡（特例同 Tab）', () => {
    expect(groupKeyToCardAnchor('edit-enhance', defs)).toEqual({ tabId: 'edit-enhance', cardKey: 'editEnhance' })
    expect(groupKeyToCardAnchor('auto-format', defs)).toEqual({ tabId: 'auto-format', cardKey: 'autoFormat' })
    expect(groupKeyToCardAnchor('general', defs)).toEqual({ tabId: 'auto-format', cardKey: 'excludeFiles' })
    expect(groupKeyToCardAnchor('experimental', defs)).toEqual({ tabId: 'other', cardKey: 'experimental' })
  })

  it('锚点 tabId 与组路由一致（两套口径咬合）', () => {
    for (const groupKey of ['edit-enhance', 'auto-format', 'general', 'experimental']) {
      expect(groupKeyToCardAnchor(groupKey, defs)?.tabId, groupKey).toBe(groupKeyToTabId(groupKey))
    }
  })

  it('锚点卡片真实存在于卡片总表且属该 Tab（防御漂移）', () => {
    for (const groupKey of ['edit-enhance', 'auto-format', 'general', 'experimental']) {
      const anchor = groupKeyToCardAnchor(groupKey, defs)
      expect(anchor, groupKey).not.toBeNull()
      const card = SETTINGS_TAB_CARDS.find((c) => c.cardKey === anchor?.cardKey)
      expect(card, groupKey).toBeDefined()
      expect(card?.tabId, groupKey).toBe(anchor?.tabId)
    }
  })

  it('未知组键返回 null（定位消费方静默降级，不抛错）', () => {
    expect(groupKeyToCardAnchor('unknown-group', defs)).toBeNull()
  })

  it('空 defs（组内无注册定义）返回 null', () => {
    expect(groupKeyToCardAnchor('edit-enhance', [])).toBeNull()
  })
})

describe('设置键 → 页内 Tab（24 键全覆盖）', () => {
  it('全部 24 键均可路由且无 null', () => {
    for (const key of EXPECTED_KEYS) {
      expect(settingKeyToTabId(key, defs), key).not.toBeNull()
    }
  })

  it('excludeFiles 特例：声明在 general 组但归自动格式化 Tab', () => {
    expect(settingKeyToTabId('excludeFiles', defs)).toBe('auto-format')
  })

  it('newLineBelow（#13 本仓键）归编辑增强', () => {
    expect(settingKeyToTabId('newLineBelow', defs)).toBe('edit-enhance')
  })

  it('未注册键返回 null（定位消费方可判空降级，不抛错）', () => {
    expect(settingKeyToTabId('no-such-key', defs)).toBeNull()
  })

  it('Tab 归属计数：编辑增强 6 / 自动格式化 14 / 其他设置 4（内置/自定义规则 Tab 无设置行）', () => {
    const byTab = settingKeysByTab(defs)
    expect(byTab['edit-enhance']).toHaveLength(6)
    expect(byTab['auto-format']).toHaveLength(14)
    expect(byTab.other).toHaveLength(4)
    expect(byTab['builtin-rules']).toEqual([])
    expect(byTab['user-rules']).toEqual([])
  })

  it('Tab 键清单并集 = 24 键全集且互不重叠', () => {
    const byTab = settingKeysByTab(defs)
    const all = SETTINGS_TAB_IDS.flatMap((tab) => [...byTab[tab]])
    expect(new Set(all).size).toBe(EXPECTED_KEYS.length)
    expect([...all].sort()).toEqual([...EXPECTED_KEYS].sort())
  })
})

describe('卡片分区（对照上游设置页卡片结构）', () => {
  it('卡片只落在三个设置 Tab（规则两 Tab 由规则分区承载）', () => {
    const cardTabs = new Set(SETTINGS_TAB_CARDS.map((c) => c.tabId))
    expect([...cardTabs].sort()).toEqual(['auto-format', 'edit-enhance', 'other'])
  })

  it('卡片键并集 = 24 键全集，每键恰好出现一次', () => {
    const all = SETTINGS_TAB_CARDS.flatMap((c) => [...c.settingKeys])
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('每张卡片的键经组路由落回本卡片所在 Tab（两套口径咬合）', () => {
    for (const card of SETTINGS_TAB_CARDS) {
      for (const key of card.settingKeys) {
        expect(settingKeyToTabId(key, defs), `${card.cardKey}/${key}`).toBe(card.tabId)
      }
    }
  })

  it('自动格式化总开关是 autoFormat 卡首键（联动置灰的主控行）', () => {
    const card = SETTINGS_TAB_CARDS.find((c) => c.cardKey === 'autoFormat')
    expect(card?.settingKeys[0]).toBe('autoFormat')
  })

  it('settingKeysByTab 与卡片分区同源（顺序 = 卡片声明序）', () => {
    const byTab = settingKeysByTab(defs)
    for (const tab of ['edit-enhance', 'auto-format', 'other'] as const) {
      const fromCards = SETTINGS_TAB_CARDS.filter((c) => c.tabId === tab).flatMap((c) => [...c.settingKeys])
      expect(byTab[tab]).toEqual(fromCards)
    }
    // 稳定性：重复计算结果一致（纯函数）
    expect(settingKeysByTab(defs)).toEqual(byTab)
  })

  it('类型收窄：SettingsTabId 是五字面量联合', () => {
    const tabs: SettingsTabId[] = ['edit-enhance', 'auto-format', 'builtin-rules', 'user-rules', 'other']
    expect(tabs.every((t) => SETTINGS_TAB_IDS.includes(t))).toBe(true)
  })
})
