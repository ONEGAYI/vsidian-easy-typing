# BetterCodeEdit——代码块编辑增强（工单 #10）

> 上游 easy-typing-obsidian 的 BetterCodeEdit 功能族移植：代码块内
> Mod+A 渐进选择（内容 → 整块 → 全文）、多行粘贴自动对齐块缩进、列表
> 下缩进代码块的 Backspace 删除优化。上游六项子能力经 vsidian 内核逐项
> 核对（票面必选前置调研）：**三项内核已有等效直接跳过**（不写一行接入
> 代码，只在此留档口径差异与内核锚点），**三项接入**。设置共享
> `betterCodeEdit` 键（`src/settings/definitions.ts`，出厂默认开——上游
> BetterCodeEdit 同默认 true，六项共享一个总开关无逐项开关，保持不拆分）。

## 验收口径

- 三项接入以**算法矩阵 + 拦截单元测试**承载（fake 层口径，`test/
  syntaxFake.ts` 构造平台判定链 fake）：
  - `test/codeBlockModA.test.ts`（15 例）：三态链状态机（内容/整块/
    落穿）、围栏行命中、反向选区规整、空块、多选区、查询拒绝、Command
    门控与纯选区事务形态；
  - `test/codeBlockPaste.test.ts`（21 例）：剥共同缩进（含首行无缩进时
    共同缩进为 0 的实然形态）、\t 替换、顶格/缩进块、单行/选区/块外
    透传、上游实然边界（全空行、混合空行、CRLF）、handler 三守卫与
    派发形态；
  - `test/codeBlockBackspace.test.ts`（19 例）：分支①（边界列删换行
    合并，含未闭合块与闭栏行实然）、分支②（选区跨界裁剪）、让位面
    （顶格块/开栏行/缩进段中段/行首/行尾/块外）、多选区、查询拒绝、
    Command 门控与单笔事务形态。
- 真实键位仲裁（三态手感、表格格内边界、与 #8 让位共存）归 #21 人工
  验证清单（docs/manual-verification.md「十八」节）。
- `npm run compile` 通过；全部测试绿（基线 1312 例不回归）。

## 六项内核核对结论（票面必选前置调研）

| # | 子能力 | 内核核对结论 | 处置 |
| --- | --- | --- | --- |
| 1 | 块内 Tab 缩进 | **内核已有**：vsidian #120 `indentEditing`（`src/webview/indentEditing.ts:46-47` CODE_NODES = FencedCode/CodeText/CodeBlock；`:142-149` 普通行单位固定 2 空格、整行制：受影响行行首加空白） | **跳过**。口径差异：上游 `tabCodeBlockIndent`（keyboard_handlers.ts:32-54，门控是 Tabout 非 BetterCodeEdit）在光标位插入一个缩进字符（Obsidian 默认 `\t`，单字符插入制） |
| 2 | Enter 保持缩进 | **内核已有**：CM6 defaultKeymap `Enter → insertNewlineAndIndent`（vsidian `src/webview/main.ts:59-62` 装配；`@codemirror/commands` 的 insertNewlineAndIndent 在语言缩进服务为 null 时复制当前行前导空白列数、经 indentUnit 重生成） | **跳过**。口径差异：CM6 按「列数 + indentUnit（2 空格制）」重生成，上游逐字复制原行前缀（可保留 `\t`）。vsidian listEditing 明确不接管代码围栏，块内 Enter 即落 CM6 默认 |
| 3 | 块内 Mod+A 三态选择 | **内核缺失**：Live 正文 Mod-a = defaultKeymap selectAll 全文；本仓 #11 已显式留口（`src/modaSelection.ts:92-93`「上游 BetterCodeEdit 的代码块选中属另一功能族」） | **接入**（本票） |
| 4 | 块内粘贴缩进对齐 | **内核缺失**：#314 富文本粘贴、#161 图片粘贴、#12 SmartPaste（列表/引用续接）均无代码块缩进对齐 | **接入**（本票） |
| 5 | 缩进代码块删除优化 | **内核缺失**：listEditing 的 stripListLayer 明确不接管代码围栏；defaultKeymap deleteCharBackward 普通删字符，缩进块逐行收敛时残留缩进空白 | **接入**（本票） |
| 6 | 行内代码 Tab 跳出 | **内核已有**：vsidian #125 `fenceEscape`（`src/webview/fenceEscape.ts:47` 块码节点不含 InlineCode；`src/shared/symbols.ts:244-246` TAB_ESCAPE_TREE_NODE_NAMES 含 InlineCode）两步越出（先闭标记左边界、再越过） | **跳过**。口径差异：上游未闭合反引号扫到行尾跳行尾+1（keyboard_handlers.ts:86-91）；#125 对不成对形态保守落穿（缩进） |

