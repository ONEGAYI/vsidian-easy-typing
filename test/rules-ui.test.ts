// @vitest-environment jsdom
// 规则管理设置页 DOM 冒烟与端到端（工单 #16）：真实 HostRulesService +
// mock storage/registry 装配完整数据链（UI 动作 → RulesSettingsClient →
// RULES_TOPIC → 宿主单写点 → storage），jsdom 驱动 DOM 事件覆盖票面验收
// 「规则全生命周期（建/改/排/启停/导入导出/重置）端到端」与「设置页重开
// 回显」。真实观感与人工交互归 #21 人工验证清单。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountRulesSettingsView, type RulesSettingsViewHandle } from '../src/rulesUi'
import { RulesSettingsClient } from '../src/rules/rules-settings-client'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import { IMPORT_CONTENT_MAX_LENGTH } from '../src/rules/rules-protocol'
import { USER_RULES_FILE } from '../src/rules/rule-store'
import { zhMessages } from '../src/i18n'
import type { RulesChannelLike } from '../src/rules/rules-page'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'

// ===== mock 设施（对齐 test/rules-page.test.ts 端到端组） =====

function mockStorage(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const storage: AddonStorageFacet = {
    uri: () => 'file:///globalStorage/vsidian/addons/ONEGAYI.vsidian-easy-typing/',
    readFile: async (path) => {
      const value = files.get(path)
      return value === undefined ? { ok: false, reason: 'error', detail: 'not-found' } : { ok: true, value }
    },
    writeFile: async (path, content) => {
      files.set(path, content)
      return { ok: true, value: null }
    },
    list: async () => ({
      ok: true,
      entries: [...files.keys()].map((path) => ({ path, kind: 'file' as const })),
    }),
    deleteFile: async (path) => {
      files.delete(path)
      return { ok: true, value: null }
    },
    onDidChangeFile: (): AddonStorageWatchHandle => ({ dispose: () => {} }),
  }
  return { files, storage }
}

function mockRegistry() {
  const handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  const registry: AddonChannelRegistry = {
    handle: (topic, handler) => {
      handlers.set(topic, handler)
      return { dispose: () => handlers.delete(topic) }
    },
  }
  const request: RulesChannelLike['request'] = async (topic, payload) => {
    const handler = handlers.get(topic)
    if (!handler) return { ok: false, reason: 'rejected' }
    try {
      return { ok: true, result: await handler(payload) }
    } catch {
      return { ok: false, reason: 'rejected' }
    }
  }
  return { registry, request }
}

/** 端到端装配：mock storage → 宿主服务 → 通道 */
function assemble(initial: Record<string, string> = {}) {
  const mock = mockStorage(initial)
  const service = new HostRulesService(mock.storage, {
    now: () => 1_000_000,
    setTimeout: (fn) => {
      void fn() // 去抖即时（去抖窗口语义在 rulesHost 测试覆盖）
      return 0
    },
    clearTimeout: () => {},
  })
  const { registry, request } = mockRegistry()
  registerRulesChannels(registry, service)
  return { mock, service, request }
}

/** 宏任务边界冲刷（一轮清空全部 pending 微任务，覆盖装载/写后刷新链） */
async function flush(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 挂载视图（装载链冲刷后返回） */
async function mountView(request: RulesChannelLike['request']): Promise<{
  view: RulesSettingsViewHandle
  root: HTMLElement
  client: RulesSettingsClient
}> {
  const root = document.createElement('div')
  document.body.append(root)
  const client = new RulesSettingsClient({ channel: { request } })
  const view = mountRulesSettingsView(root, {
    client,
    messages: zhMessages,
    doc: document,
    setTimeout: () => 0, // 状态行自动清除不真正计时（测试内常显）
    clearTimeout: () => {},
  })
  await flush()
  return { view, root, client }
}

function q<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`selector not found: ${selector}`)
  return node
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const act = (name: string): string => `[data-vet-action="${name}"]`
const MODAL = '[data-vet-modal]'

