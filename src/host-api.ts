// 宿主导出 API 的最小声明（形态对齐 vsidian test/examples 独立样例的
// host-api.ts）：Vsidian（onegayi.vsidian）经 activate() 返回值公布的
// registerAddon 面。完整契约以 vendor 快照为准（types/vendor/）。
import type { AddonRegistrationResult } from '../types/vendor/shared/addonIdentity'
import type { AddonDefinition } from '../types/vendor/host/addons/addonRegistry'

/** Vsidian（onegayi.vsidian）的公开导出 API 形状 */
export interface VsidianHostExports {
  /** 宿主当前提供的稳定 API 版本 */
  readonly apiVersion: string
  registerAddon(
    owner: { id: string },
    definition?: AddonDefinition,
  ): AddonRegistrationResult & { dispose?(): void }
}
