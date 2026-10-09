// 设置读写门面契约（工单 #3）：生效值合成（默认回填 + fail-safe 回退）、
// onChanged 实时刷新、update/clearWorkspaceOverride 转发、dispose 释放。
// 承载票面验收「改值→生效→重开回显」的可自动化部分：改值 → onChanged →
// effective 刷新（真实设置页观感归 #21 人工验证）。
import { describe, expect, it, vi } from 'vitest'
import type {
  AddonSettingsChangeEventData,
  AddonSettingsContextApi,
} from '../types/vendor/host/addons/addonRegistry'
import type { AddonRegistrationHandle } from '../types/vendor/host/addons/addonRegistry'
import type { AddonSettingsUpdateResult } from '../types/vendor/host/addons/addonSettingsService'
import { attachSettings } from '../src/settings/store'
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
