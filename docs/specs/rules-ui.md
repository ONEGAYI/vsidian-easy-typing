# 规则管理 UI——自定义设置页自绘（工单 #16）

上游 5-Tab 设置页的规则域（`easy_typing_settings_tab.ts` 的内置/自定义规则两 Tab + `rule_edit_modal.ts` 编辑 Modal，合计约 1700 行 UI）移植为 Vsidian 平台自定义设置页自绘。事实源模块：`src/rulesUi.ts`（视图层）、`src/rules/rules-ui-model.ts`（表单纯逻辑）、`src/rules/rules-settings-client.ts`（数据客户端）、`src/page-settings.ts`（入口装配）、`src/settings.css`（scoped 样式）；测试矩阵：`test/rules-ui-model.test.ts`（纯逻辑 44 例）、`test/rules-settings-client.test.ts`（数据客户端）、`test/rules-ui.test.ts`（jsdom 端到端 13 例）。

## 范围与模块结构

| 上游锚点 | 移植落点 | 语义与偏差 |
| --- | --- | --- |
| 设置页 Tab3「内置规则」+ Tab4「自定义规则」 | `renderBuiltinSection` / `renderUserSection` | 分组展示形态一致；**上游 5-Tab 导航不移植**（本页只承载规则域，其余设置域走平台「附加组件」分页，见 [settings-mapping.md](settings-mapping.md)） |
| `RuleEditModal`（611 行） | `buildFormDom` + `refreshFormVisibility` + `src/rules/rules-ui-model.ts` | 表单字段、pill/chip 交互、可见性联动（SelectKey 隐藏正则与右匹配、Code 作用域点亮语言行）逐项对照；Modal 换为 mountRoot 内自绘浮层（backdrop + dialog） |
| `buildRuleItem` | `buildUserRuleItem` / `buildBuiltinRuleItem` | 类型/作用域/函数标签、预览行（description 优先，否则 `触发 → 替换`；F 旗标函数体字符串原样展示——上游 repl 分支同语义）逐项对照 |
| 拖拽排序（settings_tab drag 族事件） | `attachDragHandlers` + `computeDropIndex` | 事件链与上/下半区判定移植；索引换算抽为纯函数矩阵钉住；落点后不做上游的 DOM 手工搬移——写后刷新全量重渲染（语义等价，列表规模小） |
| 导入导出（export/import 按钮） | `triggerExport` / `triggerImport` | Blob 下载与隐藏 file input 形态一致，导出文件名保留上游 `easy-typing-user-rules.json`（数据跨生态兼容）；解析与去重在宿主单写点（#14 语义），页面仅形状级预检（非 JSON/非数组本地即拒） |
| `tokenizeJS` + CM6 函数体编辑器 | `tokenizeJs` + `renderHighlightedCode` | 设置页无 cm6 共享运行时（experimental.cm6 仅编辑器页），**降级为只读高亮 pre**（票面允许）；JS 语法高亮词法器原样移植 |
| `getRuleScopeBadges` / `getRuleTypeLabel` | `buildTagRow` / `typeMeta` | 标签语义一致（`<lang>` 代码域、`ƒx` 公式域），文案走 i18n |

**分层纪律**：数据面全经 `RulesSettingsClient`（通道载荷钉住在 `test/rules-settings-client.test.ts`），视图层零 SDK 依赖（`doc`/计时器可注入），表单换算与试运行是 `src/rules/` 纯函数——三层各自可测。

## 状态刷新策略（落档决策）

**写后刷新**：每次 mutate 成功（含导入）→ 客户端立即整拉 `get` 快照 → `onStateChange` → 视图全量重渲染；业务拒绝不刷新（状态行报错）。不挂 revision 轮询，理由：

- 设置页面板隐藏即销毁（平台装载器语义，`sdk.onDispose` 闭环），页面存活期内的变更全部经本页客户端——写后刷新即完备；
- 外部同步工具改写文件的可见性由「重开页面装载」覆盖（`test/rules-ui.test.ts` 重开回显组钉住）；打开的编辑器页另有 #14 的 revision 轮询自动重载引擎，两条链路互不依赖。

## 边界（钉住，后续票不得顺手改）

1. **内置规则逐条开关不在此页**（口径 #1/#3）：走平台「行为冲突管理」，页头给引导文案（i18n `rulesPage.builtinRules.platformToggleHint`）。本页对内置规则只提供**停用**（`deleteBuiltinRule` → deletedBuiltinRuleIds 语义）、**恢复**（`restoreBuiltinRule`）与**全部重置**（`resetAllBuiltinRules`）；内置规则**不可编辑**（上游 gear 按钮不移植——上游 `updateBuiltinRule` 通道能力保留但无 UI 消费面）。
2. **函数替换体只读**（#17 收口前）：F 旗标规则的函数体只读高亮展示 + 提示文案（`functionReadonlyHint`），保存恒保留原 replacement（`buildSimpleRuleFromForm` 的 functionLocked 分支，测试钉住）；新建表单不提供「函数式替换」开关（新建函数体 = 编辑函数体，同归 #17）。#17 落档后在此微调文案与开关。
3. **试运行语义**：单规则独立引擎，Input 类按光标位模拟输入、Delete 类按 kind=Delete 匹配、SelectKey 类取选区文本 + 首触发键模拟按键（`testSingleRule`）；空触发式视为未命中（引擎对空 trigger 会空匹配，表单未完成时如实显示 miss）。Tab 触发模式规则在常规模拟下不命中（上游 changeType 语义）。
4. **自绘样式边界**：全部类名 `vsidian-easy-typing-` 前缀，配色复用 webview 基线 `--vscode-*` 主题变量（带回退值，不新增平台级样式契约）；`src/settings.css` 构建拷贝 `dist/settings.css`，`extension.ts` `registerPage({ entry, css })` 登记。
5. **列表项触发方式标签为静态展示**（上游点击可切换 Auto/Tab）：切换经编辑表单的触发方式 pill 完成——少一条列表内写路径，`updateRuleTriggerMode` 通道能力同样保留无 UI 消费面。

## 上游简化清单（有意为之，非遗漏）

- 5-Tab 导航与设置域其他 Tab（编辑增强/自动格式化/其他）不进本页——23 项设置走平台设置 schema（#3 已落）。
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
- 上游 locale 的 `builtinRuleDescriptions`（按规则 id 的内置描述本地化）不移植：内置 description 保持 #1 数据原样（中文），英文界面下内置规则预览显示中文描述——#19 i18n 完整化时按 id 映射补齐。

## 给后续票的接口提示

- **#17（函数替换体收口）**：`RuleFormModel.functionLocked` 是只读锁开关位；解锁后 `buildSimpleRuleFromForm` 的 replacement 分支与表单 fnEditor 区块即为编辑面落点；`functionReadonlyHint` 文案同改。
- **#19（i18n 完整化）**：`rulesPage` 键集已按上游 locale 对照落双语；内置规则描述按 id 本地化（`builtinRuleDescriptions` 模式）是本页唯一未双语面。
- **#21（人工验证）**：本页清单——设置页打开/重开回显、表单各 pill/chip 联动、拖拽排序真实手感、导入文件选择器、导出下载落盘、暗/亮主题观感、中文与英文界面切换。
