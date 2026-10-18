// @vitest-environment jsdom
// 五 Tab 自绘设置页 DOM 测试（工单 #55 切片 1）：Tab 框架（aria/键盘导航/
// 面板常驻 hidden 切换）、hero 顶部块、24 项设置行渲染（元数据驱动控件
// 形态）、SETTINGS_TOPIC 写通道（scope 固定 user + 写后重拉）、联动置灰、
// 规则四分区挂入对应 panel。数据链装配对齐 test/rules-ui.test.ts（真实
// HostRulesService + mock storage/registry）；设置通道为页面侧 mock 主题
// handler。真实观感归 #21 人工清单。
import { afterEach, describe, expect, it } from 'vitest'
import {
  mountSettingsPage,
  type SettingsChannelLike,
  type SettingsPageViewHandle,
} from '../src/settingsTabsUi'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'
import { zhMessages } from '../src/i18n'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'

// ===== mock 设施（storage/registry 对齐 rules-ui.test.ts；设置主题就地补充） =====

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

/** 设置主题的可变后端（get/update handler 共享；failReason 模拟写入拒绝） */
interface SettingsStore {
  values: Record<string, unknown>
  updateCalls: Array<{ scope: string; patch: Record<string, unknown> }>
  failReason: string | null
  getCount: number
}

function effectiveOf(values: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_EFFECTIVE_SETTINGS, excludeFiles: [...DEFAULT_EFFECTIVE_SETTINGS.excludeFiles], ...values }
}

/** 端到端装配：mock storage → 宿主规则服务 → 通道（规则 + 设置主题） */
function assemble(initialSettings: Record<string, unknown> = {}) {
  const mock = mockStorage()
  const service = new HostRulesService(mock.storage, {
    now: () => 1_000_000,
    setTimeout: (fn) => {
      void fn() // 去抖即时（去抖窗口语义在 rulesHost 测试覆盖）
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
  const store: SettingsStore = { values: { ...initialSettings }, updateCalls: [], failReason: null, getCount: 0 }
  handlers.set(SETTINGS_TOPIC.get, () => {
    store.getCount += 1
    return { values: { ...store.values }, sources: {}, effective: effectiveOf(store.values) }
  })
  handlers.set(SETTINGS_TOPIC.update, (raw: unknown) => {
    const payload = raw as { scope: string; patch: Record<string, unknown> }
    store.updateCalls.push(payload)
    if (store.failReason) return { ok: false, reason: store.failReason }
    Object.assign(store.values, payload.patch)
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

/** 宏任务边界冲刷（覆盖装载/写后刷新链） */
async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 挂载五 Tab 设置页（装载链冲刷后返回） */
async function mountPage(request: SettingsChannelLike['request']): Promise<{
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
    setTimeout: () => 0, // 状态行自动清除不真正计时（测试内常显）
    clearTimeout: () => {},
  })
  await flush()
  return { view, root }
}

function q<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`selector not found: ${selector}`)
  return node
}

function panel(root: ParentNode, tabId: string): HTMLElement {
  return q(root, `[data-vet-panel="${tabId}"]`)
}

function tabButton(root: ParentNode, tabId: string): HTMLButtonElement {
  return q(root, `[data-vet-tab="${tabId}"]`)
}

/** 行内控件（设置行的 input/select/textarea） */
function rowControl(root: ParentNode, key: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const row = q(root, `[data-vet-setting-key="${key}"]`)
  return q<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(row, 'input, select, textarea')
}

function keydown(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
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

const TAB_IDS = ['edit-enhance', 'auto-format', 'builtin-rules', 'user-rules', 'other'] as const

afterEach(() => {
  document.body.textContent = ''
})

// ===== 页面骨架与 Tab 框架 =====

describe('页面骨架与 hero 顶部块', () => {
  it('hero 含项目名与上游来源链接（MIT 双署名致敬）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const hero = q(root, '[data-vet-hero]')
    expect(q(hero, 'h1').textContent).toBe(zhMessages.settingsTabs.heroTitle)
    const link = q<HTMLAnchorElement>(hero, 'a')
    expect(link.getAttribute('href')).toBe('https://github.com/Yaozhuwa/easy-typing-obsidian')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.textContent).toBe(zhMessages.settingsTabs.heroLinkText)
  })

  it('root 标记五 Tab 设置页身份', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(root.classList.contains('vsidian-easy-typing-root')).toBe(true)
    expect(root.getAttribute('data-vet-page')).toBe('settings')
  })

  it('页面级状态行在场（role=status，与规则分区共享）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('role')).toBe('status')
  })
})

