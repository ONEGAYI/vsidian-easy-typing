// 行为链接入层测试（工单 #25 + 工单 #9）：功能族注册契约、默认链序与
// 上游优先级对照、族引擎装载（含 reportError 注入）、onInput 全链、设置
// 门与 reportError 节流上报。#9 增补：Delete/SelectKey 族契约、注册形状
// 与三类触发面的端到端链仲裁（按平台 addonBehaviors runtime 语义模拟有
// 效序 + 独占组）。分族依据与 joinPrevious 核对结论记录在
// docs/specs/rule-engine.md「#25 行为链接入」「#9 Delete/SelectKey 触发
// 接入」节。
import { describe, expect, it, vi } from 'vitest'
import { RuleEngine, RuleScope, RuleType } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import { pickMessages } from '../src/i18n'
import { SETTINGS_TOPIC } from '../src/settings/store'
import type { AddonBehaviorRegistration, AddonBehaviorInputPlan } from '../types/vendor/shared/addonBehaviors'
import {
  DELETE_SELECTKEY_RULE_FAMILIES,
  INPUT_RULE_EXCLUSIVE_GROUP,
  INPUT_RULE_FAMILIES,
  RULE_ERROR_TOPIC,
  buildFamilyEngine,
  createRuleErrorReporter,
  createRulePipelineGate,
  createRuleSnapshotSource,
  registerRuleDeleteSelectKeyBehaviors,
  registerRuleInputBehaviors,
  resolveRuleFamilies,
  type RuleFamilyDefinition,
} from '../src/ruleBehaviorIntercept'
import { PageRulesClient } from '../src/rules/rules-page'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { RULES_TOPIC } from '../src/rules/rules-protocol'
import { USER_RULES_FILE } from '../src/rules/rule-store'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'

