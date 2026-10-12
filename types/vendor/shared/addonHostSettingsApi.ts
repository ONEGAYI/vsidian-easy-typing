// vendored from ONEGAYI/vsidian@9f2d292753291db5fa5c45cc3f6dcbbd71c2e37c — src/shared/addonHostSettingsApi.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

import { READING_BREAKS_KEY } from './settings'

/** 读取面（experimental.hostSettings 的内容；仅编辑器页提供）。get 同步
 *  返回——keymap/输入行为等热路径可直接消费 */
export interface AddonHostSettingsFacet {
  /** 读白名单宿主设置的当前生效值（类型收窄为白名单键；JS 组件传入
   *  任意值时运行时校验拒绝 invalid-key） */
  get(key: AddonHostSettingKey): AddonHostSettingGetResult
}

/** 白名单键类型（新增白名单项时经 as const 数组自动扩展） */
export type AddonHostSettingKey = (typeof ADDON_HOST_SETTING_KEYS)[number]

/** 读取结果（可辨认拒绝，不抛出） */
export type AddonHostSettingGetResult =
  | { ok: true; value: AddonHostSettingValue }
  | { ok: false; reason: AddonHostSettingsRejection }

/** 白名单（票面「读取范围收敛」的落地）：显式清单枚举宿主设置键，键名
 *  引用宿主侧成对导出的常量（不复制字面量）。首版仅 #423 的
 *  editor.readingBreaks（easy-typing #30 门控消费方）。 */
export const ADDON_HOST_SETTING_KEYS = [READING_BREAKS_KEY] as const

/** 白名单值类型：首版全部白名单键均为 boolean；将来纳入非布尔项时按
 *  键扩展联合类型（minor 演进） */
export type AddonHostSettingValue = boolean

/** 拒绝类型：invalid-key = 白名单外键（读取范围收敛）；view-disposed =
 *  组件代次已终结（迟到的僵尸调用，装载器守卫给出） */
export type AddonHostSettingsRejection = 'invalid-key' | 'view-disposed'