三项跳过的处置原则：**内核口径优先，本组件不另起炉灶**。第 1 项若用户
反馈想要 tab 字符语义，那是内核 #120 的口径问题（会破坏「表格 → 缩进 →
越界」三段链的整行制一致性）；第 2 项 CM6 重生成空白对块内已有 `\t` 的
行有规整效果，影响极窄；第 6 项 #7 Tabout 的配对表不含反引号（与上游
TaboutPairStrs 一致），不会与 #125 重复触发。

## 上游对照

| 内容 | 上游锚点（v6.0.9） | 本仓落点 |
| --- | --- | --- |
| Mod+A 三态（selectCodeBlockInPos） | `src/syntax.ts:43-83`；调用点 `src/keyboard_handlers.ts:672-676`（handleModA 链尾） | `src/codeBlockModA.ts`（planCodeBlockModA） |
| 粘贴缩进对齐（transactionFilter 分支） | `src/cm_extensions.ts:112-166` | `src/codeBlockPaste.ts`（planCodeBlockPaste） |
| 删除优化（transactionFilter 分支） | `src/cm_extensions.ts:279-324` | `src/codeBlockBackspace.ts`（planCodeBlockBackspace） |
| 代码块信息（getCodeBlocksInfos） | `src/syntax.ts:85-153` | `src/syntaxTreeQuery.ts`（codeBlockAtViaQuery，#5 落地） |
| 默认缩进字符（getDefaultIndentChar） | `src/main.ts:285-292`（读 Obsidian vault 配置，默认 `\t`） | **无对应**——固定 2 空格（见「实施决策点」） |

### Mod+A 三态语义要点（与上游逐一对齐）

- pos 取 `selection.anchor`；块识别用 `codeBlockAtViaQuery`
  （**闭区间含围栏两端**——上游 getCodeBlockInfoInPos 同语义，光标在
  开栏/闭栏行也命中，首按选内容）。
- 非空块三态：未选中 → 选**内容** `[首内容行.from, codeEndPos]`——注意
  `首内容行.from` 是行首（不含 code 行自身缩进列），与 codeStartPos 的
  「行首+indent」不同；已选内容（anchor/head 原序精确等值）→ 选**整块**
  `[startPos, endPos]`；已选整块 → return false 落穿平台全文全选。
- 选区比对按 anchor/head **原序**（上游口径：反向选区不匹配内容档，首按
  规整为正向选区）。
- 派发**纯选区事务**：`view.dispatch({ selection })`，零写回零 dirty、
  **不带 userEvent**（上游三处 dispatch 均无）。

### 粘贴对齐语义要点（与上游逐一对齐）

- 命中条件：betterCodeEdit 门 + 纯插入（无选区，上游 fromA == fromB）+
  `codeBlockAtViaQuery` 命中（含围栏行）+ **多行粘贴**（单行不接管）。
