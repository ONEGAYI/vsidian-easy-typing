// 五 Tab 自绘设置页装配（工单 #55）：hero 顶部块 + 页内 Tab 框架
// + 24 项设置行（definitions 元数据驱动）+ 规则四分区挂入 + 平台作用域
// 接入（切片 2）+ 全局设置搜索定位接入（切片 3）。
//
// 【分层】零 SDK 依赖（入口 src/page-settings.ts 注入 channel / messages /
// localeTag / behaviorState / settingsContext，jsdom 承载交互测试）：
// - Tab 归属与卡片分区：src/settings/tabs-model.ts 纯函数（搜索定位
//   def/group 两类映射复用同一映射面）；
// - 设置读写：SETTINGS_TOPIC.get（effective 初值/回显 + sources 来源分层）
//   与 .update（scope 取 settingsContext.scopeState().scope——facet 缺席
//   的旧宿主/编辑器页形态固定 'user'；写后重拉刷新，通道失败经状态行
//   提示，决策 12）；页面 SDK 无 channel.handle，一切写走既有 topic；
// - 作用域观察面：settingsContext（可选 facet，仅设置页提供）——
//   onScopeChange 分发后 refreshSettings 对齐显示；组件不自绘作用域
//   切换器（平台外壳持有选择器，本组件只消费；等值不分发归平台）；
//   facet 缺席 = 无作用域相关 UI，页面其余功能完整可用（降级形态）；
// - 搜索定位（切片 3）：onLocateTarget（订阅即回放）+ locateTarget()
//   初值；{kind:'def'|'group', key} → 切 Tab + 滚动 + data-located 高亮；
//   重复目标幂等重入，null 清除；目标早于首次渲染（get 未返回）排队
//   至渲染结算后补投；
// - 规则四分区：rulesUi 的 hosts 模式挂入对应 panel（分区 DOM 结构与
//   交互不变，spacing 防御网时序不变——面板常驻 DOM、非活动 [hidden]）。
//
// 【审查轮 R2（PR #59 review）】控件创建即应用定义默认值 + 首读失败三态
//   （横幅/重试/行禁用）；24 控件统一可访问名称（aria-labelledby 标题 +
//   aria-describedby 说明）；spacing 分区用户级标注；写失败强制回滚键单槽
//   扩集合；用户层视角的合并值提示（平台按层读取缺口过渡处置）。
//
// 【PR #59 第二轮复审】首读完成前普通设置明确不可编辑（装载窗口全行禁用
//   + 首个有效快照强制回填 + 写入守卫三防线——防未知默认值经 change 覆盖
//   已存配置、防仅聚焦挡首快照回填）；重试恢复时清理状态行仍挂着的本次
//   失败提示（较新的规则通道消息不误清）。
//
// 【Tab 态】（#63 修正）宿主侧会话级 view-state 通道（VIEW_STATE_TOPIC）
// 承载——Tab 浏览位置跨面板开关保留（平台隐藏面板即释放 webview，重开
// 重新装载页面，内存态经宿主 setup 常驻闭包续存）、重启 VSCode 复位；
// 页面级滚动偏移同通道承载（#63 扩展，超上游一步，见 view-state 接入节
// 注释——平台 focusSection.scroll 恢复对异步装载的附加页失效，组件侧
// 补完时机）。switchTab 为受控切换 API（外部驱动面）；按钮 / 键盘 / 定位
// 切换经 selectTab 同一受控路径切页并上送。
import { localeTagFor, pickMessages, type Messages } from './i18n'
import type { AddonSettingDefinition } from '../types/vendor/shared/addonSettings'
import type { AddonSettingsLocateTarget, AddonSettingsScopeSnapshot } from '../types/vendor/shared/addonSettingsContextApi'
import { buildSettingDefinitions } from './settings/definitions'
import { pickValidValue, SETTINGS_TOPIC, VIEW_STATE_TOPIC } from './settings/store'
import { debugLog } from './logging'
import { mountRulesSettingsView, type RulesBehaviorStateLike, type RulesSettingsViewHandle } from './rulesUi'
import { RulesSettingsClient } from './rules/rules-settings-client'
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TAB_IDS,
  cardsForTab,
  groupKeyToCardAnchor,
  settingKeyToTabId,
  type SettingsCardKey,
  type SettingsCardSpec,
  type SettingsTabId,
} from './settings/tabs-model'

/** scoped 类前缀（自绘边界：与 rulesUi 同一前缀） */
const CLS = 'vsidian-easy-typing'

/** 上游来源链接（MIT 双署名致敬；hero 链接目标） */
const UPSTREAM_REPO_URL = 'https://github.com/Yaozhuwa/easy-typing-obsidian'

/** 联动主控键（决策 11）：autoFormat 总开关联动置灰自动格式化 Tab 下游行 */
const MASTER_KEY = 'autoFormat'
/** 二级联动键：userDefinedRegExp 再受 userDefinedRegSwitch 联动 */
const REGEXP_KEY = 'userDefinedRegExp'
const REGEXP_SWITCH_KEY = 'userDefinedRegSwitch'

/** 页面侧通道面（sdk.channel.request 的注入形态；与 RulesChannelLike 结构兼容） */
export interface SettingsChannelLike {
  request(
    topic: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }>
}

export interface SettingsPageViewOptions {
  /** 设置读写通道（SETTINGS_TOPIC；规则通道由本装配内部建客户端复用） */
  channel: SettingsChannelLike
  messages: Messages
  /** 枚举档位双语映射的取值标签（初始语言的 localeTagFor 结果；#58 语言
   *  切换经 handle.setLanguage 就地更新，不重传本字段） */
  localeTag: 'zh-cn' | 'en'
  /** Document 注入（缺省全局 document；jsdom 测试用） */
  doc?: Document
  /** 计时器注入（状态行自动清除；缺省全局 setTimeout/clearTimeout） */
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  /** 宿主行为禁用态只读面（#50 灰态；入口注入，undefined = 不灰显） */
  behaviorState?: RulesBehaviorStateLike
  /** 设置页上下文观察面（#55 切片 2 作用域；入口注入 sdk.settingsContext，
   *  undefined = facet 缺席（旧宿主 / 编辑器页形态）→ 无作用域相关 UI，
   *  写入目标层固定 'user'，页面其余功能完整可用） */
  settingsContext?: SettingsContextFacetLike
}

/** 设置页上下文观察面的消费形状（#55 切片 2 作用域 + 切片 3 搜索定位；
 *  结构对齐 vendor AddonSettingsContextFacet 全形状——视图层保持零 SDK
 *  依赖，入口把 sdk.settingsContext 直接传入（结构等形），jsdom 测试注入
 *  fake） */
export interface SettingsContextFacetLike {
  /** 当前作用域快照（拉取式；scope = 写入目标层依据） */
  scopeState(): AddonSettingsScopeSnapshot
  /** 订阅作用域/工作区状态变化（平台等值不分发）；返回退订函数 */
  onScopeChange(listener: (state: AddonSettingsScopeSnapshot) => void): () => void
  /** 当前未消费的定位目标（null = 无挂起目标） */
  locateTarget(): AddonSettingsLocateTarget | null
  /** 订阅定位目标交付：订阅时如有挂起目标先回放一次（补投），此后每次
   *  交付（含 null 清除）通知；返回退订函数（重复退订无害） */
  onLocateTarget(listener: (target: AddonSettingsLocateTarget | null) => void): () => void
}

