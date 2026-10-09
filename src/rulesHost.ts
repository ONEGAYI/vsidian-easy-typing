// 宿主侧规则服务（工单 #14）：把 RuleStore 纯逻辑接到平台 AddonStorageFacet
// （storage 在宿主侧、组件单写点），并提供外部文件变化自动重载与 revision
// 代次。
//
// 【架构位】上游 RuleManager 与引擎同在插件（宿主侧）；本平台引擎在页面
// （每个编辑器 webview 一份），宿主侧只做数据权威——页面经 RULES_TOPIC
// 拉取快照自行 loadFromFiles，写操作经 mutate 通道进宿主单点执行。
// 本模块是平台接线层（import vendor 类型），故置 src/ 平铺不入 src/rules/
// （#1 契约：src/rules 下零平台依赖，import 扫描钉住）。
//
// 【外部重载】上游 main.ts onConfigFileChange（L252-272）语义：
// - 自写抑制：Date.now() - lastSaveTime < 2000 的事件忽略（平台对自写
//   也会回调 onDidChangeFile）；
// - 去抖 1s 合并窗口内多次事件；
// - 重载 = 重跑 init（文件被删则恢复出厂种子），revision++ 供页面轮询感知。
import type {
  AddonStorageFacet,
  AddonStorageWatchHandle,
} from '../types/vendor/shared/addonStorage'
import type { AddonChannelRegistry } from '../types/vendor/host/addons/addonRegistry'
import { RuleStore, type RuleStoreIo, type RulesSnapshot } from './rules/rule-store'
import type { SimpleRule } from './rules/rule-engine'
import type { RulesMutateResult } from './rules/rules-protocol'
import {
  IMPORT_CONTENT_MAX_LENGTH,
  IMPORT_MAX_RULES,
  RULES_TOPIC,
  parseRulesMutatePayload,
} from './rules/rules-protocol'

/** 上游 configReloadTimer 的 1 秒去抖 */
const RELOAD_DEBOUNCE_MS = 1000
/** 上游 lastSaveTime 判据的 2 秒自写抑制窗口 */
const SELF_WRITE_SUPPRESS_MS = 2000

