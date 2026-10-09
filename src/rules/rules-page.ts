// 页面侧规则客户端（工单 #14）：编辑器页的规则数据消费面——拉取宿主快照
// 装载引擎（引擎在页面），并周期轮询 revision 代次，外部同步工具改写或
// 宿主侧 mutate 引起的代次变化自动重拉重装（上游 vault.on('raw') 自动
// 重载的平台等价物：页面无宿主推送通道，轮询轻量端点对齐官方样例的
// 「拉取 + 惰性刷新」模式）。
//
// 【消费形态】#25 行为链接入时经 client.engine.process(ctx) 消费；本票交付
// 装载/重载数据链（page-editor.ts 接线），规则管理 UI 归 #16。
import { RuleEngine, type SimpleRule } from './rule-engine'
import { RULES_TOPIC } from './rules-protocol'

/** 页面侧通道面（sdk.channel.request 的注入形态） */
export interface RulesChannelLike {
  request(
    topic: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ): Promise<{ ok: true; result: unknown } | { ok: false; reason: string }>
}

export interface PageRulesSnapshot {
  revision: number
  builtin: SimpleRule[]
  user: SimpleRule[]
  /** 已删内置规则 id 清单（升级补种不再恢复；builtin 数组本身已不含这些
   * 条目——deleteBuiltinRule 从文件移除。行为族消费 builtin/user 即可，
   * 此字段为快照完整性保留（审查 B-F1 修复时对齐宿主 get 返回形状）） */
  deletedBuiltinRuleIds: string[]
}

export interface PageRulesClientOptions {
  channel: RulesChannelLike
  /** 装载目标引擎（每编辑器页一份，与 CM6 共享运行时同生命周期） */
  engine: RuleEngine
  /** 代次轮询间隔（缺省 2000ms） */
  pollIntervalMs?: number
  /** 每次成功装载/重载后回调（快照只读；异常吞掉不打断轮询） */
  onReload?: (snapshot: PageRulesSnapshot) => void
  /** 定时器注入（测试确定性；缺省全局 setInterval/clearInterval） */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

/** get 端点结果校验（宿主是本组件自己的 channel，形状防御即可） */
function parseGetResult(result: unknown): PageRulesSnapshot | null {
  if (typeof result !== 'object' || result === null) return null
  const raw = result as Record<string, unknown>
  if (typeof raw['revision'] !== 'number') return null
  if (!Array.isArray(raw['builtin']) || !Array.isArray(raw['user'])) return null
  const deleted = raw['deletedBuiltinRuleIds']
  return {
    revision: raw['revision'],
    builtin: raw['builtin'] as SimpleRule[],
    user: raw['user'] as SimpleRule[],
    deletedBuiltinRuleIds:
      Array.isArray(deleted) && deleted.every((i) => typeof i === 'string') ? [...deleted] : [],
  }
}

export class PageRulesClient {
  readonly engine: RuleEngine
  /** 当前已装载的代次（-1 = 从未装载成功） */
  revision = -1

  private readonly channel: RulesChannelLike
  private readonly pollIntervalMs: number
  private readonly onReload: ((snapshot: PageRulesSnapshot) => void) | undefined
  private readonly startTimer: (fn: () => void, ms: number) => unknown
  private readonly stopTimer: (handle: unknown) => void
  private timerHandle: unknown = null

  constructor(options: PageRulesClientOptions) {
    this.channel = options.channel
    this.engine = options.engine
    this.pollIntervalMs = options.pollIntervalMs ?? 2000
    this.onReload = options.onReload
    this.startTimer = options.setInterval ?? ((fn, ms) => setInterval(fn, ms))
    this.stopTimer = options.clearInterval ?? ((handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]))
  }

  /** 拉取快照并重装引擎；通道失败/形状非法 → false，引擎保持原状 */
  async load(): Promise<boolean> {
    const outcome = await this.channel.request(RULES_TOPIC.get, null)
    if (!outcome.ok) return false
    const snapshot = parseGetResult(outcome.result)
    if (!snapshot) return false
    this.engine.loadFromFiles(snapshot.builtin, snapshot.user)
    this.revision = snapshot.revision
    try {
      this.onReload?.(snapshot)
    } catch {
      // 回调异常不阻断数据链
    }
    return true
  }

  /** 单轮代次检查：revision 变化才整拉重装（失败容忍，下轮再试） */
  async poll(): Promise<void> {
    const outcome = await this.channel.request(RULES_TOPIC.revision, null)
    if (!outcome.ok) return
    const result = outcome.result as { revision?: unknown } | null
    if (typeof result !== 'object' || result === null) return
    if (typeof result.revision !== 'number') return
    if (result.revision !== this.revision) await this.load()
  }

  /** 启动轮询（重复调用无害） */
  startWatch(): void {
    if (this.timerHandle !== null) return
    this.timerHandle = this.startTimer(() => {
      void this.poll()
    }, this.pollIntervalMs)
  }

  /** 停止轮询（sdk.onDispose 时调用；重复调用无害） */
  stopWatch(): void {
    if (this.timerHandle === null) return
    this.stopTimer(this.timerHandle)
    this.timerHandle = null
  }
}
