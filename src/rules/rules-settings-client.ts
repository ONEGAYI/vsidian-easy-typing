// 设置页规则数据客户端（工单 #16）：设置页 mountRoot 自绘 UI 的数据面——
// 快照装载、mutate 动作分发与「写后刷新」（每次成功变更重拉快照驱动重渲
// 染，策略说明落 docs/specs/rules-ui.md）。零 DOM 依赖（视图层
// src/rulesUi.ts 只消费状态与动作），通道形状复用编辑器页客户端的
// RulesChannelLike（sdk.channel.request 的注入形态）。
//
// 【刷新策略决策】写后刷新而非 revision 轮询：设置页面板隐藏即销毁
// （平台装载器语义），外部同步工具改写文件的可见性由「重开页面装载」
// 覆盖；页面存活期内的一切变更都经本客户端（mutate 成功 → revision 返回
// → 立即整拉），无需再付轮询成本。
import type { SimpleRule } from './rule-engine'
import { RULES_TOPIC } from './rules-protocol'
import type { RulesChannelLike } from './rules-page'

/** 设置页持有的规则数据态（get 快照 + 装载标记） */
export interface RulesSettingsState {
  loaded: boolean
  revision: number
  builtin: SimpleRule[]
  user: SimpleRule[]
  deletedBuiltinRuleIds: string[]
}

export interface RulesSettingsClientOptions {
  channel: RulesChannelLike
  /** 状态变化通知（load 与每次写后刷新；视图层据此重渲染） */
  onStateChange?: (state: RulesSettingsState) => void
}

/** 动作结果：成功或业务拒绝码（通道层失败折叠为 channel-failed） */
export type RulesActionResult = { ok: true } | { ok: false; reason: string }

/** 导入结果（业务计数展开：imported=0 且 skipped>0 亦算成功动作） */
export interface RulesImportResult {
  imported: number
  skipped: number
}

function initialState(): RulesSettingsState {
  return { loaded: false, revision: -1, builtin: [], user: [], deletedBuiltinRuleIds: [] }
}

/** mutate 通道结果的业务形状（宿主 RulesMutateResult + 通道包裹层） */
interface MutateOutcome {
  ok?: boolean
  reason?: string
  id?: string
  imported?: number
  skipped?: number
  persisted?: boolean
}

export class RulesSettingsClient {
  state: RulesSettingsState = initialState()
  /** 新建规则后宿主分配的 id（增量提示用；load 刷新后以快照为准） */
  lastCreatedId: string | null = null

  private readonly channel: RulesChannelLike
  private readonly notify: (state: RulesSettingsState) => void
  /** 构造后追加的监听（视图可在自身装配完成后再订阅） */
  private readonly listeners: Array<(state: RulesSettingsState) => void> = []

  constructor(options: RulesSettingsClientOptions) {
    this.channel = options.channel
    this.notify = options.onStateChange ?? (() => {})
  }

  /** 追加状态监听（返回注销函数）；与构造期 onStateChange 并存 */
  onStateChange(listener: (state: RulesSettingsState) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }

  private setState(next: RulesSettingsState): void {
    this.state = next
    this.notify(next)
    for (const listener of [...this.listeners]) {
      try {
        listener(next)
      } catch {
        // 监听异常不阻断数据链（对齐 PageRulesClient.onReload 容忍语义）
      }
    }
  }

  /** 拉取快照（页面装载与每次写后刷新共用入口）；失败保持原状返回 false */
  async load(): Promise<boolean> {
    const outcome = await this.channel.request(RULES_TOPIC.get, null)
    if (!outcome.ok) return false
    const raw = outcome.result
    if (typeof raw !== 'object' || raw === null) return false
    const rec = raw as Record<string, unknown>
    if (typeof rec['revision'] !== 'number') return false
    if (!Array.isArray(rec['builtin']) || !Array.isArray(rec['user'])) return false
    if (!Array.isArray(rec['deletedBuiltinRuleIds'])) return false
    this.setState({
      loaded: true,
      revision: rec['revision'],
      builtin: rec['builtin'] as SimpleRule[],
      user: rec['user'] as SimpleRule[],
      deletedBuiltinRuleIds: rec['deletedBuiltinRuleIds'] as string[],
    })
    return true
  }

