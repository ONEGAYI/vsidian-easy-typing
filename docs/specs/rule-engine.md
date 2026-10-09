# 规则引擎内核与内置规则（工单 #1）+ 行为链接入（工单 #25）+ 函数替换体预注册（工单 #17）

规则引擎纯逻辑内核（三触发类建模、Input 类执行）与内置规则数据全量移植。事实源模块：`src/rules/rule-engine.ts`（内核）、`src/rules/default-rules.ts`（数据）与 `src/rules/function-table.ts`（#17 预注册函数表）；测试矩阵：`test/rule-engine-core.test.ts`（机制）、`test/rules-matrix.test.ts`（内置规则）与 `test/function-table.test.ts`（函数表）。#25 行为链接入：`src/ruleBehaviorPipeline.ts`（onInput 触发管线）、`src/ruleBehaviorIntercept.ts`（功能族注册）、`src/ruleScopeFallback.ts`（作用域判定降级）；测试：`test/ruleBehaviorPipeline.test.ts`、`test/ruleBehaviorIntercept.test.ts`、`test/ruleScopeFallback.test.ts`。

## 验收口径

- 内置规则匹配矩阵单测全绿（触发 / 不触发 / 边界三档 × 全部 20 条，含捕获组引用与 flags 独立矩阵）。
- 函数替换体端到端（#17）：引用形态装载 → 查表注入 → `process` 命中（含捕获组消费：函数表函数消费 leftMatches/rightMatches/selectionText/key 参数矩阵）；未知 ref / 签名失配 / 遗留字符串函数体拒绝装载并上报。
- `npm run compile`（三产物构建 + `tsc --noEmit`）通过。
- 内核零平台依赖：`src/rules/` 下 import 语句扫描断言钉住（仅允许模块内相对 type 导入），禁止 `obsidian` / vsidian SDK / `vscode` / `@codemirror` / vendor 类型 / DOM。
- 动态代码禁令（#17）：src 下禁 `new Function` / `eval` 调用（scaffold 契约扫描钉住，注释行豁免）。

## 上游对照

上游 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa），按内容锚点逐条对照：

| 上游锚点 | 移植落点 | 语义 |
| --- | --- | --- |
| `rule_engine.ts` 枚举 `RuleType` / `RuleTriggerMode` / `RuleScope` | 同名导出 | 字符串枚举值原样（`input`/`delete`/`selectKey` 等），兼容 #14 JSON 序列化 |
| `SimpleRule` / `ConvertRule` / `TxContext` / `ApplyResult` | 同名导出 | 字段与可选性原样；replacement 的函数体字符串形态改为引用对象（偏差 3） |
| `parseOptions` 旗标解析 | `RuleEngine.parseOptions` | d/s/T/r/F/a/t/f/c 语义原样 |
| `normalizeRule`（含 `new Function` 编译函数体） | 同名静态方法 | 匹配面归一原样；函数替换体改为查表注入（偏差 3，`resolveFunctionReplacement`） |
| `getCachedRegex`（左正则尾锚 `(?![\s\S])`、右正则起始匹配、编译缓存含 null 哨兵） | 私有方法 | 原样；缓存失效时机（updateRule 改 match/type/flags）原样 |
| `expandVariables`（`[[n]]` 左组回退右组、`[[Rn]]` 右组、`${SEL}`/`${KEY}`） | 私有方法 | 原样 |
| `process` 主循环（优先级升序、同优先级注册序、enabled/类型/触发模式/作用域/语言门控、首个命中返回） | 公开方法 | 原样 |
| `notifyFunctionError`（5 秒节流） | 私有方法 | 原样，上报通道见偏差 1 |
| `default_rules.ts` `DEFAULT_BUILTIN_RULES` | 同名导出 | 20 条数据逐字段原样（含 `builtin-conv-hw2fw` 默认关）；10 条 F 旗标规则的替换体改为引用形态（偏差 3） |

