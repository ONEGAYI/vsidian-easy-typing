# Tabout——Tab 跳出配对符（工单 #7）

> 上游 easy-typing-obsidian 的 Tabout 移植：在配对符号内部按 Tab 跳出到
> 右侧闭合符之外（22 对配符），选中文本两侧被配对符包围时也可跳出。
> 领域词汇见 [CONTEXT.md](../../CONTEXT.md)「Tabout」条。

## 验收口径

- 22 对配符跳出 + 选中跳出：以**算法矩阵**（`test/tabout.test.ts`，56
  例——逐对紧贴/远距参数化 + 结构边界语义）与**拦截单元测试**
  （`test/taboutIntercept.test.ts`，14 例——真实 `EditorState` 驱动决策、
  模拟 view 驱动 Command）承载；浏览器真实键盘端到端归 #21 人工验证。
- `npm run compile` 通过；全部测试绿。
- 平台 Tab 原有行为回归无损：接入为落穿层 keymap，未命中一律
  `return false` 透传（见「平台 Tab 冲突核对」）。

## 上游对照

| 内容 | 上游锚点（v6.0.9 克隆） | 本仓落点 |
| --- | --- | --- |
| 22 对配符表 | `src/main.ts:45-48`（TaboutPairStrs） | `src/taboutAlgorithm.ts` `TABOUT_PAIRS` |
| 栈匹配算法 | `src/utils.ts:168-215`（taboutCursorInPairedString） | `src/taboutAlgorithm.ts` 同名函数 |
| Tab 拦截分支 | `src/keyboard_handlers.ts:97-135`（tabPairStringTabout） | `src/taboutIntercept.ts`（planTabout / taboutCommand） |

### 语义要点（与上游逐一对齐）

- **两遍扫描栈匹配**：第一遍扫光标左侧模拟开闭栈，栈空即不在配对内；
  第二遍找光标右侧第一个能闭合外层配对的符号。
- **两步越出**：光标紧贴闭合符 → 跳到闭合符之后（一步）；不贴 → 先跳
  到闭合符之前，再按一次贴上（两步）。
- **行内限定**：光标场景只在当前行内匹配，配对跨行不跳出。
- **自反符交替**：`$` `*` `_` `~` `=` 反引号与英文引号按出现顺序交替
  开闭；长 open 优先（`$$`/`[[`/`__` 先于单字符，嵌套整对跳出）。
- **失配 close 忽略**：栈中无对应 open 的闭符号当普通文本。
- **选中跳出**：两侧紧贴**同一对**配对符才命中（不做栈匹配，与光标
  场景互斥）；命中后光标折叠到右闭合符之后；嵌套时按表序取最外层
  （`[[` 在 `[` 前）。
- **多选区不处理**（透传）。
- 命中派发**纯选区事务**（零写回零 dirty），不滚动视图。

### 与上游的差异

- 配对表：上游以 `"【|】"` 串经 `string2pairstring` 解析（含 isRegexp /
  转义处理）；22 对全为纯字面量，本仓直接写等价对象形态，顺序保持
  原序。上游的规则级正则/转义机制属规则引擎票范围，本表不引入。
- 选区左区间负偏移显式判界（上游依赖 `sliceString` clamp，本仓显式
  `leftEdge >= 0` 判断，行为等价且不依赖实现细节）。
- 设置门控：上游读 `settings.Tabout`；本组件设置面未建（随设置票
  落地），当前恒开，接线点在 `src/page-editor.ts`（关闭 = 不注册
  keymap）。
- **票面「反引号」辨正**：票面 22 对清单中的「反引号」在上游源码中
  不属 Tabout 配对表——上游 Tab 处理链的行内代码跳出是独立分支
  （`tabInlineCodeEscape`，依赖语法树），不在本票范围。配对表 22 对
  以上游 `main.ts:45-48` 实测为准（7 全角对 + 2 英文引号 + 13 符号对）。

## 平台映射

- **实验 cm6 keymap**（清单声明 `experimental.cm6: "^1.1.0"`，保持 `^`
  范围）：`sdk.experimental.cm6.view.keymap.of([{ key: 'Tab', run:
  taboutCommand }])` 经 `sdk.registerExtension` 挂载。CM6 运行时值只经
  实验入口取得（构建桥双防线拒绝直接 `import @codemirror/*` 值）。
- **层归属**（票面评论定案）：**落穿层为主**——普通扩展槽（平台扩展
  数组末位），不用 `Prec` 抢先。命中配对场景才 `return true` 接管，
  其余 `return false` 透传。
- 实验层 keymap 不进平台统一快捷键管理（平台文档已载；用户关闭 =
  停用本组件；功能粒度开关随本插件设置票接线）。vsidian #402（按键
  拦截稳定入口与优先级契约）落地后按票内口径迁移。

