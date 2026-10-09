// 规则存储纯逻辑矩阵（工单 #14）：上游 rule_manager.ts（254 行）的数据面
// 移植——JSON 持久化（builtin-rules.json / user-rules.json / rule-state.json）、
// 增删改、导入导出、迁移、重置。上游对照：easy-typing-obsidian v6.0.9
// src/rule_manager.ts。与上游的三处映射差异：
// - 引擎同步操作剥离：上游 RuleManager 持有 ruleEngine 并在增删改时同步
//   镜像；本平台引擎在页面侧（宿主单写点只管数据，页面拉取快照重装引擎）；
// - deletedBuiltinRuleIds 从上游 settings.json 迁到 rule-state.json
//   （#3 映射表：富结构不进设置 schema，归 storage JSON）；
// - 出厂 description 不做本地化替换（上游 getLocalizedBuiltinRules 按当前
//   语言包替换 description；展示层本地化归 #16/#19，存储保持 #1 数据原样）。
// IO 全部注入（内存 mock），零平台依赖。
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_RULES_FILE,
  RULE_STATE_FILE,
  USER_RULES_FILE,
  RuleStore,
  migrateRulesFiles,
  parseRulesFileContent,
  sanitizeSimpleRule,
  type RuleStoreIo,
} from '../src/rules/rule-store'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import type { SimpleRule } from '../src/rules/rule-engine'

/** 内存 IO mock：files 暴露给断言 */
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

/** 只写失败（8MB 超限等 storage 拒绝的降级面） */
function failingWriteIo(initial: Record<string, string> = {}) {
  const base = memoryIo(initial)
  const io: RuleStoreIo = {
    readText: base.io.readText,
    writeText: async () => false,
    list: base.io.list,
  }
  return { files: base.files, io }
}

/** 固定 id 工厂（上游 user-${Date.now()}-${rand4} 形态的可测替代） */
let seq = 0
const fixedId = () => `user-fixed-${++seq}`

function newStore(io: RuleStoreIo): RuleStore {
  return new RuleStore(io, { generateUserId: fixedId })
}

const builtinJson = (rules: unknown) => JSON.stringify(rules, null, 2)

describe('init：出厂种子与 ensure 语义（上游 initRuleEngine 数据面）', () => {
  it('空目录：写出厂 20 条内置规则 + 空用户规则 + 空 state', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    expect(JSON.parse(files.get(BUILTIN_RULES_FILE)!)).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(JSON.parse(files.get(USER_RULES_FILE)!)).toEqual([])
    expect(JSON.parse(files.get(RULE_STATE_FILE)!)).toEqual({ deletedBuiltinRuleIds: [] })
    expect(store.cachedBuiltinRules).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(store.cachedUserRules).toEqual([])
    expect(store.deletedBuiltinRuleIds).toEqual([])
  })

  it('已存在的 builtin 文件保留用户改动，不重写出厂', async () => {
    const customized = DEFAULT_BUILTIN_RULES.map((r, i) =>
      i === 0 ? { ...r, enabled: false, description: '用户改过的描述' } : { ...r },
    )
    const { files, io } = memoryIo({
      [BUILTIN_RULES_FILE]: builtinJson(customized),
    })
    const store = newStore(io)
    await store.init()
    const stored = JSON.parse(files.get(BUILTIN_RULES_FILE)!) as SimpleRule[]
    // 全量在场 → 无补种，用户改动原样
    expect(stored).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(stored[0]!.enabled).toBe(false)
    expect(stored[0]!.description).toBe('用户改过的描述')
    expect(store.cachedBuiltinRules[0]!.description).toBe('用户改过的描述')
  })

  it('merge：文件缺少的出厂规则按默认补齐（升级补种），尊重 deletedIds', async () => {
    const partial = DEFAULT_BUILTIN_RULES.slice(0, 2)
    const deletedId = DEFAULT_BUILTIN_RULES[2]!.id
    const { files, io } = memoryIo({
      [BUILTIN_RULES_FILE]: builtinJson(partial),
      [RULE_STATE_FILE]: JSON.stringify({ deletedBuiltinRuleIds: [deletedId] }),
    })
    const store = newStore(io)
    await store.init()
    const stored = JSON.parse(files.get(BUILTIN_RULES_FILE)!) as SimpleRule[]
    // 补种 = 出厂 - 已存在 - 已删除
    expect(stored).toHaveLength(DEFAULT_BUILTIN_RULES.length - 1)
    expect(stored.map((r) => r.id)).not.toContain(deletedId)
    expect(store.deletedBuiltinRuleIds).toEqual([deletedId])
  })

  it('已存在的 user 文件原样装载（含函数体字符串）', async () => {
    const userRule: SimpleRule = {
      id: 'user-1',
      trigger: 'x',
      replacement: 'return leftMatches[0];',
      options: 'rF',
    }
    const { io } = memoryIo({ [USER_RULES_FILE]: builtinJson([userRule]) })
    const store = newStore(io)
    await store.init()
    expect(store.cachedUserRules).toEqual([userRule])
  })

  it('损坏 JSON：builtin 损坏走 merge 恢复全量（上游 loadRulesFile catch 回 []）、user 损坏回空', async () => {
    const { files, io } = memoryIo({
      [BUILTIN_RULES_FILE]: '{broken json',
      [USER_RULES_FILE]: 'not json at all',
    })
    const store = newStore(io)
    await store.init()
    // builtin exists=true → merge：current []（损坏回空）→ 补种全量
    expect(JSON.parse(files.get(BUILTIN_RULES_FILE)!)).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    // user 损坏 → 空缓存，文件保持原样（不覆盖写）
    expect(store.cachedUserRules).toEqual([])
    expect(files.get(USER_RULES_FILE)).toBe('not json at all')
  })

  it('项级宽松过滤：数组中非法项丢弃、合法项保留（防御深度，上游无此层）', async () => {
    const { io } = memoryIo({
      [USER_RULES_FILE]: builtinJson([
        { id: 'ok', trigger: 'x', replacement: 'y' },
        null,
        'not an object',
        { trigger: 123, replacement: 'y' },
        { trigger: 'x', replacement: 42 },
        {},
      ]),
    })
    const store = newStore(io)
    await store.init()
    expect(store.cachedUserRules).toEqual([{ id: 'ok', trigger: 'x', replacement: 'y' }])
  })
})

