// @vitest-environment jsdom
// 五 Tab 设置页作用域接入测试（工单 #55 切片 2）：settingsContext facet
// 消费（判空降级 = 无作用域相关 UI，页面其余功能完整）、写入目标层跟随
// scopeState().scope、onScopeChange 分发后重拉对齐、规则 Tab 用户级标注
// （决策 8：规则数据 globalStorage 语义用户级，无作用域 UI）。facet 注入
// 用 fake（对齐 vendor AddonSettingsContextFacet 接口形状；locateTarget
// 双面为切片 3 消费对象，fake 中给桩）。数据链装配对齐
// test/settings-tabs-ui.test.ts（真实 HostRulesService + mock storage）；
// 设置主题 mock 为两层存储模型（user / workspace 层合并出 values+sources）。
import { afterEach, describe, expect, it } from 'vitest'
import { mountSettingsPage, type SettingsChannelLike, type SettingsPageViewHandle } from '../src/settingsTabsUi'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'
import { zhMessages } from '../src/i18n'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type { AddonSettingsContextFacet } from '../types/vendor/shared/addonSettingsContextApi'
import type { AddonStorageFacet, AddonStorageWatchHandle } from '../types/vendor/shared/addonStorage'

// ===== mock 设施 =====

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

/** 两层设置存储模型（对齐平台 user=globalState / workspace=workspaceState 语义）：
 *  values = user 层覆盖 workspace 层合并；sources = 逐键解析来源 */
interface LayeredSettingsStore {
  userValues: Record<string, unknown>
  wsValues: Record<string, unknown>
  updateCalls: Array<{ scope: string; patch: Record<string, unknown> }>
  clearCalls: string[]
  failReason: string | null
  clearFailReason: string | null
  getCount: number
}

/** fake facet（对齐 vendor AddonSettingsContextFacet 全形状；set 即分发） */
function fakeFacet(initial: { scope: 'user' | 'workspace'; hasWorkspace: boolean } = { scope: 'user', hasWorkspace: true }) {
  let state = initial
  const listeners = new Set<(next: typeof initial) => void>()
  const facet: AddonSettingsContextFacet = {
    scopeState: () => state,
    onScopeChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    // 切片 3 消费对象；桩保持接口形状完整
    locateTarget: () => null,
    onLocateTarget: () => () => {},
  }
  return {
    facet,
    apply(next: { scope: 'user' | 'workspace'; hasWorkspace: boolean }): void {
      state = next
      for (const listener of listeners) listener(state)
    },
  }
}

/** 端到端装配：mock storage → 宿主规则服务 → 通道（规则 + 设置两层主题） */
function assemble() {
  const mock = mockStorage()
  const service = new HostRulesService(mock.storage, {
    now: () => 1_000_000,
    setTimeout: (fn) => {
      void fn() // 去抖即时
      return 0
    },
    clearTimeout: () => {},
  })
  const handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  const registry: AddonChannelRegistry = {
    handle: (topic, handler) => {
      handlers.set(topic, handler)
      return { dispose: () => handlers.delete(topic) }
    },
  }
  registerRulesChannels(registry, service)
  const store: LayeredSettingsStore = {
    userValues: {},
    wsValues: {},
    updateCalls: [],
    clearCalls: [],
    failReason: null,
    clearFailReason: null,
    getCount: 0,
  }
  handlers.set(SETTINGS_TOPIC.get, () => {
    store.getCount += 1
    const values = { ...store.userValues, ...store.wsValues }
    const sources: Record<string, string> = {}
    for (const key of [...Object.keys(store.userValues), ...Object.keys(store.wsValues)]) {
      sources[key] = Object.prototype.hasOwnProperty.call(store.wsValues, key) ? 'workspace' : 'user'
    }
    return { values, sources, effective: { ...DEFAULT_EFFECTIVE_SETTINGS, excludeFiles: [...DEFAULT_EFFECTIVE_SETTINGS.excludeFiles], ...values } }
  })
  handlers.set(SETTINGS_TOPIC.update, (raw: unknown) => {
    const payload = raw as { scope: string; patch: Record<string, unknown> }
    store.updateCalls.push(payload)
    if (store.failReason) return { ok: false, reason: store.failReason }
    const target = payload.scope === 'workspace' ? store.wsValues : store.userValues
    Object.assign(target, payload.patch)
    return { ok: true }
  })
  handlers.set(SETTINGS_TOPIC.clearOverride, (raw: unknown) => {
    const key = (raw as { key: string }).key
    store.clearCalls.push(key)
    if (store.clearFailReason) return { ok: false, reason: store.clearFailReason }
    delete store.wsValues[key]
    return { ok: true }
  })
  const request = async (
    topic: string,
    payload: unknown,
  ): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> => {
    const handler = handlers.get(topic)
    if (!handler) return { ok: false, reason: 'rejected' }
    try {
      return { ok: true, result: await handler(payload) }
    } catch {
      return { ok: false, reason: 'rejected' }
    }
  }
  return { mock, service, store, request }
}

