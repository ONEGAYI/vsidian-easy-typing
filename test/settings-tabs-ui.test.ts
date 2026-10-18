// @vitest-environment jsdom
// 五 Tab 自绘设置页 DOM 测试（工单 #55 切片 1）：Tab 框架（aria/键盘导航/
// 面板常驻 hidden 切换）、hero 顶部块、24 项设置行渲染（元数据驱动控件
// 形态）、SETTINGS_TOPIC 写通道（scope 固定 user + 写后重拉）、联动置灰、
// 规则四分区挂入对应 panel。数据链装配对齐 test/rules-ui.test.ts（真实
// HostRulesService + mock storage/registry）；设置通道为页面侧 mock 主题
// handler。真实观感归 #21 人工清单。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enumLabelText,
  mountSettingsPage,
  type SettingsChannelLike,
  type SettingsPageViewHandle,
} from '../src/settingsTabsUi'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { RULES_TOPIC } from '../src/rules/rules-protocol'
import { setDebugEnabled } from '../src/logging'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'
import { zhMessages } from '../src/i18n'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type { AddonSettingDefinition } from '../types/vendor/shared/addonSettings'
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

/** 设置主题的可变后端（get/update handler 共享；failReason 模拟写入拒绝）。
 *  get 快照在调用时捕获；holdNextGet 可挂起下一笔 get（驱动跨笔乱序回包） */
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
  let nextGetGate: Promise<void> | null = null
  handlers.set(SETTINGS_TOPIC.get, async () => {
    store.getCount += 1
    // 快照在调用时捕获（挂起门只延迟结算，不改变快照内容——驱动乱序回包）
    const snapshot = { values: { ...store.values }, sources: {}, effective: effectiveOf(store.values) }
    const gate = nextGetGate
    nextGetGate = null
    if (gate) await gate
    return snapshot
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
  /** 挂起下一笔 get（返回放行函数；快照仍按调用时值捕获） */
  function holdNextGet(): () => void {
    let release!: () => void
    nextGetGate = new Promise<void>((resolve) => {
      release = resolve
    })
    return release
  }
  return { mock, service, store, request, holdNextGet }
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

// ===== 审查轮修复（#55 集成分支 code review）=====

/** 可控计时器：捕获回调句柄（cancel 置标记，fire 按 canceled 跳过） */
function capturingTimers() {
  const timers: Array<{ fn: () => void; canceled: boolean }> = []
  return {
    timers,
    schedule: (fn: () => void) => {
      const handle = { fn, canceled: false }
      timers.push(handle)
      return handle
    },
    cancel: (handle: unknown) => {
      ;(handle as { canceled: boolean }).canceled = true
    },
    fire: (handle: unknown) => {
      const h = handle as { fn: () => void; canceled: boolean }
      if (!h.canceled) h.fn()
    },
  }
}

describe('共享状态行单计时器（审查轮 P2-1）', () => {
  it('规则分区先到的提示计时器不提前清除页面后到的提示（单计时器所有者）', async () => {
    const { store, request } = assemble()
    const timers = capturingTimers()
    const root = document.createElement('div')
    document.body.append(root)
    mountSettingsPage(root, {
      channel: { request },
      messages: zhMessages,
      localeTag: 'zh-cn',
      doc: document,
      setTimeout: timers.schedule,
      clearTimeout: timers.cancel,
    })
    await flush()
    // 规则分区提示（hosts 模式）：重置内置规则成功 → success
    expect(timers.timers).toHaveLength(0) // 装载成功路径不产生状态计时器
    q<HTMLButtonElement>(root, '[data-vet-action="reset-all"]').click()
    await flush()
    const rulesTimer = timers.timers[0]
    const status = q(root, '[data-vet-status]')
    expect(status.getAttribute('data-vet-status')).toBe('success')
    // 页面侧后到提示：设置写入失败 → failed（覆盖前者的展示）
    store.failReason = 'no-workspace'
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    const pageTimer = timers.timers[1]
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain('no-workspace')
    // 规则侧先到提示的计时器到期：已被取消（单计时器所有者），不清除后到提示
    timers.fire(rulesTimer)
    expect(status.getAttribute('data-vet-status')).toBe('failed')
    expect(status.textContent).toContain('no-workspace')
    // 后到提示自身的计时器到期：正常清除
    timers.fire(pageTimer)
    expect(status.getAttribute('data-vet-status')).toBe('')
    expect(status.textContent).toBe('')
  })
})

describe('写后重拉与并发刷新（审查轮 P2-2 / P2-3）', () => {
  it('重拉跳过聚焦中控件：草稿保留，其余控件照常刷新；失焦后回到存储真值', async () => {
    const { store, request } = assemble()
    const { view, root } = await mountPage(request)
    view.switchTab('auto-format') // prefixDictionary 在自动格式化面板（hidden 面板内 jsdom 不接受聚焦）
    const draft = rowControl(root, 'prefixDictionary') as HTMLTextAreaElement
    draft.focus()
    expect(document.activeElement).toBe(draft) // 聚焦成立前置（防御测试自身失效）
    draft.value = '草稿, /未提交/'
    store.values.prefixDictionary = '存储真值, /x/'
    store.values.softSpaceLeftSymbols = '——外部新值'
    await view.refreshSettings()
    await flush()
    expect(draft.value).toBe('草稿, /未提交/')
    expect((rowControl(root, 'softSpaceLeftSymbols') as HTMLInputElement).value).toBe('——外部新值')
    draft.blur()
    await view.refreshSettings()
    await flush()
    expect(draft.value).toBe('存储真值, /x/')
  })

  it('并发重拉乱序回包：挂起旧快照迟到结算不覆盖新快照（到达序令牌）', async () => {
    const { store, request, holdNextGet } = assemble()
    const { view, root } = await mountPage(request)
    // 第一笔重拉挂起（快照在调用时捕获为旧值）
    store.values.softSpaceLeftSymbols = '——陈旧'
    const releaseStale = holdNextGet()
    const staleRefresh = view.refreshSettings()
    // 第二笔重拉（新值）立即结算
    store.values.softSpaceLeftSymbols = '——新鲜'
    await view.refreshSettings()
    await flush()
    expect((rowControl(root, 'softSpaceLeftSymbols') as HTMLInputElement).value).toBe('——新鲜')
    // 旧快照迟到结算：弃置，不覆盖新快照
    releaseStale()
    await staleRefresh
    await flush()
    expect((rowControl(root, 'softSpaceLeftSymbols') as HTMLInputElement).value).toBe('——新鲜')
  })
})

describe('enumLabelText 纯函数（审查轮 P2-4：vendor LocalizedText 两形态）', () => {
  const base: AddonSettingDefinition = { key: 'demo', title: 'demo', type: 'string', enum: ['a', 'b'], default: 'a' }

  it('直值形态：档位显示直值原文，不回退枚举原始值', () => {
    const def: AddonSettingDefinition = { ...base, enumLabels: { a: '直值标签' } }
    expect(enumLabelText(def, 'a', 'zh-cn')).toBe('直值标签')
    expect(enumLabelText(def, 'a', 'en')).toBe('直值标签')
  })

  it('映射形态：取当前语言档位；缺失键回退枚举值本身', () => {
    const def: AddonSettingDefinition = { ...base, enumLabels: { a: { 'zh-cn': '甲', en: 'A' } } }
    expect(enumLabelText(def, 'a', 'zh-cn')).toBe('甲')
    expect(enumLabelText(def, 'a', 'en')).toBe('A')
    expect(enumLabelText(def, 'b', 'zh-cn')).toBe('b')
  })
})

// ===== 审查循环轮 1 修复（review-loops R1）=====

describe('写失败对账强制回滚（审查轮 R1-B1：聚焦草稿保护不挡失败回滚）', () => {
  it('聚焦中控件写失败：重拉结算对该键强制拉回存储值（真实浏览器焦点形态）', async () => {
    const { store, request } = assemble({ tabout: true })
    const { root } = await mountPage(request)
    const control = rowControl(root, 'tabout') as HTMLInputElement
    // 真实浏览器点选 checkbox / select 换档 / Enter 提交后焦点仍在控件
    control.focus()
    expect(document.activeElement).toBe(control) // 聚焦成立前置（防御测试自身失效）
    store.failReason = 'no-workspace'
    changeValue(control, false)
    await flush()
    expect(store.updateCalls).toEqual([{ scope: 'user', patch: { tabout: false } }])
    expect(control.checked).toBe(true) // 失败对账强制回滚：拉回存储真值
    expect(document.activeElement).toBe(control) // 不夺焦点（回滚不打扰用户）
  })

  it('强制回滚仅作用失败键：聚焦中的其他键草稿不受波及', async () => {
    const { store, request } = assemble({ tabout: true })
    const { view, root } = await mountPage(request)
    view.switchTab('auto-format') // prefixDictionary 所在面板可见才可聚焦
    const draft = rowControl(root, 'prefixDictionary') as HTMLTextAreaElement
    draft.focus()
    expect(document.activeElement).toBe(draft)
    draft.value = '草稿, /未提交/'
    store.failReason = 'no-workspace'
    // 另一键写失败（hidden 面板内合成 change 仍触发写入链）
    changeValue(rowControl(root, 'tabout'), false)
    await flush()
    expect(draft.value).toBe('草稿, /未提交/') // 草稿保留（force 只作用失败键）
    expect((rowControl(root, 'tabout') as HTMLInputElement).checked).toBe(true) // 失败键照常回滚
  })
})

describe('showStatus disposed 守卫（审查轮 R1-B3：规则侧在途失败不空转）', () => {
  it('dispose 后经 statusSink 到达的规则侧在途写失败：不写文本、不起新计时器', async () => {
    const base = assemble()
    const timers = capturingTimers()
    // 挂起规则 mutate：点击后 dispose，再放行失败回包——模拟规则侧在途
    // 写失败晚于页面卸载结算（经 statusSink 触达页面 showStatus）
    let releaseMutate!: (value: { ok: false; reason: string }) => void
    const mutateGate = new Promise<{ ok: false; reason: string }>((resolve) => {
      releaseMutate = resolve
    })
    const request = async (
      topic: string,
      payload: unknown,
    ): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> => {
      if (topic === RULES_TOPIC.mutate) return mutateGate
      return base.request(topic, payload)
    }
    const root = document.createElement('div')
    document.body.append(root)
    const view = mountSettingsPage(root, {
      channel: { request },
      messages: zhMessages,
      localeTag: 'zh-cn',
      doc: document,
      setTimeout: timers.schedule,
      clearTimeout: timers.cancel,
    })
    await flush()
    const status = q(root, '[data-vet-status]')
    // 内置规则开关关闭 → disableBuiltinRule（mutate 挂起中）
    const toggle = q<HTMLInputElement>(
      panel(root, 'builtin-rules'),
      '[data-vet-builtin-list] input[data-vet-action="toggle-builtin"]',
    )
    toggle.checked = false
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    view.dispose()
    releaseMutate({ ok: false, reason: 'rejected' })
    await flush()
    expect(timers.timers).toHaveLength(0) // 不再起新计时器（6s 空转持闭包）
    expect(status.textContent).toBe('') // 已卸载状态行不被写入
  })
})

describe('get 失败路径 debugLog 留痕（审查轮 R1-B4）', () => {
  it('通道异常路径：debug 开启时留痕', async () => {
    const base = assemble()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setDebugEnabled(true)
    try {
      const request = async (
        topic: string,
        payload: unknown,
      ): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> => {
        if (topic === SETTINGS_TOPIC.get) throw new Error('io-down')
        return base.request(topic, payload)
      }
      const root = document.createElement('div')
      document.body.append(root)
      mountSettingsPage(root, {
        channel: { request },
        messages: zhMessages,
        localeTag: 'zh-cn',
        doc: document,
        setTimeout: () => 0,
        clearTimeout: () => {},
      })
      await flush()
      const messages = spy.mock.calls.map((call) => call.map(String).join(' '))
      expect(messages.some((line) => line.includes('[vsidian-easy-typing]') && line.includes('settings get'))).toBe(true)
    } finally {
      setDebugEnabled(false)
      spy.mockRestore()
    }
  })

  it('outcome rejected 路径：debug 开启时留痕 reason；门控关闭时静默', async () => {
    const base = assemble()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const request = async (
        topic: string,
        payload: unknown,
      ): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }> => {
        if (topic === SETTINGS_TOPIC.get) return { ok: false, reason: 'rejected' }
        return base.request(topic, payload)
      }
      const root = document.createElement('div')
      document.body.append(root)
      mountSettingsPage(root, {
        channel: { request },
        messages: zhMessages,
        localeTag: 'zh-cn',
        doc: document,
        setTimeout: () => 0,
        clearTimeout: () => {},
      })
      await flush()
      expect(spy).not.toHaveBeenCalled() // 门控默认关：get 失败静默（留痕仅诊断面）
      setDebugEnabled(true)
      const view = mountSettingsPage(root, {
        channel: { request },
        messages: zhMessages,
        localeTag: 'zh-cn',
        doc: document,
        setTimeout: () => 0,
        clearTimeout: () => {},
      })
      await flush()
      const messages = spy.mock.calls.map((call) => call.map(String).join(' '))
      expect(messages.some((line) => line.includes('[vsidian-easy-typing]') && line.includes('settings get') && line.includes('rejected'))).toBe(true)
      view.dispose()
    } finally {
      setDebugEnabled(false)
      spy.mockRestore()
    }
  })
})
