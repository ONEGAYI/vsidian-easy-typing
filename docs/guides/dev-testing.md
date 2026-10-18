# dev 联调指南：双 VSIX 隔离 profile 与 vendor 锚定

本仓的联调对象是两个独立产物：平台（vsidian VSIX）与被测组件（本仓 VSIX）。本指南面向开发者与后续联调会话，钉住两者如何对齐到同一隔离环境里做真宿主联调——装载验证、两道对齐闸、re-vendor 纪律与执行入口。

> 相关阅读：[人工验证清单](../manual-verification.md)（安装步骤全文与宿主版本矩阵） · [ADR-0001](../adr/0001-scaffold-build-bridge-and-vendor.md)（vendor 机制选型）

**与人工验证清单的分工**：安装命令、隔离 profile 建目录与矩阵基线的全文维护在[人工验证清单](../manual-verification.md)「宿主版本矩阵」节，本指南引用不重复。本指南只写 dev 视角：为什么这样装、装完核对什么、对齐闸失守时怎么修。

## 目录

- [联调环境总览](#联调环境总览)
- [双 VSIX 隔离 profile 安装链路](#双-vsix-隔离-profile-安装链路)
- [两道对齐闸](#两道对齐闸)
- [re-vendor 纪律](#re-vendor-纪律)
- [与人工验证清单的联动](#与人工验证清单的联动)
- [执行入口约定](#执行入口约定)

---

## 联调环境总览

三个件装进一个隔离 profile：

| 件 | 来源 | 说明 |
| --- | --- | --- |
| vsidian 平台 VSIX | vsidian 主仓锚定 commit 打包（或 release 产物） | 兼容基线见清单「维度一」；打包命令 `npx @vscode/vsce package --no-dependencies` |
| 本组件 VSIX | 本仓 `npm run package` | 产出 `vsidian-easy-typing-<version>.vsix`，compile + 三道打包关（体积红线 / 内容清单 / 解包冒烟）已过 |
| VSCode 宿主 | 任意 1.82.3 及以上 | 下界承诺 `^1.82.3`；本机可复用 vsidian 主仓 `.vscode-test/` 下已解压的 1.82.3 便携宿主 |

隔离 profile（独立的 `--user-data-dir` 与 `--extensions-dir` 两目录）保证联调不污染日常环境——这一模式与 vsidian 主仓 `test/integration/runInstalled.mjs` 的安装态回归链路同构，已在彼侧验证过。

## 双 VSIX 隔离 profile 安装链路

### 产物与安装顺序

两条 VSIX 经 `--install-extension` 装入**同一**隔离 profile，命令与目录约定全文见清单「维度二」。dev 视角要理解的是顺序约束：

**先装宿主，再装组件**。原因有二：

1. 本组件清单声明 `extensionDependencies: ["onegayi.vsidian"]`——宿主不在场时组件激活直接失败（activate 找不到宿主导出即抛错）；
2. vsidian 尚未在 marketplace 发行，VSCode 无法自动解析该依赖，必须手动先装宿主 VSIX。

### 安装与启动的实操要点

三个坑均来自 vsidian 仓 `runInstalled.mjs` 已验证的同构链路与本指南走通实测（2026-10-12）：

1. **安装命令须经 `bin\code.cmd` CLI 入口执行**（可执行文件同级的 `bin/` 子目录），不要直接调 GUI 主程序 `Code.exe`——后者会拉起完整窗口而不返回（runInstalled.mjs 实测注释）。
2. **加 `--disable-updates`**：CLI 默认做产品更新检查，网络受限时会长时间悬挂。
3. **启动加 `--disable-workspace-trust`**：全新 profile 默认处于受限模式，第三方扩展一律不激活——exthost 日志只有内置扩展时先想到这一条。

日志观察位置：隔离 profile `user-data/logs/<时间戳>/window1/` 下 `exthost/exthost.log`（扩展激活）与 `renderer.log`（宿主文件观察器等）。

### 装载验证三件

装完启动宿主（同一 `--user-data-dir` / `--extensions-dir` 参数）后核对三件事，每件有独立的观察通道：

1. **兼容检查通过**：vsidian 装载器对组件清单做兼容判定（`vsidianAddon.api` 与 `experimental` 各项范围须包含宿主版本），通过才接入。观察通道是「Vsidian 附加组件」输出通道（Output 面板；英文界面显示 Vsidian Add-ons）——通过时无拒载记录；被拒时形如 `addon ONEGAYI.vsidian-easy-typing register rejected: incompatible-api (declared api ..., host ...)`，同时组件 activate 抛错进入扩展宿主日志。注意该输出通道是普通 channel、**不落盘**——交互场景看 Output 面板；日志文件面的等价证据是 exthost 日志中组件激活成功且无异常（被拒必然抛错留痕）。
2. **组件激活**：exthost 日志（上节路径）出现 `ExtensionService#_doActivateExtension ONEGAYI.vsidian-easy-typing, activationEvent: 'api', root cause: onegayi.vsidian`——依赖链激活；宿主不在场的典型报错是 `ONEGAYI.vsidian-easy-typing: 当前扩展宿主中未找到 Vsidian（onegayi.vsidian）`（i18n `noHost` 消息；英文界面为 `Vsidian (onegayi.vsidian) not found in this extension host`）。setup 生命周期跑通的旁证：renderer.log 中 vsidian 为本组件创建的存储目录观察器记录（`...addons/ONEGAYI.vsidian-easy-typing`，ENOENT 属预期——目录惰性创建）。
3. **experimental 入口可用**：行为生效即证明——Live 正文键入 `。。` 出 `.`（规则引擎经 `cm6` / `syntax` 等实验入口驱动）。设置侧入口同证：Vsidian 设置「附加组件」分页出现本组件条目，组件详情打开五 Tab 自绘设置页（#55 起为主视图）。清单层面的蕴含关系：兼容判定通过 = 声明的全部实验入口在宿主 API 面在场（任一缺位即拒载）；行为级核验属 #21 人工清单（A1 起逐项），日志联调不替代。

> debug 日志门控（默认关）：设置页开启 `debug` 后，扩展宿主控制台出现 `[vsidian-easy-typing]` 前缀日志（`src/logging.ts`），联调排障时可作补充通道。

### 平台侧改动后的重打包重装

联调中发现平台侧问题、在 vsidian 主仓修了代码时：

1. vsidian 主仓重新打包 VSIX（同锚定 commit 或新 commit，见 re-vendor 纪律判断）；
2. 隔离 profile 内先卸旧再装新：`--uninstall-extension onegayi.vsidian` 后再 `--install-extension`（同一 profile 参数）；
3. 重启宿主，重跑装载验证三件。

若平台改动触及本仓消费的 API 面（类型或语义变化），先走下方 re-vendor 流程再联调；纯实现修复（类型面未动）则直接重打包重装即可——判据是 `npm run vendor:check` 是否仍绿。

## 两道对齐闸

组件与平台的对齐在两个时点各有一道闸，失守形态不同：

| 闸 | 时点 | 机制 | 失守形态 |
| --- | --- | --- | --- |
| vendor 类型快照 | 编译期 | `types/vendor/` 锚定 vsidian commit，`npm run vendor:check` 校验无漂移（CI 每次跑） | CI / 本地红灯：快照与 `DEFAULT_COMMIT` 重生成结果不一致 |
| 清单兼容声明 | 装载期 | `vsidianAddon.api` 与 `experimental` 各项 `^` 范围须含宿主版本 | 拒载：`register rejected: incompatible-api`，组件行为不生效 |

### 编译期：vendor 类型快照锚定

- `types/vendor/` 是从 vsidian 仓生成的类型快照，文件头标注来源 commit，**禁止手改**；源码只允许 `import type` 消费（`test/scaffold.test.ts` 钉住）。
- **锚点实值以 `scripts/vendorSdkTypes.mjs` 的 `DEFAULT_COMMIT` 为准**，当前为 `f7b80d6eda00d16f4fb7ead49aa86fcd41cb75c8`（API 1.2.0 发行基线，含 #55 消费的 settingsContext 设置页上下文面）。票据与文档转述的锚点可能滞后，一律回脚本核对。
- `npm run vendor:check` 用 `DEFAULT_COMMIT` 重新生成并比对已提交快照。vsidian 升级（换装新平台 VSIX）后先跑它确认消费面未漂移，再开联调。
- 源仓定位序：`--source` > 环境变量 `VSIDIAN_SOURCE_REPO` > 脚本内默认相对路径。读取经 `git show <commit>:<path>` 按提交快照取文，不受源仓工作树状态影响。
- **本地跑 vendor 系命令在两仓同级布局下裸跑即可**（默认约定：本仓与 vsidian 主仓同在 `_Extensions` 目录下，脚本默认相对路径即指向同级主仓根）；源仓不在同级位置时（如模板复制者）以 `--source` 或 `VSIDIAN_SOURCE_REPO` 指向 vsidian 主仓根，不可达时报「源仓不是 git 仓库」退出并附指引。CI 即显式形态（partial clone vsidian 后以 `VSIDIAN_SOURCE_REPO` 指向，锚定 commit 不可达必须失败）。

### 装载期：清单兼容声明与拒载行为

- 本仓清单声明 `vsidianAddon.api ^1.1.0`（#55 起：settingsContext 设置页上下文面自 API 1.1.0 发行，升下界属最低能力如实声明）与 `experimental` 各项（`cm6` / `headingFold` / `viewIdentity` / `syntax` / `hostSettings`）一律 `^` 范围——**范围必须 `^`**：宿主兼容判定要求声明范围包含宿主版本，精确版本在宿主升级即判不兼容（平台实证坑，`test/scaffold.test.ts` 钉死）。
- vsidian 装载器兼容判定的两种拒载：`api-range`（api 范围不含宿主版本）与 experimental 声明的入口宿主未提供（entry not available）。拒载发生在 `registerAddon`——组件进程照常激活但注册被拒，activate 抛错，行为与设置页条目均不出现。
- 联调排障时先看拒载日志区分两道闸：`register rejected: incompatible-api` 是装载期闸（版本声明问题）；编译都过不了是编译期闸（快照漂移或类型不匹配）。

## re-vendor 纪律

平台 main 前移、本仓要消费新 API 时（新入口或类型面扩展）：

1. 改 `scripts/vendorSdkTypes.mjs` 的 `DEFAULT_COMMIT` 为目标 commit；
2. `npm run vendor:sdk` 重新生成 `types/vendor/`，评审 diff；
3. 全量验证：`npm run compile` + `npm run test`（`npm run vendor:check` 自证快照一致）；
4. 提交——**快照与脚本同 PR**：拆开提交即触发 `vendor:check` 漂移红灯。

**锚定点选择纪律**：锚定跟随 vsidian **最近 release**，不 chasing main——main 上尚未进入 release 的 API 不进锚定。当前态是例外中的口径：vsidian API 尚未正式发行（1.0.0 候选），没有可跟随的 release 点，故锚定即承载所需 API 的 main commit；vsidian API 正式发行后，本条回归「跟随最近 release」。

re-vendor 后联调环境同步换装：新锚定 commit 构建的 vsidian VSIX 重装入隔离 profile（先卸旧再装新），重跑装载验证三件。

## 与人工验证清单的联动

- **平台 VSIX 最低版本要求**：清单「维度一」标注联调基线的最低版本。当前 vsidian API 未正式发行（1.0.0 候选），最低版本口径 = **锚定 commit（`DEFAULT_COMMIT`）构建的 VSIX**；vsidian API 发行后改为「本组件消费的 API 首次可用的 release 点」，届时同步更新清单标注。
- **一致性口径**：联调 profile 即清单执行环境——同一隔离 profile（同 `--user-data-dir` / `--extensions-dir`）内先完成本指南装载验证三件，通过后该环境直接进入清单逐项执行，不另建环境。每轮结果回填清单「当前执行记录」与矩阵表，矩阵轮（vsidian 升级 / VSIX 变更）备注 `vendor:check` 核对结果。

## 执行入口约定

后续会话或用户做 #21 联调时的固定入口，按序读三处：

1. **本指南**：装载验证三件与两道对齐闸的判断（dev 视角入口）；
2. **清单「宿主版本矩阵」节**：安装命令全文、矩阵基线 commit 实值与维度约定；
3. **清单「当前执行记录」**：历轮环境、覆盖与结果，本轮记录在此追加。

不从零摸索环境；环境异动（vsidian 升级、VSIX 版本变更）后从第 1 步重走装载验证，再进入清单执行。
