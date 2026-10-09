# SmartPaste 与纯文本粘贴标记（工单 #12）

> 上游 easy-typing-obsidian 的智能粘贴移植：在列表/引用内粘贴时按粘贴
> 内容自身形态（是否列表形态）逐行加前缀与缩进续接；配套纯文本粘贴标记
> （Mod+Shift+V 跳过自动格式化）。领域词汇见 [CONTEXT.md](../../CONTEXT.md)
> 「SmartPaste」「纯文本粘贴标记」条。

## 验收口径

- 列表/引用 × 粘贴内容类型矩阵：以**算法矩阵**（`test/smartPaste.test.ts`，
  31 例——目标行前缀识别、公共缩进、列表形态判定边界、列表/引用目标 ×
  单行/多行/列表/嵌套/续行/空行/Tab/substring 边界）与**拦截单元测试**
  （`test/smartPasteIntercept.test.ts`，22 例——真实 `EditorState` 驱动命中
  条件、模拟 paste 事件驱动处理器接管/透传/派发形态、让位面与平台交界语
  义、双实现对照）承载；浏览器真实剪贴板端到端归 #21 人工验证。
- 纯文本粘贴不触发格式化：**标记矩阵**（`test/pasteMarker.test.ts`，9
  例——窗口/续窗/一次性消费/到期）与**命令单元测试**
  （`test/plainPasteCommand.test.ts`，13 例——命令定义契约、视图捕获、
  剪贴板双级读取、执行流标记-派发链）承载；格式化管线本身归 #26（本票
  只交付标记与联动缝）。
- `npm run compile` 通过；全部测试绿（基线 273 例不回归，本票后 348 例）。

## 上游对照

| 内容 | 上游锚点（v6.0.9 克隆） | 本仓落点 |
| --- | --- | --- |
| 续接纯计算（目标识别/公共缩进/列表形态/三分支） | `src/cm_extensions.ts:168-263`（SmartPaste 分支） | `src/smartPasteAlgorithm.ts` |
| 粘贴命中条件（纯插入 + 行尾 + 目标行）与事务接管 | `src/cm_extensions.ts:168-263`（transactionFilter 重写） | `src/smartPasteIntercept.ts`（planSmartPasteInsert / domEventHandlers 处理器） |
| 纯文本粘贴双标志（markPaste 500ms 窗口） | `src/main.ts:274-283` | `src/pasteMarker.ts` |
| Mod-v / Mod-Shift-v 键位标记 | `src/main.ts:75-83` | 事件级标记（paste 处理器）+ 命令（`src/plainPasteCommand.ts`） |

### 语义要点（与上游逐一对齐）

- **命中条件**：粘贴事务为纯插入（无选区替换）且插入点恰在**行尾**，目标
  行为列表（`-`/`*`/`+`/`1.`/任务 `- [x]` 标记 + 空格）或引用（`>` 连续
  串，无尾随空格也算，`> > ` 取首段）——上游四个条件的文本形态学等价。
- **公共缩进剥离**：非空行最小前导空白先剥；空行短于公共缩进剥至空串、
  长于公共缩进剥去前缀（JS `substring` 缺省 end = length 的区间语义，
  上游同）。
- **列表形态判定**（paste_list）：每行为列表项/空行，或缩进 ≥ 公共缩进+2
  的续行——「列表项 + 换行续文」才算；混入缩进不足的非列表行即整体退回
  逐行加前缀分支。
- **三分支续接**：列表目标 × 列表形态 → 首项**剥标记并入当前项**（当前项
  已持前缀）、其余项剥公共缩进后带目标缩进**保留自身标记**（不重编号）；
  其余 → 首行原样、其余行加目标前缀（引用目标粘贴列表 → 引用内列表；
  粘贴引用内容无特判）；粘贴内容中的 Tab 替换为缩进单位。
- **纯文本标记**：普通/纯文本粘贴都置 `pasteDetected`（500ms 窗口）；
  `plainPasteInProgress` 只由纯文本意图置位、**一次性消费**、窗口内普通
  标记不清除（上游 `if (plain)` 语义——纯文本粘贴链路中的事件级标记不
  冲掉意图）。
