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
// 【Tab 态】内存保存，默认编辑增强，页面卸载即复位（决策 5/6）。
// switchTab 为受控切换 API（外部驱动面）；搜索定位经内部 activateTab
// 同一受控路径切页。
import type { Messages } from './i18n'
import type { AddonSettingDefinition } from '../types/vendor/shared/addonSettings'
import type { AddonSettingsLocateTarget, AddonSettingsScopeSnapshot } from '../types/vendor/shared/addonSettingsContextApi'
import { buildSettingDefinitions } from './settings/definitions'
import { SETTINGS_TOPIC } from './settings/store'
import { mountRulesSettingsView, type RulesBehaviorStateLike, type RulesSettingsViewHandle } from './rulesUi'
import { RulesSettingsClient } from './rules/rules-settings-client'
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TAB_IDS,
  cardsForTab,
  groupKeyToCardAnchor,
  settingKeyToTabId,
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
  /** 枚举档位双语映射的取值标签（i18n.localeTagFor(navigator.language)） */
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
  /** 重拉 SETTINGS_TOPIC.get 并刷新控件与联动（重复调用无害） */
  refreshSettings(): Promise<void>
  /** 释放：规则分区、状态计时器与页面 DOM */
  dispose(): void
}

/** 状态行自动清除延迟（对齐 rulesUi 既有节奏） */
const STATUS_AUTO_CLEAR_MS = 6000

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
}

