// 编辑器页入口（工单 #22 脚手架形态）：经 SDK 构建桥打成 chrome114 IIFE。
// 功能票（M1 输入规则起）在此页经 sdk.behaviors 注册可组合输入行为、经
// sdk.experimental.cm6 取共享 CM6 运行时、经 sdk.views 读写编辑面——
// 消费形态参照 vsidian test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

defineAddonPage(ADDON_ID, (_sdk: VsidianAddonPageSdk) => {
  // 脚手架占位：页面装配链路打通即止；行为注册随首个功能票落地
})
