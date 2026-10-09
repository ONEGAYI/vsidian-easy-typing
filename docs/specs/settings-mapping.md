# 设置字段映射表（工单 #3）

> 上游事实源：`src/settings/settings_types.ts:16-95`（`EasyTypingSettings` 接口 + `DEFAULT_SETTINGS`，easy-typing-obsidian v6.0.9）。
> 平台事实源：`types/vendor/shared/addonSettings.ts`（`AddonSettingDefinition`，一层结构硬边界：标量 / 标量数组 / 字段全为标量的对象，**不支持嵌套**）。
> 本文是字段映射的单一事实源；代码侧默认值单一事实源在 `src/settings/defaults.ts`，两者由 `test/settings-definitions.test.ts` 的全量清单断言钉住一致。

## 一、去向总览

上游 `EasyTypingSettings` 共 **30 个字段**，四个去向：

| 去向 | 数量 | 说明 |
| --- | --- | --- |
| 进平台设置 schema | 23 + 1 | 23 个上游映射键经 `settings.registerDefinitions` 注册，进 Vsidian 设置页「附加组件」分页；另 1 键 `newLineBelow` 为 #13 新增的**本仓门控键**（无上游字段，理由见 §二表末行） |
| 归 #14 storage 持久化 | 3 | 超出设置边界的富结构 / 规则数据族伴随状态 |
| 永不移植 | 3 | AGENTS.md 永不移植清单（MS-IME / macOS 右键 / 上游死设置） |
| 剔除（概念消失） | 1 | 规则存储路径——平台 `ctx.storage` 固定目录，无路径配置概念 |

## 二、进设置 schema 的 24 项（映射总表）

键名为平台侧扁平 camelCase（平台 key 点分层级仅为建议）；`title`/`description` 文案经 `src/i18n/` 双语字典生成，禁止散落字面量。

| 上游字段 | 平台 key | 平台类型 | 默认值 | 变换说明 |
| --- | --- | --- | --- | --- |
| Tabout | `tabout` | boolean | `true` | 直映 |
| SmartPaste | `smartPaste` | boolean | `true` | 直映 |
| BetterCodeEdit | `betterCodeEdit` | boolean | `true` | 直映 |
| BetterBackspace | `betterBackspace` | boolean | `true` | 直映 |
| AutoFormat | `autoFormat` | boolean | `true` | 直映 |
| AutoFormatPaste | `autoFormatPaste` | boolean | `true` | 直映 |
| ExcludeFiles | `excludeFiles` | array\<string\> | `[]` | 上游多行字符串（每行一个路径）**拆平为字符串数组**，每项一个排除路径；生效逻辑归 #28（依赖 vsidian#407 `docUri`） |
| AutoCapital | `autoCapital` | boolean | `false` | 直映 |
| PrefixDictionary | `prefixDictionary` | string | `'n8n, /[1234][dD]/\npython3, Python3'` | 多行字符串原样保留（逗号/空格/换行分隔，含 `/正则/` 形态） |
| SoftSpaceLeftSymbols | `softSpaceLeftSymbols` | string | `'-'` | 直映 |
| SoftSpaceRightSymbols | `softSpaceRightSymbols` | string | `'-'` | 直映 |
| InlineCodeSpaceMode | `inlineCodeSpaceMode` | string enum | `'soft'` | 上游 `SpaceState` 数字枚举（none=0/soft=1/strict=2）→ 字符串枚举 `none`/`soft`/`strict`（见 §四） |
| InlineFormulaSpaceMode | `inlineFormulaSpaceMode` | string enum | `'soft'` | 同上 |
| InlineLinkSpaceMode | `inlineLinkSpaceMode` | string enum | `'soft'` | 同上 |
| InlineLinkSmartSpace | `inlineLinkSmartSpace` | boolean | `true` | 直映 |
| UserDefinedRegSwitch | `userDefinedRegSwitch` | boolean | `true` | 直映（保护区开关） |
| UserDefinedRegExp | `userDefinedRegExp` | string | 上游多行正则串（见 `defaults.ts`） | 多行字符串原样保留（每行一条 + 行尾空格策略符号） |
| UserRulesRespectUserDefinedRegexBlocks | `userRulesRespectUserDefinedRegexBlocks` | boolean | `false` | 直映 |
| debug | `debug` | boolean | `false` | 本票接入日志门控（`src/logging.ts`） |
| StrictModeEnter | `strictModeEnter` | boolean | `false` | 直映 |
| StrictLineMode | `strictLineMode` | string enum | `'enter_twice'` | 上游已是字符串枚举（`enter_twice`/`two_space`/`mix_mode`），原值直映 |
| EnhanceModA | `enhanceModA` | boolean | `false` | 直映 |
| CollapsePersistentEnter | `collapsePersistentEnter` | boolean | `false` | 设置数据链本票交付；生效逻辑已随 #18 落地（消费 `experimental.headingFold.folds()`，见 [fold-enter.md](fold-enter.md)） |
| ——（无上游字段） | `newLineBelow` | boolean | `true` | **#13 本仓新增门控键**：上游 Mod+Enter 命令（`goNewLineAfterCurLine`）恒可用、无设置门，但 Obsidian 侧用户可解绑热键；实验层 keymap 不进平台统一快捷键管理（#402 契约，用户无法解绑），按「组件内功能粒度开关由插件设置承担」补此键。默认 `true` = 上游「命令恒可用」的等价默认；关闭时透传回平台内建 Mod+Enter（defaultKeymap `insertBlankLine`，仅插入空行不带前缀延续）。生效逻辑见 [new-line-below.md](new-line-below.md) |