describe('parseRulesFileContent / sanitizeSimpleRule（校验管线）', () => {
  it('非数组顶层与损坏 JSON 明确拒绝', () => {
    expect(parseRulesFileContent('{broken')).toEqual({ error: 'invalid-json' })
    expect(parseRulesFileContent('{"a":1}')).toEqual({ error: 'not-array' })
  })

  it('sanitizeSimpleRule：已知字段浅拷贝、未知字段丢弃；遗留字符串函数体原样保留（装载侧拒绝）', () => {
    expect(sanitizeSimpleRule({
      id: 'u1',
      trigger: 'x',
      trigger_right: 'y',
      replacement: 'return 1;',
      options: 'rF',
      enabled: false,
      description: 'd',
      priority: 7,
      scope_language: 'py',
      regex_flags: 'GI',
      evilField: 'drop me',
    })).toEqual({
      id: 'u1',
      trigger: 'x',
      trigger_right: 'y',
      replacement: 'return 1;',
      options: 'rF',
      enabled: false,
      description: 'd',
      priority: 7,
      scope_language: 'py',
      regex_flags: 'GI',
    })
    expect(sanitizeSimpleRule({ trigger: 'x', replacement: 1 })).toBeNull()
    expect(sanitizeSimpleRule(null)).toBeNull()
    expect(sanitizeSimpleRule('x')).toBeNull()
  })

  it('sanitizeSimpleRule：函数引用对象形态放行（kind/ref 浅拷贝、附加键丢弃）', () => {
    // 引用不查函数表——存储层只管声明性形状，ref 校验归引擎装载（fork 可扩展表）
    expect(sanitizeSimpleRule({
      trigger: 'x',
      replacement: { kind: 'function', ref: 'notInTable', extra: 'drop' },
      options: 'rF',
    })).toEqual({ trigger: 'x', replacement: { kind: 'function', ref: 'notInTable' }, options: 'rF' })
  })

  it('sanitizeSimpleRule：畸形引用对象拒绝（kind 不符 / ref 非字符串 / ref 空 / 数组）', () => {
    expect(sanitizeSimpleRule({ trigger: 'x', replacement: { kind: 'template', ref: 'a' } })).toBeNull()
    expect(sanitizeSimpleRule({ trigger: 'x', replacement: { kind: 'function', ref: 1 } })).toBeNull()
    expect(sanitizeSimpleRule({ trigger: 'x', replacement: { kind: 'function', ref: '' } })).toBeNull()
    expect(sanitizeSimpleRule({ trigger: 'x', replacement: { kind: 'function' } })).toBeNull()
    expect(sanitizeSimpleRule({ trigger: 'x', replacement: ['function', 'a'] })).toBeNull()
  })

  it('规则文件 JSON 往返：引用形态在序列化链路不丢失（出厂种子 → 落盘 → 解析回读）', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const persisted = JSON.parse(files.get(BUILTIN_RULES_FILE)!)
    const fnRules = persisted.filter((r: { options?: string }) => (r.options ?? '').includes('F'))
    expect(fnRules).toHaveLength(10)
    for (const rule of fnRules) {
      expect(rule.replacement).toMatchObject({ kind: 'function' })
      expect(typeof rule.replacement.ref).toBe('string')
    }
    // 回读等价：出厂引用规则逐条原样
    const reparsed = parseRulesFileContent(files.get(BUILTIN_RULES_FILE)!)
    if ('error' in reparsed) throw new Error('出厂规则 JSON 不应解析失败')
    const refRules = reparsed.rules.filter((r) => typeof r.replacement !== 'string')
    expect(refRules).toHaveLength(10)
  })
})