- 接管派发**单笔插入事务**，一次撤销整体回退（上游同）；光标落插入末尾。

### 与上游的差异

- **拦截路径**：上游经 `EditorState.transactionFilter` 重写粘贴事务；本仓
  经 `EditorView.domEventHandlers({ paste })` 拦截原生事件（选型理由见
  「平台映射」节——上游形态在 vsidian 会破坏平台粘贴契约）。
- **恒等透传**：上游命中目标行即无条件重写事务（内容不变也换成自定义
  userEvent `EasyTyping.change`——其格式化观察器靠 `pasteDetected` 标志补
  偿识别）；本仓恒等续接（结果 === 归一原文，如单行纯文本、全空行）交还
  原生粘贴链，命中才接管且 userEvent 保持 **`input.paste`** + `scrollIntoView`
  （对齐 CM6 doPaste 派发形态——平台撤销归类正确，#26 直接按事务识别
  粘贴，无需标志补偿）。
- **命中面收窄到单折叠光标**：上游逐 change 判定（多光标纯插入理论上逐点
  续接，但整体重写为单事务时多选区语义由 startState.update 重建）；本仓
  多选区/选区替换一律透传——原生 doPaste 的**多光标行分配**（行数 = 选区
  数时逐行分配）与**行复制形态**（linewise）是平台语义，不重造。
- **缩进单位**：上游 `getDefaultIndentChar` 读 Obsidian vault 配置
  （useTab 缺省 `\t`）；本仓缺省**两空格**——对齐 vsidian 缩进模型单一事
  实源（`src/shared/listPrefix.ts` `PLAIN_INDENT_WIDTH = 2`，与 CM6
  indentUnit 默认对齐），平台无 vault 配置的 SDK 等价物。
- **CRLF 归一显式前置**（上游经 CM6 `toText` 隐式获得）：原生 paste 事件
  的 text/plain 可能携带 CRLF/CR，入口统一归一 LF。
- **纯文本粘贴入口**：上游是 Prec.highest keymap 标记 + `return false`
  落穿 Obsidian 宿主的 Mod+Shift+V；本仓是**平台稳定 API 命令**（键位进
  统一快捷键管理，命令面板可达），命中后合成纯文本 paste 事件交既有粘贴
  链（见「平台映射」）。
- 设置门控：上游读 `settings.SmartPaste`；本组件 23 键设置已含
  `smartPaste`（默认开），页面侧门控接线（`isSmartPasteEnabled` 注入点在
  `src/page-editor.ts`）随设置面接线票补上，当前恒开。

## 平台映射

### 拦截路径选型：domEventHandlers({ paste })

vsidian 内核的粘贴管线全在 **paste DOM 事件**层：富文本接管（#314）、图
片粘贴（#161）均为 `EditorView.domEventHandlers({ paste })`；菜单/改绑粘
贴与 pastePlain 经 `readClipboardSnapshot` 读剪贴板后**合成 paste 事件**
（`dispatchClipboardPaste`）重新进入同一处理链。本组件沿用同一层：

- **执行序天然正确**（CM6 `computeHandlers`：扩展序注册 domEventHandlers，
  内建 `editHandlers.paste` 殿后）：平台扩展数组中富文本/图片处理器在
  `extraExtensions`（附加组件槽）**之前**装配——图片项与富文本转换由平台
  先接管，本组件收到的是平台不处理的纯文本粘贴；本组件之后才是 CM6 内建
  paste（doPaste 的 text/plain 插入、多光标行分配、linewise 形态）。
  「命中场景才接管、其余透传」由装配序直接获得，无需仲裁逻辑。