不设 `maxLength`/`minItems`/`maxItems`：上游多行文本（正则、词典）表达力不受限，无依据不引入上限。

## 三、不可映射 / 不迁移决策（逐条）

### 归 #14 storage（3 项）

| 上游字段 | 原因 | #14 接口 |
| --- | --- | --- |
| `languagePairs` | `LanguagePair[]` 是对象数组（`{a, b}`），a/b 可为 `ScriptCategory` 或自定义类名——嵌套结构超出一层边界，拆平为布尔键会丢失自定义对表达力 | 出厂默认 3 对（中英/中数/数英）在 `src/settings/defaults.ts` 的 `RICH_STRUCTURE_DEFAULTS.languagePairs` 导出，后续间距功能票以此为缺省种子持久化用户编辑（#14 落档：该数据链尚无消费方，未建文件，见 [rules-storage.md](rules-storage.md) 已知边界） |
| `customScriptCategories` | `CustomScriptDef[]`（`{name, pattern}` 对象数组），同上 | 同上——`RICH_STRUCTURE_DEFAULTS.customScriptCategories`（出厂空数组），同样待间距功能票 |
| `deletedBuiltinRuleIds` | `string[]` 本身可映射，但它是**规则管理状态的伴随数据**（标记哪些内置规则被用户删除），与 `builtin-rules.json`/`user-rules.json` 同生命周期，归规则数据族持久化一致性更好 | **#14 已落档**：`rule-state.json`（`{ deletedBuiltinRuleIds }`），出厂种子 `RICH_STRUCTURE_DEFAULTS.deletedBuiltinRuleIds`；不另设设置键 |

### 永不移植（3 项，AGENTS.md 清单）

- `TryFixChineseIM`：上游死设置（除设置 UI 外无消费点）；
- `FixMacOSContextMenu`：macOS 专属 Obsidian 缺陷修复，平台无关；
- `TryFixMSIME`：微软输入法旧版适配，平台 IME 定稿驱动（`input.type.compose`）已覆盖。

### 剔除（1 项）

- `rulesStoragePath`：上游是 vault 内相对路径概念；移植后规则文件固定存放于平台 `ctx.storage` 目录（`<vsidian globalStorage>/addons/<addonId>/`），路径由平台管理，用户无需也不可配置。

## 四、形态变换口径

