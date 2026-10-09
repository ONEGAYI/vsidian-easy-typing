# vsidian-easy-typing

> Vsidian 的输入体验增强附加组件——全量移植自 [easy-typing-obsidian](https://github.com/Yaozhuwa/easy-typing-obsidian)，同时作为 **Vsidian Plugins 的范例模板**。

为中文与英文混排、Markdown 密集写作优化输入体验：标点与配对符号的智能转换、中英文间自动空格、代码块与列表的编辑增强、可自定义的文本变换规则引擎。

## 状态

规划与开票完成（2026-10-08），实施未开始。

- 28 张工单 · 五个里程碑（M0 工程奠基 → M4 体验与收尾）：[Issues](https://github.com/ONEGAYI/vsidian-easy-typing/issues)
- 依赖的平台能力缺口在 vsidian 主仓库 [#399–#407](https://github.com/ONEGAYI/vsidian/issues/399) 跟踪，与本项目票据互链
- 首个实施票：[#22 项目脚手架与工程设施](https://github.com/ONEGAYI/vsidian-easy-typing/issues/22)

## 功能范围（移植目标）

- **输入规则**：22 条内置规则（配对补全/跳过、全角半角转换、`··`→行内代码、`￥￥`→公式等）+ 自定义规则引擎（正则、捕获组引用、作用域、优先级、Tabstop 占位符）
- **自动格式化**：中英文/数字间自动空格、前缀词典抑制、自定义正则保护区、行内代码/公式/链接间距
- **编辑增强**：Tabout 跳出配对符、智能退格（空列表清除/有序重编号）、代码块编辑增强、渐进选择、智能粘贴
- **命令族**：格式化全文/选区、删除空行、注释切换、选区转代码块等

不移植项：MS-IME 修复、macOS 右键菜单修复（Obsidian/Electron 平台特定修补）。

## 致敬与许可

上游 [easy-typing](https://github.com/Yaozhuwa/easy-typing-obsidian)（MIT，作者 Yaozhuwa）五年持续打磨的成果是本项目的起点，功能语义以其文档与源码为事实源。本项目同样采用 MIT 许可并保留上游版权声明（LICENSE 随 [#22](https://github.com/ONEGAYI/vsidian-easy-typing/issues/22) 落地）。

## 开发

```bash
npm install        # 安装 devDependencies（精确版本，无运行时依赖）
npm run compile    # 三产物构建（宿主 CJS + 编辑器/设置页 chrome114 IIFE）+ tsc 类型检查
npm run test       # vitest 冒烟与结构契约
npm run vendor:check  # 校验 types/vendor SDK 类型快照无漂移
```

工程设施细节（构建桥双防线、vendor 类型快照、清单红线）见 [AGENTS.md](AGENTS.md) 的「工程设施」节与 [ADR-0001](docs/adr/0001-scaffold-build-bridge-and-vendor.md)。

## 相关

- 宿主扩展：[vsidian](https://github.com/ONEGAYI/vsidian)（类 Obsidian 的 Markdown 双视图编辑器）
- 附加组件开发指南：vsidian 仓库 `docs/addons/developer-guide.md`

---

*English README will land with [#19](https://github.com/ONEGAYI/vsidian-easy-typing/issues/19)（i18n 双语化）.*
