# 规则引擎内核与内置规则（工单 #1）

规则引擎纯逻辑内核（三触发类建模、Input 类执行）与内置规则数据全量移植。事实源模块：`src/rules/rule-engine.ts`（内核）与 `src/rules/default-rules.ts`（数据）；测试矩阵：`test/rule-engine-core.test.ts`（机制）与 `test/rules-matrix.test.ts`（内置规则）。

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