describe('Tab 框架（aria / 键盘导航 / 面板常驻 hidden 切换）', () => {
  it('tablist 五按钮：aria 配对完整，默认编辑增强', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const nav = q(root, 'nav[role="tablist"]')
    expect(nav.getAttribute('aria-orientation')).toBe('horizontal')
    const buttons = [...nav.querySelectorAll('[role="tab"]')]
    expect(buttons).toHaveLength(5)
    for (const tabId of TAB_IDS) {
      const btn = tabButton(root, tabId)
      expect(btn.id).toBe(`vsidian-easy-typing-tab-${tabId}`)
      expect(panel(root, tabId).id).toBe(`vsidian-easy-typing-panel-${tabId}`)
      expect(btn.getAttribute('aria-controls')).toBe(panel(root, tabId).id)
      expect(panel(root, tabId).getAttribute('aria-labelledby')).toBe(btn.id)
      expect(btn.textContent).toBe(zhMessages.settingsTabs.tabs[tabId === 'edit-enhance' ? 'editEnhance' : tabId === 'auto-format' ? 'autoFormat' : tabId === 'builtin-rules' ? 'builtinRules' : tabId === 'user-rules' ? 'userRules' : 'other'])
    }
  })

  it('默认编辑增强：唯一选中 + roving tabIndex + 其余面板 hidden/aria-hidden', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(tabButton(root, 'edit-enhance').getAttribute('aria-selected')).toBe('true')
    expect(tabButton(root, 'edit-enhance').tabIndex).toBe(0)
    expect(panel(root, 'edit-enhance').hasAttribute('hidden')).toBe(false)
    expect(panel(root, 'edit-enhance').getAttribute('aria-hidden')).toBe('false')
    for (const tabId of ['auto-format', 'builtin-rules', 'user-rules', 'other'] as const) {
      expect(tabButton(root, tabId).getAttribute('aria-selected')).toBe('false')
      expect(tabButton(root, tabId).tabIndex).toBe(-1)
      expect(panel(root, tabId).hasAttribute('hidden')).toBe(true)
      expect(panel(root, tabId).getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('面板常驻 DOM：五个 panel 始终在场（spacing 防御网时序不变）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const panels = [...root.querySelectorAll('[role="tabpanel"]')]
    expect(panels).toHaveLength(5)
    for (const tabId of TAB_IDS) {
      expect(root.contains(panel(root, tabId))).toBe(true)
    }
  })

  it('switchTab 受控切换：hidden 与 aria 同步移动，activeTab 返回当前', async () => {
    const { request } = assemble()
    const { view, root } = await mountPage(request)
    expect(view.activeTab()).toBe('edit-enhance')
    view.switchTab('other')
    expect(view.activeTab()).toBe('other')
    expect(tabButton(root, 'other').getAttribute('aria-selected')).toBe('true')
    expect(panel(root, 'other').hasAttribute('hidden')).toBe(false)
    expect(panel(root, 'edit-enhance').hasAttribute('hidden')).toBe(true)
    expect(tabButton(root, 'edit-enhance').getAttribute('aria-selected')).toBe('false')
  })

  it('键盘导航：ArrowRight/ArrowLeft 循环、Home/End、焦点落目标按钮', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const first = tabButton(root, 'edit-enhance')
    keydown(first, 'ArrowRight')
    expect(tabButton(root, 'auto-format').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabButton(root, 'auto-format'))
    keydown(tabButton(root, 'auto-format'), 'ArrowRight')
    expect(tabButton(root, 'builtin-rules').getAttribute('aria-selected')).toBe('true')
    keydown(tabButton(root, 'edit-enhance'), 'ArrowLeft')
    expect(tabButton(root, 'other').getAttribute('aria-selected')).toBe('true')
    keydown(tabButton(root, 'other'), 'Home')
    expect(tabButton(root, 'edit-enhance').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabButton(root, 'edit-enhance'))
    keydown(tabButton(root, 'edit-enhance'), 'End')
    expect(tabButton(root, 'other').getAttribute('aria-selected')).toBe('true')
  })

  it('键盘导航 ArrowDown/ArrowUp 与左右同效', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    keydown(tabButton(root, 'edit-enhance'), 'ArrowDown')
    expect(tabButton(root, 'auto-format').getAttribute('aria-selected')).toBe('true')
    keydown(tabButton(root, 'auto-format'), 'ArrowUp')
    expect(tabButton(root, 'edit-enhance').getAttribute('aria-selected')).toBe('true')
  })
})

// ===== 24 项设置行渲染 =====

