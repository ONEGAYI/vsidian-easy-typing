# 规格索引（docs/specs/）

本目录承载各功能域的**移植规格**：每张实施票落地前把验收口径、上游对照与平台映射写成本目录下的规格文档，票面只留范围与链接。

## 约定

- 命名：`<主题>.md`（kebab-case，与 vsidian 主仓规格目录同风格）。
- 规格文档三要素：**验收口径**（可判定）、**上游对照**（文件/函数/规则 id 锚点）、**平台映射**（消费的 SDK 面与已知边界）。
- 实施中发现的边界决策（做/不做/顺延）回写规格的「已知边界」节，不留在工单评论区。
- 跨规格的领域词汇先登记 [CONTEXT.md](../../CONTEXT.md) 再使用。

## 索引

- [rule-engine.md](rule-engine.md) —— 规则引擎内核与内置规则（#1：三触发类建模、Input 类执行内核、20 条内置数据、匹配矩阵；#14 起 Tabstop 语法解析已接入）+ 行为链接入（#25：onInput 触发管线、五功能族注册与默认链序、joinPrevious 全量核对、多选区结论与设置门核对）+ Delete/SelectKey 触发接入（#9：delete.* 联动删除与选区替换包裹管线、事务前重建与坐标换算、06/07 族与独占组结论、Input 管线 replaced 门）+ 函数替换体预注册（#17：函数表与引用形态、规则语法基础节，决策见 ADR-0003）+ compose 去重核验（#6：平台单发结论——事务路径双重门与 compositionend 补发路径物理分离、插件不设去重、三管线互斥与双发防御测试、浏览器 IME 端到端验证口径与实验 cm6 清单核对）。
- [rules-storage.md](rules-storage.md)——规则存储与数据链（#14/#49）：builtin/user/state 三文件持久化（rule-state 三字段含语言对与自定义词典）、宿主 storage 单写点服务、外部变化自动重载（watcher + revision 轮询）与通道协议（双作用域；#50 增规则→行为族映射模块）。
- [rules-ui.md](rules-ui.md)——规则管理设置页自绘（#16/#48–#50）：mountRoot 内规则列表/编辑表单/测试编辑器/导入导出，写后刷新策略、上移/下移按钮（#48）、内置规则逐条开关回归与宿主禁用态灰显（#50，ADR-0016 两层口径）、语言间空格策略分区（#49）与函数替换体引用选择（#17 解锁）；#55 起四分区作为 hosts 挂入五 Tab 自绘设置页。
- [settings-mapping.md](settings-mapping.md)——设置字段映射表（#3/#477）：上游 30 字段四去向、进 schema 的 24 项总表（23 上游映射键 + #13 新增本仓键 `newLineBelow`）、形态变换口径与实施落档约定（#477 增分组/枚举标签/多行三形态消费）；默认值单一事实源在 `src/settings/defaults.ts`（富结构种子 #49 起迁 rule-store）。
- [settings-tabs.md](settings-tabs.md)——五 Tab 自绘设置页（#55）：页内五 Tab 框架与 24 项设置行归属表（excludeFiles 特例）、规则四分区挂入、平台作用域消费（写入目标层跟随 / 清除覆盖恢复继承用户默认）、全局设置搜索定位链路与已知边界（Tab 态不持久化 / 设置值无推送写后重拉）。
- [tabout.md](tabout.md)——Tab 跳出配对符（工单 #7）：22 对配符栈匹配算法、Tab 按键拦截（实验 cm6 keymap 落穿层）与平台 Tab 冲突核对。
- [tabstop.md](tabstop.md)——Tabstop 占位符导航态（工单 #15）：分组纯逻辑与导航 StateField、Tab/Shift-Tab 跳转（抢先层 Prec.high，#7 仲裁落地）、当前占位符高亮（复用平台 find 变量）与 #25 行为链接线接口；跳转顺序 $0 → $1 → $2（上游口径）。
- [backspace.md](backspace.md)——BetterBackspace 空列表/引用清除与重编号（工单 #8）：前缀解析与清除/重编号算法、Backspace 按键拦截（实验 cm6 keymap 抢先层）与平台退格冲突核对。
- [enhance-moda.md](enhance-moda.md)——EnhanceModA 渐进选择与「选择当前块」（工单 #11）：无外部状态的层级推进状态机、Mod+A 抢先层（Prec.high）接管边界、树版懒查询判定（#5 换传，降级差异消除记录）与命令注册契约。
- [smart-paste.md](smart-paste.md)——SmartPaste 智能粘贴续接与纯文本粘贴标记（工单 #12）：列表/引用前缀续接算法、粘贴拦截（实验 cm6 domEventHandlers 让位序）、纯文本粘贴命令（平台稳定 API + #417 规范键序）与平台粘贴冲突核对。
- [new-line-below.md](new-line-below.md)——NewLineBelow 当前行下方新建行（工单 #13）：Mod+Enter 行尾插入 + 列表/引用前缀延续算法（列位置语义核对结论）、抢先层接管平台 defaultKeymap `insertBlankLine` 的仲裁核对、`newLineBelow` 设置门；严格换行分支已随 #30 落地（见 strict-enter.md）。
- [fold-enter.md](fold-enter.md)——折叠标题处 Enter 新建同级标题（工单 #18）：折叠态判定消费 experimental.headingFold.folds()、Enter 抢先层（Prec.high）仲裁、折叠保持验证与平台 headingFold 首消费反馈。
- [strict-enter.md](strict-enter.md)——严格换行三模式补偿（工单 #30）：上游 enterStrictLineBreak 的 Enter 三模式 + goNewLineAfterCurLine 严格分支（Mod+Enter）移植、双门控（strictModeEnter × experimental.hostSettings 的 editor.readingBreaks 严格渲染判定）、边界门槛（空白行/行首/段中/列表落穿/callout 自判落穿/顶格代码块闭栏特例）与键位仲裁（同层注册序在 #18 折叠之后）。
- [protected-zones.md](protected-zones.md)——自定义正则保护区（工单 #27）：多行正则解析（`|++`/`|--` 旗标语义）与默认模板、格式化管线注入缝消费、「用户规则尊重保护区」双开开关与规则管线接入、#5 树版换传后 code/formula 分区与保护区剪除语义（升级点已实施）。
- [auto-format.md](auto-format.md)——自动格式化（工单 #26）：语言对间距/前缀词典/自动大写/软空格符号的行级算法（上游差异化验证矩阵）、onInput 管线（格式化当前行口径、#27 保护区注入缝、作用域文本降级）与 06-autoformat 行为族（input-rules 独占组链序、#12 粘贴联动）。
- [comment-toggle.md](comment-toggle.md)——注释切换命令（工单 #2）：语言注释符表（上游 26 键逐条）与行/块切换、Markdown `%%` 切换、围栏语言感知树版判定（#5 换传，降级口径收敛记录）、平台键位冲突核对（与内建 htmlComment 同弦并存）与视图登记表共享决策（供 #28 对照）。
- [formatting-commands.md](formatting-commands.md)——格式化命令族（工单 #28）：格式化全文/选区、删除空行（strictLineBreaks 恒 true 的 CommonMark 映射）、切换自动格式化、选区转代码块五命令（平台稳定 commands API + 键位冲突核对：Mod+Shift+L 与内置 findAllOccurrences 同弦、Ctrl+Tab 被 Tab 固定链拒绝）；文件排除（ExcludeFiles × #407 docUri 的段边界后缀映射，行为族与命令双侧消费）；#26 规格 prevCh=undefined 注记的勘误（命令重排实为 prevCh=0）。
- [syntax-line-types.md](syntax-line-types.md)——语法树行类型与作用域映射（工单 #5）：上游判定语义 → 平台 experimental.syntax kind 枚举 → 消费维度投影的映射对照表（callout 与链接排除两处组件自判缺口）、已知口径差异全量（fm 源码态、嵌套优先级、单行 `$$x$$`、`` `[[a]]` `` 链接区段优先剪除等）、六个消费方索引、fake 近似边界声明与升级路径。

里程碑与工单总览见 [README](../../README.md) 与 [Issues](https://github.com/ONEGAYI/vsidian-easy-typing/issues)。面向用户的操作手册在 [docs/guides/](../guides/)（#19 移植上游三篇专题 Doc——自定义规则 / 自动格式化 / 编辑增强，与本目录的实施规格互为表里：规格面向开发者记边界与对照，指南面向用户讲用法与差异）。