- **放弃 transactionFilter（上游形态）**：过滤槽逆序应用——附加组件槽在
  数组末位即**最先**过滤，会先于平台过滤器（表格规范化、符号补全门控）
  看到事务；且事务层**无法区分**平台富文本粘贴的分步撤销事务（A→B→C 计
  划在根层算定，B/C 各阶段文本与 `deferredSegments` 的 ChangeSet 登记配
  对——重写任一阶段即破坏撤销契约）。上游在 Obsidian 无此约束（无分步
  撤销粘贴管线）。
- **放弃 updateListener 识别粘贴事务再补第二笔**：一次粘贴拆两笔撤销事
  务，破坏「单笔撤销整体回退」语义。
- 装配：`sdk.registerExtension(cm6.view.EditorView.domEventHandlers({ paste:
  createSmartPastePasteHandler({ marker, editableFacet }) }))`。CM6 运行时
  值只经实验入口取得（构建桥双防线）；清单 `experimental.cm6: "^1.1.0"`
  不变。domEventHandlers 无 keymap 顺序语义，与 #7/#8 的 keymap 扩展互不
  竞争。

### 纯文本粘贴命令：稳定 API + 合成事件

- 命令经 `sdk.commands.register`（仅编辑器页）：`mode: 'live'`、
  `writes: true`（写操作——快捷键仅在 Live 正文接管宿主绑定，源码模式与
  设置页输入不接管；粘贴本身要求可编辑视图，命令回调内另有只读/组合守
  卫）。默认绑定 `['ctrl+shift+v', 'shift+meta+v']`——**规范修饰键序**
  ctrl→alt→shift→meta 书写：vsidian#417 实证平台 pastePlain 的 mac 默认
  `meta+shift+v` 非规范序、真实按下 Cmd+Shift+V 永不命中（默认键位存储
  不再归一，非规范序串与运行期归一序永不相等）；本命令 mac 形态写作
  `shift+meta+v` 避开该形态（测试钉住）。
- 命令流：目标视图（`ViewPlugin` 登记挂载本组件扩展的编辑器——当前平台
  附加组件扩展槽仅挂主正文 Live 实例，嵌入/悬停视图不经登记；聚焦者优先、
  唯一在场兜底、多视图无聚焦不猜。审查 B-F3 后的口径：焦点元素属于某个
  CM6 视图但不在登记表（嵌入实例）时**拒绝执行**并 debugLog 留痕，不走
  兜底——不误写主文档）→ 剪贴板 text/plain（
  `navigator.clipboard.readText` 优先；缺失/权限受限经 enable scope 通道
  `easyTyping.clipboard.readText` 回退宿主 `vscode.env.clipboard`——对齐
  平台「权限受限时仅回退宿主 text/plain」口径）→ 置纯文本标记 →
  **合成纯文本 paste 事件**派发到目标视图 contentDOM（clipboardData 仅
  text/plain，形态对齐平台 `dispatchClipboardPaste(plain = true)`）。
- 合成事件同步重入粘贴链：平台富文本/图片处理器自然放行（无 html/图
  片）→ **SmartPaste 续接照常应用** → CM6 doPaste 插入（多光标行分配保
  持）——与上游「纯文本粘贴仍走 SmartPaste 续接」一致，且不重造插入机
  制。标记在派发前置位，事务发生时在 500ms 窗内（#26 消费面）。

## 平台粘贴冲突核对（票面要求的核对结论）

> 核对基线：vsidian origin/main 的 `src/webview/liveInstance.ts`（扩展装
> 配序 + paste domEventHandler + extraExtensions 槽位）、
> `src/webview/clipboardPaste.ts`（dispatchClipboardPaste / 合成事件形
> 态）、`src/webview/imagePaste.ts`、`src/webview/syncController.ts`
> （paste/pastePlain 命令实现与 docKeydown 路由）、`src/shared/keybindings.ts`
> （resolveKeybinding 优先序与 #417）、`@codemirror/view` 6.43.13
> dist（computeHandlers / runHandlers / doPaste）。逐项结论：