**四处刻意偏差**（其余逐行对照，不自行 redesign）：

1. **`Notice` 剥离**：上游三处 Obsidian Notice（替换函数解析失败 / 非法正则 / 运行时异常节流上报）改为构造选项 `RuleEngineOptions.reportError(ruleId, message)` 注入回调；`normalizeRule` 增加可选参数承载同一通道。#25 宿主接入时映射到 i18n 通知。
2. **`TabstopSpec` 就地定义**：上游从 `tabstop.ts` 导入（该文件含 CM6 依赖），本模块只保留纯数据形状 `{number, from, to}`。
3. **函数替换体预注册化**（#17，vsidian#405 平台定案）：上游把 F 旗标规则的函数体字符串经 `new Function` 动态编译；本内核删除该路径——附加组件页面 CSP 不放行 unsafe-eval，动态构造必被拦截。`SimpleRule.replacement` 扩展引用对象 `{kind:'function', ref}`，装载时查 `src/rules/function-table.ts` 注入真函数；未知 ref / 签名与规则类型不符 / 遗留字符串函数体 / 引用对象缺 F 旗标一律拒绝装载并 reportError（死替换体兜底）。用户自定义函数体由「规则组件化 fork」承接（ADR-0002）；`RuleEngineOptions.functionTable` 为测试注入面。
4. **Tabstop 语法解析延后到 #14 落地**（已随 #14 恢复）：`parseTabstops`（`$n` / `${n:default}` 形式、默认值内嵌套 `${SEL}`/`${KEY}` 展开、number 升序排序、花括号深度配平）与 `applyReplacement` 尾段（newText 去标记、`cursor` 落 `tabstops[0].from`）逐行对照上游 `rule_engine.ts` L449-509/L645-655。分组导航的执行归 #15；#1 矩阵中 `$0` 相关断言已随 #14 同步更新（字面标记 → 解析后形态）。

## 函数替换体预注册（#17）

决策与备选评估见 [ADR-0002](../adr/0002-function-replacement-preregistered-table.md)；本节为实施形状与规则语法基础（#19 专题文档的扩展锚点）。

### 数据形态

- **字符串字面量**（无 F 旗标）：`replacement: '文本 [[1]] $0'`——模板语义，经 expandVariables（`[[n]]`/`[[Rn]]`/`${SEL}`/`${KEY}`）与 parseTabstops（`$n`/`${n:default}`）后处理，与上游一致。
- **函数引用**（F 旗标配对）：`replacement: {kind:'function', ref:'convFormula'}`，`options` 含 `F`——函数本体是函数表内的真函数（不随规则 JSON 存储与编辑）。上游函数体字符串形态不再是合法装载形态（装载期拒绝 + 通知）。
- **签名配对**：Input/Delete 类规则引用 `text` 签名函数（参数 `leftMatches: string[]` / `rightMatches: string[]`）；SelectKey 类引用 `selectKey` 签名（参数 `selectionText: string` / `key: string`）。函数返回字符串或 `undefined`（跳过本次匹配）；返回串进入与字面量相同的后处理链。

### 内置函数表（ref ↔ 上游规则映射）

| ref | 签名 | 上游规则 id | 语义 |
| --- | --- | --- | --- |
| `autopairInput` | text | builtin-autopair-input | 键入全角开符号补全配对（$0 落配对间） |
| `autopairJump` | text | builtin-autopair-jump | 右侧恰为配对端时吃掉重复右符 |
| `autopairDelete` | text | builtin-autopair-delete | 删除开符号且右侧为配对端 → 连带删除 |
| `convFormula` | text | builtin-conv-formula | ￥/$ 组合转行内或块级公式 |
| `convHw2fw` | text | builtin-conv-hw2fw | CJK 后半角标点转全角（默认关） |
| `convLinestart` | text | builtin-conv-linestart | 行首 》 转引用、行首 、 转斜杠 |
| `fw2hwDouble` | text | builtin-fw2hw-double | 连续两个相同全角标点转半角 |
| `selWrapCjkBrackets` | selectKey | builtin-sel-wrap-cjk-brackets | 选中后键入《（配对括号包裹 |
| `selWrapQuotes` | selectKey | builtin-sel-wrap-quotes | 选中后键入全角引号配对包裹 |
| `selWrapSymbols` | selectKey | builtin-sel-wrap-symbols | 选中后键入【¥￥包裹 []/$$ |