- 文本变换：各行剥最小共同缩进（**忽略空行计算**——首行无缩进时共同
  缩进为 0，各行自身缩进保留并叠加 base_indent）；行内 `\t` 全部替换；
  **第一行不加前缀**（粘贴点已在光标处），其余行前缀 `' '.repeat(indent)`
  （base_indent = 块围栏缩进列，列表下缩进代码块由此对齐）。剥缩进的
  长度按原字符计数、替换发生在剥之后（上游两步顺序）。
- 上游实然边界照抄：全空行多行文本 min_indent 为 Infinity，
  `substring(Infinity)` 得空串——各行规整为空行（其余行加 base_indent）；
  空行不参与最小缩进计算但同样被剥 + 加前缀（变 base_indent 串）。

### 删除优化语义要点（与上游逐一对齐）

- 命中条件：betterCodeEdit 门 + 无选区门槛的**折叠光标**（分支①）或
  单选区（分支②，见「实施决策点」）+ `codeBlockAtViaQuery` 命中（pos
  取删除落点 to）+ 光标不在开栏行（to > 开栏行行尾）+ **仅 indent ≠ 0**
  （顶格块完全不接管）。
- 分支①（光标恰在缩进边界列，to == 行.from + indent）：删除范围改为
  「上一行行尾 → to」——连换行带缩进一起删，当前行合并到上一行。
- 分支②（删除跨越缩进边界，from ∈ [行首, 行首+indent) 且 to > 行首+
  indent）：删除范围裁剪为 [行首+indent, to]——只删内容列以右，缩进
  列保留。
- 实然行为照抄：闭栏行的缩进边界列同样命中分支①（块识别闭区间含闭栏
  行——闭栏行与上一内容行合并）；未闭合块的首内容行边界列命中分支①
  时「上一行」是开栏行（内容行并进开栏行）。

## 实施决策点（与上游的显式差异，均在此留档）

1. **\t 替换目标固定 2 空格**：上游把粘贴文本行内 `\t` 替换为「默认缩
   进字符」（读 Obsidian vault 的 useTab/tabSize 配置，默认 `\t`）；
   vsidian 附加组件无 vault 配置源，固定 2 空格对齐内核 indentUnit 与
   #120 整行缩进口径。
2. **Mod+A 门控用 betterCodeEdit（非 #11 的 enhanceModA）**：上游两开关
   独立（EnhanceModA 关闭时代码块三态仍生效；反之亦然）。实现为 #11
   keymap **合成一条链**：`modARun(view) || codeBlockModARun(view)`——
   各带各的门，OR 形态直接承载两开关独立语义；且避免 #11 透传按键的
   refresh hook（透传时顺带拉新设置）被中间 keymap 打断。
3. **userEvent 对齐平台惯例**：删除/粘贴分别用 `delete.backward` /
   `input.paste`（+ scrollIntoView），不用上游自定义 `EasyTyping.change`
   （上游用它隔离自身事务防 transactionFilter 重入；本仓无 filter 重入
   面，且平台行为链 delete 白名单靠标准 userEvent 观察——#8/#12 先例）。
4. **空块二次按下落穿**：上游空块（codeStart == codeEnd）路径无条件
   dispatch 选整块（return true——重复派发同选区，Mod+A 永远到不了平台
   全选）；本仓改为「已选整块 → 落穿」，三态链闭环与非空块一致。
5. **删除分支②消费面定为单选区**：上游 `!selected` 门槛排除非空选区、
   折叠光标单字符删除 [to-1, to] 又经数理推演不满足分支②条件（`to-1 <
   行首+indent ≤ to-1` 对整数矛盾）——分支②在上游 filter 形态不可达。
   本仓 keymap 形态把消费面定为单选区删除（Backspace 删除选区即
   [sel.from, sel.to]），使「跨边界裁剪保留缩进列」语义可达：行为净增量
   且与分支①「缩进列不吞」意图一致；选区未越边界（缩进段内纯空白选区）
   仍透传，与上游 !selected 的保守方向一致。分支①相应限折叠光标（上游
   本就是光标语义）。
