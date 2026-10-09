// 规则存储纯逻辑（工单 #14）：上游 rule_manager.ts（254 行）的数据面移植。
// 持久化形态与上游一致——builtin-rules.json / user-rules.json 均为
// SimpleRule[] 顶层 JSON（缩进 2），便于导入导出与外部同步工具直读直写。
//
// 【与上游的三处映射差异】（其余语义对照移植）：
// 1. 引擎同步操作剥离：上游 RuleManager 持有 ruleEngine 并在增删改时同步
//    镜像；本平台引擎在页面侧（宿主是单写点，只管数据文件——页面拉取
//    快照后自行 loadFromFiles 重装引擎，见 src/rules/rules-page.ts）；
// 2. deletedBuiltinRuleIds 从上游 settings.json 迁到 rule-state.json
//    （#3 映射表：富结构不进设置 schema，归 storage JSON；出厂种子取
//    settings/defaults.ts 的 RICH_STRUCTURE_DEFAULTS.deletedBuiltinRuleIds）；
// 3. 出厂 description 不做本地化替换（上游 getLocalizedBuiltinRules 按当前
//    语言包改写 description；展示层本地化归 #16/#19，存储保持 #1 数据原样）。
//
// 【写路径一致性】上游「先改缓存后写文件」在写失败时缓存与文件失配；本
// 模块改为「构造新数组 → 写成功才替换缓存」——storage 是权威，缓存是镜像。
// 另有两处幂等收窄（deleteBuiltinRule 对不存在 id 不记 deletedIds、
// restoreBuiltinRule 不重复追加），均在方法注释标注。
//
// IO 全注入（RuleStoreIo），零平台依赖；宿主接线见 rules-host.ts。
import { RuleEngine, isFunctionReplacementRef, type SimpleRule } from './rule-engine'
import { DEFAULT_BUILTIN_RULES } from './default-rules'

/** 内置规则文件（相对组件数据目录，正斜杠） */
export const BUILTIN_RULES_FILE = 'builtin-rules.json'
/** 用户规则文件 */
export const USER_RULES_FILE = 'user-rules.json'
/** 规则伴随状态（deletedBuiltinRuleIds 等；上游存 settings，此处独立成文件） */
export const RULE_STATE_FILE = 'rule-state.json'

/** 存储访问面（宿主侧由 AddonStorageFacet 适配；测试用内存 mock） */
export interface RuleStoreIo {
  /** 读 UTF-8 文本；不存在或读取失败返回 null */
  readText(path: string): Promise<string | null>
  /** 覆盖写 UTF-8 文本；返回是否成功（8MB 上限等拒绝 → false） */
  writeText(path: string, content: string): Promise<boolean>
  /** 列数据目录一层文件路径；失败返回 null——种子写入前判别「不在场」与「读失败」用 */
  list(): Promise<readonly string[] | null>
}

// ===== 校验管线 =====

/** SimpleRule 的可选字符串字段（序列化形态中这些键合法；未知键丢弃） */
const SIMPLE_RULE_STRING_KEYS = [
  'id',
  'trigger',
  'trigger_right',
  'options',
  'description',
  'scope_language',
  'regex_flags',
] as const

/**
 * 项级宽松校验（#17 收口）：对象 + trigger 为字符串 + replacement 为合法
 * 形态（字符串字面量或函数引用对象 `{kind:'function', ref}`）即放行，
 * 已知字段浅拷贝、未知字段丢弃。**不查函数表**——存储层只管声明性数据
 * 的形状（fork 组件可扩展函数表后存入本表之外的 ref）；ref 是否存在、
 * 签名是否匹配由引擎装载时查表校验并 reportError（拒绝装载）。
 * 遗留字符串函数体（F 旗标 + 字符串）在存储侧原样保留：数据不丢，
 * 装载侧拒绝并上报，用户可在 UI 改选预注册函数。非法项返回 null。
 */
