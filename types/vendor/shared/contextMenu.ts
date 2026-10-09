// vendored from ONEGAYI/vsidian@7651616e466d4950ee40880079634e3a78424162 — src/shared/contextMenu.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 上下文谓词（纯函数；输入只认 MenuContextSnapshot） */
export type MenuPredicate = (ctx: MenuContextSnapshot) => boolean

/** 打开菜单时采集的判定输入快照（when/enable/checked 谓词的唯一数据面） */
export interface MenuContextSnapshot {
  zone: ContextMenuZone
  hasSelection: boolean
  blockTarget: ContextMenuBlockTarget | null
  /** 命中行段落结构（checked 谓词输入；结构敏感区采集中性态不点亮） */
  line: MenuLineStructure
}

/** 右键命中区域（安全降级矩阵的行维度；null = 不接管） */
export type ContextMenuZone = 'normal' | 'table' | 'fence' | 'graphic'

/** 块链接目标（迁自 blockMenu 的 BlockMenuTarget，语义不变） */
export interface ContextMenuBlockTarget {
  /** 行索引闭区间（LF 系，与 CM6 doc 同坐标） */
  block: { start: number; end: number }
  /** 命中行为 ATX 标题行时的标题（行面字面文本，含行内标记） */
  heading: { level: number; text: string } | null
}

/** 命中行的段落结构（段落设置勾选判定的输入；#184）——行文本形态学
 *  （atxHeadingOf + parseLinePrefix）单一事实源在本模块 */
export interface MenuLineStructure {
  /** ATX 标题级别；非标题行 null */
  headingLevel: number | null
  /** 列表族（任务标记优先归 task，与无序互斥）；非列表行 null */
  listKind: 'bullet' | 'ordered' | 'task' | null
  /** 行首引用层在场（含纯引用空行与引用内列表） */
  quoted: boolean
  /** 行去空白后非空（空行不点亮任何段落勾选） */
  hasText: boolean
}
