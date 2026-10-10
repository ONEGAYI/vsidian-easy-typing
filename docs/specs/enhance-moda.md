# EnhanceModA 渐进选择与「选择当前块」（工单 #11）

> 上游 easy-typing-obsidian 的 EnhanceModA（默认关）移植：连续 Mod+A
> 渐进选择（行 → 段块；引用行内容 → 引用块；列表内容 → 子列表 → 整列表
> → 全文），另有恒注册的「选择当前块」命令（上游无默认热键）。
> 领域词汇见 [CONTEXT.md](../../CONTEXT.md)。

## 验收口径

- **渐进层级序列端到端以矩阵承载**：`test/modaSelection.test.ts`（31 例，
  真实 `EditorState` 的连续按键模拟——plan 结果回写为新选区再 plan，直至
  透传）+ `test/blockScan.test.ts`（28 例，降级扫描/引用块/段块）+
  `test/modaIntercept.test.ts`（15 例，门控命令/设置门/命令注册契约/
  handler 路由）；浏览器真实键盘端到端归 #21 人工验证。
- `npm run compile` 通过；全部测试绿。
- **接管边界清晰**（票面验收项）：见「接管边界」节。

## 上游对照

| 内容 | 上游锚点（v6.0.9 克隆） | 本仓落点 |
| --- | --- | --- |
| Mod+A 三分支状态机 | `src/keyboard_handlers.ts:509-676`（handleModA） | `src/modaSelection.ts`（planModASelection） |
| 段块邻行扩展 | `src/keyboard_handlers.ts:783-809`（getBlockLinesInPos） | `src/blockScan.ts`（paragraphBlockAt） |
| 引用块信息 | `src/syntax.ts:155-201`（getQuoteInfoInPos——上游本就纯正则） | `src/blockScan.ts`（quoteInfoAt，逐字移植） |
| 行类型判定 | `src/core.ts:748-788`（getPosLineType2，树版） | `src/blockScan.ts`（scanLines，正则降级） |
| 选择当前块 | `src/keyboard_handlers.ts:815-825`（selectBlockInCursor） | `src/modaSelection.ts`（planSelectBlock） |
| Mod-a keymap 挂接 | `src/main.ts:93-95` | `src/page-editor.ts`（Prec.high 抢先层） |
| select-block 命令注册 | `src/main.ts:123-129`（addCommand，无 hotkeys） | `src/modaIntercept.ts`（buildSelectBlockCommandDefinition + handler） |

## 语义要点（与上游逐一对齐）

- **无外部状态的渐进设计**：状态机不持有跨按键状态——每次按键从「当前
  选区 vs 层级档位区间」的包含/等值关系推断所在层级并推进一档。连续性
  断开（光标移动/编辑后选区不再匹配任何档位）自然回落首档，无显式重置。
- **层级序列**（「→（透传）」= 第三/四次按键 return false 落穿，由平台
  原生 Mod+A 全选补完「全文」语义）：
  - 文本行：行 → 段块 →（透传）；
  - 引用行：引用行内容 → 引用块 →（透传）；callout 标题行的内容起点
    跳过 `[!note]` 类标记；
  - 列表标记行：内容 → 当前行及子列表 → 整列表 → 全文 →（透传）；
    整列表与子列表同区间时该档去重；
  - 列表续行（缩进 ≥2、无标记）：内容 → 起点项标记后内容——此后选区
    anchor 落回标记行，继续按标记行分支升档。
- **判定口径**：文本/列表分支用**包含判定**（anchor ≤ 档.anchor 且
  head ≥ 档.head，超集视同已到该档）；引用分支用**精确等值判定**
  （上游原样）——跨行/超集选区回落首按。exact-line 判定要求正向选区
  （anchor 在行首、head 在行尾），反向选区重新正向选行。