export function sanitizeSimpleRule(value: unknown): SimpleRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw['trigger'] !== 'string') return null
  const rule: Record<string, unknown> = {}
  for (const key of SIMPLE_RULE_STRING_KEYS) {
    const v = raw[key]
    if (typeof v === 'string') rule[key] = v
  }
  // replacement 双形态：字符串字面量原样；函数引用对象浅拷贝 kind/ref
  const replacement = raw['replacement']
  if (typeof replacement === 'string') {
    rule['replacement'] = replacement
  } else if (isFunctionReplacementRef(replacement)) {
    rule['replacement'] = { kind: 'function', ref: replacement.ref }
  } else {
    return null
  }
  if (typeof raw['enabled'] === 'boolean') rule['enabled'] = raw['enabled']
  if (typeof raw['priority'] === 'number' && Number.isFinite(raw['priority'])) {
    rule['priority'] = raw['priority']
  }
  // 上面已保证 trigger 为字符串，此处仅收窄类型
  return rule as unknown as SimpleRule
}

/**
 * 规则文件解析：损坏 JSON / 非数组顶层明确拒绝（调用方回退空数组并按
 * 「文件存在」分支处理——上游 loadRulesFile catch 回 [] 的等价物）；
 * 数组内非法项丢弃、合法项保留（外部同步工具引入脏数据的防御深度）。
 */
export function parseRulesFileContent(
  content: string,
): { rules: SimpleRule[] } | { error: 'invalid-json' | 'not-array' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { error: 'invalid-json' }
  }
  if (!Array.isArray(parsed)) return { error: 'not-array' }
  return { rules: parsed.map(sanitizeSimpleRule).filter((r): r is SimpleRule => r !== null) }
}

// ===== 迁移（上游 migrateRulesFiles：老基目录 → 新基目录拷贝） =====

export async function migrateRulesFiles(
  io: RuleStoreIo,
  oldBase: string,
  newBase: string,
): Promise<void> {
  if (oldBase === newBase) return
  for (const filename of [BUILTIN_RULES_FILE, USER_RULES_FILE]) {
    const content = await io.readText(`${oldBase}/${filename}`)
    if (content === null) continue // 老文件不存在，跳过
    await io.writeText(`${newBase}/${filename}`, content)
  }
}

// ===== RuleStore =====

export interface RuleStoreOptions {
  /** 用户规则 id 工厂（缺省上游形态 user-${Date.now()}-${rand4}） */
  generateUserId?: () => string
  /** 时钟注入（lastSaveTime 与 watcher 自写抑制用；测试确定性） */
  now?: () => number
}

export interface RulesSnapshot {
  builtin: SimpleRule[]
  user: SimpleRule[]
  deletedBuiltinRuleIds: string[]
}

export class RuleStore {
  cachedBuiltinRules: SimpleRule[] = []
  cachedUserRules: SimpleRule[] = []
  deletedBuiltinRuleIds: string[] = []
  /** 最近一次本实例写规则文件的时间戳（宿主 watcher 自写抑制判据） */
  lastSaveTime = 0

  private readonly generateUserId: () => string
  private readonly now: () => number

