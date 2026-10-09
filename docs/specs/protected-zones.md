# 自定义正则保护区（工单 #27）

用户声明正则区块（默认模板含 `{{...}}`、`<...>`、callout、URL、email；tag 条目以注释行形态随模板分发），区内文本不做任何格式化——格式化精度的重要逃生舱。配套「用户规则尊重保护区」开关（默认关）：开启时 #25/#9 规则管线在保护区内不触发。事实源模块：`src/userDefinedRegex.ts`（解析与逐行匹配纯逻辑）；接入：`src/autoFormatIntercept.ts`（格式化侧）与 `src/ruleBehaviorIntercept.ts`（规则侧）；测试矩阵：`test/userDefinedRegex.test.ts`（27 例）、`test/ruleBehaviorPipeline.test.ts` 保护区注入组（13 例）、两个 intercept 测试的 #27 组（5 + 6 例）。

## 上游对照

上游 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa），按内容锚点逐条对照：

| 上游锚点 | 移植落点 | 语义 |
| --- | --- | --- |
| `src/core.ts` `splitTextWithLinkAndUserDefined`（L525-624） | `src/userDefinedRegex.ts` `parseUserDefinedRegExp` + `matchProtectedRanges` | 逐行：行尾 `|xy` 旗标解析（`+` strict / `=` soft / `-` none）、空行与 `//` 注释行跳过、无旗标或长度 ≤ 3 跳过、非法正则跳过不抛出；匹配 wikilink/mdlink 先落位为冲突基线（正则逐字，自 inlineParts 导出共享），用户规则命中与基线或先序规则命中重叠即弃 |
| `src/core.ts` `str2SpaceState`（L636-647） | `flagToSpaceState` | 逐字：`+`→strict、`=`→soft、`-`/其他→none |
| `src/core.ts` `isCursorInUserDefinedRegexBlock`（L626-634） | `isPositionProtected` | 列 ∈ [begin, end) 半开区间判定 |
| `src/core.ts:181-183` formatLine 消费 | `autoFormatIntercept.ts` onInput | `UserDefinedRegSwitch` 开 → 保护区参与行内分区；关 → 无 user 分区（上游同构：不传 regExps） |
| `src/rule_processor.ts:22-29` triggerCvtRule 检查 | `ruleBehaviorPipeline.ts` `isPositionInProtectedZone` + 三管线注入位 | `UserDefinedRegSwitch && UserRulesRespectUserDefinedRegexBlocks` 双开 → 检查列在保护区内则规则不触发；检查列公式：事件类以 `input` 为前缀回退一列（刚键入字符所在列），否则用列本身 |
| `DEFAULT_SETTINGS.UserDefinedRegExp` | `src/settings/defaults.ts`（#3 已落，逐字保留） | 本票消费该值；上游默认模板第 6 行 tag 条目以 `// Tags in Obsidian` 注释行形态存在——解析后即不生效（用户去掉行首注释即启用） |

## 平台映射

### 格式化侧接入（#26 注入缝的内置默认实现）

- **管线层不变**：`planAutoFormatLineModification(ctx, { protectedRanges })` 保持纯函数，保护区区间集（行内坐标 + SpaceState 三档）经参数注入；`splitLineIntoParts` 的 user 分区剪除逻辑（与 code/formula 天然保护区重叠时剪除）#26 已落。
- **接入层**：`registerAutoFormatBehavior` 的 onInput 内置计算——`userDefinedRegSwitch` 开时对当前驱动行跑 `matchProtectedRanges(line, 规则表)`；关时传空。规则表为 gate 缓存形态（`AutoFormatEngineSettings.userDefinedRegexRules`，refresh 时从 `userDefinedRegExp` 字符串解析重建，值类型失配回出厂模板）。
- **外部覆盖优先**：`deps.protectedRangesFor`（#26 注入缝）保留——传入时优先生效（种子形态字符串档经接入层映射为数字档），未传时用内置计算。
- **默认行为变化**：出厂 `userDefinedRegSwitch: true` + 出厂模板 → 保护区默认生效（#26 时期调用侧不传即无保护区；本票起设置驱动）。

### 规则侧接入（「用户规则尊重保护区」开关）

