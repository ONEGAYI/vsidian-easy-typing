// 规则通道协议（工单 #14）：宿主 ↔ 页面共用 topic 常量、载荷类型与校验。
// 模式对齐 #3 的 SETTINGS_TOPIC（src/settings/store.ts）——宿主经
// ctx.channel.handle 注册（extension.ts），页面经 sdk.channel.request 消费。
// 页面侧无直接 IO（平台不提供页面读写 API），全部经本协议桥接宿主
// ctx.storage 单写点。
import type { SimpleRule } from './rule-engine'
import { sanitizeSimpleRule } from './rule-store'

/** 规则通道 topic（setup scope；载荷形状见各 handler 注释） */
export const RULES_TOPIC = {
  /** 拉取：null → { revision, builtin, user, deletedBuiltinRuleIds } */
  get: 'easyTyping.rules.get',
  /** 轻量轮询：null → { revision }（页面周期比对，变化才整拉重装引擎） */
  revision: 'easyTyping.rules.revision',
  /** 变更：payload RulesMutatePayload → RulesMutateResult（业务拒绝在 result 内） */
  mutate: 'easyTyping.rules.mutate',
  /** 导出用户规则：null → { content }（JSON 字符串，缩进 2；UI 与下载归 #16） */
  exportUser: 'easyTyping.rules.exportUser',
  /** 组件数据目录 URI：null → { uri }（同步工具配置展示用） */
  storageUri: 'easyTyping.rules.storageUri',
} as const

/** 变更载荷（rule 字段在 parseRulesMutatePayload 内经 sanitizeSimpleRule 清洗） */
export type RulesMutatePayload =
  | { op: 'addUserRule'; rule: SimpleRule }
  | { op: 'updateUserRule'; id: string; rule: SimpleRule }
  | { op: 'deleteUserRule'; id: string }
  | { op: 'updateBuiltinRule'; id: string; rule: SimpleRule }
  | { op: 'toggleRuleEnabled'; id: string; isBuiltin: boolean; enabled: boolean }
  | { op: 'reorderUserRule'; fromIndex: number; toIndex: number }
  | { op: 'updateRuleTriggerMode'; id: string; isBuiltin: boolean; tabMode: boolean }
  | { op: 'deleteBuiltinRule'; id: string }
  | { op: 'restoreBuiltinRule'; id: string }
  | { op: 'resetAllBuiltinRules' }
  | { op: 'importUserRules'; content: string }

/** 变更结果（业务级拒绝；通道层自身的 rejected/timeout 由平台包裹） */
export interface RulesMutateResult {
  ok: boolean
  reason?: 'invalid-payload' | 'invalid-json' | 'io-failed'
  /** 成功时的最新代次 */
  revision?: number
  /** addUserRule 成功时的新 id */
  id?: string
  /** importUserRules 的计数（含写失败时的 persisted: false） */
  imported?: number
  skipped?: number
  persisted?: boolean
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * mutate 载荷校验（channel 入参不可信面）：形状与字段类型逐 op 校验，
 * rule 字段经 sanitizeSimpleRule 清洗（未知字段丢弃、函数体宽松放行）。
 * 非法载荷返回 null（handler 回 invalid-payload）。
 */
export function parseRulesMutatePayload(payload: unknown): RulesMutatePayload | null {
  if (!isPlainObject(payload)) return null
  const op = payload['op']
  switch (op) {
    case 'addUserRule': {
      const rule = sanitizeSimpleRule(payload['rule'])
      return rule ? { op, rule } : null
    }
    case 'updateUserRule':
    case 'updateBuiltinRule': {
      const rule = sanitizeSimpleRule(payload['rule'])
      return rule && isNonEmptyString(payload['id']) ? { op, id: payload['id'], rule } : null
    }
    case 'deleteUserRule':
    case 'deleteBuiltinRule':
    case 'restoreBuiltinRule':
      return isNonEmptyString(payload['id']) ? { op, id: payload['id'] } : null
    case 'toggleRuleEnabled':
      return isNonEmptyString(payload['id']) &&
        typeof payload['isBuiltin'] === 'boolean' &&
        typeof payload['enabled'] === 'boolean'
        ? { op, id: payload['id'], isBuiltin: payload['isBuiltin'], enabled: payload['enabled'] }
        : null
    case 'reorderUserRule':
      return (
        typeof payload['fromIndex'] === 'number' && Number.isInteger(payload['fromIndex']) &&
        typeof payload['toIndex'] === 'number' && Number.isInteger(payload['toIndex'])
      )
        ? { op, fromIndex: payload['fromIndex'], toIndex: payload['toIndex'] }
        : null
    case 'updateRuleTriggerMode':
      return isNonEmptyString(payload['id']) &&
        typeof payload['isBuiltin'] === 'boolean' &&
        typeof payload['tabMode'] === 'boolean'
        ? { op, id: payload['id'], isBuiltin: payload['isBuiltin'], tabMode: payload['tabMode'] }
        : null
    case 'resetAllBuiltinRules':
      return { op }
    case 'importUserRules':
      return typeof payload['content'] === 'string' ? { op, content: payload['content'] } : null
    default:
      return null
  }
}
