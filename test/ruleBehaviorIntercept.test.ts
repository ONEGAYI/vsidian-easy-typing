// 行为链接入层测试（工单 #25）：功能族注册契约、默认链序与上游优先级
// 对照、族引擎装载（含 reportError 注入）、onInput 全链、设置门与
// reportError 节流上报。分族依据与 joinPrevious 核对结论记录在
// docs/specs/rule-engine.md「#25 行为链接入」节。
import { describe, expect, it } from 'vitest'
import { RuleEngine, RuleScope, RuleType } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import { pickMessages } from '../src/i18n'
import { SETTINGS_TOPIC } from '../src/settings/store'
import type { AddonBehaviorRegistration } from '../types/vendor/shared/addonBehaviors'
import {
  INPUT_RULE_EXCLUSIVE_GROUP,
  INPUT_RULE_FAMILIES,
  RULE_ERROR_TOPIC,
  buildFamilyEngine,
  createRuleErrorReporter,
  registerRuleInputBehaviors,
  type RuleFamilyDefinition,
} from '../src/ruleBehaviorIntercept'

/** 注册载荷观测面（结构即 AddonBehaviorRegistration） */
type RuleBehaviorRegistrationSubset = AddonBehaviorRegistration

/** 上游 Input 类内置规则（按优先级 + 注册序稳定排序——引擎装载序） */
function inputRulesSortedById(): string[] {
  return DEFAULT_BUILTIN_RULES
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => RuleEngine.parseOptions(r.options).type === RuleType.Input)
    .sort((a, b) => (a.r.priority ?? 100) - (b.r.priority ?? 100) || a.index - b.index)
    .map(({ r }) => r.id)
}

/** 规则 id → 族表序映射（断言 id 必在族表内） */
function familyIndexOfRule(ruleId: string): number {
  const idx = INPUT_RULE_FAMILIES.findIndex((f) => f.ruleIds.includes(ruleId))
  expect(idx, `族表应含规则 ${ruleId}`).toBeGreaterThanOrEqual(0)
  return idx
}

describe('功能族契约：分族覆盖与无重叠', () => {
  it('族表恰好覆盖全部 Input 类内置规则（10 条），无遗漏无重复', () => {
    const familyRuleIds = INPUT_RULE_FAMILIES.flatMap((f) => f.ruleIds)
    expect(new Set(familyRuleIds).size).toBe(familyRuleIds.length)
    expect([...familyRuleIds].sort()).toEqual(inputRulesSortedById().sort())
    expect(familyRuleIds.length).toBe(10)
  })

  it('族表不含 Delete / SelectKey 类规则（归 #9 管线）', () => {
    const nonInput = DEFAULT_BUILTIN_RULES
      .filter((r) => RuleEngine.parseOptions(r.options).type !== RuleType.Input)
      .map((r) => r.id)
    const familyRuleIds = new Set(INPUT_RULE_FAMILIES.flatMap((f) => f.ruleIds))
    for (const id of nonInput) expect(familyRuleIds.has(id), id).toBe(false)
    expect(nonInput.length).toBe(10)
  })
})

describe('默认链序：localId 字典序复刻上游优先级序', () => {
  it('族 localId 升序排列（平台默认有效序 = 完整键字典序）', () => {
    const ids = INPUT_RULE_FAMILIES.map((f) => f.localId)
    expect([...ids].sort()).toEqual(ids)
  })

  it('上游优先级序在族表上单调不回退，且五族全部出现', () => {
    const familySequence = inputRulesSortedById().map((id) => familyIndexOfRule(id))
    for (let i = 1; i < familySequence.length; i++) {
      expect(familySequence[i]).toBeGreaterThanOrEqual(familySequence[i - 1]!)
    }
    expect(new Set(familySequence).size).toBe(INPUT_RULE_FAMILIES.length)
  })

  it('族序与上游优先级分层一一对应（3 / 5+10 / 10 / 15 / 50）', () => {
    expect(INPUT_RULE_FAMILIES.map((f) => f.localId)).toEqual([
      '01-punct-collapse',
      '02-autopair',
      '03-symbol-convert',
      '04-punct-expand',
      '05-quote',
    ])
  })
})

