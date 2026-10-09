# 规则引擎内核与内置规则（工单 #1）+ 行为链接入（工单 #25）+ Delete/SelectKey 触发接入（工单 #9）

规则引擎纯逻辑内核（三触发类建模、Input 类执行）与内置规则数据全量移植。事实源模块：`src/rules/rule-engine.ts`（内核）与 `src/rules/default-rules.ts`（数据）；测试矩阵：`test/rule-engine-core.test.ts`（机制）与 `test/rules-matrix.test.ts`（内置规则）。#25 行为链接入：`src/ruleBehaviorPipeline.ts`（onInput 触发管线）、`src/ruleBehaviorIntercept.ts`（功能族注册）、`src/ruleScopeFallback.ts`（作用域判定降级）；测试：`test/ruleBehaviorPipeline.test.ts`、`test/ruleBehaviorIntercept.test.ts`、`test/ruleScopeFallback.test.ts`。#9 Delete/SelectKey 触发接入：管线函数与族注册落在上述同两模块（`planDeleteRuleModification` / `planSelectKeyRuleModification` + `06-delete-rules` / `07-selectkey-rules` 族），页面接线在 `src/page-editor.ts` 的 #9 增量块。

## 验收口径

- 内置规则匹配矩阵单测全绿（触发 / 不触发 / 边界三档 × 全部 20 条，含捕获组引用与 flags 独立矩阵）。
- `npm run compile`（三产物构建 + `tsc --noEmit`）通过。
- 内核零平台依赖：`src/rules/` 下 import 语句扫描断言钉住（仅允许模块内相对 type 导入），禁止 `obsidian` / vsidian SDK / `vscode` / `@codemirror` / vendor 类型 / DOM。

## 上游对照

上游 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa），按内容锚点逐条对照：

| 上游锚点 | 移植落点 | 语义 |
| --- | --- | --- |
| `rule_engine.ts` 枚举 `RuleType` / `RuleTriggerMode` / `RuleScope` | 同名导出 | 字符串枚举值原样（`input`/`delete`/`selectKey` 等），兼容 #14 JSON 序列化 |
| `SimpleRule` / `ConvertRule` / `TxContext` / `ApplyResult` | 同名导出 | 字段与可选性原样 |
| `parseOptions` 旗标解析 | `RuleEngine.parseOptions` | d/s/T/r/F/a/t/f/c 语义原样 |
| `normalizeRule`（含 `new Function` 编译函数体） | 同名静态方法 | 字符串替换体形态保留（用户自定义规则的序列化载体） |
| `getCachedRegex`（左正则尾锚 `(?![\s\S])`、右正则起始匹配、编译缓存含 null 哨兵） | 私有方法 | 原样；缓存失效时机（updateRule 改 match/type/flags）原样 |
| `expandVariables`（`[[n]]` 左组回退右组、`[[Rn]]` 右组、`${SEL}`/`${KEY}`） | 私有方法 | 原样 |
| `process` 主循环（优先级升序、同优先级注册序、enabled/类型/触发模式/作用域/语言门控、首个命中返回） | 公开方法 | 原样 |
| `notifyFunctionError`（5 秒节流） | 私有方法 | 原样，上报通道见偏差 1 |
| `default_rules.ts` `DEFAULT_BUILTIN_RULES` | 同名导出 | 20 条数据逐字段原样（含 `builtin-conv-hw2fw` 默认关） |

**三处刻意偏差**（其余逐行对照，不自行 redesign）：

1. **`Notice` 剥离**：上游三处 Obsidian Notice（函数体编译失败 / 非法正则 / 运行时异常节流上报）改为构造选项 `RuleEngineOptions.reportError(ruleId, message)` 注入回调；`normalizeRule` 增加可选第二参承载同一通道。#25 宿主接入时映射到 i18n 通知。
2. **`TabstopSpec` 就地定义**：上游从 `tabstop.ts` 导入（该文件含 CM6 依赖），本模块只保留纯数据形状 `{number, from, to}`。
3. **Tabstop 语法解析延后到 #14 落地**（已随 #14 恢复）：`parseTabstops`（`$n` / `${n:default}` 形式、默认值内嵌套 `${SEL}`/`${KEY}` 展开、number 升序排序、花括号深度配平）与 `applyReplacement` 尾段（newText 去标记、`cursor` 落 `tabstops[0].from`）逐行对照上游 `rule_engine.ts` L449-509/L645-655。分组导航的执行归 #15；#1 矩阵中 `$0` 相关断言已随 #14 同步更新（字面标记 → 解析后形态）。

