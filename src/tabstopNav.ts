// Tabstop 导航态（工单 #15）——上游 tabstops_state_field.ts 的 StateField +
// StateEffect + Decoration 移植（决策与派发一体、CM6 值经工厂注入）。
//
// 模块形态（对齐仓库「算法/接入分离」惯例，参照 taboutIntercept.ts 与
// plainPasteCommand.ts 的构造器注入）：上游直接 import @codemirror/* 值，
// 本仓构建桥禁止——一切 CM6 运行时值（StateField/StateEffect/Decoration/
// EditorView/theme）经 createTabstopNavigation 的 cm6 参数注入，源码只有
// import type。
//
// 导航态语义（上游对照 + 两处刻意偏差，详见 docs/specs/tabstop.md）：
// - 进入：activateTabstops(view, tabstops)——#14 引擎产出的 tabstops 分组
//   后首组选中（组内多 range 为多光标全选），StateField 记录组与索引；
// - 跳转顺序 $0 → $1 → $2 → ...（上游 CustomRules 文档语义，与 VSCode
//   snippet 的 $0 终点惯例相反——number 升序分组，$0 恒首组）；
// - 前进：Tab 跳下一组并选中；**跳至最后一组（最大编号）即收尾**——选区
//   落位的同一事务清导航态（上游 consumeAndGotoNextTabstop +
//   tidyTabstops 语义），下一次 Tab 恢复普通语义；
// - 后退：Shift-Tab 跳上一组（上游无此能力，票面要求新增）；首组上
//   Shift-Tab 无路可退，return false 透传平台 Shift-Tab；
// - 单组替换体（如仅 $0）：不进导航态，仅选区落位（上游 quirk 不移植）；
// - 编辑映射：组坐标随事务 changes 重映射（from 取 -1 / to 取 +1 联结度，
//   贴边插入不吞新文本——上游 TabstopGroup.map 同款）；
// - 自动退出：非本组件事务把选区整体移出当前组（点击别处 / 全选 / 撤销
//   替换）→ 清导航态。上游无显式退出路径（点击后 Tab 仍继续跳），本仓
//   判定为超预期接管而收窄——附加组件的 tabstop 来自单次替换插入，与
//   上游 snippet 连续会话语境不同。
//
// 高亮：Decoration.mark 高亮**当前组**非空 range（类名见
// TABSTOP_DECO_CLASS，样式经 EditorView.theme 注入——颜色复用平台公开
// CSS 变量 --vsidian-find-match-current-*，不新增平台级样式契约）。上游
// 画的是下一组（当前组靠选区承担视觉），此处按票面「当前占位符高亮」
// 收窄；零宽占位符无可见区间，不画装饰（上游的闪烁光标 widget 简省，
// 简化决策落规格）。
//
// Tab 仲裁（#7 接口提示的落地形态）：commands 供 page-editor 以
// Prec.high 抢先层 keymap 注册——先于平台 Tab 情境链（围栏越界 → 表格
// 导航 → 正文缩进）与 #7 Tabout 落穿层；导航态未激活一律 return false
// 落穿，平台与 #7 行为零改动（四层按键契约的「Prec.high 抢先层」）。
import type { ChangeDesc, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonCm6Runtime } from '../types/vendor/shared/addonPage'
import type { TabstopSpec } from './rules/rule-engine'
import type { TabstopGroup } from './tabstopGroup'
import { groupSelectionRanges, groupTabstops, rangesWithinGroup } from './tabstopGroup'

/** 当前占位符高亮类名（组件 scoped 前缀 vsidian-easy-typing-） */
export const TABSTOP_DECO_CLASS = 'vsidian-easy-typing-tabstop'

/**
 * 工厂依赖：cm6 运行时的 state/view 命名空间（AddonCm6Runtime 的子集
 * 形状——language 语法树面本模块不消费；收窄参数让单元测试无需伪造
 * language 即可装配）。
 */
export interface TabstopCm6Runtime {
  readonly state: AddonCm6Runtime['state']
  readonly view: AddonCm6Runtime['view']
}

/** 导航态 StateField 值（纯数据，无 CM6 值成员——装饰即时构建） */
export interface TabstopNavState {
  /** 占位符组（number 升序；坐标已随文档编辑重映射） */
  readonly groups: readonly TabstopGroup[]
  /** 当前组索引（选区与高亮落 groups[index]） */
  readonly index: number
}

/** 导航模块实例：extension 挂载一次，commands 与激活接口共用同一 StateField */
export interface TabstopNavigation {
  /** 挂载扩展（StateField + 高亮主题；随 keymap 一并 registerExtension） */
  readonly extension: Extension
  /**
   * 建立导航态（#25 行为链接线入口）：规则计划应用后，把引擎
   * ApplyResult.tabstops 传入。tabstops 为空 no-op；单组（含仅 $0）不进
   * 导航态、仅选区落位；多组进入导航态并选中首组。
   */
  activateTabstops(view: EditorView, tabstops: readonly TabstopSpec[]): void
  /** Tab 前进（导航态激活才接管，return true；未激活 return false 透传） */
  tabCommand(view: EditorView): boolean
  /** Shift-Tab 后退（同上；首组上无路可退，透传） */
  shiftTabCommand(view: EditorView): boolean
}

/** 组选区换算：每 range 全选（多 range 即多光标） */
function selectionOf(cm6: TabstopCm6Runtime, group: TabstopGroup) {
  const { EditorSelection } = cm6.state
  return EditorSelection.create(groupSelectionRanges(group).map((r) => EditorSelection.range(r.from, r.to)))
}