describe('注册形状契约（AddonBehaviorRegistration）', () => {
  function registerAll(language: string): {
    registrations: RuleBehaviorRegistrationSubset[]
    requestedTopics: string[]
    onChangedCallbacks: Array<() => void>
    runtime: ReturnType<typeof registerRuleInputBehaviors>
  } {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    const requestedTopics: string[] = []
    const onChangedCallbacks: Array<() => void> = []
    const runtime = registerRuleInputBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: `ONEGAYI.vsidian-easy-typing#${reg.id}` }
        },
        onChanged: (cb) => {
          onChangedCallbacks.push(cb)
          return () => {}
        },
      },
      channel: {
        request: (topic) => {
          requestedTopics.push(topic)
          return Promise.resolve({ ok: true as const, result: { effective: { debug: false } } })
        },
      },
      language,
    })
    return { registrations, requestedTopics, onChangedCallbacks, runtime }
  }

  it('五族各注册一条：名称/说明走字典、history 一律 atomic、同一独占组', () => {
    const { registrations } = registerAll('zh-CN')
    expect(registrations.length).toBe(INPUT_RULE_FAMILIES.length)
    const m = pickMessages('zh-CN')
    for (const reg of registrations) {
      expect(reg.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      expect(reg.name.length).toBeGreaterThan(0)
      expect(reg.description).toBeDefined()
      expect((reg.examples ?? []).length).toBeGreaterThan(0)
      expect((reg.examples ?? []).length).toBeLessThanOrEqual(8)
      expect(reg.history).toBe('atomic')
      expect(reg.exclusiveGroup).toBe(INPUT_RULE_EXCLUSIVE_GROUP)
      expect(typeof reg.onInput).toBe('function')
    }
    expect(registrations.some((r) => r.name === m.ruleFamilies.autopair.name)).toBe(true)
  })

  it('onInput 全链：括号补全场景经注册回调产出计划；delete 事件返回 null', () => {
    const { registrations } = registerAll('zh-CN')
    const autopair = registrations.find((r) => r.id === '02-autopair')!
    const plan = autopair.onInput({
      userEvent: 'input.type',
      inputText: '（',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: '（', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '（）' }],
      selection: { anchor: 1, head: 1 },
    })
    const onDelete = autopair.onInput({
      userEvent: 'delete.backward',
      inputText: '',
      replaced: { from: 0, to: 1, text: '）' },
      docUri: 'file:///a.md',
      snapshot: { text: '（）', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(onDelete).toBeNull()
  })

  it('tabstop 暂存通道（#15×#25 接线）：命中含占位符的计划后可取、读即消费', () => {
    const { registrations, runtime } = registerAll('zh-CN')
    // 基线：无命中后为空
    expect(runtime.consumePendingTabstops()).toEqual([])
    const autopair = registrations.find((r) => r.id === '02-autopair')!
    autopair.onInput({
      userEvent: 'input.type',
      inputText: '（',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: '（', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    // 命中计划（（）补全）携带 $0 → tabstop 组暂存待取
    const pending = runtime.consumePendingTabstops()
    expect(pending.length).toBeGreaterThan(0)
    expect(pending[0]).toMatchObject({ number: 0 })
    // 读即消费：再取为空
    expect(runtime.consumePendingTabstops()).toEqual([])
  })

  it('注册拒绝（duplicate-id）不是故障：结果记录 ok:false，不抛错', () => {
    const { outcomes } = registerRuleInputBehaviors({
      behaviors: {
        register: () => ({ ok: false as const, reason: 'duplicate-id' }),
        onChanged: () => () => {},
      },
      channel: neverResolvingChannel(),
      language: 'en',
    })
    expect(outcomes.length).toBe(INPUT_RULE_FAMILIES.length)
    expect(outcomes.every((r) => !r.ok)).toBe(true)
  })

  it('英文语言标签取英文字典名称', () => {
    const { registrations } = registerAll('en-US')
    const m = pickMessages('en-US')
    expect(registrations.some((r) => r.name === m.ruleFamilies.autopair.name)).toBe(true)
  })

  it('设置门：装载时与每次 onChanged 拉取 effective（#3 门面通道）', () => {
    const { requestedTopics, onChangedCallbacks } = registerAll('zh-CN')
    expect(requestedTopics.filter((t) => t === SETTINGS_TOPIC.get).length).toBeGreaterThanOrEqual(1)
    onChangedCallbacks.forEach((cb) => cb())
    expect(requestedTopics.filter((t) => t === SETTINGS_TOPIC.get).length).toBeGreaterThanOrEqual(2)
  })
})

describe('族引擎装载（buildFamilyEngine）', () => {
  it('每族只装载本族规则，规则 id 保留且均为 Input 类', () => {
    for (const family of INPUT_RULE_FAMILIES) {
      const engine = buildFamilyEngine(family, undefined)
      expect(engine.getRules().map((r) => r.id)).toEqual(family.ruleIds)
      expect(engine.getRules().every((r) => r.type === RuleType.Input)).toBe(true)
    }
  })

  it('reportError 注入：非法正则在 process 时上报并跳过（#1 上报缝）', () => {
    const reported: Array<[string, string]> = []
    const brokenFamily: RuleFamilyDefinition = {
      localId: 'test-broken',
      i18nKey: 'autopair',
      ruleIds: ['test-bad-regex'],
      rules: [{ id: 'test-bad-regex', trigger: '([', replacement: 'X', options: 'r' }],
    }
    const engine = buildFamilyEngine(brokenFamily, (ruleId, message) => reported.push([ruleId, message]))
    const plan = engine.process({
      kind: RuleType.Input,
      docText: 'a[',
      selection: { from: 2, to: 2 },
      inserted: '[',
      changeType: 'input.type',
      scopeHint: RuleScope.Text,
    })
    expect(plan).toBeNull()
    expect(reported.length).toBe(1)
    expect(reported[0]![0]).toBe('test-bad-regex')
  })
})

describe('reportError 节流上报（createRuleErrorReporter）', () => {
  it('窗口期内仅首条发出通道请求，窗口过后恢复', () => {
    const requests: Array<{ topic: string; payload: unknown }> = []
    const channel = {
      request: (topic: string, payload: unknown) => {
        requests.push({ topic, payload })
        return Promise.resolve({ ok: true as const, result: null })
      },
    }
    let now = 1_000_000
    const reporter = createRuleErrorReporter(channel, { now: () => now })
    reporter('r1', 'first')
    reporter('r2', 'throttled')
    now += 4_999
    reporter('r3', 'still-throttled')
    expect(requests.length).toBe(1)
    expect(requests[0]).toEqual({ topic: RULE_ERROR_TOPIC, payload: { ruleId: 'r1', message: 'first' } })
    now += 2
    reporter('r4', 'second-window')
    expect(requests.length).toBe(2)
    expect(requests[1]!.payload).toEqual({ ruleId: 'r4', message: 'second-window' })
  })

  it('通道拒绝（released/timeout）静默——上报是尽力而为通道', async () => {
    const channel = {
      request: () => Promise.resolve({ ok: false as const, reason: 'released' }),
    }
    const reporter = createRuleErrorReporter(channel, { now: () => 0 })
    expect(() => {
      reporter('r1', 'x')
      reporter('r1', 'y')
    }).not.toThrow()
    await Promise.resolve()
  })
})

/** 通道不可达（请求失败）——注册与行为不依赖设置通道可用 */
function neverResolvingChannel(): { request: () => Promise<{ ok: false; reason: 'timeout' }> } {
  return { request: () => Promise.resolve({ ok: false as const, reason: 'timeout' as const }) }
}
