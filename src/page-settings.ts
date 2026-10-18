// 设置页入口（工单 #16 起建；#55 切片 1 改为五 Tab 自绘设置页装配）：
// 经 SDK 构建桥打成 chrome114 IIFE。mountRoot 内挂自绘设置页
// （src/settingsTabsUi.ts——hero + 五页内 Tab + 24 项设置行 + 规则四分区
// 挂入；Tab 归属映射见 src/settings/tabs-model.ts）。设置读写经 setup
// 生命周期注册的 SETTINGS_TOPIC 通道，规则数据经 RULES_TOPIC 通道
// （src/rulesHost.ts，与编辑器页同名 topic 各自注册不冲突）。面板 chrome
// 与 dock 样式归平台；内容根内部样式归 src/settings.css（构建拷贝
// dist/settings.css，extension.ts registerPage 登记）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { localeTagFor, pickMessages } from './i18n'
import { setDebugEnabled } from './logging'
import { mountSettingsPage } from './settingsTabsUi'
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
  const view = mountSettingsPage(root, {
    channel: sdk.channel,
    messages: pickMessages(navigator.language),
    localeTag: localeTagFor(navigator.language),
    // #50 宿主行为禁用态只读面（设置页可用；旧平台 undefined → 不灰显）
    behaviorState: sdk.behaviorState,
    // #55 切片 2 作用域观察面（设置页可用 facet；旧宿主/编辑器页形态
    // undefined → 判空降级：无作用域相关 UI，写入目标层固定 'user'）
    settingsContext: sdk.settingsContext,
  })
  sdk.onDispose(() => view.dispose())
})
