# 自动格式化（工单 #26）

上游 easy-typing-obsidian 格式化族（Formater）的移植：语言对间距、前缀词典、自动大写、软空格符号。事实源模块：`src/formatting/`（六纯模块：scriptCategory / prefixDictionary / textFormatter / inlineParts / inlineSpacing / lineFormatter）、`src/autoFormatPipeline.ts`（管线）、`src/autoFormatIntercept.ts`（行为族接入）；测试矩阵：`test/lineFormatter.test.ts`（上游验证矩阵）与五个单元级测试 + 管线/接入测试。

## 验收口径

- 单测矩阵全绿：`test/lineFormatter.test.ts` 108 场景（#26 落地 72 场景 + #4 验收补格 16 场景：行内间距三档 × code/formula/wikilink/mdlink、链接智能空格子分支、非 text 分区直接相邻 + #70 补 20 场景：结构性标记符边界不参与行内元素间距，含 strict 档同禁与正文间距回归保护；语言对 × 前缀词典 × 大写开关 × 行内分区 × 光标语义 × 间距三档）期望值经**上游差异化验证**固定（#70 的 20 场景为本仓有意偏差，不对上游验证，见「已知边界」），另有 90+ 单元/管线/接入用例。
- 集成级承载（真实 webview 归 #21）：`test/autoFormatIntercept.test.ts` 以真实 `AddonInputContext` 形状驱动注册回调 → 计划断言（`06-autoformat` 族 onInput 全链）。
- `npm run compile` 通过；全部测试绿（554 基线不回归）。
- `src/formatting/` 零平台依赖（仅模块内相对导入与 logging）。

## 上游对照

上游 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa），按内容锚点逐条对照：

| 上游锚点 | 移植落点 | 语义 |
| --- | --- | --- |
| `src/formatting/script_category.ts`（121 行） | `src/formatting/scriptCategory.ts` | 逐行：枚举值原样（chinese/japanese/korean/cjk/english/digit/russian/unknown）、Unicode 区段表原样、CJK 元类并集展开、自定义类按名查 pattern（字符类内部片段） |
| `src/formatting/prefix_dictionary.ts`（113 行） | `src/formatting/prefixDictionary.ts` | 逐行：token 解析（正则条目 `/.../flags` 先行）、精确命中（字面词**区分大小写**——注释写 Case-insensitive 与实现不符，以实现为准）、前缀判定（仅字面词）、抑制四规则、最长前缀匹配 |
| `src/formatting/text_formatter.ts`（573 行） | `src/formatting/textFormatter.ts` | 逐行：capitalizeFirstLetter（句首正则族）、capitalizeMidSentence（句中标点 + " ." 守卫）、applyLanguagePairSpacing（token 中心算法：findTokenBounds 脚本感知、extendCursorTokenForDict 跨脚本词典词扩展、collectAllBoundaries、collectFormattingSeparatedBoundaries 格式符分隔边界、protectedUpTo / prefixDictExpired 延迟补插）、detectBoundarySpaceState（内置符号集 + `<br>` + \0 标记语义） |
| `src/formatting/inline_spacing.ts` | `src/formatting/inlineSpacing.ts` | 逐行：shouldInsertSpaceBetweenParts / shouldPrependSpaceToText |
| `src/core.ts` `LineFormater.formatLine`（L175-433） | `src/formatting/lineFormatter.ts` | 逐行：分区循环、\0 光标标记、`$\qquad$` 文本空隔特例、链接智能空格双分支（含别名感知 getLinkBeginChar 与智能回退）、分区变更收集（原行坐标） |
| `src/core.ts` `formatLineOfDoc`（L142-170） | `src/autoFormatPipeline.ts` | 坐标换算职责：行定位（lineAt(fromB)）、curCh/prevCh 行内换算、`\n` 定稿分支（curCh=prevCh=fromB 列 + 光标跨插入段平移 insertedStr.length）、变更表 → 文档坐标计划 |
| `src/cm_extensions.ts` `tryProcessInput`（L401-438） | `src/autoFormatPipeline.ts` + `autoFormatIntercept.ts` | 触发门控（AutoFormat 总门 / 纯插入 / 行类型 text）与链序（规则命中即短路格式化，经独占组承载） |
| `src/cm_extensions.ts:556` 粘贴判定 | `planAutoFormatLineModification` 头段 | 粘贴识别 = `userEvent 含 'paste' \|\| marker.pasteDetected`；命中即跳过并 `consumePlainPaste()`（一次性，读即消费） |
| `DEFAULT_SETTINGS` 相关字段 | `src/settings/defaults.ts`（#3 已落） | languagePairs 三默认对与 customScriptCategories 空种子在 `RICH_STRUCTURE_DEFAULTS` |

