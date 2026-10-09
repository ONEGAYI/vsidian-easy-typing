// 页面侧规则客户端与端到端矩阵（工单 #14）：
// - PageRulesClient 单元：拉取装载、通道失败降级、revision 轮询重装、
//   轮询启停（timer 注入确定性）；
// - 端到端（mock 承载）：HostRulesService + registerRulesChannels 装配 +
//   mock channel registry + mock storage（平台语义），页面 client 直连
//   ——覆盖票面验收「规则增删改 / 导入导出 / 外部重载端到端」与
//   「停用重装后数据保留」。
import { describe, expect, it, vi } from 'vitest'
import { PageRulesClient, type RulesChannelLike } from '../src/rules/rules-page'
import { HostRulesService, registerRulesChannels } from '../src/rulesHost'
import { RULES_TOPIC } from '../src/rules/rules-protocol'
import { RuleEngine, RuleScope, RuleType, type TxContext } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import { BUILTIN_RULES_FILE, USER_RULES_FILE } from '../src/rules/rule-store'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'

// ===== mock 设施 =====

function okRequest(result: unknown): RulesChannelLike {
  return { request: async () => ({ ok: true as const, result }) }
}

function failRequest(reason = 'timeout'): RulesChannelLike {
  return { request: async () => ({ ok: false as const, reason }) }
}

/** 可编程 mock 通道（按 topic 队列返回） */
function scriptedChannel(script: Record<string, Array<{ ok: true; result: unknown } | { ok: false; reason: string }>>) {
  const calls: string[] = []
  const channel: RulesChannelLike = {
    request: async (topic) => {
      calls.push(topic)
      const queue = script[topic]
      const next = queue?.shift()
      return next ?? { ok: false, reason: 'rejected' }
    },
  }
  return { channel, calls }
}

/** 手动轮询时钟（interval 语义：fire 之间保留回调，clear 只失效对应项） */
function manualTimers() {
  const entries: Array<{ fn: () => void; alive: boolean }> = []
  return {
    fire: () => {
      for (const e of [...entries]) {
        if (e.alive) e.fn()
      }
    },
    setInterval: (fn: () => void) => {
      const entry = { fn, alive: true }
      entries.push(entry)
      return entry
    },
    clearInterval: (handle: unknown) => {
      (handle as { alive: boolean }).alive = false
    },
  }
}

// ===== PageRulesClient 单元 =====

const snap = (revision: number, user: unknown[] = []) => ({
  revision,
  builtin: DEFAULT_BUILTIN_RULES,
  user,
  deletedBuiltinRuleIds: [],
})

describe('PageRulesClient 装载与降级', () => {
  it('load：拉取快照装载引擎、记录 revision、触发 onReload', async () => {
    const engine = new RuleEngine()
    const onReload = vi.fn()
    const client = new PageRulesClient({ channel: okRequest(snap(3)), engine, onReload })
    expect(client.revision).toBe(-1)
    expect(await client.load()).toBe(true)
    expect(client.revision).toBe(3)
    expect(engine.getRules()).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onReload.mock.calls[0]![0]).toMatchObject({ revision: 3 })
  })

  it('通道失败 / 形状非法：返回 false，引擎与 revision 保持原状', async () => {
    const engine = new RuleEngine()
    const failed = new PageRulesClient({ channel: failRequest('timeout'), engine })
    expect(await failed.load()).toBe(false)
    expect(engine.getRules()).toHaveLength(0)
    expect(failed.revision).toBe(-1)

    const badShape = new PageRulesClient({
      channel: okRequest({ revision: 'x', builtin: [], user: [] }),
      engine,
    })
    expect(await badShape.load()).toBe(false)
    expect(engine.getRules()).toHaveLength(0)
  })
})