## 平台映射

- **作用域判定可注入**（核心设计决策）：上游 `detectRuleScope` 经 `syntaxTree` 判行类型；vsidian live 编辑器的 `experimental.cm6.language.syntaxTree` 恒为未解析空树（vsidian#406 已知边界）。内核因此不做任何语法树判定——`TxContext.scopeHint` / `scopeLanguage` 由调用方注入：#25 行为链接入时传文本正则降级版判定，#5 语法树版就绪后换传，内核零改动。
- **`TxContext` 对齐行为链驱动面**（#25 消费）：`docText` ↔ `snapshot.text`（LF 坐标，已含本次输入）、`selection` ↔ 光标区间、`changeType` ↔ `userEvent`（`input.type` / `input.type.compose` / `delete.*` 白名单；Tab 触发模式对应 `changeType: 'tab'`）、`key` ↔ SelectKey 触发键。`replaced` 字段（被替换选区）不进内核——SelectKey 的包裹目标在 #9 管线里转成 `selection` + `key` 传入。
- **`ApplyResult` 对齐行为链计划**：`matchRange` + `newText` → `changes`（`{offset, length, text}`）；`cursor` / `tabstops` → `selection`（#14 已落地 tabstop 语法解析，#15 把 tabstop 组转多光标选区）。
- **规则 JSON 持久化**（#14 消费）：`SimpleRule` 即序列化形态，`loadFromFiles` 为装载入口，`ctx.storage` 读写 `builtin-rules.json` / `user-rules.json`。

## 已知边界

- **规则计数**：票面「22 条」为计数口径偏差——上游 v6.0.9 `default_rules.ts` 实测 **20 条**（id 集与六语言包 `builtinRuleDescriptions` 键集一致，`grep -c "id: 'builtin-"` 实证）。按全量口径移植 20 条，测试矩阵同步覆盖 20 条。
- **`$0`/`$1` 占位符解析已随 #14 恢复**（#1 时暂缓的边界）：`applyReplacement` 尾段恢复上游 `parseTabstops` 语义——newText 去标记、`tabstops` 填充文档绝对坐标（`matchRange.from + 已产出文本长度`）、`cursor` 落最小编号占位符起点（无占位符时取替换区间起点 + 文本长度）。矩阵中 `$0` 相关断言已同步更新。分组导航的执行（Tab/Shift-Tab 跳转、`$0` 收尾语义）归 #15。
- **上游数据怪癖原样保留**（不擅自放宽）：`builtin-autopair-input` 触发类 `[（《「『“”‘’《]` 不含 `【`（替换表却含 `【` 的映射）；`builtin-conv-linestart` 的 `、` 分支替换体无尾随空格（`[[1]]/$0`）；`builtin-quote-convert` 连续 `>` 的归一形态为 `>> $0`（贪婪回溯后 `[[1]]` 只含首个 `>`）。
- **正则引擎差异**：未发现——内置规则用到的 lookbehind（chrome62+ / node9+）、反向引用、`\u` 范围类在 chrome114（页面产物下界）与 node18（宿主 / vitest）均一致支持。后续 #14 用户规则引入任意正则时如有差异，在测试注释记录。
- **`new Function` 执行面**：内核按上游形态保留字符串函数体经 `new Function` 编译执行；vitest/node 与 chrome114 页面均可运行，webview CSP 下的可用性随 #25 端到端实测（上游 Obsidian 同形态可行）。沙箱边界评估归 #14。
- **description 字段 i18n**：`default-rules.ts` 的中文描述为上游数据原样；展示层本地化沿用上游模式（规则 id → 语言包 `builtinRuleDescriptions` 映射），归 #16（规则管理 UI）/ #19（i18n 完整化）。

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
- **#9（Delete/SelectKey）挂接点**：`pipelineConsumesUserEvent` 只放行 `input.type` / `input.type.compose`；delete.* 事件与选区替换形态（replaced 非空）在本链返回 null。#9 已随独立管线函数接入（见下节），复用 `applyResultToPlan` 与 `detectScopeFromText`，SelectKey 的包裹目标从 `AddonInputContext.replaced` 读回后组 TxContext（`key` + `selection`）。

