# 语法树行类型与作用域映射（工单 #5）

> 上游 easy-typing-obsidian 的树版判定（行类型 / 作用域 / 行内分区 / 代码块信息）到平台 `experimental.syntax` 位置查询的**映射表规格**——票面 checkbox 1「HyperMD 节点名 → VSCode Lezer 节点名映射表」的落地形态。四处正则降级判定（#11 块扫描、#25 作用域、#26 行内分区、#28 行分类）已随本票原位替换为树版查询，本文档是映射语义的单一事实源。

## 一、背景与依赖

- **解锁依赖**：vsidian#408（live 行类型查询）已随平台 PR #434 合并（2026-10-10，merge commit `d26f1e86`）。落地形态为 **B+**——位置驱动单点查询，不暴露树/节点句柄。
- **映射左端是「上游判定语义」而非节点名**：#434 不向组件暴露节点名——`nodeNames` 是非稳定**诊断载荷**，逻辑分支不得依赖。因此映射表左端是上游 easy-typing 的判定行为（`getPosLineType`/`getPosLineType2`/`detectRuleScope` 等的语义形态），HyperMD 节点名仅作**语义来源列**说明出处，不进入运行时判定。
- **实施切片**：切片 A（映射常量与查询 API，`src/syntaxTreeQuery.ts`）、切片 B（六处消费方接线与懒查询改造）、切片 C（本规格与验收测试）。

## 二、平台查询面（experimental.syntax）

类型事实源：vsidian `src/shared/addonSyntaxApi.ts`（本仓经 `types/vendor/` 快照消费）；语义对照文档 vsidian `docs/addons/developer-guide.md` §4.8。

```ts
interface AddonSyntaxFacet {
  lineTypeAt(instanceId: string, pos: number): AddonSyntaxLineTypeResult
  inlineAt(instanceId: string, pos: number): AddonSyntaxInlineResult
}
// 结果：{ ok: true; kind: ...; nodeNames } | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }
```

- **lineTypeAt**（块级维度）kind 八种：`frontmatter | code | formula | table | heading | quote | list | text`。判定链：fm 区间（行级）→（块级代码守卫下的）跨行 `$$` 块表 → 树链枚举（**code > table > heading > list > quote**）→ 单行闭合 `$$x$$` → text。
- **inlineAt**（位置级行内维度）kind 三种：`code | formula | none`。判定链：fm → `none` → InlineCode → `code` → 其余代码上下文 → `none` → 数学块表/当前行扫描 → `formula` → `none`。
- **Live-only**（reading/hover 拒 `read-only`）；pos 全文 LF UTF-16，越界钳制文末；查询 µs 级。
- **清单声明**：`package.json` 的 `vsidianAddon.experimental` 含 `"syntax": "^1.0.0"`（必须 `^` 范围——精确版本在宿主升级即判不兼容）；instanceId 经 `sdk.experimental.viewIdentity.instanceIdOf(view)` 反查。
- **查询拒绝的处理**（设计约束，探索笔记 §5.4；评审 P3 收紧落档）：拒绝只发生在非 live 视图（本就不该接管）或实例已死（判定无意义）——消费面一律按「不接管」处理（返回 null/false 透传平台原生行为），**不 fallback 正则**（不并存两套判定、防复活已拆除的降级路径）。`detectScopeViaQuery` 查询拒绝返回 `null`（不静默归 `{scope: Text}`）；三个消费方各按不接管值处理：`autoFormatPipeline`（不格式化）、`ruleBehaviorPipeline`（不施加规则修饰——与查询缺席同一 null 通道）、`commentToggle`（无动作）。

## 三、映射对照表（核心）

运行时常量在 `src/syntaxTreeQuery.ts`（`LINE_KIND_BY_PLATFORM` / `FORMAT_SKIP_BY_PLATFORM`）；HyperMD 节点名列仅为语义来源（vsidian 平台树是标准 @lezer/markdown + GFM，无 HyperMD 节点）。