  constructor(
    private readonly io: RuleStoreIo,
    options: RuleStoreOptions = {},
    private readonly defaults: (SimpleRule & { id: string })[] = DEFAULT_BUILTIN_RULES,
  ) {
    this.generateUserId =
      options.generateUserId ??
      (() => `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    this.now = options.now ?? Date.now
  }

  // ===== 内部：写路径（成功才替换缓存） =====

  private async saveBuiltinRules(rules: SimpleRule[]): Promise<boolean> {
    const ok = await this.io.writeText(BUILTIN_RULES_FILE, JSON.stringify(rules, null, 2))
    if (ok) {
      this.lastSaveTime = this.now()
      this.cachedBuiltinRules = rules
    }
    return ok
  }

  private async saveUserRules(rules: SimpleRule[]): Promise<boolean> {
    const ok = await this.io.writeText(USER_RULES_FILE, JSON.stringify(rules, null, 2))
    if (ok) {
      this.lastSaveTime = this.now()
      this.cachedUserRules = rules
    }
    return ok
  }

  private async saveState(): Promise<boolean> {
    const ok = await this.io.writeText(
      RULE_STATE_FILE,
      JSON.stringify({ deletedBuiltinRuleIds: this.deletedBuiltinRuleIds }, null, 2),
    )
    if (ok) this.lastSaveTime = this.now()
    return ok
  }

  private parseFile(content: string): SimpleRule[] {
    const parsed = parseRulesFileContent(content)
    return 'error' in parsed ? [] : parsed.rules
  }

  // ===== 装载与重载 =====

  /**
   * 装载/重载（上游 initRuleEngine 数据面；外部文件变化后重跑同入口）：
   * state → builtin（不存在写出厂；存在则按出厂补种，尊重已删清单）→
   * user（不存在写空）。写失败全部容忍（缓存回空，不抛错——fail-safe）；
   * 读失败且文件在场（list 判别）则抛错不动盘——防 IO 瞬时失败把种子
   * 写当清空写覆盖用户数据（审查第 4 轮 C-R4-1）。
   */
  async init(): Promise<void> {
    const present = await this.io.list()
    const filePresent = (path: string): boolean =>
      present === null ? true : present.includes(path) // list 失败按在场保守处理
    const requireAbsent = async (path: string): Promise<boolean> => {
      if (filePresent(path)) throw new Error(`rules-storage-unreadable: ${path}`)
      return true
    }

    const stateContent = await this.io.readText(RULE_STATE_FILE)
    if (stateContent === null) {
      await requireAbsent(RULE_STATE_FILE)
      this.deletedBuiltinRuleIds = []
      await this.saveState() // 空目录伴随落盘（停用重装后数据可观测）
    } else {
      try {
        const parsed = JSON.parse(stateContent) as { deletedBuiltinRuleIds?: unknown }
        this.deletedBuiltinRuleIds =
          Array.isArray(parsed.deletedBuiltinRuleIds) &&
          parsed.deletedBuiltinRuleIds.every((i) => typeof i === 'string')
            ? [...parsed.deletedBuiltinRuleIds]
            : []
      } catch {
        this.deletedBuiltinRuleIds = []
      }
    }

    const builtinContent = await this.io.readText(BUILTIN_RULES_FILE)
    if (builtinContent === null) {
      await requireAbsent(BUILTIN_RULES_FILE)
      await this.saveBuiltinRules(this.defaults.map((r) => ({ ...r })))
    } else {
      const current = this.parseFile(builtinContent)
      const existingIds = new Set(current.map((r) => r.id).filter(Boolean))
      const newRules = this.defaults.filter(
        (r) => !existingIds.has(r.id) && !this.deletedBuiltinRuleIds.includes(r.id),
      )
      if (newRules.length > 0) {
        await this.saveBuiltinRules([...current, ...newRules.map((r) => ({ ...r }))])
      } else {
        this.cachedBuiltinRules = current
      }
    }

    const userContent = await this.io.readText(USER_RULES_FILE)
    if (userContent === null) {
      await requireAbsent(USER_RULES_FILE)
      await this.saveUserRules([])
    } else {
      this.cachedUserRules = this.parseFile(userContent)
    }
  }

  // ===== 用户规则增删改 =====

  /** 新增用户规则：强制分配新 id（上游同语义——传入 id 不信任） */
  async addUserRule(rule: SimpleRule): Promise<string | null> {
    const id = this.generateUserId()
    const ok = await this.saveUserRules([...this.cachedUserRules, { ...rule, id }])
    return ok ? id : null
  }

  async updateUserRule(id: string, rule: SimpleRule): Promise<boolean> {
    const idx = this.cachedUserRules.findIndex((r) => r.id === id)
    if (idx === -1) return false
    return this.saveUserRules(
      this.cachedUserRules.map((r, i) => (i === idx ? { ...rule, id } : r)),
    )
  }

  async deleteUserRule(id: string): Promise<boolean> {
    if (!this.cachedUserRules.some((r) => r.id === id)) return false
    return this.saveUserRules(this.cachedUserRules.filter((r) => r.id !== id))
  }

  // ===== 导入导出 =====

  /** 导入去重键（上游 getImportDedupKey 原样） */
  private getImportDedupKey(rule: SimpleRule): string {
    const isRegex = (rule.options ?? '').includes('r')
    const normalizedFlags = isRegex ? RuleEngine.normalizeRegexFlags(rule.regex_flags) : ''
    return `${rule.trigger}\0${rule.trigger_right ?? ''}\0${isRegex}\0${normalizedFlags}`
  }

  /**
   * 批量导入：缺 trigger/replacement 与去重键命中计入 skipped（上游语义）；
   * 入参先过校验管线（外部文件不可信）。写失败时缓存不动、persisted=false。
   */
  async importUserRules(
    incoming: readonly unknown[],
  ): Promise<{ imported: number; skipped: number; persisted: boolean }> {
    const existingSet = new Set(this.cachedUserRules.map((r) => this.getImportDedupKey(r)))
    const additions: SimpleRule[] = []
    let skipped = 0
    for (const raw of incoming) {
      const rule = sanitizeSimpleRule(raw)
      if (!rule || !rule.trigger || rule.replacement === undefined) {
        skipped++
        continue
      }
      const key = this.getImportDedupKey(rule)
      if (existingSet.has(key)) {
        skipped++
        continue
      }
      existingSet.add(key)
      additions.push({ ...rule, id: this.generateUserId(), enabled: rule.enabled ?? true })
    }
    if (additions.length === 0) return { imported: 0, skipped, persisted: false }
    const ok = await this.saveUserRules([...this.cachedUserRules, ...additions])
    if (!ok) return { imported: 0, skipped, persisted: false }
    return { imported: additions.length, skipped, persisted: true }
  }

  /** 导出为 JSON 字符串（缩进 2；UI 与文件下载归 #16） */
  exportUserRules(): string {
    return JSON.stringify(this.cachedUserRules, null, 2)
  }

  // ===== 内置规则管理 =====

  /**
   * 删除内置规则：文件移除 + deletedIds 落 state（升级补种时不再恢复）。
   * 幂等收窄（上游无判定，重复删仍记 deletedIds）：id 不在缓存 → false。
   */
  async deleteBuiltinRule(id: string): Promise<boolean> {
    if (!this.cachedBuiltinRules.some((r) => r.id === id)) return false
    const ok = await this.saveBuiltinRules(this.cachedBuiltinRules.filter((r) => r.id !== id))
    if (!ok) return false
    // state 写失败回滚内存（与「写成功才替换缓存」同原则——审查第 4 轮 C-R4-4：
    // builtin 与 state 是两次独立写，失败时内存回到与磁盘一致，下次成功写不残留）
    const prevDeleted = this.deletedBuiltinRuleIds
    this.deletedBuiltinRuleIds = [...this.deletedBuiltinRuleIds, id]
    const stateOk = await this.saveState()
    if (!stateOk) this.deletedBuiltinRuleIds = prevDeleted
    return stateOk
  }

  /**
   * 恢复内置规则：按出厂数据回填 + state 移除。幂等收窄（上游无条件
   * push，重复恢复会产生重复条目）：已在位且不在 deletedIds → 仅返回 true。
   */
  async restoreBuiltinRule(id: string): Promise<boolean> {
    const defaultRule = this.defaults.find((r) => r.id === id)
    if (!defaultRule) return false
    const inPlace =
      this.cachedBuiltinRules.some((r) => r.id === id) &&
      !this.deletedBuiltinRuleIds.includes(id)
    if (!inPlace) {
      const ok = await this.saveBuiltinRules([...this.cachedBuiltinRules, { ...defaultRule }])
      if (!ok) return false
    }
    if (this.deletedBuiltinRuleIds.includes(id)) {
      // state 写失败回滚内存（C-R4-4 同款：内存与磁盘 state 保持一致）
      const prevDeleted = this.deletedBuiltinRuleIds
      this.deletedBuiltinRuleIds = this.deletedBuiltinRuleIds.filter((i) => i !== id)
      const stateOk = await this.saveState()
      if (!stateOk) this.deletedBuiltinRuleIds = prevDeleted
      return stateOk
    }
    return true
  }

  /** 全量重置内置规则：恢复出厂 + 清空 deletedIds（上游 resetAllBuiltinRules） */
  async resetAllBuiltinRules(): Promise<boolean> {
    const ok = await this.saveBuiltinRules(this.defaults.map((r) => ({ ...r })))
    if (!ok) return false
    // state 写失败回滚内存（C-R4-4 同款）
    const prevDeleted = this.deletedBuiltinRuleIds
    this.deletedBuiltinRuleIds = []
    const stateOk = await this.saveState()
    if (!stateOk) this.deletedBuiltinRuleIds = prevDeleted
    return stateOk
  }

  async updateBuiltinRule(id: string, rule: SimpleRule): Promise<boolean> {
    const idx = this.cachedBuiltinRules.findIndex((r) => r.id === id)
    if (idx === -1) return false
    return this.saveBuiltinRules(
      this.cachedBuiltinRules.map((r, i) => (i === idx ? { ...rule, id } : r)),
    )
  }

  // ===== 开关 / 排序 / 触发模式 =====

  async toggleRuleEnabled(id: string, isBuiltin: boolean, enabled: boolean): Promise<boolean> {
    const cache = isBuiltin ? this.cachedBuiltinRules : this.cachedUserRules
    const idx = cache.findIndex((r) => r.id === id)
    if (idx === -1) return false
    const next = cache.map((r, i) => (i === idx ? { ...r, enabled } : r))
    return isBuiltin ? this.saveBuiltinRules(next) : this.saveUserRules(next)
  }

  async reorderUserRule(fromIndex: number, toIndex: number): Promise<boolean> {
    if (fromIndex === toIndex) return false
    if (fromIndex < 0 || fromIndex >= this.cachedUserRules.length) return false
    if (toIndex < 0 || toIndex >= this.cachedUserRules.length) return false
    const next = [...this.cachedUserRules]
    const [rule] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, rule!)
    return this.saveUserRules(next)
  }

  /** Tab 触发模式切换：T 旗标增删、options 空串归 undefined（上游同语义） */
  async updateRuleTriggerMode(id: string, isBuiltin: boolean, tabMode: boolean): Promise<boolean> {
    const cache = isBuiltin ? this.cachedBuiltinRules : this.cachedUserRules
    const idx = cache.findIndex((r) => r.id === id)
    if (idx === -1) return false
    const next = cache.map((r, i) => {
      if (i !== idx) return r
      let opts = r.options ?? ''
      if (tabMode && !opts.includes('T')) opts += 'T'
      else if (!tabMode) opts = opts.replace(/T/g, '')
      return { ...r, options: opts || undefined }
    })
    return isBuiltin ? this.saveBuiltinRules(next) : this.saveUserRules(next)
  }

  // ===== 快照 =====

  /** 三份数据快照（每次新数组，页面装载与 #16 UI 的读取面） */
  getSnapshot(): RulesSnapshot {
    return {
      builtin: [...this.cachedBuiltinRules],
      user: [...this.cachedUserRules],
      deletedBuiltinRuleIds: [...this.deletedBuiltinRuleIds],
    }
  }
}
