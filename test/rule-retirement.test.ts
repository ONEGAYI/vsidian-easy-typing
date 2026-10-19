// 内置规则清退契约（#56）：出厂清单退役 + 旧安装磁盘副本回收 + 用户域零
// 影响。退役判定与对照表落档见 docs/specs/rule-engine.md「内置规则清退
// （#56）」节；语义边界：
// - 退役 id 不再出现在 DEFAULT_BUILTIN_RULES 与新装磁盘；sel-wrap-quotes
//   收窄触发至闭引号 ”’（开引号让位平台选区包裹兜底）；
// - 旧安装 builtin-rules.json 中的**未改写**退役副本在装载时被回收——
//   enabled 差异不算改写（开关不是内容）；内容已改写的副本保留（不静
//   默丢失用户修改，作为仍可用的规则继续装载与编辑）；
// - 恢复条目对退役 id 返回 false；恢复出厂不含退役 id；外部重载同口径
//   （退役副本经外部同步写回不再复活）；
// - 用户规则域完全不受退役影响：与退役内置项同 id、同触发式、同效果的
//   用户规则照常装载与执行（票面红线）。
import { describe, expect, it } from 'vitest'
import { RuleEngine, RuleType, RuleScope } from '../src/rules/rule-engine'
import {
  DEFAULT_BUILTIN_RULES,
  RETIRED_BUILTIN_RULES,
  RETIRED_BUILTIN_RULE_IDS,
  stripRetiredBuiltins,
} from '../src/rules/default-rules'
import { RuleStore, type RuleStoreIo } from '../src/rules/rule-store'
import {
  registerRuleInputBehaviors,
  registerRuleDeleteSelectKeyBehaviors,
} from '../src/ruleBehaviorIntercept'
import type { AddonBehaviorRegistration } from '../types/vendor/shared/addonBehaviors'
import type { SimpleRule } from '../src/rules/rule-engine'

/** 内存 IO mock（对齐 rule-store.test.ts 形态：files 暴露给断言） */
function memoryIo(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const io: RuleStoreIo = {
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, content) => {
      files.set(path, content)
      return true
    },
    list: async () => [...files.keys()],
  }
  return { files, io }
}

const retiredById = new Map(RETIRED_BUILTIN_RULES.map((r) => [r.id, r]))

describe('出厂清单退役（#56）', () => {
  it('退役 id 不在 DEFAULT_BUILTIN_RULES，快照与出厂清单同源同构', () => {
    const defaultIds = new Set(DEFAULT_BUILTIN_RULES.map((r) => r.id))
    for (const id of RETIRED_BUILTIN_RULE_IDS) {
      expect(defaultIds.has(id), `${id} 应已从出厂清单退役`).toBe(false)
      expect(retiredById.get(id), `${id} 的退役快照应在场`).toBeDefined()
    }
  })

  it('sel-wrap-quotes 收窄触发至闭引号 ”’（开引号让位平台兜底）', () => {
    const quotes = DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-sel-wrap-quotes')
    expect(quotes?.trigger).toBe('”’')
  })
})

describe('stripRetiredBuiltins（退役回收纯函数）', () => {
  it('未改写副本（含键序打乱与 enabled 差异）→ 回收；removed 置位', () => {
    const cjk = retiredById.get('builtin-sel-wrap-cjk-brackets')!
    const autopair = retiredById.get('builtin-autopair-input')!
    // 键序打乱 + enabled 翻转：JSON 化后重排键序模拟外部工具回写形态
    const shuffled = JSON.parse(
      JSON.stringify({ enabled: false, ...cjk }, (_k, v) => v),
    ) as SimpleRule
    const keeper = DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-fw2hw-double')!
    const { rules, removed } = stripRetiredBuiltins([shuffled, autopair, keeper])
    expect(removed).toBe(true)
    expect(rules.map((r) => r.id)).toEqual(['builtin-fw2hw-double'])
  })

  it('内容已改写（trigger / replacement 变化）→ 保留', () => {
    const cjk = retiredById.get('builtin-sel-wrap-cjk-brackets')!
    const modifiedTrigger: SimpleRule = { ...cjk, trigger: '《（「' }
    const autopair = retiredById.get('builtin-autopair-input')!
    const modifiedReplacement: SimpleRule = {
      ...autopair,
      replacement: { kind: 'function', ref: 'selWrapQuotes' },
    }
    const { rules, removed } = stripRetiredBuiltins([modifiedTrigger, modifiedReplacement])
    expect(removed).toBe(false)
    expect(rules).toHaveLength(2)
  })
})

