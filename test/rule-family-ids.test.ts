// 规则 → 覆盖行为族映射（#50 灰态判定的纯函数面）：映射单一事实源在
// src/rules/rule-family-ids.ts（注册侧 ruleBehaviorIntercept 同源消费），
// 本文件钉住归族矩阵与出厂内置规则全覆盖契约（新增内置规则漏登记即红）。
import { describe, expect, it } from 'vitest'
import {
  ALL_RULE_FAMILY_SEEDS,
  RULE_DELETE_SELECTKEY_FAMILY_SEEDS,
  RULE_INPUT_FAMILY_SEEDS,
  coveringBehaviorLocalIds,
} from '../src/rules/rule-family-ids'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import type { SimpleRule } from '../src/rules/rule-engine'

function mkRule(partial: Partial<SimpleRule>): SimpleRule {
  return { trigger: 'x', replacement: 'y', ...partial }
}

describe('coveringBehaviorLocalIds（规则 → 覆盖行为族）', () => {
  it('内置规则按种子 ruleIds 查表（单族）', () => {
    expect(
      coveringBehaviorLocalIds(mkRule({ id: 'builtin-fw2hw-double' }), true),
    ).toEqual(['01-punct-collapse'])
    expect(
      coveringBehaviorLocalIds(mkRule({ id: 'builtin-autopair-jump' }), true),
    ).toEqual(['02-autopair'])
    expect(
      coveringBehaviorLocalIds(mkRule({ id: 'builtin-sel-wrap-quotes' }), true),
    ).toEqual(['07-selectkey-rules'])
  })

  it('未知内置 id 回退按触发类归族（防御深度；出厂全覆盖由下方契约钉住）', () => {
    expect(coveringBehaviorLocalIds(mkRule({ id: 'builtin-unknown-new' }), true)).toEqual(
      RULE_INPUT_FAMILY_SEEDS.map((s) => s.localId),
    )
  })

  it('用户规则按触发类归族：Input → 五 Input 族、Delete → 06、SelectKey → 07', () => {
    expect(coveringBehaviorLocalIds(mkRule({ id: 'user-1' }), false)).toEqual(
      ['01-punct-collapse', '02-autopair', '03-symbol-convert', '04-punct-expand', '05-quote'],
    )
    expect(
      coveringBehaviorLocalIds(mkRule({ id: 'user-2', options: 'd' }), false),
    ).toEqual(['06-delete-rules'])
    expect(
      coveringBehaviorLocalIds(mkRule({ id: 'user-3', options: 's' }), false),
    ).toEqual(['07-selectkey-rules'])
  })

  it('契约：出厂内置规则全部映射到至少一个族（防新增内置规则漏登记）', () => {
    for (const rule of DEFAULT_BUILTIN_RULES) {
      const covering = coveringBehaviorLocalIds(rule, true)
      expect(covering.length, `内置规则 ${rule.id} 无覆盖族`).toBeGreaterThan(0)
      // 查表命中 = 单族（内置规则不按类型归多族）
      expect(covering.length, `内置规则 ${rule.id} 命中多族`).toBe(1)
    }
  })

  it('族 localId 唯一且按 01–07 数值前缀编码（默认链序）', () => {
    const localIds = ALL_RULE_FAMILY_SEEDS.map((s) => s.localId)
    expect(new Set(localIds).size).toBe(localIds.length)
    expect(localIds).toEqual([...localIds].sort())
    expect(localIds).toHaveLength(7)
    expect(RULE_INPUT_FAMILY_SEEDS).toHaveLength(5)
    expect(RULE_DELETE_SELECTKEY_FAMILY_SEEDS).toHaveLength(2)
  })

  it('种子 ruleIds 并集恰为出厂内置规则全集（两侧互证无孤儿）', () => {
    const seeded = new Set(RULE_INPUT_FAMILY_SEEDS.flatMap((s) => s.ruleIds).concat(
      RULE_DELETE_SELECTKEY_FAMILY_SEEDS.flatMap((s) => s.ruleIds),
    ))
    const factory = new Set(DEFAULT_BUILTIN_RULES.map((r) => r.id))
    expect(seeded).toEqual(factory)
  })
})
