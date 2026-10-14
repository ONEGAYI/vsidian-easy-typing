// vendored from ONEGAYI/vsidian@1c7c5283665f5a0b5934478d8d7e3638afab9753 — src/shared/addonSettings.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { LocalizedText } from './localizedText'

/** 组件设置标量值（普通值三型） */
export type AddonSettingScalarValue = boolean | number | string

/** 枚举档位显示标签的多语言形态（#473）：直值或「语言代码→文本」映射，
 *  选值语义见 localizedText.ts（与 #464 行为名多语言惯例同构） */
export type AddonLocalizedText = LocalizedText

/** 组件设置值：标量 / 标量数组 / 字段为标量的对象（一层结构硬边界） */
export type AddonSettingValue =
  | AddonSettingScalarValue
  | readonly AddonSettingScalarValue[]
  | { readonly [field: string]: AddonSettingScalarValue }

/** 生效值来源（规格 5.4：区分出厂默认、用户默认与工作区覆盖） */
export type AddonSettingSource = 'default' | 'user' | 'workspace'

/** 标量项约束（数组 items 与对象字段共用形状；无嵌套） */
export type AddonScalarItemSpec =
  | { kind: 'boolean' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'string'; maxLength?: number; enum?: readonly string[] }

/**
 * 设置分组声明（#472 引用式分组）：组元数据随注册载荷声明一次，定义以
 * `group` 组键引用。组序 = 声明序；组键组件内唯一；title/description
 * 直值或多语言映射（AddonLocalizedText，与 #464/#473 惯例同构）。
 */
export interface AddonSettingGroup {
  /** 组键（组件内唯一、非空；定义 group 字段引用此键） */
  key: string
  /** 组标题 */
  title: AddonLocalizedText
  /** 可选组说明（组卡片内首行说明色呈现） */
  description?: AddonLocalizedText
}

/** 分组声明的搜索摘要条目（#472 定义级：进全局搜索索引的轻量形状） */
export interface AddonSettingSearchEntry {
  key: string
  title: string
  description?: string
}

/** 全组件设置搜索索引（#472：addons.state 携带，webview 据此建全局搜索条目） */
export interface AddonSettingsSearchIndex {
  /** 定义摘要（注册序；object 字段级不进——定义级即止） */
  definitions: readonly AddonSettingSearchEntry[]
  /** 组声明（声明序；搜索只匹配组标题，description 仅随载荷透传） */
  groups?: readonly AddonSettingGroup[]
}

/** 组件设置定义（settings.registerDefinitions 的元素形状） */
export type AddonSettingDefinition =
  | (AddonSettingDefinitionBase & { type: 'boolean'; default: boolean })
  | (AddonSettingDefinitionBase & { type: 'number'; min?: number; max?: number; default: number })
  | (AddonSettingDefinitionBase & {
    type: 'string'
    maxLength?: number
    enum?: readonly string[]
    /** 枚举档位显示标签（#473，仅呈现层）：键 = enum 值、值 = 直值或多语言
     *  映射；缺失键/缺失整个字段回退渲染枚举值本身。不参与值校验 */
    enumLabels?: Readonly<Record<string, AddonLocalizedText>>
    /** 多行形态声明（#475，仅呈现层）：true 时设置页渲染 textarea，换行符
     *  参与持久化值；缺省/false 保持单行。仅自由文本适用——enum 定义
     *  （档位下拉）拒绝与本声明组合（形状自洽，拼错早失败）。不引入内容校验 */
    multiline?: boolean
    default: string
  })
  | (AddonSettingDefinitionBase & {
    type: 'array'
    /** 重复项约束（一层：只描述标量） */
    items: AddonScalarItemSpec
    default: readonly AddonSettingScalarValue[]
    minItems?: number
    maxItems?: number
  })
  | (AddonSettingDefinitionBase & {
    type: 'object'
    /** 字段表（字段控件的数据源；字段键唯一） */
    fields: ReadonlyArray<AddonSettingDefinitionBase & AddonScalarItemSpec & { default: AddonSettingScalarValue }>
    /** 对象出厂值（缺省按字段 default 组装；显式给出时须逐字段合法且恰好覆盖字段集） */
    default?: Readonly<Record<string, AddonSettingScalarValue>>
  })

/** 持久层结构：两层同构（user = globalState / workspace = workspaceState） */
export interface AddonSettingsStoreV1 {
  readonly version: typeof ADDON_SETTINGS_STORE_VERSION
  readonly values: Readonly<Record<string, Readonly<Record<string, AddonSettingValue>>>>
}

/** 定义公共字段（展示信息为字符串直值——组件的键不进 Vsidian 内置字典） */
interface AddonSettingDefinitionBase {
  /** 稳定标识（组件内唯一、非空；点分层级为建议不强制） */
  key: string
  /** 展示名（组件代码注册的文案直值；缺失译文时按声明的默认语言呈现） */
  title: string
  /** 可选说明 */
  description?: string
  /** #472 所属分组（组键引用——必须已在 registerDefinitions 载荷的 groups
   *  中声明；引用合法性由注册批校验，本守卫只校验字符串形状） */
  group?: string
}

// ---- 存储结构（version 1 冻结） ----

/** 存储结构版本（冻结；未来结构变更时按 version 逐版迁移） */
export const ADDON_SETTINGS_STORE_VERSION = 1