**上游差异化验证方法**（复跑）：esbuild 把上游 `core.ts` 与本移植 `lineFormatter.ts` 打进同一 bundle（obsidian / @codemirror/* 以 stub 替代；上游 `parseLineWithSyntaxTree` 用伪 syntaxTree 注入本移植切出的 code/formula 区段——节点名须用 Obsidian 风格小写连字符如 `inline-code`，`name.contains('code')` 判型驼峰不命中），逐场景比对 `[resultLine, cursorCh, changes]` 三元组，72/72 等价后把上游输出回填为 `test/lineFormatter.test.ts` 的期望值。脚本残留在 worktree `out/test/diff26/`（gitignored，不入库）。

## 平台映射

### 触发链与格式化口径（票面 open question 的规格化结论）

- **格式化当前行**（上游 formatLineOfDoc：`doc.lineAt(fromB)`），非「光标左侧全文」；`prevCh..curCh` 是本次键入在行内的区间，边界插入默认只发生在该区间（例外：光标 token 的词典保护/过期补插，见上游算法）。
- **fromB 推导**：快照回推 `fromB = 光标 − inputText.length`（上游的 compose_begin_pos / fromB 在平台快照后的等价物）。IME 定稿（`input.type.compose`）替换侧自平台 #593 起经组合期净变更推导可达：携带非空 replaced（组合起点有选区）的定稿按选区替换形态**跳过格式化**——与键入路径的选区替换同口径（上游 `changedStr.length < 1` 的定稿延伸；平台单驱动仲裁下选区替换形态归 SelectKey，无第二次驱动可补，上游 compose-end 的补跑不属于本移植复刻面）；纯塌缩与迟入组合 replaced 为 null，按纯插入同路径处理。
- **仅纯插入 + 塌缩单光标**：上游 `notSelected && changedStr.length < 1`——选区替换形态（replaced.text 非空）不格式化；inputText 含 `\n` 走 Enter 定稿分支。
- **多光标结论**：`selections.length > 1` → 不处理。#25 管线取首光标坍缩语义；本管线因 prevCh 推导依赖 inputText 归因（平台 inputText 是多选区拼接），收窄为单光标，多光标键入不格式化（上游 asSingle().main 语义的保守收窄）。
- **链序**：`06-autoformat` 加入 #25 五族共用的 `input-rules` 独占组（localId 数值前缀在 01-05 之后 = 平台默认有效序），复刻上游「triggerCvtRule 命中即 return、格式化只在规则零命中后运行」。族级开关（平台行为管理）= 上游 AutoFormat 总门的平台承载；autoCapital 等细粒度经 #3 设置门面（`effective.autoFormat` 在族回调内判定，关 → 恒 null 不占组，规则五族不受影响——与上游「规则先于 AutoFormat 门」一致）。history 一律 atomic（#25 joinPrevious 全量核对结论沿用：键入是外来条目不可并组）。
- **设置消费**：`SETTINGS_TOPIC.get` 的 effective 拉 9 键（autoFormat / autoCapital / prefixDictionary / softSpaceLeft·RightSymbols / inlineCode·Formula·LinkSpaceMode / inlineLinkSmartSpace），装载时与 `behaviors.onChanged` 刷新（3s 节流窗——C-R4-2，设置改动最迟一个窗口后的下一次键入生效），通道失败保持上次值、值类型失配回默认。languagePairs / customScriptCategories 不在 23 键 schema——出厂种子直取 `RICH_STRUCTURE_DEFAULTS`（富结构持久化与编辑 UI 归后续票，运行时消费面此为单一事实源）。SpaceMode 字符串档 ↔ SpaceState 数字档按下标同构换算。

### 作用域跳过（#5 树版 detectScopeViaQuery）

上游经语法树令牌判行类型（table/frontmatter/formula/codeblock 非 text 不格式化）。平台映射（#5 切片 B 换传完毕，正则降级版已删）：

- **块级代码 / 行内代码**：`detectScopeViaQuery`（平台 `experimental.syntax` 经 `syntaxTreeQuery` 适配——`inlineAt` 判行内 code、`lineTypeAt` 判块级 code，链接区段内排除；映射对照见 [syntax-line-types.md](syntax-line-types.md)）→ Code 跳过。
- **块级公式 / 行内公式**：同上 Formula 分支（跨行 `$$` 块 + 行内 `$` 区间，含单行闭合 `$$x$$`——升级收益）。
- **frontmatter**：`isInsideFrontmatter` 补判（平台行为链已门控 fm/块代码/表格格区，此处为管线级防御重复；表格不另判——依赖平台门控，口径不变）。
- **与上游的已知差异（如实保留，管线测试钉住）**：上游行级门控用 v1 全行校验（行内 code/公式行是 text → 格式化该行）；本管线用位置级作用域——**光标在行内 code/formula 内时跳过整行**（上游仍格式化该行其他 text 分区）。原降级版的货币 `$100` 误判已消除（平台判定链的 `$` 配对语义，无正则区间误判）。
- **行内代码/公式的天然保护区**：不靠行级跳过的场合由 `splitLineIntoParts` 树版查询分区（`inlineAt` 位置查询驱动 + 链接区段剪除，`linkSpansOfLine` 正则与上游逐字同源；形态学扫描版已随 #5 删除）；分区间格式化等价性由上游验证矩阵承载。

### #27 注入缝（保护区）——已由 #27 落地为内置默认计算

- **管线层**：`planAutoFormatLineModification(ctx, { protectedRanges })`——行内坐标 `[begin, end)` + 左右空格要求（SpaceState 三档）；管线保持纯函数，区间集由接入层注入。
- **接入层**：`registerAutoFormatBehavior({ protectedRangesFor?: (line) => ranges })`——外部注入保留且优先（测试/后续票覆盖位）；缺省时内置计算（`userDefinedRegSwitch` 开 → 出厂/用户模板 `matchProtectedRanges`，关 → 空），解析与匹配语义见 [protected-zones.md](protected-zones.md)（上游 UserDefinedRegExp 的 `|xy` 行尾旗标解析与逐行匹配的移植）。
- **重叠语义**：user 区间与 code/formula 天然保护区重叠时**剪除重叠段**（天然保护区优先——上游树版中 code/formula 由语法树先行摘出，用户正则区块只在剩余 text 上匹配，语义等价；`test/inlineParts.test.ts` 钉住）。

### #12 粘贴联动（smart-paste.md「给 #26 的接口提示」的消费）

- 粘贴识别 = `userEvent 含 'paste' || marker.pasteDetected`（上游 cm_extensions.ts:556 同构）；命中即跳过格式化并 `consumePlainPaste()`（一次性，读即消费）——**粘贴判定先于 userEvent 门**（paste 事务不在 Input 触发面，但纯文本意图的消费须在粘贴命中时发生）。
- 平台行为链对 paste·drop·undo 事务不驱动行为（#25 记录），此判定实际防御的是粘贴 500ms 窗内的普通键入；上游「粘贴时格式化」（AutoFormatPaste 主动侧）经行为链**结构性不可达**，不在本票范围（#28 格式化命令可复用 `formatLine` 承载，见下）。
- pasteMarker 单例经 `registerAutoFormatBehavior({ marker })` 参数注入（page-editor 装配点传入，不跨模块 import 页面实例）。

## 已知边界

- **票面「TextOrFormula 区分」在移植基线不存在**：上游 v6.0.9 全 git 历史无该设置——语言对在上游是统一形态（languagePairs 无 text/formula 分组），公式相关间距由公式分区的空格策略（`InlineFormulaSpaceMode` + 分区邻接判定）承载，本移植同构。票面该括号细节按无此物处理。
- **分区重建的钳制偏差**：上游 splitTextWithLinkAndUserDefined 重建循环在 wikilink/mdlink 重叠等极端形态下会重复计入重叠文本；本移植 textBegin 单调前进（钳制），正常输入两者一致（差异化验证 72/72 含链接场景）。wikilink 先匹配、mdlink 后匹配且互不冲突检查（上游 matchWithReg 语义原样保留）。
- **qquad 光标特例**：光标分区恰为 `$\qquad$` 时 resultCursorCh 归 0（上游特例分支在光标定位之前 continue，属上游怪癖，差异化验证确认两侧一致，不擅自修复）。
- **词典大小写**：字面词区分大小写（上游实现口径）；默认词条 python3/Python3 双写即为此服务。
- **非法正则词条**：上游 console.warn → 本仓 debugLog（logging 约定；词典每次格式化重建，console 直打会在每次键入重复刷屏）。
- **debug 日志段不移植**：applyLanguagePairSpacing 的 settings.debug console.log（开发期噪声，非行为语义）。
- **多光标不格式化**（见平台映射）——#21 验证点：真实 webview 多光标键入确认无格式化且光标不坍缩（族不返回计划即不占组、不改选区）。
- **AutoFormatPaste 主动侧不可达**（见 #12 联动节）。
- **结构性标记符边界不参与行内元素间距（#70，本仓有意偏差）**：文本分区端点若是**结构性标记符游程**（`` ` `` `*` `_` `~` `=` `$` `/` `\` `|` `<` `>`，见 `textFormatter.ts` 的 `STRUCTURAL_MARKER_CHARS`），该边界由 `isStructuralMarkerBoundary` 判定，`lineFormatter` 在**任意档位**比较之前硬跳过——三档（none/soft/strict）一律不补空格。动机：上游把「文本→行内元素」的间距统一按正文语义处理，导致 `**` 与 `[[a]]`、`/` 与行内代码之间被补空格（`**[a](b)**` → `** [a](b) **`，粗体语法直接失效）。标记符是语法结构不是正文文字，不应参与间距策略。
  - **三档同禁而非只抬 soft**：早期实现把端点抬成 `soft`，只挡住 `soft > soft`，strict 档的 `strict > soft` 仍成立（审查 PR73-001 实测 `**[a](b)**` → `** [a](b)**`）；现改为插空格前的硬跳过，档位语义不参与判定。
  - **`detectBoundarySpaceState` 维持上游语义**：标记符不表达为边界状态（它不是「已满足的空格」），边界状态机保持与上游逐行等价，标记符判定独立成谓词。
  - **两侧同源**：text→元素看前 text 分区尾部，元素→text 看本 text 分区开头；因此 `**[[a]]`、`` `a`** ``、`中文**[[a]]**` 均命中。
  - **只认 text 分区**：元素分区自身以反引号/星号定界属语法承载，不参与标记符判定（`` `a`[[b]] `` 的元素间间距维持上游契约）。
  - **不加宽既有边界**：`]`/`)`/半角标点等闭合符的终点语义维持上游契约；括号与全角标点仍由原内置软符号集覆盖，标记符集合不重复登记。
  - **上游对照的豁免**：新增的 20 个矩阵场景不对上游做差异化验证（上游在此处行为即待修正目标），其余 88 场景的上游等价性不变。

## 给后续票的提示

- **#27（保护区接入）——已落地**：解析与匹配纯逻辑在 `src/userDefinedRegex.ts`，格式化侧内置计算 + 「用户规则尊重保护区」规则管线接入的完整语义见 [protected-zones.md](protected-zones.md)。注入缝两处（管线 `protectedRanges` 与接入 `protectedRangesFor`）形态不变，外部注入优先于内置计算。
- **#28（格式化命令复用，已落地）**：本节原文写 `formatLine(line, curCh, prevCh=undefined, ...)` 是命令重排入口——**#28 实施勘误**：`prevCh=undefined` 是「跳过间距引擎」形态（`applyLanguagePairSpacing` 早退，实测零变更）；命令整行重排的正确入口是上游同形 `formatLine(line, curCh, 0, settings)`（键入区间 [0, curCh) 覆盖整行前缀，语言对全量生效；autoCapital 恒关——上游 `{...settings, AutoCapital: false}`）。多行/选区重排按行循环调用 + 行首偏移换算（参照 autoFormatPipeline 的坐标换算）。粘贴格式化（AutoFormatPaste 主动侧）经此承载，不经行为链；实施与键位/文件排除记录见 [formatting-commands.md](formatting-commands.md)。
- **#21（真实 webview 人工验证）**：本族验证点——中文后键入半角字母出空格且光标在词尾；`n8n`/`b站` 词典词条内部无空格、越词后延迟边界补插；规则族命中输入（如 `。。`）本次不格式化（独占组链序）；折叠/展开与 IME 定稿路径；多光标不格式化；Ctrl+Z 两步撤回（键入与格式化分离，平台撤销管线结构性边界）；CSP 无涉（纯算法，无 new Function）。#5 起作用域与行内分区走平台 `experimental.syntax` 位置查询（vsidian#406 的 `cm6.language.syntaxTree` 未解析边界不再影响本族）。
