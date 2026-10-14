// 设置定义构建（工单 #3）：从 i18n 字典 + 默认值事实源生成
// AddonSettingDefinition[]，交 settings.registerDefinitions 注册进 Vsidian
// 设置页「附加组件」分页。键序与形状对照 docs/specs/settings-mapping.md §二；
// 默认值一律引用 DEFAULT_EFFECTIVE_SETTINGS（同源，不复制第二份），
// 文案一律引用字典（title = name、description = desc），禁止字面量。
//
// #477 声明新形态消费（vendor 快照 1c7c5283）：
// - 分组：每键 group 字段引用 buildSettingGroups 声明的组键（组序 = 声明
//   序 = 上游五 Tab 语义归组——内置/自定义规则两域由自绘规则页承载不进
//   声明；注册侧 registerDefinitions 第二参携带组元数据）；
// - 枚举档位标签：三档空格策略与严格换行模式四键带 per-值双语标签
//   （enumLabels，呈现层——不再只靠 description 说明枚举值语义）；
// - 多行形态：prefixDictionary / userDefinedRegExp 声明 multiline（自由
//   文本多行呈现）；excludeFiles 为 array 型不适用（宿主 #475/#479 的
//   数组粘贴拆分承载批量输入，组件侧无声明动作）。
import type { AddonSettingDefinition, AddonSettingGroup } from '../../types/vendor/shared/addonSettings'
import type { Messages } from '../i18n'
import { enumLabelMap, settingGroupTitleMap } from '../i18n'
import {
  DEFAULT_EFFECTIVE_SETTINGS,
  SPACE_MODE_VALUES,
  STRICT_LINE_MODE_VALUES,
} from './defaults'

/** 三档空格策略的档位标签（enum → 双语映射） */
function spaceModeEnumLabels(): Record<string, Record<'zh-cn' | 'en', string>> {
  return {
    none: enumLabelMap('spaceNone'),
    soft: enumLabelMap('spaceSoft'),
    strict: enumLabelMap('spaceStrict'),
  }
}

/** 严格换行模式的档位标签 */
function strictLineModeEnumLabels(): Record<string, Record<'zh-cn' | 'en', string>> {
  return {
    enter_twice: enumLabelMap('strictLineEnterTwice'),
    two_space: enumLabelMap('strictLineTwoSpace'),
    mix_mode: enumLabelMap('strictLineMix'),
  }
}

