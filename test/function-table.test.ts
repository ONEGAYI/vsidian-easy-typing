// 预注册函数表矩阵（工单 #17）：src/rules/function-table.ts 的 10 条真函数
// 与上游 easy-typing-obsidian v6.0.9 src/default_rules.ts 内置函数体规则
// 逐条对照——直接调用钉住参数面（leftMatches/rightMatches 或
// selectionText/key）与返回串（$n / [[n]] / ${SEL} 标记原样，展开与
// tabstop 解析归引擎后处理链）。端到端命中矩阵（触发/不触发/边界）在
// rules-matrix.test.ts 经完整引擎覆盖，本文件钉函数本体与数据完整性。
import { describe, expect, it } from 'vitest'
import {
  FUNCTION_TABLE,
  FUNCTION_TABLE_BY_REF,
  signatureKindForRuleType,
  type SelectKeyTransformFn,
  type TextTransformFn,
} from '../src/rules/function-table'
import { RuleEngine, RuleScope, RuleType } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'

function textFn(ref: string): TextTransformFn {
  const entry = FUNCTION_TABLE_BY_REF.get(ref)
  expect(entry, `ref ${ref} 应在场`).toBeDefined()
  expect(entry!.signature).toBe('text')
  return entry!.fn as TextTransformFn
}

function selectKeyFn(ref: string): SelectKeyTransformFn {
  const entry = FUNCTION_TABLE_BY_REF.get(ref)
  expect(entry, `ref ${ref} 应在场`).toBeDefined()
  expect(entry!.signature).toBe('selectKey')
  return entry!.fn as SelectKeyTransformFn
}

describe('数据完整性', () => {
  it('10 条条目、ref 唯一、签名分布 7 text + 3 selectKey', () => {
    expect(FUNCTION_TABLE).toHaveLength(10)
    expect(new Set(FUNCTION_TABLE.map((e) => e.ref)).size).toBe(10)
    const bySig = { text: 0, selectKey: 0 } as Record<string, number>
    for (const entry of FUNCTION_TABLE) bySig[entry.signature]!++
    expect(bySig).toEqual({ text: 7, selectKey: 3 })
    expect(FUNCTION_TABLE_BY_REF.size).toBe(10)
  })

  it('内置 F 旗标规则全部为引用形态且 ref 在表、签名与规则类型配对', () => {
    const fnRules = DEFAULT_BUILTIN_RULES.filter(
      (r) => (r.options ?? '').includes('F'),
    )
    expect(fnRules).toHaveLength(10)
    for (const rule of fnRules) {
      expect(typeof rule.replacement, `${rule.id} 应为引用形态`).toBe('object')
      const ref = rule.replacement as { kind: string; ref: string }
      expect(ref.kind).toBe('function')
      const entry = FUNCTION_TABLE_BY_REF.get(ref.ref)
      expect(entry, `${rule.id} 的 ref ${ref.ref} 不在函数表`).toBeDefined()
      const type = RuleEngine.parseOptions(rule.options).type
      expect(entry!.signature, `${rule.id} 签名失配`).toBe(
        signatureKindForRuleType(type),
      )
    }
  })

  it('signatureKindForRuleType：SelectKey → selectKey，Input/Delete → text', () => {
    expect(signatureKindForRuleType(RuleType.SelectKey)).toBe('selectKey')
    expect(signatureKindForRuleType(RuleType.Input)).toBe('text')
    expect(signatureKindForRuleType(RuleType.Delete)).toBe('text')
  })
})

describe('autopairInput（上游 builtin-autopair-input）', () => {
  const fn = textFn('autopairInput')
  it('开符号 → 配对补全（$0 落配对间）；闭符号映射到对应开符号', () => {
    expect(fn(['（'], [])).toBe('（$0）')
    expect(fn(['「'], [])).toBe('「$0」')
    expect(fn(['”'], [])).toBe('“$0”')
    expect(fn(['’'], [])).toBe('‘$0’')
  })
  it('表外字符 → undefined（触发正则外，规则跳过）', () => {
    expect(fn(['('], [])).toBeUndefined()
  })
})

describe('autopairJump（上游 builtin-autopair-jump）', () => {
  const fn = textFn('autopairJump')
  it('右侧恰为配对端 → 吃掉重复右符（返回原配对）', () => {
    expect(fn(['《》'], ['》'])).toBe('《》')
    expect(fn(['（）'], ['）'])).toBe('（）')
    expect(fn(['““'], ['”'])).toBe('“”')
  })
  it('右侧不是配对端 → undefined（放弃跳过，落穿后续规则）', () => {
    expect(fn(['《》'], ['」'])).toBeUndefined()
  })
})

