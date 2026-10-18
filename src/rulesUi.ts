// 规则管理设置页视图层（工单 #16）：mountRoot 内自绘 DOM——规则列表
// （用户组 + 内置组 + 已停用内置组）、启用开关（用户规则）、编辑表单浮层
// （类型/触发方式/正则/替换体/作用域/优先级/描述 + 规则测试编辑器）、
// 拖拽排序（用户规则）、JSON 导入导出、内置规则恢复默认与全部重置。
//
// 【分层】数据面全部经 RulesSettingsClient（写后刷新驱动本视图重渲染，
// UI 不直改文件）；表单换算/试运行/词法器复用 src/rules/rules-ui-model.ts
// 纯函数。本模块只做 DOM 组装与事件接线，零 SDK 依赖（入口
// src/page-settings.ts 注入 sdk.channel 与语言包），jsdom 冒烟承载交互。
//
// 【内置规则边界（#1/#3 口径）】逐条启用开关走平台「行为冲突管理」不在此
// 页；本页对内置规则只提供停用（deleteBuiltinRule → deletedBuiltinRuleIds）
// 与恢复/重置入口，页头给引导文案。函数替换体（F 旗标）#17 解锁为预注册
// 函数引用选择（ref 下拉 + 函数源码只读展示；函数本体编辑不在规则 JSON，
// 自定义走组件化 fork，提示文案引导）。
import { pickMessages, type Messages } from './i18n'
import { RuleEngine, RuleScope, RuleTriggerMode, RuleType, type SimpleRule } from './rules/rule-engine'
import { coveringBehaviorLocalIds } from './rules/rule-family-ids'
import { DEFAULT_BUILTIN_RULES } from './rules/default-rules'
import type { StoredLanguagePair } from './rules/rule-store'
import { BUILTIN_CATEGORIES } from './formatting/scriptCategory'
import { FUNCTION_TABLE_BY_REF, signatureKindForRuleType, type FunctionTableEntry } from './rules/function-table'
import { RulesSettingsClient } from './rules/rules-settings-client'
import {
  buildSimpleRuleFromForm,
  computeDropIndex,
  defaultRuleFormModel,
  firstFunctionRefForType,
  formModelFromSimpleRule,
  functionRefValidForType,
  previewRuleText,
  testSingleRule,
  toggleFormScope,
  tokenizeJs,
  validateRuleForm,
  type RuleFormModel,
} from './rules/rules-ui-model'

/** scoped 类前缀（自绘边界：所有类名带前缀，不污染设置框架） */
const CLS = 'vsidian-easy-typing'

export interface RulesSettingsViewOptions {
  client: RulesSettingsClient
  messages: Messages
  /** Document 注入（缺省全局 document；jsdom 冒烟用） */
  doc?: Document
  /** 计时器注入（状态行自动清除；缺省全局 setTimeout/clearTimeout） */
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  /** 宿主行为禁用态只读面（#50 灰态；结构对齐 vendor AddonBehaviorStateFacet，
   *  入口注入便于测试。undefined = 面缺席（旧平台），不灰显） */
  behaviorState?: RulesBehaviorStateLike
  /** 分区挂载宿主（#55 五 Tab 设置页；缺省 = 既有单页形态） */
  hosts?: RulesSettingsViewHosts
}

/** hosts 模式挂载宿主（#55 五 Tab 自绘设置页）：四分区 / 状态行 / 编辑
 * 浮层挂到宿主页面提供的容器，页标题与简介不再渲染（五 Tab 页面自带
 * hero 形态），root 身份（class / data-vet-page）归宿主页面。分区 DOM
 * 结构与交互两种模式完全一致，只是挂载位置不同。 */
export interface RulesSettingsViewHosts {
  /** 用户规则分区宿主（「自定义规则」panel） */
  user?: HTMLElement
  /** 内置规则分区宿主（「内置规则」panel） */
  builtin?: HTMLElement
  /** 语言间空格策略分区宿主（「自动格式化」panel 内） */
  spacing?: HTMLElement
  /** 数据目录展示分区宿主（「其他设置」panel 内） */
  storage?: HTMLElement
  /** 状态行宿主（页面级共享状态行；不传则自建并挂 root）。与 statusSink
   *  并传时仅作元素占位（写入与计时全走 sink） */
  status?: HTMLElement
  /** 状态提示上交口（审查轮 P2-1 推荐形态）：在场时本视图的状态提示经此
   *  上交宿主页面的状态行实现（含自动清除计时）——共享元素两侧各持计时器
   *  会互相提前清除后到提示；本地不持计时器。缺省路径（自持元素+计时器）
   *  行为不变 */
  statusSink?: (kind: 'info' | 'failed' | 'success', text: string) => void
  /** 编辑浮层宿主（不传挂 root 末位；fixed 定位与宿主位置无关）。对称
   *  API 暂无消费方（页面形态浮层挂 root 即可），保留字段供后续宿主定制 */
  overlay?: HTMLElement
}

/** 行为禁用态只读面的消费形状（#50；与 vendor AddonBehaviorStateFacet
 *  同构的本地结构——视图层保持零 SDK 依赖，入口负责把 sdk.behaviorState
 *  传入，jsdom 测试注入 mock） */
export interface RulesBehaviorStateLike {
  enabledState(): { addonRunState: string; disabled: readonly string[] }
  onEnabledChange(
    callback: (state: { addonRunState: string; disabled: readonly string[] }) => void,
  ): () => void
}

export interface RulesSettingsViewHandle {
  /** 触发一次数据装载（装载失败走状态行；重复调用无害） */
  reload(): Promise<void>
  /** 就地切换语言（#58：SDK locale 通知驱动；语言映射经 pickMessages）：
   *  重建四分区与在场编辑浮层，选中态/表单模型/测试编辑器内容/焦点保全 */
  setLanguage(language: string): void
  /** 释放：清计时器与 DOM（sdk.onDispose 时调用） */
  dispose(): void
}

/** 状态行自动清除延迟 */
const STATUS_AUTO_CLEAR_MS = 6000

function classes(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ')
}