### 设置门控（总门核对结论）

**上游规则触发路径无全局总开关**——`settings_types.ts` 全字段核对：规则启停仅有 per-rule `enabled` + 规则管理器（`deletedBuiltinRuleIds`，归 #14 storage 族）；`tryProcessInput` 对 `triggerCvtRule` 无设置门。#3 生效面 23 键中无 `ruleTriggerEnabled` 类键，**插件侧不设总门**：整链关闭 = 平台行为管理逐族关闭（或停用组件）。管线对设置面的唯一消费是 `debug`（引擎 `ctx.debug` 日志门，`SETTINGS_TOPIC.get` 拉取 + 每次 `behaviors.onChanged` 刷新）。

### reportError 接线与函数体规则的 CSP 处置

- **通道**：引擎构造注入的 `reportError(ruleId, message)` → 页面侧适配器（全局 5 秒窗节流，`createRuleErrorReporter`）→ `RULE_ERROR_TOPIC`（`easyTyping.ruleError.notify`，常量落 `settings/store.ts` 共享区）→ 宿主 `vscode.window.showWarningMessage`，文案走字典（`ruleError.notify` 模板，`{id}`/`{message}` 占位替换）。上游三处 Obsidian Notice 的等价通道；引擎对运行时异常已按规则 5 秒节流，适配器全局窗防御装载期批量上报。
- **函数体规则（F 旗标）**：按 #1 现状执行——`new Function` 编译，失败即跳过该条并经 reportError 上报。**平台 #405 定案：附加组件页面 CSP 不放行 unsafe-eval**，真实 webview 中 6 条 Input 函数体规则（autopair×2、conv-formula、conv-linestart、hw2fw、fw2hw-double）装载期编译失败、按上述通道节流上报后整链降级为非函数规则（quote 族、conv-backtick/codeblock、quote 系照常工作）；预注册函数表收口归 #17。本票 vitest 环境无 CSP 限制，函数体规则在集成测试中全量验证。
- **#21 验证点**：真实 webview 键入 `。。`——按 CSP 现状预期**不转换**（fw2hw 为函数体规则）且出现一条节流警告；`>` 行首转换（quote 族，非函数体）预期正常。#17 落地后此边界消除。

### 已知边界（#25 增）

- **代码/公式上下文不驱动**：平台行为链门控先行排除 frontmatter、块级代码（`inCodeContext`）、表格格区与 IME 中间态——上游 20 条内置规则作用域全为 `All`（原在代码块/公式内也触发），平台侧这些情境规则不生效。平台契约「行为只作用于正文」的既定边界，不放宽。
- **作用域判定为文本降级版**（`src/ruleScopeFallback.ts`）：围栏状态机 + `$`/`$$` 配对近似（`\$` 转义、行内代码跳过、行内 `$` 不跨行）。近似边界：货币写法 `$100` 在同行光标处误判 Formula。20 条内置规则全 All 作用域，当前仅影响 #14 用户规则与 #9；#5 语法树版就绪后换传，降级版保留为无树环境后备。
- **用户自定义正则区块跳过顺延**：上游 `triggerCvtRule` 的 `UserDefinedRegSwitch × UserRulesRespectUserDefinedRegexBlocks` 跳过检查依赖 `splitTextWithLinkAndUserDefined`（core.ts ~100 行，未移植）且默认配置下不生效（`userRulesRespectUserDefinedRegexBlocks` 默认 false），归 #14 随用户规则移植。
- **`$0` 字面标记**：#1 已知边界延续——替换体占位符保留为字面文本（如 `（$0）`），#14 解析落地后恢复上游语义，届时矩阵与管线断言同步更新。
- **中英空格**：规则面零命中基线（集成测试钉住），转换本体归 #26 格式化管线消费。

