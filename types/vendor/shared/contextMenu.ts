// vendored from ONEGAYI/vsidian@1c7c5283665f5a0b5934478d8d7e3638afab9753 — src/shared/contextMenu.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 上下文谓词（纯函数；输入只认 MenuContextSnapshot） */
export type MenuPredicate = (ctx: MenuContextSnapshot) => boolean

/** 打开菜单时采集的判定输入快照（when/enable/checked 谓词的唯一数据面）。
 *  三类场景命中负载均为可选字段：只在对应 zone 采集（table 仅 zone='table'、
 *  graphic 仅 zone='graphic'、link 仅 zone='normal'——结构敏感区不采集，
 *  与安全降级矩阵对齐）；表格树解析失败（源码降级表/残缺表）时负载缺省，
 *  不阻塞菜单打开 */
export interface MenuContextSnapshot {
  zone: ContextMenuZone
  hasSelection: boolean
  blockTarget: ContextMenuBlockTarget | null
  /** 命中行段落结构（checked 谓词输入；结构敏感区采集中性态不点亮） */
  line: MenuLineStructure
  /** 表格命中负载（#436；仅 zone='table' 且解析树接管该表时在场） */
  table?: TableMenuHit
  /** 链接命中负载（#436；仅 zone='normal' 且命中链接时在场——代码上下文
   *  与头区内行内扫描抑制同口径，嵌入 `![[…]]` 不采集） */
  link?: LinkMenuHit
  /** 图形块命中负载（#436；仅 zone='graphic'） */
  graphic?: GraphicMenuHit
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

/** 命中格的表格结构坐标（#436 场景基建：行/列系 = 内容行系，表头为
 *  第 0 行、数据行 1..；分隔行不占行索引）。层级判定与 shared/tableCells
 *  的 quoteDepthOfLine 同源；分隔行（含 lazy 无前缀形态）不参与一致性
 *  判定——与 blockquote-table 规格的残缺口径一致 */
export interface TableMenuHit {
  /** 命中格所在内容行索引（表头 = 0）；命中分隔行无内容行身份 = null */
  rowIndex: number | null
  /** 命中行是否表头行（= rowIndex 0；命中分隔行 false）——表头/表体的
   *  显式判定面（删表头行升格等语义差异由执行侧按此分流） */
  inHeader: boolean
  /** 命中列索引（0 基，行内越出格区时钳到最近列）；命中分隔行或格数与
   *  声明列数不齐的内容行（ragged 行，如两列表中的 `| 1 |`）= null */
  columnIndex: number | null
  /** 内容行总数（表头 + 数据行；分隔行不计） */
  rowCount: number
  /** 列总数（分隔行声明列数） */
  columnCount: number
  /** 表格全部物理行区间（LF 行系闭区间：表头行 .. 末数据行，含分隔行） */
  lines: { start: number; end: number }
  /** 命中处文档偏移（执行期结构定位入口输入——runTableEditAt 族以 pos
   *  自行解析结构，与悬浮控件不先移光标同口径） */
  pos: number
  /** 表内内容行（表头 + 数据行）引用层级是否全部一致 */
  quoteUniform: boolean
  /** 一致时的引用层级（顶层表 = 0）；不一致 = null（层级操作置灰输入） */
  quoteDepth: number | null
  /** 命中行引用层级（分隔行同样计算） */
  hitQuoteDepth: number
}

/** 命中链接的结构化负载（#436：target 与 activate 上报同口径——双链取
 *  `|` 之前原文未 trim、外部链接 href 原样；display 与渲染口径一致——
 *  双链别名优先） */
export interface LinkMenuHit {
  kind: MenuLinkKind
  /** 目标原文（复制链接地址与 activate 载荷共用，不解码不 trim） */
  target: string
  /** 显示文字（双链 = 别名优先 / 普通链接 = 链接文字 / autolink = URL
   *  本身 / 宽松链接 = 文字段） */
  display: string
  /** 源区间（含完整链接标记语法的半开区间，文档 offset） */
  range: { from: number; to: number }
}

/** 命中图形块（渲染型围栏）的结构化负载（#436；语言键 = info string
 *  trim 后全等，与 isRenderedFenceInfo 判定同键） */
export interface GraphicMenuHit {
  /** 围栏行区间（LF 行系闭区间，含开闭围栏行；未闭合围栏到末行） */
  lines: { start: number; end: number }
  /** 语言标识（info string trim 后，如 'mermaid'） */
  language: string
  /** 围栏源码（开闭围栏行之间的内容，不含围栏行；LF 连接） */
  code: string
  /** 当前生效渲染器（live 模式）有无 svg 取图能力——弹窗/导出类操作的
   *  enable gate 与 effectiveGraphicSvgExport 同口径 */
  svgExport: boolean
  /** #438 右键时该围栏 live 渲染是否成功（渲染容器 state 属性的 DOM 探针：
   *  错误降级态 false；探针不可得——widget 未物化/异步渲染在途——缺省，
   *  enable gate 按成功放行，执行路径重渲染自会兜底）。弹窗/导出三项的
   *  渲染成功 gate（能力 ≠ 渲染成功，#436 落档口径的执行侧补充） */
  rendered?: boolean
}

/** 链接命中族类（与 Ctrl+单击 activate 判定族同源：双链 → 树驱动链接
 *  （普通/autolink）→ 宽松链接；嵌入 `![[…]]` 明确排除） */
export type MenuLinkKind = 'wikilink' | 'link' | 'autolink' | 'loose'
