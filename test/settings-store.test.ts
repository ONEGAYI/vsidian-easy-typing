// 设置读写门面契约（工单 #3）：生效值合成（默认回填 + fail-safe 回退）、
// onChanged 实时刷新、update/clearWorkspaceOverride 转发、dispose 释放。
// 承载票面验收「改值→生效→重开回显」的可自动化部分：改值 → onChanged →
// effective 刷新（真实设置页观感归 #21 人工验证）。
// #63 追加：设置页 UI 浏览态通道（VIEW_STATE_TOPIC + registerViewStateChannels）
// 宿主侧契约——get 初值 / update 回读 / 不落盘面。
import { describe, expect, it, vi } from 'vitest'
import type {
  AddonChannelRegistry,
  AddonSettingsChangeEventData,
  AddonSettingsContextApi,
} from '../types/vendor/host/addons/addonRegistry'
import type { AddonRegistrationHandle } from '../types/vendor/host/addons/addonRegistry'
import type { AddonSettingsUpdateResult } from '../types/vendor/host/addons/addonSettingsService'
import { attachSettings, registerViewStateChannels, VIEW_STATE_TOPIC } from '../src/settings/store'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'

type Listener = (change: AddonSettingsChangeEventData) => void

/** 平台设置 API 最小 mock：快照可变 + onChanged 广播 + 调用 spy */
function createMockApi(initialValues: Record<string, unknown> = {}) {
  const state = {
    snapshot: {
      values: { ...initialValues },
      sources: Object.fromEntries(
        Object.keys(initialValues).map((key) => [key, 'user' as const]),
      ),
    },
  }
  const listeners = new Set<Listener>()
  const handlesDisposed: string[] = []
  const updateMock = vi.fn(
    async (_scope: 'user' | 'workspace', _patch: Record<string, unknown>) =>
      ({ ok: true }) as AddonSettingsUpdateResult,
  )
  const clearMock = vi.fn(async (_key: string) => ({ ok: true }) as AddonSettingsUpdateResult)

  const api = {
    registerPage: () => ({ dispose() {} }) as AddonRegistrationHandle,
    registerDefinitions: () => ({ dispose() {} }) as AddonRegistrationHandle,
    get: () => state.snapshot,
    getSource: (key: string) =>
      key in state.snapshot.values ? ('user' as const) : undefined,
    update: updateMock,
    clearWorkspaceOverride: clearMock,
    onChanged(listener: Listener): AddonRegistrationHandle {
      listeners.add(listener)
      return {
        dispose() {
          listeners.delete(listener)
          handlesDisposed.push('onChanged')
        },
      }
    },
  } as unknown as AddonSettingsContextApi

  return {
    api,
    /** 替换快照并按平台语义广播（真实平台只在持久化成功后广播） */
    commit(values: Record<string, unknown>, scope: 'user' | 'workspace' = 'user') {
      state.snapshot = {
        values: { ...state.snapshot.values, ...values },
        sources: { ...state.snapshot.sources },
      }
      const change: AddonSettingsChangeEventData = { scope, keys: Object.keys(values) }
      for (const listener of listeners) listener(change)
    },
    updateMock,
    clearMock,
    handlesDisposed,
  }
}

describe('生效值合成（默认回填）', () => {
  it('空快照 → 全默认（默认值矩阵）', () => {
    const { api } = createMockApi()
    const facade = attachSettings(api)
    expect(facade.effective).toEqual(DEFAULT_EFFECTIVE_SETTINGS)
  })

  it('用户覆盖生效，其余回默认', () => {
    const { api } = createMockApi({
      tabout: false,
      inlineCodeSpaceMode: 'strict',
      excludeFiles: ['DailyNote/', 'DailyNote/test.md'],
    })
    const facade = attachSettings(api)
    expect(facade.effective.tabout).toBe(false)
    expect(facade.effective.inlineCodeSpaceMode).toBe('strict')
    expect(facade.effective.excludeFiles).toEqual(['DailyNote/', 'DailyNote/test.md'])
    expect(facade.effective.smartPaste).toBe(DEFAULT_EFFECTIVE_SETTINGS.smartPaste)
    expect(facade.effective.inlineFormulaSpaceMode).toBe('soft')
  })
})

describe('fail-safe 回退（快照值非法时回默认，不抛错）', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['布尔键类型错：tabout 收到字符串', { tabout: 'yes' }],
    ['枚举越界：inlineCodeSpaceMode 收到 hard', { inlineCodeSpaceMode: 'hard' }],
    ['枚举类型错：strictLineMode 收到数字', { strictLineMode: 1 }],
    ['数组项非字符串：excludeFiles 混入数字', { excludeFiles: ['a/', 3] }],
    ['数组类型错：excludeFiles 收到字符串', { excludeFiles: 'DailyNote/' }],
    ['字符串类型错：prefixDictionary 收到数字', { prefixDictionary: 42 }],
    ['未知键被忽略（不出现在 effective）', { notASetting: true }],
  ]

  for (const [name, patch] of cases) {
    it(name, () => {
      const { api } = createMockApi(patch)
      const facade = attachSettings(api)
      expect(facade.effective).toEqual(DEFAULT_EFFECTIVE_SETTINGS)
    })
  }
})

