// 宿主侧规则服务矩阵（工单 #14）：HostRulesService 把 RuleStore 纯逻辑接到
// 平台 AddonStorageFacet（storage 在宿主侧、单写点），并实现外部文件变化
// 自动重载（onDidChangeFile 消费：自写抑制 2s + 去抖 1s，上游 main.ts
// onConfigFileChange L252-272 语义）与 revision 代次（页面轮询感知面）。
//
// mock storage 实现票面平台语义（vsidian#404）：相对路径正斜杠、越界
// invalid-path 拒绝、8MB 单文件上限、停用不删数据。service 的降级行为
// （读写拒绝不崩、写失败缓存不变）由这些语义驱动验证。
import { describe, expect, it } from 'vitest'
import { HostRulesService } from '../src/rulesHost'
import { IMPORT_CONTENT_MAX_LENGTH, IMPORT_MAX_RULES } from '../src/rules/rules-protocol'
import {
  BUILTIN_RULES_FILE,
  RULE_STATE_FILE,
  USER_RULES_FILE,
} from '../src/rules/rule-store'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'

/** 平台路径判定（addonStorage.ts isSafeAddonStoragePath 的行为要点） */
function isSafePath(p: string): boolean {
  if (p.includes('\\') || p.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(p)) return false
  const segments = p.split('/')
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..')
}

interface MockStorage {
  files: Map<string, string>
  storage: AddonStorageFacet
  /** 外部变化注入（同步工具改写/删除文件的事件面） */
  emit: (path: string, kind: 'change' | 'delete') => void
  /** deleteFile 调用记录（「停用不删数据」断言面） */
  deletions: string[]
  /** 指定路径强制拒绝（故障注入：invalid-path / too-large / error） */
  failWrites: Set<string>
  failReads: Set<string>
  tick: (deltaMs?: number) => void
  now: () => number
}

function mockStorage(initial: Record<string, string> = {}): MockStorage {
  const files = new Map<string, string>(Object.entries(initial))
  const listeners = new Set<(path: string, kind: 'change' | 'delete') => void>()
  const deletions: string[] = []
  const failWrites = new Set<string>()
  const failReads = new Set<string>()
  let clock = 1_000_000
  const now = () => clock
  const storage: AddonStorageFacet = {
    uri: () => 'file:///globalStorage/vsidian/addons/ONEGAYI.vsidian-easy-typing/',
    readFile: async (path) => {
      if (!isSafePath(path)) return { ok: false, reason: 'invalid-path' }
      if (failReads.has(path)) return { ok: false, reason: 'error', detail: 'injected' }
      const value = files.get(path)
      return value === undefined
        ? { ok: false, reason: 'error', detail: 'not-found' }
        : { ok: true, value }
    },
    writeFile: async (path, content) => {
      if (!isSafePath(path)) return { ok: false, reason: 'invalid-path' }
      if (failWrites.has(path)) return { ok: false, reason: 'too-large' }
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
      deletions.push(path)
      files.delete(path)
      return { ok: true, value: null }
    },
    onDidChangeFile: (callback): AddonStorageWatchHandle => {
      listeners.add(callback)
      return { dispose: () => listeners.delete(callback) }
    },
  }
  return {
    files,
    storage,
    deletions,
    failWrites,
    failReads,
    now,
    tick: (delta = 1) => (clock += delta),
    emit: (path, kind) => {
      for (const listener of listeners) listener(path, kind)
    },
  }
}

/** 手动去抖调度器（确定性触发 reload 窗口；firePending 等待重载完成） */
interface Scheduler {
  pending: Array<{ fn: () => void | Promise<void>; ms: number; cancelled: boolean }>
  firePending: () => Promise<void>
  setTimeout: (fn: () => void | Promise<void>, ms: number) => number
  clearTimeout: (handle: unknown) => void
}

function manualScheduler(): Scheduler {
  const pending: Array<{ fn: () => void | Promise<void>; ms: number; cancelled: boolean }> = []
  return {
    pending,
    setTimeout: (fn, ms) => {
      pending.push({ fn, ms, cancelled: false })
      return pending.length - 1
    },
    clearTimeout: (handle: unknown) => {
      pending[handle as number]!.cancelled = true
    },
    firePending: async () => {
      const due = pending.splice(0) // 取走全部：执行未取消的，队列清空
      for (const t of due) {
        if (!t.cancelled) await t.fn()
      }
    },
  }
}