函数语义与上游函数体逐条对照（参数签名、捕获组消费、返回串标记、undefined 跳过）；仅两处无害收紧：上游对映射表缺键直接下标触发 TypeError 走运行时异常路径，本表显式返回 undefined（触发正则保证键在场，实际不可达）。

### 自定义函数路径（组件化 fork）

需要函数表之外的自定义变换函数时：fork 本组件（或做成小组件 VSIX）→ 把真函数加入 `src/rules/function-table.ts` 并登记 ref（保持 ref 唯一、签名与消费规则类型配对）→ 规则 JSON 按 ref 引用。函数经同一构建桥打包在场，天然满足 CSP。规则管理 UI 的函数提示文案即此引导。

## 平台映射

- **作用域判定可注入**（核心设计决策）：上游 `detectRuleScope` 经 `syntaxTree` 判行类型；vsidian live 编辑器的 `experimental.cm6.language.syntaxTree` 恒为未解析空树（vsidian#406 已知边界）。内核因此不做任何语法树判定——`TxContext.scopeHint` / `scopeLanguage` 由调用方注入：#25 行为链接入时传文本正则降级版判定，#5 语法树版就绪后换传，内核零改动。
- **`TxContext` 对齐行为链驱动面**（#25 消费）：`docText` ↔ `snapshot.text`（LF 坐标，已含本次输入）、`selection` ↔ 光标区间、`changeType` ↔ `userEvent`（`input.type` / `input.type.compose` / `delete.*` 白名单；Tab 触发模式对应 `changeType: 'tab'`）、`key` ↔ SelectKey 触发键。`replaced` 字段（被替换选区）不进内核——SelectKey 的包裹目标在 #9 管线里转成 `selection` + `key` 传入。
- **`ApplyResult` 对齐行为链计划**：`matchRange` + `newText` → `changes`（`{offset, length, text}`）；`cursor` / `tabstops` → `selection`（#14 已落地 tabstop 语法解析，#15 把 tabstop 组转多光标选区）。
- **规则 JSON 持久化**（#14 消费）：`SimpleRule` 即序列化形态，`loadFromFiles` 为装载入口，`ctx.storage` 读写 `builtin-rules.json` / `user-rules.json`。函数引用对象随 JSON 序列化（`sanitizeSimpleRule` 收口见 [rules-storage.md](rules-storage.md)）。

## 已知边界