describe('autopairDelete（上游 builtin-autopair-delete）', () => {
  const fn = textFn('autopairDelete')
  it('开符号与右侧闭符号配对 → 空串（连带删除）', () => {
    expect(fn(['【'], ['】'])).toBe('')
    expect(fn(['“'], ['”'])).toBe('')
  })
  it('不配对 → undefined（不删除）', () => {
    expect(fn(['【'], ['）'])).toBeUndefined()
  })
})

describe('convFormula（上游 builtin-conv-formula）', () => {
  const fn = textFn('convFormula')
  it('右侧无 $ → 行内公式占位（$$0$）', () => {
    expect(fn(['￥￥'], [''])).toBe('$$0$')
  })
  it('右侧恰为 $ → 块级公式（真实换行，$0 居中）', () => {
    expect(fn(['￥￥'], ['$'])).toBe('$$\n$0\n$$')
  })
})

describe('convLinestart（上游 builtin-conv-linestart）', () => {
  const fn = textFn('convLinestart')
  it('》 → 引用标记（[[1]] 回行首前缀）；、 → 斜杠（上游无尾随空格怪癖原样）', () => {
    // 触发正则 (^|\n)([》、])：[0] 全匹配、[1] 行首前缀、[2] 符号
    expect(fn(['\n》', '\n', '》'], [])).toBe('[[1]]> $0')
    expect(fn(['》', '', '》'], [])).toBe('[[1]]> $0')
    expect(fn(['\n、', '\n', '、'], [])).toBe('[[1]]/$0')
  })
})

describe('convHw2fw（上游 builtin-conv-hw2fw）', () => {
  const fn = textFn('convHw2fw')
  it('CJK + 半角标点 → 全角（( 产出全角配对括号）', () => {
    expect(fn(['好,', '好', ','], [])).toBe('好，')
    expect(fn(['好(', '好', '('], [])).toBe('好（$0）')
    expect(fn(['好.', '好', '.'], [])).toBe('好。')
  })
})

describe('fw2hwDouble（上游 builtin-fw2hw-double）', () => {
  const fn = textFn('fw2hwDouble')
  it('连续两相同全角标点 → 半角（$0 尾随）', () => {
    expect(fn(['。。', '。'], [''])).toBe('.$0')
    expect(fn(['《《', '《'], [''])).toBe('<$0')
  })
  it('右侧恰为配对端（（ 前） → 吃掉右端产出 ()', () => {
    expect(fn(['（（', '（'], ['）'])).toBe('($0)')
    expect(fn(['《《', '《'], ['》'])).toBe('<$0')
  })
})

describe('selWrap 系（上游 builtin-sel-wrap-*，SelectKey 签名）', () => {
  it('symbols：【→[]、¥/￥→$$（${0:${SEL}} 覆盖选区）', () => {
    const fn = selectKeyFn('selWrapSymbols')
    expect(fn('abc', '【')).toBe('[${0:${SEL}}]')
    expect(fn('abc', '¥')).toBe('$${0:${SEL}}$')
    expect(fn('abc', '￥')).toBe('$${0:${SEL}}$')
  })
  it('quotes：全角引号配对包裹（闭引号键也映射到同对开闭）', () => {
    const fn = selectKeyFn('selWrapQuotes')
    expect(fn('abc', '“')).toBe('“${0:${SEL}}”')
    expect(fn('abc', '”')).toBe('“${0:${SEL}}”')
    expect(fn('abc', '‘')).toBe('‘${0:${SEL}}’')
  })
  it('cjk-brackets：《（）配对包裹', () => {
    const fn = selectKeyFn('selWrapCjkBrackets')
    expect(fn('abc', '《')).toBe('《${0:${SEL}}》')
    expect(fn('abc', '（')).toBe('（${0:${SEL}}）')
  })
})

describe('端到端冒烟（函数表 → 引擎装载 → process 命中）', () => {
  it('引用规则经默认表注入执行（含捕获组消费与 $0 解析）', () => {
    const engine = new RuleEngine()
    engine.addSimpleRules(DEFAULT_BUILTIN_RULES)
    // fw2hwDouble 消费 leftMatches[1]/rightMatches[0]；autopair 消费 leftMatches[0]
    expect(
      engine.process({
        kind: RuleType.Input,
        docText: '。。',
        selection: { from: 2, to: 2 },
        inserted: '',
        changeType: 'input.type',
        scopeHint: RuleScope.All,
      }),
    ).toMatchObject({ newText: '.', cursor: 1 })
  })
})
