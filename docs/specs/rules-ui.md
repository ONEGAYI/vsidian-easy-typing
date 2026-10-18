# 规则管理 UI——自定义设置页自绘（工单 #16）

上游 5-Tab 设置页的规则域（`easy_typing_settings_tab.ts` 的内置/自定义规则两 Tab + `rule_edit_modal.ts` 编辑 Modal，合计约 1700 行 UI）移植为 Vsidian 平台自定义设置页自绘；#55 起整个设置页升为五 Tab 结构，本页四分区作为 hosts 挂入对应 Tab 的 panel（装配见 [settings-tabs.md](settings-tabs.md)）。事实源模块：`src/rulesUi.ts`（视图层）、`src/rules/rules-ui-model.ts`（表单纯逻辑）、`src/rules/rules-settings-client.ts`（数据客户端）、`src/settingsTabsUi.ts`（五 Tab 页装配，规则分区 hosts 挂入）、`src/page-settings.ts`（入口装配）、`src/settings.css`（scoped 样式）；测试矩阵：`test/rules-ui-model.test.ts`（纯逻辑 36 例，#17 增函数面）、`test/rules-settings-client.test.ts`（数据客户端）、`test/rules-ui.test.ts`（jsdom 端到端 15 例，#17 增函数引用选择三例）。

## 范围与模块结构

| 上游锚点 | 移植落点 | 语义与偏差 |
| --- | --- | --- |
| 设置页 Tab3「内置规则」+ Tab4「自定义规则」 | `renderBuiltinSection` / `renderUserSection` | 分组展示形态一致；上游 5-Tab 导航自 #55 起整体移植——本页两分区经 hosts 挂入五 Tab 自绘设置页的「内置规则 / 自定义规则」panel（归属表与页面结构见 [settings-tabs.md](settings-tabs.md)），其余设置域同页承载 |
| `RuleEditModal`（611 行） | `buildFormDom` + `refreshFormVisibility` + `src/rules/rules-ui-model.ts` | 表单字段、pill/chip 交互、可见性联动（SelectKey 隐藏正则与右匹配、Code 作用域点亮语言行）逐项对照；Modal 换为 mountRoot 内自绘浮层（backdrop + dialog） |
| `buildRuleItem` | `buildUserRuleItem` / `buildBuiltinRuleItem` | 类型/作用域/函数标签、预览行（description 优先，否则 `触发 → 替换`；函数引用显示 `fn:<ref>`，遗留字符串函数体原样展示）逐项对照 |
| 拖拽排序（settings_tab drag 族事件） | `attachDragHandlers` + `computeDropIndex` | 事件链与上/下半区判定移植；索引换算抽为纯函数矩阵钉住；落点后不做上游的 DOM 手工搬移——写后刷新全量重渲染（语义等价，列表规模小） |
| 列表头「新增/上移/下移」按钮排（#48） | 头部 ↑/↓ 按钮 + 行选中态 | 上游点选列表条目 + 头部按钮移动的交互形态移植：点击行主体选中（`selectedUserRuleId` 跨渲染保持），同一 `reorderUserRule` 通道做相邻交换；首行禁用上移、末行禁用下移，选中 id 失效自愈回禁用；移动后选中行滚入视野 |
| 导入导出（export/import 按钮） | `triggerExport` / `triggerImport` | Blob 下载与隐藏 file input 形态一致，导出文件名保留上游 `easy-typing-user-rules.json`（数据跨生态兼容）；解析与去重在宿主单写点（#14 语义），页面仅形状级预检（非 JSON/非数组本地即拒） |
| `tokenizeJS` + CM6 函数体编辑器 | `tokenizeJs` + `renderHighlightedCode` | 设置页无 cm6 共享运行时（experimental.cm6 仅编辑器页），**降级为只读高亮 pre**（票面允许）；JS 语法高亮词法器原样移植。#17 起只读块展示的是选中函数表条目的函数源码（`fn.toString()`），非可编辑函数体 |
| `getRuleScopeBadges` / `getRuleTypeLabel` | `buildTagRow` / `typeMeta` | 标签语义一致（`<lang>` 代码域、`ƒx` 公式域），文案走 i18n |

**分层纪律**：数据面全经 `RulesSettingsClient`（通道载荷钉住在 `test/rules-settings-client.test.ts`），视图层零 SDK 依赖（`doc`/计时器可注入），表单换算与试运行是 `src/rules/` 纯函数——三层各自可测。

## 状态刷新策略（落档决策）

**写后刷新**：每次 mutate 成功（含导入）→ 客户端立即整拉 `get` 快照 → `onStateChange` → 视图全量重渲染；业务拒绝不刷新（状态行报错）。不挂 revision 轮询，理由：

