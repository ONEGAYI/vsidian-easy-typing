# Tabstop 系统——占位符导航态（工单 #15）

> 上游 easy-typing-obsidian 的 tabstop 导航移植：规则替换体中的
> `$0` / `$1` / `${1:默认}` 占位符在替换插入后进入导航态——Tab/Shift-Tab
> 逐组跳转、当前占位符高亮。占位符**语法解析**（`$n` / `${n:default}` 展
> 开、`ApplyResult.tabstops` 填充）已随 #14 落在引擎（见
> [rule-engine.md](rule-engine.md)），本票只做**导航态与高亮**，引擎零改动。
> 事实源模块：`src/tabstopGroup.ts`（分组纯逻辑）、`src/tabstopNav.ts`
>（StateField + 装饰 + commands 工厂）；测试矩阵：`test/tabstopGroup.test.ts`
>（15 例）、`test/tabstopNav.test.ts`（23 例）。

## 验收口径

- 占位符导航端到端（含嵌套与默认值）：由**分组纯逻辑 + 引擎真实输出**
  端到端（`tabstopGroup.test.ts` 末组：`addSimpleRule` 真实引擎跑出
  tabstops → 分组断言）与**状态机矩阵**（真实 `EditorState` + 模拟 view
  驱动 `activateTabstops` / `tabCommand` / `shiftTabCommand` 全链路）承载；
  浏览器真实键盘端到端归 #21。
- Tab 仲裁无冲突（#7 让位）：抢先层接管语义 + 未激活/收尾后透传由
  `tabstopNav.test.ts`「Tab 拦截仲裁」组钉住；真实按键链（Prec.high 层
  先于平台 Tab 三段链与 #7 落穿层）归 #21 浏览器验证。
- `npm run compile` 通过；全部测试绿（479 例基线不回归）。
- 引擎模块零改动：`src/rules/` 无本票 diff（#14 契约延续）。

## 上游对照

上游 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa），按内容锚点对照：

| 上游锚点 | 移植落点 | 语义 |
| --- | --- | --- |
| `tabstop.ts` `tabstopSpecsToTabstopGroups` | `src/tabstopGroup.ts` `groupTabstops` | 按 number 分组、升序；同号并组（多光标单元） |
| `tabstop.ts` `TabstopGroup.selections` / `toEditorSelection` | `groupSelectionRanges` + `selectionOf`（工厂内） | 组内逐 range 全选（默认值整体选中，键入即覆盖） |
| `tabstop.ts` `TabstopGroup.containsSelection` | `rangesWithinGroup` | 选区整体落在组内判定（本仓用于自动退出） |
| `tabstop.ts` `TabstopGroup.map`（from -1 / to +1） | StateField.update 的 `mapGroups` | 组坐标随事务 changes 重映射，贴边插入不吞新文本 |
| `tabstop.ts` `getMarkerDecoration`（mark + 光标 widget） | StateField provide 的 mark 构建 | 当前组非空 range 画 mark（类 `vsidian-easy-typing-tabstop`） |
| `tabstops_state_field.ts` `tabstopsStateField`（栈形 groups） | `TabstopNavState`（groups + index） | 上游以 shift 消费栈，本仓以索引前移——等价的状态机改写 |
| `addTabstopsEffect` / `removeTabstopEffect` / `removeAllTabstopsEffect` | `activateEffect` / `moveEffect` / `deactivateEffect` | 三效应对应建立/切换/清态 |
| `addTabstopsAndSelect`（add + 首组 select） | `activateTabstops` | 分组 → 首组选中 + StateField 建态 |
| `consumeAndGotoNextTabstop`（remove + select next） | `tabCommand`（index+1 + 选区） | Tab 前进；「选区未变则再消费」的递归分支本仓不涉及（同号并组消除了上游的重复组形态） |
| `tidyTabstops`（只剩一组即清空） | 跳至最后一组的同一事务发 `deactivateEffect` | 到达即收尾（上游是到达**后**检查清空，时序等价：选区落位与清态同事务） |
| `keyboard_handlers.ts` `tabTabstopJump`（handleTabDown 首位） | `tabCommand` 经 Prec.high 抢先层 keymap | tabstop 存在时 Tab 优先于一切 Tab 分支 |
| 上游无对应 | `shiftTabCommand` | Shift-Tab 后退（票面要求新增） |
| `styles.css` `.easy-typing-tabstops` / `.easy-typing-cursor-widget` | `EditorView.theme` 注入的 `& .vsidian-easy-typing-tabstop` | 上游淡蓝底+描边+闪烁光标动画；本仓复用平台 find 变量、简化掉光标 widget（见「样式方案」） |