/** 消费时点文档 mock（CM6 Text 结构子集——LF 字符串切片；B-F2 校验入参） */
function docOf(text: string): { sliceString(from: number, to: number): string } {
  return { sliceString: (from, to) => text.slice(from, to) }
}

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
    expect(runtime.consumePendingTabstops(docOf('（）'))).toEqual([])
    const autopair = registrations.find((r) => r.id === '02-autopair')!
    autopair.onInput({
      userEvent: 'input.type',
      inputText: '（',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: '（', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    // 命中计划（（）补全）携带 $0 → tabstop 组暂存待取（文档已呈现计划
    // 替换形态 → B-F2 校验通过）
    const pending = runtime.consumePendingTabstops(docOf('（）'))
    expect(pending.length).toBeGreaterThan(0)
    expect(pending[0]).toMatchObject({ number: 0 })
    // 读即消费：再取为空
    expect(runtime.consumePendingTabstops(docOf('（）'))).toEqual([])
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

  it('onChanged 刷新节流（C-R4-2）：节流窗内连续触发不叠加通道请求', () => {
    const { requestedTopics, onChangedCallbacks } = registerAll('zh-CN')
    onChangedCallbacks.forEach((cb) => cb()) // 窗口起点（各 gate 首次触发刷一次）
    const afterFirst = requestedTopics.filter((t) => t === SETTINGS_TOPIC.get).length
    // 同一 3s 窗口内模拟连续键入：onChanged 反复触发，通道请求不随之增长
    for (let i = 0; i < 5; i++) onChangedCallbacks.forEach((cb) => cb())
    expect(requestedTopics.filter((t) => t === SETTINGS_TOPIC.get).length).toBe(afterFirst)
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

// ===== 工单 #9：Delete / SelectKey 族注册 =====

describe('#9 功能族契约：分族覆盖与链序', () => {
  it('两族恰好覆盖全部 Delete/SelectKey 类内置规则（6 + 4 条），无遗漏无重复', () => {
    const expected = DEFAULT_BUILTIN_RULES
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => {
        const type = RuleEngine.parseOptions(r.options).type
        return type === RuleType.Delete || type === RuleType.SelectKey
      })
      .sort((a, b) => (a.r.priority ?? 100) - (b.r.priority ?? 100) || a.index - b.index)
      .map(({ r }) => r.id)
    const familyRuleIds = DELETE_SELECTKEY_RULE_FAMILIES.flatMap((f) => f.ruleIds)
    expect(new Set(familyRuleIds).size).toBe(familyRuleIds.length)
    expect([...familyRuleIds].sort()).toEqual([...expected].sort())
    expect(familyRuleIds.length).toBe(10)
    expect(DELETE_SELECTKEY_RULE_FAMILIES.map((f) => f.localId)).toEqual(['06-delete-rules', '07-selectkey-rules'])
    // 与 #25 五族零重叠：全量 20 条恰好分进七个族
    const all = [...INPUT_RULE_FAMILIES, ...DELETE_SELECTKEY_RULE_FAMILIES].flatMap((f) => f.ruleIds)
    expect(new Set(all).size).toBe(DEFAULT_BUILTIN_RULES.length)
  })

  it('族内规则类型一致（Delete 族全 Delete、SelectKey 族全 SelectKey）', () => {
    for (const family of DELETE_SELECTKEY_RULE_FAMILIES) {
      const engine = buildFamilyEngine(family, undefined)
      expect(engine.getRules().map((r) => r.id)).toEqual(family.ruleIds)
      const kinds = new Set(engine.getRules().map((r) => r.type))
      expect(kinds.size).toBe(1)
    }
    expect(buildFamilyEngine(DELETE_SELECTKEY_RULE_FAMILIES[0]!, undefined).getRules().every((r) => r.type === RuleType.Delete)).toBe(true)
    expect(buildFamilyEngine(DELETE_SELECTKEY_RULE_FAMILIES[1]!, undefined).getRules().every((r) => r.type === RuleType.SelectKey)).toBe(true)
  })
})

describe('#9 注册形状与 onInput 全链', () => {
  function registerTriggerAll(language: string): {
    registrations: RuleBehaviorRegistrationSubset[]
    runtime: ReturnType<typeof registerRuleDeleteSelectKeyBehaviors>
  } {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    const runtime = registerRuleDeleteSelectKeyBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: `ONEGAYI.vsidian-easy-typing#${reg.id}` }
        },
        onChanged: () => () => {},
      },
      channel: neverResolvingChannel(),
      language,
    })
    return { registrations, runtime }
  }

  it('两族各注册一条：名称走字典、history 一律 atomic、与 #25 五族共用独占组', () => {
    const { registrations } = registerTriggerAll('zh-CN')
    expect(registrations.map((r) => r.id)).toEqual(['06-delete-rules', '07-selectkey-rules'])
    const m = pickMessages('zh-CN')
    for (const reg of registrations) {
      expect(reg.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      expect(reg.name.length).toBeGreaterThan(0)
      expect(reg.description).toBeDefined()
      expect((reg.examples ?? []).length).toBeGreaterThan(0)
      expect(reg.history).toBe('atomic')
      expect(reg.exclusiveGroup).toBe(INPUT_RULE_EXCLUSIVE_GROUP)
    }
    expect(registrations.some((r) => r.name === m.ruleFamilies.deletePair.name)).toBe(true)
    expect(registrations.some((r) => r.name === m.ruleFamilies.selectKeyWrap.name)).toBe(true)
  })

  it('Delete 族 onInput：【|】 退格产出联动删除计划；input 事件返回 null', () => {
    const { registrations } = registerTriggerAll('zh-CN')
    const del = registrations.find((r) => r.id === '06-delete-rules')!
    const plan = del.onInput({
      userEvent: 'delete.backward',
      inputText: '',
      replaced: { from: 0, to: 1, text: '【' },
      docUri: 'file:///a.md',
      snapshot: { text: '】', selections: [{ anchor: 0, head: 0 }], version: 1, revision: 1 },
    })
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
    expect(
      del.onInput({
        userEvent: 'input.type',
        inputText: '（',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: { text: '（', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
      }),
    ).toBeNull()
  })

  it('SelectKey 族 onInput：选中 hello 键 · 产出包裹计划；delete 事件返回 null', () => {
    const { registrations } = registerTriggerAll('zh-CN')
    const sel = registrations.find((r) => r.id === '07-selectkey-rules')!
    const plan = sel.onInput({
      userEvent: 'input.type',
      inputText: '·',
      replaced: { from: 0, to: 5, text: 'hello' },
      docUri: 'file:///a.md',
      snapshot: { text: '·', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '`hello`' }],
      selection: { anchor: 1, head: 1 },
    })
    expect(
      sel.onInput({
        userEvent: 'delete.backward',
        inputText: '',
        replaced: { from: 0, to: 1, text: '$' },
        docUri: 'file:///a.md',
        snapshot: { text: '$', selections: [{ anchor: 0, head: 0 }], version: 1, revision: 1 },
      }),
    ).toBeNull()
  })

  it('tabstop 暂存通道：SelectKey 包裹计划后可取 $0 组（覆盖选中文本），读即消费', () => {
    const { registrations, runtime } = registerTriggerAll('zh-CN')
    expect(runtime.consumePendingTabstops(docOf('`hello`'))).toEqual([])
    const sel = registrations.find((r) => r.id === '07-selectkey-rules')!
    sel.onInput({
      userEvent: 'input.type',
      inputText: '·',
      replaced: { from: 0, to: 5, text: 'hello' },
      docUri: 'file:///a.md',
      snapshot: { text: '·', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    const pending = runtime.consumePendingTabstops(docOf('`hello`'))
    expect(pending).toEqual([{ number: 0, from: 1, to: 6 }])
    expect(runtime.consumePendingTabstops(docOf('`hello`'))).toEqual([])
  })

  it('英文语言标签取英文字典名称', () => {
    const { registrations } = registerTriggerAll('en-US')
    const m = pickMessages('en-US')
    expect(registrations.some((r) => r.name === m.ruleFamilies.deletePair.name)).toBe(true)
    expect(registrations.some((r) => r.name === m.ruleFamilies.selectKeyWrap.name)).toBe(true)
  })
})

describe('#9 端到端链仲裁（按平台 addonBehaviors runtime 语义模拟）', () => {
  /** 注册面：收集两套注册（#25 五族 + #9 两族），按完整键字典序排有效序 */
  function registerChain(): RuleBehaviorRegistrationSubset[] {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    const behaviors = {
      register: (reg: RuleBehaviorRegistrationSubset) => {
        registrations.push(reg)
        return { ok: true as const, key: `ONEGAYI.vsidian-easy-typing#${reg.id}` }
      },
      onChanged: () => () => {},
    }
    registerRuleInputBehaviors({ behaviors, channel: neverResolvingChannel(), language: 'zh-CN' })
    registerRuleDeleteSelectKeyBehaviors({ behaviors, channel: neverResolvingChannel(), language: 'zh-CN' })
    // 平台默认有效序 = 完整键字典序；同组件前缀下等价 localId 字典序
    return [...registrations].sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 平台链语义复刻（addonBehaviors.ts driveInput 核心）：按序各试、
   * 首个返回计划者占用独占组、其后同组跳过、null 不占用 */
  function driveChain(
    registrations: RuleBehaviorRegistrationSubset[],
    ctx: Parameters<RuleBehaviorRegistrationSubset['onInput']>[0],
  ): { plan: AddonBehaviorInputPlan | null; firedId: string | null; called: string[] } {
    const handledGroups = new Set<string>()
    const called: string[] = []
    for (const reg of registrations) {
      if (reg.exclusiveGroup !== undefined && handledGroups.has(reg.exclusiveGroup)) {
        called.push(`${reg.id}:skipped-group`)
        continue
      }
      const plan = reg.onInput(ctx)
      called.push(`${reg.id}:${plan === null ? 'null' : 'plan'}`)
      if (plan !== null && reg.exclusiveGroup !== undefined) {
        handledGroups.add(reg.exclusiveGroup)
        return { plan, firedId: reg.id, called }
      }
    }
    return { plan: null, firedId: null, called }
  }

  it('选中 hello 键 （：Input 五族对选区替换形态让位（replaced 门），SelectKey 族命中包裹', () => {
    const chain = registerChain()
    const { plan, firedId, called } = driveChain(chain, {
      userEvent: 'input.type',
      inputText: '（',
      replaced: { from: 0, to: 5, text: 'hello' },
      docUri: 'file:///a.md',
      snapshot: { text: '（', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    // 01-05 全部 null（replaced 门）——若 autopair 放行会占用组并丢被替换内容
    expect(firedId).toBe('07-selectkey-rules')
    expect(plan?.changes[0]?.text).toBe('（hello）')
    expect(called.filter((c) => c.endsWith(':null')).length).toBe(6) // 01-05 + 06-delete
    expect(called).toContain('02-autopair:null')
  })

  it('【|】 退格：Delete 族命中联动删除，其余族不响应', () => {
    const chain = registerChain()
    const { plan, firedId } = driveChain(chain, {
      userEvent: 'delete.backward',
      inputText: '',
      replaced: { from: 0, to: 1, text: '【' },
      docUri: 'file:///a.md',
      snapshot: { text: '】', selections: [{ anchor: 0, head: 0 }], version: 1, revision: 1 },
    })
    expect(firedId).toBe('06-delete-rules')
    expect(plan?.changes).toEqual([{ offset: 0, length: 1, text: '' }])
  })

  it('纯插入（（：Input 族 autopair 照常命中，Delete/SelectKey 族不占用组', () => {
    const chain = registerChain()
    const { plan, firedId } = driveChain(chain, {
      userEvent: 'input.type',
      inputText: '（',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: '（', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(firedId).toBe('02-autopair')
    expect(plan?.changes[0]?.text).toBe('（）')
  })

  it('非触发输入（x 纯插入）：全链零命中，链照常落原生', () => {
    const chain = registerChain()
    const { plan, called } = driveChain(chain, {
      userEvent: 'input.type',
      inputText: 'x',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: 'x', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(plan).toBeNull()
    expect(called.every((c) => c.endsWith(':null'))).toBe(true)
    expect(called.length).toBe(7)
  })
})

// ===== 工单 #27：「用户规则尊重保护区」开关（默认关） =====
//
// 语义锚点：上游 rule_processor.ts:22-29——UserDefinedRegSwitch &&
// UserRulesRespectUserDefinedRegexBlocks 双开时，光标检查列（input 类回退
// 一列）在用户自定义正则保护区内 → 规则不触发。上游仅 Input 类有此检查；
// Delete/SelectKey 为本票对称扩展（见 docs/specs/protected-zones.md）。

describe('#27 用户规则尊重保护区：gate 探针构造', () => {
  function gateWith(effective: Record<string, unknown>) {
    let response: { ok: true; result: unknown } | { ok: false; reason: string } = {
      ok: true as const,
      result: { effective },
    }
    const gate = createRulePipelineGate({ request: () => Promise.resolve(response) })
    return {
      gate,
      failNext: () => {
        response = { ok: false, reason: 'released' }
      },
    }
  }

  it('默认（respect 出厂 false）→ undefined；通道失败保持上次值', async () => {
    const { gate, failNext } = gateWith({})
    expect(gate.userRulesZone()).toBeUndefined()
    await gate.refresh()
    expect(gate.userRulesZone()).toBeUndefined()
    failNext()
    await gate.refresh() // 失败保持
    expect(gate.userRulesZone()).toBeUndefined()
  })

  it('双开 → 探针有值且判定正确（{{}} 模板）', async () => {
    const { gate } = gateWith({
      userDefinedRegExp: '{{.*?}}|++',
      userRulesRespectUserDefinedRegexBlocks: true,
    })
    await gate.refresh()
    const zone = gate.userRulesZone()
    expect(zone).toBeDefined()
    expect(zone!.isProtected('{{。。}}', 3)).toBe(true)
    expect(zone!.isProtected('x。。', 2)).toBe(false)
  })

  it('respect 开但 userDefinedRegSwitch 关 → undefined（上游双开条件）', async () => {
    const { gate } = gateWith({
      userDefinedRegSwitch: false,
      userRulesRespectUserDefinedRegexBlocks: true,
    })
    await gate.refresh()
    expect(gate.userRulesZone()).toBeUndefined()
  })

  it('值类型失配回出厂默认（switch 失配回 true、respect 失配回 false）', async () => {
    const { gate } = gateWith({ userDefinedRegSwitch: 'on', userDefinedRegExp: 42 })
    await gate.refresh()
    expect(gate.userRulesZone()).toBeUndefined() // respect 缺省 false
  })
})

describe('#27 用户规则尊重保护区：族级端到端', () => {
  function registerInputsWith(effective: Record<string, unknown>) {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    registerRuleInputBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: `k#${reg.id}` }
        },
        onChanged: () => () => {},
      },
      channel: {
        request: () => Promise.resolve({ ok: true as const, result: { effective } }),
      },
      language: 'zh-CN',
    })
    return registrations
  }

  /** `{{。。}}` 内键入第二个 。（head=4，inputText=。；检查列 3 ∈ [2,4)） */
  const punctInZone = {
    userEvent: 'input.type',
    inputText: '。',
    replaced: null,
    docUri: 'file:///a.md',
    snapshot: { text: '{{。。}}', selections: [{ anchor: 4, head: 4 }], version: 1, revision: 1 },
  }

  it('双开：保护区内标点折叠不触发（01-punct-collapse null）', async () => {
    const registrations = registerInputsWith({
      userDefinedRegExp: '{{.*?}}|++',
      userRulesRespectUserDefinedRegexBlocks: true,
    })
    await Promise.resolve()
    const punct = registrations.find((r) => r.id === '01-punct-collapse')!
    expect(punct.onInput(punctInZone)).toBeNull()
  })

  it('respect 关（出厂）：同场景规则照常触发', async () => {
    const registrations = registerInputsWith({
      userDefinedRegExp: '{{.*?}}|++',
    })
    await Promise.resolve()
    const punct = registrations.find((r) => r.id === '01-punct-collapse')!
    expect(punct.onInput(punctInZone)?.changes[0]?.text).toBe('.')
  })

  it('双开但键入在保护区外：规则照常触发（x。。 → 。.）', async () => {
    const registrations = registerInputsWith({
      userDefinedRegExp: '{{.*?}}|++',
      userRulesRespectUserDefinedRegexBlocks: true,
    })
    await Promise.resolve()
    const punct = registrations.find((r) => r.id === '01-punct-collapse')!
    const plan = punct.onInput({
      userEvent: 'input.type',
      inputText: '。',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: 'x。。', selections: [{ anchor: 3, head: 3 }], version: 1, revision: 1 },
    })
    expect(plan?.changes[0]?.text).toBe('.')
  })

  /** Delete 族注册（#9 两族），effective 可注入 */
  function registerDeleteWith(effective: Record<string, unknown>) {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    registerRuleDeleteSelectKeyBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: `k#${reg.id}` }
        },
        onChanged: () => () => {},
      },
      channel: {
        request: () => Promise.resolve({ ok: true as const, result: { effective } }),
      },
      language: 'zh-CN',
    })
    return registrations
  }

  /** 事务前 {{【】}}、光标 3 退格删 【（autopair-delete 本应命中联动删除） */
  const deleteInZone = {
    userEvent: 'delete.backward',
    inputText: '',
    replaced: { from: 2, to: 3, text: '【' },
    docUri: 'file:///a.md',
    snapshot: { text: '{{】}}', selections: [{ anchor: 2, head: 2 }], version: 1, revision: 1 },
  }

  it('双开：Delete 族联动删除在保护区内不触发（规则本有命中的场景）', async () => {
    const registrations = registerDeleteWith({
      userDefinedRegExp: '【.*?】|++',
      userRulesRespectUserDefinedRegexBlocks: true,
    })
    await Promise.resolve()
    const del = registrations.find((r) => r.id === '06-delete-rules')!
    // 事务前 {{【】}}、虚拟光标列 3 ∈ 保护区 [2,5) → 拦截
    expect(del.onInput(deleteInZone)).toBeNull()
  })

  it('respect 关：同场景联动删除照常（对照组，证明上例是保护区拦截）', async () => {
    const registrations = registerDeleteWith({
      userDefinedRegExp: '【.*?】|++',
    })
    await Promise.resolve()
    const del = registrations.find((r) => r.id === '06-delete-rules')!
    const plan = del.onInput(deleteInZone)
    // 联动删除【】：引擎命中事务前 [2,4)，换算快照 to=4-1=3 → 删快照 '】'
    expect(plan?.changes).toEqual([{ offset: 2, length: 1, text: '' }])
  })
})

