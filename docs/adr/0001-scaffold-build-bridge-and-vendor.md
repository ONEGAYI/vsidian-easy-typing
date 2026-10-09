# ADR-0001：脚手架选型——构建桥复制与 vendor 类型快照

- 状态：已接受（工单 #22，2026-10-09）
- 背景：本仓是首个 Vsidian 附加组件，同时是 Vsidian Plugins 范例模板；工程设施需对齐 vsidian `test/examples/` 官方蓝本，兼顾「照此复制起步」的示范职责。

## 决策一：三产物构建直接复制 vsidian 构建桥模式

**采纳**：复制 `test/examples/` 的构建桥三件套（`tools/sdkBridge.mjs` 原样、`tools/cm6Markers.mjs` 摘出单源、`tools/buildLib.mjs` 收敛为单工程形态），双防线不变：

1. **构建期**——SDK 构建桥拒绝 `@codemirror/*` 值导入（type-only 导入被 esbuild 剥离，不受影响）；
2. **产物期**——逐产物静态扫描：CM6 运行时标记、vsidian 内部路径标记（含 `types/vendor`）、裸 require（页面零 require；宿主仅 `vscode`）。

产物目标：页面 chrome114 IIFE（对齐下界宿主 1.82.3 = Electron 25 / Chromium 114，**不是** vsidian 本体的 chrome118）；宿主 node18 CJS（external vscode）。CJS 入口的 `activate`/`deactivate` 必须 `module.exports` 显式赋值（esbuild 会消除无消费者的 ESM 导出——蓝本实测坑）。

**否决**：自写构建或引入打包框架——蓝本即生产验证过的路径，范例模板的首要品质是「与平台样例一致」。

## 决策二：vendor 类型快照用「类型剥离」而非整文件复制

**采纳**：`scripts/vendorSdkTypes.mjs`（TS 编译器 API 驱动）从 vsidian 仓 `git show <commit>:<path>` 读取源文件，生成 `types/vendor/` 类型快照：

- **入口文件完整面**：公开 API 面（addonPage + 六组能力 facet + addonIdentity + 宿主 addonRegistry）保留全部导出的 interface/type/enum；
- **内部依赖最小闭包**：经 type 导入发现的 vsidian 内部模块（protocol/contextMenu/keybindings 等 6 个）只保留「被引用名字」的类型可达闭包；
- **值级导出一律剥离**（校验函数、运行时数据表）；常量仅在被 `typeof` 引用时保留（同文件 `as const` 表）；**产物镜像源码目录结构**，相对导入路径原样有效；
- 每文件头标注 `vendored from ONEGAYI/vsidian@<commit>`；`npm run vendor:check` 校验快照与生成器无漂移（CI 入口，#23 接线）。

**理由**：整文件复制会把 vsidian shared 层的值级依赖链（protocol → settings/findOptions/refContent…）整面拖进本仓，且值代码不可执行（宿主实现不在场）；纯手写声明则无法脚本化 re-vendor。类型剥离兼顾体积、可校验与自动化。

**已知边界**：保留的类型若引用函数/类（跨文件值 `typeof` 同理），生成器显式报错而非静默产出坏快照——出现时人工改写为结构类型。词法扫描排除了注释与字符串（实测坑：接口属性名 `hasSelection` 曾误保同名 const 谓词函数）。

## 决策三：清单声明与依赖锁定

- `vsidianAddon.api: "^1.0.0"`、`experimental.cm6: "^1.1.0"`——**范围必须 `^`**：宿主兼容判定要求声明范围包含宿主版本，精确版本在宿主升级即判不兼容（平台实证坑，由 `test/scaffold.test.ts` 钉死）；
- `extensionDependencies: ["onegayi.vsidian"]`、`engines.vscode ^1.82.3`、`extensionKind ["workspace"]`、`activationEvents []`（由依赖链激活）；
- devDependencies 全部精确版本对齐 vsidian lockfile（typescript/esbuild/vitest/@types/*，另加 @codemirror/state、view、language 三个**仅类型消费**的 devDep——vendor 快照与页面源码的 `import type` 需要）；无运行时依赖。

## 决策四：i18n 架构预留、暂不落语言包实体

脚手架无用户可见文字（宿主侧仅开发者向英文诊断信息），不建语言包实体；中英双语字典随首个含用户可见文字的功能票落地（完整化归 #19）。

## 后果

- 功能票实施者从 `src/page-editor.ts` / `src/page-settings.ts` / `src/extension.ts` 三个占位入口扩展；SDK 类型一律 `import type` 自 `types/vendor/`。
- 升级快照流程：改脚本 `DEFAULT_COMMIT` → `npm run vendor:sdk` → 评审 diff → 提交（快照与脚本同 PR）。
- 新插件仓复制本仓起步时：改 package.json 身份字段与 `VENDOR_ENTRIES` 按需裁剪，其余文件原样带走。