afterEach(() => {
  document.body.textContent = ''
})

// ===== 装载与分组渲染 =====

describe('设置页装载与分组渲染', () => {
  it('内置组全量、用户组空态、已停用组零计数、数据目录回显', async () => {
    const { request } = assemble()
    const { root } = await mountView(request)
    expect(root.getAttribute('data-vet-page')).toBe('rules')
    expect(q(root, '[data-vet-builtin-list]').children).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(q(root, '[data-vet-user-list]').textContent).toContain(zhMessages.rulesPage.userRules.empty)
    expect(q(root, '[data-vet-deleted-rules] summary').textContent).toContain('(0)')
    expect(q(root, '[data-vet-storage-uri]').textContent).toContain('globalStorage')
    // 平台引导文案在场（内置逐条开关去行为冲突管理，#1/#3 口径）
    expect(q(root, '[data-vet-section="builtin"]').textContent).toContain('行为冲突管理')
  })

  it('装载失败 → 状态行 loadFailed', async () => {
    const { view } = await mountView(async () => ({ ok: false, reason: 'rejected' }))
    const status = q(document, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain(zhMessages.rulesPage.status.loadFailed)
    view.dispose()
  })
})

// ===== 用户规则全生命周期 =====

async function createRule(root: HTMLElement, trigger: string, replacement: string): Promise<void> {
  q<HTMLButtonElement>(root, `${act('add-rule')}`).click()
  await flush()
  const modal = q<HTMLElement>(root, MODAL)
  expect(modal.classList.contains('vsidian-easy-typing-hidden')).toBe(false)
  typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), trigger)
  typeInto(q<HTMLTextAreaElement>(modal, '[data-vet-input="replacement"]'), replacement)
  q<HTMLButtonElement>(modal, `${act('save')}`).click()
  await flush()
}