function newService(mock: MockStorage, scheduler: ManualHandle = manualScheduler()) {
  const service = new HostRulesService(mock.storage, {
    now: mock.now,
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  })
  return { service, scheduler }
}

type ManualHandle = ReturnType<typeof manualScheduler>

describe('mock storage 平台语义（票面平台语义节的测试面自证）', () => {
  it('相对路径正斜杠；反斜杠 / 绝对路径 / .. 越界均 invalid-path', async () => {
    const { storage } = mockStorage()
    expect(await storage.readFile('sub/dir/file.json')).toEqual({ ok: false, reason: 'error', detail: 'not-found' })
    for (const bad of ['a\\b.json', '/abs.json', 'C:/x.json', '../escape.json', 'a/../b.json', './x.json', 'a//b.json']) {
      expect((await storage.readFile(bad)).ok).toBe(false)
      expect(await storage.readFile(bad)).toMatchObject({ ok: false, reason: 'invalid-path' })
    }
  })

  it('8MB 单文件上限拒绝；文件只在显式 deleteFile 时删除', async () => {
    const { storage, files, deletions } = mockStorage()
    const big = 'x'.repeat(8 * 1024 * 1024 + 1)
    expect(await storage.writeFile('big.json', big)).toMatchObject({ ok: false, reason: 'too-large' })
    expect(files.has('big.json')).toBe(false)
    expect((await storage.writeFile('ok.json', 'v')).ok).toBe(true)
    expect(deletions).toEqual([])
    expect((await storage.deleteFile('ok.json')).ok).toBe(true)
    expect(deletions).toEqual(['ok.json'])
  })
})

describe('惰性装载与 revision 代次', () => {
  it('首次访问才落盘出厂三文件；revision 从 0 起、写操作递增', async () => {
    const mock = mockStorage()
    const { service } = newService(mock)
    expect(mock.files.size).toBe(0) // 构造不触发 IO
    const snap = await service.ensureLoaded()
    expect(snap.revision).toBe(0)
    expect(snap.builtin).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect([...mock.files.keys()].sort()).toEqual(
      [BUILTIN_RULES_FILE, RULE_STATE_FILE, USER_RULES_FILE].sort(),
    )
    const id = await service.addUserRule({ trigger: 'x', replacement: 'X' })
    expect(id).toMatch(/^user-/)
    expect(service.revision).toBe(1)
    expect((await service.ensureLoaded()).user).toHaveLength(1)
  })

  it('ensureLoaded 只 init 一次（后续读缓存），并发调用共享同一次装载', async () => {
    const mock = mockStorage()
    const { service } = newService(mock)
    const [a, b] = await Promise.all([service.ensureLoaded(), service.ensureLoaded()])
    expect(a).toEqual(b)
    const before = mock.files.get(BUILTIN_RULES_FILE)
    await service.ensureLoaded()
    expect(mock.files.get(BUILTIN_RULES_FILE)).toBe(before) // 未重写
  })
})

describe('写拒绝下的降级（too-large / error / invalid-path 语义消费）', () => {
  it('writeFile 拒绝：mutate 返回失败、revision 不增、缓存不变', async () => {
    const mock = mockStorage()
    const { service } = newService(mock)
    await service.ensureLoaded()
    mock.failWrites.add(USER_RULES_FILE)
    expect(await service.addUserRule({ trigger: 'x', replacement: 'X' })).toBeNull()
    expect(service.revision).toBe(0)
    expect((await service.ensureLoaded()).user).toHaveLength(0)
    mock.failWrites.delete(USER_RULES_FILE)
    expect(await service.addUserRule({ trigger: 'x', replacement: 'X' })).toMatch(/^user-/)
    expect(service.revision).toBe(1)
  })

  it('readFile 拒绝（error）且文件在场：装载拒绝不降级种写（C-R4-1 语义升级——旧「按不存在重写出厂」正是被消灭的覆盖面）', async () => {
    const mock = mockStorage({ [BUILTIN_RULES_FILE]: '[]' })
    mock.failReads.add(BUILTIN_RULES_FILE)
    const { service } = newService(mock)
    await expect(service.ensureLoaded()).rejects.toThrow('rules-storage-unreadable')
    expect(mock.files.get(BUILTIN_RULES_FILE)).toBe('[]')
  })
})