describe('PageRulesClient 轮询重装', () => {
  it('revision 未变不重拉；变化后整拉重装引擎', async () => {
    const { channel, calls } = scriptedChannel({
      [RULES_TOPIC.get]: [
        { ok: true, result: snap(1) },
        { ok: true, result: snap(2, [{ id: 'user-2', trigger: 'zz', replacement: 'ZZ' }]) },
      ],
      [RULES_TOPIC.revision]: [
        { ok: true, result: { revision: 1 } }, // 未变
        { ok: true, result: { revision: 2 } }, // 变化
      ],
    })
    const engine = new RuleEngine()
    const client = new PageRulesClient({ channel, engine })
    await client.load()
    expect(engine.getRules()).toHaveLength(DEFAULT_BUILTIN_RULES.length)

    await client.poll() // revision 1 → 1：不重拉
    expect(calls.filter((t) => t === RULES_TOPIC.get)).toHaveLength(1)
    expect(engine.getRules()).toHaveLength(DEFAULT_BUILTIN_RULES.length)

    await client.poll() // revision 2：整拉重装（新增用户规则）
    expect(calls.filter((t) => t === RULES_TOPIC.get)).toHaveLength(2)
    expect(engine.getRules()).toHaveLength(DEFAULT_BUILTIN_RULES.length + 1)
    expect(client.revision).toBe(2)
  })

  it('轮询失败容忍（timeout 不影响下一轮）；启停定时器可控', async () => {
    const { channel, calls } = scriptedChannel({
      [RULES_TOPIC.get]: [{ ok: true, result: snap(1) }],
      [RULES_TOPIC.revision]: [
        { ok: false, reason: 'timeout' },
        { ok: true, result: { revision: 1 } },
      ],
    })
    const timers = manualTimers()
    const engine = new RuleEngine()
    const client = new PageRulesClient({ channel, engine, ...timers })
    await client.load()
    client.startWatch()
    client.startWatch() // 重复启动无害
    timers.fire() // 轮询失败 → 容忍
    expect(calls.filter((t) => t === RULES_TOPIC.revision)).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 0)) // 上轮落定（在途防重下同步连发会被跳过）
    timers.fire() // revision 未变
    expect(calls.filter((t) => t === RULES_TOPIC.get)).toHaveLength(1)
    client.stopWatch()
    client.stopWatch() // 重复停止无害
    await new Promise((resolve) => setTimeout(resolve, 0))
    timers.fire() // 已停止：不再轮询
    expect(calls.filter((t) => t === RULES_TOPIC.revision)).toHaveLength(2)
  })

  it('poll 通道异常（request reject）→ 吞掉不抛（审查 C-P3-2：裸 void 链不成 unhandledrejection）', async () => {
    const calls: string[] = []
    const channel: RulesChannelLike = {
      request: (topic) => {
        calls.push(topic)
        return Promise.reject(new Error('channel transport broken'))
      },
    }
    const client = new PageRulesClient({ channel, engine: new RuleEngine() })
    // 旧形态：poll 冒泡 rejection，startWatch 的 void this.poll() 成为
    // unhandledrejection；修复后 poll 内部吞掉
    await expect(client.poll()).resolves.toBeUndefined()
    expect(calls).toEqual([RULES_TOPIC.revision])
  })

  it('在途防重：上一轮 poll 未完成时跳过本轮（审查 C-P3-2），完成后恢复', async () => {
    const calls: string[] = []
    let release: ((result: { ok: true; result: unknown } | { ok: false; reason: string }) => void) | null = null
    const channel: RulesChannelLike = {
      request: (topic) => {
        calls.push(topic)
        if (release === null) {
          return new Promise((resolve) => {
            release = resolve
          })
        }
        // 与初始 revision(-1) 一致：不触发整拉，让 calls 面只反映轮询节拍
        return Promise.resolve({ ok: true as const, result: { revision: -1 } })
      },
    }
    const timers = manualTimers()
    const client = new PageRulesClient({ channel, engine: new RuleEngine(), ...timers })
    client.startWatch()
    timers.fire() // 第一轮挂起（revision 请求未回）
    timers.fire() // 上一轮在途 → 本轮跳过（不新增请求）
    expect(calls).toEqual([RULES_TOPIC.revision])
    release!({ ok: true, result: { revision: -1 } })
    await new Promise((resolve) => setTimeout(resolve, 0)) // 第一轮落定
    timers.fire() // 在途标志已清 → 正常发轮
    expect(calls).toEqual([RULES_TOPIC.revision, RULES_TOPIC.revision])
  })
})

// ===== 端到端（mock 承载） =====

function isSafePath(p: string): boolean {
  if (p.includes('\\') || p.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(p)) return false
  return p.split('/').every((s) => s.length > 0 && s !== '.' && s !== '..')
}

function mockStorage(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const listeners = new Set<(path: string, kind: 'change' | 'delete') => void>()
  let clock = 1_000_000
  const storage: AddonStorageFacet = {
    uri: () => 'file:///globalStorage/vsidian/addons/ONEGAYI.vsidian-easy-typing/',
    readFile: async (path) => {
      if (!isSafePath(path)) return { ok: false, reason: 'invalid-path' }
      const value = files.get(path)
      return value === undefined
        ? { ok: false, reason: 'error', detail: 'not-found' }
        : { ok: true, value }
    },
    writeFile: async (path, content) => {
      if (!isSafePath(path)) return { ok: false, reason: 'invalid-path' }
      if (content.length > 8 * 1024 * 1024) return { ok: false, reason: 'too-large' }
      files.set(path, content)
      return { ok: true, value: null }
    },
    list: async () => ({
      ok: true,
      entries: [...files.keys()].map((path) => ({ path, kind: 'file' as const })),
    }),
    deleteFile: async (path) => {
      if (!isSafePath(path)) return { ok: false, reason: 'invalid-path' }
      files.delete(path)
      return { ok: true, value: null }
    },
    onDidChangeFile: (cb): AddonStorageWatchHandle => {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    },
  }
  return {
    files,
    storage,
    now: () => clock,
    tick: (d = 1) => (clock += d),
    emit: (path: string, kind: 'change' | 'delete') => {
      for (const l of listeners) l(path, kind)
    },
  }
}

