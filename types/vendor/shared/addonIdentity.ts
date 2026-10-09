// vendored from ONEGAYI/vsidian@7651616e466d4950ee40880079634e3a78424162 — src/shared/addonIdentity.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

export type { OfficialAddonEntry } from './officialAddons'

/** 合法身份声明形状 */
export interface AddonIdentityDeclaration {
  /** 声明格式版本（当前仅支持 1） */
  manifestVersion: number
  /** 支持的稳定 API 范围（semver range 子集，如 '^1.0.0'） */
  api: string
  /** 确有使用时才声明的实验入口兼容范围（入口名 → 版本范围） */
  experimental?: Readonly<Record<string, string>>
}

/** 声明解析结果：none = 普通扩展（无声明，不入组件列表） */
export type AddonDeclarationParseResult =
  | { kind: 'none' }
  | {
      kind: 'invalid'
      /** 拒绝原因（呈现层组句用） */
      reason: 'field-not-object' | 'manifest-version-unsupported' | 'api-invalid' | 'experimental-invalid'
    }
  | { kind: 'ok'; declaration: AddonIdentityDeclaration }

/** 兼容判定的宿主侧输入 */
export interface AddonCompatibilityHost {
  /** 宿主当前提供的稳定 API 版本 */
  apiVersion: string
  /** 宿主当前支持的实验入口表（入口名 → 宿主侧版本范围；未发布的入口不在表内） */
  experimental: Readonly<Record<string, string>>
}

export type AddonCompatibility =
  | { compatible: true }
  | {
      compatible: false
      reason: 'api-range' | 'experimental-unsupported' | 'experimental-incompatible'
      /** experimental 拒绝时点名入口名 */
      entry?: string
    }

/** 注册入口拒绝原因（公开协议结果；详见 design 文档第 2.2 节） */
export type AddonRegisterRejection =
  /** 调用者扩展无合法身份声明（普通扩展或声明形状非法） */
  | 'not-addon-extension'
  /** 当前扩展宿主查不到调用者扩展（不等于未安装或装错侧） */
  | 'extension-not-in-host'
  /** 声明合法但 API 范围/实验兼容与宿主不符 */
  | 'incompatible-api'
  /** 同一接入代次重复注册（不重跑 setup；手动重试先释放旧代次） */
  | 'already-registered'

/** 注册成功时返回给组件的接入上下文（轻量形状，后续票扩展） */
export interface AddonRegistrationContext {
  addonId: string
  apiVersion: string
}

export type AddonRegistrationResult =
  | { ok: true; addon: AddonRegistrationContext }
  | { ok: false; reason: AddonRegisterRejection; detail?: string }

/** 设置页状态列表条目（发现/注册协调的呈现载荷；协议 addons.state 使用） */
export type AddonStatusKind =
  /** 已注册（setup 已在本接入代次执行） */
  | 'registered'
  /** 唤醒在途（Vsidian 主动 activate 进行中） */
  | 'activating'
  /** 已激活（原生或唤醒）但组件尚未调用注册入口 */
  | 'awaiting-registration'
  /** 合法声明但 API 范围/实验兼容不符（不唤醒） */
  | 'incompatible'
  /** 主动唤醒失败（激活抛错） */
  | 'activation-failed'
  /** 曾发现，当前宿主已查不到（原因不可判——不等于未安装或装错侧） */
  | 'host-unavailable'
  /** 声明形状非法 */
  | 'invalid-declaration'

export interface AddonStatusEntry {
  /** 组件 ID（沿用 Extension.id） */
  id: string
  /** 展示名（displayName 或 id 回退） */
  label: string
  /** 官方归属（仅 OFFICIAL_ADDON_EXTENSION_IDS 判定） */
  official: boolean
  status: AddonStatusKind
  /** 原因/摘要原文（错误消息、声明范围等；呈现层原样展示或组句） */
  detail?: string
  /** 不兼容时携带的声明 api 范围（组句呈现） */
  apiRange?: string
  /** #351 T02 运行状态（已注册组件附带）：用户偏好生效值（设置页开关
   *  与「已启用/已停用」归类依据）；未注册组件缺省 */
  enabled?: boolean
  /** #351 T02 故障暂停（可归因异常原文——基础可观察，完整诊断归 T12） */
  fault?: { reason: string }
  /** #351 T02 设置页入口当前可装载（「打开设置页」入口可见性） */
  hasSettingsPage?: boolean
  /** #353 T04 已注册设置定义（「基础设置」入口可见性；故障暂停时定义
   *  保留——入口仍在，平台基础控件可用） */
  hasSettingsDefinitions?: boolean
}
