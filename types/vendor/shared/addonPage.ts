// vendored from ONEGAYI/vsidian@7651616e466d4950ee40880079634e3a78424162 — src/shared/addonPage.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { Extension } from '@codemirror/state'
import type { AddonHeadingFoldFacet } from './addonFoldApi'
import type { AddonRenderersFacet } from './addonRenderers'
import type { AddonViewHandle, AddonViewsFacet } from './addonEditApi'
import type { AddonBehaviorsFacet } from './addonBehaviors'
import type { AddonCommandDefinition, AddonCommandRegisterResult, AddonMenuItemDefinition } from './addonCommands'
import type { AddonUiButtonDefinition, AddonUiPanelDefinition } from './addonUi'

/** #406 language 语法树读取子集（@codemirror/language 的最小暴露面）：
 *  只纳入「读树」函数——LRLanguage/foldGutter/indentUnit 等注册类成员不
 *  暴露（addon 不应借实验入口注册语言或改全局语言配置）；树与节点的
 *  类型消费经 type-only 导入（构建桥允许），无需值暴露。 */
export interface AddonCm6LanguageRuntime {
  readonly syntaxTree: (typeof import('@codemirror/language'))['syntaxTree']
  readonly ensureSyntaxTree: (typeof import('@codemirror/language'))['ensureSyntaxTree']
  readonly syntaxTreeAvailable: (typeof import('@codemirror/language'))['syntaxTreeAvailable']
}

/** 页面提供的共享 CM6 运行时（experimental.cm6 的内容）。值为本页 bundle
 *  内的模块命名空间对象——装载器由页面产物自身构造，因此与生产控制器
 *  共享同一份实例（构造器身份一致的机制来源）。language 是语法树读取
 *  函数子集（#406），非整模块命名空间。 */
export interface AddonCm6Runtime {
  readonly state: typeof import('@codemirror/state')
  readonly view: typeof import('@codemirror/view')
  readonly language: AddonCm6LanguageRuntime
}

/** T10（#359）SDK 命令面（仅编辑器页）：注册自己的可绑定命令——操作进入
 *  统一快捷键管理（冲突检查/绑定/清空/恢复），命令面板经宿主命令可达。
 *  命名空间由平台注入（`<addonId>.<localId>`）；同名注册与非法形状明确
 *  拒绝（普通 API 拒绝，不算故障）。 */
export interface AddonSdkCommandsFacet {
  register(def: AddonCommandDefinition, handler: () => void): AddonCommandRegisterResult & { dispose(): void }
}

/** T11（#360）SDK 界面面（仅编辑器页）：往**平台预定义挂载点**新增自己
 *  的工具栏按钮与面板——不把内核容器、内置界面、菜单或设置框架交给作者
 *  接管（按钮槽位白名单、面板 dock 唯一宿主）。按钮动作二选一：挂接 T10
 *  已注册命令或自带回调（携当前活动视图句柄——T06 语义，在引用 B 中操作
 *  归 B 不误改父 A）；面板 mount/unmount 管内容根生命周期。随所属视图
 *  模式切换与组件退出完整回收（停用/故障/代次释放本页闭环）。 */
export interface AddonSdkUiFacet {
  /** 注册工具栏按钮（slot 缺省 toolbar——白名单外值拒绝） */
  registerButton(
    def: AddonUiButtonDefinition,
    onClick?: (target: AddonViewHandle | null) => void,
  ): {
    ok: boolean
    reason?: string
    /** 命名空间按钮 ID（ok 时给出） */
    id?: string
    dispose(): void
  }
  /** 注册面板（默认关闭；返回句柄含开闭控制——dispose 后全部拒绝） */
  registerPanel(def: AddonUiPanelDefinition): {
    ok: boolean
    reason?: string
    /** 命名空间面板 ID（ok 时给出） */
    id?: string
    dispose(): void
    open(): boolean
    close(): boolean
    isOpen(): boolean
  }
}

/** T10（#359）SDK 菜单面（仅编辑器页）：新增自己的右键菜单项——组件簇
 *  （addon.<组件 ID>）追加在内置三簇之后；label 自由文本、iconKey 须在
 *  平台图标 key 表。不提供覆写/隐藏/接管内置菜单项的任何入口（ADR-0012
 *  菜单边界）。 */
export interface AddonSdkMenusFacet {
  registerItem(def: AddonMenuItemDefinition): {
    ok: boolean
    reason?: string
    /** 命名空间菜单项 ID（ok 时给出） */
    id?: string
    dispose(): void
  }
}

