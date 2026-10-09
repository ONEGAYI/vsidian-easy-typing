# ADR-0002：函数替换体预注册函数表——不放行 unsafe-eval

- 状态：已接受（工单 #17，平台决策 vsidian#405 用户确认 2026-10-08）
- 背景：上游 easy-typing 的自定义规则支持函数替换体——替换体写 JS 函数体字符串（可引用匹配捕获组），运行时经 `new Function` 动态构造（Obsidian 渲染进程无 CSP 约束，此形态可行）。Vsidian 附加组件页面（编辑器 webview 与设置页 webview）的 `script-src` 均不含 `unsafe-eval`（`wasm-unsafe-eval` 仅覆盖 WebAssembly），`new Function` 被 CSP 引擎拦截——#25 实测 6 条 Input 函数体内置规则在真实页面装载期编译失败、静默降级为不可用。

## 决策

**不放行 `unsafe-eval`，函数替换体等价能力走预注册变换函数表。**

- **规则 JSON 只存声明性数据与函数引用**：`replacement` 携带引用对象 `{kind:'function', ref:'<id>'}`（票面 `{"replace":{"kind":"function","ref":"dashTransform"}}` 示例的字段化形态，落在既有 `replacement` 字段上）。函数本体是组件代码内的真函数——`src/rules/function-table.ts` 注册表，组件经构建桥打包在场，引擎装载时查表注入。表达力不损（图灵完备函数仍在），只改函数的物理位置：从「规则文件里的字符串」到「组件代码」。
- **`new Function` 路径删除**：CSP 下必炸，保留只会制造静默降级。遗留字符串函数体（F 旗标 + 字符串）装载期拒绝并 reportError（死替换体兜底），不再有任何动态代码路径（scaffold 契约扫描钉住：src 下禁 `new Function` / `eval` 调用）。
- **用户自定义函数体由「规则组件化 fork」承接**：需要自定义变换函数时，fork 本组件（或做成小组件 VSIX）把真函数加入 `function-table.ts` 并登记 ref，规则 JSON 按 ref 引用；fork 的函数经同一构建桥打包，天然满足 CSP。该路径写入规则管理 UI 的提示文案（`functionReadonlyHint`）与规则语法文档。

## 备选与否决理由（vsidian#405 探针评估，2026-10-08）

- **放行 `unsafe-eval`**——否决。CSP 的 eval 授权是页面粒度（无按脚本粒度）：一旦放行，页内全部已装载脚本（Vsidian 自身 + 所有附加组件 IIFE）的 eval 面全开，一个组件的规则文件缺陷（如被同步工具注入恶意函数体）即获得任意代码执行；且打破 vsidian `editorCsp.ts` 与钉住测试的既有验收红线。收益只有一个（函数体存 JSON 字符串），与 ADR-0012「载荷与结果是可传输数据，函数不过桥」原则同构的对立面。
- **受限 DSL（字符串模板 + 受控算子）**——备选不舍弃：若未来出现「无构建轻量规则包」需求再评估；当前需求（上游 10 条内置函数规则的表达力）预注册表已完整覆盖。

## 实施形状（与既有架构的接缝）

| 面 | 落点 | 约束 |
| --- | --- | --- |
| 函数表 | `src/rules/function-table.ts`：10 条真函数（7 text + 3 selectKey 签名），ref ↔ 上游规则 id 映射表见模块头注 | 纯数据 + 纯函数，零平台依赖（`src/rules` 导入纪律扫描钉住）；fork 在此追加条目 |
| schema | `SimpleRule.replacement: string \| {kind:'function', ref}`；F 旗标与引用对象成对 | 解析与校验在 `RuleEngine.normalizeRule` / `resolveFunctionReplacement`：未知 ref、签名与规则类型失配、遗留字符串函数体、引用对象缺 F 旗标——一律拒绝装载 + reportError |
| 存储 | `sanitizeSimpleRule` 接受引用对象形态（kind/ref 浅拷贝），**不查函数表**——存储层只管声明性形状，ref 校验归引擎装载（fork 扩展表后可存内置表之外的 ref）；遗留字符串函数体存储侧原样保留（数据不丢，装载侧拒绝，UI 引导改选） |
| 引擎注入面 | `RuleEngineOptions.functionTable`（缺省内置表）——测试注入自定义表用 | fork 不经此注入（直接扩展函数表模块） |
| UI | #16 的 `functionLocked` 解锁为 `isFunction` 开关 + `functionRef` 选择：ref 下拉（按规则类型过滤签名组）+ 函数源码只读展示 + fork 引导文案 | 仅引用选择，不含函数体编辑 |
| 契约防线 | scaffold 动态代码禁令扫描（src 禁 `new Function`/`eval` 调用）；function-table 矩阵钉 10 函数语义与 ref↔规则映射 | 回归即红 |

## 后果

- #25 时代「6 条 Input 函数体规则 CSP 静默降级」的场景根治：内置函数规则在真实 webview 与 vitest 行为一致（都是查表注入，无环境分支）。
- #21（宿主集成验证）的验证点更新：`。。` → `.` 的 fw2hw 转换预期恢复工作（原先因 CSP 预期不转换）。
- 从上游导入的规则 JSON 若含函数体字符串（F 旗标 + 字符串 replacement），装载期被拒绝并通知；持有者在规则管理 UI 改选预注册函数或走组件化 fork。规则语法文档（#19 专题化）以引用形态为函数替换体的唯一书写形态。
- 平台侧关联落档：vsidian `docs/research/addon-csp-dynamic-eval-probe.md`（决策依据）与 developer-guide「动态代码不可用」条目（组件作者可见边界）。
