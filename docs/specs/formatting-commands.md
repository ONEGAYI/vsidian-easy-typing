# 格式化命令族（工单 #28）

> 上游 easy-typing-obsidian `src/formatting_commands.ts`（307 行）五命令的
> Vsidian 移植：格式化全文（`formatArticle`）、格式化选区/当前行
>（`formatSelectionOrCurLine`）、删除空行（`deleteBlankLines`）、切换自动
> 格式化（`switchAutoFormatting`）、选区转代码块（`convert2CodeBlock`）。
> 全部走平台稳定 commands API（`sdk.commands.register`：统一快捷键管理 +
> 命令面板）；同票解锁文件排除子项（ExcludeFiles × vsidian#407 docUri）。
> 事实源模块：`src/formattingCommands.ts`（四 plan 纯函数 + 五命令定义与
> handler）、`src/fileExclusion.ts`（排除匹配纯函数）；测试：
> `test/formattingCommands.test.ts`、`test/fileExclusion.test.ts`、
> `test/autoFormatIntercept.test.ts` 排除组。

## 验收口径（票面映射）

- 五命令端到端：**真实 EditorState 状态迁移断言**承载——planner 的变更 +
  选区经 `state.update` 应用后断言终态文本与选区（上游逐条对照）；handler
  流经模拟 view（聚焦路径）与 views 面替身（命令面板路径）验证派发/写回
  形态。浏览器与真实宿主命令面板端到端归 #21。
- 快捷键注册与冲突检查：键位规范序契约测试（keyStep 序
  ctrl→alt→shift→meta，mac 形态避开 vsidian#417 永不命中形态）+ 与 #12
  纯文本粘贴（ctrl+shift+v / shift+meta+v）零重叠断言 + 平台内置同弦
  核对（见「键位」节）。
- 撤销单步还原：每命令**单笔事务**（`view.dispatch` 一次 / `applyEdits`
  单请求）——「格式化全文：单事务派发」用例钉住（一次 dispatch 携带全部
  行变更，平台撤销管线按事务分组即一步还原）。
- `npm run compile` 通过；全部测试绿（基线 913 例不回归，本票净增 48 例）。

## 命令清单

| 命令（局部 id） | 上游 id / 默认热键 | 本仓默认绑定 | mode / writes | 视图路由 |
| --- | --- | --- | --- | --- |
| `format-article` | `easy-typing-format-article` / Mod+Shift+S | `ctrl+shift+s`、`shift+meta+s` | live / true | 聚焦视图 → main 回退 |
| `format-selection` | `easy-typing-format-selection` / Mod+Shift+L | **默认未绑定**（见键位节） | live / true | 聚焦视图 → main 回退 |
| `delete-blank-lines` | `easy-typing-delete-blank-line` / Mod+Shift+K | `ctrl+shift+k`、`shift+meta+k` | live / true | 聚焦视图 → main 回退 |
| `toggle-auto-format` | `easy-typing-format-switch` / Ctrl+Tab | **默认未绑定**（Tab 固定链拒绝） | both / false | 无视图依赖（写设置） |
| `convert-code-block` | `easy-typing-insert-codeblock` / Mod+Shift+N | `ctrl+shift+n`、`shift+meta+n` | live / true | 聚焦视图 → main 回退 |

标题文案对照上游 locale（`commands.formatArticle` 等五词条）双语落
`src/i18n/`。写命令（writes=true）快捷键仅 Live 正文接管宿主绑定：宿主
VSCode 的 Ctrl+Shift+S（另存为）/ Ctrl+Shift+K（删除行）/ Ctrl+Shift+N
（新建窗口）在 Live 正文内被接管——Ctrl+Shift+K 与「删除空行」语义相邻
可接受，其余为键位评估记录项，用户可经平台快捷键管理改绑或清空。

## 上游对照