function mockRegistry() {
  const handlers = new Map<string, (payload: unknown) => unknown | Promise<unknown>>()
  const registry: AddonChannelRegistry = {
    handle: (topic, handler) => {
      handlers.set(topic, handler)
      return { dispose: () => handlers.delete(topic) }
    },
  }
  const request: RulesChannelLike['request'] = async (topic, payload) => {
    const handler = handlers.get(topic)
    if (!handler) return { ok: false, reason: 'rejected' }
    try {
      return { ok: true, result: await handler(payload) }
    } catch {
      return { ok: false, reason: 'rejected' }
    }
  }
  return { registry, request }
}

function inputCtx(docText: string, cursor: number): TxContext {
  return {
    kind: RuleType.Input,
    docText,
    selection: { from: cursor, to: cursor },
    inserted: '',
    changeType: 'input.type',
    scopeHint: RuleScope.All,
  }
}

/** 组装一条端到端链：mock storage → HostRulesService → channel 装配 → 页面 client */
function assemble(initial: Record<string, string> = {}) {
  const mock = mockStorage(initial)
  const service = new HostRulesService(mock.storage, {
    now: mock.now,
    setTimeout: (fn) => {
      void fn() // 去抖即时（端到端直发，去抖窗口语义在 rulesHost 测试覆盖）
      return 0
    },
    clearTimeout: () => {},
  })
  const { registry, request } = mockRegistry()
  registerRulesChannels(registry, service)
  const engine = new RuleEngine()
  const client = new PageRulesClient({ channel: { request }, engine })
  return { mock, service, engine, client, request }
}