export interface SettingsPageViewHandle {
  /** 受控切换 Tab（外部驱动面；未知 id 抛错保持可闻） */
  switchTab(tabId: SettingsTabId): void
  /** 当前活动 Tab */
  activeTab(): SettingsTabId
  /** 就地切换语言（#58：SDK locale 通知驱动；映射经 pickMessages/
   *  localeTagFor）：更新骨架/行/枚举/联动提示文案并委托规则分区，
   *  活动 Tab 与控件显示值（含未提交草稿）保全 */
  setLanguage(language: string): void
  /** 重拉 SETTINGS_TOPIC.get 并刷新控件与联动（重复调用无害） */
  refreshSettings(): Promise<void>
  /** 释放：规则分区、状态计时器与页面 DOM */
  dispose(): void
}

/** 状态行自动清除延迟（对齐 rulesUi 既有节奏） */
const STATUS_AUTO_CLEAR_MS = 6000

/** 枚举档位文案（纯函数，导出供测试直测）：vendor LocalizedText 两形态
 *  ——直值字符串直返；多语言映射取当前语言档位；缺失键/缺失语言回退
 *  枚举值本身（呈现层回退，不参与值校验） */
export function enumLabelText(
  def: AddonSettingDefinition,
  value: string,
  localeTag: 'zh-cn' | 'en',
): string {
  if (def.type !== 'string') return value
  const label = def.enumLabels?.[value]
  // 直值形态（LocalizedText = string）：不随语言切换，原样直返
  if (typeof label === 'string') return label
  if (label !== undefined) {
    const picked = label[localeTag]
    if (typeof picked === 'string') return picked
  }
  return value
}

/** Tab id → i18n settingsTabs.tabs 键（两套拼写并存惯例：tab id kebab-case） */
const TAB_LABEL_KEY: Readonly<Record<SettingsTabId, keyof Messages['settingsTabs']['tabs']>> = {
  'edit-enhance': 'editEnhance',
  'auto-format': 'autoFormat',
  'builtin-rules': 'builtinRules',
  'user-rules': 'userRules',
  other: 'other',
}

/** 单行控件登记（渲染后按 key 索引，供初值应用/写后刷新/联动置灰/来源徽章） */
interface SettingRowEntry {
  def: AddonSettingDefinition
  row: HTMLElement
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  /** 工作区覆盖徽章（sources 驱动显隐；仅 facet 在场时呈现） */
  badge: HTMLElement
  /** 清除工作区覆盖动作（恢复继承用户默认；与徽章同显隐） */
  clearBtn: HTMLButtonElement
  /** 用户层合并值提示（审查轮 R2-P2-1 过渡处置）：scope=user 且
   *  sources[key]=workspace 时呈现——显示值是工作区覆盖后的合并值，用户层
   *  原值待平台按层读取（ONEGAYI/vsidian#590） */
  mergedHint: HTMLElement
}