- **注入形态**：`ruleBehaviorPipeline.ts` 三管线（Input / Delete / SelectKey）的 options 加 `protectedZone?: ProtectedZoneProbe`（`isProtected(lineText, column)`），命中即返回 null（规则不触发、不占用独占组）。管线保持纯函数，设置消费全部在 intercept 层。
- **gate 探针**：`createRulePipelineGate` 扩展拉三键（`userDefinedRegSwitch` / `userDefinedRegExp` / `userRulesRespectUserDefinedRegexBlocks`），双开时 `gate.userRulesZone()` 返回探针（规则表 refresh 时解析缓存），否则 undefined；通道失败保持上次值。
- **检查列锚点**：Input 管线 = 快照光标（事务后，上游 triggerCvtRule 同态）；Delete 管线 = 事务前虚拟光标（`rebuildPreDeleteState` 的 cursor）；SelectKey 管线 = 事务前替换起点（`replaced.from`）。回退一列公式三条管线统一（`userEvent.startsWith('input')`）。
- **上游差异（扩展）**：上游仅 Input 类（triggerCvtRule）有此检查，delete.backward 分支（cm_extensions.ts:327-339）直接进引擎无保护区判定。本票按票面范围对 #9 两条管线对称补齐——三管线共用同一探针与检查列公式，规格即差异记录。

## 与上游的已知行为差异

- **注释行判定的无状态化**：上游 `regNull = /^\s*$|^\/\//g` 带 `g` 标志用于 `.test()`，跨行共享 lastIndex 产生「隔行跳过」的交替怪癖（连续多空行/注释行时第二行反而被当正则解析）。本移植取意图语义的无状态实现（每行独立判定）；出厂模板两种实现行为一致（tag 注释行都跳过），差异只在用户自写连续注释/空行时出现，且无状态版更符合注释语义。
- **零宽命中防御**：可零宽匹配的用户正则（如 `x*`）上游会死循环（exec 零宽命中 lastIndex 不前进）；本移植跳过零宽命中并手动推进游标。出厂模板无零宽形态，只在用户自写零宽正则时分歧。
- **非法正则反馈通道**：上游 Notice（Obsidian API）/ console.error → 本仓 debugLog（logging 约定，纯逻辑模块零平台依赖）。
- **wikilink/mdlink 精确识别的正则降级**（票面边界）：上游规则侧检查经 `splitTextWithLinkAndUserDefined`（链接本来就是纯正则，语义一致）；格式化侧上游 code/formula 由语法树先行摘出，本移植经 `splitLineIntoParts` 文本扫描剪除（#26 已落，语义等价记录于 auto-format.md）。**#5 语法树适配后的升级点**：`splitLineIntoParts` 的 code/formula 扫描换传语法树令牌后，保护区与天然保护区的剪除逻辑无需改动（区间减法语义不变）；规则侧探针不受影响。

## 已知边界

- 保护区逐行独立：跨行未闭合形态（如行内未闭合的 `{{`）不命中、不延伸到下一行（上游同构——splitTextWithLinkAndUserDefined 按单行文本匹配）。
- 嵌套形态取非贪婪最短闭合（`{{a{{b}}c}}` 命中首个最短闭合 `{{a{{b}}`，上游 `.*?` 语义原样）。
- `|xy` 旗标按行尾 3 字符固定切分：正则体自身以 `|` 结尾的写法（如 `a|b|-+` → 正则 `a|b`）按上游行为原样保留，不另做歧义消解。
- 多用户规则先到先得：后序规则与已落位区间重叠的命中弃用（上游 matchWithReg 语义）；同一规则的多次命中由 g 标志游标推进天然不重叠。

## 给后续票的提示

- **#28（格式化命令共用保护区）**：`matchProtectedRanges(line, rules)` 即命令侧的保护区计算入口（命令重排对每行调用后经 `formatLine(line, curCh, undefined, settings, { protectedRanges })` 传入）；规则表解析复用 `parseUserDefinedRegExp`，设置消费形态参照 autoFormatIntercept 的 gate 缓存（refresh 时重建，勿每次命令解析）。
- **#21（真实 webview 人工验证）**：本票验证点——`{{中文a}}` 内键入无空格插入、`userDefinedRegSwitch` 关后同场景恢复格式化；「用户规则尊重保护区」双开后 `{{。。}}` 内标点折叠不触发、开关关恢复；设置页改动下一次键入生效（onChanged 刷新，3s 节流窗——C-R4-2，窗口内顺延至窗口后的下一次键入）。
