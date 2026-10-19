// vendored from ONEGAYI/vsidian@29880ba926a2f3b3e65319f67bd8ff5c16434630 — src/shared/addonThemes.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** SDK 只读面（仅编辑器页提供）：同步快照 + 变化订阅（重复值不通知；
 *  代次释放自动退订；通知在页面缓存更新后送达——回调中 get 拿新值） */
export interface AddonThemeEnvironmentFacet {
  get(): AddonThemeEnvironment
  onChange(listener: (env: AddonThemeEnvironment) => void): () => void
}

/** enable 上下文的主题注册面（组件宿主代码声明主题元数据——目录与
 *  选择归平台，实际渲染执行仍归页面 renderers 注册） */
export interface AddonThemesRegistrationFacet {
  register(declarations: readonly unknown[]): AddonThemeRegisterOutcome
}

/** 明暗快照（四态两轴投影；亮色高对比 ≠ 暗） */
export interface AddonThemeEnvironment {
  /** 暗色：dark 与暗色高对比为 true；亮色与亮色高对比为 false */
  readonly dark: boolean
  /** 高对比：两种高对比形态为 true */
  readonly highContrast: boolean
}

// ---- enable 生命周期注册面 ----

/** 主题注册结果：ok=false 时 dispose 为 no-op（登记校验与批内重复拒绝属普通 API 结果，不算组件故障） */
export type AddonThemeRegisterOutcome =
  | { ok: true; dispose(): void }
  | { ok: false; reason: 'invalid-theme' | 'duplicate-theme'; dispose(): void }