export function buildSettingDefinitions(m: Messages): AddonSettingDefinition[] {
  const s = m.settings
  const d = DEFAULT_EFFECTIVE_SETTINGS
  return [
    { key: 'tabout', group: 'edit-enhance', title: s.tabout.name, description: s.tabout.desc, type: 'boolean', default: d.tabout },
    { key: 'smartPaste', group: 'edit-enhance', title: s.smartPaste.name, description: s.smartPaste.desc, type: 'boolean', default: d.smartPaste },
    { key: 'betterCodeEdit', group: 'edit-enhance', title: s.betterCodeEdit.name, description: s.betterCodeEdit.desc, type: 'boolean', default: d.betterCodeEdit },
    { key: 'betterBackspace', group: 'edit-enhance', title: s.betterBackspace.name, description: s.betterBackspace.desc, type: 'boolean', default: d.betterBackspace },
    { key: 'autoFormat', group: 'auto-format', title: s.autoFormat.name, description: s.autoFormat.desc, type: 'boolean', default: d.autoFormat },
    { key: 'autoFormatPaste', group: 'auto-format', title: s.autoFormatPaste.name, description: s.autoFormatPaste.desc, type: 'boolean', default: d.autoFormatPaste },
    {
      key: 'excludeFiles',
      group: 'general',
      title: s.excludeFiles.name,
      description: s.excludeFiles.desc,
      type: 'array',
      items: { kind: 'string' },
      default: [...d.excludeFiles],
    },
    { key: 'autoCapital', group: 'auto-format', title: s.autoCapital.name, description: s.autoCapital.desc, type: 'boolean', default: d.autoCapital },
    { key: 'prefixDictionary', group: 'auto-format', title: s.prefixDictionary.name, description: s.prefixDictionary.desc, type: 'string', multiline: true, default: d.prefixDictionary },
    { key: 'softSpaceLeftSymbols', group: 'auto-format', title: s.softSpaceLeftSymbols.name, description: s.softSpaceLeftSymbols.desc, type: 'string', default: d.softSpaceLeftSymbols },
    { key: 'softSpaceRightSymbols', group: 'auto-format', title: s.softSpaceRightSymbols.name, description: s.softSpaceRightSymbols.desc, type: 'string', default: d.softSpaceRightSymbols },
    { key: 'inlineCodeSpaceMode', group: 'auto-format', title: s.inlineCodeSpaceMode.name, description: s.inlineCodeSpaceMode.desc, type: 'string', enum: [...SPACE_MODE_VALUES], enumLabels: spaceModeEnumLabels(), default: d.inlineCodeSpaceMode },
    { key: 'inlineFormulaSpaceMode', group: 'auto-format', title: s.inlineFormulaSpaceMode.name, description: s.inlineFormulaSpaceMode.desc, type: 'string', enum: [...SPACE_MODE_VALUES], enumLabels: spaceModeEnumLabels(), default: d.inlineFormulaSpaceMode },
    { key: 'inlineLinkSpaceMode', group: 'auto-format', title: s.inlineLinkSpaceMode.name, description: s.inlineLinkSpaceMode.desc, type: 'string', enum: [...SPACE_MODE_VALUES], enumLabels: spaceModeEnumLabels(), default: d.inlineLinkSpaceMode },
    { key: 'inlineLinkSmartSpace', group: 'auto-format', title: s.inlineLinkSmartSpace.name, description: s.inlineLinkSmartSpace.desc, type: 'boolean', default: d.inlineLinkSmartSpace },
    { key: 'userDefinedRegSwitch', group: 'auto-format', title: s.userDefinedRegSwitch.name, description: s.userDefinedRegSwitch.desc, type: 'boolean', default: d.userDefinedRegSwitch },
    { key: 'userDefinedRegExp', group: 'auto-format', title: s.userDefinedRegExp.name, description: s.userDefinedRegExp.desc, type: 'string', multiline: true, default: d.userDefinedRegExp },
    { key: 'userRulesRespectUserDefinedRegexBlocks', group: 'auto-format', title: s.userRulesRespectUserDefinedRegexBlocks.name, description: s.userRulesRespectUserDefinedRegexBlocks.desc, type: 'boolean', default: d.userRulesRespectUserDefinedRegexBlocks },
    { key: 'debug', group: 'experimental', title: s.debug.name, description: s.debug.desc, type: 'boolean', default: d.debug },
    { key: 'strictModeEnter', group: 'experimental', title: s.strictModeEnter.name, description: s.strictModeEnter.desc, type: 'boolean', default: d.strictModeEnter },
    { key: 'strictLineMode', group: 'experimental', title: s.strictLineMode.name, description: s.strictLineMode.desc, type: 'string', enum: [...STRICT_LINE_MODE_VALUES], enumLabels: strictLineModeEnumLabels(), default: d.strictLineMode },
    { key: 'enhanceModA', group: 'edit-enhance', title: s.enhanceModA.name, description: s.enhanceModA.desc, type: 'boolean', default: d.enhanceModA },
    { key: 'collapsePersistentEnter', group: 'experimental', title: s.collapsePersistentEnter.name, description: s.collapsePersistentEnter.desc, type: 'boolean', default: d.collapsePersistentEnter },
    // #13 新增本仓键（非上游映射）：默认值事实源同源引用（见 defaults.ts 接口注）
    { key: 'newLineBelow', group: 'edit-enhance', title: s.newLineBelow.name, description: s.newLineBelow.desc, type: 'boolean', default: d.newLineBelow },
  ]
}

/**
 * 设置分组声明（#477）：组序 = 声明序（注册载荷呈现序），对照上游五 Tab
 * 语义归组——内置规则 / 自定义规则两域由组件自绘规则页承载，不进声明式
 * 表单（映射表 §一去向）。标题 AddonLocalizedText 双语映射（键形同
 * #45/#464 的 zh-cn/en）。
 */
export function buildSettingGroups(): AddonSettingGroup[] {
  return [
    { key: 'edit-enhance', title: settingGroupTitleMap('editEnhance') },
    { key: 'auto-format', title: settingGroupTitleMap('autoFormat') },
    { key: 'general', title: settingGroupTitleMap('general') },
    { key: 'experimental', title: settingGroupTitleMap('experimental') },
  ]
}
