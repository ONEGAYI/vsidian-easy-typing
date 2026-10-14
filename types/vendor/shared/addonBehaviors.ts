// vendored from ONEGAYI/vsidian@1c7c5283665f5a0b5934478d8d7e3638afab9753 — src/shared/addonBehaviors.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { SerChange } from './protocol'
import type { AddonEditorSnapshot, AddonSelectionRange } from './addonEditApi'

/** 输入行为的操作上下文（技术方案 §5.2：当前快照 + 操作上下文） */
export interface AddonInputContext {
  /** 触发本次链的用户输入 userEvent（CM6 语义，如 'input.type'、
   *  'delete.backward'、'input.type.compose'——IME 定稿） */
  readonly userEvent: string
  /** 本次输入插入的净文本（多选区拼接；不含删除侧；delete 事务为空串） */
  readonly inputText: string
  /** 本次输入替换/删除掉的文本（事务前 LF 坐标）：input.type 替换选区时
   *  为被替换的选区内容（#401——SelectKey 包裹/替换类规则的判定依据：
   *  按键插入发生在选区销毁之后，行为从本字段读回包裹目标）；delete.*
   *  事务时为被删文本（#400——联动删除配对端需要知道删了什么）。多区间
   *  时为全部删除区间的最小包围与按序拼接文本。IME 定稿补驱动恒 null
   *  （组合事务先于 compositionend，替换侧无法归因——#399 边界）；
   *  纯插入无删除侧为 null */
  readonly replaced: AddonReplacedRange | null
  /** 行为读取时点的当前快照——已含本次输入与**前序行为的修饰结果**
   *  （后续行为读取前序结果）；输入点从快照选区读取 */
  readonly snapshot: AddonEditorSnapshot
  /** 本次驱动所属视图的目标文档 URI（#407，与该实例 views 句柄的
   *  targetDocUri 同源：main = 面板文档，embed = 引用目标文档——在
   *  引用 B 内触发时是 B 的 URI，不是宿主文档 A；文件排除类规则据此
   *  判定「我正在哪个文件里被触发」） */
  readonly docUri: string
}

/** 事务替换/删除侧的区间与文本（事务前 LF 坐标） */
export interface AddonReplacedRange {
  /** 全部删除区间的最小包围起点 */
  readonly from: number
  /** 全部删除区间的最小包围终点 */
  readonly to: number
  /** 被替换/删除的文本（按区间顺序拼接） */
  readonly text: string
}

/** 文本修饰计划（行为返回；提交与身份注入由平台完成——行为不能直接
 *  写文档，防绕过链） */
export interface AddonBehaviorInputPlan {
  /** LF 坐标变更列表（相对 context.snapshot） */
  readonly changes: SerChange[]
  /** 提交后选区（可选；缺省保持实例现有选区重定位） */
  readonly selection?: AddonSelectionRange
}

/** behaviors.register 的注册载荷（作者提供） */
export interface AddonBehaviorRegistration {
  /** 稳定局部 ID（组件内唯一；持久身份的一半） */
  readonly id: string
  /** 必填的用户可读名称（ADR Q27：注册行为时名称必填）。单语言字符串
   *  （历史兼容，不随语言切换）或多语言映射（按页面语言选值——消费端
   *  渲染时经 resolveAddonBehaviorName 求值，注册/上报/目录全链路透传，
   *  #464） */
  readonly name: AddonBehaviorName
  /** 可选简短说明（推荐提供，不作接入强制条件） */
  readonly description?: string
  /** 可选例子（推荐提供；至多 8 项） */
  readonly examples?: readonly string[]
  /** 可选独占组：同组件内同组行为互斥（按有效序首个适用者生效）；
   *  跨组件不互斥 */
  readonly exclusiveGroup?: string
  /** 撤回边界声明（Q29）：缺省 atomic；joinPrevious = 随同上次原子操作
   *  撤回（每次修饰按自己的原子声明提交） */
  readonly history?: 'atomic' | 'joinPrevious'
  /** 业务回调：返回不处理（null）或文本修饰计划；适用条件由代码表达 */
  readonly onInput: (context: AddonInputContext) => AddonBehaviorInputPlan | null
}

/** 行为显示名：单语言字符串（历史兼容，不随语言切换）或「语言键 → 名称」
 *  映射（按页面语言选值——键规整 trim+小写，候选链见
 *  resolveAddonBehaviorName；映射全链路透传不预解析，#464） */
export type AddonBehaviorName = string | { readonly [locale: string]: string }

/** 注册结果的观测面（不含回调；诊断与 T08 管理查询的序列化形态） */
export interface AddonBehaviorInfo {
  addonId: string
  id: string
  /** 与注册面同形态（string 或多语言映射）——渲染时由消费端选值 */
  name: AddonBehaviorName
  description?: string
  examples?: readonly string[]
  exclusiveGroup?: string
  history: 'atomic' | 'joinPrevious'
}

/** onChanged 观察事件（通知分离面：只读观察，无修饰权——技术方案 §5.2
 *  「通知监听与输入修饰回调分别注册」） */
export interface AddonBehaviorChangeEvent {
  readonly userEvent: string
  readonly inputText: string
  /** 替换/删除侧（与 AddonInputContext.replaced 同义：#400/#401） */
  readonly replaced: AddonReplacedRange | null
  readonly snapshot: AddonEditorSnapshot
  /** 本次驱动所属视图的目标文档 URI（#407，与 AddonInputContext.docUri 同源） */
  readonly docUri: string
}