/** 通道请求结果：普通拒绝与组件异常分开（装载器只报协议性结束态；
 *  rejected = 宿主侧未注册 topic 或业务拒绝；timeout/released 由装载器
 *  本地终结——不依赖宿主存活） */
export type AddonChannelOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: 'timeout' | 'released' | 'rejected' }

/** 注入组件工厂的页面 SDK（T02 子集：页面装配、共享运行时、资源与通信
 * 生命周期；T06（#355）起编辑器页提供 views 面——统一视图句柄、快照与
 * 文本提交；T07（#356）起编辑器页提供 behaviors 面——可组合输入行为的
 * 注册与观察；T09（#358）起提供 renderers 面——代码块渲染提供者候选
 * 登记；六组稳定能力的其余部分属后续票） */
export interface VsidianAddonPageSdk {
  /** 本次装载身份：组件 ID + 装载代次 + 页面种类 */
  readonly addon: { id: string; generation: number; page: AddonPageKind }
  /** 实验入口（仅编辑器页提供；设置页为 undefined）：cm6 = CM6 共享
   *  运行时；headingFold = 标题折叠查询与命令（#410）。使用前须在清单
   *  experimental 声明对应入口的兼容范围 */
  readonly experimental: {
    readonly cm6?: AddonCm6Runtime
    readonly headingFold?: AddonHeadingFoldFacet
  }
  /** T06（#355）统一视图面（仅编辑器页；设置页为 undefined）：主正文、
   *  嵌入内部 Live 与悬停引用的句柄列表、快照读取、文本提交（默认原子
   *  或显式 joinPrevious）与选区/定位——来源身份由 SDK 注入 */
  readonly views?: AddonViewsFacet
  /** T07（#356）输入行为面（仅编辑器页；设置页为 undefined）：注册可
   *  组合输入行为（按有效序依次修饰同次操作，后续行为读取前序结果，
   *  每次修饰按自己的原子声明提交）与只读输入观察——注册与观察分开，
   *  onChanged 不是原操作的第二写入口 */
  readonly behaviors?: AddonBehaviorsFacet
  /** T10（#359）命令面（仅编辑器页；设置页为 undefined） */
  readonly commands?: AddonSdkCommandsFacet
  /** T10（#359）菜单面（仅编辑器页；设置页为 undefined） */
  readonly menus?: AddonSdkMenusFacet
  /** T09（#358）渲染提供者面（仅编辑器页；设置页为 undefined）：登记
   *  代码块渲染候选——可序列化声明上报宿主参与确定性选择，回调留在
   *  本页执行；生效表广播回来后才承担挂载（顺序不靠装载竞速） */
  readonly renderers?: AddonRenderersFacet
  /** T11（#360）界面面（仅编辑器页；设置页为 undefined）：工具栏按钮与
   *  面板的挂载注册（平台预定义挂载点——不接管内核容器） */
  readonly ui?: AddonSdkUiFacet
  /** 编辑器页：登记 CM6 扩展（经页面装配槽挂载；返回是否被接受） */
  registerExtension(extension: Extension): boolean
  /** 设置页：取得本组件的挂载根（编辑器页返回 null；重复调用各建新根） */
  mountRoot(): HTMLElement | null
  /** 取组件安装目录内资源的本页地址（宿主装载时已按本 webview 授权；
   *  字面 `..` 等越界相对路径返回 null——#395 P3 措辞降级：本层只拦字面
   *  形态，是防呆层而非安全边界，编码变形与同 realm 直连不在防线内；
   *  有效边界是 localResourceRoots 包含性 + 宿主 realpath 守卫） */
  resourceUri(relativePath: string): string | null
  /** 页面 → 宿主 JSON 请求（载荷与结果可序列化；结束态见 AddonChannelOutcome） */
  readonly channel: {
    request(topic: string, payload: unknown, opts?: { timeoutMs?: number }): Promise<AddonChannelOutcome>
  }
  /** 登记释放回调（停用/故障/代次回收时执行；重复释放无害） */
  onDispose(callback: () => void): void
}

export type AddonPageKind = 'editor' | 'settings'

/** 组件工厂：由构建辅助工具的 defineAddonPage 登记，装载器注入 SDK 调用 */
export type AddonPageFactory = (sdk: VsidianAddonPageSdk) => void

