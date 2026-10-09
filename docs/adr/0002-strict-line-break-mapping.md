# ADR-0002：严格换行（StrictModeEnter）的 Vsidian 映射——三方案对比与决策门槛

- 状态：**提议（待用户决策）**——工单 #13 产品决策门槛项；决策通过前不实施，本文档即交付物
- 日期：2026-10-09（工单 #13）
- 关联：上游 `src/keyboard_handlers.ts:222-297`（enterStrictLineBreak）与 `:728-762`（goNewLineAfterCurLine 严格分支）；设置键 `strictModeEnter`/`strictLineMode` 已在 #3 schema（默认 `false`/`'enter_twice'`，本票未接线生效逻辑）

## 一、上游语义（代码核实口径）

**Obsidian 渲染配置 `strictLineBreaks`**（`app.vault.config`）：

- `false`（Obsidian 默认，宽松）：编辑时的单个换行在阅读视图渲染为**换行**；
- `true`（严格）：遵循 CommonMark——单换行是软换行，阅读视图**拼成同段**；可见换行需行尾两空格（硬换行）或空行（分段）。

**上游 StrictModeEnter 只在严格态生效**：`enterStrictLineBreak` 开头
`if (!ctx.settings.StrictModeEnter) return false; if (!strictLineBreaks) return false`
（`keyboard_handlers.ts:223-225`）——它是**编辑侧补偿**：在严格渲染下，用户按
一次 Enter 想要的换行在阅读视图看不见，插件按所选模式改写插入文本使换行
可见。三模式（`StrictLineMode`，默认 `enter_twice`）：

| 模式 | 普通文本行（光标处按 Enter） | 引用行 | 列表行 |
| --- | --- | --- | --- |
| `enter_twice` | 插 `\n\n`（分段） | 插 `\n` 前缀 `\n` 前缀（双行引用） | 不额外处理 |
| `two_space` | 插 `  \n`（行尾两空格硬换行；行尾已有两空格不重复） | 同左 + 引用前缀 | 不额外处理 |
| `mix_mode` | 普通文本按 `enter_twice` | 引用按 `two_space` | 不额外处理 |

边界门槛（上游）：空白行/行首不处理；非 `two_space` 模式且**下一行非空白**
不处理（避免段中插空行拆段）；只认正文行与引用行（列表/标题/代码/公式行
落穿，由宿主续行链处理）；`goNewLineAfterCurLine` 的 Mod+Enter 在严格态下
同样按模式改写插入串。

## 二、Vsidian 现状调研（2026-10-09 核对 origin/main）

- **阅读模式渲染恒为严格语义**：`src/webview/readingMarkdown.ts:379-386`
  `createMarkdownRenderer()` 以 `new MarkdownIt({ html: false, linkify: false,
  typographer: false, breaks: false })` 创建，注释明言「安全配置锁定」——
  `breaks: false` 即 CommonMark 单换行软换行语义，**无任何设置入口**，与
  Obsidian `strictLineBreaks: true` 的渲染语义等价。
- **Live 编辑模式按源文行呈现**：单换行在编辑面就是可见换行（源文忠实），
  与阅读模式的拼接呈现构成 **Live↔阅读不一致**——这正是上游补偿所针对
  的用户可见问题。
- **VSCode 内置 Markdown 预览**：`markdown.preview.breaks` 设置默认 `false`
  （同为严格语义）；VSCode 为该行为**提供官方设置项**，证明「宽松换行开
  关」是主流编辑器的既有产品形态，而非异类需求。

**核心事实**：上游补偿的环境前提（严格渲染下软换行不可见）在 Vsidian
**原生恒成立**——相当于 Obsidian 的 `strictLineBreaks` 恒开且不可关。票面
「VSCode/Vsidian 渲染管线无直接对等概念」按此调研需要修正：**存在直接
对等，且方向恒定**；缺的不是概念，是「用户可切换的渲染开关」。

## 三、方案对比

### 方案 A：不移植（裁剪并记录理由）

- **内容**：`strictModeEnter`/`strictLineMode` 保持已注册但不接线生效
  逻辑（或后续票移出 schema）；Enter/Mod+Enter 对普通文本行维持单换行。
