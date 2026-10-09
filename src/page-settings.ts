// 设置页入口（工单 #16 规则管理 UI）：经 SDK 构建桥打成 chrome114 IIFE。
// mountRoot 内自绘规则管理界面（src/rulesUi.ts——列表/编辑表单/导入导出/
// 测试编辑器），读写全经 setup 生命周期注册的 RULES_TOPIC 通道
// （src/rulesHost.ts，与编辑器页同名 topic 各自注册不冲突）。面板 chrome
// 与 dock 样式归平台；内容根内部样式归 src/settings.css（构建拷贝
// dist/settings.css，extension.ts registerPage 登记）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { pickMessages } from './i18n'
import { RulesSettingsClient } from './rules/rules-settings-client'
import { mountRulesSettingsView } from './rulesUi'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    // 编辑器页形态调用或装载器异常——设置页工厂不应到达此处，防御性早退
    return
  }
  const client = new RulesSettingsClient({ channel: sdk.channel })
  const view = mountRulesSettingsView(root, {
    client,
    messages: pickMessages(navigator.language),
  })
  sdk.onDispose(() => view.dispose())
})
