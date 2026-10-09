# vsidian-easy-typing

**[English](README.en.md)** | 中文

> Vsidian 的输入体验增强附加组件——全量移植自 [easy-typing-obsidian](https://github.com/Yaozhuwa/easy-typing-obsidian)，同时作为 **Vsidian Plugins 的范例模板**。

为中文与英文混排、Markdown 密集写作优化输入体验：标点与配对符号的智能转换、中英文间自动空格、代码块与列表的编辑增强、可自定义的文本变换规则引擎。所有功能以 Vsidian 附加组件形态接入——规则命中走平台行为链（与撤销栈、行为冲突管理原生协作），设置经平台「附加组件」设置页统一呈现，界面中英双语跟随 VSCode 显示语言。

## 状态

首版功能主体已实施（28 张工单中二十余张并入主线，单测全绿）；收尾进行中——命令族（[#28](https://github.com/ONEGAYI/vsidian-easy-typing/issues/28)）、打包发布（[#24](https://github.com/ONEGAYI/vsidian-easy-typing/issues/24)）、范例导览（[#20](https://github.com/ONEGAYI/vsidian-easy-typing/issues/20)）与人工验证（[#21](https://github.com/ONEGAYI/vsidian-easy-typing/issues/21)）。

- 五个里程碑（M0 工程奠基 → M4 体验与收尾）：[Issues](https://github.com/ONEGAYI/vsidian-easy-typing/issues)
- 依赖的平台能力缺口在 vsidian 主仓库 [#399–#407](https://github.com/ONEGAYI/vsidian/issues/399) 跟踪，与本项目票据互链
- 逐功能实施规格与边界：[docs/specs/](docs/specs/README.md)；用户手册：[docs/guides/](docs/guides/)

## 功能一览

### 输入规则（规则引擎）

| 功能 | 说明 |
| --- | --- |
| 内置规则 20 条 | 全角标点连击转半角（`。。` → `.`）、全角括号引号自动配对与跳过、`··` 转行内代码、`￥￥` 转公式、行首 `》` 转引用标记、成对结构联动删除（`$|$`、`==|==`、空代码块、双链）、选中文字按键包裹（`·` 包行内代码、`【` 包 `[]` 等） |
| 自定义规则 | 三种类型（输入 / 删除 / 选中替换）、正则匹配（`i`/`m`/`u` 标志）、捕获组引用（`[[n]]` / `[[Rn]]`）、Tabstop 占位符（`$0`、`$1`、`${1:text}` 并支持 Tab 跳转）、作用域限定（文本/公式/代码 + 围栏语言）、优先级与 Tab 触发模式 |
| 函数替换体 | 替换逻辑可为函数（10 个预注册函数承载内置规则）；自定义函数经组件 fork 接入，无动态代码执行（CSP 安全） |
| 规则管理页 | 图形化编辑表单与单规则试运行、拖拽排序、JSON 导入导出（文件名与上游 `easy-typing-user-rules.json` 跨生态兼容）、内置规则停用/恢复/重置 |
| 规则存储 | `builtin-rules.json` / `user-rules.json` 存于 Vsidian 组件数据目录，外部同步工具可直接编辑，打开的编辑器自动重载 |

规则语法完整参考见 [自定义规则指南](docs/guides/custom-rules.md)。

### 自动格式化

| 功能 | 说明 |
| --- | --- |
| 中英混排空格 | 中文↔英文、中文↔数字、数字↔英文边界自动插入空格（`你好world` → `你好 world`） |
| 前缀词典 | 已知词条内部与前缀输入期不插空格（如 `n8n`、`b站`），越词后补插边界空格 |
| 句首大写 | 英文句首字母自动大写（默认关闭） |
| 行内元素间距 | 行内代码 / 行内公式 / 双链与 Markdown 链接同文本的间距策略，各配无 / 软 / 严格三档；链接可整体作词元的智能空格 |
| 自定义正则保护区 | 正则声明的原子区块不做格式化，左右间距独立配置（Templater 表达式、HTML 标签、URL、邮箱、标签等出厂预置） |

细节见 [自动格式化指南](docs/guides/auto-formatting.md)。

### 编辑增强

| 功能 | 说明 |
| --- | --- |
| Tab 跳出配对符 | 配对符号内按 Tab 跳出到闭合符之外，支持 22 对配符（`【】`、`（）`、`$$`、`**`、`[[]]` 等） |
| 智能退格 | 空列表项/空引用行按退格清除标记；有序列表项退格时自动重编号 |
| 渐进选择 | `Ctrl/Cmd+A` 依次选中当前行 → 文本块 → 全文（默认关闭）；另有「选择当前文本块」命令 |
| 智能粘贴 | 列表/引用块中粘贴自动延续前缀与缩进；「纯文本粘贴」命令跳过自动格式化 |
| 下方新建行 | `Ctrl/Cmd+Enter` 在当前行下方新建并延续列表/引用前缀（有序递增、任务重置） |
| 折叠标题回车 | 折叠的标题行按回车不展开，直接在下方添加同级标题 |
| 注释切换 | `Ctrl/Cmd+/` 切换行注释——代码块按语言注释符，Markdown 正文用 `%%` |

细节与平台差异见 [编辑增强指南](docs/guides/edit-enhancements.md)。

### 设置与界面

- 23 项设置经 Vsidian「附加组件」设置页展示与修改，默认值与上游对齐；
- 界面文案中英双语，跟随 VSCode 显示语言（`vscode.env.language`）；
- 内置规则逐条开关与行为链排序经平台「行为冲突管理」统一管理；
- 代码块编辑增强（上游 BetterCodeEdit）暂未实施（[#10](https://github.com/ONEGAYI/vsidian-easy-typing/issues/10)，平台能力依赖）；严格换行回车模式待产品决策（[ADR-0002](docs/adr/0002-strict-line-break-mapping.md)）。

不移植项：MS-IME 修复、macOS 右键菜单修复（Obsidian/Electron 平台特定修补）。

## 安装与依赖

依赖宿主扩展 [Vsidian](https://github.com/ONEGAYI/vsidian)（`onegayi.vsidian`，VSCode 1.82+）：先安装并启用 Vsidian，再启用本扩展。本扩展以 VSIX 分发——CI 每次构建产出 VSIX（GitHub Actions artifact），本地构建见下方开发节。

## 开发

```bash
npm install        # 安装 devDependencies（精确版本，无运行时依赖）
npm run compile    # 三产物构建（宿主 CJS + 编辑器/设置页 chrome114 IIFE）+ tsc 类型检查
npm run test       # vitest 单测（算法矩阵、管线、jsdom 端到端与结构契约）
npm run vendor:check  # 校验 types/vendor SDK 类型快照无漂移
```

工程设施细节（构建桥双防线、vendor 类型快照、清单红线）见 [AGENTS.md](AGENTS.md) 的「工程设施」节与 [ADR-0001](docs/adr/0001-scaffold-build-bridge-and-vendor.md)。

## 致敬与许可

上游 [easy-typing](https://github.com/Yaozhuwa/easy-typing-obsidian)（MIT，作者 Yaozhuwa）五年持续打磨的成果是本项目的起点，功能语义以其文档与源码为事实源。本项目同样采用 MIT 许可并保留上游版权声明。

## 相关

- 宿主扩展：[vsidian](https://github.com/ONEGAYI/vsidian)（类 Obsidian 的 Markdown 双视图编辑器）
- 附加组件开发指南：vsidian 仓库 `docs/addons/developer-guide.md`
