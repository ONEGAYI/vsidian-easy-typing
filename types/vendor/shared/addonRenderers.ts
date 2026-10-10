// vendored from ONEGAYI/vsidian@9107e2f0554d8b5c1637d16e1d1b375543b01c1c — src/shared/addonRenderers.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 渲染提供者支持的模式（T06 统一视图口径） */
export type AddonRendererMode = 'live' | 'reading'

/** 图形导出格式（可选能力；空数组 = 无图形导出，弹窗与导出降级） */
export type AddonRendererExportFormat = 'svg' | 'png'

/** 组件页面代码注册的提供者声明（可序列化部分——上报宿主参与选择） */
export interface AddonRendererProviderInfo {
  /** 局部稳定 ID（非空；与组件 ID 组成持久提供者身份，不以显示名作存储键） */
  rendererId: string
  /** 用户可读名称（必填——对齐行为注册「名称必填」约定） */
  label: string
  /** 支持语言（trim 后 info 全等、大小写敏感——与 RENDERED_FENCE_LABELS 同口径） */
  languages: readonly string[]
  /** 支持模式（非空子集；未支持的模式不调用其入口） */
  modes: readonly AddonRendererMode[]
  /** 图形导出能力（弹窗/导出链路的降级依据） */
  exportFormats: readonly AddonRendererExportFormat[]
}

/** 宿主侧已知候选（声明 + 归属组件） */
export interface AddonRendererCandidate extends AddonRendererProviderInfo {
  addonId: string
  /** 稳定提供者 ID：`${addonId}/${rendererId}` */
  providerId: string
}

/** 渲染挂载上下文（mount/refresh/release 回调入参；页面端执行） */
export interface AddonRendererMountContext {
  language: string
  /** 目标视图模式（组件未支持的模式不会收到调用） */
  mode: AddonRendererMode
}

/**
 * 组件页面代码注册渲染提供者的完整形状（技术方案 5.3「renderers.register」
 * 的候选草案）。回调留在 webview 内执行——桥只把可序列化声明
 * （AddonRendererProviderInfo）上报宿主参与选择；宿主的生效表广播回来后
 * 才对挂载生效（顺序由宿主决定，不靠脚本装载竞速）。
 */
export interface AddonRendererRegistration extends AddonRendererProviderInfo {
  /** 容器内挂载（同步入口；异步装载由组件自行管理，结果只进本容器——
   *  平台保证容器不跨生效代次复用，旧代次容器退场即与组件代码无关） */
  mount(container: HTMLElement, code: string, ctx: AddonRendererMountContext): void
  /** 就地刷新（热切换重派发等；缺省走 release + mount） */
  refresh?(container: HTMLElement, code: string, ctx: AddonRendererMountContext): void
  /** 释放（接管切换、容器退场、停用或故障；重复释放无害） */
  release?(container: HTMLElement, ctx: AddonRendererMountContext): void
  /** 取导出 SVG 字符串（exportFormats 含 'svg' 时必须提供；弹窗与导出共用） */
  exportSvg?(code: string, language: string): Promise<string>
}

/** SDK renderers 面（仅编辑器页提供）：登记提供者，返回释放句柄 */
export interface AddonRenderersFacet {
  /** 声明非法或代次已终结时拒绝（no-op 句柄；不构成组件故障） */
  register(spec: AddonRendererRegistration): { dispose(): void }
}

/** 发现批次与用户首选的持久化形状（v1 冻结 fail-safe） */
export interface AddonRendererStoreV1 {
  version: 1
  /** 已记录组件的发现批次（addonId → 批次号；一经记录不改写——重启/重复
   *  注册/普通升级不重新分配，新安装语义据此识别） */
  batches: Record<string, number>
  /** 下一批次号（从 1 起单调递增） */
  nextBatch: number
  /** 用户按语言的显式首选（language → providerId，含 'builtin'）；
   *  内置接管不清除——恢复后按原选择显示 */
  preferred: Record<string, string>
}

/** 单语言选择结果（effective='none' = 无可用提供者且非内置语言 → 普通代码块） */
export interface AddonRendererLanguageSelection {
  language: string
  effective: string
  /** 生效来源：'user' = 用户显式首选且当前可用；'auto' = 确定性默认序 */
  source: 'user' | 'auto'
}

/** 宿主 → 编辑器 webview 的生效提供者表（广播载荷） */
export interface AddonRenderersTablePayload {
  /** 表版本（内容变化才递增；webview 等值跳过） */
  version: number
  /** 本会话已知候选（含不可用——webview 侧标签/观测用） */
  providers: readonly AddonRendererCandidate[]
  /** 逐语言生效提供者（只含被候选声明过的语言；未列语言默认内置注册表） */
  languages: readonly AddonRendererLanguageSelection[]
}

/** 选择输入（纯函数：候选、可用性谓词、内置语言、首选与批次） */
export interface RendererSelectionInput {
  candidates: readonly AddonRendererCandidate[]
  isAvailable: (candidate: AddonRendererCandidate) => boolean
  /** 内置图形语言（graphicRenderers 注册表键集） */
  builtinLanguages: readonly string[]
  preferred: Readonly<Record<string, string>>
  batches: Readonly<Record<string, number>>
}

/** webview → 宿主：某组件当前装载代次内注册的提供者集（空数组 = 全部撤销） */
export interface AddonRenderersRegisteredPayload {
  addonId: string
  providers: readonly AddonRendererProviderInfo[]
}