- **规则计数**：票面「22 条」为计数口径偏差——上游 v6.0.9 `default_rules.ts` 实测 **20 条**（id 集与六语言包 `builtinRuleDescriptions` 键集一致，`grep -c "id: 'builtin-"` 实证）。按全量口径移植 20 条，测试矩阵同步覆盖 20 条。
- **`$0`/`$1` 占位符解析已随 #14 恢复**（#1 时暂缓的边界）：`applyReplacement` 尾段恢复上游 `parseTabstops` 语义——newText 去标记、`tabstops` 填充文档绝对坐标（`matchRange.from + 已产出文本长度`）、`cursor` 落最小编号占位符起点（无占位符时取替换区间起点 + 文本长度）。矩阵中 `$0` 相关断言已同步更新。分组导航的执行（Tab/Shift-Tab 跳转、`$0` 收尾语义）归 #15。
- **上游数据怪癖原样保留**（不擅自放宽）：`builtin-autopair-input` 触发类 `[（《「『“”‘’《]` 不含 `【`（替换表却含 `【` 的映射）；`builtin-conv-linestart` 的 `、` 分支替换体无尾随空格（`[[1]]/$0`）；`builtin-quote-convert` 连续 `>` 的归一形态为 `>> $0`（贪婪回溯后 `[[1]]` 只含首个 `>`）。
- **正则引擎差异**：未发现——内置规则用到的 lookbehind（chrome62+ / node9+）、反向引用、`\u` 范围类在 chrome114（页面产物下界）与 node18（宿主 / vitest）均一致支持。后续 #14 用户规则引入任意正则时如有差异，在测试注释记录。
- **函数替换体不再有动态代码路径**（#17 落地，取代 #1 时代的 `new Function` 边界）：预注册表是函数替换体的唯一装载形态，vitest 与真实 webview 行为一致（都是查表注入，无环境分支）。#25 报告的「6 条 Input 函数体规则 CSP 静默降级」场景已根治；动态代码禁令由 scaffold 扫描钉住（src 禁 `new Function`/`eval` 调用）。遗留字符串函数体（F 旗标 + 字符串，#17 前序列化数据或上游导入）装载期拒绝并通知，存储侧原样保留（数据不丢）。
- **description 字段 i18n**：`default-rules.ts` 的中文描述为上游数据原样；展示层本地化沿用上游模式（规则 id → 语言包 `builtinRuleDescriptions` 映射），归 #19（i18n 完整化）。

## #25 行为链接入（onInput 驱动规则引擎）

「执行面无需补 API」结论的落地层：`behaviors.onInput` 拿 `inputText` + 快照 → #1 内核匹配（Input 类）→ `{changes, selection}` 计划，提交与撤销记账全部走平台管线。

### 行为族注册粒度（分族依据与默认链序）

上游 10 条 Input 类规则合并为 **5 个功能族**注册（`src/ruleBehaviorIntercept.ts` 的 `RULE_FAMILY_SEEDS`）：

| localId（默认链序） | 族 | 规则（上游优先级） |
| --- | --- | --- |
| `01-punct-collapse` | 全角标点连击转半角 | `builtin-fw2hw-double`（3） |
| `02-autopair` | 括号引号自动配对 | `builtin-autopair-jump`（5）、`builtin-autopair-input`（10） |
| `03-symbol-convert` | 符号组合转换 | `builtin-conv-backtick`、`builtin-conv-codeblock`、`builtin-conv-formula`、`builtin-conv-linestart`（均 10） |
| `04-punct-expand` | CJK 后半角转全角 | `builtin-conv-hw2fw`（15，数据态默认关） |
| `05-quote` | 引用标记转换 | `builtin-quote-convert`、`builtin-quote-space`（均 50） |

**分族依据**：其一，**开关粒度**——平台行为冲突管理以行为为粒度逐项开关与调序，族即「内置规则逐条开关」的插件侧承载形态（票面约定：插件侧不另建规则开关）；其二，**触发域**——同族规则服务同一输入域（如 autopair 族同管配对补全与跳过），族内次序由引擎优先级排序保证；其三，**链序保真**——localId 数值前缀按上游优先级分层编码，平台默认有效序（完整键字典序）逐层复刻上游 Input 规则的全局优先级序（3 < 5,10 < 10 < 15 < 50，契约测试钉住单调性）。01/04 拆为两族而非合并为一个「标点转换」族，原因是 hw2fw(15) 在上游序中位于 conv(10) 之后、fw2hw(3) 之前，单一族位无法同时保真两层，且两者默认态相反（一开一关）。

**跨族首命中语义**：上游 `process` 单次调用即全局首命中；平台行为链是「按有效序每行为各试、计划逐个提交」。五族共用独占组 `input-rules` 承载首命中语义——平台按有效序首个**返回计划**者占用组、其后同组跳过（vsidian addonBehaviors runtime 语义），等价于「一条输入至多一条规则生效」。计划提交被拒（stale-snapshot 等）不释放组占用：该输入无后备规则，与上游命中即派发的单发语义一致（罕见路径偏差）。