describe('导入载荷上限（审查 C-P3-4：大载荷同步 parse 阻塞与装载后逐键遍历放大的防御）', () => {
  it('content 超 2MB（字符数）→ JSON.parse 前拒绝 too-large：不落盘、不增 revision', async () => {
    const mock = mockStorage()
    const { service } = newService(mock)
    await service.ensureLoaded()
    // 超限载荷同时是非法 JSON：parse 前拦截证明（先进 parse 会返回 invalid-json）
    const huge = 'x'.repeat(IMPORT_CONTENT_MAX_LENGTH + 1)
    expect(await service.applyMutation({ op: 'importUserRules', content: huge })).toEqual({
      ok: false,
      reason: 'too-large',
    })
    expect(service.revision).toBe(0)
    expect((await service.ensureLoaded()).user).toHaveLength(0)
  })

  it('规则条数超上限拒绝 too-many-rules；恰在上限内的批量正常受理', async () => {
    const mock = mockStorage()
    const { service } = newService(mock)
    await service.ensureLoaded()
    const rule = (i: number): { trigger: string; replacement: string } => ({
      trigger: `t${i}`,
      replacement: `r${i}`,
    })
    // 恰 5000 条：受理（全为新规则，计数 imported=5000）
    const atLimit = JSON.stringify(Array.from({ length: IMPORT_MAX_RULES }, (_, i) => rule(i)))
    expect(await service.applyMutation({ op: 'importUserRules', content: atLimit })).toMatchObject({
      ok: true,
      imported: IMPORT_MAX_RULES,
    })
    expect(service.revision).toBe(1)
    // 超 1 条：拒绝、数据不变
    const overLimit = JSON.stringify(Array.from({ length: IMPORT_MAX_RULES + 1 }, (_, i) => rule(i)))
    expect(await service.applyMutation({ op: 'importUserRules', content: overLimit })).toEqual({
      ok: false,
      reason: 'too-many-rules',
    })
    expect(service.revision).toBe(1)
    expect((await service.ensureLoaded()).user).toHaveLength(IMPORT_MAX_RULES)
  })
})

describe('外部文件变化自动重载（onDidChangeFile 消费，上游 onConfigFileChange 语义）', () => {
  it('外部改写 user-rules.json：1s 去抖后重读新内容 + revision 递增', async () => {
    const mock = mockStorage()
    const { service, scheduler } = newService(mock)
    await service.ensureLoaded()
    mock.tick(2000) // 跳出 init 落盘出厂的自写抑制窗口
    mock.files.set(USER_RULES_FILE, JSON.stringify([{ id: 'user-ext', trigger: 'ext', replacement: 'E' }]))
    mock.emit(USER_RULES_FILE, 'change')
    expect(service.revision).toBe(0) // 去抖窗口内未生效
    await scheduler.firePending()
    expect(service.revision).toBe(1)
    expect((await service.ensureLoaded()).user).toEqual([{ id: 'user-ext', trigger: 'ext', replacement: 'E' }])
  })

  it('自写抑制：mutate 后 2s 内的文件事件忽略（上游 lastSaveTime 判据）', async () => {
    const mock = mockStorage()
    const { service, scheduler } = newService(mock)
    await service.ensureLoaded()
    await service.addUserRule({ trigger: 'x', replacement: 'X' })
    // 写后即时事件（平台对自写也回调）→ 抑制
    mock.emit(USER_RULES_FILE, 'change')
    await scheduler.firePending()
    expect(service.revision).toBe(1) // 仅 mutate 的一次

    // 2s 后的外部事件恢复响应
    mock.tick(2000)
    mock.emit(USER_RULES_FILE, 'change')
    await scheduler.firePending()
    expect(service.revision).toBe(2)
  })

  it('非规则文件的事件忽略；delete 事件同样触发重载（builtin 删除 → 恢复出厂）', async () => {
    const mock = mockStorage()
    const { service, scheduler } = newService(mock)
    await service.ensureLoaded()
    mock.emit('unrelated.json', 'change')
    await scheduler.firePending()
    expect(service.revision).toBe(0)

    mock.tick(2000) // 跳出 init 落盘的自写抑制窗口
    mock.files.delete(BUILTIN_RULES_FILE)
    mock.emit(BUILTIN_RULES_FILE, 'delete')
    await scheduler.firePending()
    expect(service.revision).toBe(1)
    const snap = await service.ensureLoaded()
    expect(snap.builtin).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(mock.files.has(BUILTIN_RULES_FILE)).toBe(true)
  })

  it('去抖合并：窗口内多次事件只重载一次', async () => {
    const mock = mockStorage()
    const { service, scheduler } = newService(mock)
    await service.ensureLoaded()
    mock.tick(2000) // 跳出 init 落盘的自写抑制窗口
    mock.emit(USER_RULES_FILE, 'change')
    mock.emit(BUILTIN_RULES_FILE, 'change')
    mock.emit(RULE_STATE_FILE, 'change')
    await scheduler.firePending()
    expect(service.revision).toBe(1)
    expect(scheduler.pending.filter((t) => !t.cancelled)).toHaveLength(0)
  })
})