/** 组坐标随事务 changes 重映射（from -1 / to +1，上游 map 同款联结度） */
function mapGroups(groups: readonly TabstopGroup[], changes: ChangeDesc): TabstopGroup[] {
  return groups.map((g) => ({
    number: g.number,
    ranges: g.ranges.map((r) => ({
      from: changes.mapPos(r.from, -1),
      to: changes.mapPos(r.to, 1),
    })),
  }))
}

/**
 * 构造 tabstop 导航模块。同一 EditorView 的 keymap 与 activateTabstops
 * 必须来自同一实例（StateField 身份绑定）；多编辑器实例（主正文与嵌入
 * 视图）各自挂载同一 extension 即可（StateField 按 view 状态隔离）。
 */
export function createTabstopNavigation(cm6: TabstopCm6Runtime): TabstopNavigation {
  const { StateEffect, StateField } = cm6.state
  const { Decoration, EditorView: CMView } = cm6.view

  const activateEffect = StateEffect.define<{ groups: TabstopGroup[] }>()
  const moveEffect = StateEffect.define<{ index: number }>()
  const deactivateEffect = StateEffect.define<null>()

  const field = StateField.define<TabstopNavState | null>({
    create() {
      return null
    },
    update(value, tr) {
      // 先随文档编辑重映射（activate 携带的事务后坐标在 effect 段覆盖）
      let nav: TabstopNavState | null =
        value === null ? null : { index: value.index, groups: mapGroups(value.groups, tr.changes) }
      let ownTransaction = false
      for (const effect of tr.effects) {
        if (effect.is(activateEffect)) {
          nav = { groups: effect.value.groups, index: 0 }
          ownTransaction = true
        } else if (effect.is(moveEffect)) {
          if (nav !== null) nav = { groups: nav.groups, index: effect.value.index }
          ownTransaction = true
        } else if (effect.is(deactivateEffect)) {
          nav = null
          ownTransaction = true
        }
      }
      // 自动退出：非本组件事务显式改选区，且新选区已整体移出当前组
      //（点击别处 / 全选 / 撤销替换等）——继续拦截 Tab 属超预期接管。
      if (nav !== null && !ownTransaction && tr.selection !== undefined) {
        const current = nav.groups[nav.index]
        if (current === undefined || !rangesWithinGroup(tr.selection.ranges, current)) {
          nav = null
        }
      }
      return nav
    },
    provide: (f) =>
      CMView.decorations.of((view) => {
        const nav = view.state.field(f)
        if (nav === null || nav === undefined) return Decoration.none
        const group = nav.groups[nav.index]
        if (group === undefined) return Decoration.none
        const marks = group.ranges
          .filter((r) => r.from < r.to)
          .map((r) => Decoration.mark({ class: TABSTOP_DECO_CLASS, inclusive: true }).range(r.from, r.to))
        return marks.length === 0
          ? Decoration.none
          : Decoration.set(marks, true)
      }),
  })

  // 高亮样式：经 CM6 theme 注入组件 scoped 规则（& 前缀保持类名字面，
  // 不进平台样式契约）。颜色复用平台查找「当前命中」公开变量族——
  // 用户覆盖 find 高亮时占位符高亮联动（同为「当前位置」语义），回落值
  // 与平台默认一致（main.css find-match-current 段）。
  const theme = CMView.theme({
    [`& .${TABSTOP_DECO_CLASS}`]: {
      backgroundColor: 'var(--vsidian-find-match-current-background, rgba(255, 141, 55, 0.65))',
      outline: '1px solid var(--vsidian-find-match-current-outline, rgba(255, 141, 55, 0.9))',
      borderRadius: '2px',
    },
  })

  const activeNav = (view: EditorView): TabstopNavState | null => {
    const nav = view.state.field(field, false)
    return nav === undefined ? null : nav
  }

  return {
    extension: [field, theme],
    activateTabstops(view, tabstops) {
      if (tabstops.length === 0) return
      const groups = groupTabstops(tabstops)
      if (groups.length === 1) {
        // 单组：无导航可言（Tab 无处可跳），选区落位即收——「跳至最后一
        // 组即收尾」一致应用于初始态（上游单组 quirk：态滞留至下次替换，
        // 不移植）
        view.dispatch({ selection: selectionOf(cm6, groups[0]) })
        return
      }
      view.dispatch({
        effects: activateEffect.of({ groups }),
        selection: selectionOf(cm6, groups[0]),
      })
    },
    tabCommand(view) {
      const nav = activeNav(view)
      if (nav === null) return false
      const next = nav.index + 1
      if (next >= nav.groups.length) {
        // 防御：常态不可达（跳至最后一组时同步收尾）；到场即收
        view.dispatch({ effects: deactivateEffect.of(null) })
        return true
      }
      // 跳至最后一组（最大编号）即收尾：选区落位的同一事务清导航态
      // ——下一次 Tab 恢复普通语义（上游 tidyTabstops）
      const effects =
        next === nav.groups.length - 1
          ? [moveEffect.of({ index: next }), deactivateEffect.of(null)]
          : [moveEffect.of({ index: next })]
      view.dispatch({ effects, selection: selectionOf(cm6, nav.groups[next]) })
      return true
    },
    shiftTabCommand(view) {
      const nav = activeNav(view)
      if (nav === null) return false
      if (nav.index === 0) return false
      const prev = nav.index - 1
      view.dispatch({ effects: moveEffect.of({ index: prev }), selection: selectionOf(cm6, nav.groups[prev]) })
      return true
    },
  }
}
