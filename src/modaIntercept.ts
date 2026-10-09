// EnhanceModA 接入层（工单 #11）：Mod+A 抢先层 keymap Command、设置门与
// 「选择当前块」命令的注册契约/handler。决策核心在 src/modaSelection.ts
// （plan* 纯函数），本层只做门控、派发与平台 API 形状。
//
// 层归属（票面评论定案）：**抢先层 Prec.high**——可替代平台键位；未命中
// 或功能关闭一律 return false 落穿平台链（平台原生 Mod+A 全选照常执行，
// 透传即接管边界，见 docs/specs/enhance-moda.md「接管边界」）。实验层
// keymap 不进平台统一快捷键管理（平台约定：用户关闭 = 停用组件；组件内
// 功能粒度开关由设置门承担——registerExtension 无撤销句柄，采用「恒注册
// + 门控透传」的等价形态，运行时开关即时生效）。
//
// 「选择当前块」走平台稳定 commands API（统一快捷键管理 + 命令面板）：
// 上游无默认热键，默认未绑定（平台允许）；快捷键评估记录见规格文档。
import type { EditorView } from '@codemirror/view'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import type { AddonCommandDefinition } from '../types/vendor/shared/addonCommands'
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
import { planModASelection, planSelectBlock } from './modaSelection'
import { SETTINGS_TOPIC } from './settings/store'
import type { Messages } from './i18n'

/** 快照决策路径所需的最小 cm6 状态面（结构子集——测试可注入假体） */
export type Cm6StateSubset = {
  readonly EditorState: (typeof import('@codemirror/state'))['EditorState']
}

/**
 * Mod+A keymap Command 工厂：门控关闭或状态机失配 → return false 透传
 * （平台原生全选）；命中 → 派发纯选区事务（零写回零 dirty，对齐 #7
 * taboutCommand 的事务口径）并接管。
 */
export function createModACommand(options: { isEnabled: () => boolean }): (view: EditorView) => boolean {
  const { isEnabled } = options
  return (view: EditorView): boolean => {
    if (!isEnabled()) return false
    const plan = planModASelection(view.state)
    if (plan === null) return false
    view.dispatch({ selection: { anchor: plan.anchor, head: plan.head } })
    return true
  }
}

/**
 * enhanceModA 设置门（页面侧生效值缓存）：消费 #3 设置通道
 * （SETTINGS_TOPIC.get，宿主侧由 extension.ts 的 attachSettings 门面合成
 * effective）。通道失败（timeout/rejected）保持上次值——瞬时故障不翻转
 * 拦截行为；有效载荷仅认 boolean true。
 */
export interface ModASettingsGate {
  /** 当前生效值（通道首次返回前为 false——默认关，透传安全方向） */
  readonly enabled: () => boolean
  /** 拉新生效值（装载时与焦点回归/透传按键时调用） */
  readonly refresh: () => Promise<void>
}

export function createEnhanceModAGate(channel: VsidianAddonPageSdk['channel']): ModASettingsGate {
  let current = false
  return {
    enabled: () => current,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      current = (effective as { enhanceModA?: unknown } | null)?.enhanceModA === true
    },
  }
}

/** 「选择当前块」命令局部 ID（公开 ID 由平台注入 `<addonId>.select-block`） */
export const SELECT_BLOCK_COMMAND_ID = 'select-block'

/**
 * 「选择当前块」命令定义（上游 main.ts easy-typing-select-block：无默认
 * 热键、无设置门控——恒注册）。mode=live：选区操作仅在 Live 正文有意义；
 * writes=false：纯选区事务不写文本，快捷键不在源码模式/设置页接管宿主绑定。
 */
export function buildSelectBlockCommandDefinition(messages: Pick<Messages, 'commandSelectBlock'>): AddonCommandDefinition {
  return {
    id: SELECT_BLOCK_COMMAND_ID,
    title: messages.commandSelectBlock,
    mode: 'live',
    writes: false,
    defaultBindings: [],
  }
}

/** select-block 命令 handler 依赖（page-editor 注入，测试可替换） */
export interface SelectBlockCommandDeps {
  /** 实验 cm6 运行时状态面（快照决策构造临时 EditorState 用——值只经实验入口） */
  readonly cm6: { readonly state: Cm6StateSubset }
}

/**
 * 「选择当前块」命令 handler（上游 selectBlockInCursor 决策）：目标
 * 视图句柄（平台命令回调携带，PR #432）快照决策 + setSelection（零文本
 * 变更事务）。空白行无操作（上游语义）；无活动视图（target null）或
 * 快照失败（view-disposed）无动作不抛错。
 */
export function createSelectBlockCommandHandler(
  deps: SelectBlockCommandDeps,
): (target: AddonViewHandle | null) => void {
  return (target) => {
    if (target === null) return
    const snap = target.editor.getSnapshot()
    if (!snap.ok) return
    const primary = snap.snapshot.selections[0]
    if (primary === undefined) return
    const state = deps.cm6.state.EditorState.create({
      doc: snap.snapshot.text,
      selection: { anchor: primary.anchor, head: primary.head },
    })
    const plan = planSelectBlock(state)
    if (plan !== null) {
      target.editor.setSelection([{ anchor: plan.anchor, head: plan.head }])
    }
  }
}
