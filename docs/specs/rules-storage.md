# 自定义规则内核与 JSON 持久化（工单 #14）

规则数据链完整落地：存储纯逻辑（上游 rule_manager 数据面）、宿主 storage 单写点服务、页面引擎装载与自动重载、通道协议。事实源模块：`src/rules/rule-store.ts`（存储纯逻辑）、`src/rulesHost.ts`（宿主接线）、`src/rules/rules-protocol.ts`（通道协议）、`src/rules/rules-page.ts`（页面客户端）；测试矩阵：`test/rule-store.test.ts`、`test/rulesHost.test.ts`、`test/rules-page.test.ts`（含端到端）。

## 验收口径

- 规则增删改 / 导入导出 / 外部重载端到端全绿（`test/rules-page.test.ts` 端到端组：mock storage + mock channel registry + 真实 service/client 装配）。
- 停用重装后数据保留：dispose 不删文件、新代次 service 同 storage 读回全部数据（含 deletedIds）。
- `npm run compile`（三产物构建 + `tsc --noEmit`）通过；全部测试绿（含既有用例不回归）。
- `src/rules/` 零平台依赖扫描钉住（#1 契约；#14 起放宽为「允许模块间相对导入（值或 type）」，禁平台依赖意图不变）。
- Tabstop 语法解析接入（恢复上游 `parseTabstops`；#1 矩阵 `$0` 断言已同步更新，见 [rule-engine.md](rule-engine.md)）。

## 上游对照

上游 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa），按内容锚点逐条对照：

| 上游锚点 | 移植落点 | 语义 |
| --- | --- | --- |
| `rule_manager.ts` `loadRulesFile` / `saveRulesFile` | `RuleStore` 私有 `saveBuiltinRules`/`saveUserRules` | 文件形态一致（SimpleRule[] 顶层 JSON、缩进 2）；**写路径一致性改进**：构造新数组 → 写成功才替换缓存（上游先改缓存后写，失败时失配） |
| `initRuleEngine` | `RuleStore.init()`（装载与外部重载共用入口） | builtin 不存在→写出厂；存在→merge 补种（尊重 deletedIds）；user 不存在→写空；损坏 JSON 回 []（补种恢复全量） |
| `mergeBuiltinRules` | 同名私有路径 | existingIds ∪ deletedIds 之外补种；无新增不写 |
| `getLocalizedBuiltinRules` | **不移植** | 出厂 description 保持 #1 数据原样（中文）；展示层本地化归 #16/#19 |
| `getImportDedupKey` | `RuleStore.getImportDedupKey` | `trigger\0trigger_right\0isRegex\0归一 flags`，逐字符原样 |
| `importUserRules` | 同名方法 | 缺 trigger/replacement 与 dedup 命中计 skipped；同批增量登记去重；enabled 缺省补 true；id 强制重分配 |
| `addUserRule` / `updateUserRule` / `deleteUserRule` / `updateBuiltinRule` | 同名方法 | id 强制重分配 / 命中改写保持 id / 未命中 no-op |
| `toggleRuleEnabled` / `reorderUserRule` / `updateRuleTriggerMode` | 同名方法 | 分文件写 / 越界与原地 no-op / T 旗标增删（options 空串归 undefined） |
| `deleteBuiltinRule` / `restoreBuiltinRule` / `resetAllBuiltinRules` | 同名方法 | **幂等收窄**：delete 对不在场 id 不记 deletedIds（上游无条件记）；restore 不重复追加（上游可产生重复条目）——防状态漂移，语义经测试钉住 |
| `migrateRulesFiles` | 同名导出函数 | 读老路径 → 写新路径（拷贝非移动）、缺失跳过、同路径 no-op；上游 mkdir 分支不移植（storage `writeFile` 按需建父目录） |
| `main.ts` `onConfigFileChange`（L252-272） | `HostRulesService.onFileChange` | 自写抑制 `now - lastSaveTime < 2000` 忽略；去抖 1s 合并；重载后 revision++ |
| `settings.deletedBuiltinRuleIds` | `rule-state.json`（`{ deletedBuiltinRuleIds: string[] }`） | #3 映射表决策：规则管理伴随状态与规则文件同生命周期，归 storage 不进设置 schema；出厂种子取 `RICH_STRUCTURE_DEFAULTS.deletedBuiltinRuleIds` |
| `settings.rulesStoragePath` | **剔除**（#3 已落档） | 平台 ctx.storage 固定目录，无路径配置概念 |