### 撤销边界核对（joinPrevious 适用性，20 条全量）

**结论：20 条内置规则一律 `atomic`，无一适用 `joinPrevious`。**判定依据（平台源码核实）：

- 并组目标须为**同链前序 SDK 原子修饰**：webview 侧 SDK 修饰事务不并入用户输入段（「不同撤回单位」），宿主协调器 `gateSubmit` 要求撤销栈顶为附加组件条目——**用户键入是外来条目，永不可并组**（vsidian `addonHistoryCoordinator.ts` + T07 浏览器实测：joinPrevious 并入的是同链 dash-fill 原子修饰，键入本身单独成撤回步）。
- 本链首命中即止（独占组）：任何规则命中时，同链内不存在前序 SDK 原子修饰——声明 joinPrevious 必然被 `history-boundary` 拒绝且**计划被丢弃**（功能性失败，非仅撤回粒度差异）。
- 逐条核对表：10 条 Input 规则均直接由用户键入触发（无前序修饰）；6 条 Delete 与 4 条 SelectKey 规则同为单发直接修饰（#9 接入时同口径，届时若有链式多修饰设计再核对）。

**与上游撤回体验的固有差异**：上游依赖 CM6 时间窗分组，键入 `（` + 自动补全 `（）` 一次 Ctrl+Z 整体回退；平台模型下为两步（先撤修饰、再撤键入）。此为平台撤销管线结构性边界，非本票可修复项，#21 人工验证时按两步口径核对。

### 多选区语义（票面 open question 的规格化结论）

- **平台侧**（vsidian `liveInstance.applyAddonEdit` 核实）：计划 `selection` 以 `EditorSelection.single` 应用——**坍缩全部光标为单一选区**；不携带 `selection` 则既有选区经变更映射保留。
- **快照限制**：`AddonEditorSnapshot.selections` 不携带主选区标记（mainIndex），管线取**首个（最左）选区**处理；上游取 `asSingle().main`——单光标（主流形态）两者一致，多光标下处理位置可能不同。
- **管线结论**（`planInputRuleModification`，与上游 dispatch 单选区行为等价）：仅处理首个选区；其余选区不触发规则；首个选区命中 → 计划携带单一 `selection`（其余光标坍缩）；不命中 → 返回 null（多光标原样保留）。首个选区非塌缩（选区替换形态）不处理（上游 `notSelected` 同口径，包裹类归 #9 SelectKey）。
- **#21 验证点**：真实 webview 多光标键入 `。`（两个光标各击一次全角句号），核对仅一处转换 + 光标坍缩；以及单光标场景的坍缩无感知。

### compose 事务与 #6/#26 挂接面

- **本票直接消费**：`userEvent='input.type.compose'`（IME 定稿，#399）与 `input.type` 同路径进管线（引擎对两者不区分——`changeType` 仅用于 Tab 触发模式判定）。上游对 compose 定稿与普通输入同样共用 `tryProcessInput`。
- **#6（compose 去重）挂接点**：`userEvent` 原样保留在管线入口（`RuleInputPipelineContext`），管线为纯函数（无跨调用状态）——#6 可在管线外层包裹去重判定，零侵入。
- **#26（格式化管线）挂接点**：中英空格等自动格式化归上游 `Formater`（非规则引擎），本票集成测试钉住「中文后键入半角字母规则面零命中」基线；#26 经同一 `RuleInputPipelineContext` 形状另注册行为族消费，管线入口不改。
- **#9（Delete/SelectKey）挂接点**：`pipelineConsumesUserEvent` 只放行 `input.type` / `input.type.compose`；delete.* 事件本链返回 null。#9 复用 `applyResultToPlan` 与 `detectScopeFromText`，SelectKey 的包裹目标从 `AddonInputContext.replaced` 读回后组 TxContext（`key` + `selection`）。