- **「当前行」取 anchor、「段块/引用块」取 head**（上游口径）。
- **多选区按主选区处理**（上游 selection.main），派发后收敛为单选区。
- **上游 quirks 保留**（有测试钉住）：空行夹在两段之间时光标恰等空行，
  首按即选两侧合并段块（段块 walk 不排除空当前行）；标题行首按选标题
  行、次按并入两侧文本段；表格行与水平线按上游 v2 归 text（段块不为其
  设边界）。
- 命中派发**纯选区事务**（零写回零 dirty、不带 userEvent——对齐 #7
  taboutCommand 的事务口径）。

## 平台映射

- **层归属（票面评论定案）**：Mod+A 拦截走**实验 cm6 抢先层
  `Prec.high`**（`experimental.cm6: "^1.1.0"` 清单已声明）——四层优先级
  契约中位于平台保留键闸（undo/redo，Prec.highest）之后、平台普通情境
  链之前；可替代平台键位。实验层 keymap **不进平台统一快捷键管理**
  （平台约定：用户关闭 = 停用本组件；组件内功能粒度开关由本插件设置
  承担）。
- **设置门**：消费 #3 设置通道 `easyTyping.settings.get`（宿主侧
  `attachSettings` 门面合成 `effective`），键名 `enhanceModA`（默认关）。
  `sdk.registerExtension` 无撤销句柄，采用「**恒注册 + 门控透传**」形态
  ——关闭时 keymap 在场但恒 return false，行为与不注册等价，运行时开关
  即时生效。刷新时机：装载即拉取（初始 false = 透传安全方向）、焦点回归
  （updateListener `focusChanged`）、透传按键后 fire-and-forget 兜底；
  通道失败（timeout/rejected）保持上次值不翻转。跨窗口设置变更不实时
  推送是平台既有边界（重开对账）。
- **「选择当前块」命令**：走平台**稳定 commands API**
  （`sdk.commands.register`）——进统一快捷键管理（冲突检查/绑定/清空/
  恢复默认）与命令面板；恒注册（上游无设置门控）。定义：局部 ID
  `select-block`（公开 ID 由平台注入命名空间）、mode `live`、writes
  `false`（纯选区事务——快捷键不在源码模式/设置页接管宿主绑定）、
  **默认未绑定**（上游无默认热键；平台允许空 defaultBindings）。
- **命令目标视图路由**：目标视图句柄由平台命令回调携带（vsidian
  PR #432——平台解析焦点嵌入 Live → 该实例、否则主正文）——句柄快照
  决策 + `setSelection`（零文本变更事务）；无活动视图（target null）
  无动作。已知边界：只读目标（hover Live / 挂起实例——快照契约「只读
  视图选区为空数组」）读不到主选区即无动作；旧焦点路径对只读 CM6 实例
  可设选区，句柄口径下收窄为不动作（writes:false 选块在只读预览内价值
  弱，方向保守）。

## 接管边界（票面验收项）

1. **功能关（默认）**：完全透传——keymap 恒 return false，平台原生
   Mod+A 全选逐字节照旧。
2. **功能开、状态机命中**：接管一次按键，派发渐进档位选区。
3. **功能开、失配透传**：分支不命中（代码围栏/公式块/frontmatter 内、
   列表续行上的缩进围栏行）或已到层级末档（含空文档、选区超集）——
   return false 落穿，平台全选执行。渐进序列的「全文」档即由该透传达成
   （文本/引用分支；列表分支的全文档为显式派发区间）。
4. **平台保留键不受影响**：undo/redo 在 Prec.highest 且扩展序先于附加
   组件槽，本拦截不触及。
5. Esc 与宿主级快捷键不涉（本拦截仅 Mod-a 一键）。

## 降级口径（#5 blocked 的正则先行，升级点）

行类型与块边界判定在 `src/blockScan.ts` 以行首形态学扫描近似上游树版
`getPosLineType2`（对齐 #2/#7 降级先例）。**#5（列表/引用块语法树识别）
落地或平台补树查询能力后，本模块整体替换为树版判定，调用面形状不变。**

