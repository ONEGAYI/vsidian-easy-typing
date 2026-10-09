// vendored from ONEGAYI/vsidian@7651616e466d4950ee40880079634e3a78424162 — src/shared/addonCommands.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import type { MenuPredicate } from './contextMenu'
import type { BindingMode } from './keybindings'

/** 局部 ID 拒绝码 */
export type AddonLocalIdProblem = 'empty' | 'dot' | 'too-long' | 'invalid-chars'

/** 默认绑定拒绝码（tab-forbidden = #125 Tab 固定链） */
export type AddonDefaultBindingsProblem = 'not-string' | 'invalid-chord' | 'tab-forbidden'

/** 菜单项形状拒绝码 */
export type AddonMenuItemProblem =
  | AddonLocalIdProblem
  | 'label-empty'
  | 'label-too-long'
  | 'icon-key'
  | 'command-local-id'

/** 组件命令注册形状（sdk.commands.register 的入参；页面 SDK 专用——
 *  回调不进协议，宿主/设置页只消费 AddonCommandReport） */
export interface AddonCommandDefinition {
  /** 组件内局部 ID（无点号；命名空间前缀由平台注入） */
  id: string
  /** 用户可见标题（自由文本——组件文案不进 Vsidian 内置字典，ADR 5.5；
   *  封顶 ADDON_DISPLAY_TEXT_MAX，超限注册拒绝——#395 P3） */
  title: string
  /** 生效模式（由代码声明） */
  mode: BindingMode
  /** 是否写操作（缺省 false：写操作快捷键仅在 Live 正文接管宿主绑定，
   *  源码模式与设置页输入不接管——沿键位注册表 writes 门控） */
  writes?: boolean
  /** 可选默认绑定（默认未绑定允许；Tab 拒绝——见模块头） */
  defaultBindings?: readonly string[]
}

/** 组件菜单项注册形状（sdk.menus.registerItem 的入参） */
export interface AddonMenuItemDefinition {
  /** 组件内局部 ID（无点号） */
  id: string
  /** 菜单项文字（自由文本） */
  label: string
  /** 图标 key（须已在 CONTEXT_MENU_ICON_KEYS 登记——组件不能注入新图标
   *  资产；未登记 key 注册拒绝，与内置项「两表同步」约束同口径） */
  iconKey?: string
  /** 簇内排序键（缺省 0，稳定排序） */
  order?: number
  /** 挂接的命令局部 ID（缺省 = id；命名空间化后作菜单执行键） */
  command?: string
  /** 上下文显隐谓词（缺省可见；输入为打开菜单时采集的结构化快照） */
  when?: MenuPredicate
  /** 置灰谓词（缺省可用；结构敏感区置灰的安全降级矩阵由组件自行声明） */
  enable?: MenuPredicate
}

/** 命令注册结果（SDK 注册面返回；拒绝原因可辨认——普通 API 拒绝不算故障） */
export type AddonCommandRegisterResult =
  | { ok: true; commandId: string }
  | { ok: false; reason: string }

/** 协议上报的命令形态（webview → 宿主全量对账；序列化安全——无函数） */
export interface AddonCommandReport {
  /** 命名空间完整 ID（键位路由、菜单提示与宿主命令注册共用） */
  commandId: string
  addonId: string
  localId: string
  title: string
  mode: BindingMode
  writes: boolean
  /** 归一化后的默认绑定（注册期已拒 Tab 与非法 chord；空数组 = 默认未绑定） */
  defaults: readonly string[]
}