// ===== 行为族引擎接入规则存储态（审查 B-F1 / C-P1-2 修复） =====

/** 归族用种子重建（INPUT_RULE_FAMILIES 是默认实例，种子不在导出面） */
function inputSeedsForFamily() {
  return INPUT_RULE_FAMILIES.map((f) => ({
    localId: f.localId,
    i18nKey: f.i18nKey,
    ruleIds: f.ruleIds,
    userRuleType: RuleType.Input,
  }))
}

describe('用户规则归族：resolveRuleFamilies 三参数形态', () => {
  const userInput = { id: 'user-a', trigger: 'zz', replacement: 'ZZ', priority: 1 }
  const userDelete = { id: 'user-d', trigger: '【', trigger_right: '】', replacement: '', options: 'd' }
  const userSelect = { id: 'user-s', trigger: 'x', replacement: 'X', options: 's' }

  it('Input 类用户规则并入全部五个 Input 族；Delete/SelectKey 类不混入', () => {
    const families = resolveRuleFamilies(inputSeedsForFamily(), DEFAULT_BUILTIN_RULES, [
      userInput,
      userDelete,
      userSelect,
    ])
    expect(families).toHaveLength(5)
    for (const family of families) {
      expect(family.rules.some((r) => r.id === 'user-a')).toBe(true)
      expect(family.rules.some((r) => r.id === 'user-d')).toBe(false)
      expect(family.rules.some((r) => r.id === 'user-s')).toBe(false)
    }
  })

  it('Delete 类入 06、SelectKey 类入 07（按触发类归对应族）', () => {
    const families = resolveRuleFamilies(
      DELETE_SELECTKEY_RULE_FAMILIES.map((f) => ({
        localId: f.localId,
        i18nKey: f.i18nKey,
        ruleIds: f.ruleIds,
        userRuleType: RuleType.Delete,
      })),
      DEFAULT_BUILTIN_RULES,
      [userInput, userDelete, userSelect],
    )
    expect(families[0]!.rules.some((r) => r.id === 'user-d')).toBe(true)
    expect(families[0]!.rules.some((r) => r.id === 'user-a')).toBe(false)
    const selectFamilies = resolveRuleFamilies(
      DELETE_SELECTKEY_RULE_FAMILIES.map((f) => ({
        localId: f.localId,
        i18nKey: f.i18nKey,
        ruleIds: f.ruleIds,
        userRuleType: RuleType.SelectKey,
      })),
      DEFAULT_BUILTIN_RULES,
      [userInput, userDelete, userSelect],
    )
    expect(selectFamilies[1]!.rules.some((r) => r.id === 'user-s')).toBe(true)
    expect(selectFamilies[0]!.rules.some((r) => r.id === 'user-d')).toBe(false)
  })

  it('enabled=false 用户规则保留在装载集（引擎 process 门控跳过，非装载侧过滤）', () => {
    const families = resolveRuleFamilies(inputSeedsForFamily(), [], [{ ...userInput, enabled: false }])
    const engine = buildFamilyEngine(families[0]!)
    expect(engine.getRules().some((r) => r.id === 'user-a' && !r.enabled)).toBe(true)
    expect(
      engine.process({
        kind: RuleType.Input,
        docText: 'zz',
        selection: { from: 2, to: 2 },
        inserted: '',
        changeType: 'input.type',
        scopeHint: RuleScope.All,
      }),
    ).toBeNull()
  })
})