describe('init：读失败与文件不在场的判别（审查第 4 轮 C-R4-1——防 IO 瞬时失败清空用户数据）', () => {
  it('user 文件读失败但在场 → init 抛错、原文件原样未被覆盖', async () => {
    const original = builtinJson([{ trigger: 'x', replacement: 'X', id: 'user-keep' }])
    const { files, io } = memoryIo({ [USER_RULES_FILE]: original })
    const unreadable: RuleStoreIo = {
      ...io,
      readText: async (path) => (path === USER_RULES_FILE ? null : io.readText(path)),
    }
    await expect(newStore(unreadable).init()).rejects.toThrow('rules-storage-unreadable')
    expect(files.get(USER_RULES_FILE)).toBe(original)
  })

  it('builtin 文件读失败但在场 → init 抛错（出厂种子不覆盖用户定制）', async () => {
    const customized = builtinJson([{ trigger: 'c', replacement: 'C', id: 'builtin-x' }])
    const { files, io } = memoryIo({ [BUILTIN_RULES_FILE]: customized })
    const unreadable: RuleStoreIo = {
      ...io,
      readText: async (path) => (path === BUILTIN_RULES_FILE ? null : io.readText(path)),
    }
    await expect(newStore(unreadable).init()).rejects.toThrow('rules-storage-unreadable')
    expect(files.get(BUILTIN_RULES_FILE)).toBe(customized)
  })

  it('list 失败（无法判别在场）→ 同样保守抛错不动盘', async () => {
    const original = builtinJson([{ trigger: 'x', replacement: 'X', id: 'user-keep' }])
    const { files, io } = memoryIo({ [USER_RULES_FILE]: original })
    const unreadable: RuleStoreIo = {
      ...io,
      readText: async (path) => (path === USER_RULES_FILE ? null : io.readText(path)),
      list: async () => null,
    }
    await expect(newStore(unreadable).init()).rejects.toThrow('rules-storage-unreadable')
    expect(files.get(USER_RULES_FILE)).toBe(original)
  })

  it('确认不在场（list 不含）→ 正常种写不抛错（空目录语义回归）', async () => {
    const { files, io } = memoryIo()
    await newStore(io).init()
    expect(JSON.parse(files.get(BUILTIN_RULES_FILE)!)).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(JSON.parse(files.get(USER_RULES_FILE)!)).toEqual([])
  })

  it('saveState 失败回滚内存停用清单：下次成功落盘不含未确认项（审查第 4 轮 C-R4-4）', async () => {
    // state 文件预置合法内容——避免 init 的空 state 伴随写消费故障注入计数
    const { files, io } = memoryIo({
      [BUILTIN_RULES_FILE]: builtinJson(DEFAULT_BUILTIN_RULES),
      [RULE_STATE_FILE]: JSON.stringify({ deletedBuiltinRuleIds: [] }, null, 2),
    })
    let stateWriteCount = 0
    const flakyState: RuleStoreIo = {
      ...io,
      writeText: async (path, content) => {
        if (path === RULE_STATE_FILE && stateWriteCount++ === 0) return false
        return io.writeText(path, content)
      },
    }
    const store = newStore(flakyState)
    await store.init()
    const id1 = DEFAULT_BUILTIN_RULES[0]!.id
    const id2 = DEFAULT_BUILTIN_RULES[1]!.id
    await expect(store.deleteBuiltinRule(id1)).resolves.toBe(false) // state 写失败
    await expect(store.deleteBuiltinRule(id2)).resolves.toBe(true)
    // 回滚后：成功的 state 写只含 id2（未回滚则残留 id1）
    expect(JSON.parse(files.get(RULE_STATE_FILE)!).deletedBuiltinRuleIds).toEqual([id2])
  })
})

