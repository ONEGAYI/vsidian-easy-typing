# 规格索引（docs/specs/）

本目录承载各功能域的**移植规格**：每张实施票落地前把验收口径、上游对照与平台映射写成本目录下的规格文档，票面只留范围与链接。

## 约定

- 命名：`<主题>.md`（kebab-case，与 vsidian 主仓规格目录同风格）。
- 规格文档三要素：**验收口径**（可判定）、**上游对照**（文件/函数/规则 id 锚点）、**平台映射**（消费的 SDK 面与已知边界）。
- 实施中发现的边界决策（做/不做/顺延）回写规格的「已知边界」节，不留在工单评论区。
- 跨规格的领域词汇先登记 [CONTEXT.md](../../CONTEXT.md) 再使用。

## 索引

- [tabout.md](tabout.md)——Tab 跳出配对符（工单 #7）：22 对配符栈匹配算法、Tab 按键拦截（实验 cm6 keymap 落穿层）与平台 Tab 冲突核对。

里程碑与工单总览见 [README](../../README.md) 与 [Issues](https://github.com/ONEGAYI/vsidian-easy-typing/issues)。