describe('24 项设置行渲染（元数据驱动）', () => {
  it('24 行全覆盖；编辑增强 6 / 自动格式化 14 / 其他设置 4（规则两 Tab 无设置行）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(root.querySelectorAll('[data-vet-setting-key]')).toHaveLength(24)
    expect(panel(root, 'edit-enhance').querySelectorAll('[data-vet-setting-key]')).toHaveLength(6)
    expect(panel(root, 'auto-format').querySelectorAll('[data-vet-setting-key]')).toHaveLength(14)
    expect(panel(root, 'builtin-rules').querySelectorAll('[data-vet-setting-key]')).toHaveLength(0)
    expect(panel(root, 'user-rules').querySelectorAll('[data-vet-setting-key]')).toHaveLength(0)
    expect(panel(root, 'other').querySelectorAll('[data-vet-setting-key]')).toHaveLength(4)
  })

  it('控件形态矩阵：boolean→checkbox、enum→select（zh 档位标签）、string→text、multiline/array→textarea', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(rowControl(root, 'tabout').tagName).toBe('INPUT')
    expect((rowControl(root, 'tabout') as HTMLInputElement).type).toBe('checkbox')
    const select = rowControl(root, 'inlineCodeSpaceMode') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((o) => o.textContent)).toEqual(['不要求空格', '软空格', '严格空格'])
    expect((rowControl(root, 'softSpaceLeftSymbols') as HTMLInputElement).type).toBe('text')
    expect(rowControl(root, 'prefixDictionary').tagName).toBe('TEXTAREA')
    expect(rowControl(root, 'userDefinedRegExp').tagName).toBe('TEXTAREA')
    expect(rowControl(root, 'excludeFiles').tagName).toBe('TEXTAREA')
    const strictSelect = rowControl(root, 'strictLineMode') as HTMLSelectElement
    expect([...strictSelect.options].map((o) => o.textContent)).toEqual(['两次回车', '两个空格加回车', '混合模式'])
  })

  it('行文案来自既有 i18n settings[key].name/desc', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const row = q(root, '[data-vet-setting-key="tabout"]')
    expect(row.textContent).toContain(zhMessages.settings.tabout.name)
    expect(row.textContent).toContain(zhMessages.settings.tabout.desc)
  })

  it('初值经 get 的 effective：布尔/枚举/数组（join 换行）逐形态核对', async () => {
    const { request } = assemble({
      tabout: false,
      inlineCodeSpaceMode: 'strict',
      excludeFiles: ['DailyNote/', 'DailyNote/test.md'],
      softSpaceLeftSymbols: '——',
    })
    const { root } = await mountPage(request)
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(false)
    expect((rowControl(root, 'smartPaste') as HTMLInputElement).checked).toBe(true)
    expect((rowControl(root, 'inlineCodeSpaceMode') as HTMLSelectElement).value).toBe('strict')
    expect((rowControl(root, 'excludeFiles') as HTMLTextAreaElement).value).toBe('DailyNote/\nDailyNote/test.md')
    expect((rowControl(root, 'softSpaceLeftSymbols') as HTMLInputElement).value).toBe('——')
    expect((rowControl(root, 'prefixDictionary') as HTMLTextAreaElement).value).toBe(
      DEFAULT_EFFECTIVE_SETTINGS.prefixDictionary,
    )
  })
})

describe('设置写入通道（SETTINGS_TOPIC.update，scope 固定 user）', () => {
  it('布尔开关写入：scope user + 单键 patch，写后重拉刷新控件', async () => {
    const { store, request } = assemble({ tabout: false })
    const { root } = await mountPage(request)
    const before = store.getCount
    changeValue(rowControl(root, 'tabout'), true)
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { tabout: true } }])
    expect(store.getCount).toBeGreaterThan(before)
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(true)
  })

  it('枚举下拉写入：patch 为所选枚举值', async () => {
    const { store, request } = assemble()
    const { root } = await mountPage(request)
    changeValue(rowControl(root, 'inlineCodeSpaceMode'), 'none')
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { inlineCodeSpaceMode: 'none' } }])
    expect(store.values.inlineCodeSpaceMode).toBe('none')
  })

  it('文本/多行写入：change 事件触发（非逐键）', async () => {
    const { store, request } = assemble()
    const { root } = await mountPage(request)
    const text = rowControl(root, 'softSpaceLeftSymbols') as HTMLInputElement
    text.value = '——…'
    text.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(store.updateCalls).toHaveLength(0)
    changeValue(text, '——…')
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { softSpaceLeftSymbols: '——…' } }])
    changeValue(rowControl(root, 'prefixDictionary'), 'foo, /bar/')
    await flush()
    expect(store.updateCalls[1]).toEqual({ scope: 'user', patch: { prefixDictionary: 'foo, /bar/' } })
  })

  it('excludeFiles 数组拆行写入：trim + 丢弃空行', async () => {
    const { store, request } = assemble()
    const { root } = await mountPage(request)
    changeValue(rowControl(root, 'excludeFiles'), '  a/  \n\nb/c.md\n')
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { excludeFiles: ['a/', 'b/c.md'] } }])
    expect((rowControl(root, 'excludeFiles') as HTMLTextAreaElement).value).toBe('a/\nb/c.md')
  })

  it('写入失败：状态行提示 reason，控件重拉回滚', async () => {
    const { store, request } = assemble({ tabout: true })
    const { root } = await mountPage(request)
    store.failReason = 'no-workspace'
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain(zhMessages.settingsTabs.statusUpdateFailed)
    expect(status.textContent).toContain('no-workspace')
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(true)
    expect(store.values.tabout).toBe(true)
  })
})

