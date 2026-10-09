// Tabstop 分组纯逻辑（工单 #15）——上游 tabstop.ts 的
// tabstopSpecsToTabstopGroups / containsSelection 移植，剥离 CM6 依赖：
// 上游 TabstopGroup 持 DecorationSet 与 SelectionRange（CM6 值），本模块
// 只保留纯数据形状（分组与区间换算），装饰与选区的构建归
// tabstopNav.ts（经 cm6 运行时注入）。输入 TabstopSpec 来自 #14 引擎的
// ApplyResult.tabstops（文档绝对坐标、number 升序），本模块零平台依赖。
import type { TabstopSpec } from './rules/rule-engine'

/** 文档区间（from ≤ to；from === to 为折叠位） */
export interface TabstopRange {
  readonly from: number
  readonly to: number
}

/**
 * 分组后的占位符组：同号占位符并为组——组内多个 range 构成多光标
 * 同步编辑单元（上游 TabstopGroup 的 selections 面所载语义）。
 */
export interface TabstopGroup {
  readonly number: number
  readonly ranges: readonly TabstopRange[]
}

/**
 * 按占位符编号分组（组间 number 升序——**$0 恒最前**，上游
 * CustomRules 文档「光标跳转顺序为 $0 → $1 → $2 → ...」的语义承载；
 * 引擎输出已升序，但 #25 接线允许直接传入未排序形态，此处不依赖输入
 * 有序）。
 */
export function groupTabstops(tabstops: readonly TabstopSpec[]): TabstopGroup[] {
  const byNumber = new Map<number, TabstopRange[]>()
  for (const spec of tabstops) {
    const ranges = byNumber.get(spec.number)
    if (ranges === undefined) {
      byNumber.set(spec.number, [{ from: spec.from, to: spec.to }])
    } else {
      ranges.push({ from: spec.from, to: spec.to })
    }
  }
  return [...byNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, ranges]) => ({ number, ranges }))
}

/**
 * 组 → 选区锚点对：组内每个 range 全选（占位符默认值被选中，键入即
 * 整体覆盖）；折叠 range（from === to）即光标落位。返回顺序即多光标
 * 选区 range 序。
 */
export function groupSelectionRanges(group: TabstopGroup): TabstopRange[] {
  return group.ranges.map((r) => ({ from: r.from, to: r.to }))
}

/**
 * 判定一组选区是否**整体**落在占位符组内：每个选区 range 都被组内某个
 * range 包含（上游 TabstopGroup.containsSelection 同构——all ranges lie
 * within）。用于「用户把光标移出了当前占位符 → 导航态自动退出」的判定。
 */
export function rangesWithinGroup(
  ranges: readonly { from: number; to: number }[],
  group: TabstopGroup,
): boolean {
  return ranges.every((r) =>
    group.ranges.some((g) => g.from <= r.from && g.to >= r.to),
  )
}
