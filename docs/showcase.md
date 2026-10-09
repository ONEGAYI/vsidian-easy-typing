# 范例导读：以本仓库为模板起步新 Vsidian 插件

本仓库有双重身份：其一，easy-typing-obsidian 的全量移植（功能主体）；其二，**Vsidian Plugins 的范例模板**——工程设施、流程约定与文档结构是后续插件作者的起步参照。本文档服务于第二个身份：回答「照着做」的问题。

> 阅读路径：想理解本仓代码内部结构（模块分层、依赖方向），读 [docs/architecture.md](architecture.md)；想复制这套骨架做自己的插件，从下文第二节 checklist 开始。两份文档互不重复。

## 一、范例价值速览

复制本仓库起步，能得到的东西分三类：

- **工程设施**（#22–#24 落地）：三产物构建桥（CM6 双防线）、vendor 类型快照（脚本化 re-vendor）、CI 工作流、打包发布脚本（含体积红线与发行护栏）——全部可原样带走，只改身份字段。
- **流程约定**：GitHub Issues 开票与里程碑节奏、规格先行三要素、与 vsidian 主仓库的跨仓互链模式——独立插件仓可整套沿用。
- **移植方法论**（若你的插件也移植自 Obsidian 生态）：上游锚点对照表、「永不移植清单」决策、平台差异落档（ADR）——见本文第五节。

这些设施的设计依据集中在三份 ADR：[ADR-0001](adr/0001-scaffold-build-bridge-and-vendor.md)（构建桥与 vendor 选型）、[ADR-0002](adr/0002-strict-line-break-mapping.md)（严格换行决策门槛）、[ADR-0003](adr/0003-function-replacement-preregistered-table.md)（CSP 边界下的函数替换体）。

## 二、以本仓库为模板的起步 checklist

按序执行，每步有明确的操作对象与完成判据。示例路径均相对仓库根。

### 第 1 步：复制仓库与改写身份字段

复制整个仓库后，先改身份。**身份字段分散在五处**，漏改任何一处都会在装载或测试期暴露：

| 落点 | 改什么 | 备注 |
| --- | --- | --- |
| `package.json` | `name`、`publisher`、`displayName`、`description`、`version`、`repository.url` | `name` 即插件 ID 的一部分，全局唯一 |
| `package.json` → `vsidianAddon` | `experimental` 各项按需增删 | 只声明实际消费的实验入口；`api` 与 `manifestVersion` 保持 |
| `package.json` → `extensionDependencies` | 不改 | 恒为 `["onegayi.vsidian"]`（宿主依赖） |
| `src/extension.ts` | `SELF_ID` 常量 | 宿主侧 registerAddon 的 owner 身份 |
| `src/page-editor.ts` / `src/page-settings.ts` | `ADDON_ID` 常量 | 页面装载器按此核对入口身份，两处须一致 |
| `src/logging.ts` | `LOG_PREFIX` | 日志前缀，便于宿主控制台区分 |
| `test/scaffold.test.ts` | 清单断言同步 | 钉住 `vsidianAddon` 声明与 LICENSE 署名，改身份后按新形态更新 |

两处硬约束（`test/scaffold.test.ts` 钉死，**不要放宽**）：

- `vsidianAddon.api` 与 `experimental` 各项必须用 `^` 范围——宿主兼容判定要求声明范围覆盖宿主版本，精确版本在宿主升级即判不兼容；
- 依赖版本一律精确无前缀（devDependencies 全部精确版本 + 提交 lockfile）。

### 第 2 步：处理 LICENSE（署名规则）

- **移植类插件**：MIT 双署名——保留上游版权行（如本仓 `Copyright (c) 2026 Yaozhu Ye (upstream project easy-typing-obsidian)`），追加自己的行（`Copyright (c) 2026 <你> and <项目名> contributors`）。`test/scaffold.test.ts` 有署名在场断言，同步改。
- **原创插件**：删除上游行，只留自己的声明。

### 第 3 步：re-vendor SDK 类型快照

