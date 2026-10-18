// @vitest-environment jsdom
// 设置页 Tab 浏览态跨 mount 保留回归（#63）：宿主侧会话级 view-state 通道
// （VIEW_STATE_TOPIC get/update）对齐上游「跨开关保留、重启复位」语义——
// 上游内存态挂在常驻 PluginSettingTab 实例
// （easy_typing_settings_tab.ts:58 activeTab 实例字段），本仓对齐载体是
// 宿主 extension 进程的 setup 常驻闭包。
//
// 边界模拟口径：vsidian 平台设置页面板 retainContextWhenHidden 不开
// （平台仓 src/host/settingsPage.ts——隐藏即释放，重开经页面工厂重新
// 装载）。本文件用「同一 channel 后端（handlers Map）跨两次 mount 复用
// + 两次全新 mountSettingsPage」模拟该边界：
//   - mount1 → 切到非默认 Tab → dispose（面板关闭，webview 销毁）
//   - mount2（全新 mount，等价 webview 重装载）→ Tab 经宿主 view-state 恢复
//
// 沿革：诊断探针 DEBUG-diagA 观察环断言反转转正（现状断言见票 #63 诊断
// 结论）；对照两例保留——A 页面内重渲染不重置 Tab；B 设置数据跨 mount
// 不丢（丢失面仅浏览位置类 UI 态；本票收口 Tab + 页面级滚动偏移——
// 滚动保存超上游一步：上游 display() 全量重建必回顶，本仓按 #63 验收
// 预期补齐，恢复时机修正见票内「平台 focusSection.scroll 对异步装载的
// 附加组件页失效」分析）。
import { afterEach, describe, expect, it } from 'vitest'
import { mountSettingsPage, type SettingsPageViewHandle } from '../src/settingsTabsUi'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { registerViewStateChannels, SETTINGS_TOPIC, VIEW_STATE_TOPIC } from '../src/settings/store'
import { RULES_TOPIC } from '../src/rules/rules-protocol'
import { zhMessages } from '../src/i18n'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonSettingsContextFacet,
  AddonSettingsLocateTarget,
  AddonSettingsScopeSnapshot,
} from '../types/vendor/shared/addonSettingsContextApi'
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'

// ===== mock 设施（装配面复制自 test/settings-tabs-ui.test.ts；#63 view-state
// 通道接线真实 registerViewStateChannels——宿主侧单元与 extension.ts setup
// 同款注册，handlers Map 跨 mount 复用 = 宿主进程常驻） =====

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

function effectiveOf(values: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_EFFECTIVE_SETTINGS, excludeFiles: [...DEFAULT_EFFECTIVE_SETTINGS.excludeFiles], ...values }
}

/** 宿主侧常驻后端（跨两次 mount 复用——等价宿主 extension 进程不随
 *  设置页 webview 销毁而销毁）；withViewState=false 模拟旧宿主未注册
 *  view-state 通道（topic 拒绝）形态 */