describe('RuleStore 装载回收（#56：新装 / 旧安装 / 重载一致口径）', () => {
  it('新装：磁盘种子不含退役 id', async () => {
    const { files, io } = memoryIo()
    const store = new RuleStore(io)
    await store.init()
    const ids = store.getSnapshot().builtin.map((r) => r.id)
    for (const id of RETIRED_BUILTIN_RULE_IDS) {
      expect(ids, `新装不应含退役 id ${id}`).not.toContain(id)
    }
    expect(JSON.parse(files.get('builtin-rules.json')!).map((r: { id: string }) => r.id)).not.toContain(
      'builtin-sel-wrap-cjk-brackets',
    )
  })

  it('旧安装：未改写退役副本被回收（磁盘重写不含退役 id），其余规则与顺序保留', async () => {
    const legacy = [
      retiredById.get('builtin-sel-wrap-cjk-brackets')!,
      DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-sel-wrap-symbols')!,
      retiredById.get('builtin-autopair-input')!,
      DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-autopair-jump')!,
    ]
    const { files, io } = memoryIo({
      'builtin-rules.json': JSON.stringify(legacy),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    // 存活顺序保留在前，缺失出厂项按 init 补种在后；全集 = 现役 18 条
    const ids = store.getSnapshot().builtin.map((r) => r.id)
    expect(ids.slice(0, 2)).toEqual(['builtin-sel-wrap-symbols', 'builtin-autopair-jump'])
    expect(new Set(ids).size).toBe(18)
    for (const id of RETIRED_BUILTIN_RULE_IDS) expect(ids).not.toContain(id)
    // 磁盘被重写为回收后形态（外部工具直读看到的即新面）
    const onDisk = JSON.parse(files.get('builtin-rules.json')!) as { id: string }[]
    expect(onDisk.map((r) => r.id).slice(0, 2)).toEqual([
      'builtin-sel-wrap-symbols',
      'builtin-autopair-jump',
    ])
  })

  it('旧安装：内容已改写的退役副本保留且可执行（不静默丢失用户修改）', async () => {
    const modified = { ...retiredById.get('builtin-sel-wrap-cjk-brackets')!, trigger: '《（「' }
    const { io } = memoryIo({
      'builtin-rules.json': JSON.stringify([modified]),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const kept = store.getSnapshot().builtin.find((r) => r.id === 'builtin-sel-wrap-cjk-brackets')
    expect(kept?.trigger).toBe('《（「')
    const engine = new RuleEngine()
    engine.addSimpleRules(store.getSnapshot().builtin)
    const result = engine.process({
      kind: RuleType.SelectKey,
      docText: 'xabcz',
      selection: { from: 1, to: 4 },
      inserted: '（',
      changeType: 'input.type',
      scopeHint: RuleScope.All,
      key: '（',
    })
    expect(result?.newText).toBe('（abc）')
  })

  it('外部重载：退役副本经外部同步写回不再复活', async () => {
    const { files, io } = memoryIo()
    const store = new RuleStore(io)
    await store.init()
    files.set(
      'builtin-rules.json',
      JSON.stringify([
        retiredById.get('builtin-autopair-input')!,
        ...store.getSnapshot().builtin,
      ]),
    )
    await store.init() // watcher 重载同入口
    expect(
      store.getSnapshot().builtin.some((r) => r.id === 'builtin-autopair-input'),
    ).toBe(false)
  })

  it('恢复条目与恢复出厂均不复活退役 id', async () => {
    const { io } = memoryIo()
    const store = new RuleStore(io)
    await store.init()
    expect(await store.restoreBuiltinRule('builtin-sel-wrap-cjk-brackets')).toBe(false)
    expect(await store.resetAllBuiltinRules()).toBe(true)
    expect(
      store.getSnapshot().builtin.some((r) => RETIRED_BUILTIN_RULE_IDS.includes(r.id ?? '')),
    ).toBe(false)
  })
})

describe('用户域零影响（#56 票面红线）', () => {
  it('与退役内置项同 id、同触发式、同效果的用户规则照常装载与执行', async () => {
    // 同 id 同效果：用户域不受退役判定波及（stripRetiredBuiltins 只作用于
    // builtin 文件的装载路径，user 文件原样透传）
    const twin = {
      ...retiredById.get('builtin-sel-wrap-cjk-brackets')!,
      id: 'user-twin-1',
    }
    const sameId = retiredById.get('builtin-autopair-input')!
    const { io } = memoryIo({
      'user-rules.json': JSON.stringify([twin, sameId]),
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const user = store.getSnapshot().user
    expect(user.map((r) => r.id)).toEqual(['user-twin-1', 'builtin-autopair-input'])
    const engine = new RuleEngine()
    engine.addSimpleRules(user)
    const wrap = engine.process({
      kind: RuleType.SelectKey,
      docText: 'xabcz',
      selection: { from: 1, to: 4 },
      inserted: '《',
      changeType: 'input.type',
      scopeHint: RuleScope.All,
      key: '《',
    })
    expect(wrap?.newText).toBe('《abc》')
    const pair = engine.process({
      kind: RuleType.Input,
      docText: 'a（',
      selection: { from: 2, to: 2 },
      inserted: '（',
      changeType: 'input.type',
      scopeHint: RuleScope.All,
      key: '（',
    })
    expect(pair?.newText).toBe('（）') // newText 只含 matchRange 替换段（刚键入的 （）
  })
})

// ===== 行为注册 harness（真实链：RuleStore 快照 → 族解析 → 注册回调） =====

/** 行为注册面子集（对齐生产注册形态；rulesSource 喂 store 快照） */
function registerWithSource(source: { builtin: SimpleRule[]; user: SimpleRule[] }) {
  const registrations: AddonBehaviorRegistration[] = []
  const behaviors = {
    register: (reg: AddonBehaviorRegistration) => {
      registrations.push(reg)
      return { ok: true as const, key: `ONEGAYI.vsidian-easy-typing#${reg.id}` }
    },
    onChanged: () => () => {},
  }
  const channel = { request: async () => ({ ok: false as const, reason: 'test' }) }
  const rulesSource = {
    snapshot: () => source,
    onUpdate: () => {},
  }
  registerRuleInputBehaviors({ behaviors, channel, language: 'zh-CN', rulesSource })
  registerRuleDeleteSelectKeyBehaviors({ behaviors, channel, language: 'zh-CN', rulesSource })
  return registrations
}

/** 迁移写失败注入：仅 builtin-rules.json 写返回 false，其余照常 */
function memoryIoBuiltinWriteFails(initial: Record<string, string> = {}) {
  const base = memoryIo(initial)
  const io: RuleStoreIo = {
    readText: base.io.readText,
    writeText: async (path, content) =>
      path === 'builtin-rules.json' ? false : base.io.writeText(path, content),
    list: base.io.list,
  }
  return { files: base.files, io }
}

/** 旧安装 quotes 出厂定义（收窄前四字符形态，base 4a8f731 原样） */
const legacyQuotes: SimpleRule = {
  id: 'builtin-sel-wrap-quotes',
  trigger: `“”‘’`,
  replacement: { kind: 'function', ref: 'selWrapQuotes' },
  options: 'sF',
  priority: 40,
  description: '选中文字后输入全角引号，配对引号包裹',
}

describe('改写副本执行归属（#56：保留 ≠ 只存不执行）', () => {
  it('改写的 cjk-brackets 副本：真实注册链 07 族仍可产出包裹计划', async () => {
    const modified = { ...retiredById.get('builtin-sel-wrap-cjk-brackets')!, trigger: '《「' }
    const { io } = memoryIo({
      'builtin-rules.json': JSON.stringify([
        modified,
        DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-sel-wrap-symbols')!,
      ]),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const regs = registerWithSource({ builtin: store.getSnapshot().builtin, user: [] })
    const sel = regs.find((r) => r.id === '07-selectkey-rules')!
    const plan = sel.onInput({
      userEvent: 'input.type',
      inputText: '《',
      replaced: { from: 0, to: 5, text: 'hello' },
      docUri: 'file:///a.md',
      snapshot: { text: '《', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(plan?.changes).toEqual([{ offset: 0, length: 1, text: '《hello》' }])
    expect(plan?.selection).toEqual({ anchor: 1, head: 1 })
  })

  it('改写的 autopair-input 副本：真实注册链 02 族仍可补全配对', async () => {
    const modified = { ...retiredById.get('builtin-autopair-input')!, trigger: '[《「]' }
    const { io } = memoryIo({
      'builtin-rules.json': JSON.stringify([
        modified,
        DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-autopair-jump')!,
      ]),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const regs = registerWithSource({ builtin: store.getSnapshot().builtin, user: [] })
    const autopair = regs.find((r) => r.id === '02-autopair')!
    const plan = autopair.onInput({
      userEvent: 'input.type',
      inputText: '《',
      replaced: null,
      docUri: 'file:///a.md',
      snapshot: { text: '《', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(plan?.changes).toEqual([{ offset: 0, length: 1, text: '《》' }])
    expect(plan?.selection).toEqual({ anchor: 1, head: 1 })
  })

  it('未改写副本回收后：新装形态的 07 族不装载退役 id（映射不复活）', async () => {
    const { io } = memoryIo()
    const store = new RuleStore(io)
    await store.init()
    const regs = registerWithSource({ builtin: store.getSnapshot().builtin, user: [] })
    const sel = regs.find((r) => r.id === '07-selectkey-rules')!
    const plan = sel.onInput({
      userEvent: 'input.type',
      inputText: '《',
      replaced: { from: 0, to: 5, text: 'hello' },
      docUri: 'file:///a.md',
      snapshot: { text: '《', selections: [{ anchor: 1, head: 1 }], version: 1, revision: 1 },
    })
    expect(plan).toBeNull()
  })
})

describe('quotes 出厂收窄迁移（#56：旧安装内容感知升级）', () => {
  it('旧安装未改写 quotes：装载即收窄为闭引号、磁盘重写、enabled 保留', async () => {
    const { files, io } = memoryIo({
      'builtin-rules.json': JSON.stringify([legacyQuotes]),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const quotes = store.getSnapshot().builtin.find((r) => r.id === 'builtin-sel-wrap-quotes')
    expect(quotes?.trigger).toBe('”’')
    const onDisk = JSON.parse(files.get('builtin-rules.json')!) as Array<{ id: string; trigger?: string }>
    expect(onDisk.find((r) => r.id === 'builtin-sel-wrap-quotes')?.trigger).toBe('”’')
  })

  it('仅 enabled=false 的旧 quotes：内容一致 → 升级且 enabled 保持 false', async () => {
    const { io } = memoryIo({
      'builtin-rules.json': JSON.stringify([{ ...legacyQuotes, enabled: false }]),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const quotes = store.getSnapshot().builtin.find((r) => r.id === 'builtin-sel-wrap-quotes')
    expect(quotes?.trigger).toBe('”’')
    expect(quotes?.enabled).toBe(false)
  })

  it('改写过的旧 quotes：不迁移（保留用户修改），开引号触发原样', async () => {
    const rewritten = { ...legacyQuotes, trigger: '“‘’' }
    const { io } = memoryIo({
      'builtin-rules.json': JSON.stringify([rewritten]),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    const quotes = store.getSnapshot().builtin.find((r) => r.id === 'builtin-sel-wrap-quotes')
    expect(quotes?.trigger).toBe('“‘’')
  })

  it('外部重载同策略：旧四字符列表经外部同步写回后重载同样收窄', async () => {
    const { files, io } = memoryIo()
    const store = new RuleStore(io)
    await store.init()
    files.set(
      'builtin-rules.json',
      JSON.stringify([legacyQuotes, ...store.getSnapshot().builtin.filter((r) => r.id !== 'builtin-sel-wrap-quotes')]),
    )
    await store.init() // watcher 重载同入口
    const quotes = store.getSnapshot().builtin.find((r) => r.id === 'builtin-sel-wrap-quotes')
    expect(quotes?.trigger).toBe('”’')
  })
})

describe('迁移持久化失败（#56：不吞成成功空快照）', () => {
  it('迁移写失败：init 不抛错、缓存保留迁移后有效集合、存续规则仍可执行', async () => {
    const legacy = [
      retiredById.get('builtin-sel-wrap-cjk-brackets')!,
      retiredById.get('builtin-autopair-input')!,
      legacyQuotes,
      DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-fw2hw-double')!,
    ]
    const { files, io } = memoryIoBuiltinWriteFails({
      'builtin-rules.json': JSON.stringify(legacy),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await expect(store.init()).resolves.toBeUndefined()
    const snap = store.getSnapshot().builtin
    for (const id of RETIRED_BUILTIN_RULE_IDS) expect(snap.map((r) => r.id)).not.toContain(id)
    expect(snap.find((r) => r.id === 'builtin-sel-wrap-quotes')?.trigger).toBe('”’')
    // 磁盘仍为旧形态（写失败未落盘）
    const onDisk = JSON.parse(files.get('builtin-rules.json')!) as Array<{ id: string }>
    expect(onDisk).toHaveLength(4)
    // 存续规则在缓存集合上照常执行（。。→.）
    const engine = new RuleEngine()
    engine.addSimpleRules(snap)
    const result = engine.process({
      kind: RuleType.Input,
      docText: '。。',
      selection: { from: 2, to: 2 },
      inserted: '。',
      changeType: 'input.type',
      scopeHint: RuleScope.All,
      key: '。',
    })
    expect(result?.newText).toBe('.')
  })

  it('写失败后恢复：下次 init 幂等重试迁移并落盘', async () => {
    const legacy = [
      retiredById.get('builtin-autopair-input')!,
      legacyQuotes,
      DEFAULT_BUILTIN_RULES.find((r) => r.id === 'builtin-fw2hw-double')!,
    ]
    const { files, io } = memoryIoBuiltinWriteFails({
      'builtin-rules.json': JSON.stringify(legacy),
      'user-rules.json': '[]',
      'rule-state.json': JSON.stringify({ deletedBuiltinRuleIds: [] }),
    })
    const store = new RuleStore(io)
    await store.init()
    expect(JSON.parse(files.get('builtin-rules.json')!)).toHaveLength(3) // 写失败：磁盘未动
    const good = memoryIo(Object.fromEntries(files.entries()))
    const store2 = new RuleStore(good.io)
    await store2.init()
    const onDisk = JSON.parse(good.files.get('builtin-rules.json')!) as Array<{ id: string; trigger?: string }>
    expect(onDisk.map((r) => r.id)).not.toContain('builtin-autopair-input')
    expect(onDisk.find((r) => r.id === 'builtin-sel-wrap-quotes')?.trigger).toBe('”’')
  })
})