`types/vendor/` 是从 vsidian 仓生成的类型快照（**禁止手改**），源码只允许 `import type` 消费。新插件按需裁剪：

1. 改 `scripts/vendorSdkTypes.mjs` 的 `VENDOR_ENTRIES`——按你的插件实际消费的 SDK 面裁剪入口（本仓 11 个入口是全量面；只用行为链与设置的插件可以裁掉 renderers/commands/fold 等）；
2. 确认 `DEFAULT_COMMIT` 指向你基线的 vsidian 提交（升级同理，见第三节）；
3. 本机跑 `npm run vendor:sdk`（需要本地 vsidian 仓，或以 `VSIDIAN_SOURCE_REPO` 环境变量指向）；
4. 跑 `npm run vendor:check` 确认无漂移，随首个提交入库。

### 第 4 步：裁剪领域代码与测试

**删**（本仓的移植主体，与你的插件无关）：`src/` 下除三入口、`src/i18n/`、`src/settings/`、`src/logging.ts`、`src/host-api.ts` 之外的全部领域模块；`docs/specs/` 全部规格；`test/` 下领域测试（保留 `scaffold`、`ci-workflow`、`release`、`i18n`、`settings-*` 等工程与契约形态）。

**改**：三入口收缩为最小骨架（本仓各入口头注释标注了哪些 import 是领域接线，删掉即可）；`CHANGELOG.md` 清空至 `## Unreleased - 开发中`；`CONTEXT.md` 重建为你自己的领域词汇。

**留意**：`src/i18n/` 的双语字典形态（zh 为类型源、en 编译期键集对齐 + parity 测试）建议原样保留——「用户可见文字一律 i18n」从第一个可见文案就成立，后补成本高。

### 第 5 步：核对打包内容清单（REQUIRED_RUNTIME 注意点）

`scripts/release.mjs` 的内容检查有两张清单，**新增或删除运行时资产时必须同步**：

- `REQUIRED_RUNTIME`：VSIX 内必需在场的产物清单。本仓声明了 `dist/` 四产物（三 JS + `settings.css`）——若你的插件**没有设置页**，删掉 `dist/settings.js` / `dist/settings.css` 两项与对应构建配置；若新增随包资产（字体、图标），在此登记；
- 顶层与 `dist/` 白名单：打包最终产物的允许集合。`.vscodeignore` 挡打包输入、检查器挡最终产物，两层独立，新增资产两侧都要过。

三道关（体积红线 / 内容清单 / 解包冒烟）的语义与阈值依据见 `scripts/release.mjs` 头注释与 [AGENTS.md](../AGENTS.md)「工程设施」节。

### 第 6 步：本地验证与首提交

```bash
npm ci             # 精确版本安装（lockfile 随仓库走）
npm run compile    # 三产物构建 + tsc 类型检查——构建通过即 CM6 双防线通过
npm run test       # vitest 全量（契约 + 领域）
npm run package    # 打包 VSIX + 三道关（只产本地 VSIX，无上传路径）
```

全绿后首提交。之后按第四节流程开票推进。

## 三、工程设施如何复制

### 构建桥（tools/ 三件套 + build.mjs）

三个文件各司其职，**建议原样复制、不改内部逻辑**：

- `tools/sdkBridge.mjs`——esbuild 插件：提供虚拟模块 `vsidian-addon-sdk`（`defineAddonPage` 登记工厂、`currentSdk` 读注入槽），并**拒绝组件直接值导入 `@codemirror/*`**；
- `tools/cm6Markers.mjs`——CM6 运行时标记串单源（两个稳定错误文案），供产物扫描判定「是否打包进了第二份 CM6」；
- `tools/buildLib.mjs`——esbuild 配置收敛 + 产物静态扫描（内部路径标记 / 裸 require / CM6 标记）。

**双防线的原理**：Vsidian 页面与宿主共享同一份 CM6 运行时（经 SDK 的 `experimental.cm6` 取得），组件若自己打包一份 CM6，两份运行时状态分裂（扩展注册表、状态字段互不可见）——构建桥从两个时机拦截：