| 内容 | 上游锚点（v6.0.9） | 本仓落点 |
| --- | --- | --- |
| 格式化全文 | `formatting_commands.ts:30-61`（formatArticle） | `planFormatArticle`（全文逐行 + 光标行 ch 跟踪） |
| 格式化选区/当前行 | `formatting_commands.ts:63-92` | `planFormatSelection`（选区方向感知恢复，同行选区反向全选怪癖原样保留） |
| 行重排入口 | `preFormatOneLine`（L95-114：`formatLine(..., curCh, 0)`、`{...settings, AutoCapital: false}`） | `reformatCommandLine`（`formatLine(line, curCh, 0, {...settings, autoCapital: false})`） |
| 删除空行 | `formatting_commands.ts:134-259`（deleteBlankLines） | `planDeleteBlankLines`（保留规则逐条移植；strictLineBreaks 恒 true，见下） |
| 切换自动格式化 | `formatting_commands.ts:261-265`（内存翻转 + Notice） | `runToggleAutoFormat`（SETTINGS_TOPIC.update 写 user 层持久 + 通知通道回执） |
| 选区转代码块 | `formatting_commands.ts:267-307`（convert2CodeBlock） | `planConvertCodeBlock`（默认空语言围栏 + 光标落语言位） |
| 文件排除 | `formatting_commands.ts:7-28`（isCurrentFileExclude） | `src/fileExclusion.ts`（docUri 映射，见「文件排除」节） |

### 语义要点（票面 open question 核实结论）

- **空行定义 = 只含空白也算**：上游 `RE_BLANK = /^\s*$/`——空串与纯空白
  行都是空行（非「仅完全空行」）。
- **选区转代码块不询问语言**：上游直接生成空围栏 ``` ``` ```，光标设为
  开栏行 ch=3（语言位，随后键入即语言名）；无选区时插入空围栏骨架。
  行首/行尾非 0/EOL 时前后补 `\n` 隔离（上游 L282-289 同形）。
- **命令重排的 autoCapital 恒关**：上游两格式化命令都传
  `{...settings, AutoCapital: false}`（全量重排不做句首大写——历史文本
  会被大面积改写）；句首大写只属于键入时的 #26 行为族。
- **删除空行的 strictLineBreaks 恒 true**：上游读 Obsidian 应用配置
  `strictLineBreaks`；Vsidian 阅读渲染 markdown-it `breaks: false`
  （CommonMark 严格换行，单换行 = 软换行），语义等价 Obsidian 的
  strictLineBreaks=true——**段落间单空行是渲染结构所需，不删**；命令效果
  = 收敛连续空行为一 + 同类块（列表/引用/块 id）间空行删除、异类块间
  保留 + 水平线前被删空行回保（上游 L206-237 逐条）。上游在 Obsidian
  默认（false）下会删光所有空行——那在 CommonMark 渲染下会把段落合并，
  不适用，映射结论固化 strict 分支。
- **格式化跳过口径**（票面指定，与 #26 作用域口径一致）：代码块
  （``` / ~~~ 围栏状态机）、frontmatter（含边界行）、表格行（行首管道或
  无首管道分隔行，引用前缀感知）、整行公式（行首 $$ 块）跳过。**与上游
  差异**：上游树版 `getPosLineType` 对 table 行**会**格式化（text 与
  table 都过 formatLine）；本票按票面口径跳过表格行——文本降级无法可靠
  区分表格行与含管道文本，且 #26 键入路径同样不格式化表格（平台门控），
  两条路径口径一致。语法树版（#5 换传）可恢复上游表格行格式化，记录为
  升级点。
- **#26 规格勘误**：auto-format.md「给后续票的提示」写
  `formatLine(line, curCh, prevCh=undefined, ...)` 是命令重排入口——**不
  准确**。`prevCh=undefined` 在本移植是「跳过间距引擎」形态
  （`applyLanguagePairSpacing` 对 undefined 早退，language-pair 全不生效，
  实测无任何变更）；上游命令路径传 `prevCh=0`（键入区间 [0, curCh) 覆盖
  整行前缀，语言对全量生效）。本票按上游 `formatLine(..., curCh, 0)`
  同形实现。

## 键位（评估记录）

- **规范序书写**：所有默认绑定按平台 keyStep 归一序 ctrl→alt→shift→meta
  书写；mac 形态写 `shift+meta+X`（平台自身 `pastePlain` 的
  `meta+shift+v` 是 vsidian#417 永不命中形态，本仓避开）。
- **`format-selection` 默认未绑定**：上游默认 Mod+Shift+L 与平台内置
  `findAllOccurrences`（#238，默认 `ctrl+shift+l`）同弦；平台路由序
  **内置操作先于运行期命令**（`allKeybindingOperations()` 内置在前，
  `resolveKeybinding` 顺序命中）——同弦默认绑定结构性遮蔽，注册了也
  永不触发。用户显式改绑仍可自配（用户覆盖优先于一切默认，含内置）。