- **语义风险**：Live↔阅读不一致原样保留——用户在 Live 里看到的分行，
  阅读模式拼成一段。这是 CommonMark 标准语义（VSCode 内置预览同款），
  站得住脚；但对从 Obsidian 默认态（宽松渲染）迁来的用户是体验落差。
- **成本**：零。

### 方案 B：编辑侧移植三模式（上游忠实）

- **内容**：按 §一 语义移植 `enterStrictLineBreak`（Enter 键）与
  `goNewLineAfterCurLine` 严格分支（Mod+Enter）；上游的
  `strictLineBreaks` 条件在 Vsidian 恒真，映射为**仅剩插件设置门**
  （`strictModeEnter` 开 = 生效）。设置键与三模式枚举已在 schema，零
  schema 变更。
- **语义风险**：
  1. **文档文本被改写**——两空格（不可见、易被外部工具裁剪的尾随空白）
     或双回车写进正文；同一文档在宽松渲染环境（Obsidian 默认态、开了
     breaks 的预览）下会多出分段/空行。这是上游既有的取舍，非本仓引入，
     但「换一个渲染环境语义就翻转」是硬风险。
  2. **Enter 键三方竞争**（实施前置，增量票须定案）：严格 Enter 与
     #18 折叠拦截（同为 Prec.high、同键 Enter）——本仓内按注册序仲裁，
     折叠标题行优先（标题行非 text/quote 类型，严格分支自然让位，注册
     序只需保证折叠 keymap 在前）；与平台列表续行（普通槽）——列表行
     上游本就落穿，先于平台注册即可，无遮蔽。
  3. 行为分界细微（段中 vs 段尾、行首不处理）——上游口径需原样钉住，
     测试矩阵面较大。
- **成本**：中（算法移植 + 仲裁定案 + 决策/拦截单元测试 + #21 端到端）。

### 方案 C：平台侧渲染配置（超本插件边界）

- **内容**：向 vsidian 平台提需求——阅读管线 `breaks` 参数开用户设置
  （对齐 VSCode `markdown.preview.breaks` 形态）或按文档 frontmatter
  控制；本插件侧不动。
- **语义风险**：零文本改写（最接近 Obsidian 默认体验的「不改文档」路线）；
  但属**平台级变更**：影响所有文档与全体用户，与平台「渲染安全配置锁定」
  的既定决策需要重新协商；附加组件无权实施，只能开 vsidian 仓的 feature
  request。
- **成本**：本仓零代码；平台成本与排期不由本仓控制。

### 推荐项（供用户决策，非定案）

**推荐 B 为后续增量票的候选**：渲染前提同构成立（Vsidian 阅读恒严格）、
设置键就绪、默认关（opt-in 零风险）、能力与上游对齐；接受其文本改写
取舍并由设置描述明示。**同时建议向 vsidian 平台提 C 式渲染设置需求**
作为不改文档的长期路线；C 落地后 B 的门控应补「仅严格渲染生效」判定
（对齐上游 `strictLineBreaks` 条件的原意）。若用户不接受文本改写且平台
短期无 C 计划，则按 A 裁剪并留档本文理由。

## 四、决策后的影响

- 选 B：另开增量票（实施前置 = §三.B.2 仲裁定案 + #21 端到端含严格模式
  键序）；本仓 `newLineBelow.ts` 的 Mod+Enter 严格分支预留接点（当前注释
  已标）。
- 选 A：本 ADR 转为「已接受（裁剪）」，`strictModeEnter`/`strictLineMode`
  两键的去留（保留占位或移出 schema）随裁剪票定案。
- 选 C：本 ADR 转为「已接受（平台路线）」，追踪 vsidian 仓 feature request；
  B 不再实施。

## 五、给 #21（浏览器端到端）的提示

无论决策如何，本票已交付的「下方新建行」需要 #21 覆盖：真实键盘
Mod-Enter 键序（含 Ctrl+Enter/Cmd+Enter 双平台形态）、撤销单笔回退、
`newLineBelow` 设置开关运行时翻转（开 = 前缀延续版、关 = 回退平台
insertBlankLine 的行为对照）、多光标透传路径。若决策选 B，#21 另需覆盖
Enter 三模式键序与「下一行非空白不处理」的段中边界。