1. **构建期**——`sdkBridge.mjs` 的 `onResolve` 对 `@codemirror/*` 值导入直接报错（`import type` 被 esbuild 剥离，不受影响）；
2. **产物期**——`buildLib.mjs` 逐产物扫描 `cm6Markers.mjs` 的标记串：bundle 含任一即证明裹进了 CM6 发行代码。

**自检方法**（复制后建议跑一次，确认防线在场）：在任意页面源码临时加一行 `import { EditorView } from '@codemirror/view'`（值导入），`npm run build` 应当红并给出「共享 CM6 运行时须经 vsidian-addon-sdk 的 experimental.cm6 取得」的报错；改回 `import type` 后恢复绿。

另一个必踩的坑（ADR-0001 落档）：宿主 CJS 入口的 `activate` / `deactivate` 必须 `module.exports` 显式赋值——esbuild 会消除无消费者的 ESM 导出，不赋值则 VSCode 报「找不到激活入口」。

### vendor 类型快照（scripts/vendorSdkTypes.mjs）

**为什么 vendor**：Vsidian 附加组件 SDK 不发 npm 包，类型契约只能从 vsidian 仓提取。快照用「类型剥离」而非整文件复制：入口文件保留完整导出类型面，内部依赖只保留被引用名字的类型可达闭包，值级导出一律剥离——整文件复制会把平台值级依赖链整面拖进来且不可执行（选型论证见 ADR-0001）。

**日常纪律**：

- 源码只允许 `import type` 自 `types/vendor/`（`test/scaffold.test.ts` 钉住）；
- 每个快照文件头标注来源 commit，**禁止手改**。

**升级锚定提交（re-vendor）流程**：

1. 改 `scripts/vendorSdkTypes.mjs` 的 `DEFAULT_COMMIT` 为新 commit（40 位）；
2. `npm run vendor:sdk` 重新生成 `types/vendor/`；
3. 评审 diff——重点看消费面接口有无破坏性变更；
4. 快照与脚本**同一提交**入库；
5. `npm run vendor:check` 校验无漂移（CI 也跑：无本地源仓时先 partial clone vsidian 再以 `VSIDIAN_SOURCE_REPO` 指向；锚定 commit 不可达必须失败）。

### CI 与发布

CI（`.github/workflows/ci.yml`，#23）单 job 串行四步：compile → vitest（失败时 json 报告上传留证）→ vendor 防漂移 → VSIX 打包上传。触发与步骤链由 `test/ci-workflow.test.ts` 钉住——改 workflow 前先看该测试，改后同步。

发布（#24）两条命令：

- `npm run package`——compile + 打包 + 三道关（体积红线 `SIZE_LIMITS`、内容清单、解包冒烟）。**恒只产本地 VSIX，无任何上传路径**；
- `npm run release -- <x.y.z>`——干净树校验 + 版本号 bump + CHANGELOG Unreleased 段转正 + 打包。

**发行护栏（红线，脚本层已落实）**：对外发布 VSIX 需「vsidian API 落账发行」与「用户明确授权」二者齐备，缺一不发布。脚本无 `--upload` / `--publish` 通道（显式拒绝非零退出），真实发行是人工动作。

CHANGELOG 中文、Keep a Changelog 风格，开发中条目一律记入顶部 Unreleased 段——日常提交随手记，发版时脚本转正。

## 四、流程约定：开票、里程碑与跨仓互链

### 开票与规格先行

任务全部经 GitHub Issues 跟踪，操作约定见 [docs/agents/issue-tracker.md](agents/issue-tracker.md)：中文标题与正文、多行正文先写 UTF-8 文件再 `--body-file`、四个专用标签（`port-from-upstream` / `platform-dependency` / `experimental-cm6` / `ready-for-agent`）。

开实施票前先落**规格文档**（`docs/specs/<主题>.md`），三要素缺一不开工：