describe('联动置灰（纯 UI 态，决策 11）', () => {
  it('autoFormat 关闭：总开关可用，其余自动格式化下行置灰 + 提示', async () => {
    const { request } = assemble({ autoFormat: false })
    const { root } = await mountPage(request)
    const master = rowControl(root, 'autoFormat') as HTMLInputElement
    expect(master.disabled).toBe(false)
    const masterRow = q(root, '[data-vet-setting-key="autoFormat"]')
    expect(masterRow.getAttribute('aria-disabled')).not.toBe('true')
    for (const key of ['autoFormatPaste', 'autoCapital', 'prefixDictionary', 'inlineCodeSpaceMode', 'excludeFiles', 'userDefinedRegSwitch']) {
      const control = rowControl(root, key)
      expect(control.disabled, key).toBe(true)
      const row = q<HTMLElement>(root, `[data-vet-setting-key="${key}"]`)
      expect(row.getAttribute('aria-disabled'), key).toBe('true')
      expect(row.title, key).toBe(zhMessages.settingsTabs.hintDisabledByMaster)
    }
  })

  it('userDefinedRegExp 二级联动：总开关开 + 正则开关关 → 仅正则文本域禁用（正则开关可用）', async () => {
    const { request } = assemble({ autoFormat: true, userDefinedRegSwitch: false })
    const { root } = await mountPage(request)
    expect((rowControl(root, 'userDefinedRegSwitch') as HTMLInputElement).disabled).toBe(false)
    const regExpRow = q<HTMLElement>(root, '[data-vet-setting-key="userDefinedRegExp"]')
    expect((rowControl(root, 'userDefinedRegExp') as HTMLTextAreaElement).disabled).toBe(true)
    expect(regExpRow.title).toBe(zhMessages.settingsTabs.hintDisabledByRegexSwitch)
  })

  it('联动随写入恢复：打开总开关后下行重新可用', async () => {
    const { request } = assemble({ autoFormat: false })
    const { root } = await mountPage(request)
    changeValue(rowControl(root, 'autoFormat'), true)
    await flush()
    for (const key of ['autoFormatPaste', 'userDefinedRegExp', 'excludeFiles']) {
      expect(rowControl(root, key).disabled, key).toBe(false)
      expect(q(root, `[data-vet-setting-key="${key}"]`).getAttribute('aria-disabled'), key).not.toBe('true')
    }
  })

  it('编辑增强/其他设置行不受总开关联动', async () => {
    const { request } = assemble({ autoFormat: false })
    const { root } = await mountPage(request)
    for (const key of ['tabout', 'strictLineMode', 'debug']) {
      expect(rowControl(root, key).disabled, key).toBe(false)
    }
  })
})

// ===== 规则四分区挂入 =====

describe('规则四分区挂入对应 panel', () => {
  it('user→自定义规则、builtin→内置规则、spacing→自动格式化、storage→其他设置', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(panel(root, 'user-rules').contains(q(root, '[data-vet-section="user"]'))).toBe(true)
    expect(panel(root, 'builtin-rules').contains(q(root, '[data-vet-section="builtin"]'))).toBe(true)
    expect(panel(root, 'auto-format').contains(q(root, '[data-vet-section="spacing"]'))).toBe(true)
    expect(panel(root, 'other').contains(q(root, '[data-vet-section="storage"]'))).toBe(true)
  })

  it('内置规则条目真实渲染于内置规则 panel（出厂 20 条）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    const builtinPanel = panel(root, 'builtin-rules')
    expect(builtinPanel.querySelectorAll('[data-vet-builtin-list] [data-vet-rule-id]')).toHaveLength(20)
  })

  it('旧单页标题/简介不再渲染（五 Tab hero 形态取代）', async () => {
    const { request } = assemble()
    const { root } = await mountPage(request)
    expect(root.querySelector('.vsidian-easy-typing-page-title')).toBeNull()
    expect(root.querySelector('.vsidian-easy-typing-page-intro')).toBeNull()
  })

  it('dispose：root 清空与身份移除', async () => {
    const { request } = assemble()
    const { view, root } = await mountPage(request)
    view.dispose()
    expect(root.textContent).toBe('')
    expect(root.classList.contains('vsidian-easy-typing-root')).toBe(false)
    expect(root.hasAttribute('data-vet-page')).toBe(false)
  })
})
