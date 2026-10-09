// onInput → 规则引擎触发管线测试（工单 #25）：AddonInputContext（结构
// 子集，userEvent 原样保留）→ TxContext → RuleEngine.process（Input 类）
// → {changes, selection} 计划。票面三场景（标点转换 / 括号补全 / 中英
// 空格基线）以真实内置规则数据（DEFAULT_BUILTIN_RULES）驱动——「真实
// 引擎 + 模拟 AddonInputContext」的集成级承载（真实 webview 端到端归
// #21 人工验证）。上游对照 rule_processor.ts triggerCvtRule 与
// cm_extensions.ts tryProcessInput 的规则触发段。
import { describe, expect, it } from 'vitest'
import { RuleEngine, type SimpleRule } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import {
  applyResultToPlan,
  pipelineConsumesUserEvent,
  planInputRuleModification,
  type RuleInputPipelineContext,
} from '../src/ruleBehaviorPipeline'

/** 按内置规则 id 集构造引擎（族拆分在 intercept 层，本文件按需拼装） */
function engineOf(ruleIds: readonly string[]): RuleEngine {
  const rules = DEFAULT_BUILTIN_RULES.filter((r) => ruleIds.includes(r.id))
  expect(rules.length, `规则 id 应全部命中：${ruleIds.join(',')}`).toBe(ruleIds.length)
  const engine = new RuleEngine()
  engine.addSimpleRules(rules)
  return engine
}

/** 模拟 AddonInputContext（快照已含本次输入；LF 坐标） */
function inputCtx(
  text: string,
  cursor: number,
  userEvent = 'input.type',
  inputText = '',
  selections: Array<{ anchor: number; head: number }> = [{ anchor: cursor, head: cursor }],
): RuleInputPipelineContext {
  return { userEvent, inputText, snapshot: { text, selections } }
}

// ===== 票面场景 1：标点转换（fw2hw-double，真实内置规则） =====

describe('管线集成：标点转换（builtin-fw2hw-double）', () => {
  const engine = engineOf(['builtin-fw2hw-double'])

  it('连续两个全角句号 → 半角（$0 为 #1 已知边界保留的字面标记）', () => {
    // 输入第二个 。 后快照：docText 。。、光标 2
    const plan = planInputRuleModification(engine, inputCtx('。。', 2, 'input.type', '。'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 2, text: '.$0' }],
      selection: { anchor: 3, head: 3 },
    })
  })

  it('IME 定稿（input.type.compose）同样驱动——compose 事务直接消费（#6 挂接点）', () => {
    const plan = planInputRuleModification(engine, inputCtx('。。', 2, 'input.type.compose', '。'))
    expect(plan?.changes[0]?.text).toBe('.$0')
  })

  it('单个全角句号不触发', () => {
    expect(planInputRuleModification(engine, inputCtx('。', 1, 'input.type', '。'))).toBeNull()
  })
})

// ===== 票面场景 2：括号补全（autopair 族，真实内置规则） =====

describe('管线集成：括号补全（builtin-autopair-input / builtin-autopair-jump）', () => {
  const engine = engineOf(['builtin-autopair-jump', 'builtin-autopair-input'])

  it('输入（ → 补全配对（替换体 $0 同为字面标记）', () => {
    const plan = planInputRuleModification(engine, inputCtx('（', 1, 'input.type', '（'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '（$0）' }],
      selection: { anchor: 4, head: 4 },
    })
  })

  it('已有配对时输入右侧符号 → 跳过重复（jump 规则优先级 5 先于 input 10）', () => {
    // 《|》 键入 》 → 快照《》》，光标 2：替换回《》
    const plan = planInputRuleModification(engine, inputCtx('《》》', 2, 'input.type', '》'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 3, text: '《》' }],
      selection: { anchor: 2, head: 2 },
    })
  })
})

// ===== 票面场景 3：中英空格基线（规则面不承载，归 #26 格式化管线） =====

describe('管线集成：中英空格基线', () => {
  const engine = engineOf(DEFAULT_BUILTIN_RULES.map((r) => r.id))

  it('中文后键入半角字母 → 规则引擎零命中返回 null（空格插入归 #26 消费同一管线入口）', () => {
    expect(planInputRuleModification(engine, inputCtx('中文a', 3, 'input.type', 'a'))).toBeNull()
  })

  it('全量 20 条内置规则装载下普通英文输入不产生任何修饰', () => {
    expect(planInputRuleModification(engine, inputCtx('plain text', 10, 'input.type', 't'))).toBeNull()
  })
})

