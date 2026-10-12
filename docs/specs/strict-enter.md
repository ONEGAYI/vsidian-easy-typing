# 严格换行三模式补偿（StrictModeEnter）

> 工单 [#30](https://github.com/ONEGAYI/vsidian-easy-typing/issues/30)；决策记录 [ADR-0002](../adr/0002-strict-line-break-mapping.md)（§四：C 先行 + 插件侧等待接线，vsidian PR #458 落地后本票实施）。
>
> 模块：`src/strictEnter.ts`（Enter 决策与 Command）+ `src/newLineBelow.ts` 的 `strictNewLineBelowInsert`（Mod+Enter 严格分支）；装配 `src/page-editor.ts` #30 增量块。

## 一、功能语义

宿主渲染为严格换行（CommonMark 软换行拼段——单换行在阅读视图不可见）时，用户按一次 Enter 想要的换行阅读视图看不见。本功能按所选模式改写插入文本使换行可见，是上游 easy-typing-obsidian 对 Obsidian `strictLineBreaks: true` 的**编辑侧补偿**的忠实移植：

| 模式（strictLineMode） | 普通文本行（Enter） | 引用行（Enter） | 列表行 |
| --- | --- | --- | --- |
| `enter_twice`（默认） | 插 `\n\n`（分段） | 双行引用：`\n` + 前缀 + `\n` + 前缀 | 不额外处理（落穿） |
| `two_space` | 行尾两空格 + `\n`（行尾已两空格不重复） | 两空格 + `\n` + 前缀（前缀后内容已两空格不重复） | 同上 |
| `mix_mode` | 同 `enter_twice` | 同 `two_space` | 同上 |

Mod+Enter（当前行下方新建行）在双门开时同模式改写插入串：正文行 `enter_twice`/`mix` 插 `\n\n` + 前缀、`two_space` 插两空格 + `\n` + 前缀；引用行 `enter_twice` 双行引用、其余两空格 + 前缀；空白行与代码/公式行不改写；列表行所有模式不额外处理。

## 二、双门控（对齐上游 `StrictModeEnter && strictLineBreaks` 原语义）

- **组件门**：本仓设置 `strictModeEnter`（默认关，opt-in；模式键 `strictLineMode`，默认 `enter_twice`）——经 #3 设置通道（SETTINGS_TOPIC.get）装载拉取 + 焦点回归刷新，走 settingsChannel 共享通道（#32 在途去重）。
- **宿主门**：vsidian `experimental.hostSettings`（实验入口，清单已声明 `^1.0.0`）的 `get('editor.readingBreaks')` 同步读取——**false（严格渲染，平台默认）才生效**；true（宽松换行，#423 落地的 breaks 设置）时上游补偿前提消失，透传。同步 get 每键实时查询（拉取式跟随热更：宿主保存设置后下次按键即新值，无推送通知——vsidian developer-guide §4 契约）。
- 两门 AND 合成单一 `isEnabled` 供 Enter 与 Mod+Enter 共用；facet 缺席（宿主旧版未提供该实验入口）或 get 拒绝（view-disposed）按不生效处理——安全侧 = 不改写文本，Mod+Enter 严格依赖同时缺省（零回归面）。

## 三、上游对照（easy-typing-obsidian 6.0.9）

| 本仓 | 上游锚点 | 说明 |
| --- | --- | --- |
| `planStrictEnter` | `keyboard_handlers.ts:222-297`（enterStrictLineBreak） | 判定序逐行对照：空白行（236）→ 行首（239）→ quote 分支（241-262，不检查下一行）→ 段中边界（267-269）→ two_space text（271-280）→ text / 顶格代码块末尾（282-294） |
| `strictNewLineBelowInsert` | `keyboard_handlers.ts:728-762`（goNewLineAfterCurLine 严格分支） | 决策序：空白行分支先 return（692-700）→ code/formula 排除（733-737）→ listMatch 恒不改写（746-748）→ TwoSpace（749-750）→ quoteMatch EnterTwice/Mix（751-757）→ 其余 `\n\n`（758-761） |
| 行类型判定 | `core.ts:748-788`（getPosLineType2，v2 维度） | 本仓消费 #5 平台语法查询投影（LINE_KIND 维度）：table/heading 归 text、empty 本地补判、惰性延续行门控回 text——与上游 v2 语义对齐；查询拒绝（ok:false）→ 不接管（不 fallback 正则） |
| 两空格查重 | 250 / 265 / 745 行 | Enter 引用分支查**前缀后内容**、非引用分支与 Mod+Enter 查**整行** `endsWith('  ')` |

## 四、平台映射与键位仲裁

- **Enter**：Prec.high 抢先层，**注册序在 #18 foldEnter keymap 之后**（同层注册序即尝试序——ADR-0002 §三.B.2 定案）：折叠标题行折叠层先命中；非折叠标题行本层按 text 接管（上游 v2 不特判 heading）；列表行本层决策落穿 → 平台续行链（普通槽）处理，无遮蔽。多选区在 Command 层拦（上游 handleEnter 链首检查的对齐形态）。
- **Mod+Enter**：沿 #13 既有 Prec.high keymap，严格改写在 Command 内注入（`strict` 依赖块）——透传路径与多选区透传语义零改动。
- **树判定消费**：`queryOfView`（#5 工厂）+ `lineInfoAt`；Mod+Enter 的行形态判定是行文本正则（上游同源——树 kind 仅用于 code/formula 排除）。

## 五、边界门槛（上游口径原样钉住，台账外不得顺宽）

- 空白行不处理；光标在行首（pos == line.from）不处理；
- 纯引用前缀行（前缀后无内容）不处理；
- **callout 标题行落穿**：上游 v2 判 callout_title ≠ quote 落穿，平台树判 quote（无 callout 枚举）——组件以 CALLOUT_PREFIX_RE 自判补齐（`> [!x]` 开头即落穿）。Mod+Enter 侧上游 quoteMatch 不查 callout，本仓同口径**不排除**；
- 非 `two_space` 模式且下一行非空白不处理（段中插空行拆段——上游 267-269）；`two_space` 不受此拦（两空格不改段结构）；
- 引用行不检查下一行空白（上游 quote 分支先于段中边界）；
- 只认正文行与引用行：列表/公式/frontmatter/代码块内部落穿（平台情境链处理）；
- **顶格代码块闭栏行行尾特例**：光标在闭栏行行尾（pos == 块 endPos）且围栏顶格（indent == 0）→ 插 `\n\n`（上游 282-283 的 code 半边）；段中边界照常先拦（enter_twice/mix + 下一行非空白 → 落穿）。引用内围栏（indent 含引用前缀 ≠ 0）与缩进代码（无围栏块信息）不适用。

## 六、验收口径

- 单测矩阵（`test/strictEnter.test.ts` / `test/newLineBelow.test.ts` 补项）：三模式 × 正文/引用/列表 × 边界门槛全组合 + Command 门控/防御面 + 设置门 fail-safe + 装配序（strict Enter 注册在 foldEnter 之后，`test/pageEditorWiring.test.ts`）。
- 端到端人工项（#21，`docs/manual-verification.md` A73-A76）：Enter 三模式真实键序、段中边界、Mod+Enter 双平台形态（Ctrl+Enter / Cmd+Enter）、双门控翻转与热更跟随。**清单补项不代替人工执行**。
- vendor 锚定随本票刷新至 vsidian@`9f2d2927`（PR #458 合并点，hostSettings 类型面纳入）。

## 七、已知边界（B23，不是缺陷）

- 多级引用前缀仅取首级：`> > deep` 的前缀提取是 `> `（QUOTE_PREFIX_RE `(>+ ?)` 单串语义，上游同口径）——严格分支的引用延续/双行引用均只带一级前缀（#13 A43 已有同款口径）。
- 引用内表格/标题行（`> | a |`）走正文分支：平台嵌套优先级判 table/heading → 投影 text，不续引用前缀（上游 v2 判 quote 走引用分支）——#5 既定「消费面按平台语义」差异。
- 行内公式（单行 `$$x$$`）与 frontmatter 内不接管：kind 判定归 formula/frontmatter 落穿。
- 阅读模式不生效：本功能挂 Live 实例扩展槽（实验 cm6 keymap），阅读视图无输入路径——与 #13/#18 同边界。