export function mountSettingsPage(root: HTMLElement, options: SettingsPageViewOptions): SettingsPageViewHandle {
  const doc = options.doc ?? document
  // 语言态可变（#58 setLanguage 就地切换）：m/t/localeTag/defs/defByKey 为
  // let，事件回调与懒取文案路径读当前引用；静态骨架文本经 setLanguage
  // 逐节点刷新（节点引用见下方常量收集）
  let m = options.messages
  let t = m.settingsTabs
  let localeTag = options.localeTag
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]))
  let disposed = false
  let statusTimer: unknown = null
  let active: SettingsTabId = DEFAULT_SETTINGS_TAB

  /** DOM 构造糖（与 rulesUi 同款；模块内自有副本避免跨模块导出内部糖） */
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function classes(...names: Array<string | false | undefined>): string {
    return names.filter(Boolean).join(' ')
  }

  // ===== 定义元数据（24 项控件形态的事实源；注册面零改动） =====
  let defs = buildSettingDefinitions(m)
  let defByKey = new Map(defs.map((def) => [def.key, def]))
  const rows = new Map<string, SettingRowEntry>()
  /** 自动格式化 Tab 下下行（联动置灰对象；主控键除外） */
  const masterDownstreamKeys = cardsForTab('auto-format')
    .flatMap((card) => [...card.settingKeys])
    .filter((key) => key !== MASTER_KEY)

  /** effective 快照（get 返回；写后重拉替换）。初值 = 定义默认值（审查轮
   *  R2-P2-2）：装载窗口与首读失败期间控件呈现默认值而非浏览器原生初值，
   *  联动同步初始化；get 成功后替换为存储真值 */
  let currentValues: Readonly<Record<string, unknown>> = Object.fromEntries(
    defs.map((def) => [def.key, def.default]),
  )
  /** sources 快照（get 返回的来源分层 default/user/workspace；徽章驱动） */
  let currentSources: Readonly<Record<string, string>> = {}
  /** 用户默认层显式值（vsidian#590：get 快照可选 userValues；undefined =
   *  旧宿主字段缺席 → 按层显示降级合并显示 + mergedHint 过渡提示） */
  let currentUserValues: Readonly<Record<string, unknown>> | undefined
  /** 设置读取态（审查轮 R2-P2-2 三态 + PR #59 复审 P2 收紧）：loading
   *  （默认值在场且全行禁用——首读完成前不可编辑，防未知默认值覆盖已存
   *  配置）→ loaded（首个有效快照强制回填 + 联动接管后启用）/
   *  failed（首 get 拒绝或抛错 → 横幅 + 重试 + 行禁用，重试成功恢复）。
   *  已成功读取后的后续 get 失败不回 failed——保持既有静默语义（值是已读
   *  真值而非默认值，写失败路径另有状态行提示） */
  let settingsLoaded = false
  let settingsLoadFailed = false

  // ===== 静态骨架：hero / tablist / 状态行 / 面板容器 =====

  root.classList.add(`${CLS}-root`)
  root.setAttribute('data-vet-page', 'settings')

  const hero = el('div', `${CLS}-settings-hero`)
  hero.setAttribute('data-vet-hero', '')
  const heroTitle = el('h1', `${CLS}-settings-hero-title`, t.heroTitle)
  const heroMeta = el('div', `${CLS}-settings-hero-meta`)
  const heroSourceLabel = el('span', `${CLS}-settings-hero-label`, t.heroSourceLabel)
  heroMeta.append(heroSourceLabel)
  const heroLink = el('a', `${CLS}-settings-hero-link`, t.heroLinkText)
  heroLink.href = UPSTREAM_REPO_URL
  heroLink.target = '_blank'
  heroLink.rel = 'noreferrer noopener'
  heroMeta.append(heroLink)
  hero.append(heroTitle, heroMeta)

  const nav = el('nav', `${CLS}-settings-nav`)
  nav.setAttribute('role', 'tablist')
  nav.setAttribute('aria-orientation', 'horizontal')
  nav.setAttribute('data-vet-tablist', '')

  /** 页面级状态行（设置写入提示与规则分区共用；role=status） */
  const status = el('div', `${CLS}-status`)
  status.setAttribute('data-vet-status', '')
  status.setAttribute('role', 'status')

  /** 装载失败横幅（审查轮 R2-P2-2）：首 get 拒绝/抛错 → 错误提示 + 重试
   *  入口；读取成功后隐藏。role=alert 使恢复对读屏可闻；与状态行分工——
   *  状态行 6s 自动清除，横幅承载持续性失败态 */
  const loadError = el('div', `${CLS}-load-error`)
  loadError.setAttribute('data-vet-load-error', '')
  loadError.setAttribute('role', 'alert')
  loadError.hidden = true
  const loadErrorRetry = el('button', `${CLS}-load-error-retry`, t.loadFailedRetry) as HTMLButtonElement
  loadErrorRetry.type = 'button'
  loadErrorRetry.setAttribute('data-vet-action', 'retry-load')
  loadErrorRetry.addEventListener('click', () => {
    void refreshSettings()
  })
  const loadErrorText = el('span', `${CLS}-load-error-text`, t.loadFailedText)
  loadError.append(loadErrorText, loadErrorRetry)

  const panelsWrap = el('div', `${CLS}-settings-panels`)
  root.append(hero, nav, status, loadError, panelsWrap)

  function showStatus(kind: 'info' | 'failed' | 'success', text: string): void {
    // dispose 后经 statusSink 到达的规则侧在途提示直接丢弃（审查轮 R1-B3）：
    // 已卸载的页面不再写状态行 / 起新计时器（6s 空转持闭包）
    if (disposed) return
    status.textContent = text
    status.setAttribute('data-vet-status', kind)
    if (statusTimer !== null) cancel(statusTimer)
    statusTimer = schedule(() => {
      statusTimer = null
      if (disposed) return
      status.textContent = ''
      status.setAttribute('data-vet-status', '')
    }, STATUS_AUTO_CLEAR_MS)
  }

  // ===== Tab 框架（面板常驻 DOM、非活动 [hidden]；roving tabIndex） =====

  const tabButtons = new Map<SettingsTabId, HTMLButtonElement>()
  const panels = new Map<SettingsTabId, HTMLElement>()

  function activateTab(tabId: SettingsTabId, focusButton = false): void {
    active = tabId
    for (const id of SETTINGS_TAB_IDS) {
      const btn = tabButtons.get(id)
      const panelEl = panels.get(id)
      if (!btn || !panelEl) continue
      const isActive = id === tabId
      btn.classList.toggle(`${CLS}-settings-tab-btn-active`, isActive)
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false')
      btn.tabIndex = isActive ? 0 : -1
      if (isActive) panelEl.removeAttribute('hidden')
      else panelEl.setAttribute('hidden', '')
      panelEl.setAttribute('aria-hidden', isActive ? 'false' : 'true')
      if (isActive && focusButton) btn.focus()
    }
  }

  // ===== Tab 浏览态 view-state 接入（#63）：跨面板开关保留、会话级复位 =====

  /** mount 后恢复窗口内已有确定导航（用户切换 / 搜索定位交付）→ 迟到的
   *  view-state 回包放弃恢复：确定意图优先，回包不翻转既有选择。初始
   *  默认渲染与恢复切换本身都不置位（初始上送会把宿主态冲回默认） */
  let viewStateClaimed = false

  // ---- 页面级滚动偏移的保存与恢复（#63 扩展，超上游一步）----
  // 滚动容器不是 mountRoot 内部元素：真宿主里设置页随平台设置 webview 的
  // 主区（.vsidian-settings-main，overflow-y:auto）滚动。平台自身的会话内
  // 恢复（settings.focusSection.scroll）在渲染后立即应用 scrollTop，而附加
  // 组件页异步装载——应用时内容高度未起，偏移被钳为 0。本侧补完该恢复的
  // 时机：装载完成后经 rAF 回放。滚动祖先由 mountRoot 向上解析（首个
  // overflow-y 为 auto/scroll 的祖先），解析失败回退 scrollingElement——
  // 平台 DOM 结构变化时优雅降级为不保存（与修复前行为一致，无破坏面）。
  const scrollEl: HTMLElement = (() => {
    let node: HTMLElement | null = root.parentElement
    while (node !== null) {
      const overflowY = doc.defaultView?.getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return node
      node = node.parentElement
    }
    // 回退文档滚动根 scrollingElement；其未实现/异形的环境（如 jsdom 返回
    // undefined）落 documentElement——同为文档滚动根
    return doc.scrollingElement instanceof HTMLElement ? doc.scrollingElement : doc.documentElement
  })()

  /** 当前滚动偏移（取整对齐平台 uiState 口径） */
  function readScroll(): number {
    return Math.round(scrollEl.scrollTop)
  }

  /** 滚动上报尾沿节流（200ms）：scroll 事件按帧高频，通道请求roundtrip
   *  不逐帧打；尾沿保证停止滚动后 200ms 内落账。残余边界：滚动后 200ms
   *  内关闭面板丢失最后一段位移（可接受，spec 已知边界） */
  const SCROLL_THROTTLE_MS = 200
  let scrollPushTimer: unknown = null

  function pushViewState(tabId: SettingsTabId): void {
    void options.channel
      .request(VIEW_STATE_TOPIC.update, { tab: tabId, scroll: readScroll() })
      .catch(() => {
        // 通道异常静默（尽力而为通道，无重试面）
      })
  }

  /** 组件在场归属（R1 审查 002）：root 仍连接且属于解析出的滚动容器。
   *  平台切到其他设置分页时组件 DOM 从共享主区移出（mount 释放只清
   *  parent，装载常驻不等价 dispose）——脱离即失去对共享容器滚动的
   *  记账权；重入（重新挂入主区）自然恢复 */
  function ownsScroll(): boolean {
    return root.isConnected && scrollEl.contains(root)
  }

  function onAnyScroll(evt: Event): void {
    if (evt.target !== scrollEl || !ownsScroll()) return
    if (scrollPushTimer !== null) cancel(scrollPushTimer)
    scrollPushTimer = schedule(() => {
      scrollPushTimer = null
      // 尾沿到期时再校验归属：切离后到期的上报不提交（事件与到期之间
      // 组件可能已离开共享主区）
      if (!ownsScroll()) return
      pushViewState(active)
    }, SCROLL_THROTTLE_MS)
  }
  doc.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })

  /** 确定导航的唯一切页入口：切页 + 上送宿主 view-state（失败静默不阻塞
   *  切换——UI 浏览态尽力而为）。按钮点击 / 键盘导航 / switchTab 受控
   *  API / 搜索定位四路共用；上送时顺带读取当前滚动偏移入账（覆盖节流
   *  窗内未落账的程序性位移） */
  function selectTab(tabId: SettingsTabId, focusButton = false): void {
    viewStateClaimed = true
    activateTab(tabId, focusButton)
    pushViewState(tabId)
  }

  for (const tabId of SETTINGS_TAB_IDS) {
    const buttonId = `vsidian-easy-typing-tab-${tabId}`
    const panelId = `vsidian-easy-typing-panel-${tabId}`
    const btn = el('button', `${CLS}-settings-tab-btn`, t.tabs[TAB_LABEL_KEY[tabId]]) as HTMLButtonElement
    btn.type = 'button'
    btn.id = buttonId
    btn.setAttribute('role', 'tab')
    btn.setAttribute('data-vet-tab', tabId)
    btn.setAttribute('aria-controls', panelId)
    btn.tabIndex = -1
    btn.addEventListener('click', () => selectTab(tabId))
    btn.addEventListener('keydown', (evt) => {
      const index = SETTINGS_TAB_IDS.indexOf(tabId)
      let target: number | null = null
      switch (evt.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          target = (index + 1) % SETTINGS_TAB_IDS.length
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          target = (index - 1 + SETTINGS_TAB_IDS.length) % SETTINGS_TAB_IDS.length
          break
        case 'Home':
          target = 0
          break
        case 'End':
          target = SETTINGS_TAB_IDS.length - 1
          break
      }
      if (target === null) return
      evt.preventDefault()
      selectTab(SETTINGS_TAB_IDS[target], true)
    })
    nav.append(btn)
    tabButtons.set(tabId, btn)

    const panelEl = el('section', `${CLS}-settings-tab-panel`)
    panelEl.id = panelId
    panelEl.setAttribute('role', 'tabpanel')
    panelEl.setAttribute('data-vet-panel', tabId)
    panelEl.setAttribute('aria-labelledby', buttonId)
    panelEl.setAttribute('hidden', '')
    panelEl.setAttribute('aria-hidden', 'true')
    panelsWrap.append(panelEl)
    panels.set(tabId, panelEl)
  }
  activateTab(active)

  // ===== 24 项设置行（元数据驱动控件形态） =====

  function readControlValue(def: AddonSettingDefinition, control: SettingRowEntry['control']): unknown {
    if (def.type === 'boolean') return (control as HTMLInputElement).checked
    if (def.type === 'array') {
      return control.value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    }
    return control.value
  }

  function applyValue(entry: SettingRowEntry, raw: unknown, force = false): void {
    const { def, control } = entry
    // 聚焦中控件跳过回写（审查轮 P2-2）：保留正在编辑的未提交草稿——
    // 写后/作用域切换/清除覆盖的重拉不覆盖用户当前输入；失焦后的下一次
    // 重拉照常应用存储真值。force 仅由写/清除失败对账路径传入（审查轮
    // R1-B1）：真实浏览器提交（点选/换档/回车）后焦点仍在控件，失败
    // 回滚必须穿透草稿保护把该键拉回存储真值，否则失配持续到下一次
    // 操作（无推送通道不自愈）；未失败键的草稿保护照常生效
    if (!force && doc.activeElement === control) return
    if (def.type === 'boolean') {
      ;(control as HTMLInputElement).checked = raw === true
      return
    }
    if (def.type === 'array') {
      control.value = Array.isArray(raw) ? raw.filter((item) => typeof item === 'string').join('\n') : ''
      return
    }
    control.value = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw)
  }

  function setRowDisabled(entry: SettingRowEntry, disabled: boolean, hint: string | null): void {
    entry.control.disabled = disabled
    entry.row.classList.toggle(`${CLS}-setting-row-disabled`, disabled)
    if (disabled) entry.row.setAttribute('aria-disabled', 'true')
    else entry.row.removeAttribute('aria-disabled')
    if (hint !== null) entry.row.title = hint
    else entry.row.removeAttribute('title')
  }

  /** 联动置灰（决策 11，纯 UI 态不改变写入）：总开关关 → 自动格式化 Tab
   *  下游行置灰；userDefinedRegExp 再受正则开关二级联动。首读完成前
   *  （装载窗口 + 失败锁定，PR #59 复审 P2）联动不接管——全行已禁用，
   *  联动提示会误导禁用归因；首个有效快照结算后由本函数接管禁用语义 */
  function applyLinkage(): void {
    if (!settingsLoaded) return
    const masterOn = displayValueOf(MASTER_KEY, true) !== false
    const regSwitchOn = displayValueOf(REGEXP_SWITCH_KEY, true) !== false
    for (const key of masterDownstreamKeys) {
      const entry = rows.get(key)
      if (!entry) continue
      if (key === REGEXP_KEY) {
        if (!masterOn) setRowDisabled(entry, true, t.hintDisabledByMaster)
        else setRowDisabled(entry, !regSwitchOn, regSwitchOn ? null : t.hintDisabledByRegexSwitch)
        continue
      }
      setRowDisabled(entry, !masterOn, masterOn ? null : t.hintDisabledByMaster)
    }
  }

  function buildSettingRow(def: AddonSettingDefinition): HTMLElement {
    const isWideControl = def.type === 'array' || (def.type === 'string' && def.multiline === true)
    const row = el('div', classes(`${CLS}-setting-row`, isWideControl && `${CLS}-setting-row-wide`))
    row.setAttribute('data-vet-setting-key', def.key)
    const info = el('div', `${CLS}-setting-info`)
    const nameLine = el('div', `${CLS}-setting-name-line`)
    // 可访问名称锚点（审查轮 R2-P2-4，WCAG 4.1.2/F68）：标题 span 唯一 id，
    // 全部控件统一 aria-labelledby 指向（checkbox 一并统一，不另用 aria-label）
    const nameSpan = el('span', `${CLS}-setting-name`, def.title)
    nameSpan.id = `vsidian-easy-typing-setting-name-${def.key}`
    nameLine.append(nameSpan)
    // 工作区覆盖徽章 + 清除动作（sources 驱动；facet 缺席恒隐藏——降级
    // 形态无作用域相关 UI。清除语义 = 恢复继承用户默认，非恢复出厂）
    const badge = el('span', `${CLS}-source-badge`, t.badgeWorkspaceOverride)
    badge.setAttribute('data-vet-source-badge', 'workspace')
    badge.hidden = true
    const clearBtn = el('button', `${CLS}-source-clear`, t.clearOverrideAction) as HTMLButtonElement
    clearBtn.type = 'button'
    clearBtn.title = t.clearOverrideTitle
    clearBtn.setAttribute('aria-label', t.clearOverrideTitle)
    clearBtn.setAttribute('data-vet-clear-override', def.key)
    clearBtn.hidden = true
    clearBtn.addEventListener('click', () => {
      void clearOverride(def.key)
    })
    // 用户层合并值提示（审查轮 R2-P2-1）：用户层视角下被工作区覆盖的行呈现
    const mergedHint = el('span', `${CLS}-merged-hint`, t.mergedValueHint)
    mergedHint.setAttribute('data-vet-merged-hint', '')
    mergedHint.hidden = true
    nameLine.append(badge, clearBtn, mergedHint)
    info.append(nameLine)
    if (def.description !== undefined) {
      // 说明 span 唯一 id：控件 aria-describedby 指向（审查轮 R2-P2-4）
      const descSpan = el('div', `${CLS}-setting-desc`, def.description)
      descSpan.id = `vsidian-easy-typing-setting-desc-${def.key}`
      info.append(descSpan)
    }
    row.append(info)
    const controlWrap = el('div', `${CLS}-setting-control`)
    let control: SettingRowEntry['control']
    if (def.type === 'boolean') {
      const label = el('label', `${CLS}-toggle`)
      const input = el('input') as HTMLInputElement
      input.type = 'checkbox'
      control = input
      label.append(input)
      controlWrap.append(label)
    } else if (def.type === 'string' && def.enum) {
      const select = el('select', `${CLS}-select`) as HTMLSelectElement
      for (const value of def.enum) {
        const option = el('option', undefined, enumLabelText(def, value, localeTag)) as HTMLOptionElement
        option.value = value
        select.append(option)
      }
      control = select
      controlWrap.append(select)
    } else if (def.type === 'string' && def.multiline) {
      const textarea = el('textarea', `${CLS}-textarea`) as HTMLTextAreaElement
      textarea.rows = def.key === REGEXP_KEY ? 8 : 4
      control = textarea
      controlWrap.append(textarea)
    } else if (def.type === 'array') {
      // 每行一项（上游 ExcludeFiles 多行形态；写入拆行）
      const textarea = el('textarea', `${CLS}-textarea`) as HTMLTextAreaElement
      textarea.rows = 4
      control = textarea
      controlWrap.append(textarea)
    } else {
      const input = el('input') as HTMLInputElement
      input.type = 'text'
      control = input
      controlWrap.append(input)
    }
    // 可访问名称统一收口（审查轮 R2-P2-4）：全部 24 控件 aria-labelledby →
    // 标题 span；说明在场时 aria-describedby → 说明 span
    control.setAttribute('aria-labelledby', nameSpan.id)
    if (def.description !== undefined) {
      control.setAttribute('aria-describedby', `vsidian-easy-typing-setting-desc-${def.key}`)
    }
    row.append(controlWrap)
    // 写入触发 = change（失焦/回车），非逐键——避免通道风暴
    control.addEventListener('change', () => {
      void write(def.key, readControlValue(def, control))
    })
    rows.set(def.key, { def, row, control, badge, clearBtn, mergedHint })
    return row
  }

  function buildCard(card: SettingsCardSpec): HTMLElement {
    const section = el('section', `${CLS}-section ${CLS}-settings-card`)
    section.setAttribute('data-vet-card', card.cardKey)
    section.append(el('h3', `${CLS}-section-title`, t.cards[card.cardKey]))
    for (const key of card.settingKeys) {
      const def = defByKey.get(key)
      // 卡片分区与 24 键的咬合由契约测试钉死；此处防御跳过缺定义键
      if (def) section.append(buildSettingRow(def))
    }
    return section
  }

  // 规则分区挂载点（rulesUi 四分区 hosts；容器 div 便于分区定位与样式隔离）
  const userHost = el('div', `${CLS}-settings-section-host`)
  const builtinHost = el('div', `${CLS}-settings-section-host`)
  const spacingHost = el('div', `${CLS}-settings-section-host`)
  const storageHost = el('div', `${CLS}-settings-section-host`)

  /** 规则分区用户级标注（决策 8）：规则/富结构存储是 globalStorage 语义
   *  用户级（无工作区作用域），panel 顶部明确标注；规则区不出现任何
   *  作用域 UI。静态数据级说明——facet 降级形态下仍在。 */
  function buildRulesScopeNote(): HTMLElement {
    const note = el('p', `${CLS}-rules-scope-note`, t.rulesScopeNote)
    note.setAttribute('data-vet-rules-scope', 'user')
    return note
  }

  /** spacing 分区用户级标注（审查轮 R2-P2-3）：语言间空格策略与自定义文字
   *  类别数据写全局 rule-state（用户级），但分区挂在自动格式化 Tab、与按
   *  作用域保存的普通设置行紧邻——标注只挂分区近旁（复用规则区标注文案
   *  形态），不把整个 Tab 标为用户级 */
  function buildSpacingScopeNote(): HTMLElement {
    const note = el('p', `${CLS}-rules-scope-note`, t.spacingScopeNote)
    note.setAttribute('data-vet-spacing-scope', 'user')
    return note
  }

  for (const tabId of SETTINGS_TAB_IDS) {
    const panelEl = panels.get(tabId)
    if (!panelEl) continue
    switch (tabId) {
      case 'edit-enhance':
        for (const card of cardsForTab(tabId)) panelEl.append(buildCard(card))
        break
      case 'auto-format':
        for (const card of cardsForTab(tabId)) {
          panelEl.append(buildCard(card))
          // 语言间空格策略分区（rulesUi spacing）随上游排在总开关卡之后；
          // 分区数据用户级 → 标注挂分区近旁（审查轮 R2-P2-3）
          if (card.cardKey === 'autoFormat') panelEl.append(buildSpacingScopeNote(), spacingHost)
        }
        break
      case 'builtin-rules':
        panelEl.append(buildRulesScopeNote(), builtinHost)
        break
      case 'user-rules':
        panelEl.append(buildRulesScopeNote(), userHost)
        break
      case 'other':
        for (const card of cardsForTab(tabId)) panelEl.append(buildCard(card))
        // 数据目录展示分区（rulesUi storage）殿后
        panelEl.append(storageHost)
        break
    }
  }

  // 控件创建即应用定义默认值（审查轮 R2-P2-2）：装载窗口（get 在途）与
  // 首读失败期间不落浏览器原生初值（checkbox 未选 / enum 首项 / 空文本）；
  // get 成功后由 refreshSettings 替换为存储真值
  for (const entry of rows.values()) applyValue(entry, entry.def.default)
  // 首读完成前普通设置不可编辑（PR #59 复审 P2）：装载窗口呈现定义默认值
  // 但全部行禁用——防未知默认值经 change 提交覆盖已存配置（数据丢失），
  // 也阻断「仅聚焦即挡首快照回填」的草稿误保护（disabled 控件无合法草稿）；
  // 首个有效快照完成回填与联动后启用（refreshSettings 成功结算恢复，
  // 失败态行禁用由 enterLoadFailedState 接管并补行级提示）
  for (const entry of rows.values()) setRowDisabled(entry, true, null)

  // ===== 设置读写通道（决策 12：写后重拉刷新；目标层跟随作用域） =====

  /** 写入目标层（拉取式快照）：facet 在场取 scopeState().scope；缺席
   *  （旧宿主/编辑器页）固定 'user'——平台外壳持有作用域选择器，本组件
   *  只消费观察面，不自绘切换器 */
  const scopeFacet = options.settingsContext
  function writeScope(): 'user' | 'workspace' {
    return scopeFacet ? scopeFacet.scopeState().scope : 'user'
  }

  /** 作用域切换（平台等值不分发，到达即变化）：重拉对齐显示——effective
   *  与来源徽章都随 layers 解析变化 */
  const unsubscribeScope = scopeFacet ? scopeFacet.onScopeChange(() => { void refreshSettings() }) : null

  /** #60 按层显示：控件显示值随平台选中层计算——
   *  - workspace 视角：合并 effective 即工作区视角（workspace 显式 > user > default）；
   *  - user 视角且层值可用：用户层显式值经按定义校验归一化（审查 P2：
   *    userValues 是原始显式存储、不按定义校验，遗留值可为合法存储标量
   *    却不匹配当前 boolean/enum/数组定义——复用 store.pickValidValue，
   *    与 effective fail-safe 同一规则源）：合法 → 用，非法 → 回出厂默认
   *    def.default（不回 merged 合并值；联动调用点传 fallback true 与
   *    MASTER_KEY/REGEXP_SWITCH_KEY 的 def.default 同值，无分歧），键未
   *    显式保存时同样出厂默认——不显示被工作区覆盖的合并值；
   *  - user 视角且层值缺席（旧宿主降级）：回落合并值（mergedHint 在场提示） */
  function displayValueOf(key: string, fallback: unknown): unknown {
    if (scopeFacet !== undefined && scopeFacet.scopeState().scope === 'user' && currentUserValues !== undefined) {
      const layered = currentUserValues[key]
      if (layered === undefined) return fallback
      const valid = pickValidValue(key, layered)
      if (valid !== undefined) return valid
      return defByKey.get(key)?.default ?? fallback
    }
    return currentValues[key] ?? fallback
  }

  // ===== 搜索定位接入（#55 切片 3）：平台只给 {kind, key} 落点，切页内
  // Tab 与定位控件是组件职责。平台刻意不做等值去重——重复目标重新滚动/
  // 高亮（幂等可重入）；null 清除高亮；页面重装载重放当前目标属正常。
  // facet 缺席 = 不消费定位，页面其余功能完整（降级形态）。

  /** 当前高亮节点（data-located + 样式类；全局单高亮，换目标先清旧） */
  let locatedMark: HTMLElement | null = null
  /** 排队中的定位目标（首开回放时序：首次渲染未结算先排队，结算后补投） */
  let queuedLocate: AddonSettingsLocateTarget | null = null
  let hasQueuedLocate = false
  /** 首次渲染是否结算（首次 refreshSettings 调用完毕——get 成败皆算，
   *  失败时行以默认形态在场；此后到达的目标立即交付） */
  let firstRenderSettled = false

  function clearLocatedMark(): void {
    if (locatedMark === null) return
    locatedMark.removeAttribute('data-located')
    locatedMark.classList.remove(`${CLS}-located`)
    locatedMark = null
  }

  /** 目标 → DOM 锚点（def = 设置行；group = 组首卡片）；未知键返回 null
   *  （静默降级：不报错、不排队——与平台注册 keys 同空间的外来输入；
   *  def 路径先判行在场再算 Tab，组路由缺口经 settingKeyToTabId 判空吸收，
   *  不让抛错形态触达平台回调——审查轮 P2-5） */
  function findLocateAnchor(target: AddonSettingsLocateTarget): { tabId: SettingsTabId; element: HTMLElement } | null {
    if (target.kind === 'def') {
      const entry = rows.get(target.key)
      if (!entry) return null
      const tabId = settingKeyToTabId(target.key, defs)
      if (!tabId) return null
      return { tabId, element: entry.row }
    }
    const card = groupKeyToCardAnchor(target.key, defs)
    if (!card) return null
    const cardEl = root.querySelector<HTMLElement>(`[data-vet-card="${card.cardKey}"]`)
    if (!cardEl) return null
    return { tabId: card.tabId, element: cardEl }
  }

  function applyLocateTarget(target: AddonSettingsLocateTarget): void {
    const anchor = findLocateAnchor(target)
    if (!anchor) return
    // 搜索定位是确定导航：切页经 selectTab（置位 claimed + 上送 view-state）
    selectTab(anchor.tabId)
    clearLocatedMark()
    anchor.element.setAttribute('data-located', `${target.kind}:${target.key}`)
    anchor.element.classList.add(`${CLS}-located`)
    locatedMark = anchor.element
    // 真实浏览器滚动进可视区；jsdom 无实现，可选调用防御（对齐 rulesUi 惯例）
    anchor.element.scrollIntoView?.({ block: 'nearest' })
  }

  /** 首次渲染结算：补投排队目标（排队期间收到 null 已被丢弃则无操作） */
  function settleFirstRender(): void {
    if (firstRenderSettled) return
    firstRenderSettled = true
    if (!hasQueuedLocate || disposed) return
    hasQueuedLocate = false
    const target = queuedLocate
    queuedLocate = null
    if (target) applyLocateTarget(target)
  }

  function handleLocateTarget(target: AddonSettingsLocateTarget | null): void {
    if (disposed) return
    if (target === null) {
      // null = 清除：丢弃排队目标并清除既有高亮
      hasQueuedLocate = false
      queuedLocate = null
      clearLocatedMark()
      return
    }
    if (!firstRenderSettled) {
      // 首开回放早于首次渲染（get 未返回）：先排队，渲染结算后补投——
      // 避免高亮/滚动落在值尚未应用的行上，也避免目标丢失
      hasQueuedLocate = true
      queuedLocate = target
      return
    }
    applyLocateTarget(target)
  }

  const unsubscribeLocate = scopeFacet ? scopeFacet.onLocateTarget(handleLocateTarget) : null
  // 装配初值拉取（订阅回放之外的双保险；与回放重复到达由幂等吸收）
  if (scopeFacet) handleLocateTarget(scopeFacet.locateTarget())

  /** 来源徽章显隐（写后/清除后/作用域切换后的重拉统一走此处）：仅
   *  facet 在场且 sources[key] === 'workspace' 的行呈现徽章与清除入口。
   *  hasWorkspace === false 时平台快照不会出现 workspace 来源（工作区层
   *  不可用），入口自然不出现；写入/清除遭 no-workspace 拒绝经状态行兜底。
   *  用户层视角（审查轮 R2-P2-1 过渡处置）：scope=user 的覆盖行另呈合并值
   *  提示——SDK get() 仅合并语义，用户层原值按层读取待 ONEGAYI/vsidian#590 */
  function applySources(): void {
    const scopeUiEnabled = scopeFacet !== undefined
    const viewingUserScope = scopeFacet !== undefined && scopeFacet.scopeState().scope === 'user'
    for (const entry of rows.values()) {
      const overridden = scopeUiEnabled && currentSources[entry.def.key] === 'workspace'
      entry.badge.hidden = !overridden
      entry.clearBtn.hidden = !overridden
      entry.mergedHint.hidden = !(viewingUserScope && overridden && currentUserValues === undefined)
    }
  }

  /** 进入失败态（审查轮 R2-P2-2）：横幅 + 状态行提示 + 全部设置行禁用
   *  （未读到的值不当已保存值编辑；规则分区走独立通道不受影响） */
  function enterLoadFailedState(): void {
    if (settingsLoadFailed || disposed) return
    settingsLoadFailed = true
    loadError.hidden = false
    showStatus('failed', t.loadFailedText)
    for (const entry of rows.values()) {
      setRowDisabled(entry, true, t.loadFailedRowHint)
    }
  }

  /** 退出失败态：横幅隐藏 + 全行恢复可编辑（联动紧随其后接管禁用语义）。
   *  状态行残留清理（PR #59 复审 P3）：仅当当前文本仍等于本次失败提示
   *  文案（未被规则通道等较新消息覆盖）时立即清除并取消计时——不无条件
   *  清空共享状态行（会抹掉规则通道较新的提示） */
  function exitLoadFailedState(): void {
    settingsLoadFailed = false
    loadError.hidden = true
    if (status.textContent === t.loadFailedText) {
      if (statusTimer !== null) cancel(statusTimer)
      statusTimer = null
      status.textContent = ''
      status.setAttribute('data-vet-status', '')
    }
    for (const entry of rows.values()) {
      setRowDisabled(entry, false, null)
    }
  }

  /** 重拉发起序（到达序令牌，审查轮 P2-3）：结算时只应用最新一笔——
   *  跨笔乱序回包（旧 get 迟到）不覆盖新快照 */
  let refreshSeq = 0
  /** 待强制回滚键集合（审查轮 R1-B1 引入单槽、R2-P3-5 扩为集合）：写/
   *  清除失败对账——失败的重拉必须对该键穿透聚焦草稿保护；集合由真正
   *  结算的刷新（未被序号弃置、走到应用循环的那笔）统一消费并清空，
   *  弃置/异常/提前 return 不消费、留待下一笔结算兜底。集合语义堵住单槽
   *  反例：A、B 先后失败且 A 聚焦时，旧槽被 B 覆盖 + 聚焦保护使 A 漏回滚
   *  （「change 伴随焦点转移」不保证「异步对账时焦点在别处」） */
  const pendingForceRollbackKeys = new Set<string>()

  async function refreshSettings(): Promise<void> {
    const seq = ++refreshSeq
    try {
      let outcome: Awaited<ReturnType<SettingsChannelLike['request']>>
      try {
        outcome = await options.channel.request(SETTINGS_TOPIC.get, null)
      } catch {
        // 通道异常：首读失败进失败态（横幅 + 重试 + 行禁用，R2-P2-2）；已
        // 成功读取后保持上次值（静默语义）；debugLog 留痕（R1-B4）
        debugLog('settings get channel error — refresh dropped, controls keep last state')
        if (!settingsLoaded) enterLoadFailedState()
        return
      }
      if (disposed) return
      if (outcome.ok !== true) {
        // 同上：拒绝路径与异常同口径
        debugLog('settings get rejected:', outcome.reason ?? 'unknown')
        if (!settingsLoaded) enterLoadFailedState()
        return
      }
      if (seq !== refreshSeq) return // 本笔挂起期间有更新刷新发起：陈旧快照弃置
      const snapshot = outcome.result as { effective?: unknown; sources?: unknown } | null
      const effective = snapshot?.effective
      if (effective === null || typeof effective !== 'object') {
        // 快照形状非法：与失败同口径（首读时行保持默认值 + 失败态）
        if (!settingsLoaded) enterLoadFailedState()
        return
      }
      const isFirstSnapshot = !settingsLoaded
      settingsLoaded = true
      exitLoadFailedState()
      currentValues = effective as Readonly<Record<string, unknown>>
      const sources = snapshot?.sources
      currentSources = sources !== null && typeof sources === 'object' ? (sources as Readonly<Record<string, string>>) : {}
      // #60 层值解析：userValues 为对象才采用（缺席/非法 → undefined 降级）
      const layeredRaw = (snapshot as { userValues?: unknown } | null)?.userValues
      currentUserValues = layeredRaw !== null && typeof layeredRaw === 'object' ? (layeredRaw as Readonly<Record<string, unknown>>) : undefined
      for (const entry of rows.values()) {
        // 首个有效快照强制回填（PR #59 复审 P2）：首读前行全程禁用无合法
        // 草稿，聚焦保护不适用——防「仅聚焦（无真实草稿）」挡存储真值回填；
        // 显示值经 displayValueOf 按选中层计算（#60）
        applyValue(entry, displayValueOf(entry.def.key, entry.def.default), isFirstSnapshot || pendingForceRollbackKeys.has(entry.def.key))
      }
      pendingForceRollbackKeys.clear() // 失败对账强制回滚一次性消费（结算笔清空集合）
      applyLinkage()
      applySources()
    } finally {
      // 首次渲染结算（get 结束——成败皆算）：补投排队中的定位目标
      settleFirstRender()
    }
  }

  /** 清除工作区覆盖（恢复继承用户默认值，非恢复出厂）；清除后重拉 */
  async function clearOverride(key: string): Promise<void> {
    let outcome: Awaited<ReturnType<SettingsChannelLike['request']>>
    try {
      outcome = await options.channel.request(SETTINGS_TOPIC.clearOverride, { key })
    } catch {
      // 失败对账：重拉时对该键强制回滚（穿透聚焦草稿保护，R1-B1/R2-P3-5 集合）
      pendingForceRollbackKeys.add(key)
      if (!disposed) showStatus('failed', `${t.statusClearOverrideFailed}：io-failed`)
      await refreshSettings()
      return
    }
    if (disposed) return
    if (outcome.ok !== true) {
      pendingForceRollbackKeys.add(key)
      showStatus('failed', `${t.statusClearOverrideFailed}：${outcome.reason ?? 'rejected'}`)
    } else {
      const inner = outcome.result as { ok?: boolean; reason?: string } | null
      if (inner?.ok === false) {
        pendingForceRollbackKeys.add(key)
        showStatus('failed', `${t.statusClearOverrideFailed}：${inner.reason ?? 'store-write-failed'}`)
      } else {
        showStatus('success', t.statusOverrideCleared)
      }
    }
    // 清除后重拉（徽章消失 + effective 回退用户层；失败时保持原状）
    await refreshSettings()
  }

  async function write(key: string, value: unknown): Promise<void> {
    // 首读完成前忽略任何写入（PR #59 复审 P2 防御深度）：装载窗口/失败态
    // 行已禁用，此处兜底程序化 change 等边缘路径——此刻显示的是定义默认值
    // 而非存储真值，写入即以未知默认值覆盖已存配置
    if (!settingsLoaded) return
    let outcome: Awaited<ReturnType<SettingsChannelLike['request']>>
    try {
      outcome = await options.channel.request(SETTINGS_TOPIC.update, { scope: writeScope(), patch: { [key]: value } })
    } catch {
      // 失败对账：重拉时对该键强制回滚（穿透聚焦草稿保护，R1-B1/R2-P3-5 集合）
      pendingForceRollbackKeys.add(key)
      if (!disposed) showStatus('failed', `${t.statusUpdateFailed}：io-failed`)
      await refreshSettings()
      return
    }
    if (disposed) return
    if (outcome.ok !== true) {
      pendingForceRollbackKeys.add(key)
      showStatus('failed', `${t.statusUpdateFailed}：${outcome.reason ?? 'rejected'}`)
    } else {
      const inner = outcome.result as { ok?: boolean; reason?: string } | null
      if (inner?.ok === false) {
        pendingForceRollbackKeys.add(key)
        showStatus('failed', `${t.statusUpdateFailed}：${inner.reason ?? 'store-write-failed'}`)
      }
    }
    // 写后重拉刷新（成功同步存储真值，失败把控件拉回；决策 12）
    await refreshSettings()
  }

  // ===== 规则四分区挂入（hosts 模式；页面级状态行共享） =====

  const rulesClient = new RulesSettingsClient({ channel: options.channel })
  const rulesView: RulesSettingsViewHandle = mountRulesSettingsView(root, {
    client: rulesClient,
    messages: m,
    doc,
    setTimeout: schedule,
    clearTimeout: cancel,
    behaviorState: options.behaviorState,
    hosts: {
      user: userHost,
      builtin: builtinHost,
      spacing: spacingHost,
      storage: storageHost,
      status,
      // 状态提示上交页面单计时器（审查轮 P2-1）：规则分区提示与设置写入
      // 提示共用状态行时由页面统一持有自动清除计时，互不提前清除
      statusSink: showStatus,
    },
  })

  const initialSettingsRefresh = refreshSettings()

  // view-state 恢复（#63）：mount 后拉宿主会话级 Tab 浏览位置与滚动偏移。
  // 先同步渲染默认 Tab、回包后切换（本地通道毫秒级，用户无感）；回包 tab 经
  // SETTINGS_TAB_IDS 合法性校验（非法/缺席保持默认），通道失败静默；回包
  // 前已有确定导航（viewStateClaimed，见 selectTab）则放弃恢复；dispose 后
  // 迟到的回包无操作。恢复切换不上送（值本就来自宿主侧，无回写必要）。
  // 滚动偏移在**真实内容起高后**回放（R1 审查 001）：等待「首帧设置刷新 +
  // 规则分区初始装载」双信号（规则列表是页面内异步起高的主要分区——
  // view-state 回包快于规则文件读取时，单帧回放会被未起高的内容钳掉），
  // 再经 rAF 等布局落地（jsdom 无 rAF 时定时器回退）。Tab 恢复不发生时
  // （如宿主记忆 tab 即默认）同样应用——离开时停在默认 Tab 中部也属浏览
  // 进度；超出内容高度由浏览器自然钳制。回放前校验归属（R1 审查 002）：
  // 等待期间组件已离开共享主区（平台切分页移出 DOM）则不写共享容器。
  void options.channel
    .request(VIEW_STATE_TOPIC.get, null)
    .then((outcome) => {
      if (disposed || viewStateClaimed || outcome.ok !== true) return
      const result = outcome.result as { tab?: unknown; scroll?: unknown } | null
      const tab = result?.tab
      if (typeof tab !== 'string' || !(SETTINGS_TAB_IDS as readonly string[]).includes(tab)) return
      if (tab !== active) activateTab(tab as SettingsTabId)
      if (typeof result?.scroll === 'number' && Number.isFinite(result.scroll) && result.scroll > 0) {
        const offset = result.scroll
        void Promise.all([initialSettingsRefresh, rulesView.ready]).then(() => {
          const applyScroll = (): void => {
            // 再次校验：等待与帧回调之间用户可能抢先导航（claimed）、组件
            // 可能已离开共享主区（归属）或已释放（disposed）
            if (!disposed && !viewStateClaimed && ownsScroll()) scrollEl.scrollTop = offset
          }
          if (typeof doc.defaultView?.requestAnimationFrame === 'function') {
            doc.defaultView.requestAnimationFrame(applyScroll)
          } else {
            schedule(applyScroll, 0)
          }
        })
      }
    })
    .catch(() => {
      // 通道异常静默（恢复尽力而为，保持默认 Tab）
    })

  /** 就地切换语言（#58：SDK locale 通知驱动）。控件显示值（含未提交草稿）
   *  与活动 Tab 不动；definitions 按新字典重建（title/description 换语言，
   *  键集/默认值/枚举值结构不变），联动与失败态行级提示按新文案重放。
   *  状态行残留的旧语言提示为 6s 瞬态，随既有计时清除（不追改）。规则
   *  分区（含在场编辑浮层）委托 rulesView.setLanguage。 */
  function setLanguage(language: string): void {
    if (disposed) return
    m = pickMessages(language)
    t = m.settingsTabs
    localeTag = localeTagFor(language)
    defs = buildSettingDefinitions(m)
    defByKey = new Map(defs.map((def) => [def.key, def]))
    heroTitle.textContent = t.heroTitle
    heroSourceLabel.textContent = t.heroSourceLabel
    heroLink.textContent = t.heroLinkText
    loadErrorText.textContent = t.loadFailedText
    loadErrorRetry.textContent = t.loadFailedRetry
    for (const [id, btn] of tabButtons) btn.textContent = t.tabs[TAB_LABEL_KEY[id]]
    // 卡片分区标题挂载期一次性创建（buildCard），切换语言时按 cardKey 补刷
    for (const card of root.querySelectorAll(`[data-vet-card]`)) {
      const cardKey = card.getAttribute('data-vet-card') as SettingsCardKey | null
      const title = card.querySelector<HTMLElement>(`.${CLS}-section-title`)
      if (cardKey !== null && title !== null) title.textContent = t.cards[cardKey]
    }
    for (const entry of rows.values()) {
      const nextDef = defByKey.get(entry.def.key)
      if (!nextDef) continue // 键集由契约测试钉死；此处防御跳过缺位
      entry.def = nextDef
      const nameSpan = entry.row.querySelector<HTMLElement>(`.${CLS}-setting-name`)
      if (nameSpan !== null) nameSpan.textContent = nextDef.title
      const descSpan = entry.row.querySelector<HTMLElement>(`.${CLS}-setting-desc`)
      if (descSpan !== null) descSpan.textContent = nextDef.description ?? ''
      entry.badge.textContent = t.badgeWorkspaceOverride
      entry.clearBtn.textContent = t.clearOverrideAction
      entry.clearBtn.title = t.clearOverrideTitle
      entry.clearBtn.setAttribute('aria-label', t.clearOverrideTitle)
      entry.mergedHint.textContent = t.mergedValueHint
      if (entry.control instanceof HTMLSelectElement) {
        for (const option of Array.from(entry.control.options)) {
          option.textContent = enumLabelText(nextDef, option.value, localeTag)
        }
      }
    }
    for (const note of root.querySelectorAll(`[data-vet-rules-scope]`)) {
      note.textContent = t.rulesScopeNote
    }
    for (const note of root.querySelectorAll(`[data-vet-spacing-scope]`)) {
      note.textContent = t.spacingScopeNote
    }
    if (settingsLoadFailed) {
      for (const entry of rows.values()) setRowDisabled(entry, true, t.loadFailedRowHint)
    } else {
      applyLinkage()
    }
    rulesView.setLanguage(language)
  }

  return {
    switchTab(tabId: SettingsTabId): void {
      if (!SETTINGS_TAB_IDS.includes(tabId)) throw new Error(`未知设置页 Tab：${tabId}`)
      selectTab(tabId)
    },
    activeTab(): SettingsTabId {
      return active
    },
    setLanguage,
    refreshSettings,
    dispose(): void {
      disposed = true
      // view-state 滚动接入清理（#63 扩展）：捕获监听与节流定时器随页面
      // 释放（dispose 后位移不再入账；迟到的回放回调经 disposed 守卫跳过）
      doc.removeEventListener('scroll', onAnyScroll, { capture: true } as EventListenerOptions)
      if (scrollPushTimer !== null) cancel(scrollPushTimer)
      scrollPushTimer = null
      if (statusTimer !== null) cancel(statusTimer)
      statusTimer = null
      unsubscribeScope?.()
      unsubscribeLocate?.()
      locatedMark = null
      rulesView.dispose()
      root.textContent = ''
      root.classList.remove(`${CLS}-root`)
      root.removeAttribute('data-vet-page')
    },
  }
}
