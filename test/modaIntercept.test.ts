// Mod+A 抢先层 Command、设置门与「选择当前块」命令注册契约测试（工单 #11
// 接入层）。拦截单元化模式对齐 #7（taboutIntercept.test.ts）：真实
// EditorState 驱动决策、最小模拟 view（state + dispatch 捕获）驱动
// Command；命令注册面走平台稳定 commands API 的形状契约。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { pickMessages } from '../src/i18n'
import { SETTINGS_TOPIC } from '../src/settings/store'
import {
  buildSelectBlockCommandDefinition,
  createEnhanceModAGate,
  createModACommand,
  createSelectBlockCommandHandler,
} from '../src/modaIntercept'

/** 模拟 view：state + dispatch 捕获（对齐 taboutIntercept 测试模式） */
interface DispatchCall {
  selection?: { anchor: number; head?: number }
  changes?: unknown
}

function fakeView(state: EditorState): { view: EditorView; calls: DispatchCall[] } {
  const calls: DispatchCall[] = []
  const view = {
    state,
    dispatch: (spec: DispatchCall) => {
      calls.push(spec)
    },
  }
  return { view: view as unknown as EditorView, calls }
}

describe('Mod+A Command（抢先层）：门控与派发形态', () => {
  it('功能关 → 全透传（return false 零派发，落穿平台链）', () => {
    const command = createModACommand({ isEnabled: () => false })
    const { view, calls } = fakeView(EditorState.create({ doc: 'aaa\nbbb', selection: { anchor: 1 } }))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('功能开且命中 → 派发纯选区事务（零写回）并接管（return true）', () => {
    const command = createModACommand({ isEnabled: () => true })
    const { view, calls } = fakeView(EditorState.create({ doc: 'aaa\nbbb', selection: { anchor: 1 } }))
    expect(command(view)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.selection).toEqual({ anchor: 0, head: 3 })
    expect(calls[0]!.changes).toBeUndefined()
  })

  it('功能开但状态机失配（围栏内）→ 透传（return false 零派发）', () => {
    const command = createModACommand({ isEnabled: () => true })
    const { view, calls } = fakeView(EditorState.create({ doc: '```\nc\n```', selection: { anchor: 5 } }))
    expect(command(view)).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('设置门 createEnhanceModAGate：enhanceModA 生效值缓存', () => {
  function channelOf(result: unknown, ok = true): VsidianAddonPageSdk['channel'] {
    return {
      request: async () => (ok ? { ok: true, result } : ({ ok: false, reason: 'rejected' } as AddonChannelOutcome)),
    }
  }

  it('初始关闭（通道返回前一律透传）', () => {
    expect(createEnhanceModAGate(channelOf(null)).enabled()).toBe(false)
  })

  it('refresh 命中 effective.enhanceModA=true → 开', async () => {
    const gate = createEnhanceModAGate(channelOf({ effective: { enhanceModA: true } }))
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
  })

  it('refresh 返回 false → 关（设置页关闭后回生效）', async () => {
    const gate = createEnhanceModAGate(channelOf({ effective: { enhanceModA: false } }))
    await gate.refresh()
    expect(gate.enabled()).toBe(false)
  })

  it('通道失败（timeout/rejected）→ 保持上次值（fail-safe 不翻转）', async () => {
    let ok = true
    const gate = createEnhanceModAGate({
      request: async () => (ok ? { ok: true, result: { effective: { enhanceModA: true } } } : { ok: false, reason: 'timeout' }),
    })
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
    ok = false
    await gate.refresh()
    expect(gate.enabled()).toBe(true)
  })

  it('载荷形态异常（缺 effective / 非 boolean）→ 关', async () => {
    const noEffective = createEnhanceModAGate(channelOf({ values: {} }))
    await noEffective.refresh()
    expect(noEffective.enabled()).toBe(false)
    const wrongType = createEnhanceModAGate(channelOf({ effective: { enhanceModA: 'yes' } }))
    await wrongType.refresh()
    expect(wrongType.enabled()).toBe(false)
  })

  it('消费 #3 的设置通道 topic 常量（不自建第二份协议）', async () => {
    const seen: string[] = []
    const gate = createEnhanceModAGate({
      request: async (topic) => {
        seen.push(topic)
        return { ok: true, result: { effective: { enhanceModA: true } } }
      },
    })
    await gate.refresh()
    expect(seen).toEqual([SETTINGS_TOPIC.get])
  })
})

describe('「选择当前块」命令注册契约（平台稳定 commands API）', () => {
  it('定义形状：局部 ID 无点号 / mode live / 非写操作 / 默认未绑定（上游无默认热键）', () => {
    const def = buildSelectBlockCommandDefinition(pickMessages('zh-CN'))
    expect(def.id).toBe('select-block')
    expect(def.id.includes('.')).toBe(false)
    expect(def.title).toBe(pickMessages('zh-CN').commandSelectBlock)
    expect(def.mode).toBe('live')
    expect(def.writes).toBe(false)
    expect(def.defaultBindings).toEqual([])
  })

  it('标题经 i18n 双语字典', () => {
    expect(buildSelectBlockCommandDefinition(pickMessages('zh-CN')).title).toContain('块')
    expect(buildSelectBlockCommandDefinition(pickMessages('en-US')).title).not.toBe(
      buildSelectBlockCommandDefinition(pickMessages('zh-CN')).title,
    )
  })
})

describe('「选择当前块」命令 handler：目标视图路由', () => {
  /** fallback 路径的最小 views 面 fake（字面量类型对齐 vendor 形状） */
  function fakeViewsFacade(doc: string, cursor: number, fail = false) {
    const setSelectionCalls: Array<Array<{ anchor: number; head: number }>> = []
    const facade = {
      get: (_instanceId: string) => ({
        info: {
          instanceId: 'main',
          targetDocUri: 'file:///x.md',
          mode: 'live' as const,
          viewType: 'main' as const,
          editable: true,
        },
        editor: {
          getSnapshot: (): { ok: true; snapshot: { text: string; selections: Array<{ anchor: number; head: number }>; version: number; revision: number } } | { ok: false; reason: 'view-disposed' } =>
            fail
              ? { ok: false, reason: 'view-disposed' }
              : { ok: true, snapshot: { text: doc, selections: [{ anchor: cursor, head: cursor }], version: 1, revision: 1 } },
          setSelection: (ranges: Array<{ anchor: number; head: number }>) => {
            setSelectionCalls.push(ranges)
            return true
          },
        },
      }),
    }
    return { facade, setSelectionCalls }
  }

  it('焦点视图在场：直接派发纯选区事务（零写回）', () => {
    const { view, calls } = fakeView(EditorState.create({ doc: 'aaa\nbbb', selection: { anchor: 1 } }))
    const handler = createSelectBlockCommandHandler({
      cm6: { state: { EditorState } },
      getFocusedView: () => view,
    })
    handler()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.selection).toEqual({ anchor: 0, head: 7 })
    expect(calls[0]!.changes).toBeUndefined()
  })

  it('无焦点视图（命令面板触发）：主视图快照回退 + setSelection', () => {
    const { facade, setSelectionCalls } = fakeViewsFacade('aaa\nbbb\n\nc', 1)
    const handler = createSelectBlockCommandHandler({
      cm6: { state: { EditorState } },
      views: facade,
      getFocusedView: () => null,
    })
    handler()
    expect(setSelectionCalls).toEqual([[{ anchor: 0, head: 7 }]])
  })

  it('空行无操作（两条路径均不派发）', () => {
    const { view, calls } = fakeView(EditorState.create({ doc: 'aaa\n\nbbb', selection: { anchor: 4 } }))
    const focused = createSelectBlockCommandHandler({ cm6: { state: { EditorState } }, getFocusedView: () => view })
    focused()
    expect(calls).toHaveLength(0)

    const { facade, setSelectionCalls } = fakeViewsFacade('aaa\n\nbbb', 4)
    const fallback = createSelectBlockCommandHandler({
      cm6: { state: { EditorState } },
      views: facade,
      getFocusedView: () => null,
    })
    fallback()
    expect(setSelectionCalls).toHaveLength(0)
  })

  it('主视图快照失败（view-disposed）→ 无操作不抛错', () => {
    const { facade, setSelectionCalls } = fakeViewsFacade('aaa', 0, true)
    const handler = createSelectBlockCommandHandler({
      cm6: { state: { EditorState } },
      views: facade,
      getFocusedView: () => null,
    })
    expect(() => handler()).not.toThrow()
    expect(setSelectionCalls).toHaveLength(0)
  })
})
