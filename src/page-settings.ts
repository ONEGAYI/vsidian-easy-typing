// 设置页入口（工单 #16 起建；#55 切片 1 改为五 Tab 自绘设置页装配）：
// 经 SDK 构建桥打成 chrome114 IIFE。mountRoot 内挂自绘设置页
// （src/settingsTabsUi.ts——hero + 五页内 Tab + 24 项设置行 + 规则四分区
// 挂入；Tab 归属映射见 src/settings/tabs-model.ts）。设置读写经 setup
// 生命周期注册的 SETTINGS_TOPIC 通道，规则数据经 RULES_TOPIC 通道
// （src/rulesHost.ts，与编辑器页同名 topic 各自注册不冲突）。面板 chrome
// 与 dock 样式归平台；内容根内部样式归 src/settings.css（构建拷贝
// dist/settings.css，extension.ts registerPage 登记）。
// #58 语言源：经 resolvePageLanguage 消费 sdk.locale（跟随 VSCode 主设置，
// vsidian#582；旧宿主回落 navigator.language），onChange 通知驱动
// view.setLanguage 就地切换文案。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { localeTagFor, pickMessages, resolvePageLanguage } from './i18n'
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
  // 页即按新值；debug 是诊断面，设置页装配内的 get 失败留痕（审查轮
  // R1-B4，settingsTabsUi refreshSettings）经此接线生效）；通道失败保持
  // 默认关。
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
  // #58 语言源单一出口（resolvePageLanguage）：locale facet 在场取平台
  // 快照（与主设置 general.language 同源；空串 = 语言包未装配 → pickMessages
  // 落英文，与平台无包兜底一致）；旧宿主无 facet（undefined）回落
  // navigator.language——保持本票前既有降级行为，与 #61 mergedHint 的
  // 可选消费口径一致（清单 api 范围不升）。
  const view = mountSettingsPage(root, {
    channel: sdk.channel,
    messages: pickMessages(resolvePageLanguage(sdk.locale, navigator.language)),
    localeTag: localeTagFor(resolvePageLanguage(sdk.locale, navigator.language)),
    // #50 宿主行为禁用态只读面（设置页可用；旧平台 undefined → 不灰显）
    behaviorState: sdk.behaviorState,
    // #55 切片 2 作用域观察面（设置页可用 facet；旧宿主/编辑器页形态
    // undefined → 判空降级：无作用域相关 UI，写入目标层固定 'user'）
    settingsContext: sdk.settingsContext,
  })
  // #58 平台语言变化即时通知（vsidian#582）：onChange 只通知变化不回放
  // 首值——首值已在上方消费；通知驱动 view.setLanguage 就地切换文案，
  // 不重载工厂、保全页面状态（Tab/草稿/规则表单）
  const unsubscribeLocale = sdk.locale?.onChange((locale) => view.setLanguage(locale))
  sdk.onDispose(() => {
    // 先退订再释放视图：迟到的语言通知不触达已释放视图（facet 代次释放
    // 自动回收之外的双保险；退订幂等）
    unsubscribeLocale?.()
    view.dispose()
  })
})