### 跳转顺序语义（重要）

**跳转顺序为 `$0 → $1 → $2 → ...`（$0 最先）**——上游
`Doc/CustomRules_ZH.md`「替换模板语法」节明文：「光标跳转顺序为
$0 → $1 → $2 → ...」，`$0` 语义是**替换后的主光标位置**（首个编辑点），
不是 VSCode snippet 的「终点」语义。引擎侧 #14 的升序排序
（`tabstops[0]` 恒 `$0`、`cursor` 落其 `from`）与导航侧首组选中即 `$0`
组，两端同源。**收尾组是最大编号组**（跳至即清态），与编号是否为 0 无关。

## 与上游的差异（刻意，逐条给理由）

1. **高亮画当前组（上游画下一组）**：上游 decorations provide 只画
   `tabstopGroups[1]`（下一组预告），当前组的视觉由选区承担。本仓按票面
   「当前占位符高亮」改为画**当前组**——附加组件对选区渲染样式无控制权
   （平台主题决定），显式 mark 让「当前在哪」的指示不依赖选区外观；
   与平台查找「当前命中」高亮同形态，VSCode snippet 用户直觉一致。
   到达最后一组时高亮随收尾清空（上游到达即清的行为不变，只是高亮
   语义从预告改为当前）。
2. **选区整体移出当前组 → 导航态自动退出**：上游无显式退出路径（用户
   点击别处后 Tab 仍继续跳占位符，态滞留到下一次替换或走完）。本仓收窄：
   非本组件事务把选区移出当前组（点击别处、全选、撤销替换、其他组件
   改选区）即清态——附加组件的 tabstop 来自单次替换插入这一离散事件，
   继续拦截 Tab 属超预期接管。组内编辑与组内选区调整不退出。
3. **单组替换体不进导航态**：仅一组占位符（如替换体只有 `$0`）时
   activate 直接落选区、不建态（「跳至最后一组即收尾」一致应用于初始
   态）。上游单组时态滞留（Tab 落穿但 StateField 仍持有组直到下次事件），
   属未收口 quirk，不移植。
4. **Shift-Tab 后退为新增能力**（票面要求）：上游只有前进。首组上
   Shift-Tab 无路可退，`return false` 透传平台 Shift-Tab（列表降级 /
   outdent 照常），导航态保持。
5. **栈形消费改为索引状态机**：上游 `TabstopGroup[]` 以 shift 消费、
   `containsSelection` 判断新旧组嵌套决定是否折叠到端点；本仓 groups +
   index 等价改写，「选区未变再消费」的递归分支因同号并组形态（上游
   分组后同 number 只有一组，不存在需跳过的空转）而不再需要。
6. **光标 widget 动画简化为高亮 + 选择**（票面授权的简化）：上游零宽
   占位符画闪烁竖线 widget（`blink` 动画）。本仓零宽组不画装饰——只有
   光标在场（选区语义），跳转反馈由选区跳动与前一组的 mark 承担。

## Tab 仲裁（#7 接口提示的落地形态）

**抢先层（Prec.high）+ 导航态激活才接管**，这是 #402 四层按键契约的
第 2 层（平台保留键闸之后、普通扩展槽之前）：

- **先于平台 Tab 情境链**（围栏越界 fenceEscape → 表格导航 tableEditing
  → 正文缩进 indentEditing，均在普通扩展槽）：导航态激活时 Tab 被导航
  消费（`return true`），缩进/列表/越界不触发——这同时解决了 #7 规格指
  出的「落穿层在普通正文不可达」问题（tabstop 导航在普通正文**可达**，
  因为抢先层不经过平台链）。
- **先于 #7 Tabout 落穿层**（普通扩展槽末位）：同为 Tab keymap，抢先层
  扩展序在前，导航态激活时 `tabCommand` 返回 true 即短路，#7 的
  `taboutCommand` 不会收到该键——**#7 无需任何让位钩子或注册顺序调整**，
  其「接口提示」节的两个方案（先注册 / 前置钩子）均不需要。
- **未激活与收尾后恒 `return false` 落穿**：平台三段链与 #7 行为零改动
  （透传即回归无损，与 #7 同口径）；Shift-Tab 同层抢先（后退必须先于
  平台 outdent），首组上无路可退亦透传。
- 实验层 keymap 不进平台统一快捷键管理（#402 契约原文），与 #7/#8/#11
  同形态；vsidian #402 稳定化后按平台口径迁移。