  /** mutate 通用路径：发 op → 成功后整拉（写后刷新）并归一结果 */
  private async mutate(payload: unknown): Promise<RulesActionResult> {
    const outcome = await this.channel.request(RULES_TOPIC.mutate, payload)
    if (!outcome.ok) return { ok: false, reason: 'channel-failed' }
    const raw = outcome.result
    const result: MutateOutcome =
      typeof raw === 'object' && raw !== null ? (raw as MutateOutcome) : {}
    if (result.ok !== true) return { ok: false, reason: result.reason ?? 'io-failed' }
    await this.load()
    return { ok: true }
  }

  async addUserRule(rule: SimpleRule): Promise<RulesActionResult> {
    const outcome = await this.channel.request(RULES_TOPIC.mutate, {
      op: 'addUserRule',
      rule,
    })
    if (!outcome.ok) return { ok: false, reason: 'channel-failed' }
    const result =
      typeof outcome.result === 'object' && outcome.result !== null
        ? (outcome.result as MutateOutcome)
        : {}
    if (result.ok !== true) return { ok: false, reason: result.reason ?? 'io-failed' }
    this.lastCreatedId = result.id ?? null
    await this.load()
    return { ok: true }
  }

  updateUserRule(id: string, rule: SimpleRule): Promise<RulesActionResult> {
    return this.mutate({ op: 'updateUserRule', id, rule })
  }

  deleteUserRule(id: string): Promise<RulesActionResult> {
    return this.mutate({ op: 'deleteUserRule', id })
  }

  /** 用户规则启用开关（内置规则逐条开关不在此页，口径 #1/#3） */
  toggleUserRuleEnabled(id: string, enabled: boolean): Promise<RulesActionResult> {
    return this.mutate({ op: 'toggleRuleEnabled', id, isBuiltin: false, enabled })
  }

  /** 内置规则停用 = deleteBuiltinRule（deletedBuiltinRuleIds 语义） */
  disableBuiltinRule(id: string): Promise<RulesActionResult> {
    return this.mutate({ op: 'deleteBuiltinRule', id })
  }

  restoreBuiltinRule(id: string): Promise<RulesActionResult> {
    return this.mutate({ op: 'restoreBuiltinRule', id })
  }

  resetAllBuiltinRules(): Promise<RulesActionResult> {
    return this.mutate({ op: 'resetAllBuiltinRules' })
  }

  /** 用户规则拖拽排序（from/to 为 splice 语义索引；换算归 rules-ui-model） */
  reorderUserRule(fromIndex: number, toIndex: number): Promise<RulesActionResult> {
    return this.mutate({ op: 'reorderUserRule', fromIndex, toIndex })
  }

  /**
   * 导入用户规则（content 为 JSON 字符串，解析与去重在宿主单写点）：
   * 返回 null = 载荷非法（invalid-json / 通道失败）；否则返回计数——
   * imported=0 且 skipped>0（全重复/全非法）亦是完成动作，文案区分归
   * UI 层（宿主对「写入失败」与「全部跳过」同形 {imported:0, persisted:
   * false}，按 #14 契约如实展示计数）。
   */
  async importUserRules(content: string): Promise<RulesImportResult | null> {
    // 本地预检：提前拦下非 JSON/非数组（宿主同样会拒，这里省一轮往返并给即时反馈）
    try {
      const parsed: unknown = JSON.parse(content)
      if (!Array.isArray(parsed)) return null
    } catch {
      return null
    }
    const outcome = await this.channel.request(RULES_TOPIC.mutate, {
      op: 'importUserRules',
      content,
    })
    if (!outcome.ok) return null
    const result =
      typeof outcome.result === 'object' && outcome.result !== null
        ? (outcome.result as MutateOutcome)
        : {}
    if (result.reason === 'invalid-json') return null
    if (result.imported === undefined) return null // 形状防御（非 import 结果）
    if (result.persisted === true) await this.load()
    return { imported: result.imported, skipped: result.skipped ?? 0 }
  }

  /** 导出用户规则 JSON 字符串；失败返回 null */
  async exportUserRules(): Promise<string | null> {
    const outcome = await this.channel.request(RULES_TOPIC.exportUser, null)
    if (!outcome.ok) return null
    const raw = outcome.result
    if (typeof raw !== 'object' || raw === null) return null
    const content = (raw as Record<string, unknown>)['content']
    return typeof content === 'string' ? content : null
  }

  /** 组件数据目录 URI（同步工具提示展示）；失败返回 null */
  async storageUri(): Promise<string | null> {
    const outcome = await this.channel.request(RULES_TOPIC.storageUri, null)
    if (!outcome.ok) return null
    const raw = outcome.result
    if (typeof raw !== 'object' || raw === null) return null
    const uri = (raw as Record<string, unknown>)['uri']
    return typeof uri === 'string' ? uri : null
  }
}