function assembleHostBackend(initialSettings: Record<string, unknown> = {}, withViewState = true) {
  const mock = mockStorage()
  const service = new HostRulesService(mock.storage, {
    now: () => 1_000_000,
    setTimeout: (fn) => {
      void fn()
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
  const values = { ...initialSettings }
  handlers.set(SETTINGS_TOPIC.get, async () => ({ values: { ...values }, sources: {}, effective: effectiveOf(values) }))
  handlers.set(SETTINGS_TOPIC.update, (raw: unknown) => {
    const payload = raw as { scope: string; patch: Record<string, unknown> }
    Object.assign(values, payload.patch)
    return { ok: true }
  })
  // #63 view-state：真实宿主侧注册单元（与 extension.ts setup 同款接线）
  if (withViewState) registerViewStateChannels(registry)
  /** 恢复回包挂起门（驱动「回包迟到于用户切换」竞态；仅 gate view-state
   * get，设置 get 不受影响） */
  let viewStateGetGate: Promise<void> | null = null
  const plainViewStateGet = handlers.get(VIEW_STATE_TOPIC.get)
  if (plainViewStateGet) {
    handlers.set(VIEW_STATE_TOPIC.get, async (payload: unknown) => {
      if (viewStateGetGate) await viewStateGetGate
      return plainViewStateGet(payload)
    })
  }
  /** 规则装载挂起门（R1 审查 001：view-state 回包快于规则列表装载的
   * 竞态——恢复不得在规则内容起高前回放偏移） */
  let rulesGetGate: Promise<void> | null = null
  const plainRulesGet = handlers.get(RULES_TOPIC.get)
  if (plainRulesGet) {
    handlers.set(RULES_TOPIC.get, async (payload: unknown) => {
      if (rulesGetGate) await rulesGetGate
      return plainRulesGet(payload)
    })
  }
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
    request,
    values,
    /** 宿主侧 view-state 真值读取（直接调用 handler，不经页面） */
    async hostTab(): Promise<string | null> {
      const outcome = await request(VIEW_STATE_TOPIC.get, null)
      return outcome.ok ? ((outcome.result as { tab: string | null }).tab ?? null) : null
    },
    /** 宿主侧 view-state 全量读取（tab + scroll） */
    async hostViewState(): Promise<{ tab: string | null; scroll: number | null }> {
      const outcome = await request(VIEW_STATE_TOPIC.get, null)
      return outcome.ok ? (outcome.result as { tab: string | null; scroll: number | null }) : { tab: null, scroll: null }
    },
    /** 注入宿主持有的 Tab 值（经 update topic——字符串即存） */
    async seedTab(tab: string): Promise<void> {
      await request(VIEW_STATE_TOPIC.update, { tab })
    },
    holdViewStateGet(): () => void {
      let release!: () => void
      viewStateGetGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        release()
        viewStateGetGate = null
      }
    },
    /** 挂起规则装载（R1 审查 001 竞态驱动） */
    holdRulesGet(): () => void {
      let release!: () => void
      rulesGetGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        release()
        rulesGetGate = null
      }
    },
  }
}

/** fake facet：定位目标 + 订阅即回放（对齐平台契约，形态复制自
 *  test/settings-tabs-locate.test.ts） */
function fakeContextFacet(initialTarget: AddonSettingsLocateTarget | null = null) {
  let target = initialTarget
  const scope: AddonSettingsScopeSnapshot = { scope: 'user', hasWorkspace: true }
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
      listener(target)
      return () => {
        locateListeners.delete(listener)
      }
    },
  }
  return { facet }
}

async function flush(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 单次页面装载（等价 webview 内 defineAddonPage 工厂执行一次） */
async function mountPage(
  request: ReturnType<typeof assembleHostBackend>['request'],
  settingsContext?: AddonSettingsContextFacet,
): Promise<{
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
    // 真实定时器（#63 滚动扩展）：滚动上报走 200ms 尾沿节流，空桩会吞掉
    // 节流回调导致位移永不上送
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    settingsContext,
  })
  await flush()
  return { view, root }
}

afterEach(() => {
  document.body.textContent = ''
  // jsdom 的 documentElement.scrollTop 跨用例持久（真实浏览器每次装载
  // 归零）——复位以对齐真实语义，避免滚动用例间串扰
  document.documentElement.scrollTop = 0
})