1. **验收口径**——可判定的行为断言（不是「支持 X」而是「X 在 Y 条件下产生 Z」）；
2. **上游对照**——移植类写明上游文件/函数/规则 id 锚点；
3. **平台映射**——消费的 SDK 面与已知边界。

实施中发现的边界决策回写规格的「已知边界」节，不留在工单评论区。跨规格的领域词汇先登记 [CONTEXT.md](../CONTEXT.md) 再入票。

### 里程碑节奏

本仓 28 票按五个里程碑推进，节奏可作为独立插件的参照：

| 里程碑 | 票数 | 主题 | 节奏含义 |
| --- | --- | --- | --- |
| M0 工程奠基 | #22–#24 | 脚手架、CI、发布 | **设施先行**：功能开写前构建/测试/发布链路已全绿 |
| M1 稳定行为主线 | #1–#4、#25–#28 | 规则内核、设置、格式化、命令族 | 先走通「稳定 API 能承载的主体功能」，遇缺口开平台票 |
| M2 触发面扩展 | #5–#13 | keymap/粘贴等实验入口功能 | 平台稳定 API 覆盖不到的触发面，经实验入口先行 |
| M3 规则引擎完备 | #14–#18 | 自定义规则、Tabstop、管理 UI | 主线之上的完备化与体验层 |
| M4 体验与收尾 | #19–#21 | i18n、范例文档、人工验证 | 文档与真实环境验证收口 |

节奏的要点：**设施票先于功能票、稳定入口先于实验入口、每个实验入口票内写明回收口径**（平台稳定入口落地后按票内迁移口径回收 `experimental-cm6` 票）。

### 与 vsidian 主仓库的跨仓互链

插件依赖平台能力而平台暂缺时，**不在本仓绕过，而是开平台票互链**：