- **`toggle-auto-format` 默认未绑定**：上游默认 Ctrl+Tab 被 #125 Tab
  固定链注册期拒绝（`addonDefaultBindingsProblem` 的 `tab-forbidden`：
  任何含 Tab 本体的 chord 都会被 keybindingRouter 先于 CM6 keymap 拦截
  而破坏 Tab 三段链）。绑定入口由平台快捷键管理承担。
- **与本组件既有命令零冲突**：#12 纯文本粘贴 `ctrl+shift+v` /
  `shift+meta+v` 与五命令默认键位无重叠；#11 选择当前块默认未绑定。
- **vim / 非 vim 键位建议核对**（票面子项）：上游 v6.0.9 源码、README、
  changelog **无任何 vim 变体键位建议**（全库 grep "vim" 零命中）；上游
  仅注册固定五热键，无 vim/非 vim 分支。Vsidian 语境下 vim 模式不在本
  插件边界内（VSCode vim 类扩展自管键位映射，与本组件经平台统一快捷键
  管理注册的命令无直接交互；命令面板入口不依赖键位）——**无可移植物，
  评估记录即结论**。

## 文件排除（ExcludeFiles × #407）

上游 `isCurrentFileExclude`：ExcludeFiles 条目与 **vault 相对路径**比对
——精确相等，或条目是路径前缀且下一字符为 `/`、`\`，或条目以分隔符结尾
（文件夹条目两写法等价）；消费点在上游自动格式化输入门
（cm_extensions.ts:417）。**上游手工命令不检查排除**；本票按协调口径
命令侧亦接入（命中 → 不执行 + 通知原因），与设置页文案
「被排除的文件不受本插件影响」一致。两个消费面：

- **#26 行为族**（上游同位消费）：`AddonInputContext.docUri`（vsidian#407
  已入 main）在 `06-autoformat` 族回调内判定——`autoFormatIntercept.ts`
  的引擎配置新增 `excludeFiles` 键（同一 SETTINGS_TOPIC.get 拉取），
  `onInput` 在 autoFormat 总门之后、算法之前命中即恒 null（上游
  `!AutoFormat || isCurrentFileExclude` 同序）。多视图语义按 #407：
  embed 视图触发时 docUri 是**引用目标文档**的 URI（在 B 内触发判 B，
  不判宿主 A）。
- **本票命令**：命令回调无 view 入参，目标视图经视图路由解析后取其
  docUri（见下节）判定；命中 → 不派发 + `NOTICE_TOPIC` 通知（宿主
  `showInformationMessage`，i18n 双语，extension.ts setup 通道承接——
  与 RULE_ERROR_TOPIC 同模式，run 优先 setup 兜底）。

**URI 映射结论**（票面 open question）：docUri 是
`vscode.Uri.toString()` 全 URI（如 `file:///d%3A/Vault/DailyNote/test.md`）；
webview 侧拿不到 workspace 根路径，vault 相对路径 = 文档解码路径的**段
边界后缀**（相对任一目录前缀）。`isDocUriExcluded` 的判定分解：URL 解析
pathname + `decodeURIComponent`（坏编码回退原文）→ '\' 归一 '/' → 去
首部 '/' → 逐段边界枚举后缀套用上游精确/带边界前缀规则。条目归一：'\'
→ '/'、去首部 '/'、首尾空白修剪（上游不修剪；设置页数组条目带杂散空白
时更宽容，测试钉住）。已知近似：多根工作区任一根的边界都命中；路径中部
同名目录（`/v/sub/DailyNote/x.md` 对条目 `DailyNote/`）也命中——记录为
已知边界，精确化需 workspace 根可见性（平台未暴露，#21 人工验证项）。

## 视图路由与撤销

- **目标视图解析**：命令回调 `() => void` 无 view 入参——复用 **#12 的
  `viewRegistry` 共享实例**（`createEditorViewRegistry`，page-editor 同
  工厂作用域内 #12 块位置在前；不另建实例，评估结论：ViewPlugin 登记面
  全页唯一语义，两套登记表反而引入「命令面板兜底视图」与「登记表视图」
  不一致的可能）。聚焦视图优先（快捷键入口）；无聚焦且唯一在场视图兜底；
  多视图无聚焦 → **views 面 main 句柄回退**（命令面板入口）：快照 →
  计划 → `applyEdits` 单请求（`history: 'atomic'`，镜像 #11 select-block
  的双路径形态，但含文本写回）。