## #9 Delete/SelectKey 触发接入（delete.* 联动删除 + 选区替换包裹）

剩余两类触发的执行内核接入：`planDeleteRuleModification`（Delete 类）与 `planSelectKeyRuleModification`（SelectKey 类）落在 `src/ruleBehaviorPipeline.ts`，族注册（`06-delete-rules` / `07-selectkey-rules`）与接线落在 `src/ruleBehaviorIntercept.ts` 与 `src/page-editor.ts` 的 #9 增量块。上游对照 `cm_extensions.ts` 的 delete.backward 分支（L327-369）与 Selection Replace 分支（L61-110）。

### 触发面与门控

- **Delete**：`pipelineConsumesDeleteEvent` 白名单五类 `delete.backward / forward / selection / cut / line`（与平台 `liveInstance.ts` 的 `ADDON_BEHAVIOR_DELETE_USER_EVENTS` 同集；`delete.dedent` 属缩进命令族不纳入）+ `inputText === ''`（平台契约：delete 事务净插入为空串）+ `replaced` 非空区间。
- **SelectKey**：`userEvent === 'input.type'` + `replaced` 非空（键入替换选区；`input.type.compose` 的 IME 定稿补驱动 replaced 恒 null——平台 #399 边界，compose 天然不进 SelectKey，测试钉住）。上游的 `fromB+1===toB` 单字符门（——/…… 例外）**不设**：引擎 triggerKeys 经 `parseSelectKeyRuleTriggerKeys` 逐字符解析、恒单字符，多字符键必然不中任何规则——与上游门控结果等价，少一道任意性更强的门。
- **多选区一律不进**（两管线同门）：多区间时平台 replaced 是**最小包围 + 按区间顺序拼接**（`AddonReplacedRange` 契约），事务前重建无法精确还原；且单条计划的 changes 无法忠实表达多区间替换。以「快照选区数 = 1」为代理判定（多区间删除/替换后残留多光标），返回 null 落原生。与 #25「仅处理首个选区、其余不触发」口径一致。

### 事务前重建与坐标换算（核心设计）

平台 snapshot 是**事务后**状态（已含本次输入/删除），而引擎需要上游的 startState（事务前文档 + 事务前光标）：

- **Delete 重建**：事务前文档 = `snapshot.text` 在 `replaced.from` 处拼回 `replaced.text`（单区间精确）。虚拟光标按事件映射——`backward → replaced.to`（上游 toA 同口径：左正则尾锚可命中刚删的字符）、`forward → replaced.from`（Delete 键删光标右侧的镜像）、`selection / cut / line → replaced.to`（上游只实现 backward，这三类按 backward 口径统一近似；`delete.line` 的空块场景按此口径验证）。引擎产出（matchRange/cursor/tabstops）为事务前坐标，经 `preOffsetToSnapshot`（≤from 不变、≥to 平移被删长度、区间内钳 from，单调）换算回快照坐标落计划。**换算后空操作**（length 0 且空文本——如 cut 已删尽整对）返回 null：原生删除即终态，不提交无意义计划。
- **SelectKey 重建**：事务前文档 = `snapshot.text` 把 `replaced.text` 拼回键入文本之前（`slice(0, from) + replaced.text + slice(from + inputText.length)`）。TxContext 带 `key`（inputText）+ `selection`（replaced 区间），`${SEL}` 展开读事务前选中文本。计划替换快照中键入文本占据区 `[from, from + inputText.length)`；引擎 cursor/tabstops 以 `matchRange.from`（= `replaced.from`）为基点、与计划基点一致——**直接透传，无需换算**（推导：newText 落计划后占据 `[from, from + newText.length)`，引擎坐标 = from + 产出内偏移）。