| 上游语义形态（来源锚点） | HyperMD 节点/行为（来源列） | 平台 kind | v2/ModA 投影（LineKind） | v1 跳过投影 |
| --- | --- | --- | --- | --- |
| frontmatter（core.ts:748 首查） | `hmd-frontmatter` | `frontmatter` | frontmatter | 跳过 |
| codeblock 全行（围栏与内容） | `codeblock-begin/end` + 全行 codeblock | `code` | code | 跳过 |
| 引用内 callout 代码块（v1 `/^>+ ```/`） | quote 内 codeblock | `code`（树链 code 优先） | code | 跳过 |
| formula 全行（跨行块） | math 全行（v1/v2 全行校验） | `formula` | formula | 跳过 |
| formula 单行闭合（升级收益，降级版不识别） | math 全行 | `formula`（单行闭合块补判） | formula | 跳过 |
| table（v1 特判） | `hmd-table` | `table` | **text**（上游 v2 不特判） | 跳过（#28 不翻案） |
| heading | ATX 标题（v1/v2 均不特判） | `heading` | **text** | 不跳过 |
| quote（v2 行首 quote） | `hmd-quote`（`>` 前缀） | `quote` | quote（行首无 `>` 前缀的惰性延续行门控回 text，见 §四） | 不跳过 |
| **callout_title**（v2 行内任一） | `hmd-callout` | **平台无枚举，统一 quote** | quote | 不跳过 |
| list 标记/续行（v2 行内任一 list 先于行首 quote） | `hmd-list` | `list` | list（松散列表项间空行门控回 empty，见 §四） | 不跳过 |
| text 兜底 | — | `text` | text（空行本地补判 `empty`） | 不跳过 |
| wikilink/mdlink 内 code span（`!contains('link')` 排除） | link 节点内非 code | **平台缺口，插件自判**（见下） | 链接内判 text | — |

**empty** 为行文本全空白的本地补判（`lineKindOf`）：上游 v2 归 text，本仓 LineKind 既有独立 kind 供段块邻行排除消费——不经过映射常量。

### 两处「组件自判」缺口（平台树无对应节点的补齐）

平台树（标准 @lezer/markdown + GFM）**无 wikilink/mdlink 节点、无 callout 节点、无 frontmatter 树节点**（fm 走平台独立区间缓存）。两处缺口由插件以纯正则补齐，正则与上游逐字同源：

1. **callout 细分**：平台对 callout 标题行统一判 `quote`；`isCallout`/内容起点细分走 `blockScan.quoteInfoAt` 的 `CALLOUT_PREFIX_RE`（上游 `getQuoteInfoInPos` 本就是纯正则，syntax.ts:155-201——无需树版升级，语义一致）。
2. **链接区段排除**：上游树判定「节点名含 `code` **且不含 `link`**」的链接排除，在平台树上反引号是真 InlineCode——由 `syntaxTreeQuery.linkSpansOfLine` 用 `REG_WIKILINK`/`REG_MDLINK`（上游逐字正则，`inlineParts.ts` 单一事实源）圈链接区段，区段内判 text。消费面两处：`detectScopeViaQuery`（作用域）与 `splitLineIntoParts`（行内分区），统一走 `linkSpansOfLine`，不各写一份。

## 四、已知口径差异

以下差异**按平台语义消费**（vsidian developer-guide §4.8 与本仓实施记录；钉住测试 `test/syntaxMappingMatrix.test.ts` 第三组）：

- **fm 是源码态**：`inlineAt` 在 fm 内恒 `none`。
- **嵌套优先级 code > table > heading > list > quote**：引用内表格/标题行的内容位置判 `table`/`heading`（上游 v2 归 quote）；`> - item` 前缀处 quote、内容处 list，**两位置各判各的**（消费取代表位置——内容区，对齐上游 v2「行内任一 list 先于行首 quote」）。
- **段内 `text $$x$$ tail` 是 text**（平台块表只收独占行；上游 v1/v2 全行校验同判）。
- **单行闭合 `$$x$$` 独占行是 formula**（升级收益：#11 降级版不识别）。
- **未闭合 `$$` 块与未闭合 frontmatter 按普通文本处理**（平台稳定降级）。
- **跨行公式块与围栏交叉的畸形形态**按位置局部语义。
- **`` `[[a]]` `` 链接区段优先剪除**（切片 B 实施新增）：`linkSpansOfLine` 纯正则不感知 code span——反引号内的 `[[..]]` 被圈进链接区段，其内判链接（Text）而非 code；**上游树版判 Code**（code span 内的 `[[..]]` 不构成链接节点）。作用域与行内分区两消费面同此差异（行内分区表现为 code span 被剪除碎化）。
- **commentToggle 开栏围栏行随上游收敛**（切片 B 实施记录，原降级差异消除）：树版 `lineTypeAt` 对围栏行判 `code` → 注释切换在开栏行走代码块语言分支，对齐上游树版把围栏行划入代码块区间的行为；#25 降级版「围栏行按 Text 走 `%%` 分支」的「更稳」口径随之删除（行为翻转，`test/commentToggle.test.ts` 钉住）。
- **语言整串随上游收敛**（原降级差异消除）：语言提取为信息串整串 trim 后小写（上游 `getCodeBlocksInfos` 同款，`js copy` 查表不中 → 无操作）；#25 降级版「取首 token」口径删除。
- **相邻代码块零分隔行 run 合并**（查询版形态学边界）：块信息按「连续 code 行 run」分组——两个代码块之间无任何非 code 行时合并为一块（开栏取首行）。上游 iterate `codeblock-begin/end` 节点为两块。消费面影响：相邻异语言块的后者经 `codeBlockAtViaQuery` 取到首块语言。罕见形态（两块间通常有空行），如需拆分另开票。`codeBlockAtViaQuery` 已改为从 pos 行向上下局部扩展（评审 S6 前半：autoformat 每键入触达，原经 `codeBlocksViaQuery` 全文档逐行查询在 10 万行文档达百毫秒级，与 ModA 懒查询红线同性质）——run 边界与全量分组一致，合并语义不变（矩阵钉住）。
- **引用块惰性延续行门控回 text**（评审 P4 落档）：平台树按 GFM 把引用块的惰性延续行（`> a` 下一行顶格 `b`，无 `>` 前缀）判 `quote`；上游 v2 是行首 quote 语义（`getQuoteInfoInPos` 的 quote_regex `^(\s*)(>+) ?` 不匹配 → 判 text）。LINE_KIND 消费维度（`lineKindOf`）对 quote kind 且行首 `QUOTE_PREFIX_RE` 不匹配的行门控回 text，对齐上游（消费面影响闭合：不门控时 ModA 的 anchorKind=quote 会跳过文本分支而 `quoteInfoAt`（行首纯正则）返回 null 落穿到不接管）。v1/跳过维度保持平台 kind 原判——上游 v1 的 quote 分支兜底本就是 text（core.ts:698-742，仅 callout 内代码块升 codeblock，普通引用行一律 text 不跳过），平台 quote 不跳过，两侧行为等价，无需门控。fake 判定链按行首形态学天然不产该形态（近似边界，见 `test/syntaxFake.ts` 头注释），门控行为由矩阵测试直接构造 quote kind 钉住。
- **松散列表项间空行门控回 empty**（评审 R2-B3 落档，与 P4 惰性延续行门控同款形态）：平台树对松散列表（loose list）的项间空行判 `list`（BulletList 父节点区间覆盖空行）；上游 v2 无父节点语义，空行按行文本判 text。LINE_KIND 消费维度（`lineKindOf`）对 list kind 且行文本全空白的行门控回 empty，对齐上游。FORMAT_SKIP（v1/跳过）维度不动——list 与 text 均不跳过，无行为差。fake 判定链按行首形态学对空行判 text，天然不产该形态（近似边界，`test/syntaxFake.ts` 头注释），门控行为由矩阵测试直接构造恒 list 查询钉住。
- **开栏围栏缩进上限 0-3 空格**（评审 R2-B5 落档）：`fenceOpenIndentOf` 的开栏检测限缩进 0-3 空格——对齐 CommonMark 围栏缩进上限与仓内 ruleScopeFallback 时代 `FENCE_LINE /^ {0,3}/` 先例（原 `/^(\s*)/` 无上限，4 空格缩进的 ``` 是缩进代码的字面内容，会被误产 CodeBlockInfo，而上游对缩进代码无 codeblock-begin 不产出）。行级 kind 仍按平台判 code（缩进代码），只是 `codeBlocksViaQuery` / `codeBlockAtViaQuery` 不产出块信息；引用前缀剥后（引用内围栏）同受上限约束。
- **消费面选型差异（管线级，非平台差异）**：上游自动格式化的行级门控用 v1 全行校验（行内 code/公式行是 text → 格式化该行）；本移植管线门控用位置级 `detectScopeViaQuery`——**光标在行内 code/formula 内时跳过整行**。行为差异如实保留（管线测试钉住），口径见 [auto-format.md](auto-format.md)「作用域跳过」节。