1. 本仓开票打 `platform-dependency` 标签，正文链接 vsidian 主仓票（本仓模式：平台缺口集中开在 [vsidian#399–#407](https://github.com/ONEGAYI/vsidian/issues/399)）；
2. 平台票评论区挂本仓依赖票的反向链接——平台实施者能看到落地影响面；
3. 平台票落地后评论解锁本仓对应票（`experimental-cm6` 票按票内口径迁移到稳定入口）；
4. `types/vendor` 锚定的 commit 对应平台基线——升级平台依赖时 re-vendor 与功能迁移同批走。

这套模式让「平台补能力」与「插件迁移」两个仓库的进度互相可见，避免插件侧长期持有平台私有 API 的耦合。

## 五、上游致敬与许可

### 许可

本插件移植自 [easy-typing-obsidian](https://github.com/Yaozhuwa/easy-typing-obsidian)（MIT，作者 Yaozhuwa）v6.0.9——上游五年持续打磨的成果是本项目的起点，功能语义以其文档与源码为事实源。本项目同样采用 MIT 并保留上游版权声明（LICENSE 双署名）。移植类插件照此办理：上游声明一行不动，自己的声明追加其下。

### 功能对应表

工单 ↔ 上游文件锚点的全量对照（上游行号锚点以上游克隆 v6.0.9 为准，按内容锚点优先）：

| 本仓工单 | 功能域 | 上游锚点 |
| --- | --- | --- |
| #1 | 规则引擎内核 + 20 条内置规则 | `src/rule_engine.ts`、`src/default_rules.ts` |
| #2 | 注释切换命令 | `src/comment_toggle.ts` |
| #3 | 设置项 schema 化 | `src/settings.ts`（30 字段） |
| #4 | 行内代码/公式/链接间距 | `src/formatting/inline_spacing.ts` |
| #5 | 语法树行类型适配 | `src/core.ts:658-788`、`src/syntax.ts` |
| #6 | IME compose 去重核验 | 调研票：`src/cm_extensions.ts`（事务路径与 compositionend 补发） |
| #7 | Tabout（Tab 跳出配对符） | `src/keyboard_handlers.ts:97-135` |
| #8 | 智能退格（空列表/引用清除） | `src/keyboard_handlers.ts`（handleBackspace 分支） |
| #9 | Delete/SelectKey 触发规则 | `src/rule_engine.ts`、`src/rule_processor.ts`、`src/cm_extensions.ts` |
| #10 | BetterCodeEdit 代码块增强 | `src/keyboard_handlers.ts:32-54,199-220,672-676`、`src/cm_extensions.ts:113-166,279-324`、`src/syntax.ts:43-83` |
| #11 | 渐进选择与选择当前块 | `src/keyboard_handlers.ts:509-676,815-825` |
| #12 | SmartPaste 与纯文本粘贴 | `src/cm_extensions.ts`（SmartPaste 分支）、`src/main.ts:75-83,274-283` |
| #13 | 下方新建行（+ 严格换行 ADR） | `src/keyboard_handlers.ts:222-297,728-762` |
| #14 | 自定义规则 JSON 持久化 | `src/rule_manager.ts` |
| #15 | Tabstop 占位符导航 | `src/tabstop.ts`、`src/tabstops_state_field.ts` |
| #16 | 规则管理 UI | `src/rule_manager.ts`（Obsidian setting 形态 → 自绘 DOM） |
| #17 | 函数替换体（预注册表） | `src/default_rules.ts`（10 条函数体规则 → ADR-0003） |
| #18 | 折叠标题处 Enter | `src/keyboard_handlers.ts`（enterCollapsedHeading） |
| #25 | 行为链接入 | `src/rule_processor.ts`（triggerCvtRule）、`src/cm_extensions.ts`（tryProcessInput） |
| #26 | 自动格式化 | `src/formatting/`（四文件）、`src/core.ts`（formatLineOfDoc） |
| #27 | 自定义正则保护区 | `src/core.ts:525-647`（splitTextWithLinkAndUserDefined） |
| #28 | 格式化命令族 + 文件排除 | `src/formatting_commands.ts` |
| #19 | i18n 与文档 | `src/lang/locale/` |
| #22–#24 | 工程设施 | 无上游（本仓原创，蓝本为 vsidian `test/examples/`） |

20 条内置规则的逐条语义矩阵见 [docs/specs/rule-engine.md](specs/rule-engine.md)（Input 类 10 条、Delete 类 6 条、SelectKey 类 4 条；README 功能清单表述的「22 条」为开票期计数偏差，以规格与 `src/rules/default-rules.ts` 头注口径为准）。

### 永不移植清单（三条）

不因顺手放宽，新增移植项先对照此表：

| 上游项 | 不移植理由 |
| --- | --- |
| MS-IME 修复 | Obsidian/Electron 平台的输入法事件修补，VSCode webview 事件管线不同构，移植无对象 |
| macOS 右键菜单修复 | 同为平台特定修补，Vsidian 无对应菜单链路 |
| TryFixChineseIME | 上游死设置（注册但无生效逻辑），移植只会制造假的设置项 |

### blocked 项现状（#4 / #5 / #10）

三票因平台能力缺口挂起，现状如下（细节见各票与 [vsidian#399–#407](https://github.com/ONEGAYI/vsidian/issues/399)）：

- **#5 语法树行类型适配**（blocked 链的根）——上游语法树感知功能依赖 HyperMD 专有节点名；vsidian#406 实施发现 live 编辑器上 `syntaxTree()` 恒返回空树（live 树不经 language facet），实施途径以 vsidian#408（live 行类型查询能力）落地形态为准。HyperMD→Lezer 映射表仍是核心资产；
- **#4 行内间距策略**——依赖 #5 与 vsidian#406（experimental.cm6 暴露 `@codemirror/language`）；纯决策逻辑可先行开发，接线待依赖落地；
- **#10 BetterCodeEdit**——依赖 #5（代码块边界识别）；实验入口，vsidian#402 落地后迁移。

blocked 期间的降级先例：#11/#27 等票以正则降级版先行（`src/blockScan.ts`、`src/ruleScopeFallback.ts`），#5 落地后整体替换为树版判定、调用面形状保持不变——**降级实现 + 升级点标注**是处理平台缺口的标准姿势。