| 对象 | 降级规则 | 与树版的已知差异（升级点） |
| --- | --- | --- |
| 列表标记行 | `/^(\s*)([-*+] \[[^\]]\]|[-*+]|\d+\.)\s/`（上游原正则） | 一致 |
| 列表续行 | 缩进 ≥2 且上方最近非空行属列表（空行不阻断） | 树版按解析归属：缩进 <2 的续行、表格外围栏等边界情形可能不同 |
| 引用/callout | 上游 quote_regex / callout_regex 原样；callout 上溯不 break（上游注释掉的 break） | 一致（上游本就纯正则） |
| 代码围栏 | 任意缩进的 ```` ```/~~~ ```` 开行切换开闭态 | 开闭不校验围栏字符/长度配对（``` 与 ~~~ 互相可闭合） |
| 公式块 | 整行为 `$$` 切换 | 单行 `$$x$$` 不识别为块（树版识别）；`$$x` 起行不识别 |
| frontmatter | 首行 `---` 开到闭合 `---`（未闭合到文末） | 树版按 token；`---` 下邻文本构成 setext 标题等形态不判 |
| 段块邻行 | kind=text 且非空且非 `^#+ ` 标题 | 一致（表格行/水平线归 text 为上游 v2 原语义） |

## 快捷键评估（操作注册规范口径）

- **Mod+A 渐进选择**：快捷键入口 = 实验 cm6 抢先层 keymap（`Mod-a`），
  不进统一快捷键管理——平台对实验层的既定约定（见「平台映射」）。
  vsidian #402 稳定化后按票内口径迁移。默认生效条件 = `enhanceModA`
  设置开启（默认关）。
- **选择当前块**：稳定命令 `select-block`，已进统一快捷键管理；默认
  未绑定（上游无默认热键），生效模式 live、非写操作；用户可经平台
  快捷键管理显式绑定/清空/恢复默认。

## 已知边界

- **每次按键 O(行数) 单遍扫描**（无缓存——文档随时变更，正确性优先）：
  与上游树版单次查询同阶；10 万行档位的手感验证归 #21，如出现可感知
  延迟再评估增量缓存。
- 段块/引用块/列表档位均为行级区间（含行尾换行前的全部内容，不含末
  行换行符——上游同口径）。
- 命令目标句柄由平台解析（焦点嵌入 Live → 该实例句柄；否则主正文；
  无活动视图 null）——embed（引用内 Live）中触发即操作 embed 自身，
  无焦点不猜测，目标即边界（原 findFromDOM 探针双路径随平台句柄面
  落地合一）。
- 上游 handleModA 末段的 BetterCodeEdit 代码块选中（selectCodeBlockInPos）
  属另一功能族（betterCodeEdit 设置），不在本票范围。

## 给 #21（人工验证）的提示

- **真实键盘手感**（矩阵无法承载的部分）：连续 Mod+A 的档位推进节奏、
  选区高亮跟随、IME 组合期按 Mod+A 的表现（抢先层在组合期是否可达——
  平台行为，非本组件特判）。
- **接管边界实测**：设置关 → Mod+A 应与原生全选无差别；设置开 → 围栏/
  公式/frontmatter 内 Mod+A 应落穿为原生全选。
- **设置运行时翻转**：设置页开/关 enhanceModA 后回到编辑器（焦点回归），
  下一次 Mod+A 即按新值判定。
- **命令路径**：命令面板执行「选择当前文本块」（焦点在宿主 UI——
  平台解析主正文句柄）；在 embed 引用内 Live 中触发命令（平台解析
  embed 句柄）；快捷键管理中为 select-block 绑定/清空/恢复默认。
- **长文档**：10 万行档位下 Mod+A 响应延迟是否可感知（O(行数) 扫描）。