- 设置页面板隐藏即销毁（平台装载器语义，`sdk.onDispose` 闭环），页面存活期内的变更全部经本页客户端——写后刷新即完备；
- 外部同步工具改写文件的可见性由「重开页面装载」覆盖（`test/rules-ui.test.ts` 重开回显组钉住）；打开的编辑器页另有 #14 的 revision 轮询自动重载引擎，两条链路互不依赖。

## 边界（钉住，后续票不得顺手改）

1. **内置规则逐条开关在本页（#50 回归组件自管，2026-10-13 产品决策）**：条目 checkbox 开关即组件层启停——关 = `deleteBuiltinRule`（移出规则表 + `deletedBuiltinRuleIds` 记账，ADR-0016 点名的组件层载体）、开 = `restoreBuiltinRule`（已停用条目）或 `toggleRuleEnabled`（在场但 `enabled=false` 的存量态）；「已停用的内置规则」折叠区条目同款开关（打开即恢复）。与宿主「行为管理」是**两层独立口径（ADR-0016）**：宿主层（组件停用/单项禁用，经 `sdk.behaviorState` 只读面）与本页开关独立存储、AND 合并生效——宿主层任一为真的条目呈灰态 + tooltip（`hostDisabled.behaviorDisabledTooltip` / `addonDisabledTooltip` 区分「已在插件行为管理中被禁用」与「组件已停用」）；灰态条目的本页开关仍可操作。灰态判定 = 规则覆盖的**全部**行为族被禁（`coveringBehaviorLocalIds`，单一事实源 `src/rules/rule-family-ids.ts`：内置规则按族种子 ruleIds 查表、用户规则按触发类归族——Input 类用户规则并入五个 Input 族，五族全禁才灰）；`onEnabledChange` 落库推送即时重渲染；面缺席（旧平台）不灰显。页头引导文案换两层口径说明（`layerHint`）。内置规则**不可编辑**（上游 gear 按钮不移植——上游 `updateBuiltinRule` 通道能力保留但无 UI 消费面）。
2. **函数替换体 = 预注册函数引用选择**（#17 解锁，取代 #16 时代的只读锁）：表单「函数式替换」chip 打开后替换面为 ref 下拉（按规则类型过滤签名组，Input/Delete ↔ text、SelectKey ↔ selectKey）+ 函数源码只读块 + 签名参数提示与 fork 引导文案（`functionReadonlyHint`，指向 ADR-0003）；**不含函数体编辑**——函数本体在组件代码的函数表，自定义走组件化 fork。规则类型切换时签名失配的 ref 自动改选该类型首个可用函数；保存校验（`validateRuleForm`）拒绝空 ref 与失配 ref。既有引用规则编辑保存引用原样；遗留字符串函数体规则（#17 前数据）打开表单时 functionRef 为空，须改选预注册函数后方可保存。
3. **试运行语义**：单规则独立引擎，Input 类按光标位模拟输入、Delete 类按 kind=Delete 匹配、SelectKey 类取选区文本 + 首触发键模拟按键（`testSingleRule`）；空触发式视为未命中（引擎对空 trigger 会空匹配，表单未完成时如实显示 miss）。Tab 触发模式规则在常规模拟下不命中（上游 changeType 语义）。
4. **自绘样式边界**：全部类名 `vsidian-easy-typing-` 前缀，配色复用 webview 基线 `--vscode-*` 主题变量（带回退值，不新增平台级样式契约）；`src/settings.css` 构建拷贝 `dist/settings.css`，`extension.ts` `registerPage({ entry, css })` 登记。
5. **列表项触发方式标签为静态展示**（上游点击可切换 Auto/Tab）：切换经编辑表单的触发方式 pill 完成——少一条列表内写路径，`updateRuleTriggerMode` 通道能力同样保留无 UI 消费面。

## 上游简化清单（有意为之，非遗漏）

- ~~5-Tab 导航与设置域其他 Tab（编辑增强/自动格式化/其他）不进本页~~ **已解除（#55）**：上游 5-Tab 导航整体移植——24 项设置行与规则四分区同挂一个五 Tab 自绘设置页（[settings-tabs.md](settings-tabs.md)），设置定义保持声明注册（平台基础表单降为次级页签，映射表见 [settings-mapping.md](settings-mapping.md)）。
- 上游 `FolderSuggest`（规则存储路径建议）无对应概念（#3 已剔除 `rulesStoragePath`），本页展示 `storageUri` 只读提示代替。
- 拖拽落点后上游做 DOM 手工搬移优化，本页写后刷新全量重渲染。

## 验收口径（票面映射）

- **规则全生命周期（建/改/排/启停/导入导出/重置）端到端**：`test/rules-ui.test.ts` 以真实 `HostRulesService` + mock storage 装配全链路承载——每个 DOM 动作经通道进宿主单写点落盘，断言文件侧终态与视图侧同步。
- **设置页重开回显**：dispose → 重新挂载断言全部变更（新建/启停/停用）从宿主存储读回。
- `npm run compile`（三产物构建 + `tsc --noEmit`）通过；全部测试绿（510 基线 + 57 新增 = 567，不回归）。
- **真实观感与人工交互归 #21**：真实 IME 输入表单、物理鼠标拖拽、浮层滚动与主题观感。