describe('RuleSnapshotSource：装载前出厂数据、update 后快照可见', () => {
  it('初始 snapshot 为 undefined；update 喂快照并同步触发 onUpdate', () => {
    const source = createRuleSnapshotSource()
    expect(source.snapshot()).toBeUndefined()
    const seen: number[] = []
    source.onUpdate(() => seen.push(1))
    source.update({ builtin: [], user: [{ id: 'user-zz', trigger: 'zz', replacement: 'EXT', priority: 1 }] })
    expect(source.snapshot()).toEqual({
      builtin: [],
      user: [{ id: 'user-zz', trigger: 'zz', replacement: 'EXT', priority: 1 }],
    })
    expect(seen).toHaveLength(1)
  })
})

// ---- 端到端数据链 mock（精简自 rules-page.test.ts 同型设施） ----

function e2eStorage(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const listeners = new Set<(path: string, kind: 'change' | 'delete') => void>()
  let clock = 1_000_000
  const storage: AddonStorageFacet = {
    uri: () => 'file:///globalStorage/vsidian/addons/ONEGAYI.vsidian-easy-typing/',
    readFile: async (path) => {
      const value = files.get(path)
      return value === undefined
        ? { ok: false as const, reason: 'error' as const, detail: 'not-found' }
        : { ok: true as const, value }
    },
    writeFile: async (path, content) => {
      files.set(path, content)
      return { ok: true as const, value: null }
    },
    list: async () => ({
      ok: true as const,
      entries: [...files.keys()].map((path) => ({ path, kind: 'file' as const })),
    }),
    deleteFile: async (path) => {
      files.delete(path)
      return { ok: true as const, value: null }
    },
    onDidChangeFile: (cb): AddonStorageWatchHandle => {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    },
  }
  return {
    files,
    storage,
    tick: (d = 1) => (clock += d),
    now: () => clock,
    emit: (path: string) => {
      for (const l of listeners) l(path, 'change')
    },
  }
}

