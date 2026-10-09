# NewLineBelow——当前行下方新建行（工单 #13）

> 上游 easy-typing-obsidian 的 Mod+Enter 命令移植（`goNewLineAfterCurLine`，
> 命令 id `easy-typing-goto-new-line-after-cur-line`，默认热键
> `[{ modifiers: ["Mod"], key: "Enter" }]`——**上游有默认绑定**，本仓同键
> 位 Mod-Enter）。在当前行下方插入新行并延续列表/引用前缀；光标落新行。
> 本票同批决策票「严格换行」（同函数内的 StrictModeEnter 分支）**不实施**，
> 方案对比见 [ADR-0002](../adr/0002-strict-line-break-mapping.md)。

## 验收口径（票面映射）

- 新建行端到端：以**决策单元**（`test/newLineBelow.test.ts`「决策」组——
  真实 `EditorState` 驱动插入计划与列位置语义）+ **前缀矩阵**（同文件
  「前缀矩阵」组——上游 682-726 行逐形态对照）+ **拦截单元**（「Command」
  组——最小模拟 view 驱动接管/透传与派发形态，双实现对照喂真实
  `state.update`）承载；浏览器真实键盘端到端归 #21。
- `npm run compile` 通过；全部测试绿（基线 687 例不回归）。

## 上游对照

| 内容 | 上游锚点（v6.0.9 克隆） | 本仓落点 |
| --- | --- | --- |
| 下方新建行决策 | `src/keyboard_handlers.ts:682-777`（goNewLineAfterCurLine） | `src/newLineBelow.ts`（newLineBelowPrefix + planNewLineBelow） |
| 默认键位 | `src/main.ts:159` 附近（Mod+Enter 热键，恒注册命令、无设置门） | `src/page-editor.ts` #13 增量块（keymap Mod-Enter，设置门控） |
| 严格换行分支 | `src/keyboard_handlers.ts:728-762`（StrictModeEnter × strictLineBreaks） | **不移植**（ADR-0002 待决策） |

### 语义要点（与上游逐一对齐）

- **插入点恒在当前行行尾**（`line.to`）：与光标列、光标在行内位置无关；
  光标后的文本留在当前行（不拆行内文本）。
- **列位置语义（票面点名核对结论）**：上游**不保持原光标列**——光标固定
  落**新行前缀末尾**（`newCursorPos = line.to + insertStr.length`，
  `keyboard_handlers.ts:765`）：普通行 = 列 0；列表/引用行 = 续前缀之后。
  本仓同口径（决策组「不保持原列」用例钉住）。
- **空白行**（`/^\s*$/`）：只做一次回车，插入点在空白之后（line.to）——
  新行纯空、不继承空白。
- **列表延续**（`^(\s*)([-*+] \[.\]|[-*+]|\d+\.)\s`，标记后须有空白）：
  无序延续原标记；有序 `parseInt + 1` 递增（前导零归一：`09.` → `10.`，
  仅 `数字.` 形态——`1)` 不认）；任务项 `[.]` 重置为 `[ ]`；缩进保留。
- **引用延续**（`^(\s*)(>+ ?)`）：延续 `>` 串与既有尾空格形态，缩进保留。
- 恒接管型命令：任何行（含标题、表格行、代码块内——上游不做上下文
  排除）都按行形态学决策，无「不命中」分支；上游的上下文排除只存在于
  严格换行分支（未移植）。
- **非空选区不特判**（上游口径：取 `main.head` 所在行；派发后选区被新
  光标取代，选区文本保留原处）。

### 与上游的差异

- **多选区显式透传**：上游不检查（只取 `selection.main`，CM6 派发单
  selection 会把多光标收敛为单光标）；本仓 `return false` 落穿——平台
  defaultKeymap 的 `insertBlankLine` 经 `changeByRange` 原生多光标（每光标
  下方插空行），优于上游收敛口径（对齐 #8「防御性收紧为整体透传」先例）。
- **普通缩进行不带缩进**（忠实上游）：上游仅列表/引用延续前缀，缩进段落
  行的新行是顶格的；平台 `insertBlankLine`（透传回退）反而按缩进服务自动
  缩进——接管与透传在「缩进非列表行」上行为不同（见已知边界）。
- **userEvent / scrollIntoView**：上游自定义
  `'EasyTyping.goNewLineAfterCurLine'` 且不滚动；本仓对齐 CM6 惯例
  `'input.newline'`（撤销归类正确）+ `scrollIntoView: true`（末行场景新行
  在视口外，不滚动易脱视）。