## 已知边界

- jsdom 冒烟用 `Event` 模拟拖拽（jsdom 无 DataTransfer）；dataTransfer 空挂在源码侧防御（`if (e.dataTransfer)`），换算逻辑由纯函数矩阵钉住。
- 状态行 6s 自动清除经计时器注入（测试常显）；跨分组动作共用一条状态行（后写覆盖先写）。
- 上游 locale 的 `builtinRuleDescriptions`（按规则 id 的内置描述本地化）已随 #19 移植：两语言字典各带 20 条 id 映射，列表预览经 `previewRuleText(rule, m.builtinRuleDescriptions)` 查表优先（上游 settings_tab 同语义）；数据态 description 保持 #1 中文原样，不随语言改写存储。映射完整性（DEFAULT_BUILTIN_RULES id 全覆盖 + 无孤儿键）由 `test/i18n.test.ts` 钉住。

## 已知边界（#48–#50 增补）

- **宿主禁用灰态的族覆盖语义**：一条 Input 类用户规则在五个 Input 族各有一份实例（`resolveRuleFamilies` 归族设计），任一族在场即可触发——灰态判定是「覆盖族**全部**被禁」（多对多归族的精确语义，非任一禁即灰）。
- **内置开关的双通道**：开关关闭恒走 `deleteBuiltinRule`（deletedBuiltinRuleIds 语义）；仅「在场但 `enabled=false`」的存量态（外部工具写入，UI 无此写路径）打开时走 `toggleRuleEnabled` 启用通道。
- **语言间空格策略分区（#49）**：现役语言对 chips（内置类经 `scriptNames` 显示名映射）+ 双下拉添加 + 自定义词典成对编辑（失焦整表提交 `setLanguagePairs` / `setCustomScriptCategories`）；上限 64 对 / 128 类整批拒绝（`invalid-payload`）。持久化与引擎消费见 [rules-storage.md](rules-storage.md)。
- **behaviorState 注入**：`RulesSettingsViewOptions.behaviorState` 为本地结构接口（`RulesBehaviorStateLike`，形状对齐 vendor `AddonBehaviorStateFacet`），入口 `page-settings.ts` 经 `settingsTabsUi.ts` 透传 `sdk.behaviorState`——视图层保持零 SDK 依赖，jsdom 测试注入 mock。
- **spacing 分区写路径（评审轮 1–3 落档）**：整表写经本地串行队列（每笔写含写后刷新落地后下一笔才取基面，防浏览器 blur→change→click 事件序下整表写以陈旧基面互相覆盖）+ 词典基面取 DOM 读面；编辑保护 = 焦点在编辑面**或**存在未提交草稿脏标记（真实浏览器 mousedown 即移焦点，仅凭焦点不够）。
- **已知窄窗口（延后跟踪）**：① 草稿在途时非消费性 spacing 写（chips/词典删除）会清脏标记并重建，草稿丢失——修法是重建时回注草稿值，「按写种类选择性清位」会让 chip 删除不即时反映，更糟；② client.load 单飞下写后 load 可能并入更早发出的 get（快照缺该笔写 → 控件瞬态回弹，下次动作自愈，存储无损）；③ 存量「与内置类同名」词典条目（仅手改 rule-state.json 可造出）会被 UI 预检整表拦截、该行无法经 UI 删除。三者窗口均窄、无存储损坏。

## 给后续票的接口提示

- **#17（函数替换体，已落地）**：`RuleFormModel` 的 `isFunction`/`functionRef` 是函数面表单态；预注册表与签名配对口径在 `src/rules/function-table.ts` + `rules-ui-model.ts` 的 `functionRefValidForType`/`firstFunctionRefForType`。实施落档见 [rule-engine.md](rule-engine.md) 函数替换体预注册节与 ADR-0003。
- **#19（i18n 完整化）**：`rulesPage` 键集已按上游 locale 对照落双语（#17 增函数面 6 词条）；内置规则描述按 id 本地化（`builtinRuleDescriptions` 模式）是本页唯一未双语面。规则语法专题文档的函数替换体基础节已在 [rule-engine.md](rule-engine.md) 落档，#19 扩展时以此为锚。
- **#21（人工验证）**：本页清单——设置页打开/重开回显、表单各 pill/chip 联动（含函数式替换 chip 与 ref 下拉）、拖拽排序真实手感、导入文件选择器、导出下载落盘、暗/亮主题观感、中文与英文界面切换。函数面专项：新建/编辑函数引用规则、类型切换自动改选、真实 webview 键入 `。。` 核对 fw2hw 经函数表工作（#25 时代 CSP 降级已根治）。