### 设置门控（总门核对结论）

**上游规则触发路径无全局总开关**——`settings_types.ts` 全字段核对：规则启停仅有 per-rule `enabled` + 规则管理器（`deletedBuiltinRuleIds`，归 #14 storage 族）；`tryProcessInput` 对 `triggerCvtRule` 无设置门。#3 生效面 23 键中无 `ruleTriggerEnabled` 类键，**插件侧不设总门**：整链关闭 = 平台行为管理逐族关闭（或停用组件）。管线对设置面的唯一消费是 `debug`（引擎 `ctx.debug` 日志门，`SETTINGS_TOPIC.get` 拉取 + 每次 `behaviors.onChanged` 刷新）。

### reportError 接线与函数替换体规则的装载处置（#17 更新）

- **通道**：引擎构造注入的 `reportError(ruleId, message)` → 页面侧适配器（全局 5 秒窗节流，`createRuleErrorReporter`）→ `RULE_ERROR_TOPIC`（`easyTyping.ruleError.notify`，常量落 `settings/store.ts` 共享区）→ 宿主 `vscode.window.showWarningMessage`，文案走字典（`ruleError.notify` 模板，`{id}`/`{message}` 占位替换）。上游三处 Obsidian Notice 的等价通道；引擎对运行时异常已按规则 5 秒节流，适配器全局窗防御装载期批量上报。
- **函数替换体规则（F 旗标，#17 起预注册形态）**：内置 10 条函数规则经函数表装载，真实 webview 与 vitest 行为一致。装载期触发上报的形态：未知 ref（含 fork 表外数据）、签名与规则类型失配、遗留字符串函数体（#17 前序列化数据或上游规则 JSON 导入）、引用对象缺 F 旗标——均为死替换体兜底（该条不命中）+ 一次性上报，同批其他规则不受影响。#25 时代「CSP 下 6 条 Input 函数体规则编译失败静默降级」的场景已随 `new Function` 路径删除根治（决策见 ADR-0002）。
- **#21 验证点（#17 后更新）**：真实 webview 键入 `。。` → 预期转换 `.`（fw2hw 经函数表工作，不再有 CSP 降级）；`>` 行首转换照常。另可导入一条 `{"trigger":"x","replacement":"return 1;","options":"F"}` 形态的遗留规则，核对装载期警告通知与该条不命中。

### 已知边界（#25 增）

- **代码/公式上下文不驱动**：平台行为链门控先行排除 frontmatter、块级代码（`inCodeContext`）、表格格区与 IME 中间态——上游 20 条内置规则作用域全为 `All`（原在代码块/公式内也触发），平台侧这些情境规则不生效。平台契约「行为只作用于正文」的既定边界，不放宽。
- **作用域判定为文本降级版**（`src/ruleScopeFallback.ts`）：围栏状态机 + `$`/`$$` 配对近似（`\$` 转义、行内代码跳过、行内 `$` 不跨行）。近似边界：货币写法 `$100` 在同行光标处误判 Formula。20 条内置规则全 All 作用域，当前仅影响 #14 用户规则与 #9；#5 语法树版就绪后换传，降级版保留为无树环境后备。
- **用户自定义正则区块跳过顺延**：上游 `triggerCvtRule` 的 `UserDefinedRegSwitch × UserRulesRespectUserDefinedRegexBlocks` 跳过检查依赖 `splitTextWithLinkAndUserDefined`（core.ts ~100 行，未移植）且默认配置下不生效（`userRulesRespectUserDefinedRegexBlocks` 默认 false），归 #14 随用户规则移植。
- **`$0` 字面标记**：#1 已知边界延续——替换体占位符保留为字面文本（如 `（$0）`），#14 解析落地后恢复上游语义，届时矩阵与管线断言同步更新。
- **中英空格**：规则面零命中基线（集成测试钉住），转换本体归 #26 格式化管线消费。