describe('Tab 浏览态跨 mount 保留（#63 宿主侧会话级 view-state）', () => {
  it('主线：切到非默认 Tab → 关闭面板 → 重开，回到离开时的 Tab', async () => {
    const backend = assembleHostBackend()
    const first = await mountPage(backend.request)

    // 用户点选非默认 Tab（真实交互路径）
    const btn = first.root.querySelector<HTMLButtonElement>('[data-vet-tab="user-rules"]')
    expect(btn).not.toBeNull()
    btn!.click()
    expect(first.view.activeTab()).toBe('user-rules')

    // 关闭设置页：webview 销毁（页面 dispose）——宿主后端常驻
    first.view.dispose()

    // 重开设置页：webview 重新装载（全新 mount，同一宿主后端）→ Tab 恢复
    const second = await mountPage(backend.request)
    expect(second.view.activeTab()).toBe('user-rules')
    const panel2 = second.root.querySelector<HTMLElement>('[data-vet-panel="user-rules"]')
    expect(panel2).not.toBeNull()
    expect(panel2!.hasAttribute('hidden')).toBe(false)
    // 页面级滚动（documentElement，jsdom 无平台滚动祖先时的回退落点）的
    // 保存与恢复见下方「滚动位置」组；本例未滚动，保持顶部
    expect(document.documentElement.scrollTop).toBe(0)
    second.view.dispose()
  })

  it('切换即上送：页面侧 Tab 切换写宿主 view-state（按钮点击路径）', async () => {
    const backend = assembleHostBackend()
    expect(await backend.hostTab()).toBe(null)
    const page = await mountPage(backend.request)
    page.root.querySelector<HTMLButtonElement>('[data-vet-tab="other"]')!.click()
    await flush()
    expect(await backend.hostTab()).toBe('other')
    page.view.dispose()
  })

  it('回包非法 Tab 保持默认：宿主持有任意字符串（字符串即存），页面按 SETTINGS_TAB_IDS 校验', async () => {
    const backend = assembleHostBackend()
    await backend.seedTab('not-a-tab-id')
    const page = await mountPage(backend.request)
    expect(page.view.activeTab()).toBe('edit-enhance')
    page.view.dispose()
  })

  it('通道缺席（旧宿主未注册 topic）静默降级：默认 Tab，页面功能完整', async () => {
    const backend = assembleHostBackend({}, false)
    const page = await mountPage(backend.request)
    expect(page.view.activeTab()).toBe('edit-enhance')
    // 页面功能完整：设置行照常渲染并回显
    const row = page.root.querySelector<HTMLElement>('[data-vet-setting-key="autoFormat"]')
    expect(row).not.toBeNull()
    page.view.dispose()
  })

  it('恢复回包迟到于用户切换：不覆盖用户已选 Tab（确定意图优先）', async () => {
    const backend = assembleHostBackend()
    await backend.seedTab('user-rules')
    const release = backend.holdViewStateGet()
    const page = await mountPage(backend.request)
    // 回包挂起期间用户已切到 other
    page.root.querySelector<HTMLButtonElement>('[data-vet-tab="other"]')!.click()
    expect(page.view.activeTab()).toBe('other')
    release()
    await flush(4)
    // 迟到的恢复（user-rules）不翻转用户选择
    expect(page.view.activeTab()).toBe('other')
    page.view.dispose()
  })

  it('恢复让位搜索定位：mount 携带定位目标时，定位意图优先于 view-state 恢复', async () => {
    const backend = assembleHostBackend()
    await backend.seedTab('user-rules')
    const { facet } = fakeContextFacet({ kind: 'def', key: 'autoFormat' })
    const page = await mountPage(backend.request, facet)
    await flush(4)
    // 定位目标（autoFormat 行 → 自动格式化 Tab）胜出，不被恢复翻回 user-rules
    expect(page.view.activeTab()).toBe('auto-format')
    page.view.dispose()
  })

  it('dispose 后迟到回包无害（不抛错、无残留副作用）', async () => {
    const backend = assembleHostBackend()
    await backend.seedTab('user-rules')
    const release = backend.holdViewStateGet()
    const page = await mountPage(backend.request)
    page.view.dispose()
    release()
    await expect(flush(4)).resolves.toBeUndefined()
  })
})

describe('对照例（探针转正保留：丢失面仅浏览位置类 UI 态）', () => {
  it('对照 A：同一 mount 实例内 setLanguage（页面内重渲染）不重置 Tab', async () => {
    const backend = assembleHostBackend()
    const page = await mountPage(backend.request)
    page.view.switchTab('other')
    page.view.setLanguage('en')
    expect(page.view.activeTab()).toBe('other')
    page.view.dispose()
  })

  it('对照 B：设置值经宿主后端常驻，重 mount 回显存储真值（数据不丢）', async () => {
    const backend = assembleHostBackend()
    const first = await mountPage(backend.request)

    // 写一个 boolean 设置（change 事件触发 write → 宿主后端）
    const row = first.root.querySelector<HTMLElement>('[data-vet-setting-key="autoFormat"]')
    expect(row).not.toBeNull()
    const input = row!.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(input).not.toBeNull()
    input!.checked = false
    input!.dispatchEvent(new Event('change', { bubbles: true }))
    await flush(4)
    expect(backend.values['autoFormat']).toBe(false)

    first.view.dispose()

    // 重 mount：控件回显存储真值（false）——仅浏览位置类 UI 态丢失
    const second = await mountPage(backend.request)
    const row2 = second.root.querySelector<HTMLElement>('[data-vet-setting-key="autoFormat"]')
    const input2 = row2!.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(input2!.checked).toBe(false)
    second.view.dispose()
  })
})

