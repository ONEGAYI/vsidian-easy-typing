// @vitest-environment jsdom
// 五 Tab 设置页搜索定位接入测试（工单 #55 切片 3）：settingsContext facet
// 的 locateTarget / onLocateTarget 消费——首开回放（订阅即回放 + 装配初值
// 拉取）、已开立即交付、def/group 两类映射（切 Tab + 滚动 + data-located
// 高亮，对齐 vsidian 侧绘制层断言口径）、未知键静默降级、重复目标重入
// （平台刻意不去重，组件幂等）、null 清除、定位早于首次渲染（get 未返回）
// 的排队补投、dispose 退订、与作用域重拉共存（refreshSettings 单行刷新
// 不重建 DOM，高亮不丢）。facet 注入用 fake（订阅即回放语义对齐平台契约
// types/vendor/shared/addonSettingsContextApi.ts）；scrollIntoView 在 jsdom
// 无实现——stub 到 Element.prototype 记录调用。数据链装配对齐
// test/settings-tabs-scope.test.ts（真实 HostRulesService + mock storage；
// 设置主题两层存储模型，另支持 get 挂起以驱动排队补投时序）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountSettingsPage, type SettingsChannelLike, type SettingsPageViewHandle } from '../src/settingsTabsUi'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'
import { zhMessages } from '../src/i18n'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonSettingsContextFacet,
  AddonSettingsLocateTarget,
  AddonSettingsScopeSnapshot,
} from '../types/vendor/shared/addonSettingsContextApi'
import type { AddonStorageFacet, AddonStorageWatchHandle } from '../types/vendor/shared/addonStorage'

// ===== mock 设施（对齐 settings-tabs-scope.test.ts；另加 get 挂起门） =====

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

/** fake facet：locate 状态 + 订阅即回放（对齐平台契约）+ scope 双面 */
function fakeContextFacet(initialTarget: AddonSettingsLocateTarget | null = null) {
  let target = initialTarget
  let scope: AddonSettingsScopeSnapshot = { scope: 'user', hasWorkspace: true }
  const locateListeners = new Set<(target: AddonSettingsLocateTarget | null) => void>()
  const scopeListeners = new Set<(state: AddonSettingsScopeSnapshot) => void>()
  const facet: AddonSettingsContextFacet = {
    scopeState: () => scope,
    onScopeChange: (listener) => {
      scopeListeners.add(listener)
      return () => {
        scopeListeners.delete(listener)
      }
    },
    locateTarget: () => target,
    onLocateTarget: (listener) => {
      locateListeners.add(listener)
      // 订阅即回放挂起目标（平台契约：页面装载晚于定位到达的补投；null 同投）
      listener(target)
      return () => {
        locateListeners.delete(listener)
      }
    },
  }
  return {
    facet,
    deliver(next: AddonSettingsLocateTarget | null): void {
      target = next
      for (const listener of locateListeners) listener(next)
    },
    applyScope(next: AddonSettingsScopeSnapshot): void {
      scope = next
      for (const listener of scopeListeners) listener(next)
    },
  }
}

/** 端到端装配：mock storage → 宿主规则服务 → 通道（规则 + 设置两层主题）；
 *  getGate 非 null 时 SETTINGS_TOPIC.get 结算被挂起直至 release */
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
  const userValues: Record<string, unknown> = {}
  const wsValues: Record<string, unknown> = {}
  let getCount = 0
  let getGate: { promise: Promise<void>; release: () => void } | null = null
  function holdGet(): void {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
      release = resolve
    })
    getGate = { promise, release }
  }
  handlers.set(SETTINGS_TOPIC.get, async () => {
    if (getGate) await getGate.promise
    getCount += 1
    const values = { ...userValues, ...wsValues }
    const sources: Record<string, string> = {}
    for (const key of [...Object.keys(userValues), ...Object.keys(wsValues)]) {
      sources[key] = Object.prototype.hasOwnProperty.call(wsValues, key) ? 'workspace' : 'user'
    }
    return {
      values,
      sources,
      effective: { ...DEFAULT_EFFECTIVE_SETTINGS, excludeFiles: [...DEFAULT_EFFECTIVE_SETTINGS.excludeFiles], ...values },
    }
  })
  handlers.set(SETTINGS_TOPIC.update, (raw: unknown) => {
    const payload = raw as { scope: string; patch: Record<string, unknown> }
    Object.assign(payload.scope === 'workspace' ? wsValues : userValues, payload.patch)
    return { ok: true }
  })
  handlers.set(SETTINGS_TOPIC.clearOverride, (raw: unknown) => {
    delete wsValues[(raw as { key: string }).key]
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
  return {
    mock,
    service,
    request,
    getCount: () => getCount,
    holdGet,
    releaseGet(): void {
      getGate?.release()
      getGate = null
    },
  }
}

async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

interface MountOptions {
  facet?: AddonSettingsContextFacet
}

/** 挂载五 Tab 设置页（装载链冲刷后返回；get 挂起场景由调用方先行 holdGet） */
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

// ===== scrollIntoView stub（jsdom 无实现；记录元素与参数） =====

interface ScrollCall {
  element: Element
  options: ScrollIntoViewOptions | undefined
}
const scrolls: ScrollCall[] = []

beforeEach(() => {
  scrolls.length = 0
  Element.prototype.scrollIntoView = function (this: Element, options?: ScrollIntoViewOptions) {
    scrolls.push({ element: this, options })
  } as Element['scrollIntoView']
})

afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView
  document.body.textContent = ''
})