export function mountSettingsPage(root: HTMLElement, options: SettingsPageViewOptions): SettingsPageViewHandle {
  const doc = options.doc ?? document
  const m = options.messages
  const t = m.settingsTabs
  const localeTag = options.localeTag
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]))
  let disposed = false
  let statusTimer: unknown = null
  let active: SettingsTabId = DEFAULT_SETTINGS_TAB
  /** effective 快照（get 返回；写后重拉替换） */
  let currentValues: Readonly<Record<string, unknown>> = {}
  /** sources 快照（get 返回的来源分层 default/user/workspace；徽章驱动） */
  let currentSources: Readonly<Record<string, string>> = {}

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
  const defs = buildSettingDefinitions(m)
  const defByKey = new Map(defs.map((def) => [def.key, def]))
  const rows = new Map<string, SettingRowEntry>()
  /** 自动格式化 Tab 下游行（联动置灰对象；主控键除外） */
  const masterDownstreamKeys = cardsForTab('auto-format')
    .flatMap((card) => [...card.settingKeys])
    .filter((key) => key !== MASTER_KEY)

  // ===== 静态骨架：hero / tablist / 状态行 / 面板容器 =====

  root.classList.add(`${CLS}-root`)
  root.setAttribute('data-vet-page', 'settings')

  const hero = el('div', `${CLS}-settings-hero`)
  hero.setAttribute('data-vet-hero', '')
  const heroTitle = el('h1', `${CLS}-settings-hero-title`, t.heroTitle)
  const heroMeta = el('div', `${CLS}-settings-hero-meta`)
  heroMeta.append(el('span', `${CLS}-settings-hero-label`, t.heroSourceLabel))
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

  const panelsWrap = el('div', `${CLS}-settings-panels`)
  root.append(hero, nav, status, panelsWrap)

  function showStatus(kind: 'info' | 'failed' | 'success', text: string): void {
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
    btn.addEventListener('click', () => activateTab(tabId))
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
      activateTab(SETTINGS_TAB_IDS[target], true)
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

  function enumLabelText(def: AddonSettingDefinition, value: string): string {
    if (def.type !== 'string') return value
    const label = def.enumLabels?.[value]
    // LocalizedText = 直值或多语言映射（vendor 形状；缺失键回退枚举值本身）
    if (label !== undefined && typeof label !== 'string') {
      const picked = label[localeTag]
      if (typeof picked === 'string') return picked
    }
    return value
  }

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

  function applyValue(entry: SettingRowEntry, raw: unknown): void {
    const { def, control } = entry
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
   *  下游行置灰；userDefinedRegExp 再受正则开关二级联动 */
  function applyLinkage(): void {
    const masterOn = currentValues[MASTER_KEY] !== false
    const regSwitchOn = currentValues[REGEXP_SWITCH_KEY] !== false
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
    nameLine.append(el('span', `${CLS}-setting-name`, def.title))
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
    nameLine.append(badge, clearBtn)
    info.append(nameLine)
    if (def.description !== undefined) info.append(el('div', `${CLS}-setting-desc`, def.description))
    row.append(info)
    const controlWrap = el('div', `${CLS}-setting-control`)
    let control: SettingRowEntry['control']
    if (def.type === 'boolean') {
      const label = el('label', `${CLS}-toggle`)
      const input = el('input') as HTMLInputElement
      input.type = 'checkbox'
      input.setAttribute('aria-label', def.title)
      control = input
      label.append(input)
      controlWrap.append(label)
    } else if (def.type === 'string' && def.enum) {
      const select = el('select', `${CLS}-select`) as HTMLSelectElement
      for (const value of def.enum) {
        const option = el('option', undefined, enumLabelText(def, value)) as HTMLOptionElement
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
    row.append(controlWrap)
    // 写入触发 = change（失焦/回车），非逐键——避免通道风暴
    control.addEventListener('change', () => {
      void write(def.key, readControlValue(def, control))
    })
    rows.set(def.key, { def, row, control, badge, clearBtn })
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
          // 语言间空格策略分区（rulesUi spacing）随上游排在总开关卡之后
          if (card.cardKey === 'autoFormat') panelEl.append(spacingHost)
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
   *  （静默降级：不报错、不排队——与平台注册 keys 同空间的外来输入） */
  function findLocateAnchor(target: AddonSettingsLocateTarget): { tabId: SettingsTabId; element: HTMLElement } | null {
    if (target.kind === 'def') {
      const entry = rows.get(target.key)
      const tabId = settingKeyToTabId(target.key, defs)
      if (!entry || !tabId) return null
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
    activateTab(anchor.tabId)
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
   *  不可用），入口自然不出现；写入/清除遭 no-workspace 拒绝经状态行兜底 */
  function applySources(): void {
    const scopeUiEnabled = scopeFacet !== undefined
    for (const entry of rows.values()) {
      const overridden = scopeUiEnabled && currentSources[entry.def.key] === 'workspace'
      entry.badge.hidden = !overridden
      entry.clearBtn.hidden = !overridden
    }
  }

  async function refreshSettings(): Promise<void> {
    try {
      let outcome: Awaited<ReturnType<SettingsChannelLike['request']>>
      try {
        outcome = await options.channel.request(SETTINGS_TOPIC.get, null)
      } catch {
        return // 通道异常静默（初值回落默认；后续写入失败有状态行提示面）
      }
      if (disposed || outcome.ok !== true) return
      const snapshot = outcome.result as { effective?: unknown; sources?: unknown } | null
      const effective = snapshot?.effective
      if (effective === null || typeof effective !== 'object') return
      currentValues = effective as Readonly<Record<string, unknown>>
      const sources = snapshot?.sources
      currentSources = sources !== null && typeof sources === 'object' ? (sources as Readonly<Record<string, string>>) : {}
      for (const entry of rows.values()) {
        applyValue(entry, currentValues[entry.def.key] ?? entry.def.default)
      }
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
      if (!disposed) showStatus('failed', `${t.statusClearOverrideFailed}：io-failed`)
      await refreshSettings()
      return
    }
    if (disposed) return
    if (outcome.ok !== true) {
      showStatus('failed', `${t.statusClearOverrideFailed}：${outcome.reason ?? 'rejected'}`)
    } else {
      const inner = outcome.result as { ok?: boolean; reason?: string } | null
      if (inner?.ok === false) {
        showStatus('failed', `${t.statusClearOverrideFailed}：${inner.reason ?? 'store-write-failed'}`)
      } else {
        showStatus('success', t.statusOverrideCleared)
      }
    }
    // 清除后重拉（徽章消失 + effective 回退用户层；失败时保持原状）
    await refreshSettings()
  }

  async function write(key: string, value: unknown): Promise<void> {
    let outcome: Awaited<ReturnType<SettingsChannelLike['request']>>
    try {
      outcome = await options.channel.request(SETTINGS_TOPIC.update, { scope: writeScope(), patch: { [key]: value } })
    } catch {
      if (!disposed) showStatus('failed', `${t.statusUpdateFailed}：io-failed`)
      await refreshSettings()
      return
    }
    if (disposed) return
    if (outcome.ok !== true) {
      showStatus('failed', `${t.statusUpdateFailed}：${outcome.reason ?? 'rejected'}`)
    } else {
      const inner = outcome.result as { ok?: boolean; reason?: string } | null
      if (inner?.ok === false) showStatus('failed', `${t.statusUpdateFailed}：${inner.reason ?? 'store-write-failed'}`)
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
    },
  })

  void refreshSettings()

  return {
    switchTab(tabId: SettingsTabId): void {
      if (!SETTINGS_TAB_IDS.includes(tabId)) throw new Error(`未知设置页 Tab：${tabId}`)
      activateTab(tabId)
    },
    activeTab(): SettingsTabId {
      return active
    },
    refreshSettings,
    dispose(): void {
      disposed = true
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
