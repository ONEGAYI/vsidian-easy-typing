// vendored from ONEGAYI/vsidian@5e388ad44292794870aae88cd4286142faa3f484 — src/shared/addonRefViews.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { HoverPreviewFailReason } from './protocol'

/** SDK refViews 面（仅编辑器页提供；设置页为 undefined）。T05（#544）
 *  浮窗请求 + T06（#545）组件容器嵌入挂载——两者共用来源解析与目标语义 */
export interface AddonSdkRefViewsFacet {
  /** 请求只读引用浮窗（单页单浮窗：新请求替换旧请求，旧请求句柄随之
   *  失效）。结果在读取结局落定时兑现：内容装载成功 → ok + 句柄；目标
   *  解析/读取/锚点失败 → 失败原因（浮窗若在场显示真实错误分态）；请求
   *  被替换或关闭 → view-disposed */
  requestPopup(request: AddonRefPopupRequest): Promise<AddonRefPopupOutcome>
  /** 在组件自有容器挂载内核只读引用子根（R-U08）。结果在首次读取结局
   *  落定时兑现：内容装载成功 → ok + 释放句柄；目标失败 → 失败原因
   *  （子根留在场显示错误分态，随容器/组件生命周期整组释放）。多处同
   *  目标各挂各的（实例/滚动/属性状态独立，读取数据共享缓存） */
  mountEmbed(request: AddonRefEmbedRequest): Promise<AddonRefEmbedOutcome>
}

/** 只读引用浮窗请求（公共载荷：来源实例 + 目标 + 触发位置；组件身份与
 *  代次由 SDK 注入——请求结构上不携带身份字段） */
export interface AddonRefPopupRequest {
  /** 来源实例（views 面 instanceId：'main' / 'embed:<hostId>' /
   *  'hover:<instanceId>'）。相对路径以该实例的目标文档解析（R-U02：
   *  B 中的请求不误用父文档 A 的目录） */
  source: string
  /** 目标（结构化路径 + 可选锚点） */
  target: AddonRefTargetSpec
  /** 触发位置：本页在树元素（文字对应元素或组件自有控件）。脱树元素
   *  非法——不猜测另一处位置，不创建无锚点空浮窗 */
  trigger: HTMLElement
  /** 显式键盘请求：焦点进入浮层可操作域，Esc 关闭后归还原焦点；缺省
   *  鼠标语义（零抢焦点、移出延迟关闭） */
  keyboard?: boolean
}

export type AddonRefPopupOutcome =
  | { ok: true; handle: AddonRefPopupHandle }
  | { ok: false; reason: AddonRefPopupRejection }

// ---- T06（#545）组件容器嵌入挂载（规格 §6 嵌入契约） ----

/** 只读引用嵌入挂载请求：公共载荷 = 来源实例 + 目标 + 本组件自有容器。
 *  组件身份与代次由 SDK 注入；容器必须是本组件已取得的面板内容根或
 *  渲染内容根（可为其后代）——正文根、其他组件容器与平台管理的引用
 *  子根内容都不是合法容器（运行时校验，归属外一律 invalid-request） */
export interface AddonRefEmbedRequest {
  /** 来源实例（views 面 instanceId：'main' / 'embed:<hostId>' /
   *  'hover:<instanceId>'；与浮窗请求同源语义——R-U02） */
  source: string
  /** 目标（结构化路径 + 可选锚点；与浮窗请求共用目标语义，不建第二套） */
  target: AddonRefTargetSpec
  /** 挂载容器：本页在树元素。平台在其中创建引用子根，不覆盖容器其他内容 */
  container: HTMLElement
}

export type AddonRefEmbedOutcome =
  | { ok: true; handle: AddonRefEmbedHandle }
  | { ok: false; reason: AddonRefEmbedRejection }

/** 只读引用目标：根内路径 + 可选锚点 */
export interface AddonRefTargetSpec {
  /** 目标路径（vault 语义：相对来源文档目录或根内 `/` 绝对形态，无扩展
   *  名按双链意图补 .md——与既有解析同源）。空串仅在带锚点时合法（页内） */
  path: string
  anchor?: AddonRefAnchor
}

/** 可辨认拒绝（规格 §7：普通结果区分；不折叠为 not-found）：
 *  - invalid-request：形状/来源/触发位置非法（不创建浮窗）；
 *  - view-disposed：来源实例不存在或已销毁、请求被替换/关闭（迟到结果
 *    与旧句柄的终结口径）；
 *  - released：组件代次已终结（装载器守卫——旧代次请求不再有有效来源）；
 *  - HoverPreviewFailReason 透传：目标解析/读取/锚点/准入超限的真实原因
 *    （not-found / escape（越出所属根）/ anchor-invalid / file-too-large …），
 *    浮窗同时以现有引用错误视图就地显示（invalid-request 除外）。 */
export type AddonRefPopupRejection =
  | 'invalid-request'
  | 'view-disposed'
  | 'released'
  | HoverPreviewFailReason

/** 本次请求的关闭句柄：身份只针对本组件本代次的这一次请求（规格 §7） */
export interface AddonRefPopupHandle {
  /** 关闭本请求的浮窗（幂等；浮窗已换主或已关时返回 false——旧句柄不
   *  误关后来另一组件的浮窗） */
  close(): boolean
  /** 本请求的浮窗是否仍在场（被替换/Esc/移出/域失效关闭后为 false） */
  isActive(): boolean
}

/** 嵌入挂载可辨认拒绝（规格 §7；与浮窗请求同族，另含容器占位冲突）：
 *  - invalid-request：形状非法 / 容器脱树或非本组件所有 / 容器在平台
 *    管理的引用子根内（不创建子根）；
 *  - view-disposed：来源实例不在场、页面会话缺失，或挂载在结局落定前
 *    被释放（迟到结果的终结口径）；
 *  - duplicate-mount：该容器已被一次有效挂载占用（含错误分态挂载——
 *    重复挂载同一位置须先释放旧实例）；
 *  - released：组件代次已终结（装载器守卫）；
 *  - HoverPreviewFailReason 透传：目标解析/读取/锚点/准入超限的真实原因
 *    （子根留在场以现有引用错误视图就地显示，随组释放）。 */
export type AddonRefEmbedRejection =
  | 'invalid-request'
  | 'view-disposed'
  | 'duplicate-mount'
  | 'released'
  | HoverPreviewFailReason

/** 本次挂载的释放句柄：身份只针对本组件本代次的这一次挂载 */
export interface AddonRefEmbedHandle {
  /** 释放本次挂载（幂等；整组释放路径——句柄释放、容器/父根脱树、
   *  组件停用、页面结束——效果等价）。错误分态挂载不发放句柄 */
  release(): boolean
  /** 本次挂载是否仍在场（已释放/子根脱树后为 false） */
  isActive(): boolean
}

/** 结构化锚点（互斥四形态；缺省 = 无锚点全文/全文窗口） */
export type AddonRefAnchor =
  /** Markdown 标题章节（标题原文；空 path 时为来源文档页内锚点） */
  | { kind: 'heading'; heading: string }
  /** Markdown 块 ID（`^id` 的 id 段；字符集同双链形态学） */
  | { kind: 'block'; blockId: string }
  /** 1-based 行号（非 Markdown 文本目标：#line= 语义；Markdown 目标按
   *  标题语义解析「line=N」原文——沿用既有双链行为，不新增片段语法） */
  | { kind: 'line'; line: number }
  /** 1-based 闭区间行范围（非 Markdown 文本目标：#range= 语义；同上，
   *  Markdown 目标不改变既有语义） */
  | { kind: 'range'; startLine: number; endLine: number }