// ===== 触发面门控 =====

describe('userEvent 门控（Input 类触发面）', () => {
  it('仅消费 input.type 与 input.type.compose', () => {
    expect(pipelineConsumesUserEvent('input.type')).toBe(true)
    expect(pipelineConsumesUserEvent('input.type.compose')).toBe(true)
    expect(pipelineConsumesUserEvent('delete.backward')).toBe(false)
    expect(pipelineConsumesUserEvent('delete.selection')).toBe(false)
    expect(pipelineConsumesUserEvent('input.paste')).toBe(false)
    expect(pipelineConsumesUserEvent('undo')).toBe(false)
  })

  it('delete.* 与其他事件 → null（Delete 管线归 #9）', () => {
    const engine = engineOf(['builtin-fw2hw-double'])
    expect(planInputRuleModification(engine, inputCtx('。。', 2, 'delete.backward', ''))).toBeNull()
    expect(planInputRuleModification(engine, inputCtx('。。', 2, 'input.paste', '。。'))).toBeNull()
  })

  it('Tab 触发模式规则（T 旗标）不经本管线命中（changeType 非 tab）', () => {
    const engine = new RuleEngine()
    engine.addSimpleRule({ trigger: 'x', replacement: 'HIT', options: 'rT' } satisfies SimpleRule)
    expect(planInputRuleModification(engine, inputCtx('x', 1, 'input.type', 'x'))).toBeNull()
  })
})

// ===== 选区语义（多选区 open question 的管线侧结论） =====

describe('选区语义', () => {
  const engine = engineOf(['builtin-fw2hw-double'])

  it('仅处理首个选区：首选区不命中时次选区可命中也不处理', () => {
    // 首选区左文 x。（不命中）；次选区左文以 。。结尾（可命中）
    const plan = planInputRuleModification(
      engine,
      inputCtx('x。y。。', 2, 'input.type', '。', [
        { anchor: 2, head: 2 },
        { anchor: 6, head: 6 },
      ]),
    )
    expect(plan).toBeNull()
  })

  it('首选区命中 → 计划携带单一 selection（平台按 EditorSelection.single 应用，坍缩其余光标）', () => {
    const plan = planInputRuleModification(
      engine,
      inputCtx('。。。。', 2, 'input.type', '。', [
        { anchor: 2, head: 2 },
        { anchor: 6, head: 6 },
      ]),
    )
    expect(plan?.selection).toEqual({ anchor: 3, head: 3 })
  })

  it('首选区非塌缩（选区替换形态）→ null（SelectKey 包裹归 #9）', () => {
    expect(
      planInputRuleModification(engine, inputCtx('。。', 2, 'input.type', '。', [{ anchor: 0, head: 2 }])),
    ).toBeNull()
  })

  it('无选区（空数组，防御）→ null', () => {
    expect(planInputRuleModification(engine, inputCtx('。。', 2, 'input.type', '。', []))).toBeNull()
  })
})

// ===== 作用域注入（降级判定接线，无 syntaxTree） =====

describe('作用域注入（文本正则降级版 detectScopeFromText）', () => {
  it('Text 限定规则在围栏代码内被 scopeHint=Code 拦下；正文内照常命中', () => {
    const engine = new RuleEngine()
    engine.addSimpleRule({ trigger: '。', replacement: '。!', options: 't' } satisfies SimpleRule)
    // 围栏内：```js\n。\n``` 光标 7（。 之后）
    const inCode = planInputRuleModification(engine, inputCtx('```js\n。\n```', 7, 'input.type', '。'))
    expect(inCode).toBeNull()
    const inText = planInputRuleModification(engine, inputCtx('x。', 2, 'input.type', '。'))
    expect(inText?.changes[0]?.text).toBe('。!')
  })
})

// ===== 计划换算（ApplyResult → plan） =====

describe('applyResultToPlan：matchRange/newText/cursor → changes/selection', () => {
  it('区间与文本逐字段换算', () => {
    const plan = applyResultToPlan({
      newText: 'AB',
      cursor: 5,
      tabstops: [],
      matchRange: { from: 2, to: 4 },
    })
    expect(plan).toEqual({
      changes: [{ offset: 2, length: 2, text: 'AB' }],
      selection: { anchor: 5, head: 5 },
    })
  })
})
