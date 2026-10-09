# 代码导览：模块地图与分层

本文档面向本仓维护者与范例模板读者，回答「代码放在哪、为什么放那、往哪扩展」。范例起步视角（如何复制骨架、流程约定、上游对应）见 [docs/showcase.md](showcase.md)，两份文档互不重复。

## 一、三入口与三产物

本插件编译为三个独立产物，各有固定入口（`build.mjs` 声明，`tools/buildLib.mjs` 执行）：

| 入口 | 产物 | 形态 | 运行环境 |
| --- | --- | --- | --- |
| `src/extension.ts` | `dist/extension.js` | node18 CJS（external vscode） | VSCode 扩展宿主进程 |
| `src/page-editor.ts` | `dist/editor.js` | chrome114 IIFE（经 SDK 构建桥） | 编辑器 webview（每个编辑器一份） |
| `src/page-settings.ts` | `dist/settings.js` | chrome114 IIFE（经 SDK 构建桥） | 组件自绘设置页 webview |

要点：

- **两段生命周期**——宿主入口 `registerAddon` 先 `setup`（注册设置定义、通道与设置页入口；普通停用后仍可配置）再 `enable`（注册编辑器页入口与运行装配）；
- **页面产物经构建桥**——`vsidian-addon-sdk` 是构建期虚拟模块，运行时实例由 Vsidian 装载器注入（原理见 [ADR-0001](adr/0001-scaffold-build-bridge-and-vendor.md)）；
- **`module.exports` 坑**——宿主入口的 `activate`/`deactivate` 必须显式赋值给 `module.exports`，否则 esbuild 死代码消除会吃掉导出。

## 二、分层模块地图

依赖方向自下而上，箭头只允许向下指（上层依赖下层，下层不知上层）：

```
L3 平台接线层    extension.ts / rulesHost.ts / settings/store.ts / host-api.ts
                 page-editor.ts / page-settings.ts（两个页面入口）
                      │  （组装：注册行为/命令/通道，注入设置与 i18n）
L2 接入层        *Intercept.ts（行为链/keymap/粘贴的注册与 gate）
                 *Command.ts（命令注册）  *Pipeline.ts（onInput 纯函数管线）
                      │  （决策与派发分离：plan 只读状态，command 派发事务）
L1 算法层        formatting/（行级格式化）  blockScan.ts / ruleScopeFallback.ts
                 *Algorithm.ts / modaSelection.ts / tabstop*.ts / pasteMarker.ts
                 userDefinedRegex.ts / fileExclusion.ts / commentToggle.ts
                      │
L0 纯逻辑内核    rules/（rule-engine / default-rules / function-table /
                 rule-store / rules-ui-model——零平台依赖，契约钉住）
```

横切两件（被各层消费）：`src/i18n/`（zh 字典为类型源，en 编译期键集对齐 + parity 测试；宿主侧 `vscode.env.language`、页面侧 `navigator.language` 统一经 `pickMessages`）、`src/logging.ts`（debug 门控，业务代码统一 `debugLog`，不直接碰 console）。

各层的边界判据与示例：

- **L0 纯逻辑内核**——不 import 任何平台面（vendor 类型也不引入）。`src/rules/rule-engine.ts` 的匹配/替换/优先级语义可在 node 下直接驱动。「`src/rules/` 零平台依赖」由结构契约测试钉住；平台接线性质的规则模块（如 `rulesHost.ts`）因此置 `src/` 平铺而不入 `src/rules/`。
- **L1 算法层**——单主题纯算法，多数是上游文件的对位移植（`formatting/textFormatter.ts` ↔ 上游 `text_formatter.ts`）。与 L0 的区别：L1 按**功能域**组织、消费 L0 的导出（如格式化消费 `inlineParts` 的分区），但不承载跨域内核。
- **L2 接入层**——本仓最具示范性的分层，核心是**决策与派发分离**：`planXxx(...)` 只读 `EditorState` 返回计划（或 null = 不接管），`createXxxCommand/Handler` 把计划派发为 CM6 事务或平台计划对象。好处：决策可在 vitest 里用真实 `EditorState` 离线驱动，派发层只剩薄薄的注册与接线。
- **L3 平台接线层**——唯一允许 import vendor 类型（仍然 type-only）与 vscode API 的层。负责两段生命周期装配、通道挂载、设置拉取与广播、SDK 面注册。

**降级层是一个特设角色**：`blockScan.ts`（行类型/块边界的正则扫描）与 `ruleScopeFallback.ts`（作用域判定的文本降级）是 #5（语法树适配）blocked 期间的替代实现——升级点在模块头注释标注，#5 落地后整体替换、调用面形状不变。

## 三、触发四通道

功能如何被「触发」决定了它走哪条通道。四通道各有适用面，新功能先选通道再写代码：