## 平台映射

- **storage 语义消费**（vsidian#404 平台语义节，`test/rulesHost.test.ts`「mock storage 平台语义」组自证）：相对路径正斜杠；越界形态（`../`、绝对路径、反斜杠、盘符、`//`、`.` 段）`invalid-path` 拒绝；单文件 8MB 上限（`too-large`）；停用/故障/卸载**不删数据**（dispose 断言零 deleteFile、重装读回全量）。读写拒绝码在 `adaptStorageIo` 折叠为 null/false，service 降级不崩（写失败缓存不变、revision 不增）。
- **架构位**：引擎在页面（每个编辑器 webview 一份），数据权威在宿主单写点——页面拉快照 `engine.loadFromFiles` 重装，写经 mutate 通道进宿主执行（多 webview 实例并发写的单写点收敛）。上游 RuleManager 的引擎同步镜像操作不移植（页面重装载覆盖其功能）。
- **通道协议**（`RULES_TOPIC`，照 #3 `SETTINGS_TOPIC` 三通道模式）：`get`（快照+revision）/ `revision`（轻量轮询）/ `mutate`（11 个 op，载荷经 `parseRulesMutatePayload` 校验 + `sanitizeSimpleRule` 清洗）/ `exportUser`（JSON 字符串）/ `storageUri`（同步工具配置展示）。**导入载荷上限（审查 C-P3-4）**：`importUserRules` 的 content ≤ 2MB（`IMPORT_CONTENT_MAX_LENGTH`，字符数，**在 JSON.parse 之前判定**——大载荷同步 parse 阻塞宿主的防线）+ 条数 ≤ 5000（`IMPORT_MAX_RULES`，拦装载后逐键遍历放大），超出拒绝 `too-large` / `too-many-rules`；宿主（`applyMutation` 权威防线）与页面客户端（预检省往返 + i18n 文案）共用 `rules-protocol.ts` 常量，双端判定不漂移。**双作用域注册**：setup 通道供 #16 设置页规则管理 UI，enable 通道供编辑器页客户端——平台两通道表独立（`record.setupHandlers` / `run.handlers`），同名 topic 各自注册不冲突（vsidian addonRuntime.ts buildChannelRegistry 核实）。
- **外部重载通知模型**：页面 SDK 的 channel 只有 request 方向（页面→宿主），无宿主→页面业务推送（AddonPageDirective 仅装载层）。因此「自动重载」= 宿主 revision 代次 + 页面 2s 轮询轻量端点（对齐官方 input-behavior 样例「拉取 + 惰性刷新」模式）：外部同步工具改写或 #16 UI 编辑 → revision++ → 页面轮询发现 → 整拉重装引擎。
- **模块布局**：`src/rules/` 保持纯领域（rule-engine / default-rules / rule-store / rules-protocol / rules-page，零平台依赖，扫描钉住）；平台接线层 `src/rulesHost.ts` 置 src/ 平铺（import vendor 类型，性质同 extension.ts）。
- **extension.ts 接线**：setup 创建 `HostRulesService`（storage 单写点 + watcher）并注册 setup 通道；enable 注册编辑器页通道（同实例）；代次重注册时显式 dispose 旧实例。**不触碰 #3 的 SETTINGS_TOPIC handler**。

## 已知边界

