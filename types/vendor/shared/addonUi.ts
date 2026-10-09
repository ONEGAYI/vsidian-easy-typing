// vendored from ONEGAYI/vsidian@7651616e466d4950ee40880079634e3a78424162 — src/shared/addonUi.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { AddonLocalIdProblem } from './addonCommands'
import type { BindingMode } from './keybindings'
import type { AddonViewHandle } from './addonEditApi'

export type AddonUiButtonSlot = (typeof ADDON_UI_BUTTON_SLOTS)[number]

/** 目标句柄获取器（按钮回调与面板 mount 收到）：每次调用动态解析**当前
 *  活动视图**（焦点所在的嵌入内部 Live 或主正文——T06 句柄语义：在引用
 *  B 中操作归 B 不误改父 A）；视图不在场（面板销毁/阅读态只读时）null */
export type AddonUiTargetGetter = () => AddonViewHandle | null

/** 组件按钮注册形状（sdk.ui.registerButton 的入参） */
export interface AddonUiButtonDefinition {
  /** 组件内局部 ID（无点号；命名空间前缀由平台注入） */
  id: string
  /** 用户可见标题（自由文本——aria/提示承载；组件文案不进 Vsidian 内置字典；
   *  封顶 ADDON_DISPLAY_TEXT_MAX，超限注册拒绝——#395 P3） */
  label: string
  /** 挂载槽位（缺省 toolbar；白名单见 ADDON_UI_BUTTON_SLOTS） */
  slot?: AddonUiButtonSlot
  /** 生效模式（缺省 both；不匹配模式的按钮从挂载点撤下） */
  mode?: BindingMode
  /** 槽内排序键（缺省 0，稳定排序） */
  order?: number
  /** 挂接的命令局部 ID（点击经命令体系执行——须为本组件已注册命令） */
  command?: string
  /** 按钮显示文本（缺省 label；单字符/emoji/短词皆可；封顶同 label） */
  iconText?: string
}

/** 组件面板注册形状（sdk.ui.registerPanel 的入参；面板宿主容器是平台
 *  dock——定义形状上无挂载位置字段，界面接管在结构上不可表达） */
export interface AddonUiPanelDefinition {
  /** 组件内局部 ID（无点号） */
  id: string
  /** 面板标题（自由文本——平台面板标题栏展示；封顶 ADDON_DISPLAY_TEXT_MAX，
   *  超限注册拒绝——#395 P3） */
  title: string
  /** 生效模式（缺省 both；不匹配模式的面板强制关闭并回收挂载） */
  mode?: BindingMode
  /** 面板打开时调用（平台提供内容根元素；迟到结果落进已关闭面板的 root
   *  不可见——root 已脱挂） */
  mount(root: unknown, target: AddonUiTargetGetter): void
  /** 面板关闭时调用（可选；重复释放无害） */
  unmount?(root: unknown): void
}

/** 按钮形状拒绝码 */
export type AddonUiButtonProblem =
  | AddonLocalIdProblem
  | 'label-empty'
  | 'label-too-long'
  | 'slot-unknown'
  | 'mode-invalid'
  | 'order-invalid'
  | 'command-local-id'
  | 'action-conflict'
  | 'action-missing'
  | 'icon-text-empty'
  | 'icon-text-too-long'

/** 面板形状拒绝码 */
export type AddonUiPanelProblem =
  | AddonLocalIdProblem
  | 'title-empty'
  | 'title-too-long'
  | 'mode-invalid'
  | 'mount-not-function'
  | 'unmount-not-function'

/** 按钮槽位白名单：当前唯一合法挂载点（其余值注册拒绝——内置界面/侧栏/
 *  设置框架等不可挂；未来新槽位在此登记并同步 styleContract 条目） */
export const ADDON_UI_BUTTON_SLOTS = ['toolbar'] as const