describe('滚动位置随 view-state 保存与恢复（#63 扩展：超上游一步）', () => {
  /** 触发滚动上报路径：设置 documentElement（jsdom 回退落点）scrollTop
   *  并派发 scroll 事件（真实宿主的滚动祖先由 mount 向上解析取得，
   *  jsdom 无平台滚动祖先 → scrollingElement 回退，同一读写面） */
  function scrollPageTo(offset: number): void {
    document.documentElement.scrollTop = offset
    document.documentElement.dispatchEvent(new Event('scroll'))
  }

  /** 等待滚动上报尾沿节流窗（实现口径 200ms + 余量） */
  async function waitScrollThrottle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 260))
  }

  it('主线：滚动 → 关闭面板 → 重开，回到离开时的 Tab 与滚动偏移', async () => {
    const backend = assembleHostBackend()
    const first = await mountPage(backend.request)
    first.root.querySelector<HTMLButtonElement>('[data-vet-tab="user-rules"]')!.click()

    scrollPageTo(400)
    await waitScrollThrottle()
    expect(await backend.hostViewState()).toEqual({ tab: 'user-rules', scroll: 400 })

    first.view.dispose()

    const second = await mountPage(backend.request)
    expect(second.view.activeTab()).toBe('user-rules')
    await flush(4)
    // 滚动恢复在内容起高后回放（rAF/定时器回退）——离开时偏移原样回位
    expect(document.documentElement.scrollTop).toBe(400)
    second.view.dispose()
  })

  it('切换即上送携带当前滚动：无 scroll 事件的程序性位移也随 Tab 切换入账', async () => {
    const backend = assembleHostBackend()
    const page = await mountPage(backend.request)
    // 程序性设置 scrollTop（不派发 scroll 事件——模拟节流窗内的最后位移）
    document.documentElement.scrollTop = 300
    page.view.switchTab('other')
    await flush(2)
    expect(await backend.hostViewState()).toEqual({ tab: 'other', scroll: 300 })
    page.view.dispose()
  })

  it('无滚动位移重开保持顶部（scroll 记忆为 0，回放等价无操作）', async () => {
    const backend = assembleHostBackend()
    const first = await mountPage(backend.request)
    first.root.querySelector<HTMLButtonElement>('[data-vet-tab="auto-format"]')!.click()
    // 未滚动（无 scroll 事件、切换时 scrollTop 为 0）→ 宿主只有 tab 记忆
    await flush(2)
    expect(await backend.hostViewState()).toEqual({ tab: 'auto-format', scroll: 0 })
    first.view.dispose()

    const second = await mountPage(backend.request)
    await flush(4)
    expect(second.view.activeTab()).toBe('auto-format')
    expect(document.documentElement.scrollTop).toBe(0)
    second.view.dispose()
  })

  it('恢复让位：回包迟到于用户切换时不应用滚动（不翻转既有视图）', async () => {
    const backend = assembleHostBackend()
    // 种入带滚动的记忆，挂起恢复回包
    await backend.request('easyTyping.viewState.update', { tab: 'user-rules', scroll: 500 })
    const release = backend.holdViewStateGet()
    const page = await mountPage(backend.request)
    document.documentElement.scrollTop = 0
    // 回包挂起期间用户已切到 other
    page.root.querySelector<HTMLButtonElement>('[data-vet-tab="other"]')!.click()
    release()
    await flush(6)
    expect(page.view.activeTab()).toBe('other')
    // 迟到的 {user-rules, 500} 不回放滚动
    expect(document.documentElement.scrollTop).toBe(0)
    page.view.dispose()
  })

  it('dispose 后滚动监听清理：后续滚动位移不再上送宿主', async () => {
    const backend = assembleHostBackend()
    const page = await mountPage(backend.request)
    scrollPageTo(200)
    await waitScrollThrottle()
    expect((await backend.hostViewState()).scroll).toBe(200)

    page.view.dispose()
    scrollPageTo(600)
    await waitScrollThrottle()
    // 监听与节流定时器随 dispose 释放——宿主记忆停留在 200
    expect(await backend.hostViewState()).toEqual({ tab: 'edit-enhance', scroll: 200 })
  })

  // ===== R1 审查 001：规则列表异步装载晚于 view-state 回包时不提前回放 =====

  it('规则装载跨过首帧后仍恢复偏移：回放等待规则内容起高（jsdom 无钳制，以顺序钉住）', async () => {
    const backend = assembleHostBackend()
    // 种入「规则 Tab + 中部偏移」记忆，规则装载挂起（模拟文件读取慢于 view-state 回包）
    await backend.request('easyTyping.viewState.update', { tab: 'builtin-rules', scroll: 500 })
    const releaseRules = backend.holdRulesGet()
    const page = await mountPage(backend.request)
    await flush(6)
    expect(page.view.activeTab()).toBe('builtin-rules')
    // 规则装载在途：偏移不得提前应用（真宿主中此时尚未起高的内容会把 500 钳为 0）
    expect(document.documentElement.scrollTop).toBe(0)

    releaseRules()
    await flush(6)
    expect(document.documentElement.scrollTop).toBe(500)
    page.view.dispose()
  })

  it('恢复等待中用户切页不抢回：确定导航优先于迟到的偏移回放', async () => {
    const backend = assembleHostBackend()
    await backend.request('easyTyping.viewState.update', { tab: 'builtin-rules', scroll: 500 })
    const releaseRules = backend.holdRulesGet()
    const page = await mountPage(backend.request)
    // 等待窗口内用户切到 other（claimed）
    page.root.querySelector<HTMLButtonElement>('[data-vet-tab="other"]')!.click()
    releaseRules()
    await flush(8)
    expect(page.view.activeTab()).toBe('other')
    expect(document.documentElement.scrollTop).toBe(0)
    page.view.dispose()
  })

  it('恢复等待中离开组件页不抢回：root 已脱离滚动容器时不应用偏移', async () => {
    const backend = assembleHostBackend()
    await backend.request('easyTyping.viewState.update', { tab: 'other', scroll: 500 })
    const releaseRules = backend.holdRulesGet()
    const page = await mountPage(backend.request)
    // 模拟平台切换分页：组件 DOM 从主区移出（mount 释放只清 parent，不等价 dispose）
    page.root.remove()
    releaseRules()
    await flush(8)
    expect(document.documentElement.scrollTop).toBe(0)
    page.view.dispose()
  })

  // ===== R1 审查 002：共享滚动容器的监听须校验组件在场归属 =====

  it('切离组件页后共享主区滚动不改本组件记忆；重入后恢复正常', async () => {
    const backend = assembleHostBackend()
    const page = await mountPage(backend.request)
    scrollPageTo(400)
    await waitScrollThrottle()
    expect((await backend.hostViewState()).scroll).toBe(400)

    // 平台切到其他设置分页：root 从共享主区移出（未 dispose——装载常驻）
    page.root.remove()
    // 其他分页在共享主区中滚动
    scrollPageTo(1200)
    await waitScrollThrottle()
    // 本组件记忆不被无关分页的滚动污染
    expect(await backend.hostViewState()).toEqual({ tab: 'edit-enhance', scroll: 400 })

    // 重入（平台切回附加组件分页，同一装载重新挂入主区）：滚动恢复正常入账
    document.body.append(page.root)
    scrollPageTo(600)
    await waitScrollThrottle()
    expect(await backend.hostViewState()).toEqual({ tab: 'edit-enhance', scroll: 600 })
    page.view.dispose()
  })

  it('节流任务在切离后不提交：离开后到期的尾沿上报被归属校验丢弃', async () => {
    const backend = assembleHostBackend()
    const page = await mountPage(backend.request)
    // 滚动后立即切离（节流窗内、尾沿尚未到期）
    scrollPageTo(300)
    page.root.remove()
    await waitScrollThrottle()
    // 尾沿回调校验归属失败 → 不上送（宿主记忆保持初始空态）
    expect(await backend.hostViewState()).toEqual({ tab: null, scroll: null })
    page.view.dispose()
  })
})