// ===== 首开回放（订阅即回放 + 装配初值拉取） =====

describe('首开回放（挂起目标在装载时补投）', () => {
  it('订阅前已有目标：装载 + 首次渲染结算后切 Tab、标 data-located、滚动 nearest', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet({ kind: 'def', key: 'autoFormat' })
    const { view, root } = await mountPage(request, { facet: fake.facet })
    expect(view.activeTab()).toBe('auto-format')
    const row = q(root, '[data-vet-setting-key="autoFormat"]')
    expect(row.getAttribute('data-located')).toBe('def:autoFormat')
    expect(row.classList.contains('vsidian-easy-typing-located')).toBe(true)
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]!.element).toBe(row)
    expect(scrolls[0]!.options).toEqual({ block: 'nearest' })
  })

  it('装配初值与订阅回放双投只落一次高亮（幂等，重复滚动不叠加）', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet({ kind: 'def', key: 'tabout' })
    const { root } = await mountPage(request, { facet: fake.facet })
    expect(root.querySelectorAll('[data-located]')).toHaveLength(1)
  })
})

// ===== 已开立即交付 =====

describe('已开立即交付（首次渲染结算后的到达即时生效）', () => {
  it('deliver 后同步切 Tab + 高亮 + 滚动（无需等待 get）', async () => {
    const { request, getCount } = assemble()
    const fake = fakeContextFacet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    const before = getCount()
    fake.deliver({ kind: 'def', key: 'strictLineMode' })
    expect(view.activeTab()).toBe('other')
    const row = q(root, '[data-vet-setting-key="strictLineMode"]')
    expect(row.getAttribute('data-located')).toBe('def:strictLineMode')
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]!.element).toBe(row)
    expect(getCount()).toBe(before) // 立即交付不触发重拉
  })
})

// ===== def / group 两类映射与滚动 =====

describe('def / group 两类映射', () => {
  it('def：切到设置行所在 Tab，行滚动进可视区并高亮', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'def', key: 'excludeFiles' })
    expect(view.activeTab()).toBe('auto-format')
    const row = q(root, '[data-vet-setting-key="excludeFiles"]')
    expect(row.getAttribute('data-located')).toBe('def:excludeFiles')
    expect(scrolls[0]!.element).toBe(row)
  })

  it('group：切到组所在 Tab，组首卡片滚动进可视区并高亮', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'group', key: 'experimental' })
    expect(view.activeTab()).toBe('other')
    const card = q(root, '[data-vet-card="experimental"]')
    expect(card.getAttribute('data-located')).toBe('group:experimental')
    expect(scrolls[0]!.element).toBe(card)
  })

  it('group 特例：general 组锚到排除文件卡片（excludeFiles 随上游归自动格式化）', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'group', key: 'general' })
    expect(view.activeTab()).toBe('auto-format')
    const card = q(root, '[data-vet-card="excludeFiles"]')
    expect(card.getAttribute('data-located')).toBe('group:general')
  })
})

// ===== 未知键静默降级 =====

describe('未知键静默降级（不报错、不切换、不高亮、不滚动）', () => {
  it('def 未知键：保持当前 Tab，无 data-located，无滚动', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'def', key: 'no-such-key' })
    expect(view.activeTab()).toBe('edit-enhance')
    expect(root.querySelectorAll('[data-located]')).toHaveLength(0)
    expect(scrolls).toHaveLength(0)
  })

  it('group 未知键：同样静默（组路由抛错被定位链路吸收）', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'group', key: 'no-such-group' })
    expect(view.activeTab()).toBe('edit-enhance')
    expect(root.querySelectorAll('[data-located]')).toHaveLength(0)
    expect(scrolls).toHaveLength(0)
  })
})

// ===== 幂等与重入（平台刻意不做等值去重） =====

