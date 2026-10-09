# CollapsePersistentEnter——折叠标题处 Enter 新建同级标题（工单 #18）

> 上游 easy-typing-obsidian 的折叠编辑移植：光标在「被折叠的标题行」上
> 按 Enter，在折叠区间末尾之后新建同级标题行（折叠保持不展开），而非
> 在标题行内换行。上游默认关（`CollapsePersistentEnter: false`），本仓
> 同默认关（设置键 `collapsePersistentEnter`，#3 已交付数据链）。

## 验收口径（票面映射）

- 折叠/展开两态下 Enter 行为端到端：以**决策单元**（`test/foldEnter.test.ts`
  「决策」组——真实 `EditorState` + 手造 folds 数据驱动）与**拦截单元**
  （同文件「Command」组——最小模拟 view 驱动接管/透传与派发形态）承载；
  浏览器真实键盘端到端归 #21。
- 折叠态不被意外展开：**「折叠保持验证」组**以平台派生口径的 mini 复刻
  （键集合 + `ChangeSet.mapPos(key, 1)` 映射 + join 区间重派生）断言插入
  事务后键集合原位零脱靶、同一标题仍在折叠集中、新标题行成为折叠区间
  新边界（可见）；并断言派发事务零 effects（纯文本事务，不触碰折叠
  StateField——平台侧折叠态零写回）。
- `npm run compile` 通过；全部测试绿（基线 404 例不回归）。

## 上游对照

| 内容 | 上游锚点（v6.0.9 克隆） | 本仓落点 |
| --- | --- | --- |
| 折叠标题 Enter 拦截 | `src/keyboard_handlers.ts:146-196`（enterCollapsedHeading） | `src/foldEnter.ts`（planFoldHeadingEnter + createFoldEnterCommand） |
| Enter 主入口多选区透传 | `src/keyboard_handlers.ts:299-305`（handleEnter） | `planFoldHeadingEnter` 内（多选区 null） |
| 设置键 | `CollapsePersistentEnter`（默认 false） | `src/settings/defaults.ts` `collapsePersistentEnter`（#3 交付；本票接线生效） |

### 语义要点（与上游逐一对齐）

- **命中面**：光标在被折叠的标题行上（折叠态下隐藏内容不可达，光标
  只能停在可见标题行）→ 在折叠区间末尾之后新建同级标题行；标题级别
  与格式直取被折叠标题行（`#` 串数 + 一个空格——**非两空格**；上游
  insert 即 `'\n' + '#'.repeat(level) + ' '`）。
- **ATX-only**：标题行判定 `/^#+ /`（`#` 串后须有空格）；Setext 标题
  的折叠 span（key 行是内容行，非 `#` 形态）不命中、透传——上游同口径。
- **折叠保持**：插入后折叠不展开、光标不进入折叠内容内部；光标落新
  标题行行尾（上游 `ch = level + 1` 等价位）。
- **多选区透传**：上游 handleEnter 主入口先查 `ranges.length > 1`。
- **默认关**：设置门关（含通道失败保持上次值）一律透传，透传即安全方向。

### 与上游的差异

- **StrictModeEnter × strictLineBreaks 分支不移植**：上游在「严格换行 +
  折叠末行非空白」时前置空行（`'\n\n' + 标题`）；strictLineBreaks 是
  Obsidian 阅读渲染概念，vsidian 无此设置，整支剔除。
- **折叠命中判定收紧**：上游 `pos ∈ [l.from, l.to]`（含隐藏区内部——
  Obsidian CM5 折叠下光标可达性靠展开重折 hack 保证）；平台折叠隐藏区
  不可达（落点展开），本仓判定为「光标行行首 == 折叠键 span.key」，
  语义等价且不依赖折叠区间终点形状。
- **无 toggleFold hack**：上游在折叠末尾插入后 `setCursor + toggleFold +
  setCursor` 三连（CM5 折叠 API 不随文本变更自动重算，需展开重折刷新）；
  平台折叠是 CM6 StateField 派生模型（键集合不变 + 查询时按当前 doc
  重派生区间），插入新标题行后键集合不动、新标题自动成为区间新边界
  ——纯文本事务一次派发即折叠保持（「折叠保持验证」组钉住）。
- **插入文本换算**：平台 span 的 `hideTo` = 下一标题**行首**（换行符
  之后），上游 CM5 插入点在折叠末行**行尾**（换行符之前）——同一物理
  间隙的两侧。在行首前插入独立行须携带尾部换行（`'## \n'`），否则新行
  与下一标题拼行；文档末尾无尾随换行时改前置换行（`'\n## '`）。文档以
  换行结尾时新行之后留尾部空行——与上游在等价场景（CM5 行尾插
  `'\n# '`）的文本结果一致。
