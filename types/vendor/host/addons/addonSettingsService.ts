// vendored from ONEGAYI/vsidian@1c7c5283665f5a0b5934478d8d7e3638afab9753 — src/host/addons/addonSettingsService.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** update / clearWorkspaceOverride 的结果（失败不虚报） */
export type AddonSettingsUpdateResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-key' | 'invalid-value' | 'no-workspace' | 'store-write-failed' | 'rejected'; invalidKeys?: readonly string[] }
