# CommentToggle——注释切换命令（工单 #2）

> 上游 easy-typing-obsidian 的注释切换命令移植（`toggleComment`，命令 id
> `easy-typing-toggle-comment`，默认热键 `Mod+/`，上游 `main.ts:186-191`）。
> 代码块内按围栏语言查注释符表切换行注释；Markdown 正文用 `%%` 包裹/解包。
> 自带 26 键语言注释符表（21 语言 + 别名），自包含性强。

## 验收口径（票面映射）

- 注释符表与切换逻辑单测全绿：**符号表矩阵**（`test/commentToggle.test.ts`
  「注释符表」组——上游表 26 键逐键钉住）+ **行切换纯函数矩阵**（「行注释
  切换矩阵」组——上游 `comment_toggle.ts:64-128` 单行符/块符对/空白行三态
  逐形态对照）承载。
- 端到端抽查 3+ 语言：**决策单元**（「代码块语言感知端到端」组——真实
  `EditorState` 驱动计划与应用，python / js / sql / css / html 五语言注释
  ↔ 取消一去一回 + 多行批量）承载——矩阵承载即本票口径，浏览器真实键盘
  端到端归 #21。
- `npm run compile` 通过；全部测试绿（基线 949 例不回归）。

## 上游对照

| 内容 | 上游锚点（v6.0.9 克隆） | 本仓落点 |
| --- | --- | --- |
| 语言注释符表 | `src/comment_toggle.ts:192-223`（getCommentSymbol 内联表） | `src/commentToggle.ts`（COMMENT_SYMBOLS + getCommentSymbol） |
| 行/块注释切换 | `src/comment_toggle.ts:64-128`（toggleCodeBlockLineComment） | 同上（planLineCommentToggle，逐字移植） |
| 代码块判定 | `src/syntax.ts:85-146`（getCodeBlocksInfos，语法树版） | 复用 `src/ruleScopeFallback.ts`（#25 正则降级版，见下节） |
| 编排（代码块/正文分流） | `src/comment_toggle.ts:4-13` | 同上（planCommentToggle） |
| Markdown `%%` 切换 | `src/comment_toggle.ts:130-190` | 同上（planMarkdownCommentToggle） |
| 命令注册 + 默认热键 | `src/main.ts:186-191`（editorCallback + Mod+/） | `src/page-editor.ts` #2 增量块（稳定 commands API） |

### 语义要点（与上游逐一对齐）

- **代码块内**（选区起点处围栏语言已知）：
  - 单行符（`//` `#` `--` `%`）：无注释 → 缩进后插入 `符号␣`；已注释 →
    移除符号及至多一个尾随空格（`// foo` → `foo`、`//foo` → `foo`）；
  - 块符对（`/* */` `<!-- -->`）：无注释 → 缩进后整行包裹
    `start␣text␣end`；已包裹 → 解包（移除 `start␣` 前缀与 `␣end` 后缀）；
  - 空选区在空白行：光标处插入 `符号␣`（块符为 `start␣␣end`），光标移
    到首个空格后；
  - 有选区：对**跨到的每一行**独立切换（`lineAt(from)` 到 `lineAt(to)`，
    终点恰在行首该行仍计入——上游 lineAt 口径），空白行跳过，全部变更
    **单事务**派发（撤销一笔回退）、不带显式选区（光标随变更映射）；
  - 未知语言（表外或无信息串）：无操作（上游 return false）。
- **Markdown 正文 `%%`**：
  - 空选区：光标处插入 `%%␣␣%%`（光标落两空格之间，from+3）；光标已在
    `%%␣␣%%` **正中**（前后各 3 字符恰成对）→ 整对删除、光标回退对首；
  - 选中文本：首尾已 `%%` → 解包（`slice(2, -2)`）；否则**紧贴包裹**
    `%%文本%%`（无空格——上游口径，区别于代码块分支的带空格包裹）。
- 恒命中型命令：正文路径任何位置都有动作（上游 toggleMarkdownComment 无
  「不命中」分支）；代码块路径的「无动作」仅未知语言一态。

## 围栏语言感知选型（复用 #25 降级版）

**选型：复用 `src/ruleScopeFallback.ts` 的 `detectScopeFromText`**（工单
#25 已落地的文本正则降级版），不另建识别器、不复用 #11 `blockScan.ts`
（后者只给行 kind 不提取语言）。理由：

1. 形状对口：`detectScopeFromText(docText, pos)` 直接返回
   `{scope: Code, language}`——语言正是本票决策输入，围栏状态机
   （```/~~~ 同字符关闭、长度不短于开栏、缩进 ≤3 空格）已含语言提取；
2. #11 `scanLines` 的围栏近似（不校验围栏字符/长度配对）语义弱于 #25 状态
   机，且无语言通道，取它需扩表；
3. 单一事实源：#5（语法树版围栏识别）落地后 ruleScopeFallback 整体升级，
   本票调用面（scope + language 形状）不变，同步零成本。

**#5 升级点（票内记录）**：`planCommentToggle` 的作用域判定换成树版后，
仅需替换 `detectScopeFromText` 调用；「降级口径」节的差异随 #25 文档同步
收敛。

### 降级口径（vs 上游树版，沿 #25 已 documented 差异）

- **围栏标记行走 `%%` 分支**：上游树版把开/关围栏行划入代码块区间
  （`pos >= start_pos && pos <= end_pos`），光标在开栏行会按语言在围栏
  行上写注释前缀（`// ```python`——破坏围栏的形态）。降级版「光标行本身
  是围栏标记行 → Text」：开栏行走 `%%` 分支（测试钉住），语义更稳。
  关栏行行首光标的可见片段为空（扫描只看光标前文本）→ 仍按代码内容处理，
  与上游树版一致；关栏行末光标（可见整行围栏标记）→ Text，与上游不同
  ——极端位置差异，不追求一致。
