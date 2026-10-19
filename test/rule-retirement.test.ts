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