| 通道 | SDK 面 | 适用 | 本仓用例 |
| --- | --- | --- | --- |
| 行为链 | `sdk.behaviors`（稳定 API） | 输入事务的文本修饰——链序协同、独占组、逐项开关 | #25 五个规则族、#26 `06-autoformat` 格式化族（共用 `input-rules` 独占组：规则命中即短路格式化，复刻上游链序） |
| keymap | `sdk.experimental.cm6`（实验入口） | 按键拦截——需要抢先或落穿原生键位 | #8 退格（Prec.high 抢先）、#11 Mod+A（抢先）、#15 Tabstop（抢先）、#7 Tabout（落穿层）、#18 折叠标题 Enter |
| 命令 | `sdk.commands`（稳定 API） | 主动触发——命令面板与统一快捷键管理 | #12 纯文本粘贴、#28 五个格式化命令、#11 选择当前块 |
| 粘贴事件 | `sdk.experimental.cm6` domEventHandlers | 拦截原生 paste | #12 SmartPaste 续接（命中 preventDefault，未命中透传原生粘贴链） |

通道选择的既定口径：

- **能用稳定 API 就不上实验入口**——行为链与命令是稳定面；keymap 与 domEventHandlers 是 `experimental-cm6`（无兼容承诺，平台稳定入口落地后按票内口径回收，见 showcase.md 第四节）；
- **同键竞争先定仲裁**——Enter（#18 折叠 vs #13 下方新建 vs 平台续行）、Tab（#15 Tabstop vs #7 Tabout vs 平台链）均在对应规格的「仲裁」节定案，新触发面加入时先读同键既有票的仲裁结论；
- **行为族即开关粒度**——分族（而非一条行为装全部规则）注册是为了平台行为冲突管理能逐项开关与调序，localId 数值前缀编码默认链序。

## 四、平台接入三件套

### 宿主通道（channel）

宿主与页面、页面与页面之间经 topic 通道通信（`src/rulesHost.ts` + 各入口注册）：`RULES_TOPIC`（规则数据，编辑器页与设置页各自注册不冲突）、`SETTINGS_TOPIC`（设置通信）、`NOTICE_TOPIC` / `RULE_ERROR_TOPIC`（通知上报）。通道常量单一事实源在 `src/settings/store.ts` 导出。

### 设置链

`src/settings/` 三件：`defaults.ts`（默认值单一事实源）、`definitions.ts`（从 i18n 字典 + 默认值生成定义，注册进 Vsidian 设置页「附加组件」分页）、`store.ts`（读写门面——拉取快照合成生效值、平台 onChanged 对账刷新、fail-safe 类型回退）。功能模块经 facade（`effective` / `onEffectiveChange`）或 gate 缓存消费，**不直接触碰平台设置 API**。

### 存储链

`src/rulesHost.ts` 把 `src/rules/rule-store.ts` 纯逻辑接到平台 `AddonStorageFacet`：存储在宿主侧、组件单写点；页面经通道拉快照、写操作经 mutate 通道进宿主执行。外部文件变化自动重载（自写抑制 2s + 去抖 1s + revision 代次轮询）。

## 五、依赖方向纪律（改代码前的核对清单）

- vendor 类型（`types/vendor/`）**只允许 `import type`**——值级消费会在构建期/产物期被双防线拦截（scaffold 测试 + 产物扫描双钉）；
- `@codemirror/*` 同理只允许 type-only；运行时实例经 `sdk.experimental.cm6` 取得；
- `src/rules/` 保持零平台依赖——平台接线模块置 `src/` 平铺；
- 导入语句单行书写（结构契约测试的判定粒度）；
- src 下禁 `new Function` / `eval`（CSP 边界，ADR-0003，scaffold 扫描钉住）；
- 用户可见文字一律经 i18n 字典，禁止字面量。

## 六、测试形态

`npm run test`（vitest）48 个测试文件、1100+ 用例（随批次增长），四种形态各有对象：

- **语义矩阵**——上游行为的逐条对照（`rules-matrix.test.ts` 20 条内置规则、`textFormatter.test.ts` 等），移植功能的忠实度由矩阵钉住；
- **结构契约**——钉工程不变量而非行为：`scaffold.test.ts`（清单/署名/导入纪律）、`ci-workflow.test.ts`（CI 触发与步骤链）、`release.test.ts`（发布纯函数）、`manual-verification.test.ts` 与 `showcase.test.ts`（文档结构契约）；
- **jsdom 冒烟**——`rules-ui.test.ts` / `rules-page.test.ts` 承载自绘 UI 的交互验证；
- **接入层双测**——每个 Intercept 模块配套同名测试，验证 gate 缓存、透传边界与注册形态。

真实键盘 / IME / 安装态验证不在 vitest 内——归 [docs/manual-verification.md](manual-verification.md) 人工清单（#21），两者互补不重复。
