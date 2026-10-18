// vendored from ONEGAYI/vsidian@5e388ad44292794870aae88cd4286142faa3f484 — src/shared/localizedText.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

// #473 枚举档位本地化标签——组件侧多语言文本的选值纯函数单一事实源。
// 语义与 #464 行为名多语言（resolveAddonBehaviorName）对齐：键规整
// trim+小写、zh 系页面语言候选链 'zh-cn'→'zh'→'en'、非 zh 只试 'en'、
// 全缺取规整后字典序最小的键（兜底非空、确定性）。
//
// addonBehaviors.ts 本批不迁移到本模块（其实现随 #464 落地，限制常量
// 与注册语义独立演进）；第三处消费方出现时再统一收口。

/** 多语言文本形态：直值（不随语言切换）或「语言代码 → 文本」映射 */
export type LocalizedText = string | Readonly<Record<string, string>>
