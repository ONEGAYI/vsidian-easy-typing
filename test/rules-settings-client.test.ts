// 设置页规则数据客户端矩阵（工单 #16）：装载与形状防御、mutate 载荷构造、
// 写后刷新（每次成功变更重拉快照 + onStateChange）、导入计数语义与导出/
// storageUri 读取。通道为可编程 mock（脚本化 topic 队列）——载荷断言钉住
// 「UI 编辑经 mutate op 走宿主单写点」的数据链约束。
import { describe, expect, it, vi } from 'vitest'
import { RulesSettingsClient } from '../src/rules/rules-settings-client'
import { RULES_TOPIC } from '../src/rules/rules-protocol'
import type { RulesChannelLike } from '../src/rules/rules-page'

type Outcome = { ok: true; result: unknown } | { ok: false; reason: string }

/** 脚本化 mock 通道：按 topic 消费队列，记录全部请求载荷 */
function scriptedChannel(script: Record<string, Outcome[]>) {
  const requests: Array<{ topic: string; payload: unknown }> = []
  const channel: RulesChannelLike = {
    request: async (topic, payload) => {
      requests.push({ topic, payload })
      const next = script[topic]?.shift()
      return next ?? { ok: false, reason: 'rejected' }
    },
  }
  return { channel, requests }
}

const snapshot = (revision = 1, extra: Partial<{ user: unknown[]; deleted: string[] }> = {}) => ({
  revision,
  builtin: [{ id: 'b1', trigger: '【', replacement: '【$0】', options: '' }],
  user: extra.user ?? [],
  deletedBuiltinRuleIds: extra.deleted ?? [],
})