function e2eRegistry() {
  const handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  const registry: AddonChannelRegistry = {
    handle: (topic, handler) => {
      handlers.set(topic, handler)
      return { dispose: () => handlers.delete(topic) }
    },
  }
  const request = async (topic: string, payload: unknown) => {
    const handler = handlers.get(topic)
    if (!handler) return { ok: false as const, reason: 'rejected' as const }
    try {
      return { ok: true as const, result: await handler(payload) }
    } catch {
      return { ok: false as const, reason: 'rejected' as const }
    }
  }
  return { registry, request }
}

/** 组装「宿主存储 → 通道 → 页面客户端 → 行为族注册」全链（B-F1 修复的
 * 端到端形态）：规则源接 client.onReload，行为族引擎随装载/重载重建 */
function assembleBehaviorChain(initial: Record<string, string> = {}) {
  const mock = e2eStorage(initial)
  const service = new HostRulesService(mock.storage, {
    now: mock.now,
    setTimeout: (fn) => {
      void fn()
      return 0
    },
    clearTimeout: () => {},
  })
  const { registry, request } = e2eRegistry()
  registerRulesChannels(registry, service)
  const source = createRuleSnapshotSource()
  const client = new PageRulesClient({
    channel: { request },
    engine: new RuleEngine(),
    onReload: (snapshot) => source.update(snapshot),
  })
  const registrations: RuleBehaviorRegistrationSubset[] = []
  const behaviors = {
    register: (reg: AddonBehaviorRegistration) => {
      registrations.push(reg)
      return { ok: true as const, key: 'ONEGAYI.vsidian-easy-typing#' + reg.id }
    },
    onChanged: () => () => {},
  }
  registerRuleInputBehaviors({ behaviors, channel: { request }, language: 'zh-CN', rulesSource: source })
  registerRuleDeleteSelectKeyBehaviors({ behaviors, channel: { request }, language: 'zh-CN', rulesSource: source })
  /** 模拟平台行为链驱动（有效序 = 注册序；返回首个计划——各族触发面
   * 互斥使独占组仲裁退化为首个返回计划者，与平台 runtime 语义同型） */
  const driveChain = (ctx: Parameters<RuleBehaviorRegistrationSubset['onInput']>[0]) => {
    for (const reg of registrations) {
      const plan = reg.onInput(ctx)
      if (plan !== null) return plan
    }
    return null
  }
  return { mock, service, client, request, source, registrations, driveChain }
}

