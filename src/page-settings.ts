// 设置页入口（工单 #16 规则管理 UI）：经 SDK 构建桥打成 chrome114 IIFE。
// mountRoot 内自绘规则管理界面（src/rulesUi.ts——列表/编辑表单/导入导出/
// 测试编辑器），读写全经 setup 生命周期注册的 RULES_TOPIC 通道
// （src/rulesHost.ts，与编辑器页同名 topic 各自注册不冲突）。面板 chrome
// 与 dock 样式归平台；内容根内部样式归 src/settings.css（构建拷贝
// dist/settings.css，extension.ts registerPage 登记）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { pickMessages } from './i18n'
import { setDebugEnabled } from './logging'
import { RulesSettingsClient } from './rules/rules-settings-client'
import { mountRulesSettingsView } from './rulesUi'
import { SETTINGS_TOPIC } from './settings/store'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    // 编辑器页形态调用或装载器异常——设置页工厂不应到达此处，防御性早退
    return
  }
  // debug 日志门控接线（审查 C-P2-2 修复）：logging 的 debugEnabled 是
  // bundle 内单例，宿主 extension.ts 的 setDebugEnabled 接线不跨 bundle
  // ——本页装载时经 #3 设置通道拉 effective.debug 接线本份实例。边界：
  // 本页无焦点回归事件面，页面存活期内的开关变更不实时生效（重开设置
  // 页即按新值；debug 是诊断面，当前设置页代码无 debugLog 调用点，接线
  // 为后续调试面预置）；通道失败保持默认关。
  void sdk.channel
    .request(SETTINGS_TOPIC.get, null)
    .then((outcome) => {
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      setDebugEnabled((effective as { debug?: unknown } | null)?.debug === true)
    })
    .catch(() => {
      // 通道异常静默（装载期一次性拉取，无重试面）
    })
  const client = new RulesSettingsClient({ channel: sdk.channel })
  const view = mountRulesSettingsView(root, {
    client,
    messages: pickMessages(navigator.language),
  })
  sdk.onDispose(() => view.dispose())
})
