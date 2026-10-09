// 设置定义构建（工单 #3）：从 i18n 字典 + 默认值事实源生成
// AddonSettingDefinition[]，交 settings.registerDefinitions 注册进 Vsidian
// 设置页「附加组件」分页。键序与形状对照 docs/specs/settings-mapping.md §二；
// 默认值一律引用 DEFAULT_EFFECTIVE_SETTINGS（同源，不复制第二份），
// 文案一律引用字典（title = name、description = desc），禁止字面量。
import type { AddonSettingDefinition } from '../../types/vendor/shared/addonSettings'
import type { Messages } from '../i18n'
import {
  DEFAULT_EFFECTIVE_SETTINGS,
  SPACE_MODE_VALUES,
  STRICT_LINE_MODE_VALUES,
} from './defaults'

export function buildSettingDefinitions(m: Messages): AddonSettingDefinition[] {
  const s = m.settings
  const d = DEFAULT_EFFECTIVE_SETTINGS
  return [
    { key: 'tabout', title: s.tabout.name, description: s.tabout.desc, type: 'boolean', default: d.tabout },
    { key: 'smartPaste', title: s.smartPaste.name, description: s.smartPaste.desc, type: 'boolean', default: d.smartPaste },
    { key: 'betterCodeEdit', title: s.betterCodeEdit.name, description: s.betterCodeEdit.desc, type: 'boolean', default: d.betterCodeEdit },
    { key: 'betterBackspace', title: s.betterBackspace.name, description: s.betterBackspace.desc, type: 'boolean', default: d.betterBackspace },
    { key: 'autoFormat', title: s.autoFormat.name, description: s.autoFormat.desc, type: 'boolean', default: d.autoFormat },
    { key: 'autoFormatPaste', title: s.autoFormatPaste.name, description: s.autoFormatPaste.desc, type: 'boolean', default: d.autoFormatPaste },
    {
      key: 'excludeFiles',
      title: s.excludeFiles.name,
      description: s.excludeFiles.desc,
      type: 'array',
      items: { kind: 'string' },
      default: [...d.excludeFiles],
    },
    { key: 'autoCapital', title: s.autoCapital.name, description: s.autoCapital.desc, type: 'boolean', default: d.autoCapital },
    { key: 'prefixDictionary', title: s.prefixDictionary.name, description: s.prefixDictionary.desc, type: 'string', default: d.prefixDictionary },
    { key: 'softSpaceLeftSymbols', title: s.softSpaceLeftSymbols.name, description: s.softSpaceLeftSymbols.desc, type: 'string', default: d.softSpaceLeftSymbols },
    { key: 'softSpaceRightSymbols', title: s.softSpaceRightSymbols.name, description: s.softSpaceRightSymbols.desc, type: 'string', default: d.softSpaceRightSymbols },
    { key: 'inlineCodeSpaceMode', title: s.inlineCodeSpaceMode.name, description: s.inlineCodeSpaceMode.desc, type: 'string', enum: [...SPACE_MODE_VALUES], default: d.inlineCodeSpaceMode },
    { key: 'inlineFormulaSpaceMode', title: s.inlineFormulaSpaceMode.name, description: s.inlineFormulaSpaceMode.desc, type: 'string', enum: [...SPACE_MODE_VALUES], default: d.inlineFormulaSpaceMode },
    { key: 'inlineLinkSpaceMode', title: s.inlineLinkSpaceMode.name, description: s.inlineLinkSpaceMode.desc, type: 'string', enum: [...SPACE_MODE_VALUES], default: d.inlineLinkSpaceMode },
    { key: 'inlineLinkSmartSpace', title: s.inlineLinkSmartSpace.name, description: s.inlineLinkSmartSpace.desc, type: 'boolean', default: d.inlineLinkSmartSpace },
    { key: 'userDefinedRegSwitch', title: s.userDefinedRegSwitch.name, description: s.userDefinedRegSwitch.desc, type: 'boolean', default: d.userDefinedRegSwitch },
    { key: 'userDefinedRegExp', title: s.userDefinedRegExp.name, description: s.userDefinedRegExp.desc, type: 'string', default: d.userDefinedRegExp },
    { key: 'userRulesRespectUserDefinedRegexBlocks', title: s.userRulesRespectUserDefinedRegexBlocks.name, description: s.userRulesRespectUserDefinedRegexBlocks.desc, type: 'boolean', default: d.userRulesRespectUserDefinedRegexBlocks },
    { key: 'debug', title: s.debug.name, description: s.debug.desc, type: 'boolean', default: d.debug },
    { key: 'strictModeEnter', title: s.strictModeEnter.name, description: s.strictModeEnter.desc, type: 'boolean', default: d.strictModeEnter },
    { key: 'strictLineMode', title: s.strictLineMode.name, description: s.strictLineMode.desc, type: 'string', enum: [...STRICT_LINE_MODE_VALUES], default: d.strictLineMode },
    { key: 'enhanceModA', title: s.enhanceModA.name, description: s.enhanceModA.desc, type: 'boolean', default: d.enhanceModA },
    { key: 'collapsePersistentEnter', title: s.collapsePersistentEnter.name, description: s.collapsePersistentEnter.desc, type: 'boolean', default: d.collapsePersistentEnter },
  ]
}