describe('RulesSettingsClient 装载', () => {
  it('load：快照入态、loaded 置位、onStateChange 通知', async () => {
    const onChange = vi.fn()
    const { channel } = scriptedChannel({
      [RULES_TOPIC.get]: [{ ok: true, result: snapshot(7, { user: [{ id: 'u1', trigger: 'a', replacement: 'b' }] }) }],
    })
    const client = new RulesSettingsClient({ channel, onStateChange: onChange })
    expect(client.state.loaded).toBe(false)
    await client.load()
    expect(client.state).toMatchObject({
      loaded: true,
      revision: 7,
      deletedBuiltinRuleIds: [],
    })
    expect(client.state.user).toHaveLength(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('通道失败 / 形状非法：返回 false，状态保持原状', async () => {
    const failed = new RulesSettingsClient({
      channel: { request: async () => ({ ok: false, reason: 'timeout' }) },
    })
    expect(await failed.load()).toBe(false)
    expect(failed.state.loaded).toBe(false)

    const badShape = scriptedChannel({
      [RULES_TOPIC.get]: [{ ok: true, result: { revision: 'x', builtin: [], user: [], deletedBuiltinRuleIds: [] } }],
    })
    const client2 = new RulesSettingsClient({ channel: badShape.channel })
    expect(await client2.load()).toBe(false)
    expect(client2.state.loaded).toBe(false)
  })
})

describe('RulesSettingsClient 动作与写后刷新', () => {
  it('addUserRule：载荷 {op,rule}，成功记录新 id 并整拉刷新', async () => {
    const { channel, requests } = scriptedChannel({
      [RULES_TOPIC.mutate]: [{ ok: true, result: { ok: true, id: 'user-1', revision: 2 } }],
      [RULES_TOPIC.get]: [{ ok: true, result: snapshot(2, { user: [{ id: 'user-1', trigger: 'a', replacement: 'b' }] }) }],
    })
    const onChange = vi.fn()
    const client = new RulesSettingsClient({ channel, onStateChange: onChange })
    const rule = { trigger: 'a', replacement: 'b' }
    expect(await client.addUserRule(rule)).toEqual({ ok: true })
    expect(requests[0]).toEqual({ topic: RULES_TOPIC.mutate, payload: { op: 'addUserRule', rule } })
    expect(requests[1]!.topic).toBe(RULES_TOPIC.get)
    expect(client.lastCreatedId).toBe('user-1')
    expect(client.state.user).toHaveLength(1)
    expect(onChange).toHaveBeenCalledTimes(1) // 仅 load 刷新通知一次
  })

  it('updateUserRule / deleteUserRule / toggleUserRuleEnabled：载荷逐 op 钉住', async () => {
    const { channel, requests } = scriptedChannel({
      [RULES_TOPIC.mutate]: [
        { ok: true, result: { ok: true, revision: 2 } },
        { ok: true, result: { ok: true, revision: 3 } },
        { ok: true, result: { ok: true, revision: 4 } },
      ],
      [RULES_TOPIC.get]: [
        { ok: true, result: snapshot(2) },
        { ok: true, result: snapshot(3) },
        { ok: true, result: snapshot(4) },
      ],
    })
    const client = new RulesSettingsClient({ channel })
    const rule = { trigger: 'x', replacement: 'y' }
    expect(await client.updateUserRule('u1', rule)).toEqual({ ok: true })
    expect(await client.deleteUserRule('u1')).toEqual({ ok: true })
    expect(await client.toggleUserRuleEnabled('u2', false)).toEqual({ ok: true })
    const payloads = requests.filter((r) => r.topic === RULES_TOPIC.mutate).map((r) => r.payload)
    expect(payloads).toEqual([
      { op: 'updateUserRule', id: 'u1', rule },
      { op: 'deleteUserRule', id: 'u1' },
      { op: 'toggleRuleEnabled', id: 'u2', isBuiltin: false, enabled: false },
    ])
  })

  it('内置规则族：disable=deleteBuiltinRule、restore、resetAll', async () => {
    const { channel, requests } = scriptedChannel({
      [RULES_TOPIC.mutate]: [
        { ok: true, result: { ok: true, revision: 2 } },
        { ok: true, result: { ok: true, revision: 3 } },
        { ok: true, result: { ok: true, revision: 4 } },
      ],
      [RULES_TOPIC.get]: [
        { ok: true, result: snapshot(2) },
        { ok: true, result: snapshot(3) },
        { ok: true, result: snapshot(4) },
      ],
    })
    const client = new RulesSettingsClient({ channel })
    expect(await client.disableBuiltinRule('b1')).toEqual({ ok: true })
    expect(await client.restoreBuiltinRule('b1')).toEqual({ ok: true })
    expect(await client.resetAllBuiltinRules()).toEqual({ ok: true })
    expect(requests.filter((r) => r.topic === RULES_TOPIC.mutate).map((r) => r.payload)).toEqual([
      { op: 'deleteBuiltinRule', id: 'b1' },
      { op: 'restoreBuiltinRule', id: 'b1' },
      { op: 'resetAllBuiltinRules' },
    ])
  })

  it('reorderUserRule：载荷携带 splice 语义索引', async () => {
    const { channel, requests } = scriptedChannel({
      [RULES_TOPIC.mutate]: [{ ok: true, result: { ok: true, revision: 2 } }],
      [RULES_TOPIC.get]: [{ ok: true, result: snapshot(2) }],
    })
    const client = new RulesSettingsClient({ channel })
    await client.reorderUserRule(0, 2)
    expect(requests[0]!.payload).toEqual({ op: 'reorderUserRule', fromIndex: 0, toIndex: 2 })
  })

  it('业务拒绝（io-failed）不刷新且透出 reason；通道层失败折叠 channel-failed', async () => {
    const { channel } = scriptedChannel({
      [RULES_TOPIC.mutate]: [
        { ok: true, result: { ok: false, reason: 'io-failed' } },
        { ok: false, reason: 'timeout' },
      ],
    })
    const onChange = vi.fn()
    const client = new RulesSettingsClient({ channel, onStateChange: onChange })
    expect(await client.deleteUserRule('u1')).toEqual({ ok: false, reason: 'io-failed' })
    expect(await client.deleteUserRule('u1')).toEqual({ ok: false, reason: 'channel-failed' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('RulesSettingsClient 导入导出', () => {
  it('importUserRules：载荷 {op,content}（字符串直传宿主解析），成功刷新并返回计数', async () => {
    const content = JSON.stringify([{ trigger: 'a', replacement: 'b' }])
    const { channel, requests } = scriptedChannel({
      [RULES_TOPIC.mutate]: [
        { ok: true, result: { ok: true, imported: 1, skipped: 2, persisted: true, revision: 2 } },
      ],
      [RULES_TOPIC.get]: [{ ok: true, result: snapshot(2) }],
    })
    const client = new RulesSettingsClient({ channel })
    expect(await client.importUserRules(content)).toEqual({ imported: 1, skipped: 2 })
    expect(requests[0]!.payload).toEqual({ op: 'importUserRules', content })
    expect(client.state.revision).toBe(2)
  })

  it('importUserRules：全重复（persisted:false + 计数）算完成动作但不刷新', async () => {
    const { channel } = scriptedChannel({
      [RULES_TOPIC.mutate]: [{ ok: true, result: { ok: false, imported: 0, skipped: 3, persisted: false } }],
      [RULES_TOPIC.get]: [{ ok: true, result: snapshot(2) }],
    })
    const onChange = vi.fn()
    const client = new RulesSettingsClient({ channel, onStateChange: onChange })
    expect(await client.importUserRules('[]')).toEqual({ imported: 0, skipped: 3 })
    expect(onChange).not.toHaveBeenCalled() // 无持久化变更不整拉
  })

  it('importUserRules：本地预检拦非 JSON / 非数组（null 且不发通道）', async () => {
    const { channel, requests } = scriptedChannel({})
    const client = new RulesSettingsClient({ channel })
    expect(await client.importUserRules('not json')).toBeNull()
    expect(await client.importUserRules('{"a":1}')).toBeNull()
    expect(requests).toEqual([]) // 形状级拒绝不消耗宿主往返
  })

  it('importUserRules：空数组经宿主判定（无规则导入亦为完成动作）', async () => {
    const { channel } = scriptedChannel({
      [RULES_TOPIC.mutate]: [{ ok: true, result: { ok: false, imported: 0, skipped: 0, persisted: false } }],
    })
    const client = new RulesSettingsClient({ channel })
    expect(await client.importUserRules('[]')).toEqual({ imported: 0, skipped: 0 })
  })

  it('importUserRules：宿主 invalid-json 拒绝 → null（双端判定漂移兜底）', async () => {
    const { channel } = scriptedChannel({
      [RULES_TOPIC.mutate]: [{ ok: true, result: { ok: false, reason: 'invalid-json' } }],
    })
    const client = new RulesSettingsClient({ channel })
    // '[]' 过本地预检（数组形状）；宿主拒绝时折叠回 null
    expect(await client.importUserRules('[]')).toBeNull()
  })

  it('exportUserRules / storageUri：读取通道结果；失败 null', async () => {
    const { channel } = scriptedChannel({
      [RULES_TOPIC.exportUser]: [
        { ok: true, result: { content: '[{}]' } },
        { ok: false, reason: 'rejected' },
      ],
      [RULES_TOPIC.storageUri]: [{ ok: true, result: { uri: 'file:///addons/et' } }],
    })
    const client = new RulesSettingsClient({ channel })
    expect(await client.exportUserRules()).toBe('[{}]')
    expect(await client.exportUserRules()).toBeNull()
    expect(await client.storageUri()).toBe('file:///addons/et')
  })
})