async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

interface MountOptions {
  facet?: AddonSettingsContextFacet
}

/** 挂载五 Tab 设置页（装载链冲刷后返回） */
async function mountPage(request: SettingsChannelLike['request'], mountOptions: MountOptions = {}): Promise<{
  view: SettingsPageViewHandle
  root: HTMLElement
}> {
  const root = document.createElement('div')
  document.body.append(root)
  const view = mountSettingsPage(root, {
    channel: { request },
    messages: zhMessages,
    localeTag: 'zh-cn',
    doc: document,
    setTimeout: () => 0,
    clearTimeout: () => {},
    settingsContext: mountOptions.facet,
  })
  await flush()
  return { view, root }
}

function q<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`selector not found: ${selector}`)
  return node
}

function panel(root: ParentNode, tabId: string): HTMLElement {
  return q(root, `[data-vet-panel="${tabId}"]`)
}

function rowControl(root: ParentNode, key: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const row = q(root, `[data-vet-setting-key="${key}"]`)
  return q<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(row, 'input, select, textarea')
}

function changeValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string | boolean,
): void {
  if (typeof value === 'boolean') {
    ;(control as HTMLInputElement).checked = value
  } else {
    control.value = value
  }
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

afterEach(() => {
  document.body.textContent = ''
})

// ===== settingsContext facet 判空降级 =====

describe('settingsContext facet 判空降级（旧宿主 / 编辑器页形态）', () => {
  it('无 facet：页面其余功能完整（24 行渲染 + 写入可用），写入 scope 固定 user', async () => {
    const { store, request } = assemble()
    const { root } = await mountPage(request)
    expect(root.querySelectorAll('[data-vet-setting-key]')).toHaveLength(24)
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { tabout: false } }])
    expect(store.userValues.tabout).toBe(false)
  })

  it('无 facet：workspace 层来源也不渲染徽章/清除入口/合并值提示（无作用域相关 UI）', async () => {
    const { store, request } = assemble()
    store.wsValues.tabout = true
    const { root } = await mountPage(request)
    // 降级形态钉「不可见」而非「不在 DOM」：徽章节点常驻（hidden 隐藏，
    // 不进可访问树），facet 缺席时 sources 不驱动任何作用域 UI 呈现
    expect(root.querySelectorAll('[data-vet-source-badge]:not([hidden])')).toHaveLength(0)
    expect(root.querySelectorAll('[data-vet-clear-override]:not([hidden])')).toHaveLength(0)
    expect(root.querySelectorAll('[data-vet-merged-hint]:not([hidden])')).toHaveLength(0)
  })
})

// ===== 写入目标层跟随作用域 =====

describe('写入目标层跟随作用域（scopeState 只读面）', () => {
  it('scopeState=workspace：写入 scope 跟随为 workspace，落 workspace 层', async () => {
    const { store, request } = assemble()
    const fake = fakeFacet({ scope: 'workspace', hasWorkspace: true })
    const { root } = await mountPage(request, { facet: fake.facet })
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'workspace', patch: { tabout: false } }])
    expect(store.wsValues.tabout).toBe(false)
    expect(store.userValues.tabout).toBeUndefined()
  })

  it('scopeState=user（facet 在场）：写入仍落 user 层', async () => {
    const { store, request } = assemble()
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    changeValue(rowControl(root, 'smartPaste'), false)
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { smartPaste: false } }])
    expect(store.userValues.smartPaste).toBe(false)
  })

  it('onScopeChange 分发后重拉对齐显示（getCount 增加，控件值刷新）', async () => {
    const { store, request } = assemble()
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(true)
    store.userValues.tabout = false
    const before = store.getCount
    fake.apply({ scope: 'workspace', hasWorkspace: true })
    await flush()
    expect(store.getCount).toBeGreaterThan(before)
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(false)
  })

  it('dispose 退订 onScopeChange（分发不再触发重拉）', async () => {
    const { store, request } = assemble()
    const fake = fakeFacet()
    const { view } = await mountPage(request, { facet: fake.facet })
    view.dispose()
    store.userValues.tabout = false
    const before = store.getCount
    fake.apply({ scope: 'workspace', hasWorkspace: true })
    await flush()
    expect(store.getCount).toBe(before)
  })

  it('workspace 层写入被宿主拒绝（no-workspace）：状态行提示 reason，控件重拉回滚', async () => {
    const { store, request } = assemble()
    const fake = fakeFacet({ scope: 'workspace', hasWorkspace: false })
    const { root } = await mountPage(request, { facet: fake.facet })
    store.failReason = 'no-workspace'
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain('no-workspace')
    // 拒绝后控件回滚为 effective 真值（默认 true）
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(true)
  })
})