describe('onChanged 实时刷新', () => {
  it('设置变化 → effective 更新 + 订阅者收到新对象', () => {
    const { api, commit } = createMockApi()
    const facade = attachSettings(api)
    const seen: Array<boolean> = []
    facade.onEffectiveChange((s) => seen.push(s.debug))

    commit({ debug: true })
    expect(facade.effective.debug).toBe(true)
    expect(seen).toEqual([true])

    commit({ debug: false })
    expect(facade.effective.debug).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('未涉及本组件键的变化也触发对账刷新（快照对账模型）', () => {
    const { api, commit } = createMockApi()
    const facade = attachSettings(api)
    commit({ debug: true, tabout: false })
    expect(facade.effective.debug).toBe(true)
    expect(facade.effective.tabout).toBe(false)
  })

  it('订阅可退订', () => {
    const { api, commit } = createMockApi()
    const facade = attachSettings(api)
    const off = facade.onEffectiveChange(() => {
      throw new Error('退订后不应收到通知')
    })
    off()
    commit({ debug: true })
    expect(facade.effective.debug).toBe(true)
  })
})

describe('update / clearWorkspaceOverride 转发', () => {
  it('update 参数透传、结果透传', async () => {
    const { api, updateMock } = createMockApi()
    const facade = attachSettings(api)
    const patch = { debug: true, excludeFiles: ['a/'] }
    const result = await facade.update('workspace', patch)
    expect(updateMock).toHaveBeenCalledWith('workspace', patch)
    expect(result).toEqual({ ok: true })
  })

  it('clearWorkspaceOverride 参数透传、结果透传', async () => {
    const { api, clearMock } = createMockApi({ debug: true })
    const facade = attachSettings(api)
    const result = await facade.clearWorkspaceOverride('debug')
    expect(clearMock).toHaveBeenCalledWith('debug')
    expect(result).toEqual({ ok: true })
  })
})

describe('dispose', () => {
  it('释放平台 onChanged 订阅；此后变化不再刷新', () => {
    const { api, commit, handlesDisposed } = createMockApi()
    const facade = attachSettings(api)
    const before = facade.effective.debug
    facade.dispose()
    expect(handlesDisposed).toContain('onChanged')
    commit({ debug: !before })
    expect(facade.effective.debug).toBe(before)
  })

  it('重复 dispose 无害', () => {
    const { api } = createMockApi()
    const facade = attachSettings(api)
    facade.dispose()
    facade.dispose()
  })
})

// ===== #63 设置页 UI 浏览态通道（宿主侧契约） =====

/** 通道注册面最小 mock：handlers Map（与页面侧装配测试同形态） */
function mockChannelRegistry() {
  const handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  const registry: AddonChannelRegistry = {
    handle: (topic, handler) => {
      handlers.set(topic, handler)
      return { dispose: () => handlers.delete(topic) } as AddonRegistrationHandle
    },
  }
  async function call(topic: string, payload: unknown): Promise<unknown> {
    const handler = handlers.get(topic)
    if (!handler) throw new Error(`topic 未注册：${topic}`)
    return handler(payload)
  }
  return { handlers, registry, call }
}

describe('设置页 UI 浏览态通道（#63 VIEW_STATE_TOPIC）', () => {
  it('topic 常量形状：双端共引的字符串面钉住（宿主 extension 与设置页共用）', () => {
    expect(VIEW_STATE_TOPIC.get).toBe('easyTyping.viewState.get')
    expect(VIEW_STATE_TOPIC.update).toBe('easyTyping.viewState.update')
  })

  it('get 初值：{ tab: null }（会话内尚无浏览记录）', async () => {
    const { registry, call } = mockChannelRegistry()
    registerViewStateChannels(registry)
    await expect(call(VIEW_STATE_TOPIC.get, null)).resolves.toEqual({ tab: null })
  })

  it('update 后 get 回读：字符串即存（Tab 语义校验归页面侧 SETTINGS_TAB_IDS）', async () => {
    const { registry, call } = mockChannelRegistry()
    registerViewStateChannels(registry)
    await expect(call(VIEW_STATE_TOPIC.update, { tab: 'user-rules' })).resolves.toEqual({ ok: true })
    // 任意字符串（含非 Tab id）照存：宿主侧无 Tab 语义知识，恢复侧自行校验
    await expect(call(VIEW_STATE_TOPIC.update, { tab: 'not-a-tab-id' })).resolves.toEqual({ ok: true })
    await expect(call(VIEW_STATE_TOPIC.get, null)).resolves.toEqual({ tab: 'not-a-tab-id' })
  })

  it('update 非法载荷（缺席 / 非字符串 / 空串）拒绝且状态不变', async () => {
    const { registry, call } = mockChannelRegistry()
    registerViewStateChannels(registry)
    await expect(call(VIEW_STATE_TOPIC.update, null)).resolves.toEqual({ ok: false, reason: 'invalid-payload' })
    await expect(call(VIEW_STATE_TOPIC.update, { tab: 42 })).resolves.toEqual({ ok: false, reason: 'invalid-payload' })
    await expect(call(VIEW_STATE_TOPIC.update, { tab: '' })).resolves.toEqual({ ok: false, reason: 'invalid-payload' })
    await expect(call(VIEW_STATE_TOPIC.get, null)).resolves.toEqual({ tab: null })
  })

  it('会话级内存态：注册面仅 channel registry（无 storage 形参即无落盘面）', async () => {
    // 不落盘由构造保证：registerViewStateChannels 唯一参数是通道注册面，
    // 无 storage facet 可传；get/update 为同步内存读写，activate 生命周期
    // 即会话级（setup 闭包持态），重启 / 代次重注册复位。两次注册互不
    // 共享（闭包持态，非模块级单例）——一处更新不串到另一处。
    const first = mockChannelRegistry()
    const second = mockChannelRegistry()
    registerViewStateChannels(first.registry)
    registerViewStateChannels(second.registry)
    await expect(first.call(VIEW_STATE_TOPIC.update, { tab: 'user-rules' })).resolves.toEqual({ ok: true })
    await expect(second.call(VIEW_STATE_TOPIC.get, null)).resolves.toEqual({ tab: null })
  })
})