/** 注册结果（SDK behaviors.register 的返回） */
export type AddonBehaviorRegisterResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'invalid-registration' | 'duplicate-id' | 'not-editor-page' | 'released' }

/** SDK behaviors 面（仅编辑器页提供；设置页为 undefined）。register 与
 *  onChanged 分开注册——onChanged 不是原输入链的第二写入口 */
export interface AddonBehaviorsFacet {
  /** 登记输入行为（稳定局部 ID + 必填名称 + 可选说明/例子/独占组/撤回
   *  声明 + 业务回调）；名称缺失拒绝，说明/例子缺失允许 */
  register(registration: AddonBehaviorRegistration): AddonBehaviorRegisterResult
  /** 观察用户输入（只读事件；不进入修饰链） */
  onChanged(callback: (event: AddonBehaviorChangeEvent) => void): () => void
}

/** 链执行轨迹条目（观测/断言面） */
export interface AddonBehaviorTraceEntry {
  behaviorKey: string
  opId: string
  outcome: 'ok' | string
}

/** runtime 观测快照（view.state 探针与测试断言面） */
export interface AddonBehaviorRuntimeStats {
  registrations: AddonBehaviorInfo[]
  hostState: { order: readonly string[]; disabled: readonly string[] } | null
  counters: {
    drives: number
    drivesSkippedWhileRunning: number
    callbackErrors: number
    observerErrors: number
    invalidPlans: number
    submitsRejected: number
  }
  trace: AddonBehaviorTraceEntry[]
}

// ---- 状态存储（宿主持久层 ↔ webview 下发的同构形态） ----

/** 行为顺序与逐项开关的持久存储（version 1 冻结）。
 * 存储设计决策（票面要求写明）：
 * - 键 = 行为完整键（组件 ID + 局部 ID），不以显示名为键——改名/本地化
 *   不丢配置；未知项（已卸载）保留存储、不剔除（技术方案 §7：展示状态
 *   而不重新打开用户已关闭的项）。
 * - 单层 user（globalState）持久，不做工作区层——行为开关与顺序是用户
 *   偏好（ADR 未要求两层）；同文档跨窗口行为一致。T08 需要工作区层时
 *   再按 T04 两层模式扩展（version 迁移）。 */
export interface AddonBehaviorStateStore {
  readonly version: 1
  /** 用户排序覆盖（完整键；未列出项按默认序追加） */
  readonly order: readonly string[]
  /** 用户关闭的行为（完整键；不在场 = 开启） */
  readonly disabled: readonly string[]
}

// ---- #476 行为禁用态只读可见面（独立于 behaviors 面；编辑器页与设置页均提供） ----

/** 组件运行态（快照第一层——D3 口径）。faulted 不进快照：故障时设置页
 *  不装载、编辑器页整组件回收，该态对组件页语义不可达。 */
export type AddonBehaviorRunState = 'enabled' | 'user-disabled'

/** #476 行为禁用态快照（SDK behaviorState.enabledState 的返回；两层报
 * 事实——组件运行态 + 本组件被禁行为的局部 id 集，不报完整键：组件
 * 自知 addonId，接口按「本组件」过滤天然隔离）。**只读**：本面不提供
 * 任何写入宿主状态的成员（ADR-0016 两层开关语义的平台侧答案）。 */
export interface AddonBehaviorEnabledState {
  /** 本组件当前运行态：enabled = 激活中；user-disabled = 被用户停用
   *  （停用后设置页不卸载——仍可查询，灰态消费场景 #50） */
  readonly addonRunState: AddonBehaviorRunState
  /** 本组件被用户禁用的行为局部 id 集（存储完整键按 addonId 前缀过滤
   *  后剥离；顺序保持存储序，不在场 = 空） */
  readonly disabled: readonly string[]
}

/** #476 SDK behaviorState 面（编辑器页与设置页均提供；查询 + 订阅双件
 *  ——D2：打开页面取初值用 enabledState，灰态实时同步用 onEnabledChange）。
 *  生命周期口径：**查询**不做代次守卫——已释放代次的迟到调用返回最后
 *  已知快照（只读无副作用）；**订阅**过装载器的记录身份判活（与全部
 *  SDK 面同款）——已释放代次的迟到登记为 no-op 退订，释放时点已有的
 *  订阅随组件释放整组回收（releaseLoad 驱动，不依赖组件自觉退订——
 *  与 behaviors/commands/renderers/ui 四面的整组件回收同款）。 */
export interface AddonBehaviorStateFacet {
  /** 立即返回当前快照（同步——广播未到达时为默认态 enabled + 空集） */
  enabledState(): AddonBehaviorEnabledState
  /** 订阅本组件快照变化（宿主状态落库后即时通知——D5；回调异常只吞不
   *  升级；组件释放后订阅就地回收、迟到登记为 no-op 退订）；返回退订
   *  函数 */
  onEnabledChange(callback: (state: AddonBehaviorEnabledState) => void): () => void
}

/** #476 宿主 → webview 的禁用态广播载荷（宿主在面板 ready 对账、组件
 *  启停与行为开关落库后推送；编辑器面板与设置面板同拍同形）。
 *  disabled 与存储 version 1 的 disabled 同源（完整键集合）；addons 只列
 *  enabled / user-disabled 两态组件（faulted / idle 不列——不可达态，
 *  webview 端缺省回落 enabled）。 */
export interface AddonBehaviorEnabledStateBroadcast {
  readonly disabled: readonly string[]
  readonly addons: ReadonlyArray<{ readonly addonId: string; readonly addonRunState: AddonBehaviorRunState }>
}