describe('用户规则增删改（上游 addUserRule / updateUserRule / deleteUserRule）', () => {
  it('addUserRule：分配 user- 前缀 id、写文件、缓存追加', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const id = await store.addUserRule({ trigger: 'x', replacement: 'X' })
    expect(id).toMatch(/^user-/)
    expect(store.cachedUserRules).toHaveLength(1)
    expect((JSON.parse(files.get(USER_RULES_FILE)!) as SimpleRule[])[0]!.id).toBe(id)
  })

  it('updateUserRule：命中改写并保持 id；未命中 no-op 返回 false', async () => {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const id = (await store.addUserRule({ trigger: 'x', replacement: 'X' }))!
    const ok = await store.updateUserRule(id, { trigger: 'z', replacement: 'Z', options: 'r' })
    expect(ok).toBe(true)
    expect(store.cachedUserRules[0]).toMatchObject({ id, trigger: 'z', options: 'r' })
    expect(await store.updateUserRule('user-none', { trigger: 'a', replacement: 'b' })).toBe(false)
  })

  it('deleteUserRule：缓存与文件同步收缩；未命中 false', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const id = (await store.addUserRule({ trigger: 'x', replacement: 'X' }))!
    expect(await store.deleteUserRule(id)).toBe(true)
    expect(store.cachedUserRules).toEqual([])
    expect(JSON.parse(files.get(USER_RULES_FILE)!)).toEqual([])
    expect(await store.deleteUserRule(id)).toBe(false)
  })

  it('写失败（8MB 上限等）：缓存不变、返回失败', async () => {
    const { io } = failingWriteIo()
    const store = newStore(io)
    await store.init()
    // init 阶段空目录写种子也失败：缓存回空、不抛错（fail-safe）
    expect(store.cachedBuiltinRules).toEqual([])
    expect(await store.addUserRule({ trigger: 'x', replacement: 'X' })).toBeNull()
    expect(store.cachedUserRules).toEqual([])
  })
})