describe('用户规则全生命周期（建/改/启停/删）', () => {
  it('新建 → 列表出现 → 修改 → 预览更新 → 启停 → 删除', async () => {
    const { mock, request } = assemble()
    const { root } = await mountView(request)

    await createRule(root, '--', '—')
    let items = q(root, '[data-vet-user-list]').children
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toContain('-- → —')

    // 修改：替换体变更反映到预览
    q<HTMLButtonElement>(items[0]!, `${act('edit')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)
    typeInto(q<HTMLTextAreaElement>(modal, '[data-vet-input="replacement"]'), '~~')
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    items = q(root, '[data-vet-user-list]').children
    expect(items[0]!.textContent).toContain('-- → ~~')

    // 启停：开关 → 宿主落盘 + 视图禁用态
    const toggle = q<HTMLInputElement>(items[0]!, `${act('toggle')}`)
    expect(toggle.checked).toBe(true)
    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(
      q(root, '[data-vet-user-list]').children[0]!.classList.contains('vsidian-easy-typing-rule-disabled'),
    ).toBe(true)
    expect(mock.files.get(USER_RULES_FILE)).toContain('"enabled": false')

    // 删除 → 空态 + 落盘空数组（空态提示是列表唯一子节点）
    q<HTMLButtonElement>(q(root, '[data-vet-user-list]').children[0]!, `${act('delete')}`).click()
    await flush()
    expect(q(root, '[data-vet-user-list]').querySelectorAll('[data-vet-rule-id]')).toHaveLength(0)
    expect(q(root, '[data-vet-user-list]').textContent).toContain(zhMessages.rulesPage.userRules.empty)
    expect(mock.files.get(USER_RULES_FILE)).toBe('[]')
  })

  it('表单校验：空触发式与非法正则拦截保存并显示错误', async () => {
    const { request } = assemble()
    const { root } = await mountView(request)
    q<HTMLButtonElement>(root, `${act('add-rule')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)
    const error = q(modal, '[data-vet-field="formError"]')

    // 空触发式
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    expect(error.textContent).toContain(zhMessages.rulesPage.form.errTriggerRequired)
    expect(modal.classList.contains('vsidian-easy-typing-hidden')).toBe(false)

    // 非法正则（开正则 chip 后填坏模式）
    q<HTMLButtonElement>(modal, '[data-vet-field="isRegexChip"]').click()
    await flush()
    typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), '(bad')
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    expect(error.textContent).toContain(zhMessages.rulesPage.form.invalidRegex)

    // 修正后可保存
    typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), '(a)')
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    expect(q(root, '[data-vet-user-list]').children).toHaveLength(1)
  })

  it('表单形态切换：SelectKey 隐藏正则/右侧匹配、作用域联动语言行', async () => {
    const { mock, request } = assemble()
    const { root } = await mountView(request)
    q<HTMLButtonElement>(root, `${act('add-rule')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)

    const hidden = (sel: string): boolean => q(modal, sel).classList.contains('vsidian-easy-typing-hidden')
    // 初始 Input + Auto：触发方式区可见，flags 行隐藏（未开正则）
    expect(hidden('[data-vet-field="triggerModeSection"]')).toBe(false)
    expect(hidden('[data-vet-field="regexFlags"]')).toBe(true)
    expect(hidden('[data-vet-field="scopeLanguage"]')).toBe(true)

    // Tab 触发选项禁用（审查 A-R4-2：驱动面未到前该模式永不命中，禁用 + 提示）
    const tabPill = q<HTMLButtonElement>(modal, '[data-pill-group="triggerMode"][data-pill-value="tab"]')
    expect(tabPill.disabled).toBe(true)
    expect(tabPill.title).toBe(zhMessages.rulesPage.form.triggerModeTabPending)
    const autoPill = q<HTMLButtonElement>(modal, '[data-pill-group="triggerMode"][data-pill-value="auto"]')
    expect(autoPill.disabled).toBe(false)

    // 切到 SelectKey：右侧匹配、flags、正则 chip、触发方式区隐藏；触发式改名
    q<HTMLButtonElement>(modal, '[data-pill-group="ruleType"][data-pill-value="selectKey"]').click()
    await flush()
    expect(hidden('[data-vet-field="triggerRight"]')).toBe(true)
    expect(hidden('[data-vet-field="regexFlags"]')).toBe(true)
    expect(hidden('[data-vet-field="isRegexChip"]')).toBe(true)
    expect(hidden('[data-vet-field="triggerModeSection"]')).toBe(true)
    expect(q(modal, '[data-vet-role="triggerName"]').textContent).toBe(
      zhMessages.rulesPage.form.fieldTriggerSelectKey,
    )

    // 切回 Input + 开正则：flags 行出现；Code 作用域点亮后语言行出现
    q<HTMLButtonElement>(modal, '[data-pill-group="ruleType"][data-pill-value="input"]').click()
    await flush()
    q<HTMLButtonElement>(modal, '[data-vet-field="isRegexChip"]').click()
    await flush()
    expect(hidden('[data-vet-field="regexFlags"]')).toBe(false)
    q<HTMLButtonElement>(modal, '[data-scope-value="code"]').click()
    await flush()
    expect(hidden('[data-vet-field="scopeLanguage"]')).toBe(false)
    expect(
      q<HTMLButtonElement>(modal, '[data-scope-value="code"]').classList.contains('vsidian-easy-typing-chip-active'),
    ).toBe(true)

    // 保存：options 旗标组合正确（r + c；All 被细分作用域替换）
    typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), 'x')
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    const saved = JSON.parse(mock.files.get(USER_RULES_FILE)!)
    expect(saved).toHaveLength(1)
    expect(saved[0].options).toBe('rc')
  })
})

// ===== 内置规则：停用 / 恢复 / 全部重置 =====

describe('内置规则停用/恢复/重置（deletedBuiltinRuleIds 语义）', () => {
  it('停用 → 已停用组计数与恢复；全部重置清停用清单', async () => {
    const { mock, request } = assemble()
    const { root } = await mountView(request)
    const firstId = DEFAULT_BUILTIN_RULES[0]!.id

    q<HTMLButtonElement>(q(root, `[data-vet-rule-id="${firstId}"]`), `${act('disable-builtin')}`).click()
    await flush()
    expect(q(root, '[data-vet-builtin-list]').children).toHaveLength(DEFAULT_BUILTIN_RULES.length - 1)
    const details = q(root, '[data-vet-deleted-rules]')
    expect(q(details, 'summary').textContent).toContain('(1)')
    // 预览行展示出厂数据 description，条目身份经 data-vet-rule-id 钉住
    expect(q(details, `[data-vet-rule-id="${firstId}"]`)).toBeTruthy()
    expect(mock.files.get('rule-state.json')).toContain(firstId)

    // 恢复单条
    q<HTMLButtonElement>(details, `${act('restore')}`).click()
    await flush()
    expect(q(root, '[data-vet-builtin-list]').children).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(q(root, '[data-vet-deleted-rules] summary').textContent).toContain('(0)')

    // 停用两条后全部重置
    for (const rule of DEFAULT_BUILTIN_RULES.slice(0, 2)) {
      q<HTMLButtonElement>(q(root, `[data-vet-rule-id="${rule.id}"]`), `${act('disable-builtin')}`).click()
      await flush()
    }
    expect(q(root, '[data-vet-builtin-list]').children).toHaveLength(DEFAULT_BUILTIN_RULES.length - 2)
    q<HTMLButtonElement>(root, `${act('reset-all')}`).click()
    await flush()
    expect(q(root, '[data-vet-builtin-list]').children).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(q(root, '[data-vet-deleted-rules] summary').textContent).toContain('(0)')
    expect(q(root, '[data-vet-status]').getAttribute('data-vet-status')).toBe('success')
    expect(mock.files.get('rule-state.json')).toBe(JSON.stringify({ deletedBuiltinRuleIds: [] }, null, 2))
  })
})

// ===== 函数替换体：预注册函数引用选择（#17 解锁） =====

describe('函数替换体引用选择', () => {
  it('既有引用规则：编辑表单展示 ref 下拉 + 源码只读块 + 提示；改触发式保存引用原样', async () => {
    const fnRule = {
      id: 'user-fn-1',
      trigger: '（',
      replacement: { kind: 'function', ref: 'autopairInput' },
      options: 'F',
    }
    const { mock, request } = assemble({ 'user-rules.json': JSON.stringify([fnRule]) })
    const { root } = await mountView(request)
    const items = q(root, '[data-vet-user-list]').children
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toContain(zhMessages.rulesPage.ruleItem.fnTag)

    q<HTMLButtonElement>(items[0]!, `${act('edit')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)
    // 函数面可见：ref 下拉 + 源码块；字符串 textarea 隐藏
    const fnBlock = q(modal, '[data-vet-field="fnEditor"]')
    expect(fnBlock.classList.contains('vsidian-easy-typing-hidden')).toBe(false)
    const fnRefRow = q(modal, '[data-vet-field="functionRefRow"]')
    expect(fnRefRow.classList.contains('vsidian-easy-typing-hidden')).toBe(false)
    expect(
      q(modal, '[data-vet-field="replacementTextarea"]').classList.contains('vsidian-easy-typing-hidden'),
    ).toBe(true)
    // 下拉选中当前 ref；选项仅含 text 签名函数（Input 类规则）
    const select = q<HTMLSelectElement>(modal, '[data-vet-input="functionRef"]')
    expect(select.value).toBe('autopairInput')
    const optionValues = [...select.options].map((o) => o.value)
    expect(optionValues).not.toContain('selWrapQuotes')
    expect(optionValues).toContain('convFormula')
    // 源码只读块展示选中函数本体（关键字着色在场）
    expect(q(fnBlock, '[data-vet-field="fnCode"]').innerHTML).toContain('vsidian-easy-typing-hl-keyword')
    // 提示在场：签名参数 + 组件化 fork 引导
    const hintText = q(fnBlock, '[data-vet-field="fnHint"]').textContent ?? ''
    expect(hintText).toContain(zhMessages.rulesPage.form.functionHintInputDelete)
    expect(hintText).toContain(zhMessages.rulesPage.form.functionReadonlyHint)

    // 改触发式保存：引用原样、ref 不变
    typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), 'y')
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    const persisted = JSON.parse(mock.files.get(USER_RULES_FILE)!)
    expect(persisted[0].trigger).toBe('y')
    expect(persisted[0].replacement).toEqual({ kind: 'function', ref: 'autopairInput' })
    expect(persisted[0].options).toBe('F')
  })

  it('新建流程：函数开关打开 → 预选 text 首项；切换 ref 落盘引用对象', async () => {
    const { mock, request } = assemble({})
    const { root } = await mountView(request)
    q<HTMLButtonElement>(root, `${act('add-rule')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)

    // 打开函数式替换开关
    const fnChip = q<HTMLButtonElement>(modal, '[data-vet-field="isFunctionChip"]')
    expect(fnChip.classList.contains('vsidian-easy-typing-chip-active')).toBe(false)
    fnChip.click()
    expect(fnChip.classList.contains('vsidian-easy-typing-chip-active')).toBe(true)
    // 自动预选当前类型（Input）首个 text 函数（函数表注册序：autopairInput）
    const select = q<HTMLSelectElement>(modal, '[data-vet-input="functionRef"]')
    expect(select.value).toBe('autopairInput')
    // 切换 ref → 保存
    select.value = 'convFormula'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), '￥￥')
    q<HTMLButtonElement>(modal, `${act('save')}`).click()
    await flush()
    const persisted = JSON.parse(mock.files.get(USER_RULES_FILE)!)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].replacement).toEqual({ kind: 'function', ref: 'convFormula' })
    expect(persisted[0].options).toContain('F')
  })

  it('类型切换到选中替换类：签名失配 ref 自动改选 selectKey 首项', async () => {
    const { request } = assemble({})
    const { root } = await mountView(request)
    q<HTMLButtonElement>(root, `${act('add-rule')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)
    q<HTMLButtonElement>(modal, '[data-vet-field="isFunctionChip"]').click()
    // 切到 SelectKey 类型 → 选项换组、ref 改选 selectKey 函数
    q<HTMLButtonElement>(modal, '[data-pill-group="ruleType"][data-pill-value="selectKey"]').click()
    const select = q<HTMLSelectElement>(modal, '[data-vet-input="functionRef"]')
    const optionValues = [...select.options].map((o) => o.value)
    expect(optionValues).toContain('selWrapSymbols')
    expect(optionValues).not.toContain('convFormula')
    expect(optionValues).toContain(select.value)
  })
})