export function mountRulesSettingsView(
  root: HTMLElement,
  options: RulesSettingsViewOptions,
): RulesSettingsViewHandle {
  const doc = options.doc ?? document
  // 语言态可变（#58 setLanguage 就地切换）：m/t 为 let，全部渲染路径读
  // 当前引用——分区渲染函数每次调用重建文案，闭包内不缓存派生文案
  let m = options.messages
  let t = m.rulesPage
  const client = options.client
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]))
  let disposed = false
  let statusTimer: unknown = null
  let dragSourceIndex: number | null = null
  let cachedMidY = 0
  /** 用户规则选中行 id（#48 头部上移/下移的操作目标；写后刷新跨渲染保持） */
  let selectedUserRuleId: string | null = null
  /** 移动动作后置位：下次渲染时把选中行滚入视野（一次性消费） */
  let pendingScrollToSelected = false
  /** 宿主层禁用态视图（#50 两层口径的呈现输入；behaviorState 缺席时恒空） */
  let hostDisabledBehaviors = new Set<string>()
  let hostAddonDisabled = false

  /** 宿主层灰态判定（ADR-0016：灰态只归宿主层——组件停用或覆盖族全部被
   *  单项禁用；返回 tooltip 文案，null = 不灰） */
  function hostDisabledTooltipFor(rule: SimpleRule, isBuiltin: boolean): string | null {
    if (!options.behaviorState) return null
    if (hostAddonDisabled) return t.hostDisabled.addonDisabledTooltip
    const covering = coveringBehaviorLocalIds(rule, isBuiltin)
    if (covering.length > 0 && covering.every((id) => hostDisabledBehaviors.has(id))) {
      return t.hostDisabled.behaviorDisabledTooltip
    }
    return null
  }

  /** 条目应用宿主层灰态（data 标记 + tooltip；组件层开关不受影响——两层独立） */
  function applyHostDisabled(item: HTMLElement, rule: SimpleRule, isBuiltin: boolean): void {
    const tooltip = hostDisabledTooltipFor(rule, isBuiltin)
    if (tooltip === null) {
      item.removeAttribute('data-vet-host-disabled')
      item.removeAttribute('title')
      item.classList.remove(`${CLS}-rule-host-disabled`)
      return
    }
    item.classList.add(`${CLS}-rule-host-disabled`)
    item.setAttribute('data-vet-host-disabled', hostAddonDisabled ? 'addon' : 'behavior')
    item.title = tooltip
  }

  /** DOM 构造糖 */
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

  // ===== 静态骨架 =====
  // hosts 模式（#55）：四分区/状态行/浮层挂宿主容器、不渲染页标题与简介、
  // 不接管 root 身份；缺省保持既有单页形态（rules-ui 既有测试消费缺省路径，
  // 行为零变化）。

  const hosted = options.hosts !== undefined
  /** 自建并自持的节点（dispose 时逐一移除；hosts 模式不动 root） */
  const ownedNodes: HTMLElement[] = []
  if (!hosted) {
    root.classList.add(`${CLS}-root`)
    root.setAttribute('data-vet-page', 'rules')
    const title = el('h2', `${CLS}-page-title`, t.title)
    const intro = el('p', `${CLS}-page-intro`, t.intro)
    root.append(title, intro)
    ownedNodes.push(title, intro)
  }

  let status: HTMLElement
  if (options.hosts?.status) {
    status = options.hosts.status
  } else {
    status = el('div', `${CLS}-status`)
    status.setAttribute('data-vet-status', '')
    status.setAttribute('role', 'status')
    root.append(status)
    ownedNodes.push(status)
  }

  const userSection = el('section', `${CLS}-section`)
  userSection.setAttribute('data-vet-section', 'user')
  const builtinSection = el('section', `${CLS}-section`)
  builtinSection.setAttribute('data-vet-section', 'builtin')
  const spacingSection = el('section', `${CLS}-section`)
  spacingSection.setAttribute('data-vet-section', 'spacing')
  const storageSection = el('section', `${CLS}-section ${CLS}-storage`)
  storageSection.setAttribute('data-vet-section', 'storage')
  ;(options.hosts?.user ?? root).append(userSection)
  ;(options.hosts?.builtin ?? root).append(builtinSection)
  ;(options.hosts?.spacing ?? root).append(spacingSection)
  ;(options.hosts?.storage ?? root).append(storageSection)
  ownedNodes.push(userSection, builtinSection, spacingSection, storageSection)

  /** 模态浮层容器（编辑表单；常驻挂载末位，hidden 切换） */
  const overlay = el('div', classes(`${CLS}-modal`, `${CLS}-hidden`))
  overlay.setAttribute('data-vet-modal', '')
  ;(options.hosts?.overlay ?? root).append(overlay)
  ownedNodes.push(overlay)

  /** 状态行：kind = info/failed/success；6s 自动清除。hosts.statusSink
   *  在场时经 sink 上交（宿主页面单计时器，审查轮 P2-1），本地不持计时器 */
  const statusSink = options.hosts?.statusSink
  function showStatus(kind: 'info' | 'failed' | 'success', text: string): void {
    if (statusSink !== undefined) {
      statusSink(kind, text)
      return
    }
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

  function actionFailed(reason: string): void {
    showStatus('failed', `${t.status.actionFailed}：${reason}`)
  }

  /** mutate 失败处理：状态行报错 + 补一次整拉对账（写后刷新只在成功路径
   *  发生，失败时控件态与存储失配——审查轮 1 P2；对账刷新把控件拉回存储
   *  真值，load 失败时保持现状，通道故障已有其他提示面） */
  function handleActionOutcome(outcome: { ok: boolean; reason?: string }): void {
    if (outcome.ok) return
    actionFailed(outcome.reason ?? 'io-failed')
    void client.load()
  }

  // ===== 规则条目渲染 =====

  function typeMeta(rule: SimpleRule): { label: string; cls: string } {
    const opts = RuleEngine.parseOptions(rule.options)
    switch (opts.type) {
      case RuleType.Delete:
        return { label: t.ruleItem.typeDelete, cls: 'delete' }
      case RuleType.SelectKey:
        return { label: t.ruleItem.typeSelectKey, cls: 'selectkey' }
      default:
        return { label: t.ruleItem.typeInput, cls: 'input' }
    }
  }

  function buildTagRow(rule: SimpleRule): HTMLElement {
    const row = el('div', `${CLS}-rule-tags`)
    const type = typeMeta(rule)
    row.append(el('span', classes(`${CLS}-tag`, `${CLS}-tag-${type.cls}`), type.label))
    const opts = RuleEngine.parseOptions(rule.options)
    if (opts.scope.includes(RuleScope.Code)) {
      row.append(
        el('span', classes(`${CLS}-tag`, `${CLS}-tag-code`), `<${rule.scope_language || t.ruleItem.scopeCode}>`),
      )
    }
    if (opts.scope.includes(RuleScope.Formula)) {
      row.append(el('span', classes(`${CLS}-tag`, `${CLS}-tag-formula`), 'ƒx'))
    }
    if (opts.isFunctionReplacement) {
      row.append(el('span', classes(`${CLS}-tag`, `${CLS}-tag-fn`), t.ruleItem.fnTag))
    }
    row.append(el('span', `${CLS}-rule-preview`, previewRuleText(rule, m.builtinRuleDescriptions)))
    return row
  }

  function buildDragHandle(): HTMLElement {
    const handle = el('span', `${CLS}-drag-handle`)
    handle.textContent = '⋮⋮'
    handle.setAttribute('aria-hidden', 'true')
    handle.draggable = true
    return handle
  }

  /** 用户规则条目：拖拽手柄 + 标签行 + 开关/编辑/删除按钮 */
  function buildUserRuleItem(rule: SimpleRule, index: number): HTMLElement {
    const item = el('div', `${CLS}-rule-item`)
    item.setAttribute('data-vet-rule-id', rule.id ?? '')
    item.setAttribute('data-vet-rule-index', String(index))
    if (rule.enabled === false) item.classList.add(`${CLS}-rule-disabled`)
    if (selectedUserRuleId !== null && selectedUserRuleId === rule.id) {
      item.classList.add(`${CLS}-rule-selected`)
      item.setAttribute('data-vet-selected', 'true')
    }

    item.append(buildDragHandle())

    const main = el('div', `${CLS}-rule-main`)
    // 点击行主体选中（#48 上移/下移的操作目标；按钮/开关区不触发）
    main.classList.add(`${CLS}-rule-selectable`)
    main.addEventListener('click', () => {
      selectedUserRuleId = rule.id ?? null
      refreshSelectionUi()
    })
    main.append(buildTagRow(rule))
    const meta = el('div', `${CLS}-rule-meta`)
    if (RuleEngine.parseOptions(rule.options).type === RuleType.Input) {
      const isTab = (rule.options ?? '').includes('T')
      meta.append(
        el(
          'span',
          classes(`${CLS}-tag`, isTab ? `${CLS}-tag-tab` : `${CLS}-tag-auto`),
          isTab ? t.form.triggerModeTab : t.form.triggerModeAuto,
        ),
      )
    }
    if (meta.childElementCount > 0) main.append(meta)
    item.append(main)

    const toggleLabel = el('label', `${CLS}-toggle`)
    const toggle = el('input') as HTMLInputElement
    toggle.type = 'checkbox'
    toggle.checked = rule.enabled !== false
    toggle.setAttribute('data-vet-action', 'toggle')
    toggle.setAttribute('aria-label', t.ruleItem.enable)
    toggle.addEventListener('change', () => {
      void client.toggleUserRuleEnabled(rule.id ?? '', toggle.checked).then(handleActionOutcome)
    })
    toggleLabel.append(toggle)
    item.append(toggleLabel)

    const editBtn = el('button', `${CLS}-icon-btn`, t.ruleItem.edit)
    editBtn.type = 'button'
    editBtn.setAttribute('data-vet-action', 'edit')
    editBtn.setAttribute('aria-label', t.ruleItem.edit)
    editBtn.addEventListener('click', () => openEditForm(rule))
    item.append(editBtn)

    const removeBtn = el('button', `${CLS}-icon-btn ${CLS}-danger`, t.ruleItem.remove)
    removeBtn.type = 'button'
    removeBtn.setAttribute('data-vet-action', 'delete')
    removeBtn.setAttribute('aria-label', t.ruleItem.remove)
    removeBtn.addEventListener('click', () => {
      void client.deleteUserRule(rule.id ?? '').then(handleActionOutcome)
    })
    item.append(removeBtn)

    applyHostDisabled(item, rule, false)
    attachDragHandlers(item)
    return item
  }

  /** 内置规则条目（#50 回归逐条开关）：开关 = 组件层停用语义——
   *  关 → deleteBuiltinRule（移出规则表 + deletedBuiltinRuleIds 记账），
   *  在场但 enabled=false 的存量态打开 → toggleRuleEnabled 启用；
   *  宿主层禁用另呈灰态（两层独立，ADR-0016） */
  function buildBuiltinRuleItem(rule: SimpleRule): HTMLElement {
    const item = el('div', `${CLS}-rule-item`)
    item.setAttribute('data-vet-rule-id', rule.id ?? '')
    if (rule.enabled === false) item.classList.add(`${CLS}-rule-disabled`)
    const main = el('div', `${CLS}-rule-main`)
    main.append(buildTagRow(rule))
    item.append(main)
    item.append(buildBuiltinToggle(rule.id ?? '', rule.enabled !== false))
    applyHostDisabled(item, rule, true)
    return item
  }

  /** 已停用内置规则条目：出厂数据预览 + 开关（打开 = 恢复） */
  function buildDeletedRuleItem(id: string): HTMLElement | null {
    const defaultRule = findDefaultBuiltinRule(id)
    if (!defaultRule) return null
    const item = el('div', `${CLS}-rule-item ${CLS}-rule-deleted`)
    item.setAttribute('data-vet-rule-id', id)
    const main = el('div', `${CLS}-rule-main`)
    main.append(buildTagRow(defaultRule))
    item.append(main)
    item.append(buildBuiltinToggle(id, false))
    applyHostDisabled(item, defaultRule, true)
    return item
  }

  /** 内置规则开关（主列表与已停用折叠区共用形态；id 由调用方给出——
   *  折叠区条目的预览规则来自出厂数据，条目身份是 state 里的 id） */
  function buildBuiltinToggle(id: string, enabled: boolean): HTMLElement {
    const toggleLabel = el('label', `${CLS}-toggle`)
    const toggle = el('input') as HTMLInputElement
    toggle.type = 'checkbox'
    toggle.checked = enabled
    toggle.setAttribute('data-vet-action', 'toggle-builtin')
    toggle.setAttribute('aria-label', t.builtinRules.enable)
    toggle.addEventListener('change', () => {
      const outcome = toggle.checked
        ? // 打开：在场（罕见 enabled=false 存量）走启用通道；已停用走恢复
          client.state.deletedBuiltinRuleIds.includes(id)
          ? client.restoreBuiltinRule(id)
          : client.toggleBuiltinRuleEnabled(id, true)
        : // 关闭：组件层停用（deleteBuiltinRule → deletedBuiltinRuleIds）
          client.disableBuiltinRule(id)
      void outcome.then(handleActionOutcome)
    })
    toggleLabel.append(toggle)
    return toggleLabel
  }

  /** 出厂内置规则查找（已停用条目的预览来源；查不到返回 null 跳过渲染） */
  function findDefaultBuiltinRule(id: string): (SimpleRule & { id: string }) | null {
    // 数据源模块纯函数查找（零平台依赖；不在视图内复制第二份内置数据）
    return DEFAULT_BUILTIN_RULES.find((r) => r.id === id) ?? null
  }

  /** 拖拽事件（上游 easy_typing_settings_tab 移植；索引换算归纯函数） */
  function attachDragHandlers(item: HTMLElement): void {
    const handle = item.querySelector<HTMLElement>(`.${CLS}-drag-handle`)
    if (!handle) return

    handle.addEventListener('dragstart', (e) => {
      dragSourceIndex = Number(item.getAttribute('data-vet-rule-index'))
      item.classList.add(`${CLS}-dragging`)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    })
    handle.addEventListener('dragend', () => {
      dragSourceIndex = null
      item.classList.remove(`${CLS}-dragging`)
      clearDropMarkers(item.parentElement)
    })
    item.addEventListener('dragenter', () => {
      cachedMidY = elementMidY(item)
    })
    item.addEventListener('dragover', (e) => {
      if (dragSourceIndex === null) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      const isTop = e.clientY < cachedMidY
      const targetCls = isTop ? `${CLS}-drag-over-top` : `${CLS}-drag-over-bottom`
      if (!item.classList.contains(targetCls)) {
        item.classList.remove(`${CLS}-drag-over-top`, `${CLS}-drag-over-bottom`)
        item.classList.add(targetCls)
      }
    })
    item.addEventListener('dragleave', () => {
      item.classList.remove(`${CLS}-drag-over-top`, `${CLS}-drag-over-bottom`)
    })
    item.addEventListener('drop', (e) => {
      e.preventDefault()
      item.classList.remove(`${CLS}-drag-over-top`, `${CLS}-drag-over-bottom`)
      const fromIndex = dragSourceIndex
      if (fromIndex === null) return
      const targetIndex = Number(item.getAttribute('data-vet-rule-index'))
      const dropOnBottom = e.clientY >= cachedMidY
      const toIndex = computeDropIndex(fromIndex, targetIndex, dropOnBottom)
      if (toIndex === null) return
      void client.reorderUserRule(fromIndex, toIndex).then((outcome) => {
        if (!outcome.ok) actionFailed(outcome.reason)
      })
    })
  }

  function elementMidY(item: HTMLElement): number {
    const rect = item.getBoundingClientRect()
    return rect.top + rect.height / 2
  }

  function clearDropMarkers(parent: HTMLElement | null): void {
    parent?.querySelectorAll(`.${CLS}-drag-over-top, .${CLS}-drag-over-bottom`).forEach((node) => {
      node.classList.remove(`${CLS}-drag-over-top`, `${CLS}-drag-over-bottom`)
    })
  }

  // ===== 分组渲染 =====

  function renderUserSection(): void {
    userSection.textContent = ''
    const header = el('div', `${CLS}-section-header`)
    header.append(el('h3', `${CLS}-section-title`, t.userRules.title))
    const actions = el('div', `${CLS}-section-actions`)

    const addBtn = el('button', classes(`${CLS}-btn`, `${CLS}-btn-primary`), t.userRules.add)
    addBtn.type = 'button'
    addBtn.setAttribute('data-vet-action', 'add-rule')
    addBtn.addEventListener('click', () => openCreateForm())
    actions.append(addBtn)

    // #48 上移/下移（与新增同排，上游 ↑/↓ 语义）：移动当前选中的用户规则，
    // 同一 reorderUserRule 通道做相邻交换；禁用态见 refreshSelectionUi
    const moveUpBtn = el('button', `${CLS}-btn`, '↑')
    moveUpBtn.type = 'button'
    moveUpBtn.setAttribute('data-vet-action', 'move-up')
    moveUpBtn.setAttribute('aria-label', t.userRules.moveUp)
    moveUpBtn.title = t.userRules.moveUp
    moveUpBtn.addEventListener('click', () => moveSelectedUserRule(-1))
    actions.append(moveUpBtn)

    const moveDownBtn = el('button', `${CLS}-btn`, '↓')
    moveDownBtn.type = 'button'
    moveDownBtn.setAttribute('data-vet-action', 'move-down')
    moveDownBtn.setAttribute('aria-label', t.userRules.moveDown)
    moveDownBtn.title = t.userRules.moveDown
    moveDownBtn.addEventListener('click', () => moveSelectedUserRule(1))
    actions.append(moveDownBtn)

    const importBtn = el('button', `${CLS}-btn`, t.userRules.import)
    importBtn.type = 'button'
    importBtn.setAttribute('data-vet-action', 'import')
    importBtn.setAttribute('aria-label', t.userRules.import)
    importBtn.addEventListener('click', () => triggerImport())
    actions.append(importBtn)

    const exportBtn = el('button', `${CLS}-btn`, t.userRules.export)
    exportBtn.type = 'button'
    exportBtn.setAttribute('data-vet-action', 'export')
    exportBtn.setAttribute('aria-label', t.userRules.export)
    exportBtn.addEventListener('click', () => void triggerExport())
    actions.append(exportBtn)

    header.append(actions)
    userSection.append(header)

    const list = el('div', `${CLS}-rule-list`)
    list.setAttribute('data-vet-user-list', '')
    if (client.state.user.length === 0) {
      list.append(el('div', `${CLS}-empty`, t.userRules.empty))
    } else {
      client.state.user.forEach((rule, index) => list.append(buildUserRuleItem(rule, index)))
    }
    userSection.append(list)
    refreshSelectionUi()
    if (pendingScrollToSelected) {
      // 移动后的滚动跟随（真实浏览器生效；jsdom 无实现，可选调用防御）
      pendingScrollToSelected = false
      userSection
        .querySelector<HTMLElement>('[data-vet-selected="true"]')
        ?.scrollIntoView?.({ block: 'nearest' })
    }
  }

  /** 选中态同步（#48）：行标记 + 头部按钮禁用（首行上移 / 末行下移置灰；
   * 选中 id 失效（规则被删/导入去重）时两钮自愈回禁用） */
  function refreshSelectionUi(): void {
    const rules = client.state.user
    const selectedIndex =
      selectedUserRuleId === null ? -1 : rules.findIndex((r) => r.id === selectedUserRuleId)
    userSection.querySelectorAll<HTMLElement>('[data-vet-rule-id]').forEach((row) => {
      const selected =
        selectedIndex !== -1 && row.getAttribute('data-vet-rule-id') === selectedUserRuleId
      row.classList.toggle(`${CLS}-rule-selected`, selected)
      if (selected) row.setAttribute('data-vet-selected', 'true')
      else row.removeAttribute('data-vet-selected')
    })
    const upBtn = userSection.querySelector<HTMLButtonElement>('[data-vet-action="move-up"]')
    const downBtn = userSection.querySelector<HTMLButtonElement>('[data-vet-action="move-down"]')
    if (upBtn) upBtn.disabled = selectedIndex <= 0
    if (downBtn) downBtn.disabled = selectedIndex === -1 || selectedIndex >= rules.length - 1
  }

  /** #48 相邻移动选中行（与拖拽同一 reorderUserRule 通道；写后刷新保持
   * 选中并滚动跟随——交互后行为与列表既有惯例一致） */
  function moveSelectedUserRule(direction: -1 | 1): void {
    const rules = client.state.user
    const index =
      selectedUserRuleId === null ? -1 : rules.findIndex((r) => r.id === selectedUserRuleId)
    if (index === -1) return
    const toIndex = index + direction
    if (toIndex < 0 || toIndex >= rules.length) return
    pendingScrollToSelected = true
    void client.reorderUserRule(index, toIndex).then((outcome) => {
      if (!outcome.ok) {
        // 失败时复位滚动意图，防下一次无关渲染意外滚动（审查轮 1 P2）
        pendingScrollToSelected = false
        actionFailed(outcome.reason)
        void client.load()
      }
    })
  }

  function renderBuiltinSection(): void {
    builtinSection.textContent = ''
    const header = el('div', `${CLS}-section-header`)
    header.append(el('h3', `${CLS}-section-title`, t.builtinRules.title))
    const actions = el('div', `${CLS}-section-actions`)
    const resetBtn = el('button', `${CLS}-btn`, t.builtinRules.resetAll)
    resetBtn.type = 'button'
    resetBtn.setAttribute('data-vet-action', 'reset-all')
    resetBtn.addEventListener('click', () => {
      void client.resetAllBuiltinRules().then((outcome) => {
        if (outcome.ok) showStatus('success', t.status.resetSuccess)
        else handleActionOutcome(outcome)
      })
    })
    actions.append(resetBtn)
    header.append(actions)
    builtinSection.append(header)

    const hint = el('p', `${CLS}-section-desc`, t.builtinRules.layerHint)
    builtinSection.append(hint)

    const list = el('div', `${CLS}-rule-list`)
    list.setAttribute('data-vet-builtin-list', '')
    if (client.state.builtin.length === 0 && client.state.deletedBuiltinRuleIds.length === 0) {
      list.append(el('div', `${CLS}-empty`, t.deletedRules.empty))
    } else {
      client.state.builtin.forEach((rule) => list.append(buildBuiltinRuleItem(rule)))
    }
    builtinSection.append(list)

    const deletedIds = client.state.deletedBuiltinRuleIds
    const details = el('details', `${CLS}-deleted-rules`)
    details.setAttribute('data-vet-deleted-rules', '')
    const summary = el('summary', `${CLS}-deleted-summary`, `${t.deletedRules.title} (${deletedIds.length})`)
    details.append(summary)
    if (deletedIds.length === 0) {
      details.append(el('div', `${CLS}-empty`, t.deletedRules.empty))
    } else {
      for (const id of deletedIds) {
        const item = buildDeletedRuleItem(id)
        if (item) details.append(item)
      }
    }
    builtinSection.append(details)
  }


  // ===== 语言间空格策略（#49：语言对 + 自定义词典，整表提交） =====

  /** 语言对 chip 键（无序：与存储去重口径一致） */
  function pairKey(pair: StoredLanguagePair): string {
    return [pair.a, pair.b].sort().join('\u2194')
  }

  /** 语言对显示名（内置类经 i18n 显示名，自定义类名原样） */
  function pairLabel(pair: StoredLanguagePair): string {
    const nameOf = (raw: string): string =>
      (t.scriptNames as Record<string, string | undefined>)[raw] ?? raw
    return `${nameOf(pair.a)} \u2194 ${nameOf(pair.b)}`
  }

  /** 下拉选项集：内置脚本类（显示名）+ 现有自定义类名 */
  function categoryOptions(): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = BUILTIN_CATEGORIES.map((c) => ({
      value: c,
      label: (t.scriptNames as Record<string, string | undefined>)[c] ?? c,
    }))
    for (const custom of client.state.customScriptCategories) {
      options.push({ value: custom.name, label: custom.name })
    }
    return options
  }

  function buildCategorySelect(
    attr: string,
    options: Array<{ value: string; label: string }>,
  ): HTMLSelectElement {
    const select = el('select') as HTMLSelectElement
    select.className = `${CLS}-select`
    select.setAttribute('data-vet-input', attr)
    for (const opt of options) {
      const option = el('option', undefined, opt.label)
      option.value = opt.value
      select.append(option)
    }
    return select
  }

  /** 词典条目当前 DOM 值整表收集（change/add 提交的读面——DOM 含未提交
   *  编辑，比 client.state 新鲜；exclude 为按**节点身份**排除的行——改名后
   *  按旧名匹配会漏删，审查轮 1 P2） */
  function collectCategoriesFromDom(exclude?: Element | null): Array<{ name: string; pattern: string }> {
    const list = spacingSection.querySelector('[data-vet-category-list]')
    if (!list) return []
    return [...list.querySelectorAll<HTMLElement>('[data-vet-category]')]
      .filter((row) => row !== exclude)
      .map((row) => {
        const name = row.querySelector<HTMLInputElement>('[data-vet-input="category-name"]')
        const pattern = row.querySelector<HTMLInputElement>('[data-vet-input="category-pattern"]')
        return { name: name?.value ?? '', pattern: pattern?.value ?? '' }
      })
  }

  /**
   * spacing 分区整表写串行队列（审查轮 1 P1）：浏览器事件序
   * mousedown→blur→change→click 下，行编辑的 change 写 R1 与随后的按钮
   * click 写 R2 并发——R2 以尚未刷新的 client.state 为基面会静默覆盖 R1
   * （整表替换、最后落盘胜出）。队列化后每笔写（含写后刷新）落地，下一笔
   * 才取基面；词典侧基面另取 DOM 读面（最新鲜）。
   */
  let spacingWriteQueue: Promise<unknown> = Promise.resolve()
  function enqueueSpacingWrite(task: () => Promise<{ ok: boolean; reason?: string }>): void {
    spacingWriteQueue = spacingWriteQueue
      .then(() => {
        // 写请求发出 = 输入面已消费：无论成败，新增行/下拉的草稿语义终结
        //（成功走写后刷新重建、失败走对账重建——两者都不能被 dirty 挡住；
        // 在任务体内 load 同步触发 render，须在此之前清位）
        spacingDirty = false
        return task()
      })
      .then((outcome) => {
        if (!outcome.ok) {
          actionFailed(outcome.reason ?? 'io-failed')
          // 失败对账（审查轮 1 P2）：写后刷新只在成功路径发生，失败时控件
          // 态与存储失配——补一次整拉让视图回到存储真值
          void client.load()
        }
      })
      .catch((err: unknown) => {
        // 任务异常（通道 reject 等罕见形态）镜像失败路径，不做无反馈死按钮
        //（审查轮 2 P2）；队列继续（fulfilled 链尾）
        actionFailed(String(err))
        void client.load()
      })
  }

  /** spacing 分区草稿脏标记（审查轮 2 P1）：真实浏览器在 mousedown 即把
   *  焦点移向被点控件——仅凭 activeElement 判编辑保护挡不住「草稿输入 →
   *  点其他分区开关」的丢输入场景；新增行与双下拉的输入/选择置位，写请求
   *  发出（队列消费）后清除 */
  let spacingDirty = false

  /** 词典整表提交前预检（审查轮 1 P2）：重名/空值/与内置类同名在 UI 拦截
   *  并提示，不交给存储清洗静默吞掉（吞掉 = 写后刷新后行直接消失） */
  function validateCategoriesForSubmit(
    categories: Array<{ name: string; pattern: string }>,
  ): boolean {
    const sp = t.spacing
    const seen = new Set<string>(BUILTIN_CATEGORIES as readonly string[])
    for (const category of categories) {
      const name = category.name.trim()
      if (!name || !category.pattern.trim()) {
        showStatus('failed', sp.categoryInvalid)
        return false
      }
      if (seen.has(name)) {
        showStatus('failed', sp.categoryConflict)
        return false
      }
      seen.add(name)
    }
    return true
  }

  function submitCategories(rawCategories: Array<{ name: string; pattern: string }>): void {
    // 入口先 trim（与存储清洗同口径）：预检校验 trim 值而提交原值时，编辑
    // 保护跳过重建的窗口内 UI 显示 ` greek ` 而存储是 `greek`——失配无限
    // 期持续到下一次渲染（审查轮 2 P2）
    const categories = rawCategories.map((c) => ({ name: c.name.trim(), pattern: c.pattern.trim() }))
    if (!validateCategoriesForSubmit(categories)) return
    enqueueSpacingWrite(() => client.setCustomScriptCategories(categories))
  }

  function renderSpacingSection(): void {
    const sp = t.spacing
    spacingSection.textContent = ''
    const header = el('div', `${CLS}-section-header`)
    header.append(el('h3', `${CLS}-section-title`, sp.title))
    spacingSection.append(header)
    spacingSection.append(el('p', `${CLS}-section-desc`, sp.intro))

    // -- 现役语言对 chips（可删）+ 双下拉添加 --
    const pairsGroup = el('div', `${CLS}-form-group`)
    pairsGroup.append(el('span', `${CLS}-form-name`, sp.pairsTitle))
    const chips = el('div', `${CLS}-chip-options`)
    chips.setAttribute('data-vet-pair-chips', '')
    if (client.state.languagePairs.length === 0) {
      chips.append(el('span', `${CLS}-empty`, sp.empty))
    }
    for (const pair of client.state.languagePairs) {
      const chip = el('span', classes(`${CLS}-chip`, `${CLS}-pair-chip`), pairLabel(pair))
      chip.setAttribute('data-vet-pair', pairKey(pair))
      const remove = el('button', `${CLS}-icon-btn`, '×')
      remove.type = 'button'
      remove.setAttribute('data-vet-action', 'remove-pair')
      remove.setAttribute('aria-label', sp.pairRemove)
      remove.title = sp.pairRemove
      remove.addEventListener('click', () => {
        enqueueSpacingWrite(() =>
          client.setLanguagePairs(
            client.state.languagePairs.filter((p) => pairKey(p) !== pairKey(pair)),
          ),
        )
      })
      chip.append(remove)
      chips.append(chip)
    }
    pairsGroup.append(chips)

    const addPairRow = el('div', classes(`${CLS}-form-row`, `${CLS}-pair-add-row`))
    const options = categoryOptions()
    const selA = buildCategorySelect('pair-a', options)
    const selB = buildCategorySelect('pair-b', options)
    selB.selectedIndex = Math.min(1, options.length - 1)
    // 下拉选择是未提交草稿：置脏标记（写后刷新重建会重置选项——审查轮 2 P1）
    selA.addEventListener('change', () => {
      spacingDirty = true
    })
    selB.addEventListener('change', () => {
      spacingDirty = true
    })
    const addPairBtn = el('button', `${CLS}-btn`, sp.pairAdd)
    addPairBtn.type = 'button'
    addPairBtn.setAttribute('data-vet-action', 'add-pair')
    addPairBtn.addEventListener('click', () => {
      if (!selA.value || !selB.value || selA.value === selB.value) {
        // 执行时读当前字典：编辑保护跳过重建时回调闭包持旧 sp（审查 002）
        showStatus('failed', t.spacing.pairInvalid)
        return
      }
      // 入队时捕获选择值：前一笔写的写后刷新可能重建分区，执行时再读
      // select 是 detached 节点（值虽保留但脆弱——审查轮 2 P2）
      const pair = { a: selA.value, b: selB.value }
      enqueueSpacingWrite(() =>
        client.setLanguagePairs([...client.state.languagePairs.map((p) => ({ ...p })), pair]),
      )
    })
    addPairRow.append(selA, selB, addPairBtn)
    pairsGroup.append(addPairRow)
    spacingSection.append(pairsGroup)

    // -- 自定义语言/符号词典（成对编辑，增删改）--
    const dictGroup = el('div', `${CLS}-form-group`)
    dictGroup.append(el('span', `${CLS}-form-name`, sp.categoriesTitle))
    dictGroup.append(el('span', `${CLS}-form-desc`, sp.categoryPatternHint))
    const categoryList = el('div', `${CLS}-category-list`)
    categoryList.setAttribute('data-vet-category-list', '')
    if (client.state.customScriptCategories.length === 0) {
      categoryList.append(el('div', `${CLS}-empty`, sp.empty))
    }
    for (const custom of client.state.customScriptCategories) {
      const row = el('div', classes(`${CLS}-form-row`, `${CLS}-category-row`))
      row.setAttribute('data-vet-category', custom.name)
      const nameInput = el('input') as HTMLInputElement
      nameInput.type = 'text'
      nameInput.className = `${CLS}-input`
      nameInput.value = custom.name
      nameInput.setAttribute('data-vet-input', 'category-name')
      nameInput.setAttribute('aria-label', sp.categoryName)
      const patternInput = el('input') as HTMLInputElement
      patternInput.type = 'text'
      patternInput.className = `${CLS}-input`
      patternInput.value = custom.pattern
      patternInput.setAttribute('data-vet-input', 'category-pattern')
      patternInput.setAttribute('aria-label', sp.categoryPattern)
      // 失焦（change）提交整表：条目值即所存（DOM 读面 + 串行队列）
      const submitRow = () => submitCategories(collectCategoriesFromDom())
      nameInput.addEventListener('change', submitRow)
      patternInput.addEventListener('change', submitRow)
      const removeBtn = el('button', `${CLS}-icon-btn ${CLS}-danger`, t.ruleItem.remove)
      removeBtn.type = 'button'
      removeBtn.setAttribute('data-vet-action', 'remove-category')
      removeBtn.setAttribute('aria-label', sp.categoryRemove)
      removeBtn.addEventListener('click', () => {
        // 按行节点身份排除（闭包里的 custom.name 是渲染期旧名——行已改名时
        // 按旧名匹配会漏删，审查轮 1 P2）
        submitCategories(collectCategoriesFromDom(row))
      })
      row.append(nameInput, patternInput, removeBtn)
      categoryList.append(row)
    }
    dictGroup.append(categoryList)

    const addCatRow = el('div', classes(`${CLS}-form-row`, `${CLS}-category-row`))
    const newName = el('input') as HTMLInputElement
    newName.type = 'text'
    newName.className = `${CLS}-input`
    newName.placeholder = sp.categoryName
    newName.setAttribute('data-vet-input', 'new-category-name')
    newName.setAttribute('aria-label', sp.categoryName)
    newName.addEventListener('input', () => {
      spacingDirty = true
    })
    const newPattern = el('input') as HTMLInputElement
    newPattern.type = 'text'
    newPattern.className = `${CLS}-input`
    newPattern.placeholder = sp.categoryPattern
    newPattern.setAttribute('data-vet-input', 'new-category-pattern')
    newPattern.setAttribute('aria-label', sp.categoryPattern)
    newPattern.addEventListener('input', () => {
      spacingDirty = true
    })
    const addCatBtn = el('button', `${CLS}-btn`, sp.categoryAdd)
    addCatBtn.type = 'button'
    addCatBtn.setAttribute('data-vet-action', 'add-category')
    addCatBtn.addEventListener('click', () => {
      const name = newName.value.trim()
      const pattern = newPattern.value.trim()
      if (!name || !pattern) {
        // 执行时读当前字典：编辑保护跳过重建时回调闭包持旧 sp（审查 002）
        showStatus('failed', t.spacing.categoryInvalid)
        return
      }
      // 基面取 DOM 读面（含未刷新的行编辑——click 前的 blur/change 写在途，
      // client.state 是旧的，审查轮 1 P1）
      submitCategories([...collectCategoriesFromDom(), { name, pattern }])
    })
    addCatRow.append(newName, newPattern, addCatBtn)
    dictGroup.append(addCatRow)
    spacingSection.append(dictGroup)
    // 重建值即存储基线：脏标记随重建归零（跳过重建的路径不清——草稿仍在）
    spacingDirty = false
  }

  function renderStorageSection(): void {
    storageSection.textContent = ''
    storageSection.append(el('h3', `${CLS}-section-title`, t.storage.dataDirLabel))
    const desc = el('p', `${CLS}-section-desc`, t.storage.dataDirDesc)
    storageSection.append(desc)
    const uriLine = el('code', `${CLS}-storage-uri`, '…')
    uriLine.setAttribute('data-vet-storage-uri', '')
    storageSection.append(uriLine)
    if (cachedStorageUri !== undefined) {
      uriLine.textContent = cachedStorageUri ?? '—'
      return
    }
    void client.storageUri().then((uri) => {
      if (disposed) return
      cachedStorageUri = uri
      uriLine.textContent = uri ?? '—'
    })
  }

  /** spacing 分区编辑保护（审查轮 1 P2 + 轮 2 P1）：焦点在输入/下拉上，
   *  **或**存在未提交草稿（真实浏览器 mousedown 即移焦点，仅凭焦点挡不住
   *  「草稿输入 → 点其他分区开关」的丢输入场景——脏标记补位）时跳过本
   *  分区重建；无冲突的下一次渲染再补齐。 */
  function spacingEditingInFlight(): boolean {
    if (spacingDirty) return true
    const active = doc.activeElement
    if (active === null || !spacingSection.contains(active)) return false
    return active instanceof HTMLInputElement || active instanceof HTMLSelectElement
  }

  function render(): void {
    renderUserSection()
    renderBuiltinSection()
    if (!spacingEditingInFlight()) renderSpacingSection()
    renderStorageSection()
  }

  // ===== 导入 / 导出 =====

  function triggerImport(): void {
    const input = doc.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      void file
        .text()
        .then((text) => client.importUserRules(text))
        .then((result) => {
          if (result === null) {
            showStatus('failed', t.status.importInvalidJson)
            return
          }
          if ('kind' in result) {
            // 上限拒绝（审查 C-P3-4）：与「格式非法」分开的可行动文案
            showStatus('failed', result.kind === 'too-large' ? t.status.importTooLarge : t.status.importTooManyRules)
            return
          }
          if (result.imported === 0) {
            showStatus('info', t.status.importNoRules)
            return
          }
          showStatus(
            'success',
            t.status.importSuccess.replace('{imported}', String(result.imported)).replace('{skipped}', String(result.skipped)),
          )
        })
        .catch(() => showStatus('failed', t.status.actionFailed))
        .finally(() => input.remove())
    })
    doc.body.append(input)
    input.click()
  }

  async function triggerExport(): Promise<void> {
    const content = await client.exportUserRules()
    if (content === null) {
      showStatus('failed', t.status.actionFailed)
      return
    }
    let rules: unknown
    try {
      rules = JSON.parse(content)
    } catch {
      showStatus('failed', t.status.actionFailed)
      return
    }
    if (!Array.isArray(rules) || rules.length === 0) {
      showStatus('info', t.status.noRulesToExport)
      return
    }
    try {
      const blob = new Blob([content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = doc.createElement('a')
      anchor.href = url
      anchor.download = 'easy-typing-user-rules.json'
      doc.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      showStatus('failed', t.status.actionFailed)
    }
  }

  // ===== 编辑表单浮层 =====

  let formContext: {
    mode: 'create' | 'edit'
    editId: string | null
    original: SimpleRule | null
    model: RuleFormModel
  } | null = null

  function closeModal(): void {
    formContext = null
    overlay.classList.add(`${CLS}-hidden`)
    overlay.textContent = ''
  }

  function openCreateForm(): void {
    openForm({ mode: 'create', editId: null, original: null, model: defaultRuleFormModel() })
  }

  function openEditForm(rule: SimpleRule): void {
    openForm({
      mode: 'edit',
      editId: rule.id ?? null,
      original: rule,
      model: formModelFromSimpleRule(rule),
    })
  }

  function openForm(context: NonNullable<typeof formContext>): void {
    formContext = context
    buildFormDom()
    overlay.classList.remove(`${CLS}-hidden`)
    refreshFormVisibility()
    runTest()
    if (context.mode === 'create') {
      // 新建时聚焦触发式（上游 setInitialFocus 同型；编辑时保持无焦点避免滚动跳变）
      const triggerInput = overlay.querySelector<HTMLInputElement>('[data-vet-input="trigger"]')
      triggerInput?.focus()
    }
  }

  /** 表单 DOM 组装（一次性构建；可见性/激活态经 refreshFormVisibility 切换） */
  function buildFormDom(): void {
    const context = formContext!
    const f = t.form
    overlay.textContent = ''
    const backdrop = el('div', `${CLS}-modal-backdrop`)
    backdrop.addEventListener('click', () => closeModal())
    const dialog = el('div', `${CLS}-modal-dialog`)
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')

    const header = el('div', `${CLS}-modal-header`)
    header.append(el('h3', `${CLS}-modal-title`, context.mode === 'create' ? f.addTitle : f.editTitle))
    dialog.append(header)

    const body = el('div', `${CLS}-modal-body`)
    body.setAttribute('data-vet-form-body', '')

    // -- 类型与触发方式 pill 条 --
    const pillBar = el('div', `${CLS}-pill-bar`)
    const typeSection = el('div', `${CLS}-pill-section`)
    typeSection.append(el('span', `${CLS}-pill-label`, f.fieldType))
    const typeOptions = el('div', `${CLS}-pill-options`)
    for (const { value, label } of [
      { value: RuleType.Input, label: t.ruleItem.typeInput },
      { value: RuleType.Delete, label: t.ruleItem.typeDelete },
      { value: RuleType.SelectKey, label: t.ruleItem.typeSelectKey },
    ]) {
      const pill = el('button', `${CLS}-pill`, label)
      pill.type = 'button'
      pill.dataset.pillGroup = 'ruleType'
      pill.dataset.pillValue = value
      pill.addEventListener('click', () => {
        context.model.ruleType = value
        // 类型切换后签名失配的函数 ref 自动改选该类型首个可用项（空 = 用户重选）
        if (
          context.model.isFunction &&
          !functionRefValidForType(context.model.functionRef, value)
        ) {
          context.model.functionRef = firstFunctionRefForType(value)
        }
        refreshFormVisibility()
        runTest()
      })
      typeOptions.append(pill)
    }
    typeSection.append(typeOptions)
    pillBar.append(typeSection)

    const modeSection = el('div', `${CLS}-pill-section`)
    modeSection.setAttribute('data-vet-field', 'triggerModeSection')
    modeSection.append(el('span', `${CLS}-pill-label`, f.fieldTriggerMode))
    const modeOptions = el('div', `${CLS}-pill-options`)
    for (const { value, label, pending } of [
      { value: RuleTriggerMode.Auto, label: f.triggerModeAuto, pending: false },
      { value: RuleTriggerMode.Tab, label: f.triggerModeTab, pending: true },
    ]) {
      const pill = el('button', `${CLS}-pill`, label)
      pill.type = 'button'
      pill.dataset.pillGroup = 'triggerMode'
      pill.dataset.pillValue = value
      if (pending) {
        // 平台行为链事件形态恒不含 tab changeType（引擎要求 changeType ===
        // 'tab' 才命中）——驱动面到达前 Tab 触发永不生效，禁用选项并给出
        // 提示，防用户创建完全无效的规则（审查 A-R4-2；存量 Tab 规则如实
        // 往返不受影响）
        pill.disabled = true
        pill.title = f.triggerModeTabPending
      }
      pill.addEventListener('click', () => {
        context.model.triggerMode = value
        refreshFormVisibility()
        runTest()
      })
      modeOptions.append(pill)
    }
    modeSection.append(modeOptions)
    pillBar.append(modeSection)
    body.append(pillBar)

    // -- 匹配条件组 --
    const matchGroup = el('div', `${CLS}-form-group`)
    matchGroup.setAttribute('data-vet-group', 'match')
    const matchHeader = el('div', `${CLS}-form-group-header`)
    matchHeader.append(el('span', `${CLS}-form-group-title`, f.groupMatch))
    const regexChip = el('button', `${CLS}-chip`, f.fieldIsRegex)
    regexChip.type = 'button'
    regexChip.setAttribute('data-vet-field', 'isRegexChip')
    regexChip.addEventListener('click', () => {
      context.model.isRegex = !context.model.isRegex
      refreshFormVisibility()
      runTest()
    })
    matchHeader.append(regexChip)
    matchGroup.append(matchHeader)

    const triggerRow = el('label', `${CLS}-form-row`)
    triggerRow.setAttribute('data-vet-field', 'trigger')
    const triggerName = el('span', `${CLS}-form-name`, f.fieldTrigger)
    triggerName.setAttribute('data-vet-role', 'triggerName')
    const triggerInput = el('input') as HTMLInputElement
    triggerInput.type = 'text'
    triggerInput.value = context.model.trigger
    triggerInput.setAttribute('data-vet-input', 'trigger')
    triggerInput.addEventListener('input', () => {
      context.model.trigger = triggerInput.value
      runTest()
    })
    triggerRow.append(triggerName, triggerInput)
    matchGroup.append(triggerRow)

    const triggerDesc = el('span', `${CLS}-form-desc`)
    triggerDesc.setAttribute('data-vet-role', 'triggerDesc')
    triggerRow.append(triggerDesc)

    const rightRow = el('label', `${CLS}-form-row`)
    rightRow.setAttribute('data-vet-field', 'triggerRight')
    rightRow.append(el('span', `${CLS}-form-name`, f.fieldTriggerRight))
    const rightInput = el('input') as HTMLInputElement
    rightInput.type = 'text'
    rightInput.value = context.model.triggerRight
    rightInput.setAttribute('data-vet-input', 'triggerRight')
    rightInput.addEventListener('input', () => {
      context.model.triggerRight = rightInput.value
      runTest()
    })
    rightRow.append(rightInput)
    matchGroup.append(rightRow)

    const flagsRow = el('label', `${CLS}-form-row`)
    flagsRow.setAttribute('data-vet-field', 'regexFlags')
    flagsRow.append(el('span', `${CLS}-form-name`, f.fieldRegexFlags))
    const flagsDesc = el('span', `${CLS}-form-desc`, f.fieldRegexFlagsDesc)
    const flagsInput = el('input') as HTMLInputElement
    flagsInput.type = 'text'
    flagsInput.placeholder = 'imu'
    flagsInput.value = context.model.regexFlags
    flagsInput.setAttribute('data-vet-input', 'regexFlags')
    flagsInput.addEventListener('input', () => {
      context.model.regexFlags = RuleEngine.normalizeRegexFlags(flagsInput.value)
      runTest()
    })
    flagsRow.append(flagsInput, flagsDesc)
    matchGroup.append(flagsRow)
    body.append(matchGroup)

    // -- 替换组（字符串可编辑 / 函数引用选择 + 源码只读展示） --
    const replGroup = el('div', `${CLS}-form-group`)
    replGroup.setAttribute('data-vet-group', 'replacement')
    const replHeader = el('div', `${CLS}-form-group-header`)
    replHeader.append(el('span', `${CLS}-form-group-title`, f.groupReplacement))
    // 函数式替换开关（#17 解锁）：打开后替换面变为预注册函数引用选择
    const fnChip = el('button', `${CLS}-chip`, f.fieldIsFunction)
    fnChip.type = 'button'
    fnChip.setAttribute('data-vet-field', 'isFunctionChip')
    fnChip.addEventListener('click', () => {
      context.model.isFunction = !context.model.isFunction
      // 打开时缺省预选当前类型首个可用函数（避免空 ref 立即校验报错）
      if (
        context.model.isFunction &&
        !functionRefValidForType(context.model.functionRef, context.model.ruleType)
      ) {
        context.model.functionRef = firstFunctionRefForType(context.model.ruleType)
      }
      refreshFormVisibility()
      runTest()
    })
    replHeader.append(fnChip)
    replGroup.append(replHeader)

    const replRow = el('div', `${CLS}-form-row`)
    replRow.setAttribute('data-vet-field', 'replacementTextarea')
    replRow.append(el('span', `${CLS}-form-name`, f.fieldReplacement))
    const replArea = el('textarea') as HTMLTextAreaElement
    replArea.className = `${CLS}-textarea`
    replArea.value = context.model.replacement
    replArea.setAttribute('aria-label', f.fieldReplacement)
    replArea.setAttribute('data-vet-input', 'replacement')
    replArea.addEventListener('input', () => {
      context.model.replacement = replArea.value
      runTest()
    })
    replRow.append(replArea)
    replGroup.append(replRow)

    const replHint = el('div', `${CLS}-form-desc`)
    replHint.setAttribute('data-vet-field', 'replacementHint')
    replGroup.append(replHint)

    // 函数引用选择行：预注册表内按规则类型过滤（选项经 refreshFormVisibility 重建）
    const fnRefRow = el('label', `${CLS}-form-row`)
    fnRefRow.setAttribute('data-vet-field', 'functionRefRow')
    fnRefRow.append(el('span', `${CLS}-form-name`, f.fieldFunctionRef))
    const fnRefSelect = el('select') as HTMLSelectElement
    fnRefSelect.className = `${CLS}-select`
    fnRefSelect.setAttribute('aria-label', f.fieldFunctionRef)
    fnRefSelect.setAttribute('data-vet-input', 'functionRef')
    fnRefSelect.addEventListener('change', () => {
      context.model.functionRef = fnRefSelect.value
      refreshFormVisibility()
      runTest()
    })
    fnRefRow.append(fnRefSelect)
    replGroup.append(fnRefRow)

    // 选中函数的源码只读展示（函数本体在组件代码，不随规则 JSON 存储）
    const fnBlock = el('div', `${CLS}-fn-block`)
    fnBlock.setAttribute('data-vet-field', 'fnEditor')
    fnBlock.append(el('span', `${CLS}-form-name`, f.fieldReplacement))
    const fnCode = el('pre', `${CLS}-code`)
    fnCode.setAttribute('data-vet-field', 'fnCode')
    fnBlock.append(fnCode)
    const fnHint = el('div', `${CLS}-form-desc`)
    fnHint.setAttribute('data-vet-field', 'fnHint')
    fnBlock.append(fnHint)
    replGroup.append(fnBlock)
    body.append(replGroup)

    // -- 其他组：作用域 / 语言 / 优先级 / 描述 / 启用 --
    const otherGroup = el('div', `${CLS}-form-group`)
    otherGroup.setAttribute('data-vet-group', 'other')
    const otherHeader = el('div', `${CLS}-form-group-header`)
    otherHeader.append(el('span', `${CLS}-form-group-title`, f.groupOther))
    otherGroup.append(otherHeader)

    const scopeRow = el('div', `${CLS}-form-row`)
    scopeRow.setAttribute('data-vet-field', 'scope')
    scopeRow.append(el('span', `${CLS}-form-name`, f.fieldScope))
    const scopeChips = el('div', `${CLS}-chip-options`)
    for (const { value, label } of [
      { value: RuleScope.All, label: f.scopeAll },
      { value: RuleScope.Text, label: f.scopeText },
      { value: RuleScope.Formula, label: f.scopeFormula },
      { value: RuleScope.Code, label: f.scopeCode },
    ]) {
      const chip = el('button', `${CLS}-chip`, label)
      chip.type = 'button'
      chip.dataset.scopeValue = value
      chip.addEventListener('click', () => {
        context.model.scopes = toggleFormScope(context.model.scopes, value)
        refreshFormVisibility()
        runTest()
      })
      scopeChips.append(chip)
    }
    scopeRow.append(scopeChips)
    otherGroup.append(scopeRow)

    const langRow = el('label', `${CLS}-form-row`)
    langRow.setAttribute('data-vet-field', 'scopeLanguage')
    langRow.append(el('span', `${CLS}-form-name`, f.fieldScopeLanguage))
    const langInput = el('input') as HTMLInputElement
    langInput.type = 'text'
    langInput.placeholder = 'python, javascript'
    langInput.value = context.model.scopeLanguage
    langInput.setAttribute('data-vet-input', 'scopeLanguage')
    langInput.addEventListener('input', () => {
      context.model.scopeLanguage = langInput.value.trim().toLowerCase()
    })
    langRow.append(langInput)
    otherGroup.append(langRow)

    const priorityRow = el('label', `${CLS}-form-row`)
    priorityRow.append(el('span', `${CLS}-form-name`, f.fieldPriority))
    const priorityDesc = el('span', `${CLS}-form-desc`, f.fieldPriorityDesc)
    const priorityInput = el('input') as HTMLInputElement
    priorityInput.type = 'number'
    priorityInput.value = String(context.model.priority)
    priorityInput.setAttribute('data-vet-input', 'priority')
    priorityInput.addEventListener('input', () => {
      const n = Number.parseInt(priorityInput.value, 10)
      if (!Number.isNaN(n)) context.model.priority = n
    })
    priorityRow.append(priorityInput, priorityDesc)
    otherGroup.append(priorityRow)

    const descRow = el('label', `${CLS}-form-row`)
    descRow.append(el('span', `${CLS}-form-name`, f.fieldDescription))
    const descInput = el('input') as HTMLInputElement
    descInput.type = 'text'
    descInput.value = context.model.description
    descInput.setAttribute('data-vet-input', 'description')
    descInput.addEventListener('input', () => {
      context.model.description = descInput.value
    })
    descRow.append(descInput)
    otherGroup.append(descRow)

    const enabledRow = el('label', `${CLS}-form-row ${CLS}-form-row-inline`)
    const enabledToggle = el('input') as HTMLInputElement
    enabledToggle.type = 'checkbox'
    enabledToggle.checked = context.model.enabled
    enabledToggle.setAttribute('data-vet-input', 'enabled')
    enabledToggle.addEventListener('change', () => {
      context.model.enabled = enabledToggle.checked
    })
    enabledRow.append(enabledToggle, el('span', `${CLS}-form-name`, f.enabled))
    otherGroup.append(enabledRow)
    body.append(otherGroup)

    // -- 规则测试编辑器 --
    body.append(buildTestEditor())

    dialog.append(body)

    // -- 页脚：错误行 + 取消/保存 --
    const footer = el('div', `${CLS}-modal-footer`)
    const errorLine = el('div', `${CLS}-form-error`)
    errorLine.setAttribute('data-vet-field', 'formError')
    const cancelBtn = el('button', `${CLS}-btn`, f.buttonCancel)
    cancelBtn.type = 'button'
    cancelBtn.setAttribute('data-vet-action', 'cancel')
    cancelBtn.addEventListener('click', () => closeModal())
    const saveBtn = el('button', classes(`${CLS}-btn`, `${CLS}-btn-primary`), f.buttonSave)
    saveBtn.type = 'button'
    saveBtn.setAttribute('data-vet-action', 'save')
    saveBtn.addEventListener('click', () => void submitForm())
    footer.append(errorLine, cancelBtn, saveBtn)
    dialog.append(footer)

    overlay.append(backdrop, dialog)
  }

  /** 可见性/激活态切换（上游 refreshVisibility 适配；输入值不动） */
  function refreshFormVisibility(): void {
    const context = formContext
    if (!context) return
    const f = t.form
    const model = context.model
    const isSelectKey = model.ruleType === RuleType.SelectKey

    overlay.querySelectorAll<HTMLButtonElement>('[data-pill-group="ruleType"]').forEach((pill) => {
      pill.classList.toggle(`${CLS}-pill-active`, pill.dataset.pillValue === model.ruleType)
    })
    overlay.querySelectorAll<HTMLButtonElement>('[data-pill-group="triggerMode"]').forEach((pill) => {
      pill.classList.toggle(`${CLS}-pill-active`, pill.dataset.pillValue === model.triggerMode)
    })
    const modeSection = overlay.querySelector<HTMLElement>('[data-vet-field="triggerModeSection"]')
    modeSection?.classList.toggle(`${CLS}-hidden`, model.ruleType !== RuleType.Input)

    const regexChip = overlay.querySelector<HTMLButtonElement>('[data-vet-field="isRegexChip"]')
    regexChip?.classList.toggle(`${CLS}-chip-active`, model.isRegex)
    regexChip?.classList.toggle(`${CLS}-hidden`, isSelectKey)
    fieldRow('triggerRight')?.classList.toggle(`${CLS}-hidden`, isSelectKey)
    fieldRow('regexFlags')?.classList.toggle(`${CLS}-hidden`, isSelectKey || !model.isRegex)

    const triggerName = overlay.querySelector<HTMLElement>('[data-vet-role="triggerName"]')
    if (triggerName) {
      triggerName.textContent = isSelectKey ? f.fieldTriggerSelectKey : f.fieldTrigger
    }
    const triggerDesc = overlay.querySelector<HTMLElement>('[data-vet-role="triggerDesc"]')
    if (triggerDesc) {
      triggerDesc.textContent = model.isRegex ? '' : f.hintTriggerEscape
    }

    // 替换体：函数式 → 引用选择 + 源码只读块；字符串 → 可编辑 textarea
    const isFn = model.isFunction
    overlay
      .querySelector<HTMLButtonElement>('[data-vet-field="isFunctionChip"]')
      ?.classList.toggle(`${CLS}-chip-active`, isFn)
    const replTextarea = fieldRow('replacementTextarea')
    const fnRefRow = fieldRow('functionRefRow')
    const fnBlock = fieldRow('fnEditor')
    replTextarea?.classList.toggle(`${CLS}-hidden`, isFn)
    fnRefRow?.classList.toggle(`${CLS}-hidden`, !isFn)
    fnBlock?.classList.toggle(`${CLS}-hidden`, !isFn)
    if (isFn) {
      // 选项重建：仅列当前规则类型可用的签名（签名种类与规则类型的配对口径）
      const fnRefSelect = overlay.querySelector<HTMLSelectElement>('[data-vet-input="functionRef"]')
      if (fnRefSelect) {
        const want = signatureKindForRuleType(model.ruleType)
        const groupLabel = want === 'selectKey' ? f.fnGroupSelectKey : f.fnGroupText
        const available = [...FUNCTION_TABLE_BY_REF.values()].filter(
          (entry) => entry.signature === want,
        )
        fnRefSelect.textContent = ''
        const group = doc.createElement('optgroup')
        group.label = groupLabel
        for (const entry of available) {
          const option = doc.createElement('option')
          option.value = entry.ref
          option.textContent = entry.ref
          group.append(option)
        }
        fnRefSelect.append(group)
        fnRefSelect.value = model.functionRef
      }
      // 选中函数的源码只读展示（在场函数才展示；未选/失配给空块）
      const entry: FunctionTableEntry | undefined = FUNCTION_TABLE_BY_REF.get(model.functionRef)
      const fnCode = overlay.querySelector<HTMLElement>('[data-vet-field="fnCode"]')
      if (fnCode) renderHighlightedCode(fnCode, entry ? String(entry.fn) : '')
      const fnHintEl = overlay.querySelector<HTMLElement>('[data-vet-field="fnHint"]')
      if (fnHintEl) {
        const parts: string[] = [
          isSelectKey ? f.functionHintSelectKey : f.functionHintInputDelete,
          f.functionReadonlyHint,
        ]
        fnHintEl.textContent = parts.join('\n')
      }
    } else {
      const replHint = overlay.querySelector<HTMLElement>('[data-vet-field="replacementHint"]')
      if (replHint) {
        const parts: string[] = []
        if (isSelectKey) parts.push(f.fieldReplacementDescSelectKey)
        else if (model.isRegex) parts.push(f.fieldReplacementDescInputDelete)
        parts.push(f.hintTabstop)
        replHint.textContent = parts.join('\n')
      }
    }

    // 作用域 chips 与语言行
    overlay.querySelectorAll<HTMLButtonElement>('[data-scope-value]').forEach((chip) => {
      chip.classList.toggle(
        `${CLS}-chip-active`,
        model.scopes.includes(chip.dataset.scopeValue as RuleScope),
      )
    })
    fieldRow('scopeLanguage')?.classList.toggle(
      `${CLS}-hidden`,
      !model.scopes.includes(RuleScope.Code),
    )
  }

  function fieldRow(name: string): HTMLElement | null {
    return overlay.querySelector<HTMLElement>(`[data-vet-field="${name}"]`)
  }

  /** 函数源码只读高亮展示（词法器 + span 叠色，无 textarea——不可编辑） */
  function renderHighlightedCode(container: HTMLElement, code: string): void {
    container.textContent = ''
    let cursor = 0
    for (const token of tokenizeJs(code)) {
      if (token.from > cursor) container.append(doc.createTextNode(code.slice(cursor, token.from)))
      const span = el('span', `${CLS}-hl-${token.cls}`)
      span.textContent = code.slice(token.from, token.to)
      container.append(span)
      cursor = token.to
    }
    if (cursor < code.length) container.append(doc.createTextNode(code.slice(cursor)))
  }

  /** 保存：装配 → 校验 → mutate → 成功关浮层（写后刷新已驱动重渲染） */
  async function submitForm(): Promise<void> {
    const context = formContext
    if (!context) return
    const f = t.form
    const errorLine = overlay.querySelector<HTMLElement>('[data-vet-field="formError"]')
    const rule = buildSimpleRuleFromForm(context.model, context.original ?? undefined)
    const invalid = validateRuleForm(context.model)
    if (invalid) {
      if (errorLine) {
        if (invalid.kind === 'required' && invalid.field === 'trigger') {
          errorLine.textContent = f.errTriggerRequired
        } else if (invalid.field === 'functionRef') {
          errorLine.textContent =
            invalid.kind === 'required' ? f.errFunctionRefRequired : f.errFunctionRefInvalid
        } else {
          errorLine.textContent = `${f.invalidRegex}：${invalid.detail}`
        }
      }
      return
    }
    const outcome =
      context.mode === 'create'
        ? await client.addUserRule(rule)
        : await client.updateUserRule(context.editId ?? '', rule)
    if (!outcome.ok) {
      actionFailed(outcome.reason)
      return
    }
    closeModal()
  }

  // ===== 规则测试编辑器 =====

  function buildTestEditor(): HTMLElement {
    const te = t.testEditor
    const group = el('div', `${CLS}-form-group`)
    group.setAttribute('data-vet-group', 'test')
    const testHeader = el('div', `${CLS}-form-group-header`)
    testHeader.append(el('span', `${CLS}-form-group-title`, te.title))
    group.append(testHeader)
    group.append(el('p', `${CLS}-form-desc`, te.desc))

    const inputRow = el('label', `${CLS}-form-row`)
    inputRow.append(el('span', `${CLS}-form-name`, te.inputLabel))
    const input = el('textarea') as HTMLTextAreaElement
    input.className = `${CLS}-textarea`
    input.setAttribute('data-vet-test-input', '')
    input.addEventListener('input', () => runTest())
    input.addEventListener('keyup', () => runTest())
    input.addEventListener('click', () => runTest())
    inputRow.append(input)
    group.append(inputRow)

    const outputRow = el('div', `${CLS}-form-row`)
    outputRow.append(el('span', `${CLS}-form-name`, te.outputLabel))
    const output = el('div', `${CLS}-test-output`)
    output.setAttribute('data-vet-test-output', '')
    outputRow.append(output)
    group.append(outputRow)
    return group
  }

  /** 实时试运行：当前表单规则 × 测试文本（光标/选区） */
  function runTest(): void {
    const context = formContext
    if (!context) return
    const output = overlay.querySelector<HTMLElement>('[data-vet-test-output]')
    const input = overlay.querySelector<HTMLTextAreaElement>('[data-vet-test-input]')
    if (!output || !input) return
    const docText = input.value
    const from = input.selectionStart ?? docText.length
    const to = input.selectionEnd ?? from
    // 函数式替换下试运行用当前选中 ref 装配的引用规则（选择面即所见）
    const rule = buildSimpleRuleFromForm(context.model, context.original ?? undefined)
    const outcome = testSingleRule(rule, { docText, from, to })
    if (outcome.kind === 'miss') {
      output.setAttribute('data-vet-test-state', 'miss')
      output.textContent = t.testEditor.miss
      return
    }
    output.setAttribute('data-vet-test-state', 'hit')
    output.textContent = ''
    const rangeText = `[${outcome.result.matchRange.from}, ${outcome.result.matchRange.to})`
    const stateLine = el('div', `${CLS}-test-state`, t.testEditor.hit.replace('{range}', rangeText))
    const pre = el('pre', `${CLS}-code`)
    pre.textContent =
      outcome.outputText.slice(0, outcome.cursor) + '▏' + outcome.outputText.slice(outcome.cursor)
    output.append(stateLine, pre)
  }

  // ===== 装载与生命周期 =====

  /** 状态变化 → 列表重渲染（写后刷新的视图侧消费；undefined = 尚未请求过） */
  let cachedStorageUri: string | null | undefined = undefined
  const unsubscribe = client.onStateChange(() => {
    if (!disposed) render()
  })

  // 宿主层禁用态订阅（#50）：初值快照 + onEnabledChange 推送更新灰态输入
  // 并重渲染（宿主行为管理/组件启停落库后即时同步）
  const syncHostDisabledState = (state: { addonRunState: string; disabled: readonly string[] }) => {
    hostAddonDisabled = state.addonRunState === 'user-disabled'
    hostDisabledBehaviors = new Set(state.disabled)
    if (!disposed) render()
  }
  if (options.behaviorState) {
    syncHostDisabledState(options.behaviorState.enabledState())
  }
  const unsubscribeBehaviorState = options.behaviorState?.onEnabledChange(syncHostDisabledState) ?? null
  render()

  async function reload(): Promise<void> {
    const ok = await client.load()
    if (!ok && !disposed) showStatus('failed', t.status.loadFailed)
  }

  /** 就地切换语言（#58）：更新字典引用后按既有渲染路径重建。状态保全：
   *  - 选中规则/灰态/客户端数据为闭包态，重建不丢；
   *  - 编辑浮层在场：表单值按切换前 DOM 原始草稿快照恢复（含选区与方向）
   *    ——不从归一化模型重建：priority 空串被输入处理忽略、
   *    scopeLanguage/regexFlags 模型已归一化，模型往返会覆盖未提交输入
   *    （审查 001）；测试编辑器（DOM 态）同快照回填；焦点优先按
   *    data-vet-input 名恢复，其次测试编辑器；浮层内其余无稳定名标记的
   *    控件（pill/按钮）焦点不恢复；
   *  - 分区头部与规则列表按钮（开关/编辑/删除等）重建后焦点回落 body，
   *    属已知边界（低频切换事件，重新点击即可）；
   *  - spacing 分区草稿守卫（spacingEditingInFlight）沿用写后刷新语义：
   *    焦点/脏标记在场时本分区保持原语言，下一次无冲突渲染补齐；守卫
   *    期间动作回调的校验提示执行时读当前字典（审查 002）。 */
  function setLanguage(language: string): void {
    if (disposed) return
    m = pickMessages(language)
    t = m.rulesPage
    if (formContext !== null) {
      const testInput = overlay.querySelector<HTMLTextAreaElement>('[data-vet-test-input]')
      const testText = testInput?.value ?? null
      const testFrom = testInput?.selectionStart ?? null
      const testTo = testInput?.selectionEnd ?? null
      const draft = new Map<
        string,
        {
          value: string
          checked: boolean
          from: number | null
          to: number | null
          direction: SelectionDirection
        }
      >()
      for (const field of overlay.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('[data-vet-input]')) {
        const name = field.getAttribute('data-vet-input')
        if (name === null) continue
        draft.set(name, {
          value: field.value,
          checked: field instanceof HTMLInputElement && field.type === 'checkbox' && field.checked,
          from: field instanceof HTMLSelectElement ? null : field.selectionStart,
          to: field instanceof HTMLSelectElement ? null : field.selectionEnd,
          direction: field instanceof HTMLSelectElement ? 'none' : (field.selectionDirection ?? 'none'),
        })
      }
      const activeElement =
        doc.activeElement instanceof HTMLElement && overlay.contains(doc.activeElement)
          ? doc.activeElement
          : null
      const focusName = activeElement?.getAttribute('data-vet-input') ?? null
      const focusWasTestInput = activeElement?.hasAttribute('data-vet-test-input') ?? false
      buildFormDom()
      refreshFormVisibility()
      for (const [name, snap] of draft) {
        const field = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          `[data-vet-input="${name}"]`,
        )
        if (field === null) continue
        if (field instanceof HTMLInputElement && field.type === 'checkbox') {
          field.checked = snap.checked
        } else if (field instanceof HTMLSelectElement) {
          field.value = snap.value
        } else {
          field.value = snap.value
          if (snap.from !== null && snap.to !== null) {
            field.setSelectionRange(snap.from, snap.to, snap.direction)
          }
        }
      }
      const nextTestInput = overlay.querySelector<HTMLTextAreaElement>('[data-vet-test-input]')
      if (nextTestInput !== null && testText !== null) {
        nextTestInput.value = testText
        if (testFrom !== null && testTo !== null) nextTestInput.setSelectionRange(testFrom, testTo)
      }
      if (focusName !== null) {
        overlay.querySelector<HTMLElement>(`[data-vet-input="${focusName}"]`)?.focus()
      } else if (focusWasTestInput) {
        nextTestInput?.focus()
      }
      runTest()
    }
    render()
  }

  void reload()

  return {
    reload,
    setLanguage,
    dispose() {
      disposed = true
      if (statusTimer !== null) cancel(statusTimer)
      statusTimer = null
      closeModal()
      unsubscribe()
      unsubscribeBehaviorState?.()
      if (hosted) {
        // hosts 模式只移除自建自持节点（状态行可能归宿主页面所有），root 归宿主
        for (const node of ownedNodes) node.remove()
        return
      }
      root.textContent = ''
      root.classList.remove(`${CLS}-root`)
      root.removeAttribute('data-vet-page')
    },
  }
}
