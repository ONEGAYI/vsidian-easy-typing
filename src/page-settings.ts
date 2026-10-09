// 设置页入口（工单 #22 脚手架形态）：经 SDK 构建桥打成 chrome114 IIFE。
// 设置功能票（M3）在此经 sdk.mountRoot() 自绘设置界面，读写全经 setup
// 生命周期注册的 channel topic 与宿主通信（消费形态参照 vsidian
// test/examples/ui-command/src/page-settings.ts）。当前为占位空页。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

defineAddonPage(ADDON_ID, (_sdk: VsidianAddonPageSdk) => {
  // 脚手架占位：sdk.mountRoot() 的自绘界面随设置功能票落地
})