// ===== 拖拽排序（DOM 事件驱动；jsdom 无 DataTransfer，dataTransfer 空挂） =====

describe('拖拽排序', () => {
  it('dragstart/dragover/drop 链驱动 reorder 落盘并写后刷新', async () => {
    const seed = [
      { id: 'u1', trigger: 'a', replacement: 'A' },
      { id: 'u2', trigger: 'b', replacement: 'B' },
      { id: 'u3', trigger: 'c', replacement: 'C' },
    ]
    const { mock, request } = assemble({ 'user-rules.json': JSON.stringify(seed) })
    const { root } = await mountView(request)
    // 写后刷新会重建列表节点——每次实时重查（勿持旧引用）
    const ids = (): string[] =>
      [...q(root, '[data-vet-user-list]').children].map(
        (item) => item.getAttribute('data-vet-rule-id')!,
      )
    expect(ids()).toEqual(['u1', 'u2', 'u3'])
    // 手柄在场
    expect(q(q(root, '[data-vet-user-list]').children[0]!, '.vsidian-easy-typing-drag-handle')).toBeTruthy()

    // jsdom 的 getBoundingClientRect 恒零 → midY=0，clientY>0 即落下半区
    const list = q(root, '[data-vet-user-list]')
    const handle = q(list.children[0]!, '.vsidian-easy-typing-drag-handle')
    handle.dispatchEvent(new Event('dragstart', { bubbles: true }))
    const target = list.children[2]! as HTMLElement
    target.dispatchEvent(new Event('dragenter', { bubbles: true }))
    const over = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(over, 'clientY', { value: 5 })
    target.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(target.classList.contains('vsidian-easy-typing-drag-over-bottom')).toBe(true)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'clientY', { value: 5 })
    target.dispatchEvent(drop)
    await flush()

    // 0 → 2（下半区）：宿主落盘新序，视图写后刷新同步
    expect(JSON.parse(mock.files.get(USER_RULES_FILE)!).map((r: { id: string }) => r.id)).toEqual([
      'u2',
      'u3',
      'u1',
    ])
    expect(ids()).toEqual(['u2', 'u3', 'u1'])
  })
})

