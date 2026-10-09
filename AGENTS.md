# vsidian-easy-typing

Vsidian（VSCode 扩展 [onegayi.vsidian](https://github.com/ONEGAYI/vsidian)）的首个附加组件：输入体验增强，全量移植自 [easy-typing-obsidian](https://github.com/Yaozhuwa/easy-typing-obsidian)（MIT，v6.0.9）。本仓库同时是 **Vsidian Plugins 的范例模板**——工程设施与文档结构是后续插件的参照物，任何变更都应保持示范质量。

> 当前状态：**规划与开票完成，未开始实施**（2026-10-08）。28 张工单按 M0–M4 五里程碑推进（Issues）；依赖的平台能力缺口在 vsidian 主仓库 [#399–#407](https://github.com/ONEGAYI/vsidian/issues/399) 跟踪，两侧票据互链。首个实施票：[#22 项目脚手架与工程设施](https://github.com/ONEGAYI/vsidian-easy-typing/issues/22)。

## 约定

- 通用工程规范（提交规范、TDD、文件树维护）遵循工程根 `D:\CODE\Project\AGENTS.md`，此处不重复展开。
- **任务跟踪**：GitHub Issues（本仓库），gh CLI 操作约定对齐 vsidian 主仓库——中文标题与正文、多行正文先写 UTF-8 文件再 `--body-file`。专用标签：
  - `port-from-upstream`：自上游移植的工单；
  - `platform-dependency`：依赖 vsidian 平台补能力，落地前相关子项挂起；
  - `experimental-cm6`：经实验 cm6 入口实现（无兼容承诺），平台稳定入口落地后按票内迁移口径回收。
  - 切片完成、验收标准明确的票打 `ready-for-agent` 后方可认领实施。
- **移植口径**：以工单「上游参考」节的文件锚点对照上游源码；上游文档（README / Doc / changelog）是行为语义的事实源。**永不移植项**（已排除，不因顺手放宽）：MS-IME 修复、macOS 右键菜单修复、TryFixChineseIM（上游死设置）。
- **跨仓依赖**：`platform-dependency` 票正文互链 vsidian 主仓库票；平台票评论区挂有本仓依赖票的反向链接。平台票落地后，对应 `experimental-cm6` 票执行回收。
- **用户可见文字一律 i18n**：中英双语起步（完整化归 [#19](https://github.com/ONEGAYI/vsidian-easy-typing/issues/19)），禁止新增硬编码文案。
- **许可与致敬**：MIT 双署名——保留上游 `Copyright (c) 2026 Yaozhuwa` 声明 + 本项目声明；LICENSE 文件随 [#22](https://github.com/ONEGAYI/vsidian-easy-typing/issues/22) 落地。

## 技术栈（目标态，随 #22 落地，以票面验收为准）

- **产物形态**：独立 VSCode 扩展（VSIX）——宿主 CJS（node18 / external vscode）+ 编辑器页面与设置页面 chrome114 IIFE（对齐 VSCode 1.82.3 下界），`vsidianAddon` 清单声明 + `extensionDependencies`。
- **构建桥**：复制 vsidian `test/examples/` 模式（`@codemirror/*` 值导入拒绝 + 产物 CM6 标记扫描双防线）；SDK 类型 vendor 快照（标注来源 `vsidian@<commit>`，re-vendor 流程脚本化）。
- **依赖**：一律精确版本，提交 lockfile。

## 工程设施（#22 落档）

- **命令速查**：`npm run compile` = 三产物构建（`npm run build`）+ `tsc --noEmit`；`npm run test`（vitest 冒烟与结构契约）；`npm run vendor:sdk` / `npm run vendor:check`（SDK 类型快照生成 / 漂移校验）。构建即双防线：SDK 构建桥拒绝 `@codemirror/*` 值导入 + 逐产物扫描（CM6 运行时标记 / vsidian 内部路径 / 裸 require）。
- **CI（#23 落档）**：`.github/workflows/ci.yml` 单 job `ci`——push(main)/PR/手动触发，node 22 + `cache: npm` + `npm ci`，串行 compile（esbuild 三产物 + tsc）、vitest 单测（json 报告失败时上传留证，artifact 名带 attempt 号防 rerun 覆盖）、vendor 防漂移（CI 无本地源仓，先 partial clone vsidian 再以 `VSIDIAN_SOURCE_REPO` 指向；锚定 commit 不可达必须失败）、VSIX 打包上传（`npx @vscode/vsce package --no-dependencies`，产物排除清单在 `.vscodeignore`，体积红线归 #24）。触发与步骤链由 `test/ci-workflow.test.ts` 钉住。
- **打包与发布（#24 落档）**：`npm run package`（compile + `scripts/release.mjs package`）产出本地 VSIX 并过三道关——体积红线（`SIZE_LIMITS` 双线模式对齐 vsidian 主仓，阈值依据在脚本注释：基线解压约 248 KB，警告线 1 MB / 失败线 2 MB）、内容清单检查（必需产物 / 禁止模式 / 顶层与 dist 双白名单；`.vscodeignore` 挡打包输入、检查器挡最终产物，新增运行时资产须同步登记 `REQUIRED_RUNTIME` 与白名单）、解包冒烟（VSIX 内 manifest 合法性与 `version`/`main`/`extensionDependencies`/`vsidianAddon` 声明核对；真实安装态归 #21 人工清单）。`npm run release -- <x.y.z>` 做发版准备：干净树校验 + 版本号 bump（package.json 文本级只动 version 行）+ CHANGELOG Unreleased 段转正 + 打包。CHANGELOG.md 中文、Keep a Changelog 风格，开发中条目一律记入顶部 Unreleased 段。**发行护栏（票面红线）**：对外发布 VSIX 需「vsidian API 落账发行」+「用户明确授权」缺一不发布——脚本无任何上传路径（`--upload`/`--publish` 显式拒绝非零退出），恒为 dry-run。纯函数契约由 `test/release.test.ts` 钉住（编译期类型声明在 `scripts/release.d.mts`）。
- **vendor 快照纪律**：`types/vendor/` 是从 vsidian 仓生成的类型快照（文件头标注来源 commit），**禁止手改**；源码只允许 `import type` 消费（`test/scaffold.test.ts` 钉住）。升级锚定提交：改 `scripts/vendorSdkTypes.mjs` 的 `DEFAULT_COMMIT` 重跑生成，快照与脚本同 PR。生成机制与选型见 [ADR-0001](docs/adr/0001-scaffold-build-bridge-and-vendor.md)。
- **源码导入纪律**：`@codemirror/*` 仅 type-only 导入（运行时实例经 `sdk.experimental.cm6` 取得）；宿主入口的 `activate`/`deactivate` 必须 `module.exports` 显式赋值（esbuild 死代码消除坑）；导入语句单行书写（结构契约测试的判定粒度）。
- **清单红线**：`vsidianAddon.api` 与 `experimental` 各项**必须用 `^` 范围**（精确版本在宿主升级即判不兼容，测试钉死）；依赖版本一律精确无前缀。
- **目录**：`src/` 三入口（extension 宿主 / page-editor 编辑器页 / page-settings 设置页）+ 领域模块（`src/i18n/` 双语字典、`src/settings/` 设置定义/默认值/读写门面、`src/logging.ts` debug 日志门控——#3 落档）+ `tools/` 构建桥 + `scripts/` 工具脚本 + `types/vendor/` 快照 + `test/` 冒烟与契约；规格落 `docs/specs/`（约定见其 README），领域词汇先登记 [CONTEXT.md](CONTEXT.md) 再入票。