- **函数替换体引用形态收口（#17 已落地）**：`sanitizeSimpleRule` 接受 `replacement` 双形态——字符串字面量或函数引用对象 `{kind:'function', ref}`（kind/ref 浅拷贝、附加键丢弃、畸形引用拒绝）。**不查函数表**：存储层只管声明性数据的形状（fork 组件扩展函数表后可存内置表之外的 ref），ref 是否存在、签名是否匹配由引擎装载时查表校验并 reportError（见 [rule-engine.md](rule-engine.md) 函数替换体预注册节）。遗留字符串函数体（F 旗标 + 字符串）存储侧原样保留——数据不丢，装载侧拒绝并通知，用户可在 UI 改选预注册函数。决策见 [ADR-0003](../adr/0003-function-replacement-preregistered-table.md)。
- **文件整体缺失 = 恢复出厂全量**（上游 exists=false 分支语义）：deletedIds 只约束 merge 补种路径，不拦截「文件不存在」分支——外部删除 builtin-rules.json 会复活已删内置规则，与上游一致（`test/rule-store.test.ts`「上游语义钉子」用例钉住，防好心修复）。
- **languagePairs / customScriptCategories 未建持久化文件**：二者是间距引擎（smart space）的富结构，数据链归对应功能票；#3 边界句「富结构归你的 JSON 持久化」在本票只消费了 deletedBuiltinRuleIds（rule-state.json）。语言对种子仍以 `RICH_STRUCTURE_DEFAULTS` 为单一事实源，届时扩展同一 rule-state 文件或平行文件。
- **revision 非持久化**：代次是运行态计数（每次激活期从 0 起），页面装载时以 -1 起步强制首拉；同一激活期内任何数据变化都会递增，跨激活期无比较意义（页面重新装载亦从 -1 起）。
- **自写抑制窗口内的外部改动会被误丢弃（审查 C-P3-1，上游同款继承）**：`HostRulesService.onFileChange` 的自写抑制判据是「距上次成功写 < 2s 的文件事件一律忽略」（上游 `lastSaveTime` 同款，平台对自写也会回调 onDidChangeFile 所致）——外部同步工具恰在本组件写操作后 2s 内改写规则文件时，该事件被误判为自写回声而丢弃（不重载、revision 不增），宿主缓存与文件失配，直到下一次落在窗外的文件事件或组件重装载才恢复。上游行为一致，未收窄未放宽；同步工具侧的缓解是避开在本组件写入后立即改写（或改写后再触发一次落盘外保存让事件落在窗外）。
- **页面装载链路与引擎消费均已接线**（审查 B-F1 / C-P1-2 修复收口）：page-editor.ts 装载引擎 + 轮询重载；`PageRulesClient` 的 `onReload` 快照喂规则源（`createRuleSnapshotSource`，src/ruleBehaviorIntercept.ts），#25/#9 行为族引擎经其同步重建——用户规则、内置停用与删除、外部改写轮询重载对编辑行为即时生效（端到端测试：test/ruleBehaviorIntercept.test.ts「端到端：存储态 → 行为族引擎」组）。装载前 / 通道不可用时行为族回落出厂数据。设置门控（上游 `userDefinedRegSwitch` 关闭时用户规则不参与）在消费侧经 #27 探针接线，存储层不复制开关。
- **真实 storage 联调归 #21**（宿主集成验证票）：本票 mock 承载全部 storage 语义断言。

## 给后续票的接口提示

- **#15（Tabstop 导航）**：`ApplyResult.tabstops`（`{number, from, to}` 文档绝对坐标，number 升序）已填充，`cursor` 落 `tabstops[0].from`；分组导航把 tabstop 组转多光标选区 + Tab/Shift-Tab 跳转，引擎零改动。
- **#16（规则管理 UI，已落地）**：读写全经 `RULES_TOPIC`（`src/rules/rules-protocol.ts`）；`get` 返回 `{ revision, builtin, user, deletedBuiltinRuleIds }`；mutate 11 op 覆盖增删改/开关/排序/触发模式/删除恢复重置/导入（content 字符串）；`exportUser` 给下载、`storageUri` 给「打开数据目录」类提示。设置页（setup 通道）与编辑器页（enable 通道）都已注册。实施落档见 [rules-ui.md](rules-ui.md)。
- **#17（函数替换体，已落地）**：`replacement` 引用对象形态随 JSON 序列化无损往返（出厂种子 → 落盘 → 解析回读，`test/rule-store.test.ts` 钉住）；mutate 通道的 rule 载荷经 `sanitizeSimpleRule` 同一收口，UI 产出的引用对象可直传。实施落档见 [rule-engine.md](rule-engine.md) 与 ADR-0003。
- **#25（输入行为链，已接线）**：消费入口不是单一的 `PageRulesClient.engine`（该引擎保留为数据链诊断面），而是行为族各自引擎经**规则源**动态装载——`page-editor.ts` 把 `createRuleSnapshotSource()` 接到 `client.onReload`，`registerRuleInputBehaviors` / `registerRuleDeleteSelectKeyBehaviors` 收到快照（`{builtin, user}`）即同步重建族引擎（归族设计见 [rule-engine.md](rule-engine.md)「用户规则归族与动态重建」节）；快照的 `builtin` 数组已不含被删内置规则（`deleteBuiltinRule` 从文件移除），`enabled=false` 保留在装载集、由引擎 process 门控跳过。作用域判定按 #1 设计注入 `scopeHint`（C-P1-1 起带 All 短路与事务级 memo）。
