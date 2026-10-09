// vendored from ONEGAYI/vsidian@9107e2f0554d8b5c1637d16e1d1b375543b01c1c — src/shared/addonSettings.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

// #353 T04 附加组件复杂设置——定义形状、值校验、作用范围解析与存储结构
// 的两端共享单一事实源（纯逻辑，不依赖 vscode/DOM）。
//
// 形状来源：ADR-0012「设置界面与作用范围」（Q21–Q23）、规格 5.4/6.2、
// 技术方案 5.5。仍是草案：字段名随公开声明冻结，不冒充已发布稳定 API。
//
// 设计决策（票面钉住）：
// - 定义**可序列化**：普通值（boolean/number/string）、有限数（min/max
//   可省略，值恒须有限）、数组项与对象字段由定义描述约束——不存在函数
//   校验器形态（消息桥传函数在宿主侧另有结构化克隆防线）。
// - **一层结构**：数组项与对象字段都是标量，不允许嵌套数组/对象。复杂
//   值走本模块独立类型命名空间（AddonSettingValue），与内置标量设置模型
//  （shared/settings.ts 的 SettingsPayloadValue）分离——内置标量类型不
//   能靠类型断言伪装成已支持复杂值。
// - 作用范围：工作区显式 > 用户默认显式 > 出厂默认；显式值非法（定义
//   升级后存量漂移）视为该层未设置，跳过继续下层，不从存储删除。
// - 存储结构冻结 version 1：`{ version, values: { [addonId]: { [key]: value } } }`。
//   解析 fail-safe：version 未知或形态不符整层回 null（宁回默认值，不写
//   回、不删除用户数据）；未来结构变更时按 version 逐版迁移入口在此扩展。
// - 跨窗口边界（1.82.3 API 面核实：Memento 无变更事件）：同窗口以宿主
//   内存为权威并主动推送；跨窗口不做实时推送，读取以新构造（重开/重启）
//   对账，并发写按最后落盘胜出——详见 addonSettingsService.ts 头注。

/** 组件设置标量值（普通值三型） */
export type AddonSettingScalarValue = boolean | number | string

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

/** 组件设置定义（settings.registerDefinitions 的元素形状） */
export type AddonSettingDefinition =
  | (AddonSettingDefinitionBase & { type: 'boolean'; default: boolean })
  | (AddonSettingDefinitionBase & { type: 'number'; min?: number; max?: number; default: number })
  | (AddonSettingDefinitionBase & { type: 'string'; maxLength?: number; enum?: readonly string[]; default: string })
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
}

// ---- 存储结构（version 1 冻结） ----

/** 存储结构版本（冻结；未来结构变更时按 version 逐版迁移） */
export const ADDON_SETTINGS_STORE_VERSION = 1