- **嵌入视图口径（审查 B-F3 修复）**：执行前校验焦点元素——属于某个
  CM6 视图（`EditorView.findFromDOM(activeElement)` 命中）但**不在登记表**
  即为嵌入/悬停实例（平台事实：附加组件扩展槽仅挂主正文 Live 实例，
  viewRegistry 永远只登记主实例）：此时**拒绝执行**并 debugLog 留痕
  （不走唯一在场视图兜底、不走 main 回退）——用户意图是嵌入文档，
  兜底目标会把命令写到主文档（误目标）。焦点无 CM6 归属（命令面板入
  口，焦点在宿主 UI）不受影响，照常走兜底。#12 纯文本粘贴命令同口径
  （`plainPasteCommand.ts`）。
- **docUri 关联**（排除判定用）：单一可写视图 → 其 `targetDocUri`（多数
  场景精确）；多视图 → 各句柄快照 text 与聚焦视图 doc 内容比对关联（#407
  「按实际触发文档判定」的多视图近似——CM6 视图与 instanceId 无直接映
  射面）；关联失败回退 main。已知边界：多视图 + 焦点在 embed 且内容与
  main 一致时判 main 的 URI（同文不同档的退化场景）。
- **守卫**：IME 组合中 / 只读视图不派发（#12/#13 同口径）；排除命中不
  派发并通知。
- **撤销**：聚焦路径单笔 `view.dispatch`（changes + selection + 自定义
  `userEvent: 'input.easyTyping.*`——不以 `input.type` 开头，行为链
  （#25/#26/#9）不驱动，无双写）；回退路径单 `applyEdits` 请求。平台撤
  销管线按事务分组 → 一步还原（与 #26「键入与格式化两步撤回」的边界一
  致：命令重排整体是外来一笔）。

## 已知边界与升级点

- **表格行跳过**（见语义要点）：上游树版格式化表格行，本票口径跳过；
  #5（语法树换传）落地后可恢复，届时 `classifyFormatSkipLines` 换树版
  行类型即可，plan 层零改动。
- **行分类近似**（继承 #25 文本降级）：无首管道且非分隔行形态的表格行
  （GFM 允许省略首尾管道的普通行）按文本格式化；`$$` 只认行首形态（行中
  `$$` 开栏不识别）；引用块内围栏（`> ``` `）不进围栏状态机（上游 callout
  内代码块另有专门回溯逻辑，本降级引用内围栏内容按文本处理——引用行本
  身仍是文本行，上游同判 text）。
- **光标恰在脚本边界时不插空格**（上游怪癖忠实保留）：光标行传真实
  cursorCh，`formatLine` 的 token 中心算法在光标恰落在语言对边界上时该
  边界不插（如 `中文|abc` 光标在边界 → 无变更；光标进词内 → 插）。上游
  命令同形（preFormatOneLine 传真实 ch）。
- **删除空行不动选区**：上游 setValue 重建全文（选区丢失）；本仓变更式
  删除不传显式选区，CM6 按变更自动映射（优于上游，非语义放宽——上游无
  选区保持语义可保）。
- **toggle 生效时延**：翻转写回后 #26 族的下一次键入即读到新值（族门
  在每次输入的 onChanged 刷新）；本命令本地缓存即刻 refresh，命令族自身
  立即可见。

## 给 #21（人工验证）与平台提示

- #21 验证点：五命令经快捷键与命令面板双入口的端到端（含多视图场景：
  embed 内聚焦触发格式化命令——**拒绝执行且主文档零变更**（审查 B-F3
  后的口径：嵌入实例不经登记表，拒绝优于误写主文档；平台暴露嵌入视图
  句柄映射前的边界））；Ctrl+Z 一步还原
  四视图写命令；排除清单命中命令的提示出现；切换命令后键入格式化即刻
  开/关；`Ctrl+Shift+S/K/N` 在 Live 正文接管宿主绑定（另存为/删除行/
  新建窗口不触发）且清空绑定后宿主绑定恢复。
- 平台提示（拟提 vsidian 仓）：① 命令回调可考虑携带目标视图句柄（如
  ui.registerButton 的 `onClick(target)` 形态）——多视图下命令的 docUri
  关联目前靠内容比对近似；② `chordContainsTab` 拒绝 `ctrl+tab` 使上游
  Ctrl+Tab 默认键无法注册，若平台未来放开非裸 Tab 的 chord，可恢复该
  默认绑定。