describe('导入与导出（上游 importUserRules / JSON 字符串形态）', () => {
  async function storeWithRules() {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    await store.addUserRule({ trigger: 'dup', trigger_right: 'r', replacement: 'A', options: 'r', regex_flags: 'gi' })
    return store
  }

  it('去重键 = trigger + trigger_right + isRegex + 归一 flags（上游 getImportDedupKey）', async () => {
    const store = await storeWithRules()
    const result = await store.importUserRules([
      // 同键不同 flags 大小写/顺序 → 归一后相同 → skip
      { trigger: 'dup', trigger_right: 'r', replacement: 'B', options: 'r', regex_flags: 'ig' },
      // 非正则规则 flags 不入键
      { trigger: 'fresh', replacement: 'C' },
      // 缺 trigger / 缺 replacement → skip
      { replacement: 'D' },
      { trigger: 'no-repl' },
    ])
    expect(result).toEqual({ imported: 1, skipped: 3, persisted: true })
    expect(store.cachedUserRules).toHaveLength(2)
    expect(store.cachedUserRules[1]).toMatchObject({ trigger: 'fresh', enabled: true })
  })

  it('同批内重复也计入去重（existingSet 增量登记）', async () => {
    const store = await storeWithRules()
    const result = await store.importUserRules([
      { trigger: 'batch', replacement: '1' },
      { trigger: 'batch', replacement: '2' },
    ])
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('导入内容经校验管线：非法项按 skipped 计、不落盘', async () => {
    const store = await storeWithRules()
    const result = await store.importUserRules([
      { trigger: 'ok', replacement: 'fine' },
      { trigger: 42, replacement: 'bad' },
      'garbage',
    ])
    expect(result).toEqual({ imported: 1, skipped: 2, persisted: true })
    expect(store.cachedUserRules.at(-1)!.trigger).toBe('ok')
  })

  it('全部 skip 时不写文件；导出为缩进 2 的 JSON 字符串', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const before = files.get(USER_RULES_FILE)!
    const result = await store.importUserRules([{ replacement: 'no trigger' }])
    expect(result.persisted).toBe(false)
    expect(files.get(USER_RULES_FILE)).toBe(before)

    // addUserRule 强制重分配 id（上游语义：传入 id 不信任）
    const id = await store.addUserRule({ id: 'user-ignored', trigger: 'k', replacement: 'V' })
    expect(store.exportUserRules()).toBe(builtinJson([{ id, trigger: 'k', replacement: 'V' }]))
  })
})

describe('内置规则管理（上游 deleteBuiltinRule / restoreBuiltinRule / resetAllBuiltinRules）', () => {
  it('deleteBuiltinRule：文件移除 + deletedIds 落 state', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const target = DEFAULT_BUILTIN_RULES[0]!.id
    expect(await store.deleteBuiltinRule(target)).toBe(true)
    expect(JSON.parse(files.get(BUILTIN_RULES_FILE)!)).toHaveLength(DEFAULT_BUILTIN_RULES.length - 1)
    expect(JSON.parse(files.get(RULE_STATE_FILE)!)).toEqual({ deletedBuiltinRuleIds: [target] })
    expect(store.deletedBuiltinRuleIds).toEqual([target])
  })

  it('restoreBuiltinRule：按出厂恢复 + state 移除；未知 id no-op', async () => {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const target = DEFAULT_BUILTIN_RULES[0]!.id
    await store.deleteBuiltinRule(target)
    expect(await store.restoreBuiltinRule(target)).toBe(true)
    expect(store.cachedBuiltinRules).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(store.deletedBuiltinRuleIds).toEqual([])
    expect(await store.restoreBuiltinRule('builtin-nope')).toBe(false)
  })

  it('resetAllBuiltinRules：恢复出厂 20 条并清空 deletedIds', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    await store.deleteBuiltinRule(DEFAULT_BUILTIN_RULES[0]!.id)
    await store.updateBuiltinRule(DEFAULT_BUILTIN_RULES[1]!.id, {
      trigger: 'zzz',
      replacement: '改过',
    })
    expect(await store.resetAllBuiltinRules()).toBe(true)
    expect(JSON.parse(files.get(BUILTIN_RULES_FILE)!)).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(JSON.parse(files.get(RULE_STATE_FILE)!)).toEqual({ deletedBuiltinRuleIds: [] })
    expect(store.cachedBuiltinRules.find((r) => r.id === DEFAULT_BUILTIN_RULES[1]!.id)!.trigger)
      .not.toBe('zzz')
  })

  it('updateBuiltinRule：命中改写；未命中 false', async () => {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const target = DEFAULT_BUILTIN_RULES[0]!.id
    expect(await store.updateBuiltinRule(target, { trigger: 't2', replacement: 'r2' })).toBe(true)
    expect(store.cachedBuiltinRules.find((r) => r.id === target)).toMatchObject({ trigger: 't2' })
    expect(await store.updateBuiltinRule('builtin-nope', { trigger: 'a', replacement: 'b' })).toBe(false)
  })
})

describe('开关 / 排序 / 触发模式（上游 toggle / reorder / updateRuleTriggerMode）', () => {
  it('toggleRuleEnabled 分文件写：builtin 写 builtin、user 写 user', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const builtinId = DEFAULT_BUILTIN_RULES[0]!.id
    const userId = (await store.addUserRule({ trigger: 'x', replacement: 'X' }))!
    expect(await store.toggleRuleEnabled(builtinId, true, false)).toBe(true)
    expect((JSON.parse(files.get(BUILTIN_RULES_FILE)!) as SimpleRule[]).find((r) => r.id === builtinId)!.enabled).toBe(false)
    expect(await store.toggleRuleEnabled(userId, false, false)).toBe(true)
    expect((JSON.parse(files.get(USER_RULES_FILE)!) as SimpleRule[]).find((r) => r.id === userId)!.enabled).toBe(false)
    expect(await store.toggleRuleEnabled('nope', true, true)).toBe(false)
  })

  it('reorderUserRule：范围内移动；越界与原地 no-op', async () => {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    await store.addUserRule({ trigger: 'a', replacement: '1' })
    await store.addUserRule({ trigger: 'b', replacement: '2' })
    await store.addUserRule({ trigger: 'c', replacement: '3' })
    expect(await store.reorderUserRule(2, 0)).toBe(true)
    expect(store.cachedUserRules.map((r) => r.trigger)).toEqual(['c', 'a', 'b'])
    expect(await store.reorderUserRule(1, 1)).toBe(false)
    expect(await store.reorderUserRule(-1, 0)).toBe(false)
    expect(await store.reorderUserRule(0, 99)).toBe(false)
  })

  it('updateRuleTriggerMode：T 旗标增删、options 空串归 undefined', async () => {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const userId = (await store.addUserRule({ trigger: 'x', replacement: 'X', options: 'r' }))!
    expect(await store.updateRuleTriggerMode(userId, false, true)).toBe(true)
    expect(store.cachedUserRules.find((r) => r.id === userId)!.options).toBe('rT')
    expect(await store.updateRuleTriggerMode(userId, false, false)).toBe(true)
    expect(store.cachedUserRules.find((r) => r.id === userId)!.options).toBe('r')
    // 无旗标时去 T → 空串归 undefined（上游 rule.options = opts || undefined）
    const bare = (await store.addUserRule({ trigger: 'y', replacement: 'Y', options: 'T' }))!
    await store.updateRuleTriggerMode(bare, false, false)
    expect(store.cachedUserRules.find((r) => r.id === bare)!.options).toBeUndefined()
  })
})