describe('重复目标重入（可重入，重新滚动/高亮）', () => {
  it('同一目标重复交付：再次滚动，高亮保持单份', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'def', key: 'tabout' })
    expect(scrolls).toHaveLength(1)
    fake.deliver({ kind: 'def', key: 'tabout' })
    expect(scrolls).toHaveLength(2)
    expect(root.querySelectorAll('[data-located]')).toHaveLength(1)
    expect(q(root, '[data-vet-setting-key="tabout"]').getAttribute('data-located')).toBe('def:tabout')
  })

  it('换目标：旧高亮清除，新高亮落位（全局单高亮）', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'def', key: 'tabout' })
    fake.deliver({ kind: 'group', key: 'experimental' })
    expect(root.querySelectorAll('[data-located]')).toHaveLength(1)
    expect(q(root, '[data-vet-setting-key="tabout"]').getAttribute('data-located')).toBeNull()
    expect(q(root, '[data-vet-card="experimental"]').getAttribute('data-located')).toBe('group:experimental')
  })
})

// ===== null 清除 =====

describe('null 目标清除高亮', () => {
  it('已高亮后投 null：data-located 与样式类移除', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'def', key: 'tabout' })
    const row = q(root, '[data-vet-setting-key="tabout"]')
    expect(row.getAttribute('data-located')).not.toBeNull()
    fake.deliver(null)
    expect(row.getAttribute('data-located')).toBeNull()
    expect(row.classList.contains('vsidian-easy-typing-located')).toBe(false)
  })

  it('null 同时丢弃排队中的目标（补投不再落位）', async () => {
    const { request, holdGet, releaseGet } = assemble()
    const fake = fakeContextFacet({ kind: 'def', key: 'debug' })
    holdGet()
    const { root } = await mountPage(request, { facet: fake.facet })
    fake.deliver(null)
    releaseGet()
    await flush()
    expect(root.querySelectorAll('[data-located]')).toHaveLength(0)
    expect(scrolls).toHaveLength(0)
  })
})

// ===== 定位早于首次渲染的排队补投（首开回放时序） =====

describe('定位早于设置渲染完成（get 未返回）排队补投', () => {
  it('get 挂起期间不高亮不切换；get 结算后补投落位', async () => {
    const { request, holdGet, releaseGet } = assemble()
    const fake = fakeContextFacet({ kind: 'def', key: 'debug' })
    holdGet()
    const { view, root } = await mountPage(request, { facet: fake.facet })
    // 初值拉取与订阅回放都已到达，但首次渲染未结算：排队中
    expect(view.activeTab()).toBe('edit-enhance')
    expect(root.querySelectorAll('[data-located]')).toHaveLength(0)
    expect(scrolls).toHaveLength(0)
    releaseGet()
    await flush()
    expect(view.activeTab()).toBe('other')
    const row = q(root, '[data-vet-setting-key="debug"]')
    expect(row.getAttribute('data-located')).toBe('def:debug')
    expect(scrolls).toHaveLength(1)
    expect(scrolls[0]!.element).toBe(row)
  })
})

// ===== dispose 生命周期 =====

describe('dispose 后不再消费定位', () => {
  it('dispose 退订 onLocateTarget：后续交付不滚动不高亮不抛错', async () => {
    const { request } = assemble()
    const fake = fakeContextFacet()
    const { view } = await mountPage(request, { facet: fake.facet })
    view.dispose()
    fake.deliver({ kind: 'def', key: 'tabout' })
    expect(scrolls).toHaveLength(0)
  })
})

// ===== 与作用域重拉共存 =====

describe('定位高亮与作用域重拉共存', () => {
  it('定位后 onScopeChange 触发重拉：高亮仍在（单行刷新不重建 DOM）', async () => {
    const { request, getCount } = assemble()
    const fake = fakeContextFacet()
    const { root } = await mountPage(request, { facet: fake.facet })
    fake.deliver({ kind: 'def', key: 'tabout' })
    const row = q(root, '[data-vet-setting-key="tabout"]')
    expect(row.getAttribute('data-located')).toBe('def:tabout')
    const before = getCount()
    fake.applyScope({ scope: 'workspace', hasWorkspace: true })
    await flush()
    expect(getCount()).toBeGreaterThan(before)
    expect(row.getAttribute('data-located')).toBe('def:tabout')
    expect(row.classList.contains('vsidian-easy-typing-located')).toBe(true)
  })
})

// ===== facet 缺席降级 =====

describe('facet 缺席降级（旧宿主 / 编辑器页形态）', () => {
  it('无 facet：页面完整渲染，无任何定位消费痕迹', async () => {
    const { request } = assemble()
    const { view, root } = await mountPage(request)
    expect(root.querySelectorAll('[data-vet-setting-key]')).toHaveLength(24)
    expect(root.querySelectorAll('[data-located]')).toHaveLength(0)
    expect(view.activeTab()).toBe('edit-enhance')
    expect(scrolls).toHaveLength(0)
  })
})
