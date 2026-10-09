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
import type { Messages } from './i18n'
import { RuleEngine, RuleScope, RuleTriggerMode, RuleType, type SimpleRule } from './rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from './rules/default-rules'
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
}

export interface RulesSettingsViewHandle {
  /** 触发一次数据装载（装载失败走状态行；重复调用无害） */
  reload(): Promise<void>
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
  const m = options.messages
  const t = m.rulesPage
  const client = options.client
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]))
  let disposed = false
  let statusTimer: unknown = null
  let dragSourceIndex: number | null = null
  let cachedMidY = 0

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

  root.classList.add(`${CLS}-root`)
  root.setAttribute('data-vet-page', 'rules')

  const title = el('h2', `${CLS}-page-title`, t.title)
  const intro = el('p', `${CLS}-page-intro`, t.intro)
  const status = el('div', `${CLS}-status`)
  status.setAttribute('data-vet-status', '')
  status.setAttribute('role', 'status')

  const userSection = el('section', `${CLS}-section`)
  userSection.setAttribute('data-vet-section', 'user')
  const builtinSection = el('section', `${CLS}-section`)
  builtinSection.setAttribute('data-vet-section', 'builtin')
  const storageSection = el('section', `${CLS}-section ${CLS}-storage`)
  storageSection.setAttribute('data-vet-section', 'storage')
  root.append(title, intro, status, userSection, builtinSection, storageSection)

  /** 模态浮层容器（编辑表单；常驻 root 末位，hidden 切换） */
  const overlay = el('div', classes(`${CLS}-modal`, `${CLS}-hidden`))
  overlay.setAttribute('data-vet-modal', '')
  root.append(overlay)

  /** 状态行：kind = info/failed/success；6s 自动清除 */
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

  function actionFailed(reason: string): void {
    showStatus('failed', `${t.status.actionFailed}：${reason}`)
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

    item.append(buildDragHandle())

    const main = el('div', `${CLS}-rule-main`)
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
      void client.toggleUserRuleEnabled(rule.id ?? '', toggle.checked).then((outcome) => {
        if (!outcome.ok) actionFailed(outcome.reason)
      })
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
      void client.deleteUserRule(rule.id ?? '').then((outcome) => {
        if (!outcome.ok) actionFailed(outcome.reason)
      })
    })
    item.append(removeBtn)

    attachDragHandlers(item)
    return item
  }

  /** 内置规则条目：只读展示 + 停用按钮（逐条开关走平台行为冲突管理） */
  function buildBuiltinRuleItem(rule: SimpleRule): HTMLElement {
    const item = el('div', `${CLS}-rule-item`)
    item.setAttribute('data-vet-rule-id', rule.id ?? '')
    if (rule.enabled === false) item.classList.add(`${CLS}-rule-disabled`)
    const main = el('div', `${CLS}-rule-main`)
    main.append(buildTagRow(rule))
    item.append(main)
    const disableBtn = el('button', `${CLS}-icon-btn ${CLS}-danger`, t.builtinRules.disable)
    disableBtn.type = 'button'
    disableBtn.setAttribute('data-vet-action', 'disable-builtin')
    disableBtn.setAttribute('aria-label', t.builtinRules.disable)
    disableBtn.addEventListener('click', () => {
      void client.disableBuiltinRule(rule.id ?? '').then((outcome) => {
        if (!outcome.ok) actionFailed(outcome.reason)
      })
    })
    item.append(disableBtn)
    return item
  }

  /** 已停用内置规则条目：出厂数据预览 + 恢复按钮 */
  function buildDeletedRuleItem(id: string): HTMLElement | null {
    const defaultRule = findDefaultBuiltinRule(id)
    if (!defaultRule) return null
    const item = el('div', `${CLS}-rule-item ${CLS}-rule-deleted`)
    item.setAttribute('data-vet-rule-id', id)
    const main = el('div', `${CLS}-rule-main`)
    main.append(buildTagRow(defaultRule))
    item.append(main)
    const restoreBtn = el('button', `${CLS}-icon-btn`, t.deletedRules.restore)
    restoreBtn.type = 'button'
    restoreBtn.setAttribute('data-vet-action', 'restore')
    restoreBtn.setAttribute('aria-label', t.deletedRules.restore)
    restoreBtn.addEventListener('click', () => {
      void client.restoreBuiltinRule(id).then((outcome) => {
        if (!outcome.ok) actionFailed(outcome.reason)
      })
    })
    item.append(restoreBtn)
    return item
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
        else actionFailed(outcome.reason)
      })
    })
    actions.append(resetBtn)
    header.append(actions)
    builtinSection.append(header)

    const hint = el('p', `${CLS}-section-desc`, t.builtinRules.platformToggleHint)
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

  function render(): void {
    renderUserSection()
    renderBuiltinSection()
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
    for (const { value, label } of [
      { value: RuleTriggerMode.Auto, label: f.triggerModeAuto },
      { value: RuleTriggerMode.Tab, label: f.triggerModeTab },
    ]) {
      const pill = el('button', `${CLS}-pill`, label)
      pill.type = 'button'
      pill.dataset.pillGroup = 'triggerMode'
      pill.dataset.pillValue = value
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
  render()

  async function reload(): Promise<void> {
    const ok = await client.load()
    if (!ok && !disposed) showStatus('failed', t.status.loadFailed)
  }

  void reload()

  return {
    reload,
    dispose() {
      disposed = true
      if (statusTimer !== null) cancel(statusTimer)
      statusTimer = null
      closeModal()
      unsubscribe()
      root.textContent = ''
      root.classList.remove(`${CLS}-root`)
      root.removeAttribute('data-vet-page')
    },
  }
}