- **userEvent / scrollIntoView**：上游自定义 `EasyTyping.handleEnter`；
  本仓对齐 CM6 惯例 `'input.newline'`（撤销归类正确）+ `scrollIntoView:
  true`（新标题行在折叠末尾，不滚动易脱视）。
- **非空选区不特判**：对齐上游（只看 `s.main.to`）——选区在标题行上
  时按 Enter 触发折叠插入、选区文本保留原处。

## 层归属与平台 Enter 仲裁（#402 四层按键优先级契约核对）

**抢先层 Prec.high**（对齐 #8 Backspace / #11 Mod-A 的层归属模式）：

1. 平台保留键闸（undo/redo）不含 Enter——无越界问题。
2. 本层先于平台 Enter 情境链（列表续行 listEditing / 表格 / 普通换行）
   尝试；**接管面 = 功能开 + 单选区 + 光标行是 ATX 标题 + 该标题行在
   folds() 有效折叠集中**——命中 return true，其余一律 return false
   落穿。
3. **仲裁核对**：折叠标题行不是列表项/表格行，平台 Enter 情境链在该
   行上走普通换行——本层命中接管**不遮蔽任何平台情境语义**（列表续行
   的接管面在列表项行，与本层命中面不相交）；非折叠态标题行、展开态
   全文、阅读态、悬停视图全部透传。
4. Esc 与宿主级快捷键不涉及。实验层 keymap 不进平台统一快捷键管理
   （平台约定：用户关闭组件 = 停用；组件内功能粒度开关由设置门承担
   ——恒注册 + 门控透传的等价形态，运行时开关即时生效）。

### 折叠查询（experimental.headingFold）消费口径

- **folds() 按反查实例 ID 寻址**（vsidian PR #432 起的 §4.2 契约）：
  keymap 回调 view 经 `experimental.viewIdentity.instanceIdOf(view)` 反查
  实例 ID 后按 ID 查询——不依赖「扩展槽仅挂主正文」的装配范围推定
  （装配范围演进时寻址自动跟随）；反查 null（非平台实例）透传。清单
  已声明 `viewIdentity: '^1.0.0'`。
- **每键实时查询 + 零开销行门槛**：Command 先判光标行是 ATX 标题
  （纯文本正则，零 API 调用），通过才调 `folds()`——平台侧 folds 走
  共享缓存过滤并逐项拷贝返回（PR #432 起，无全文档重扫），非标题行
  Enter 主路径不付这笔每键调用开销；标题行 Enter 频率低（建标题后立即
  输入内容），查询成本可接受。
- **防御性拷贝消费**：folds() 返回派生视图拷贝，本仓只读消费（find），
  无变异。
- **Live-only 边界**：folds() 拒绝（`read-only` = 阅读态 / hover 只读、
  `view-disposed`）一律静默透传（return false），不算故障；宿主未提供
  headingFold 入口（清单兼容判定已在装载期拦截，正常不到）时本功能
  整体不注册。
- **IME 组合中与只读状态不接管**（对齐 #8 口径）。

### 设置门

`collapsePersistentEnter` 生效值经 #3 设置通道（`SETTINGS_TOPIC.get`，
宿主 `attachSettings` 门面合成 `effective`）：装载拉取 + 焦点回归刷新
（对齐 #11 modAGate 形态）；通道失败保持上次值（瞬时故障不翻转拦截
行为），初始 false（默认关）。上游设置键与本仓键的映射见
[settings-mapping.md](settings-mapping.md) 二节表格。

## 清单声明

`package.json` → `vsidianAddon.experimental` 增补 `"headingFold": "^1.0.0"`
（版本事实源 = vsidian `addonApiCatalog` 实验表；**范围必须 `^`**，精确
版本判不兼容——scaffold 契约测试钉住）。

## 已知边界

- 阅读模式折叠不开放（平台 #409 定案，与 Obsidian 不同）——本功能本就
  仅 Live 编辑生效，不受影响；平台后续开放阅读折叠也无需变更。
- 折叠末尾是**引用/列表内的嵌套标题**时（平台 collectHeadings 下降容器
  块），新标题行插在该嵌套标题节末尾——插入的新行不带容器前缀（上游
  同样裸插），视觉上可能脱离引用/列表上下文；属上游既有口径，本票不
  扩展。
- 同级标题的级别上限随上游口径 1–6（ATX `#` 数）；`#######`（7 个）非
  标题，平台折叠派生也不产 span，天然透传。

## 明确不包含

- 上游 StrictModeEnter / StrictLineMode 相关分支（属普通行 Enter 处理，
  归后续 Enter 功能票整体评估，不在本票顺手引入）。
- 浏览器真实键盘端到端与设置页观感（#21 人工验证清单）。
- 折叠命令（apply/foldAt/unfoldAt）的任何编程消费——本票只读查询。
