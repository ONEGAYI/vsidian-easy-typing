# 领域词汇（CONTEXT）

本文件是本项目领域语言的单一事实源。移植语义以上游 [easy-typing-obsidian](https://github.com/Yaozhuwa/easy-typing-obsidian)（v6.0.9）文档与源码为准；平台侧概念以 vsidian 仓 `docs/addons/` 与 `types/vendor/` 快照为准。新术语首次进入工单或规格时，先在此登记再使用。

## 移植域（上游语义）

### 规则三触发类（RuleType）

上游规则引擎对变换规则的触发分类（`src/rule_engine.ts`）：

- **Input**：输入字符触发——刚键入的文本匹配规则左侧时施加变换（配对补全、全角转换等）；
- **Delete**：删除触发——删除动作发生后按剩余上下文判定（联动删除配对端等）；
- **SelectKey**：选区按键触发——存在选区时按键发生包裹类变换（选中后按 `*` 包成斜体等；触发键序列由规则声明）。

映射到平台侧：Input ≈ `userEvent: 'input.type'`，Delete ≈ `delete.*` 白名单事务，SelectKey 的包裹判定依据 `AddonInputContext.replaced`（被替换的选区内容）。

### 插入后变换

输入事件发生后，对刚插入的文本及其左右上下文施加的**即时**文本变换——上游规则引擎的执行结果（`TxContext` / `ApplyResult`）。区别于全量格式化（命令族触发的批量重排）。

### 触发模式与作用域（规则属性）

- **触发模式**（RuleTriggerMode）：`Auto`（键入即生效）/ `Tab`（键入后按 Tab 确认，用于占位符类规则）；
- **作用域**（RuleScope）：规则生效的正文区域——`Text`（普通文本）/ `Formula`（公式内）/ `Code`（行内代码内，可指定语言）/ `All`。

### 保护区

自动格式化不得触碰的正文区域，由**自定义正则区块**（上游 README「用正则表达式保护特定文本不被格式化」）圈定；行内代码与公式天然是保护区。本项目语境统一称「保护区」，落档上游措辞为「自定义正则区块」。

### 前缀词典（PrefixDictionary）

输入过程中**抑制过早空格插入**的词典（上游 `src/formatting/prefix_dictionary.ts`）：词典中的前缀（如 `Fig.`、`e.g.`）后跟输入时不立即补空格，避免半角句点后误判句末。用于自动格式化的空格决策。

### 行为链（平台侧，消费面）

vsidian behaviors 模型：同一次输入事务按**有效序**被多个已注册行为依次修饰，后续行为的快照读到前序修饰结果；默认序按完整键（`<addonId>#<行为局部ID>`）字典序，用户可在 Vsidian 设置页逐项关闭或调序。每段修饰按自己的 `history` 声明（`atomic` / `joinPrevious`）提交撤销项。上游多条规则在移植时可能合并为少量行为链节点。

## 移植口径备忘

- 永不移植清单与三标签口径见 [AGENTS.md](AGENTS.md)，不在此重复。
- 上游行号锚点以上游克隆 `D:\CODE\Project\_ForExplore\easy-typing-obsidian`（v6.0.9）为准；按内容锚点（函数名 / 规则 id）优先对照。
- 平台 API 消费面速查见 vsidian 仓 `docs/addons/api-reference.md`（生成物）与 `docs/addons/developer-guide.md`。