/** IIFE 执行后的登记形态（构建桥的 defineAddonPage 写入全局登记表） */
export interface AddonPageRegistration {
  addonId: string
  factory: AddonPageFactory
  /** 登记时刻的时间戳（装载器判定迟到注册用） */
  registeredAt: number
}

/** 宿主下发的装载指令载荷（URI 均由宿主经本 webview 的 asWebviewUri 构造） */
export interface AddonLoadManifest {
  addonId: string
  generation: number
  page: AddonPageKind
  /** 入口脚本的本页地址（须在 localResourceRoots 许可面内，否则资源服务拒绝） */
  scriptUri: string
  /** 随装载注入的样式表地址（逐条独立装载，互不牵连） */
  cssUris?: string[]
  /** 资源子目录的本页基址（resourceUri 的解析锚；缺省时 resourceUri 恒 null） */
  resourceBase?: string
}

/** 装载结果（授权脚本 + 身份核对 + 工厂装配的复合结局） */
export type AddonLoadOutcome =
  | {
      ok: true
      /** 逐条样式的装载结局：authorized = 表已装载可读；denied = 拒绝/失败 */
      css: Array<{ uri: string; status: 'authorized' | 'denied' }>
    }
  | { ok: false; reason: AddonLoadFailureReason; detail?: string }

export type AddonLoadFailureReason =
  /** 同一组件已在装载中（对齐设计 §2.2 的 AlreadyRegistered 语义） */
  | 'already-loaded'
  /** 脚本装载失败：未授权路径被资源服务拒绝、404 或网络失败 */
  | 'script-load-failed'
  /** 登记身份与本次入口身份不符（加载器核对组件 ID） */
  | 'identity-mismatch'
  /** 脚本执行完成但没有登记任何工厂 */
  | 'no-factory-registered'
  /** 工厂或同步装配抛出可归因异常——已按故障释放全部注册 */
  | 'factory-error'

/** 卸载结果（代次核对是硬边界：旧代次指令不生效） */
export type AddonUnloadOutcome =
  | { ok: true }
  | { ok: false; reason: 'not-loaded' | 'stale-generation' | 'already-released' }

/** 宿主 → 页面装载指令 */
export type AddonPageDirective =
  | { type: 'addon.load'; manifest: AddonLoadManifest }
  | { type: 'addon.unload'; addonId: string; generation: number }
  | {
      type: 'addon.channel.reply'
      addonId: string
      generation: number
      requestId: string
      outcome: AddonChannelOutcome
    }
  | { type: 'addon.fault'; addonId: string; generation: number; reason?: string }

/** 页面 → 宿主出站消息 */
export type AddonPageOutbound =
  | {
      type: 'addon.loaded'
      addonId: string
      generation: number
      /** 发出消息的页面种类（宿主按面对比代次——编辑器/设置两计数器独立） */
      page: AddonPageKind
      outcome: AddonLoadOutcome
    }
  | {
      type: 'addon.unloaded'
      addonId: string
      generation: number
      outcome: AddonUnloadOutcome
      /** 释放时已执行的回调数与仍滞留的通道请求数（释放完整性证据） */
      disposals: number
      releasedRequests: number
    }
  | {
      type: 'addon.faulted'
      addonId: string
      generation: number
      page: AddonPageKind
      reason: string
    }
  | {
      type: 'addon.channel.request'
      addonId: string
      generation: number
      page: AddonPageKind
      requestId: string
      topic: string
      payload: unknown
    }

/** 装载器观测快照（宿主断言与测试的序列化面） */
export interface AddonLoaderStats {
  page: AddonPageKind
  /** cm6 共享运行时是否由本页注入（构造器身份一致的装载器侧证据） */
  cm6Shared: boolean
  /** 活跃装载（按组件 ID） */
  active: Array<{ addonId: string; generation: number }>
  /** 活跃装载持有的授权样式表数（释放撤下的观测面） */
  cssLinksActive: number
  /** 历史终结记录（释放/故障/拒绝均留痕） */
  history: Array<{
    addonId: string
    generation: number
    ended: 'released' | 'faulted' | 'load-failed'
    reason?: string
    detail?: string
    disposals?: number
  }>
  counters: {
    staleUnloadRejected: number
    lateChannelRepliesDropped: number
    lateRegistrationsDropped: number
    unsolicitedRegistrationsDropped: number
    releasedChannelRequests: number
    channelTimeouts: number
  }
}
