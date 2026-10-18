// vendored from ONEGAYI/vsidian@f7b80d6eda00d16f4fb7ead49aa86fcd41cb75c8 — src/host/addons/addonRegistry.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { AddonRegistrationContext } from '../../shared/addonIdentity'
import type { AddonPageEntryInput } from './addonPageRegistry'
import type { AddonSettingsUpdateResult } from './addonSettingsService'
import type { AddonSettingSource, AddonSettingValue } from '../../shared/addonSettings'
import type { AddonStorageFacet } from '../../shared/addonStorage'
import type { AddonPasteRulesRegisterResult } from '../../shared/addonPasteRules'
import type { AddonThemesRegistrationFacet } from '../../shared/addonThemes'

/** 注册表宿主端口（vscode 层注入） */
export interface AddonRegistryPorts {
  apiVersion: string
  experimental: Readonly<Record<string, string>>
  officialIds: readonly string[]
  /** 按扩展 ID 查当前扩展宿主中的扩展（查不到 = 当前宿主不可用） */
  findExtension(id: string): { packageJSON: unknown } | undefined
}

/** 通道处理器（宿主组件代码注册；载荷与结果都是 JSON 数据） */
export type AddonChannelHandler = (payload: unknown) => unknown | Promise<unknown>

/** 注册面返回的释放句柄（重复 dispose 无害；迟到登记被拒时为 no-op） */
export interface AddonRegistrationHandle {
  dispose(): void
}

/** 设置读取快照（settings.get() 的结果：生效值与来源） */
export interface AddonSettingsGetSnapshot {
  readonly values: Readonly<Record<string, AddonSettingValue>>
  readonly sources: Readonly<Record<string, AddonSettingSource>>
}

/** 设置变化事件（settings.onChanged 的载荷） */
export interface AddonSettingsChangeEventData {
  readonly scope: 'user' | 'workspace'
  readonly keys: readonly string[]
}

/**
 * 设置能力面（setup 生命周期常驻——普通停用后保留；技术方案 5.5 形状）。
 * T02 先立 registerPage/registerDefinitions；T04 起接入读写与事件。
 */
export interface AddonSettingsContextApi {
  /** 设置页入口登记（自身安装目录内的相对路径；越界拒绝） */
  registerPage(entry: AddonPageEntryInput): AddonRegistrationHandle
  /** 设置定义收集（可序列化定义；形状校验矩阵见 shared/addonSettings）。
   *  #472 分组：第二参为可选组声明批（声明序即呈现序），定义的 group 字段
   *  引用其组键——引用未声明组键或组键重复整批拒绝 */
  registerDefinitions(defs: readonly unknown[], groups?: readonly unknown[]): AddonRegistrationHandle
  /** 生效值与来源快照（工作区显式 > 用户默认 > 出厂默认） */
  get(): AddonSettingsGetSnapshot
  /** 单键来源（未定义键为 undefined） */
  getSource(key: string): AddonSettingSource | undefined
  /** 按批校验并保存到指定层（失败不虚报；变化事件只在持久化成功后发出） */
  update(scope: 'user' | 'workspace', patch: Record<string, unknown>): Promise<AddonSettingsUpdateResult>
  /** 清除工作区对某键的覆盖（恢复继承用户默认，不是恢复出厂值） */
  clearWorkspaceOverride(key: string): Promise<AddonSettingsUpdateResult>
  /** 订阅成功保存后的变化（所属组件设置生命周期内有效） */
  onChanged(listener: (change: AddonSettingsChangeEventData) => void): AddonRegistrationHandle
}

/** 轻量接入上下文（setup 生命周期：设置定义 + 自己的设置入口 + 设置通信。
 *  普通功能停用后保留；故障暂停时回收组件代码——迟到注册被拒） */
export interface AddonSetupContext extends AddonRegistrationContext {
  /** 设置能力面（T04 起含读写与事件；定义归组件隔离范围） */
  readonly settings: AddonSettingsContextApi
  /** #404 组件数据目录（globalStorage 语义的隔离可写目录 + 文件监听；
   *  富结构数据（规则对象等）归本面，不并入设置存储的一层边界） */
  readonly storage: AddonStorageFacet
  /** 设置生命周期通道（归 setup 所在的生命周期） */
  readonly channel: AddonChannelRegistry
}

/** 运行上下文（enable 生命周期：编辑器页面入口 + 运行通道 + 粘贴规则 +
 *  清理回调。开启时装配；关闭或故障时释放所属注册） */
export interface AddonEnableContext extends AddonRegistrationContext {
  /** 编辑器页入口登记（自身安装目录内的相对路径；每组件一个编辑器入口，
   *  第二个登记拒绝） */
  readonly pages: {
    registerEditor(entry: AddonPageEntryInput): AddonRegistrationHandle
  }
  /** #546 T07 主题元数据登记（宿主运行功能阶段——不依赖先开编辑器页面；
   *  登记只进目录与选择，实际渲染执行仍归页面 renderers 注册） */
  readonly themes: AddonThemesRegistrationFacet
  /** #404 组件数据目录（与 setup 上下文同一实例——数据能力与功能开关无关） */
  readonly storage: AddonStorageFacet
  /** 运行生命周期通道（停用即注销） */
  readonly channel: AddonChannelRegistry
  /** #541 T01 粘贴转换规则登记（有效规则广播到已开与新开编辑器页面，
   *  在富文本粘贴的 HTML→Markdown 遍历中消费） */
  readonly paste: AddonPasteRulesContextApi
  /** 登记清理回调（停用/故障/代次终结时执行；重复释放无害） */
  onDispose(callback: () => void): void
}

/** 通道注册面（setup/enable 上下文同形状；同名 topic 重复注册拒绝） */
export interface AddonChannelRegistry {
  handle(topic: string, handler: AddonChannelHandler): AddonRegistrationHandle
}

/**
 * 粘贴规则注册面（#541 T01，enable 生命周期；声明式粘贴转换规格 §4.1）。
 * 声明为可序列化数据（形状见 shared/addonPasteRules）；来源组件身份由
 * 平台注入，作者不能冒充其他组件。整批校验：批内 ID 重复、未知操作或
 * 超预算声明整批拒绝（普通 API 拒绝不算组件故障），不部分安装。停用/
 * 故障/代次结束撤回本生命周期全部规则。
 */
export interface AddonPasteRulesContextApi {
  /**
   * 登记一批粘贴转换规则；返回普通注册结果与释放句柄（dispose 只移除
   * 本批，重复调用无害）。已终结代次的迟到注册拒绝 released。
   */
  registerRules(declarations: readonly unknown[]): AddonPasteRulesRegisterResult
}

/** 组件注册传入的定义（T02 形状：setup 轻量接入 + enable 运行装配） */
export interface AddonDefinition {
  /** 轻量接入回调：注册成功时在本接入代次恰好调用一次 */
  setup?(context: AddonSetupContext): void
  /** 运行装配回调：按用户功能开关开启时调用；关闭或故障时释放所属注册 */
  enable?(context: AddonEnableContext): void
}

/** registry → runtime 桥（注册通过/代次释放的生命周期驱动） */
export interface AddonRegistryHooks {
  /** 注册通过校验后调用一次（setup/enable 由 runtime 驱动；实现须自捕获
   *  异常为故障，不向 register 调用方冒泡） */
  onAccepted(addonId: string, definition: AddonDefinition): void
  /** 代次释放（release / 重新注册前）调用；重复调用无害 */
  onReleased(addonId: string): void
}

/** 注册/释放变化监听（协调器据此刷新状态并推送设置页） */
export type AddonRegistryListener = (addonId: string) => void