## 平台 Tab 冲突核对（票面范围 3 的结论）

> 核对基线：vsidian origin/main 的 `src/webview/fenceEscape.ts`、
> `src/webview/indentEditing.ts`、`src/shared/symbols.ts`（#125/#120）。

平台 Tab 三段链按 keymap 装配顺序正序尝试：**① 围栏越界
（fenceEscape）→ ② 表格导航（tableEditing）→ ③ 正文缩进
（indentEditing）**，本组件落穿层在其后。逐项结论：

1. **19 对与平台 fenceEscape 能力重叠，本组件自然让位**。平台
   fenceEscape（#125）登记了括号 8 对（含全角 7 对与 `()` `[]` `{}`）、
   引号 4 对（弯引号与英文引号）、Markdown 强调符（`*` `_` `~` `=`
   反引号），语义同为两步越出（紧贴跳闭合符后、不贴先跳闭合符前），
   且**无选区**场景平台先接管——本组件收不到这些 Tab，行为由平台
   承担，语义兼容。`[[` 经方括号行内配对天然纳入（平台注释明载）。
2. **本组件的实际差异面是 `$` / `$$` / `<>` 三类**：平台对 `$` 显式
   不登记（行内公式无语法节点，配对边界与公式形态学不一致）、
   `<>` 不登记（不自动补全）。配对表测试钉住这两项在场。
3. **普通正文行的 Tab 被平台缩进链消费**：`indentEditing` 对普通行
   （含代码围栏、块级公式内的行）一律 `return true` 插入缩进——**落穿
   层在普通正文不可达**。落穿层实际可达的场景：
   - frontmatter 区域（平台按源码呈现、不接管 Tab）；
   - 表格内 tableEditing 放行的边界场景（如最后一格的表格导航边界）；
   - IME 组合进行中（平台不接管，但 Tabout 命中场景与组合态无交集，
     实际不构成有效接手面）。
   因此 `$` / `$$` / `<>` 的 Tabout 在 frontmatter 内可用，普通正文内
   当前**不可达**（被缩进链先消费）——这是落穿层归属的已知边界，
   不是缺陷；若后续要在普通正文实现，需抢先层（`Prec.high` 自判后
   `false` 落穿）或平台侧能力，见下节接口提示。
4. **选中跳出在落穿层同样不可达**（普通正文）：非空选区的 Tab 由
   平台缩进链接管（整行缩进，`return true`）。选区 Tabout 决策逻辑
   已实现并钉住语义，生效面同上受限。
5. **透传即回归无损**：未命中一律 `return false`——平台三段链先于
   本组件，本组件只在平台全部不处理时才被调用，`return false` 维持
   平台不处理时的原有行为（落穿到 webview 默认路径）。本组件不吞键、
   不改变平台任何接管分支的语义。

## 已知边界

- 平台 fenceEscape 的设置开关（`editor.symbolTabEscape`）关闭时，19 对
  的 Tab 越界随平台 keymap 整组退出——此时这些场景的 Tab 落入平台
  缩进链（仍非本组件），本组件行为不变（只在命中 `$` / `$$` / `<>`
  与选区包围时接管）。
- 上游 `handleTabDown` 的其余分支（tabstop 跳转、Tab 触发规则、代码
  块缩进、行内代码跳出）不在本票：tabstop 仲裁见 #15，规则引擎属
  M1 规则族票。
- 命中后不滚动视图（上游同）——跳出距离通常在一行内；如人工验证
  （#21）发现需要，再评估 `scrollIntoView`。

## 给 #15（Tabstop 仲裁）的接口提示

- 本组件 Tab 拦截位于**落穿层**（平台链之后）；#15 的 tabstop 跳转在
  上游处于 `handleTabDown` **首位**（tabstop 存在时优先于一切 Tab 分
  支）。若 #15 仍按落穿层实现，建议其 keymap 处理函数**先于**本组件
  注册（同层按装载顺序仲裁——先装载先试），或在本组件
  `planTabout` 前置一个「存在活跃 tabstop 组」的让位判定钩子。
- 本仓提供的可复用面：`taboutCursorInPairedString`（纯函数，输入行
  文本与光标）与 `planTabout`（EditorState 决策），#15 的 tabstop 判
  定可零成本复用两者做非冲突分流。
- 平台缩进链对普通正文恒接管（见冲突核对第 3 条）：#15 tabstop 若
  需在普通正文生效，与本组件面临同一可达性问题，建议一并在 #15 评
  估抢先层方案或向 vsidian #402 稳定化提出情境链内嵌槽位需求。