const inputSnapshot = (text: string, cursor: number) => ({
  text,
  selections: [{ anchor: cursor, head: cursor }],
  version: 1,
  revision: 1,
})

describe('端到端：存储态 → 行为族引擎（B-F1 / C-P1-2 修复）', () => {
  it('链路一：UI 增规则 → 轮询重载 → 行为族命中新规则（优先级竞争真实生效）', async () => {
    const chain = assembleBehaviorChain()
    await chain.client.load()
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: 'z',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('zz', 2),
      }),
    ).toBeNull()

    const add = await chain.request(RULES_TOPIC.mutate, {
      op: 'addUserRule',
      rule: { trigger: 'zz', replacement: 'EXT', priority: 1 },
    })
    expect(add).toMatchObject({ ok: true, result: { ok: true } })
    await chain.client.poll()
    // 用户规则 priority 1：在 01 族内先于内置 fw2hw(3) 试配 → 链首族即命中
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: 'z',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('zz', 2),
      }),
    ).toEqual({ changes: [{ offset: 0, length: 2, text: 'EXT' }], selection: { anchor: 3, head: 3 } })
  })

  it('链路二：停用内置规则（toggleRuleEnabled）→ 轮询重载 → 不再触发', async () => {
    const chain = assembleBehaviorChain()
    await chain.client.load()
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: '。',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('。。', 2),
      }),
    ).toEqual({ changes: [{ offset: 0, length: 2, text: '.' }], selection: { anchor: 1, head: 1 } })

    const toggle = await chain.request(RULES_TOPIC.mutate, {
      op: 'toggleRuleEnabled',
      id: 'builtin-fw2hw-double',
      isBuiltin: true,
      enabled: false,
    })
    expect(toggle).toMatchObject({ ok: true, result: { ok: true } })
    await chain.client.poll()
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: '。',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('。。', 2),
      }),
    ).toBeNull()
  })

  it('链路三：外部改写 user-rules.json → watcher → 轮询 → 新规则生效', async () => {
    const chain = assembleBehaviorChain()
    await chain.client.load()
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: 'z',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('zz', 2),
      }),
    ).toBeNull()

    chain.mock.tick(2000) // 跳出自写抑制窗口
    chain.mock.files.set(
      USER_RULES_FILE,
      JSON.stringify([{ id: 'user-ext', trigger: 'zz', replacement: 'EXT', priority: 1 }], null, 2),
    )
    chain.mock.emit(USER_RULES_FILE)
    await vi.waitFor(() => expect(chain.service.revision).toBe(1))
    await chain.client.poll()
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: 'z',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('zz', 2),
      }),
    ).toEqual({ changes: [{ offset: 0, length: 2, text: 'EXT' }], selection: { anchor: 3, head: 3 } })
  })

  it('内置删除（deleteBuiltinRule）→ 轮询 → 族引擎不再装载该条', async () => {
    const chain = assembleBehaviorChain()
    await chain.client.load()
    const del = await chain.request(RULES_TOPIC.mutate, { op: 'deleteBuiltinRule', id: 'builtin-fw2hw-double' })
    expect(del).toMatchObject({ ok: true, result: { ok: true } })
    await chain.client.poll()
    expect(
      chain.driveChain({
        userEvent: 'input.type',
        inputText: '。',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('。。', 2),
      }),
    ).toBeNull()
  })

  it('Delete 用户规则同链生效（归入 06 族，联动删除配对端）', async () => {
    const chain = assembleBehaviorChain()
    await chain.client.load()
    await chain.request(RULES_TOPIC.mutate, {
      op: 'addUserRule',
      rule: { trigger: '@', trigger_right: '@', replacement: '', options: 'd' },
    })
    await chain.client.poll()
    expect(
      chain.driveChain({
        userEvent: 'delete.backward',
        inputText: '',
        replaced: { from: 0, to: 1, text: '@' },
        docUri: 'file:///a.md',
        snapshot: { text: '@', selections: [{ anchor: 0, head: 0 }], version: 1, revision: 1 },
      }),
    ).toEqual({ changes: [{ offset: 0, length: 1, text: '' }], selection: { anchor: 0, head: 0 } })
  })

  it('装载失败回落出厂数据：source 从未 update 时行为族仍可用出厂内置规则', () => {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    registerRuleInputBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: reg.id }
        },
        onChanged: () => () => {},
      },
      channel: { request: async () => ({ ok: false as const, reason: 'timeout' as const }) },
      language: 'zh-CN',
      rulesSource: createRuleSnapshotSource(),
    })
    const punct = registrations.find((r) => r.id === '01-punct-collapse')!
    expect(
      punct.onInput({
        userEvent: 'input.type',
        inputText: '。',
        replaced: null,
        docUri: 'file:///a.md',
        snapshot: inputSnapshot('。。', 2),
      }),
    ).toEqual({ changes: [{ offset: 0, length: 2, text: '.' }], selection: { anchor: 1, head: 1 } })
  })
})