// ===== 导入导出 =====

describe('JSON 导入导出', () => {
  it('导入：两条（一重复）→ 成功状态 + 列表增长', async () => {
    const seed = [{ id: 'u1', trigger: 'dup', replacement: 'D' }]
    const { mock, request } = assemble({ 'user-rules.json': JSON.stringify(seed) })
    const { root } = await mountView(request)
    expect(q(root, '[data-vet-user-list]').children).toHaveLength(1)

    q<HTMLButtonElement>(root, `${act('import')}`).click()
    await flush()
    const fileInput = q<HTMLInputElement>(document, 'input[type="file"]')
    const incoming = JSON.stringify([
      { trigger: 'dup', replacement: 'D' },
      { trigger: 'new', replacement: 'N' },
    ])
    const file = new File([incoming], 'rules.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(3)

    expect(q(root, '[data-vet-user-list]').children).toHaveLength(2)
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('success')
    expect(status.textContent).toContain('导入了 1 条规则，跳过 1 条重复规则')
    expect(JSON.parse(mock.files.get(USER_RULES_FILE)!)).toHaveLength(2)
  })

  it('导入非法 JSON → 失败状态；空导出 → 提示无可导出', async () => {
    const { request } = assemble()
    const { root } = await mountView(request)

    q<HTMLButtonElement>(root, `${act('import')}`).click()
    await flush()
    const fileInput = q<HTMLInputElement>(document, 'input[type="file"]')
    const file = new File(['{bad json'], 'rules.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(3)
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain(zhMessages.rulesPage.status.importInvalidJson)

    // 空用户规则导出
    q<HTMLButtonElement>(root, `${act('export')}`).click()
    await flush()
    expect(q(root, '[data-vet-status]').textContent).toContain(zhMessages.rulesPage.status.noRulesToExport)
  })

  it('导入超大文件（>2MB）→ too-large 失败文案（审查 C-P3-4：UI 预检本地拦截，不发通道）', async () => {
    const { request } = assemble()
    const { root } = await mountView(request)

    q<HTMLButtonElement>(root, `${act('import')}`).click()
    await flush()
    const fileInput = q<HTMLInputElement>(document, 'input[type="file"]')
    const huge = 'x'.repeat(IMPORT_CONTENT_MAX_LENGTH + 1)
    const file = new File([huge], 'rules.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(3)
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain(zhMessages.rulesPage.status.importTooLarge)
  })

  it('导出触发浏览器下载（Blob URL + 锚点点击）', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    try {
      const seed = [{ id: 'u1', trigger: 'a', replacement: 'A' }]
      const { request } = assemble({ 'user-rules.json': JSON.stringify(seed) })
      const { root } = await mountView(request)
      q<HTMLButtonElement>(root, `${act('export')}`).click()
      await flush()
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(anchorClick).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    } finally {
      Object.assign(URL, { createObjectURL: originalCreate, revokeObjectURL: originalRevoke })
      anchorClick.mockRestore()
    }
  })
})

// ===== 规则测试编辑器（实时试运行） =====

describe('规则测试编辑器', () => {
  it('输入与光标变化驱动实时试运行（命中/未命中两态）', async () => {
    const { request } = assemble()
    const { root } = await mountView(request)
    q<HTMLButtonElement>(root, `${act('add-rule')}`).click()
    await flush()
    const modal = q<HTMLElement>(root, MODAL)
    const output = q(modal, '[data-vet-test-output]')

    // 未填触发式 → miss
    expect(output.getAttribute('data-vet-test-state')).toBe('miss')

    // 填规则 '--' → '—'，测试文本 a--b 光标 3 → 命中
    typeInto(q<HTMLInputElement>(modal, '[data-vet-input="trigger"]'), '--')
    typeInto(q<HTMLTextAreaElement>(modal, '[data-vet-input="replacement"]'), '—')
    const testInput = q<HTMLTextAreaElement>(modal, '[data-vet-test-input]')
    testInput.value = 'a--b'
    testInput.selectionStart = 3
    testInput.selectionEnd = 3
    testInput.dispatchEvent(new Event('input', { bubbles: true }))
    expect(output.getAttribute('data-vet-test-state')).toBe('hit')
    // 结果文本 = 替换后全文 + ▏标注结果光标位（'--'→'—' 后光标在 2）
    expect(q(output, 'pre').textContent).toBe('a—▏b')
    expect(output.textContent).toContain('[1, 3)')

    // 光标移到不触发的位置 → miss
    testInput.selectionStart = 1
    testInput.selectionEnd = 1
    testInput.dispatchEvent(new Event('keyup', { bubbles: true }))
    expect(output.getAttribute('data-vet-test-state')).toBe('miss')
  })
})

// ===== 设置页重开回显（票面验收） =====

describe('设置页重开回显', () => {
  it('dispose → 重新挂载：全部变更从宿主存储读回（含启停/停用/新建）', async () => {
    const { mock, request } = assemble()
    // 第一代会话：新建一条 + 停用一条内置
    const first = await mountView(request)
    await createRule(first.root, 'zz', 'ZZ')
    const toggle = q<HTMLInputElement>(q(first.root, '[data-vet-user-list]').children[0]!, `${act('toggle')}`)
    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    const firstBuiltinId = DEFAULT_BUILTIN_RULES[0]!.id
    q<HTMLButtonElement>(
      q(first.root, `[data-vet-rule-id="${firstBuiltinId}"]`),
      `${act('disable-builtin')}`,
    ).click()
    await flush()
    first.view.dispose()
    expect(first.root.childElementCount).toBe(0)

    // 第二代会话（同宿主数据）：状态全部回显
    const second = await mountView(request)
    const userItems = q(second.root, '[data-vet-user-list]').children
    expect(userItems).toHaveLength(1)
    expect(userItems[0]!.textContent).toContain('zz → ZZ')
    expect(userItems[0]!.classList.contains('vsidian-easy-typing-rule-disabled')).toBe(true)
    expect(q<HTMLInputElement>(userItems[0]!, `${act('toggle')}`).checked).toBe(false)
    expect(q(second.root, '[data-vet-builtin-list]').children).toHaveLength(
      DEFAULT_BUILTIN_RULES.length - 1,
    )
    expect(q(second.root, '[data-vet-deleted-rules] summary').textContent).toContain('(1)')
    expect(JSON.parse(mock.files.get(USER_RULES_FILE)!)[0].enabled).toBe(false)
  })
})
