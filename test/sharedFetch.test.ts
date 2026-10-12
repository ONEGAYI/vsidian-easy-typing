// 共享设置拉取通道（工单 #32）契约测试。
//
// 背景：编辑器页一次 focusChanged 由 4 个独立 updateListener 在同一同步
// 块内触发 8 个设置门各自 refresh（behaviorGates ×4 + debug + modA +
// collapseEnter + newLineBelow），此前各发一次 SETTINGS_TOPIC.get——宿主
// 侧每请求对 24 键 effective 全量 structuredClone，8 次请求 = 8 次克隆 +
// 8 次消息往返。createSharedSettingsChannel 在 channel.request 层对并发
// 的 get+null 做在途 promise 去重：首个请求在途时后续同参请求复用同一
// promise，settle 即清槽（非时间窗缓存，无陈旧数据问题）。
//
// 判别口径（票面验收 1）：同步 8 次 get → 底层真实请求计数 = 1。装载期
// 首拉与 focusChanged 是同批同步发起的 8 次，顺带被同一机制合并。
import { describe, expect, it } from 'vitest'
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { NOTICE_TOPIC, SETTINGS_TOPIC } from '../src/settings/store'
import { createSharedSettingsChannel } from '../src/settings/sharedFetch'
import { createEnhanceModAGate } from '../src/modaIntercept'
import { createCollapseEnterGate } from '../src/foldEnter'

interface RecordedCall {
  topic: string
  payload: unknown
  opts?: { timeoutMs?: number }
}

/** 计数通道替身（对齐 modaIntercept.test.ts 的 channelOf 惯例，加调用
 * 记录）：底层每被真实调用一次记一条，outcome 固定返回 */
function countingChannel(
  outcome: AddonChannelOutcome,
): VsidianAddonPageSdk['channel'] & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    request: (topic, payload, opts) => {
      calls.push({ topic, payload, opts })
      return Promise.resolve(outcome)
    },
  }
}

