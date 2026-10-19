// vendored from ONEGAYI/vsidian@29880ba926a2f3b3e65319f67bd8ff5c16434630 — src/shared/addonPasteRules.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 注册结果（普通 API 拒绝不算组件故障；dispose 重复调用无害） */
export type AddonPasteRulesRegisterResult =
  | { ok: true; dispose(): void }
  | { ok: false; reason: 'invalid-declaration' | 'duplicate-id' | 'too-many' | 'released'; detail?: string }
