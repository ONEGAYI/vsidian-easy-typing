// vendored from ONEGAYI/vsidian@7651616e466d4950ee40880079634e3a78424162 — src/shared/addonEditApi.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { SerChange } from './protocol'

/** 视图种类：main = 面板主正文；embed = 嵌入内部 Live；hover = 悬停引用
 *  （只读预览，无写端口） */
export type AddonViewType = 'main' | 'embed' | 'hover'

/** 视图模式：live 可写（CM6 实例在场）；reading 只读（阅读形态） */
export type AddonViewMode = 'live' | 'reading'

/** views.list() 返回的有效实例句柄信息（设计 §5.1：实例/目标/模式/可编辑） */
export interface AddonViewInfo {
  /** 页面内稳定实例 ID：main 恒 'main'；embed/hover 为 occurrence 键 */
  instanceId: string
  /** 目标文档 URI（主正文 = 面板文档；embed/hover = 引用目标） */
  targetDocUri: string
  mode: AddonViewMode
  viewType: AddonViewType
  editable: boolean
}

/** 选区范围（LF 偏移；anchor/head 与 CM6 语义一致） */
export interface AddonSelectionRange {
  anchor: number
  head: number
}

/** view.editor.getSnapshot() 结果（设计 §5.1：文本、多选区、权威版本、
 *  快照修订标记） */
export interface AddonEditorSnapshot {
  /** 页面文本（UTF-16/LF；含页面未确认输入——快照描述视图现状） */
  text: string
  /** 多选区（有序；只读视图为空数组） */
  selections: AddonSelectionRange[]
  /** 权威文档版本（页面已确认到的宿主版本） */
  version: number
  /** 快照修订标记：页面文档代次计数（本地输入与外部同步都推进）。
   *  提交请求携带快照 revision，执行时点失配即拒绝 stale-snapshot——
   *  覆盖「宿主版本未变但页面有未确认输入」的窗口（设计 §5.1：修订
   *  标记不能只看尚未包含页面未确认状态的宿主版本） */
  revision: number
}

/** 撤回边界声明（ADR-0012 Q29）：缺省 atomic；joinPrevious = 不建立独立
 *  撤销项、随同同目标上次原子操作撤回（仍逐次跟踪，无可确认前项拒绝） */
export type AddonEditHistory = 'atomic' | 'joinPrevious'

/** applyEdits 请求（作者提供的业务修改；来源身份由 SDK 注入，不在此形） */
export interface AddonApplyEditsRequest {
  /** 快照修订标记（getSnapshot 返回值；失配 = 旧快照，明确拒绝） */
  revision: number
  /** 变更列表（LF 坐标，多范围 = 一笔修饰操作，Q29：不按底层变更拆分） */
  changes: SerChange[]
  /** 提交后选区（随同一事务原子应用；缺省保持实例现有选区重定位） */
  selection?: AddonSelectionRange
  /** 撤回边界声明；缺省 atomic */
  history?: AddonEditHistory
}

/** 可辨认拒绝类型（接口冻结面；新增值视为契约变更） */
export type AddonEditRejection =
  /** 句柄已释放 / 实例已销毁 */
  | 'view-disposed'
  /** 只读视图（hover 引用、reading 态主正文）不接受写入 */
  | 'read-only'
  /** 视图失活（冲突暂停写回） */
  | 'suspended'
  /** 快照修订失配（旧快照；内核输入重定位不适用于 API 提交，不自动重试） */
  | 'stale-snapshot'
  /** joinPrevious 无可确认的同目标前项（HistoryBoundaryUnavailable 语义：
   *  空日志、仅外来写入、组顶被外来写入打断、映射失配四种形态） */
  | 'history-boundary'
  /** 宿主冲突拒绝（不可安全重定位 / 暂停面板） */
  | 'conflict'
  /** 宿主写回失败 */
  | 'error'
  /** 请求形状非法（revision/changes/selection 越界或类型错误） */
  | 'invalid-request'

/** 提交凭据（宿主确认后签发；与该笔 edit.ack(ok) 同源版本） */
export interface AddonEditCredential {
  /** 本次修饰操作 ID（SDK 注入；凭据可对账来源记录） */
  opId: string
  /** 宿主确认版本 */
  version: number
}

export type AddonApplyEditsResult =
  | { ok: true; credential: AddonEditCredential }
  | { ok: false; reason: AddonEditRejection }

export type AddonSnapshotResult =
  | { ok: true; snapshot: AddonEditorSnapshot }
  | { ok: false; reason: 'view-disposed' }

/** 视图句柄的编辑面（view.editor.*）：目标从有效句柄取得；来源身份由
 *  SDK 层注入（组件请求不携带），伪来源请求结构上不可表达 */
export interface AddonViewEditorFacet {
  getSnapshot(): AddonSnapshotResult
  applyEdits(request: AddonApplyEditsRequest): Promise<AddonApplyEditsResult>
  /** 设置选区（零文本变更：不出站、不造文本撤销项）；拒绝返回 false */
  setSelection(ranges: AddonSelectionRange[]): boolean
  /** 滚动定位（零文本变更；不移动光标）；拒绝返回 false */
  reveal(offset: number): boolean
}

/** SDK views 面返回的视图句柄（info 快照 + 编辑面） */
export interface AddonViewHandle {
  readonly info: AddonViewInfo
  readonly editor: AddonViewEditorFacet
}

/** SDK views 面（views.list / views.get / 变化订阅——设计 §5.1）。
 *  仅编辑器页提供（设置页无编辑视图，views 为 undefined） */
export interface AddonViewsFacet {
  list(): readonly AddonViewInfo[]
  get(instanceId: string): AddonViewHandle | null
  onCreated(callback: (info: AddonViewInfo) => void): () => void
  onDisposed(callback: (info: AddonViewInfo) => void): () => void
}