- **多词信息串取词差异**：上游树版提取围栏后整串 trim（`js copy` →
  `'js copy'` 查表不中 → 无操作）；降级版取信息串首 token（`js copy` →
  `js` → 命中切换）。降级版更宽松，也更贴近渲染器按首 token 取语言的
  习惯——如实保留差异，#5 树版落地时随上游收敛。

## 平台键位冲突核对（票面「快捷键评估」）

- **默认键位 `['ctrl+slash', 'meta+slash']`**（上游 Mod+/ 的平台双形）：
  规范修饰键序（单修饰天然规范）+ **词形键名 `slash`**——裸 `/` 不在平台
  `validKey` 表（vsidian `src/shared/keybindings.ts` keyStep 把
  `event.key='/'` 归一为 `slash`，注册面只认词形）。
- **与平台内建 htmlComment 同弦并存**（resolveKeybinding 优先序：用户
  覆盖 → 默认值，同轮**内置操作先于运行期组件命令**——与 #12
  ctrl+shift+v 与平台 pastePlain 并存同型）：
  - 平台 #139 `htmlComment`（`<!-- -->` 两态插入）默认 `ctrl+slash`——
    默认状态下 Windows/Linux 的 Ctrl+/ **平台命令先命中**（HTML 注释语
    义照常执行），本命令同弦不互斥吞键（路由层单选，无双重执行）；
  - mac 的 Cmd+/ 产出 `meta+slash`，平台 htmlComment 无此绑定 → **本命令
    命中**；
  - 用户改绑任一侧（平台快捷键管理清空/改绑 htmlComment，或给本命令绑
    其他键）后，相应入口归本命令；命令面板入口恒可用。
  - 语义重叠评估：平台 htmlComment 是 HTML 注释语法、恒 `<!-- -->`；
    本命令是**语言感知**注释（代码块内 `//`/`#`/`--`/`/* */` 等 21 语言）
    + Obsidian `%%` 正文注释——净增量，非同功能重复。
- **无实验层 keymap**：本命令仅经稳定 commands API 注册（统一快捷键管理
  + 命令面板），不挂 Prec 层、不与 #7/#8/#15/#18/#13 的实验层按键竞争
  （不同注册面，无同键仲裁）。

## 与上游的差异

- **视图路由**：上游 `editorCallback` 直收 `editor.cm`；平台命令回调无
  view 入参，**复用 #12 的 `createEditorViewRegistry`**（ViewPlugin 登记
  在场编辑器，聚焦者优先，无聚焦唯一视图兜底——`src/plainPasteCommand.ts`）。
  **共享决策（供并行工单 #28 对照）**：命令类工单统一复用该登记表 +
  `createViewTrackerExtension` 扩展，不另建第二套视图捕获；#28 若需相同
  路由，直接 import 同一工厂。
- **IME 组合中与只读不动作**（上游无此判定；平台惯例，对齐 #12/#13）。
- **userEvent 用 CM6 惯例 `input.comment`**（上游自定义
  `'EasyTyping.toggleComment'`，对齐 #13 采用 `input.*` 族的先例）。
- **多选区只处理主选区**（上游同口径只取 `selection.main`）：不显式透传
  （命令无落穿面），非主选区光标随变更映射。
- 设置门：**不设**（上游命令恒可用；稳定 API 命令的「关闭」由用户在平台
  快捷键管理解绑/清空实现，无需组件内开关——区别于实验层 keymap 必须配
  设置门的 #13/#18 先例）。

## 已知边界

- **块符无空格包裹形态沿用上游切片口径**：解包按「`start␣` 前缀 +
  `␣end` 后缀」固定位切片（`trimmedText.slice(start.length+1,
  -end.length-1)`），手写 `/*foo*/`（无空格）解包会丢字符（→ `o`）——
  本命令自身的包裹产物（`/* foo */`）一去一回无损；忠实移植，测试钉住。
- **块符解包要求整行 trim 后首尾匹配**：`/* x */ foo`（尾随文本）不算已
  包裹，会二次包裹——上游口径。
- `%%` 解包按首尾 2 字符判定：恰选 `%%` 两字符 → 删除（startsWith 与
  endsWith 同侧命中）——上游口径。
- 多选区只处理主选区（见上）；`meta+slash` 在 Windows/Linux 物理不按下
  （默认绑定双形并存是平台形态，无副作用）。
- 浏览器真实键盘端到端（Ctrl+/ 真实键序、与平台 htmlComment 的路由实况、
  多行批量切换观感、撤销单笔回退）归 #21 人工验证清单。

## 明确不包含

- **上游 BetterCodeEdit 的其他代码块增强**（Cmd+A 选中、Tab、删除、粘贴
  的代码块分支）：独立功能票，注释符表不随之扩张。
- **语言表扩张**（`c++`、`c#` 全名、`r`、`lua` 等）：上游表 26 键逐条
  移植为本票边界；新语言随上游同步或另开票。
- 行内（选中行内片段而非整行）注释切换：上游代码块分支只做行级，正文
  分支 `%%` 是选中片段级——形态差异是上游语义，不拉平。