1. **图片粘贴让位平台**：`imagePaste` 处理器在本组件之前装配且接管
   image/* 项（出站宿主落盘）；本组件防御性复核图片项（handler 首查），
   即使平台图片开关关闭也不吞图片粘贴（落 CM6 内建对 Files 项的处理）。
2. **富文本粘贴让位平台**：带 text/html 且无图片项的原生粘贴由平台
   #314 处理器接管（html→markdown、弹窗决策、分步撤销）——本组件收不
   到该事件，**接管面不重叠**。代价是富文本转换结果**不经 SmartPaste 续
   接**（平台经 applyEdits 插入 markdown，非 paste 事件）——已知边界
   （见下节），不重写其事务正是为了保住分步撤销契约。
3. **平台合成粘贴事件照常续接**：pastePlain / 菜单粘贴 / 改绑普通粘贴经
   `dispatchClipboardPaste` 合成事件——无 html 的纯文本形态落穿平台处理
   器后**被本组件正常续接**（上游语义等价：菜单纯文本粘贴同样触发
   SmartPaste）。
4. **表格上下文让位**：表格行（`| a |`）不匹配列表/引用前缀，本组件自然
   透传——平台 tableEditing 的格区替换规则保持（上游在事务过滤器里有
   LineType.table 直通，本仓文本形态学获得同一结果）。
5. **代码块内粘贴不在本票**：上游 BetterCodeEdit 的代码块粘贴缩进分支
   （cm_extensions.ts:112-166）属独立功能票；代码围栏行 ``` 不匹配前缀
   自然透传，围栏**内**的普通行若自身是列表形态且光标在其行尾会续接
   （上游同样如此——其代码块分支依赖语法树，live 空树下无从判定，平台
   侧围栏内粘贴遵循既有规则）。
6. **与平台 pastePlain 键位并存**（resolveKeybinding 优先序：用户覆盖 →
   默认值，同轮内置操作先于运行期组件命令）：默认状态下 Windows/Linux
   的 ctrl+shift+v **平台命令先命中**（平台粘贴照常执行、内容等价），
   mac 的 Cmd+Shift+V 平台默认键序损坏（#417）→ **本命令命中**。用户
   清空/改绑平台绑定或改绑本命令后，相应入口归本命令。同弦不互斥吞
   键——路由层单选，无双重执行。
7. **撤销/出站同步无干扰**：本组件派发的插入事务与原生 doPaste 事务形
   态一致（userEvent input.paste、单笔、LF 坐标），平台 updateListener
   按普通本地编辑出站，宿主文本管线一次撤销整体回退；不触碰
   withPasteMeta 粘贴元数据通道（原生纯文本粘贴同样不经该通道）。

**结论**：接管面 = 平台不处理的纯文本粘贴且单折叠光标在列表/引用行尾
且续接非恒等；让位面 = 图片、富文本、表格、多光标/选区、组合中/只读、
恒等续接——全部落穿平台/原生链，回归无损。

## 已知边界

- **富文本粘贴结果不续接**：平台 #314 接管的粘贴（html→markdown 转换）
  未经 SmartPaste（其插入不走 paste 事件，重写事务会破坏分步撤销）。
  补齐需平台在转换结果插入路径提供续接钩子或事件化——给平台提示见下节。
- **平台 pastePlain 抢先命中时纯文本标记不置**（默认键位 Windows/Linux
  的 ctrl+shift+v 归平台命令）：#26 落地后经平台 pastePlain 粘贴的内容
  会被自动格式化（上游语义应跳过）。平台合成事件与菜单普通粘贴（文本
  only 剪贴板）**形态相同**，附加组件无法从事件面区分意图——补齐同样
  需平台提示（见下节）。#417 修复后 mac 走本命令不受影响。
- **纯文本命令不做 HTML 提取回退**：剪贴板无 text/plain 时本命令无操作
  （平台 pastePlain 会从 html 提取纯文本）——html-only 剪贴板场景用户
  可用平台入口；如需对齐再评估（提取器属平台 htmlToMarkdown 面）。
- **多光标粘贴不续接**（透传原生行分配）：上游对多选区的「整体重写」在
  平台语义下风险大于收益（原生多光标粘贴行为完整），让位为明确边界。
- **引用续接前缀归一**：目标行 `>nospace`（无尾随空格）续接前缀归一为
  `> `（上游 prefix 拼接语义），不改写已有行内文本。
- **浏览器真实剪贴板端到端**（真实 Ctrl+V/Ctrl+Shift+V 键序、撤销单笔
  回退、多行粘贴续接观感）归 #21 人工验证清单。

## 给 #26（格式化管线）的接口提示

> **#26 已消费（2026-10 落地）**：本节接口已按约定接入——粘贴识别与
> consumePlainPaste 语义见 [auto-format.md](auto-format.md)「#12 粘贴
> 联动」节；pasteMarker 单例经 `registerAutoFormatBehavior({ marker })`
> 参数注入。两处口径差异在此记录：其一，`autoFormatPaste`（粘贴时格式化
> 的主动侧）经行为链**结构性不可达**（平台对 paste·drop·undo 事务不驱动
> 行为，#25 记录），#26 只落地跳过侧，主动侧归 #28 命令承载；其二，
> 「经平台 pastePlain 的粘贴标记不置」边界下按「未标记 = 格式化」处理，
> 但纯文本粘贴命令自置标记（markPaste(true)），本组件自身的纯文本粘贴
> 仍被正确跳过。以下原文保留供对照。

- **标记消费面**：`PasteMarker`（`src/pasteMarker.ts`）——粘贴识别 =
  `事务 userEvent 含 'input.paste' || marker.pasteDetected`（上游
  cm_extensions.ts:556 同构；透传粘贴事务自带 input.paste，接管事务同样
  携带）；**跳过格式化** = 命中粘贴时 `marker.consumePlainPaste()` 为
  true（一次性，读即消费——只有置过纯文本意图的粘贴消费到 true）。
- 上游 `AutoFormatPaste` 设置（已进 23 键 schema：`autoFormatPaste`）控制
  粘贴时是否格式化；`plainPasteInProgress` 只跳过本次。两个键在 #26 生效。
- 页面装配侧单例在 `src/page-editor.ts`（`pasteMarker` 常量）：拦截处理
  器与命令共用同一实例，#26 挂观察时直接 import 该装配点或经装配注入。
- 已知边界（见上节）：经平台 pastePlain 的粘贴标记不置——#26 实施时按
  「未标记 = 格式化」处理并在其规格引用本边界，或推动平台提示先行。

## 给 #21（人工验证）的提示

- 矩阵抽验：列表/引用目标 × 单行纯文本（无变化透传）/ 多行纯文本（逐行
  加前缀）/ 粘贴列表（首项并入 + 保留标记）/ 带续行列表/ 缩进列表
  （续行对齐缩进）。
- 纯文本粘贴：Mod+Shift+V（Windows/Linux 默认下先核对走的是平台命令还
  是本组件命令——键位设置页可查生效绑定）粘贴后 #26 落地前无格式化差异，
  落地后复验跳过。
- 撤销：续接粘贴一次 Ctrl+Z 整体回退；多光标粘贴（2 光标选 2 行文本）
  原生行分配不被续接干扰。
- 让位面：图片粘贴走平台资产落盘；富文本（网页复制带格式）粘贴走平台
  询问弹窗且结果不续接（已知边界）；表格行内粘贴不续接。

## 给 vsidian 平台的提示（跨仓提案，不在本票）

- **富文本粘贴结果续接钩子**：#314 转换结果插入路径（applyEdits）无
  paste 事件语义，附加组件无从续接。可在插入后补发不可取消的
  `paste` 观察事件（或 `clipboardData` 带标记的合成事件），供 SmartPaste
  类组件二次处理。
- **纯文本粘贴意图可辨识**：`dispatchClipboardPaste(plain=true)` 与菜
  单普通粘贴（text-only 剪贴板）合成事件形态相同，附加组件无法区分「纯
  文本意图」。可在合成事件 clipboardData 附加私有类型（如
  `application/vnd.vsidian.plain-paste`）——#417 修复粘贴键位时一并评估。