6. **拦截路径：粘贴/删除均不用上游 transactionFilter**：粘贴走
   `domEventHandlers({ paste })`（#12 选型三条理由——附加组件 filter 逆
   序先行会破坏富文本粘贴的分步撤销契约 / updateListener 补第二笔拆两次
   撤销 / domEventHandlers 天然获得平台让位序）；删除走 keymap（本仓
   filter 层无先例，且按键时刻状态完备——codeBlockAtViaQuery + 行坐标
   都是按键时可读的，无事务改写必要）。

## 平台映射

- **Mod+A**：并入 #11 抢先层 keymap（Prec.high）合成链——#11
  planModASelection 返回 null（含代码围栏内显式透传的留口）→ #10 三态
  → return false 落穿平台 selectAll。上游正是 handleModA 链尾结构。
- **粘贴对齐**：普通扩展槽 `domEventHandlers({ paste })`，**注册序在
  #12 SmartPaste 之前**（domEventHandlers 按扩展序执行，先注册先执行）
  ——对齐上游 cm_extensions.ts 分支顺序（代码块分支 112 在 SmartPaste
  分支 168 之前）：多行粘贴进代码块命中即接管，SmartPaste 不再看；代码
  块内行尾粘贴不会被列表/引用续接抢走。落穿层让位序：平台富文本/图片
  粘贴处理器在前（图片粘贴进代码块归平台资产管线），本层只拦纯文本多行。
  handler 事件可见即置 pasteDetected（#26 联动缝；注册在 #12 之前，
  接管路径自置、透传路径 #12 随后亦标记——幂等）。
- **删除优化**：抢先层 Prec.high Backspace，**注册序在 #8
  BetterBackspace 之后**（同层按装载顺序仲裁，#8 空项场景先试）。接管面
  极窄（仅 indent ≠ 0 块的两类边界删除），与 #8 的空列表/引用项、平台
  symbolAutocomplete 删空对 / listEditing 退格清层 / tableEditing 表格
  删除场景互斥。
- 公共接线：决策纯函数（`plan*`，node 下可单测）与 Command/intercept
  层分离；代码块边界识别一律消费 `src/syntaxTreeQuery.ts` 的
  `codeBlockAtViaQuery`（查询拒绝 ok:false → null 不接管，不 fallback
  正则）；`@codemirror/*` 仅 type-only 导入，运行时值经
  `sdk.experimental.cm6`；LF 坐标直通；多选区防御性透传（#11 惯例）；
  粘贴三守卫（IME 组合 / 只读 / 不可编辑，#12 同款）。
- 实例边界：当前平台附加组件扩展槽仅挂主正文 Live 实例（developer-guide
  §4.1 契约）——三项能力天然只在主正文生效；不把「view 一定是主正文」
  写进逻辑，键位回调直接消费 view.state + queryOfView。

## 已知边界

- 光标在**开栏行/闭栏行**时 Mod+A 三态与粘贴对齐仍命中（上游闭区间含
  围栏两端的实然语义）；闭栏行的缩进边界列 Backspace 会把闭栏行并进上
  一内容行。均为上游实然行为照抄，非缺陷。
- 粘贴对齐的首行语义：粘贴文本首行无缩进时共同缩进为 0，其余行**自身
  缩进保留并叠加 base_indent**（如 2 缩进块粘贴 `aa\n  bb` 得
  `aa\n    bb`）——上游实然，若观感不符预期属上游口径继承。
- 顶格代码块（indent=0）的 Backspace 完全不接管（上游语义：删除优化只
  服务列表下缩进块）；Mod+A 与粘贴对齐不受此限。
- 折叠光标下分支②不可达（单字符删除不构成「跨越缩进边界」形态），其
  消费面是单选区删除——见「实施决策点」第 5 条。
- 真实键位仲裁（IME 定稿期、物理键盘长按连发、表格格内边界）归 #21
  人工验证清单十八节。
