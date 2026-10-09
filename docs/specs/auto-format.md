# 自动格式化（工单 #26）

上游 easy-typing-obsidian 格式化族（Formater）的移植：语言对间距、前缀词典、自动大写、软空格符号。事实源模块：`src/formatting/`（六纯模块：scriptCategory / prefixDictionary / textFormatter / inlineParts / inlineSpacing / lineFormatter）、`src/autoFormatPipeline.ts`（管线）、`src/autoFormatIntercept.ts`（行为族接入）；测试矩阵：`test/lineFormatter.test.ts`（上游验证矩阵）与五个单元级测试 + 管线/接入测试。

## 验收口径

- 单测矩阵全绿：`test/lineFormatter.test.ts` 72 场景（语言对 × 前缀词典 × 大写开关 × 行内分区 × 光标语义）期望值经**上游差异化验证**固定，另有 90+ 单元/管线/接入用例。
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
- **fromB 推导**：快照回推 `fromB = 光标 − inputText.length`（上游的 compose_begin_pos / fromB 在平台快照后的等价物）。IME 定稿（`input.type.compose`，#399 替换侧恒 null）按纯插入同路径处理。
- **仅纯插入 + 塌缩单光标**：上游 `notSelected && changedStr.length < 1`——选区替换形态（replaced.text 非空）不格式化；inputText 含 `\n` 走 Enter 定稿分支。
- **多光标结论**：`selections.length > 1` → 不处理。#25 管线取首光标坍缩语义；本管线因 prevCh 推导依赖 inputText 归因（平台 inputText 是多选区拼接），收窄为单光标，多光标键入不格式化（上游 asSingle().main 语义的保守收窄）。
- **链序**：`06-autoformat` 加入 #25 五族共用的 `input-rules` 独占组（localId 数值前缀在 01-05 之后 = 平台默认有效序），复刻上游「triggerCvtRule 命中即 return、格式化只在规则零命中后运行」。族级开关（平台行为管理）= 上游 AutoFormat 总门的平台承载；autoCapital 等细粒度经 #3 设置门面（`effective.autoFormat` 在族回调内判定，关 → 恒 null 不占组，规则五族不受影响——与上游「规则先于 AutoFormat 门」一致）。history 一律 atomic（#25 joinPrevious 全量核对结论沿用：键入是外来条目不可并组）。
- **设置消费**：`SETTINGS_TOPIC.get` 的 effective 拉 9 键（autoFormat / autoCapital / prefixDictionary / softSpaceLeft·RightSymbols / inlineCode·Formula·LinkSpaceMode / inlineLinkSmartSpace），装载时与每次 `behaviors.onChanged` 刷新，通道失败保持上次值、值类型失配回默认。languagePairs / customScriptCategories 不在 23 键 schema——出厂种子直取 `RICH_STRUCTURE_DEFAULTS`（富结构持久化与编辑 UI 归后续票，运行时消费面此为单一事实源）。SpaceMode 字符串档 ↔ SpaceState 数字档按下标同构换算。

### 作用域跳过（正则降级版 getPosLineType）

上游经语法树令牌判行类型（table/frontmatter/formula/codeblock 非 text 不格式化）。平台映射：

- **代码块 / frontmatter / 表格格区**：平台行为链门控先行排除（#25 记录），管线不重复判定表格；frontmatter 与块级代码另经 `detectScopeFromText`（#25 文本降级：围栏状态机 + `$`/`$$` 配对近似）防御重复——真实 webview 中平台门控已拦，管线级判定是 vitest 集成测试与防御深度。
- **块级公式**：`detectScopeFromText` Formula 分支（$$ 跨行 + 行内 $ 区间）。
- **已知近似**（继承 #25）：行内公式 `$x$` 内光标 → 误判 Formula 跳过整行（上游树版仍格式化该行其他 text 分区）；货币写法 `$100` 同源误判；围栏标记行本身不算代码内容（与 detectScopeFromText 口径一致）。语法树版归 #5 换传，管线零改动。
- **行内代码/公式的天然保护区**：不靠行级跳过，由 `splitLineIntoParts` 文本扫描切成 code/formula 分区（形态学：反引号等长配对、`\$` 转义、`$$` 成对优先、代码先于公式、链接正则只在非 code/formula/user 区段上跑——上游正则逐字）。切分形态学是本移植自有降级（上游走语法树），由 `test/inlineParts.test.ts` 形态断言钉住；分区间格式化等价性由上游验证矩阵承载。

### #27 注入缝（保护区）

- **管线层**：`planAutoFormatLineModification(ctx, { protectedRanges })`——行内坐标 `[begin, end)` + 左右空格要求（SpaceState 三档）；本票调用侧不传（无保护区）。
- **接入层**：`registerAutoFormatBehavior({ protectedRangesFor?: (line) => ranges })`——#27 按当前驱动行原文计算区间（上游 UserDefinedRegExp 的 `|xy` 行尾旗标解析与匹配归 #27，字符串枚举形态经接入层映射为数字档）。
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

## 给后续票的提示

- **#27（保护区接入）**：注入缝两处——管线 `protectedRanges`（行内坐标 + SpaceState）与接入 `protectedRangesFor(line)`（种子形态：行内坐标 + 'none'|'soft'|'strict'）；上游 `UserDefinedRegExp` 行尾 `|xy` 旗标解析（core.ts `str2SpaceState`）与逐行匹配归 #27；`userDefinedRegSwitch` 开关同时是 #25 用户规则跳过检查的依赖。注意接入层默认 effective 不含该两键（23 键 schema 有 userDefinedRegSwitch/userDefinedRegExp——#27 接线时从同通道拉取）。
- **#28（格式化命令复用）**：`formatLine(line, curCh, prevCh=undefined, settings, { protectedRanges })` 即上游 formatLine 的命令重排入口形态（prevCh undefined = 整行重排不认前缀抑制）；多行/选区重排按行循环调用 + 行首偏移换算（参照 autoFormatPipeline 的坐标换算）。粘贴格式化（AutoFormatPaste 主动侧）与「格式化文章」都可经此承载，不经行为链。
- **#21（真实 webview 人工验证）**：本族验证点——中文后键入半角字母出空格且光标在词尾；`n8n`/`b站` 词典词条内部无空格、越词后延迟边界补插；规则族命中输入（如 `。。`）本次不格式化（独占组链序）；折叠/展开与 IME 定稿路径；多光标不格式化；Ctrl+Z 两步撤回（键入与格式化分离，平台撤销管线结构性边界）；CSP 无涉（纯算法，无 new Function）。真实 `experimental.cm6.language.syntaxTree` 未解析（vsidian#406）不影响本族——分区走文本降级。
