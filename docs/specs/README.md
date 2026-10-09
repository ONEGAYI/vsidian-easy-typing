# 规格索引（docs/specs/）

本目录承载各功能域的**移植规格**：每张实施票落地前把验收口径、上游对照与平台映射写成本目录下的规格文档，票面只留范围与链接。

## 约定

- 命名：`<主题>.md`（kebab-case，与 vsidian 主仓规格目录同风格）。
- 规格文档三要素：**验收口径**（可判定）、**上游对照**（文件/函数/规则 id 锚点）、**平台映射**（消费的 SDK 面与已知边界）。
- 实施中发现的边界决策（做/不做/顺延）回写规格的「已知边界」节，不留在工单评论区。
- 跨规格的领域词汇先登记 [CONTEXT.md](../../CONTEXT.md) 再使用。

## 索引

- [rule-engine.md](rule-engine.md) —— 规则引擎内核与内置规则（#1：三触发类建模、Input 类执行内核、20 条内置数据、匹配矩阵；#14 起 Tabstop 语法解析已接入）+ 行为链接入（#25：onInput 触发管线、五功能族注册与默认链序、joinPrevious 全量核对、多选区结论与设置门核对）+ Delete/SelectKey 触发接入（#9：delete.* 联动删除与选区替换包裹管线、事务前重建与坐标换算、06/07 族与独占组结论、Input 管线 replaced 门）。
- [rules-storage.md](rules-storage.md)——规则存储与数据链（#14）：builtin/user/state 三文件持久化、宿主 storage 单写点服务、外部变化自动重载（watcher + revision 轮询）与通道协议（双作用域）。
- [rules-ui.md](rules-ui.md)——规则管理设置页自绘（#16）：mountRoot 内规则列表/编辑表单/测试编辑器/导入导出，写后刷新策略、内置规则边界（逐条开关走平台行为冲突管理）与函数体只读边界（#17 前）。
- [settings-mapping.md](settings-mapping.md)——设置字段映射表（#3）：上游 30 字段四去向、进 schema 的 23 项总表、形态变换口径与实施落档约定；默认值单一事实源在 `src/settings/defaults.ts`。
- [tabout.md](tabout.md)——Tab 跳出配对符（工单 #7）：22 对配符栈匹配算法、Tab 按键拦截（实验 cm6 keymap 落穿层）与平台 Tab 冲突核对。
- [tabstop.md](tabstop.md)——Tabstop 占位符导航态（工单 #15）：分组纯逻辑与导航 StateField、Tab/Shift-Tab 跳转（抢先层 Prec.high，#7 仲裁落地）、当前占位符高亮（复用平台 find 变量）与 #25 行为链接线接口；跳转顺序 $0 → $1 → $2（上游口径）。
- [backspace.md](backspace.md)——BetterBackspace 空列表/引用清除与重编号（工单 #8）：前缀解析与清除/重编号算法、Backspace 按键拦截（实验 cm6 keymap 抢先层）与平台退格冲突核对。
- [enhance-moda.md](enhance-moda.md)——EnhanceModA 渐进选择与「选择当前块」（工单 #11）：无外部状态的层级推进状态机、Mod+A 抢先层（Prec.high）接管边界、块边界正则降级（#5 升级点）与命令注册契约。
- [smart-paste.md](smart-paste.md)——SmartPaste 智能粘贴续接与纯文本粘贴标记（工单 #12）：列表/引用前缀续接算法、粘贴拦截（实验 cm6 domEventHandlers 让位序）、纯文本粘贴命令（平台稳定 API + #417 规范键序）与平台粘贴冲突核对。
- [auto-format.md](auto-format.md)——自动格式化（工单 #26）：语言对间距/前缀词典/自动大写/软空格符号的行级算法（上游差异化验证矩阵）、onInput 管线（格式化当前行口径、#27 保护区注入缝、作用域文本降级）与 06-autoformat 行为族（input-rules 独占组链序、#12 粘贴联动）。

里程碑与工单总览见 [README](../../README.md) 与 [Issues](https://github.com/ONEGAYI/vsidian-easy-typing/issues)。