// ===== tabstop 暂存消费一致性校验（审查 B-F2 修复） =====

describe('tabstop 消费一致性校验（B-F2）', () => {
  function registerInputForAutopair() {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    const runtime = registerRuleInputBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: reg.id }
        },
        onChanged: () => () => {},
      },
      channel: { request: async () => ({ ok: false as const, reason: 'timeout' as const }) },
      language: 'zh-CN',
    })
    return { registrations, runtime }
  }

  it('#25：applyEdit 回环窗口内用户键入先到（文档未呈现计划形态）→ 丢弃不激活', () => {
    const { registrations, runtime } = registerInputForAutopair()
    const autopair = registrations.find((r) => r.id === '02-autopair')!
    autopair.onInput({
      userEvent: 'input.type',
      inputText: '（',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: inputSnapshot('（', 1),
    })
    // 用户键入 x 的事务先到：文档 '（x'（计划未应用，applyEdit 将被
    // stale-snapshot 拒绝）→ 坐标处不是替换体 → 丢弃
    expect(runtime.consumePendingTabstops(docOf('（x'))).toEqual([])
    // 丢弃后槽已清空（正确形态到来也不再激活本次）
    expect(runtime.consumePendingTabstops(docOf('（）'))).toEqual([])
  })

  it('#25：计划应用后（文档呈现替换形态）→ 正常激活', () => {
    const { registrations, runtime } = registerInputForAutopair()
    const autopair = registrations.find((r) => r.id === '02-autopair')!
    autopair.onInput({
      userEvent: 'input.type',
      inputText: '（',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: inputSnapshot('（', 1),
    })
    expect(runtime.consumePendingTabstops(docOf('（）'))).toEqual([{ number: 0, from: 1, to: 1 }])
  })

  it('#9 SelectKey：包裹计划失配文档 → 丢弃', () => {
    const registrations: RuleBehaviorRegistrationSubset[] = []
    const runtime = registerRuleDeleteSelectKeyBehaviors({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: reg.id }
        },
        onChanged: () => () => {},
      },
      channel: { request: async () => ({ ok: false as const, reason: 'timeout' as const }) },
      language: 'zh-CN',
    })
    const sel = registrations.find((r) => r.id === '07-selectkey-rules')!
    sel.onInput({
      userEvent: 'input.type',
      inputText: '·',
      replaced: { from: 0, to: 5, text: 'hello' },
      docUri: 'file:///a.md',
      snapshot: { text: '·', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    // 窗口内用户键入把 · 后追加 z（未应用包裹）→ 失配丢弃
    expect(runtime.consumePendingTabstops(docOf('·z'))).toEqual([])
    expect(runtime.consumePendingTabstops(docOf('`hello`'))).toEqual([])
  })
})