describe('端到端：规则数据链（票面验收 · mock 承载）', () => {
  it('装载 → 引擎可执行内置规则（输入 · 触发配对补全）', async () => {
    const { engine, client } = assemble()
    expect(await client.load()).toBe(true)
    // builtin-autopair-input：键入 （ → （） + $0 tabstop（#14 已解析）
    const result = engine.process(inputCtx('a（', 2))
    expect(result?.newText).toBe('（）')
    expect(result?.tabstops).toEqual([{ number: 0, from: 2, to: 2 }])
  })

  it('mutate 通道增删改用户规则：revision 递增 + 轮询自动重装（新规则可命中）', async () => {
    const { client, request, engine } = assemble()
    await client.load()
    // 新增用户规则：zz → ZZ（priority 1 抢先）
    const add = await request(RULES_TOPIC.mutate, {
      op: 'addUserRule',
      rule: { trigger: 'zz', replacement: 'ZZ', options: '', priority: 1 },
    })
    expect(add).toMatchObject({ ok: true, result: { ok: true, revision: 1 } })
    const newId = (add as { result: { id: string } }).result.id
    // 轮询发现 revision 变化 → 重装（新规则命中：只替换 'zz' 区间，前缀 x 不动）
    await client.poll()
    const hit = engine.process(inputCtx('xzz', 3))
    expect(hit?.newText).toBe('ZZ')
    expect(hit?.matchRange).toEqual({ from: 1, to: 3 })

    // 改写：zz → YY
    await request(RULES_TOPIC.mutate, {
      op: 'updateUserRule',
      id: newId,
      rule: { trigger: 'zz', replacement: 'YY', options: '', priority: 1 },
    })
    await client.poll()
    expect(engine.process(inputCtx('xzz', 3))?.newText).toBe('YY')

    // 删除：不再命中
    await request(RULES_TOPIC.mutate, { op: 'deleteUserRule', id: newId })
    await client.poll()
    expect(engine.process(inputCtx('xzz', 3))).toBeNull()
  })

  it('导入导出：content 字符串经校验与去重落盘，导出与文件内容一致', async () => {
    const { client, request, mock } = assemble()
    await client.load()
    await request(RULES_TOPIC.mutate, {
      op: 'importUserRules',
      content: JSON.stringify([
        { trigger: 'imp1', replacement: 'I1' },
        { trigger: 'imp1', replacement: '重复项' }, // 同批去重
        { replacement: '缺 trigger' }, // 非法项 skipped
      ]),
    })
    await client.poll()
    const imported = await request(RULES_TOPIC.get, null)
    const user = (imported as { result: { user: Array<{ trigger: string }> } }).result.user
    expect(user.filter((r) => r.trigger === 'imp1')).toHaveLength(1)

    const exported = await request(RULES_TOPIC.exportUser, null)
    expect((exported as { result: { content: string } }).result.content).toBe(
      mock.files.get(USER_RULES_FILE),
    )

    // 非法 JSON 拒绝
    const bad = await request(RULES_TOPIC.mutate, { op: 'importUserRules', content: '{oops' })
    expect(bad).toMatchObject({ ok: true, result: { ok: false, reason: 'invalid-json' } })
    // 非法载荷拒绝
    const badPayload = await request(RULES_TOPIC.mutate, { op: 'addUserRule', rule: 'x' })
    expect(badPayload).toMatchObject({ ok: true, result: { ok: false, reason: 'invalid-payload' } })
  })

  it('外部重载：同步工具改写规则文件 → watcher → revision → 轮询重装（引擎即时生效）', async () => {
    const { client, mock, engine, service } = assemble()
    await client.load()
    expect(engine.process(inputCtx('xzz', 3))).toBeNull()

    mock.tick(2000) // 跳出自写抑制窗口
    mock.files.set(
      USER_RULES_FILE,
      JSON.stringify([{ id: 'user-ext', trigger: 'zz', replacement: 'EXT', priority: 1 }], null, 2),
    )
    mock.emit(USER_RULES_FILE, 'change')
    // 宿主侧重载完成（去抖即时注入，重载链经微任务）→ 页面轮询发现并重装
    await vi.waitFor(() => expect(service.revision).toBe(1))
    await client.poll()
    expect(engine.process(inputCtx('xzz', 3))?.newText).toBe('EXT')
  })

  it('内置规则删除与恢复经 deletedIds：文件在场时重载不复活，恢复后重新在场', async () => {
    const { client, request, engine, mock, service } = assemble()
    await client.load()
    const target = DEFAULT_BUILTIN_RULES[0]!.id
    await request(RULES_TOPIC.mutate, { op: 'deleteBuiltinRule', id: target })
    await client.poll()
    expect(engine.getRule(target)).toBeUndefined()

    // 外部改写（文件在场，走 merge 补种路径）不恢复已删内置规则；
    // 注：文件整体删除是另一语义——上游 init 对缺失文件恢复出厂全量
    // （deletedIds 只约束补种，见 rule-store 测试「损坏 JSON merge 恢复」组）
    mock.tick(2000)
    const builtinContent = mock.files.get(BUILTIN_RULES_FILE)!
    mock.files.set(BUILTIN_RULES_FILE, builtinContent + '\n')
    mock.emit(BUILTIN_RULES_FILE, 'change')
    await vi.waitFor(() => expect(service.revision).toBe(2))
    await client.poll()
    expect(engine.getRule(target)).toBeUndefined()
    expect(engine.getRules().filter((r) => r.id.startsWith('builtin-'))).toHaveLength(
      DEFAULT_BUILTIN_RULES.length - 1,
    )

    // 恢复：重新在场
    await request(RULES_TOPIC.mutate, { op: 'restoreBuiltinRule', id: target })
    await client.poll()
    expect(engine.getRule(target)).toBeDefined()
  })

  it('停用重装数据保留：dispose 不删文件，新代次 service 同 storage 读回全部数据', async () => {
    const mock = mockStorage()
    const service = new HostRulesService(mock.storage, { now: mock.now })
    await service.addUserRule({ trigger: 'keep', replacement: 'K' })
    await service.deleteBuiltinRule(DEFAULT_BUILTIN_RULES[0]!.id)
    const before = mock.files.get(USER_RULES_FILE)!
    const builtinBefore = mock.files.get(BUILTIN_RULES_FILE)!
    service.dispose()

    // 「重装」：新 service 实例（新代次）挂同一 storage
    const reborn = new HostRulesService(mock.storage, { now: mock.now })
    const snap = await reborn.ensureLoaded()
    expect(snap.user).toEqual([
      expect.objectContaining({ trigger: 'keep', replacement: 'K' }),
    ])
    expect(snap.builtin.map((r) => r.id)).not.toContain(DEFAULT_BUILTIN_RULES[0]!.id)
    expect(mock.files.get(USER_RULES_FILE)).toBe(before)
    expect(mock.files.get(BUILTIN_RULES_FILE)).toBe(builtinBefore)
    reborn.dispose()
  })

  it('storageUri 端点：返回组件数据目录 URI', async () => {
    const { request } = assemble()
    const outcome = await request(RULES_TOPIC.storageUri, null)
    expect(outcome).toMatchObject({
      ok: true,
      result: { uri: 'file:///globalStorage/vsidian/addons/ONEGAYI.vsidian-easy-typing/' },
    })
  })
})