describe('停用与释放（停用不删数据）', () => {
  it('dispose：注销 watcher、清去抖计时器；不删任何文件（数据随重装仍在）', async () => {
    const mock = mockStorage()
    const { service, scheduler } = newService(mock)
    await service.ensureLoaded()
    await service.addUserRule({ trigger: 'x', replacement: 'X' })
    const userContent = mock.files.get(USER_RULES_FILE)!
    const builtinContent = mock.files.get(BUILTIN_RULES_FILE)!

    // 释放前制造一个挂起的去抖重载（外部事件、未被抑制）
    mock.tick(2000)
    mock.emit(USER_RULES_FILE, 'change')
    expect(scheduler.pending.filter((t) => !t.cancelled)).toHaveLength(1)

    service.dispose()
    expect(mock.deletions).toEqual([]) // 停用不删数据
    expect(mock.files.get(USER_RULES_FILE)).toBe(userContent)
    expect(mock.files.get(BUILTIN_RULES_FILE)).toBe(builtinContent)
    // 去抖计时器已清理：悬挂回调不再触发重载
    expect(scheduler.pending.filter((t) => !t.cancelled)).toHaveLength(0)
    expect(service.revision).toBe(1)

    // watcher 已注销：外部事件不再驱动重载
    mock.emit(USER_RULES_FILE, 'change')
    await scheduler.firePending()
    expect(service.revision).toBe(1)
    service.dispose() // 重复 dispose 无害
  })
})

describe('存储读失败防护与 init 自愈（审查第 4 轮 C-R4-1 / C-R4-5）', () => {
  it('读失败但在场：ensureLoaded 拒绝且不覆盖文件；故障解除后下次调用自愈重试', async () => {
    const original = JSON.stringify([{ trigger: 'x', replacement: 'X', id: 'user-keep' }], null, 2)
    const mock = mockStorage({ [USER_RULES_FILE]: original })
    mock.failReads.add(USER_RULES_FILE)
    const { service } = newService(mock)

    // 在场读失败 → 装载拒绝，磁盘原样（旧实现会把 user-rules.json 覆盖写为 []）
    await expect(service.ensureLoaded()).rejects.toThrow('rules-storage-unreadable')
    expect(mock.files.get(USER_RULES_FILE)).toBe(original)

    // 故障解除：initPromise 不滞留 rejected 态，下次调用重新装载成功
    mock.failReads.delete(USER_RULES_FILE)
    const snapshot = await service.ensureLoaded()
    expect(snapshot.user).toHaveLength(1)
    expect(snapshot.user[0]).toMatchObject({ id: 'user-keep' })
  })

  it('真不在场（fresh 目录）：正常种写出厂与空用户规则', async () => {
    const mock = mockStorage()
    const { service } = newService(mock)
    const snapshot = await service.ensureLoaded()
    expect(snapshot.builtin).toHaveLength(DEFAULT_BUILTIN_RULES.length)
    expect(snapshot.user).toEqual([])
    expect(mock.files.has(USER_RULES_FILE)).toBe(true)
  })

  it('并发 mutate 串行化（审查 B-R4-6）：两条并发 addUserRule 都持久化，无读-改-写丢更新', async () => {
    const mock = mockStorage()
    // 写加一拍宏任务延迟——确定复现旧竞争窗口：B 在 A 的写 await 间隙基于
    // 旧缓存构造数组，旧实现 A 的结果被 B 覆盖（只存一条）
    const delayedStorage: typeof mock.storage = {
      ...mock.storage,
      writeFile: async (path, content) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return mock.storage.writeFile(path, content)
      },
    }
    const { service } = newService({ ...mock, storage: delayedStorage })
    await service.ensureLoaded()
    await Promise.all([
      service.applyMutation({ op: 'addUserRule', rule: { trigger: 'a', replacement: 'A' } }),
      service.applyMutation({ op: 'addUserRule', rule: { trigger: 'b', replacement: 'B' } }),
    ])
    const snapshot = await service.ensureLoaded()
    expect(snapshot.user.map((r) => r.trigger).sort()).toEqual(['a', 'b'])
  })
})