describe('迁移（上游 migrateRulesFiles：读老路径 → 写新路径）', () => {
  it('两文件内容原样拷贝、老缺失跳过、同路径 no-op', async () => {
    const { files, io } = memoryIo({
      'old/builtin-rules.json': '[{"id":"b1","trigger":"x","replacement":"y"}]',
      'old/user-rules.json': '[]',
    })
    await migrateRulesFiles(io, 'old', 'new')
    expect(files.get('new/builtin-rules.json')).toBe('[{"id":"b1","trigger":"x","replacement":"y"}]')
    expect(files.get('new/user-rules.json')).toBe('[]')
    expect(files.has('old/builtin-rules.json')).toBe(true) // 原地保留（拷贝非移动）
    // 同路径 no-op：不抛错不改动
    await migrateRulesFiles(io, 'same', 'same')
    expect(files.size).toBe(4)
  })
})

describe('重载与快照（外部变化重载 = 重跑 init 语义）', () => {
  it('外部改写 user 文件后 init 重读新内容；外部删除 builtin 后恢复出厂（上游 onConfigFileChange → initRuleEngine）', async () => {
    const { files, io } = memoryIo()
    const store = newStore(io)
    await store.init()
    files.set(USER_RULES_FILE, builtinJson([{ id: 'user-ext', trigger: 'ext', replacement: 'E' }]))
    files.delete(BUILTIN_RULES_FILE)
    await store.init()
    expect(store.cachedUserRules).toEqual([{ id: 'user-ext', trigger: 'ext', replacement: 'E' }])
    expect(store.cachedBuiltinRules).toHaveLength(DEFAULT_BUILTIN_RULES.length)
  })

  it('上游语义钉子：文件整体缺失时恢复出厂全量（deletedIds 只约束 merge 补种路径）', async () => {
    const { files, io } = memoryIo({
      [RULE_STATE_FILE]: JSON.stringify({ deletedBuiltinRuleIds: [DEFAULT_BUILTIN_RULES[0]!.id] }),
    })
    const store = newStore(io)
    await store.init()
    // builtin 文件不存在 → 写出厂全量，无视 deletedIds（上游 exists=false 分支）
    expect(store.cachedBuiltinRules).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(store.cachedBuiltinRules.map((r) => r.id)).toContain(DEFAULT_BUILTIN_RULES[0]!.id)
    // 而文件在场（即使空数组）走 merge 补种路径时尊重 deletedIds
    files.set(BUILTIN_RULES_FILE, '[]')
    files.set(USER_RULES_FILE, '[]')
    await store.init()
    expect(store.cachedBuiltinRules).toHaveLength(DEFAULT_BUILTIN_RULES.length - 1)
    expect(store.cachedBuiltinRules.map((r) => r.id)).not.toContain(DEFAULT_BUILTIN_RULES[0]!.id)
  })

  it('getSnapshot：三份数据 + 不可变引用语义（每次快照新数组）', async () => {
    const { io } = memoryIo()
    const store = newStore(io)
    await store.init()
    const snap1 = store.getSnapshot()
    await store.addUserRule({ trigger: 'x', replacement: 'X' })
    const snap2 = store.getSnapshot()
    expect(snap1.user).toHaveLength(0)
    expect(snap2.user).toHaveLength(1)
    expect(snap1).not.toBe(snap2)
    expect(snap2.builtin).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(snap2.deletedBuiltinRuleIds).toEqual([])
  })
})