层序全景（Tab 键按下时）：平台保留键闸（不含 Tab）→ **本组件 Prec.high
keymap**（导航态激活才接管）→ 平台 Tab 情境链（普通扩展槽，平台扩展序）
→ #7 Tabout（普通扩展槽末位，本组件之后装载）→ webview 默认路径。

## 样式方案

- **复用平台公开 CSS 变量**（不新增平台级样式契约）：
  `--vsidian-find-match-current-background`（底色）与
  `--vsidian-find-match-current-outline`（描边）——平台查找「当前命中」
  的语义族（styleContract `var-find-highlight` 条目），用户覆盖 find 高亮
  变量时占位符高亮联动；回落值与平台 `main.css` find-match-current 段
  完全一致（`rgba(255, 141, 55, 0.65)` / `rgba(255, 141, 55, 0.9)`），
  圆角 2px 同款。
- **自绘 scoped 类**：`vsidian-easy-typing-tabstop`（组件前缀约定），
  经 `EditorView.theme` 注入（`& .类名` 复合选择器保持类名字面 + 自动
  加编辑器根前缀，规则只在本编辑器内生效）——不占用平台样式契约面，
  不写独立 CSS 文件。
- 上游样式（淡蓝 `#87cefa` 系 + 闪烁动画）不移植：颜色随平台 find 变量
  走（主题一致性优先），动画随光标 widget 简化（差异 6）。

## 平台映射

- **模块形态**：上游直接 import CM6 值；本仓构建桥禁止源码值导入
  `@codemirror/*`——`createTabstopNavigation(cm6)` 工厂注入
  （`TabstopCm6Runtime` = `AddonCm6Runtime` 的 state/view 子集），源码仅
  `import type`。测试侧以真实 `@codemirror/state` + `@codemirror/view`
  模块命名空间组装 cm6 参数直接驱动（与生产同构造器身份）。
- **StateField 值为纯数据**（`{ groups, index }`）：装饰由 provide 回调
  从 groups 即时构建 mark（当前组非空 range）——不把 DecorationSet 存进
  field 值，映射与装饰单一事实源。
- **page-editor 装配**（独立增量块）：`registerExtension(extension)`
  （StateField + theme）+ `Prec.high(keymap Tab/Shift-Tab)`；设置门控随
  本组件设置票接线（当前恒开，关闭形态 = 不注册 keymap，与 #7 同口径）。

## 给 #25（行为链）的接线接口

```ts
const tabstopNav = createTabstopNavigation(cm6)   // page-editor 装配时创建
// 规则计划应用后（同一事务或紧随其后）：
if (result.tabstops.length > 0) {
  tabstopNav.activateTabstops(view, result.tabstops)
}
```

- `activateTabstops(view, tabstops: readonly TabstopSpec[])`：空数组
  no-op（无占位符替换不建态，#25 无需判空）；单组仅落选区；多组建态并
  选中首组（`$0` 组，选区为组内逐 range 全选的多光标）。
- 激活事务会**重设选区**：引擎计划的 `cursor`（落首组起点）由激活事务
  升级为「首组整体选中」——#25 计划的 selection 可按引擎原样派发，激活
  事务紧随其后覆盖即可（两事务间无用户输入窗口）。
- 坐标系：LF 文档绝对坐标（与 `ApplyResult.tabstops` 同源，webview 全程
  LF，无需换算）。

## 已知边界

- **零宽占位符无可见高亮**（差异 6 的直接后果）：`$0` 常为零宽
  （`[[1]]/$0` 形态），当前组为其时只有光标无 mark。人工验证（#21）如
  发现可辨识性不足，再评估静态竖线 widget（无动画版）。
- **IME 组合期不拦截**：CM6 keymap 在 IME 组合进行中不派发 Tab 键
  （平台同口径）；组合期占位符区间随文本映射，组合结束后续跳正常。
- **多编辑器实例**：StateField 按视图状态隔离（同 extension 多视图挂载
  互不串扰，`tabstopNav.test.ts` 多实例用例钉住）；但导航态**跨视图不
  联动**——A 视图的替换不影响 B 视图态（各视图独立激活，符合上游）。
- **撤销的历史边界**：CM6 history 隔离整个事务（含 effects）——撤销替换
  插入时 activate effect 不重放，选区跳回替换前位置触发「移出组自动退
  出」兜底（差异 2），撤销后 Tab 即普通语义。重做（redo）不恢复导航态
  （与上游一致：上游 effect 同样不重放）。
- **嵌套默认值中的 `${SEL}`/`${KEY}` 展开**发生在引擎 parseTabstops
  （#14 已落地，端到端用例覆盖 `${1:默认}` 与同号并组）；导航侧无感知。