### 已知边界与后续收口（评审不修项落档）

以下为双轴评审（PR #35）识别但**不在本 PR 修复**的问题（形式问题与近似口径），记录于此供后续票决策：

- **R2-A1（已修复，#37 快照坐标换算）**：Delete/SelectKey 管线的作用域判定原以事务前坐标打在平台实时文档的查询上（删除大段时可越实时文档长度）——现统一传快照文本与换算坐标，三输入同坐标系、越界 pos 不再发出；与事务前实况仍可能分叉为既定口径，修复口径与方向选择依据见 [rule-engine.md](rule-engine.md)「事务前重建与坐标换算」节；#21 真实宿主联调核对项已增（A72）。
- **S3**：`(doc, query, lineNumber)` 三元组在多个签名间重复传递（Data Clumps），可上提 `LineSyntaxContext` 统一——接口面刚随切片 B 稳定，形式统一属后续票。
- **S4**：planner 统一签名的不消费参数（个别 plan 函数不用全部入参）——换取 `runViewCommand` 单态分发的可辩护权衡。
- **S5**：`syntaxTreeQuery` ↔ `inlineParts` 循环 import——运行时安全（函数内引用无 TDZ 风险），解环收益不抵结构翻动。

## 五、消费方索引与测试索引

### 消费方（切片 B 接线后的对应关系）