describe('共享设置通道 createSharedSettingsChannel：并发 get 在途去重（#32）', () => {
  it('一次 focusChanged 形态：同步 8 次 get → 底层单次请求，8 个结果为同一引用', async () => {
    const outcome: AddonChannelOutcome = { ok: true, result: { effective: {} } }
    const underlying = countingChannel(outcome)
    const shared = createSharedSettingsChannel(underlying)
    const results = Array.from({ length: 8 }, () => shared.request(SETTINGS_TOPIC.get, null))
    // 判别断言（票面验收 1）：8 个并发请求合并为 1 次真实底层请求
    expect(underlying.calls).toHaveLength(1)
    // 同一 outcome 引用共享给全部调用方——gate 侧只读消费（模块头注契约），
    // 各 gate 从同一 effective 各取各键
    for (const promise of results) expect(await promise).toBe(outcome)
  })

  it('两轮独立触发：settle 即清槽，第二轮重新发起（无陈旧缓存）', async () => {
    const outcome: AddonChannelOutcome = { ok: true, result: null }
    const underlying = countingChannel(outcome)
    const shared = createSharedSettingsChannel(underlying)
    await Promise.all(Array.from({ length: 8 }, () => shared.request(SETTINGS_TOPIC.get, null)))
    expect(underlying.calls).toHaveLength(1)
    await Promise.all(Array.from({ length: 8 }, () => shared.request(SETTINGS_TOPIC.get, null)))
    expect(underlying.calls).toHaveLength(2)
  })

  it('失败 outcome 共享：8 个调用方收到同一失败引用（各 gate 早退保持上次值的前提）', async () => {
    const failure: AddonChannelOutcome = { ok: false, reason: 'timeout' }
    const underlying = countingChannel(failure)
    const shared = createSharedSettingsChannel(underlying)
    const results = await Promise.all(Array.from({ length: 8 }, () => shared.request(SETTINGS_TOPIC.get, null)))
    expect(underlying.calls).toHaveLength(1)
    for (const outcome of results) expect(outcome).toBe(failure)
  })

  it('底层异常（reject 而非失败 outcome）同样共享，且清槽后新请求重新发起', async () => {
    let calls = 0
    const shared = createSharedSettingsChannel({
      request: () => {
        calls += 1
        return calls === 1 ? Promise.reject(new Error('channel broken')) : Promise.resolve({ ok: true, result: null })
      },
    })
    const first = shared.request(SETTINGS_TOPIC.get, null)
    const second = shared.request(SETTINGS_TOPIC.get, null)
    // 同一 rejection 派给两个并发调用方（与失败 outcome 共享同语义）
    await expect(first).rejects.toThrow('channel broken')
    await expect(second).rejects.toThrow('channel broken')
    expect(calls).toBe(1)
    // settle 即清槽：后续请求重新发起，不把异常态缓存住
    await expect(shared.request(SETTINGS_TOPIC.get, null)).resolves.toEqual({ ok: true, result: null })
    expect(calls).toBe(2)
  })

  it('非 get topic 逐次透传（不合并）', async () => {
    const outcome: AddonChannelOutcome = { ok: true, result: null }
    const underlying = countingChannel(outcome)
    const shared = createSharedSettingsChannel(underlying)
    await Promise.all([
      shared.request(NOTICE_TOPIC, { kind: 'command-file-excluded' }),
      shared.request(NOTICE_TOPIC, { kind: 'command-file-excluded' }),
      shared.request(SETTINGS_TOPIC.update, { scope: 'user', patch: {} }),
    ])
    expect(underlying.calls).toHaveLength(3)
    expect(underlying.calls[0].topic).toBe(NOTICE_TOPIC)
    expect(underlying.calls[2].topic).toBe(SETTINGS_TOPIC.update)
  })

  it('get + 非 null payload 逐次透传（当前协议 get 恒为 null 载荷；未来带载荷形态不误合并）', async () => {
    const outcome: AddonChannelOutcome = { ok: true, result: null }
    const underlying = countingChannel(outcome)
    const shared = createSharedSettingsChannel(underlying)
    await Promise.all(Array.from({ length: 3 }, () => shared.request(SETTINGS_TOPIC.get, { keys: ['debug'] })))
    expect(underlying.calls).toHaveLength(3)
  })

  it('opts 原样透传到底层（首个调用的 opts 生效，复用请求不重复传参）', async () => {
    const outcome: AddonChannelOutcome = { ok: true, result: null }
    const underlying = countingChannel(outcome)
    const shared = createSharedSettingsChannel(underlying)
    const firstOpts = { timeoutMs: 1234 }
    const secondOpts = { timeoutMs: 5678 }
    void shared.request(SETTINGS_TOPIC.get, null, firstOpts)
    void shared.request(SETTINGS_TOPIC.get, null, secondOpts)
    expect(underlying.calls).toHaveLength(1)
    expect(underlying.calls[0].opts).toBe(firstOpts)
    await Promise.resolve()
  })

  it('异步间隙不合并：await 排空后的新请求重新发起（边界退化为现状，不出错）', async () => {
    const outcome: AddonChannelOutcome = { ok: true, result: null }
    const underlying = countingChannel(outcome)
    const shared = createSharedSettingsChannel(underlying)
    await shared.request(SETTINGS_TOPIC.get, null)
    await shared.request(SETTINGS_TOPIC.get, null)
    expect(underlying.calls).toHaveLength(2)
  })

  it('两个真实 gate 经共享通道同步 refresh → 底层单次请求、各取各键（focusChanged 收敛形态演示）', async () => {
    const underlying = countingChannel({
      ok: true,
      result: { effective: { enhanceModA: true, collapsePersistentEnter: true } },
    })
    const shared = createSharedSettingsChannel(underlying)
    const modAGate = createEnhanceModAGate(shared)
    const collapseGate = createCollapseEnterGate(shared)
    const pending = [modAGate.refresh(), collapseGate.refresh()]
    // 同步发起的并发 refresh（focusChanged 监听形态）已合并为单次请求
    expect(underlying.calls).toHaveLength(1)
    await Promise.all(pending)
    expect(modAGate.enabled()).toBe(true)
    expect(collapseGate.enabled()).toBe(true)
  })
})