export interface HostRulesServiceOptions {
  /** 时钟注入（自写抑制判据；测试确定性） */
  now?: () => number
  /** 去抖调度注入（回调可返回 Promise，测试据此等待重载完成；缺省全局 setTimeout） */
  setTimeout?: (fn: () => void | Promise<void>, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

/** AddonStorageFacet → RuleStoreIo 适配（拒绝码折叠为 null/false，fail-safe） */
function adaptStorageIo(storage: AddonStorageFacet): RuleStoreIo {
  return {
    readText: async (path) => {
      const result = await storage.readFile(path)
      return result.ok ? result.value : null
    },
    writeText: async (path, content) => {
      const result = await storage.writeFile(path, content)
      return result.ok
    },
    list: async () => {
      const result = await storage.list()
      return result.ok
        ? result.entries.filter((e) => e.kind === 'file').map((e) => e.path)
        : null
    },
  }
}

export class HostRulesService {
  readonly store: RuleStore
  /** 数据代次：init 装载为 0，每次成功写与外部重载各 +1（页面轮询比对面） */
  revision = 0

  private readonly storage: AddonStorageFacet
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly cancelSchedule: (handle: unknown) => void
  private initPromise: Promise<void> | null = null
  private reloadHandle: unknown = null
  private readonly watchHandle: AddonStorageWatchHandle
  private disposed = false

  constructor(storage: AddonStorageFacet, options: HostRulesServiceOptions = {}) {
    this.storage = storage
    this.now = options.now ?? Date.now
    this.schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancelSchedule = options.clearTimeout ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]))
    this.store = new RuleStore(adaptStorageIo(storage), { now: this.now })
    this.watchHandle = storage.onDidChangeFile((relativePath) => this.onFileChange(relativePath))
  }

  // ===== 装载 =====

  /** 惰性装载（并发共享同一次 init）；返回三份数据快照 + 当前代次。
   * init 失败不留滞 rejected 态——下次调用重新装载（审查第 4 轮 C-R4-5） */
  async ensureLoaded(): Promise<RulesSnapshot & { revision: number }> {
    if (!this.initPromise) {
      const attempt = this.store.init()
      this.initPromise = attempt.catch((err: unknown) => {
        this.initPromise = null
        throw err
      })
    }
    await this.initPromise
    return { ...this.store.getSnapshot(), revision: this.revision }
  }

  /** 当前代次（轻量轮询端点，不触发装载） */
  getRevision(): { revision: number } {
    return { revision: this.revision }
  }

  // ===== 写操作（成功才 bump revision） =====

  async addUserRule(rule: SimpleRule): Promise<string | null> {
    await this.ensureLoaded()
    const id = await this.store.addUserRule(rule)
    if (id !== null) this.revision++
    return id
  }

  async updateUserRule(id: string, rule: SimpleRule): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.updateUserRule(id, rule))
  }

  async deleteUserRule(id: string): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.deleteUserRule(id))
  }

  async updateBuiltinRule(id: string, rule: SimpleRule): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.updateBuiltinRule(id, rule))
  }

  async toggleRuleEnabled(id: string, isBuiltin: boolean, enabled: boolean): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.toggleRuleEnabled(id, isBuiltin, enabled))
  }

  async reorderUserRule(fromIndex: number, toIndex: number): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.reorderUserRule(fromIndex, toIndex))
  }

  async updateRuleTriggerMode(id: string, isBuiltin: boolean, tabMode: boolean): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.updateRuleTriggerMode(id, isBuiltin, tabMode))
  }

  async deleteBuiltinRule(id: string): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.deleteBuiltinRule(id))
  }

  async restoreBuiltinRule(id: string): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.restoreBuiltinRule(id))
  }

  async resetAllBuiltinRules(): Promise<boolean> {
    await this.ensureLoaded()
    return this.record(await this.store.resetAllBuiltinRules())
  }

  async importUserRules(
    incoming: readonly unknown[],
  ): Promise<{ imported: number; skipped: number; persisted: boolean }> {
    await this.ensureLoaded()
    const result = await this.store.importUserRules(incoming)
    if (result.persisted) this.revision++
    return result
  }

  /** 导出用户规则 JSON 字符串（触发装载以取缓存） */
  async exportUserRules(): Promise<string> {
    await this.ensureLoaded()
    return this.store.exportUserRules()
  }

  /** 组件数据目录 URI（同步工具配置展示） */
  storageUri(): string {
    return this.storage.uri()
  }

  // ===== mutate 分发（channel handler 的业务体） =====

  /** mutate 串行队列（审查 B-R4-6）：UI 连点开关/连续拖拽下两次 mutate 的
   * 通道往返重叠时，宿主 async handler 会在 store 写的 await 间隙基于旧缓存
   * 处理下一个请求（读-改-写竞争，先完成的写被后写覆盖）。队列化逐笔串行，
   * 单次失败不断链。 */
  private mutateQueue: Promise<unknown> = Promise.resolve()

  async applyMutation(payload: unknown): Promise<RulesMutateResult> {
    const parsed = parseRulesMutatePayload(payload)
    if (!parsed) return { ok: false, reason: 'invalid-payload' }
    const run = this.mutateQueue.then(() => this.runMutation(parsed))
    this.mutateQueue = run.catch(() => {
      /* 队列只保顺序不传播失败——单笔结果经 run 返回给调用方 */
    })
    return run
  }

  private async runMutation(
    parsed: NonNullable<ReturnType<typeof parseRulesMutatePayload>>,
  ): Promise<RulesMutateResult> {
    const okResult = (): RulesMutateResult => ({ ok: true, revision: this.revision })
    const failResult = (): RulesMutateResult => ({ ok: false, reason: 'io-failed' })
    switch (parsed.op) {
      case 'addUserRule': {
        const id = await this.addUserRule(parsed.rule)
        return id ? { ok: true, id, revision: this.revision } : failResult()
      }
      case 'updateUserRule':
        return (await this.updateUserRule(parsed.id, parsed.rule)) ? okResult() : failResult()
      case 'deleteUserRule':
        return (await this.deleteUserRule(parsed.id)) ? okResult() : failResult()
      case 'updateBuiltinRule':
        return (await this.updateBuiltinRule(parsed.id, parsed.rule)) ? okResult() : failResult()
      case 'toggleRuleEnabled':
        return (await this.toggleRuleEnabled(parsed.id, parsed.isBuiltin, parsed.enabled))
          ? okResult()
          : failResult()
      case 'reorderUserRule':
        return (await this.reorderUserRule(parsed.fromIndex, parsed.toIndex))
          ? okResult()
          : failResult()
      case 'updateRuleTriggerMode':
        return (await this.updateRuleTriggerMode(parsed.id, parsed.isBuiltin, parsed.tabMode))
          ? okResult()
          : failResult()
      case 'deleteBuiltinRule':
        return (await this.deleteBuiltinRule(parsed.id)) ? okResult() : failResult()
      case 'restoreBuiltinRule':
        return (await this.restoreBuiltinRule(parsed.id)) ? okResult() : failResult()
      case 'resetAllBuiltinRules':
        return (await this.resetAllBuiltinRules()) ? okResult() : failResult()
      case 'importUserRules': {
        // 载荷上限（审查 C-P3-4）：content 长度在 JSON.parse 之前判定
        //（大载荷同步 parse 阻塞宿主线程的防线；通道载荷可来自任意页面
        // 请求，宿主是权威防线）
        if (parsed.content.length > IMPORT_CONTENT_MAX_LENGTH) {
          return { ok: false, reason: 'too-large' }
        }
        let incoming: unknown
        try {
          incoming = JSON.parse(parsed.content)
        } catch {
          return { ok: false, reason: 'invalid-json' }
        }
        if (!Array.isArray(incoming)) return { ok: false, reason: 'invalid-json' }
        // 条数上限：拦「装载后每键遍历放大」的极端批量（引擎逐键执行的
        // 累积开销）
        if (incoming.length > IMPORT_MAX_RULES) {
          return { ok: false, reason: 'too-many-rules' }
        }
        const result = await this.importUserRules(incoming)
        return { ok: result.persisted, ...result, revision: this.revision }
      }
    }
  }

  // ===== 外部变化重载与释放 =====

  private onFileChange(relativePath: string): void {
    if (this.disposed) return
    // 只关心三个规则文件（相对路径可能带子目录，取末段文件名比对）
    const filename = relativePath.split('/').pop() ?? ''
    if (
      filename !== 'builtin-rules.json' &&
      filename !== 'user-rules.json' &&
      filename !== 'rule-state.json'
    ) {
      return
    }
    // 自写抑制（上游 lastSaveTime 判据；change 与 delete 同判据）
    if (this.now() - this.store.lastSaveTime < SELF_WRITE_SUPPRESS_MS) return
    if (this.reloadHandle !== null) this.cancelSchedule(this.reloadHandle)
    this.reloadHandle = this.schedule(() => {
      this.reloadHandle = null
      return this.reload()
    }, RELOAD_DEBOUNCE_MS)
  }

  private async reload(): Promise<void> {
    if (this.disposed) return
    this.initPromise = null // 作废已装载态，强制重走 init（文件被删则恢复出厂）
    await this.ensureLoaded()
    this.revision++
  }

  /** 释放：注销 watcher、清去抖计时器（停用/故障时代次内平台统一注销的组件侧配合） */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.reloadHandle !== null) {
      this.cancelSchedule(this.reloadHandle)
      this.reloadHandle = null
    }
    this.watchHandle.dispose()
  }

  private record(ok: boolean): boolean {
    if (ok) this.revision++
    return ok
  }
}

/**
 * 规则通道装配（extension.ts 在 setup 中调用；照 #3 registerSettingsChannels
 * 模式）。同 topic 重复注册会被平台拒绝——每代次只装配一次。
 */
export function registerRulesChannels(
  channel: AddonChannelRegistry,
  service: HostRulesService,
): void {
  channel.handle(RULES_TOPIC.get, () => service.ensureLoaded())
  channel.handle(RULES_TOPIC.revision, () => service.getRevision())
  channel.handle(RULES_TOPIC.mutate, (payload) => service.applyMutation(payload))
  channel.handle(RULES_TOPIC.exportUser, async () => ({ content: await service.exportUserRules() }))
  channel.handle(RULES_TOPIC.storageUri, () => ({ uri: service.storageUri() }))
}