### Input 管线的 replaced 门（#25 行为修正）

Input 管线（`planInputRuleWithTabstops`）新增 `replaced !== null → return null`：上游输入路径要求 `changedStr.length < 1`（updateListener 门，cm_extensions.ts L547-549），选区替换事务只由 transactionFilter 的 SelectKey 分支处理，命中与否都不再落入 Input 规则。#25 只复刻了 notSelected 条件（快照塌缩光标）、漏了 changedStr 条件——选区替换后快照光标同样塌缩，autopair 类会基于残缺上下文命中并占用独占组，既堵住 SelectKey 又丢失被替换内容。本门为该缺口的管线层修正，#25 五族注册的 onInput 适配器相应透传 `ctx.replaced`（族定义与链序零改动）。

### 族设计与独占组结论

- **两族**：`06-delete-rules`（autopair-delete 10 + 五条 del-* 30，同管联动删除）与 `07-selectkey-rules`（四条 sel-wrap-* 40，同管选中包裹）。分族依据同 #25 三条（开关粒度 / 触发域 / 链序保真——localId 数值前缀延续上游优先级分层编码：30 < 40 排在 01-05 之后）。
- **独占组：与 #25 五族共用 `input-rules`**。核对平台语义（vsidian `webview/addonBehaviors.ts` driveInput）：按有效序逐行为调用，**返回 null 不占用组**、首个返回计划者占用组、其后同组跳过。三类触发面互斥（Input 族对 delete.* 走 userEvent 门返回 null、对选区替换走 replaced 门返回 null；Delete/SelectKey 族对纯插入与 compose 返回 null）——同组在结构上保住「一条输入至多一条规则生效」的上游全局首命中语义，且不会出现「Delete 事务被 Input 首命中堵住」（Input 族对 delete.* 恒 null）。若拆独立组则该不变量只剩各管线自觉门控，无平台层保障——故取同组。
- **撤销**：Delete/SelectKey 规则同为用户输入直接触发的单发修饰，无同链前序 SDK 原子修饰可并组——延续 #25 全量核对结论，一律 `atomic`（联动删除与选中包裹各自成独立撤回步）。撤销单步还原的验收由注册声明（测试断言 `history: 'atomic'`）+ #21 真实撤销验证承载（真实撤销管线归平台）。
- **tabstop 暂存**：SelectKey 包裹计划携带 `${0:${SEL}}` 的 `$0` 组（覆盖选中文本）。#9 注册函数返回独立暂存槽与 `consumePendingTabstops`（与 #25 槽互不干扰——独占组保证一次输入至多一族命中），page-editor 以独立 docChanged 监听消费、喂 `tabstopNav.activateTabstops`（读即消费，同 #15×#25 口径）。

### 已知边界（#9 增）

- **多区间近似**：快照选区数 = 1 是「单一删除/替换区间」的代理判定——理论上单光标事务也可含多变更区间（CM6 命令罕见形态），此时重建不精确。可观测面内无更可靠信号，接受该近似。
- **`delete.selection / cut / line` 光标近似**：虚拟光标统一取区间右端（backward 口径）；上游未实现这三类，无法对照。联动删除规则面向「删空对的一端」场景，选区/整行删除下命中与否均由引擎左右正则自然裁定。
- **IME 定稿不适用 SelectKey**：平台对 compose 补驱动 replaced 恒 null（组合事务先于 compositionend，替换侧无法归因）——组合输入选中文本的包裹不可达，属平台边界，非本插件可修。
- **CSP 函数体规则边界延续**：#25 的 #405 处置对 #9 同样适用——`autopair-delete` 与三条 sel-wrap 函数体规则（sF 旗标）在真实 webview 装载期编译失败降级；vitest 环境全量验证（本票矩阵即此形态）。`builtin-sel-wrap-backtick`（'s' 旗标，字符串替换体）不受影响——真实页面选中包裹仅 `·` 键可用，#17 预注册函数表落地后消除。#21 按此口径核对。