// ===== 规则 Tab 用户级标注（决策 8） =====

describe('规则 Tab 用户级标注', () => {
  it('内置规则/自定义规则 panel 有用户级标注（用户级、全局共享、不随工作区隔离）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const notes = root.querySelectorAll('[data-vet-rules-scope="user"]')
    expect(notes).toHaveLength(2)
    expect(panel(root, 'builtin-rules').contains(notes[0])).toBe(true)
    expect(panel(root, 'user-rules').contains(notes[1])).toBe(true)
    for (const note of notes) {
      expect(note.textContent).toContain('用户级')
      expect(note.textContent).toContain('不随工作区隔离')
    }
  })

  it('spacing 分区用户级标注（审查轮 R2-P2-3）：挂分区近旁、不泛化整 Tab、其他 panel 无', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const autoPanel = panel(root, 'auto-format')
    // 「语言间空格策略」分区数据写全局 rule-state（用户级）——标注在场
    const note = autoPanel.querySelector<HTMLElement>('[data-vet-spacing-scope="user"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toContain('用户级')
    expect(note!.textContent).toContain('不随工作区隔离')
    // 标注紧邻分区：spacing 分区挂载 host 的前一个兄弟即标注
    const spacingSection = q(root, '[data-vet-section="spacing"]')
    expect(spacingSection.parentElement!.previousElementSibling).toBe(note)
    // 不泛化整 Tab：规则 Tab 专属标注形态不落在自动格式化 panel
    expect(autoPanel.querySelector('[data-vet-rules-scope]')).toBeNull()
    // 其余 panel 无 spacing 标注
    for (const tabId of ['edit-enhance', 'builtin-rules', 'user-rules', 'other'] as const) {
      expect(panel(root, tabId).querySelector('[data-vet-spacing-scope]'), tabId).toBeNull()
    }
  })

  it('无 facet（降级形态）规则标注仍在（静态数据级说明，非作用域 UI）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(root.querySelectorAll('[data-vet-rules-scope="user"]')).toHaveLength(2)
  })
})

// ===== 行级来源徽章与清除工作区覆盖 =====

describe('行级来源徽章（sources 驱动，仅 workspace 覆盖行）', () => {
  it('workspace 覆盖行显示徽章 + 清除按钮；user 层行不显示', async () => {
    const { store, request } = assemble()
    store.wsValues.tabout = true
    store.userValues.smartPaste = false
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    const taboutRow = q(root, '[data-vet-setting-key="tabout"]')
    const badge = q(taboutRow, '[data-vet-source-badge="workspace"]')
    expect(badge.textContent).toBe(zhMessages.settingsTabs.badgeWorkspaceOverride)
    expect(badge.hidden).toBe(false)
    expect(q(taboutRow, '[data-vet-clear-override="tabout"]').hidden).toBe(false)
    const smartRow = q(root, '[data-vet-setting-key="smartPaste"]')
    expect(smartRow.querySelector<HTMLElement>('[data-vet-source-badge]')?.hidden ?? true).toBe(true)
    expect(smartRow.querySelector<HTMLElement>('[data-vet-clear-override]')?.hidden ?? true).toBe(true)
    // 其余未覆盖行无可见徽章
    expect(root.querySelectorAll('[data-vet-source-badge]:not([hidden])')).toHaveLength(1)
  })

  it('写入 workspace 层后徽章出现（写后重拉 sources 生效）', async () => {
    const { request } = assemble()
    const fake = fakeFacet({ scope: 'workspace', hasWorkspace: true })
    const { root } = await mountPage(request, { facet: fake.facet })
    const taboutRow = q(root, '[data-vet-setting-key="tabout"]')
    expect(taboutRow.querySelector('[data-vet-source-badge]')).not.toBeNull()
    expect(q(taboutRow, '[data-vet-source-badge]').hidden).toBe(true)
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    expect(q(taboutRow, '[data-vet-source-badge]').hidden).toBe(false)
  })

  it('清除按钮 title 写准语义：恢复继承用户默认，非恢复出厂', async () => {
    const { store, request } = assemble()
    store.wsValues.tabout = true
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    const btn = q<HTMLButtonElement>(q(root, '[data-vet-setting-key="tabout"]'), '[data-vet-clear-override]')
    expect(btn.title).toContain('用户默认')
    expect(btn.title).toContain('非恢复出厂')
  })
})