| syntaxTreeQuery API | 消费模块 | 用途 |
| --- | --- | --- |
| `lineInfoAt` / `scanLinesViaQuery` | `blockScan.ts`（scanLines）、`modaSelection.ts`（懒查询） | ModA 行类型与段块邻行判定 |
| `platformLineKindAt` + `FORMAT_SKIP_BY_PLATFORM` | `formattingCommands.ts`（classifyFormatSkipLines） | 格式化命令族行分类跳过 |
| `detectScopeViaQuery` | `ruleBehaviorPipeline.ts`（scopeQuery 注入，All 短路）、`autoFormatPipeline.ts`、`commentToggle.ts` | 规则作用域 / 格式化门控 / 注释切换语言分支 |
| `codeBlocksViaQuery` / `codeBlockAtViaQuery` | （经 detectScopeViaQuery 语言提取消费） | Code 作用域语言提取 |
| `splitLineIntoParts`（inlineParts 树版，内部消费 `inlineAt` + `linkSpansOfLine`） | `lineFormatter.ts`（formatLine 的 syntax 参数） | 行内分区（code/formula/链接/user） |
| `quoteInfoAt`（纯正则，上游同款） | `modaSelection.ts` | 引用块档位（不消耗查询） |

装配：`page-editor.ts` 统一构造查询（instanceId 闭包绑定）注入各消费面；查询缺席（instanceId 反查失败/语法面缺席）= 不接管。行为链三注册（#25 五族、#9 两族、autoformat）另注入**实例一致性守卫**（评审 R2-B1）：平台行为链同样驱动嵌入（embed）Live 实例，而查询恒为主实例——onInput 入口比对 `ctx.docUri`（与主实例 views 句柄 `targetDocUri` 同源，反查面缺席回退快照全文比对），不一致（嵌入驱动）即放弃该次行为修饰（返回 null，与查询拒绝同一「不接管」语义）。

### 测试

- **映射矩阵**（`test/syntaxMappingMatrix.test.ts`）：上游行类型 × 平台 kind × 消费维度全枚举、作用域三值与链接排除逐形态、口径差异逐条钉住、块信息矩阵——本文档第三节对照表的机器可验副本（改映射表须同步改期望）。
- **端到端抽查**（`test/syntaxEndToEnd.test.ts`）：两份真实感文档跑全消费链（行类型序列/作用域采样/行内分区/跳过序列/ModA 三档/注释切换——评审 P1 补链：代码块内语言注释分支、普通文本 `%%` 分支、查询拒绝无动作）。
- **fake 近似边界声明**（`test/syntaxFake.ts` 头注释）：本仓 node_modules 无 @lezer/markdown，判定链 fake 以形态学近似（围栏状态机、缩进代码 ≥4、表格须首管道、列表续行缩进 ≥2、行内 $ 无贴字规则、位置粒度只区分引用前缀区/内容区）。**无法与真实平台一致的期望**在测试处显式标注「近似口径，真实宿主联调归 #21」——已声明的三处：无首管道 GFM 表格行、货币 `$100 … $200` 行内配对、列表续行归属。

## 六、升级路径

- **平台 syntax 稳定化**（experimental → 稳定 API）时：回收清单声明与 vendor 快照（`scripts/vendorSdkTypes.mjs` 的 `DEFAULT_COMMIT` 升级重跑），`SyntaxQuery` 适配器接口不变——消费方零改动；本文档「平台查询面」节的枚举与判定链描述随平台文档同步。
- **fake 与平台判定链的同步责任**：fake 照 vsidian `src/shared/addonSyntaxApi.ts` 判定链骨架实现；平台判定链变更（新增 kind、调整优先级）时须同步 fake 与矩阵期望，并在 fake 头注释更新近似口径清单——矩阵测试是同步的验收面。
- **块信息 run 分组如需拆分**（相邻代码块零分隔行）：`codeBlocksViaQuery` 的分组策略改造 + 矩阵第四组「已知形态学边界钉住」用例同步翻转，另开票记录。