- **SpaceState（数字 → 字符串）**：上游 `SpaceState { none=0, soft=1, strict=2 }`；设置值用字符串 `'none' | 'soft' | 'strict'`（可读、平台 enum 直渲染）。功能票消费时如需上游数字语义，经 `src/settings/defaults.ts` 的 `SPACE_MODE_VALUES` 顺序（即数字值）换算。
- **ExcludeFiles（多行字符串 → 数组）**：上游「每行一个排除路径」的约定改为数组项；无存量数据迁移负担（新生态首版）。
- **StrictLineMode**：上游本就是字符串枚举，键值原样。

## 五、实施落档约定（本票钉住，后续票不得顺手改）

1. **默认值单一事实源**：`src/settings/defaults.ts` 的 `DEFAULT_EFFECTIVE_SETTINGS`；`buildSettingDefinitions` 生成定义时逐项引用，二者一致性由测试钉住（新增字段两处同改 + 测试全量清单同步）。
2. **fail-safe 读取**：合成生效设置时（`src/settings/store.ts`），快照值类型不符 / 枚举越界 / 数组项非字符串 → 该键回默认值。平台本身已按定义校验，此为防御深度，不向用户报错。
3. **作用范围**：沿用平台分层——工作区显式 > 用户默认 > 出厂默认；本组件不自建覆盖逻辑。
4. **读写链路**：宿主 `setup` 中注册定义并挂 channel topic `easyTyping.settings.get` / `easyTyping.settings.update` / `easyTyping.settings.clearOverride`（setup scope——普通停用后仍可配置，供 #16 自绘设置页与诊断消费）；`onChanged` 实时刷新宿主内生效设置缓存，功能票经 `EasyTypingSettingsFacade` 读取，不直接触碰平台 API。
5. **debug 门控**：`facade.onEffectiveChange` → `setDebugEnabled(effective.debug)`；日志输出统一经 `src/logging.ts` 的 `debugLog`（前缀 `[vsidian-easy-typing]`），宿主侧落扩展宿主控制台。
6. **i18n**：设置 title/description 全部经 `src/i18n/`（zh 类型源 + en 同键集 + parity 测试）；语言检测宿主侧 `vscode.env.language`、页面侧 `navigator.language`，`pickMessages(languageTag)` 统一入口（`zh*` → 中，其余 → 英）。#19 在此结构上扩展，不另起炉灶。

## 六、已知边界

- 平台 string enum 的设置页渲染展示**值本身**（`'soft'`、`'enter_twice'`），无 per-值文案映射入口——三档语义在 description 中说明；若平台后续提供枚举 label 映射再跟进。
- 跨窗口设置变更不实时推送（平台 Memento 无变更事件，vsidian addonSettings.ts 头注）：同窗口 onChanged 即时；跨窗口以重开对账。
- `collapsePersistentEnter` 的生效曾受平台 headingFold 未进 main 阻塞（本票 #3 交付时的边界）：平台 PR #416 已合入（2026-10-09），#18 已消费 `experimental.headingFold` 落地生效逻辑，该边界解除。

## 七、验收口径（票面映射）

- 设置矩阵「改值→生效→重开回显」端到端：本票以**契约测试承载**——定义形状全量断言（防漏项）、默认值矩阵、fail-safe 回退、onChanged 刷新（`test/settings-definitions.test.ts` + `test/settings-store.test.ts`）；真实设置页观感与人工回显归 #21 人工验证清单。
- `npm run compile` 通过；全部测试绿。

## 八、给后续票的接口提示

- **#14（规则持久化，已落地）**：规则文件落 `ctx.storage`（`builtin-rules.json` / `user-rules.json` / `rule-state.json`，路径设置不存在见 §三）；通道与自动重载见 [rules-storage.md](rules-storage.md)。语言对与自定义类别的持久化待间距功能票（§三）。
- **#16（自绘设置页）**：读写经本文 §五.4 的三个 channel topic；枚举值与默认值从 `src/settings/defaults.ts` 导入，不复制第二份。
- **#25（M1 输入规则族）及各功能票**：消费统一入口 `EasyTypingSettingsFacade.effective`（类型 `EffectiveEasyTypingSettings`，`src/settings/store.ts` 导出）；订阅变化用 `onEffectiveChange`，禁止直接调用平台 `settings.get()`。