describe('清除工作区覆盖（SETTINGS_TOPIC.clearOverride）', () => {
  it('点击清除：载荷 {key}，成功后重拉 + 状态行 success + 徽章消失 + 值回退用户层', async () => {
    const { store, request } = assemble()
    store.userValues.tabout = true
    store.wsValues.tabout = false
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    // workspace 覆盖生效（effective = false）
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(false)
    const before = store.getCount
    q<HTMLButtonElement>(q(root, '[data-vet-setting-key="tabout"]'), '[data-vet-clear-override]').click()
    await flush()
    expect(store.clearCalls).toEqual(['tabout'])
    expect(store.getCount).toBeGreaterThan(before)
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('success')
    expect(status.textContent).toContain(zhMessages.settingsTabs.statusOverrideCleared)
    expect(q(root, '[data-vet-setting-key="tabout"] [data-vet-source-badge]').hidden).toBe(true)
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(true)
  })

  it('清除失败（no-workspace）：状态行 failed 含 reason，徽章保持', async () => {
    const { store, request } = assemble()
    store.wsValues.tabout = true
    store.clearFailReason = 'no-workspace'
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    q<HTMLButtonElement>(q(root, '[data-vet-setting-key="tabout"]'), '[data-vet-clear-override]').click()
    await flush()
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain(zhMessages.settingsTabs.statusClearOverrideFailed)
    expect(status.textContent).toContain('no-workspace')
    expect(q(root, '[data-vet-setting-key="tabout"] [data-vet-source-badge]').hidden).toBe(false)
  })
})

// ===== 用户默认层下的工作区合并值提示（审查轮 R2-P2-1 平台缺口过渡处置）=====

// 平台 SDK get() 仅合并语义（vendor AddonSettingsService.get → {values, sources}），
// 用户层被工作区覆盖的原值不可读——按层读取依赖 ONEGAYI/vsidian#590
// （「附加组件设置 SDK 暴露按层读取」）。过渡语义：scope=user 且
// sources[key]=workspace 的行显示合并值 + 徽章 + 增强提示；本组测试钉住
// 过渡形态，平台按层读取落地后随 #590 回收改写。
describe('用户默认层下的工作区合并值提示（审查轮 R2-P2-1，待 ONEGAYI/vsidian#590）', () => {
  it('scope=user：显示合并值 + 徽章 + 增强提示（user 层 true / workspace 层 false → 显示 false）', async () => {
    const { store, request } = assemble()
    store.userValues.tabout = true
    store.wsValues.tabout = false
    const fake = fakeFacet() // scope: 'user'
    const { root } = await mountPage(request, { facet: fake.facet })
    const row = q(root, '[data-vet-setting-key="tabout"]')
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(false) // 合并值（workspace 胜出）
    expect(q(row, '[data-vet-source-badge="workspace"]').hidden).toBe(false)
    const hint = q(row, '[data-vet-merged-hint]')
    expect(hint.hidden).toBe(false)
    expect(hint.textContent).toBe(zhMessages.settingsTabs.mergedValueHint)
  })

  it('scope=workspace：同快照无「用户层」提示（徽章照常——提示仅用户层视角）', async () => {
    const { store, request } = assemble()
    store.userValues.tabout = true
    store.wsValues.tabout = false
    const fake = fakeFacet({ scope: 'workspace', hasWorkspace: true })
    const { root } = await mountPage(request, { facet: fake.facet })
    const row = q(root, '[data-vet-setting-key="tabout"]')
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(false)
    expect(q(row, '[data-vet-source-badge="workspace"]').hidden).toBe(false)
    expect(q(row, '[data-vet-merged-hint]').hidden).toBe(true)
  })

  it('作用域切换驱动提示显隐：user→workspace 后提示隐藏（徽章保持）', async () => {
    const { store, request } = assemble()
    store.userValues.tabout = true
    store.wsValues.tabout = false
    const fake = fakeFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    expect(q(root, '[data-vet-setting-key="tabout"] [data-vet-merged-hint]').hidden).toBe(false)
    fake.apply({ scope: 'workspace', hasWorkspace: true })
    await flush()
    expect(q(root, '[data-vet-setting-key="tabout"] [data-vet-merged-hint]').hidden).toBe(true)
    expect(q(root, '[data-vet-setting-key="tabout"] [data-vet-source-badge]').hidden).toBe(false)
  })
})