- **设置门为本仓新增**（键 `newLineBelow`，#13 起纳入 schema，见
  [settings-mapping.md](settings-mapping.md) §二表末行）：上游命令恒可用、
  无设置门——Obsidian 侧用户可解绑热键关闭；实验层 keymap 不进平台统一
  快捷键管理（#402 契约，用户无法解绑），按「组件内功能粒度开关由插件
  设置承担」补键。默认 `true`（上游「命令恒可用」的等价默认）；关闭时
  透传回平台内建 Mod+Enter（`insertBlankLine`，仅插入空行）。
- **IME 组合中与只读状态不接管**（上游无此判定；平台惯例，对齐 #8/#18）。

## 层归属与平台 Mod+Enter 仲裁（#402 四层按键优先级契约核对）

**抢先层 Prec.high**（#402 契约第 2 层「可替代平台键位，返回 false 落穿」）：

1. **平台侧 Mod+Enter 并非无主键**：vsidian 正文经 extraExtensions 装配
   `@codemirror/commands` defaultKeymap（普通优先级，位于平台情境链
   listEditing/indentEditing 之后），其中内建绑定
   `Mod-Enter → insertBlankLine`（在当前行下方插入空行 + 按缩进服务自动
   缩进，`changeByRange` 多光标原生）。若本组件用普通扩展槽（第 4 落穿
   层）注册，同优先级下按扩展序**排在平台之后**——defaultKeymap 先命中
   `insertBlankLine`，本组件 keymap 永不可达。故必须 Prec.high 抢先。
2. **接管面 = 净增量**：功能开 + 单选区 + 非组合/非只读——列表续标记/
   有序递增/任务重置/引用续前缀是平台 `insertBlankLine` 没有的能力；
   命中 `return true`，其余 `return false` 落穿。
3. **透传 ≠ 无操作**：功能关、多选区、IME 组合、只读一律落穿到平台
   `insertBlankLine`——键位永不失效（关闭本组件功能 = 回退内建「下方插
   空行」语义，设置项文案已注明）。
4. **同键竞争核对**：与 #18（Enter——折叠标题拦截）、#7（Tab——落穿层
   Tabout）**不同键位**，无同键仲裁面；平台保留键闸（undo/redo）不含
   Mod-Enter。同在 Prec.high 的本组件内按键（#8 Backspace/#11 Mod-a/
   #15 Tab/#18 Enter）互不同键，按 #402「多组件同层按装载顺序仲裁」天然
   无涉。
5. 嵌入/悬停视图不挂附加组件扩展（`reconfigureAddonExtensions` 仅转发主
   Live 实例）——Mod+Enter 在那里由平台 defaultKeymap 原生处理。

## 设置门

`newLineBelow` 生效值经 #3 设置通道（`SETTINGS_TOPIC.get`，宿主
`attachSettings` 门面合成 `effective`）：装载拉取 + 焦点回归刷新（对齐
#11/#18 门形态）；通道失败保持上次值，初始 `false`（装载即拉取，窗口可
忽略；透传方向统一为安全侧——回平台内建行为）。

## 已知边界

- **缩进非列表行的接管/透传行为分叉**：接管（上游口径）→ 新行顶格；
  透传（平台 `insertBlankLine`）→ 新行自动缩进。用户关闭设置后在缩进
  段落行按 Mod+Enter 的结果与开启时不同（前者带缩进）——上游无此对照
  面（无门控），本仓如实保留两侧行为、不擅自给接管侧补缩进延续。
- 嵌套引用 `> > `（层间带空格）上游正则只认首个 `>` 串，新行续 `> `
  少一级；`1)` 有序形态不认（#8 为退格扩展的形态不带入本票）——均保持
  上游口径。
- `09.` 前导零经 `parseInt` 归一为 `10.`（重编号非逐字符递增，上游同）。
- 浏览器真实键盘端到端（Mod-Enter 真实键序、撤销单笔回退、设置开关运行
  时翻转）归 #21 人工验证清单。

## 明确不包含

- **严格换行三模式**（StrictModeEnter/StrictLineMode 在本函数内的分支及
  独立的 `enterStrictLineBreak` Enter 拦截）：依赖 Obsidian
  `strictLineBreaks` 渲染配置语义，需先做产品决策——三方案对比与推荐见
  [ADR-0002](../adr/0002-strict-line-break-mapping.md)（**待用户决策**，
  通过后另开增量票实施；届时 Enter 键将与 #18 折叠拦截及平台列表续行
  竞争，仲裁在 ADR「实施前置」节落档）。
- 浏览器真实键盘端到端与设置页观感（#21 人工验证清单）。
