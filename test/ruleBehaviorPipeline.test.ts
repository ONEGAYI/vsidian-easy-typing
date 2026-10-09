// onInput → 规则引擎触发管线测试（工单 #25 Input 类 + 工单 #9 Delete/
// SelectKey 类）：AddonInputContext（结构子集，userEvent 原样保留）→
// TxContext → RuleEngine.process → {changes, selection} 计划。票面场景以
// 真实内置规则数据（DEFAULT_BUILTIN_RULES）驱动——「真实引擎 + 模拟
// AddonInputContext」的集成级承载（真实 webview 端到端归 #21 人工验证）。
// 上游对照 rule_processor.ts triggerCvtRule 与 cm_extensions.ts
// tryProcessInput 的规则触发段、delete.backward 分支与 Selection Replace
// 分支。
import { describe, expect, it } from 'vitest'
import { RuleEngine, type SimpleRule } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'
import {
  applyResultToPlan,
  pipelineConsumesDeleteEvent,
  pipelineConsumesUserEvent,
  planDeleteRuleModification,
  planInputRuleModification,
  planSelectKeyRuleModification,
  type RuleInputPipelineContext,
} from '../src/ruleBehaviorPipeline'
import { isPositionProtected, parseUserDefinedRegExp } from '../src/userDefinedRegex'

/** 按内置规则 id 集构造引擎（族拆分在 intercept 层，本文件按需拼装） */
function engineOf(ruleIds: readonly string[]): RuleEngine {
  const rules = DEFAULT_BUILTIN_RULES.filter((r) => ruleIds.includes(r.id))
  expect(rules.length, `规则 id 应全部命中：${ruleIds.join(',')}`).toBe(ruleIds.length)
  const engine = new RuleEngine()
  engine.addSimpleRules(rules)
  return engine
}

/** 全部 6 条 Delete 类内置规则 */
const DELETE_RULE_IDS = [
  'builtin-autopair-delete',
  'builtin-del-inline-formula',
  'builtin-del-highlight',
  'builtin-del-block-formula',
  'builtin-del-codeblock',
  'builtin-del-wikilink',
]

/** 全部 4 条 SelectKey 类内置规则 */
const SELECTKEY_RULE_IDS = [
  'builtin-sel-wrap-backtick',
  'builtin-sel-wrap-symbols',
  'builtin-sel-wrap-quotes',
  'builtin-sel-wrap-cjk-brackets',
]

/** 模拟 AddonInputContext（快照已含本次输入；LF 坐标） */
function inputCtx(
  text: string,
  cursor: number,
  userEvent = 'input.type',
  inputText = '',
  selections: Array<{ anchor: number; head: number }> = [{ anchor: cursor, head: cursor }],
  replaced: RuleInputPipelineContext['replaced'] = null,
): RuleInputPipelineContext {
  return { userEvent, inputText, replaced, snapshot: { text, selections } }
}

// ===== 票面场景 1：标点转换（fw2hw-double，真实内置规则） =====

describe('管线集成：标点转换（builtin-fw2hw-double）', () => {
  const engine = engineOf(['builtin-fw2hw-double'])

  it('连续两个全角句号 → 半角（$0 经 #14 Tabstop 解析为光标位，非字面）', () => {
    // 输入第二个 。 后快照：docText 。。、光标 2
    const plan = planInputRuleModification(engine, inputCtx('。。', 2, 'input.type', '。'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 2, text: '.' }],
      selection: { anchor: 1, head: 1 },
    })
  })

  it('IME 定稿（input.type.compose）同样驱动——compose 事务直接消费（#6 挂接点）', () => {
    const plan = planInputRuleModification(engine, inputCtx('。。', 2, 'input.type.compose', '。'))
    expect(plan?.changes[0]?.text).toBe('.')
  })

  it('单个全角句号不触发', () => {
    expect(planInputRuleModification(engine, inputCtx('。', 1, 'input.type', '。'))).toBeNull()
  })
})

// ===== 票面场景 2：括号补全（autopair 族，真实内置规则） =====

describe('管线集成：括号补全（builtin-autopair-input / builtin-autopair-jump）', () => {
  const engine = engineOf(['builtin-autopair-jump', 'builtin-autopair-input'])

  it('输入（ → 补全配对（$0 经 #14 Tabstop 解析，光标落配对中间）', () => {
    const plan = planInputRuleModification(engine, inputCtx('（', 1, 'input.type', '（'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '（）' }],
      selection: { anchor: 1, head: 1 },
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
    expect(plan?.selection).toEqual({ anchor: 1, head: 1 })
  })

  it('首选区非塌缩（选区替换形态）→ null（SelectKey 包裹归 #9）', () => {
    expect(
      planInputRuleModification(engine, inputCtx('。。', 2, 'input.type', '。', [{ anchor: 0, head: 2 }])),
    ).toBeNull()
  })

  it('选区替换形态（replaced 非空）→ null：上游 changedStr.length < 1 同口径（#9 接缝）', () => {
    // 选中 hello 键入（：快照 （、光标塌缩——autopair 若放行会基于残缺
    // 上下文命中并把被替换内容丢失；上游该事务只走 SelectKey 分支
    const autopair = engineOf(['builtin-autopair-input'])
    expect(
      planInputRuleModification(autopair, inputCtx('（', 1, 'input.type', '（', [{ anchor: 1, head: 1 }], { from: 0, to: 5, text: 'hello' })),
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

// ===== 工单 #9：Delete 触发管线（联动删除计划） =====
//
// 语境约定：快照 text 为**事务后**文档（原生删除已发生）、replaced 为被
// 删文本（事务前 LF 坐标）、selections 为删除后残留光标。期望计划的
// changes 相对快照坐标。

describe('Delete 管线：内置规则联动删除矩阵（真实数据端到端）', () => {
  const engine = engineOf(DELETE_RULE_IDS)

  it('$|$ 退格 → 联动删除两侧 $（del-inline-formula，上游 toA 同口径）', () => {
    // 事务前 $$、光标 1；退格删 [0,1) 的 $ → 快照 $、replaced {0,1,'$'}
    const r = planDeleteRuleModification(engine, inputCtx('$', 0, 'delete.backward', '', [{ anchor: 0, head: 0 }], { from: 0, to: 1, text: '$' }))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })

  it('==|== 退格（删第二个 =）→ 联动删除整对高亮标记（del-highlight）', () => {
    // 事务前 ====（空高亮 ==|==）、光标 2；退格删 [1,2) 的 = → 快照 ===、光标 1
    const r = planDeleteRuleModification(engine, inputCtx('===', 1, 'delete.backward', '', [{ anchor: 1, head: 1 }], { from: 1, to: 2, text: '=' }))
    // 引擎命中 [0,4) 替换 ''；换算回快照：to 4-1=3 → 快照 [0,3) 全删
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 3, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })

  it('【|】 退格 → 联动删除配对括号（autopair-delete，函数体规则）', () => {
    // 事务前 【】、光标 1；退格删 [0,1) 的 【 → 快照 】
    const r = planDeleteRuleModification(engine, inputCtx('】', 0, 'delete.backward', '', [{ anchor: 0, head: 0 }], { from: 0, to: 1, text: '【' }))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })

  it('【|】 Delete 键（forward，删 】）→ 同样联动删除（光标取区间左端）', () => {
    // 事务前 【】、光标 1；Delete 删 [1,2) 的 】 → 快照 【
    const r = planDeleteRuleModification(engine, inputCtx('【', 1, 'delete.forward', '', [{ anchor: 1, head: 1 }], { from: 1, to: 2, text: '】' }))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })

  it('空块级公式中间行退格 → 整块删除（del-block-formula）', () => {
    // 事务前 $$\n\n$$、光标 3（中间空行行首）；退格删 [2,3) 的 \n
    const r = planDeleteRuleModification(engine, inputCtx('$$\n$$', 2, 'delete.backward', '', [{ anchor: 2, head: 2 }], { from: 2, to: 3, text: '\n' }))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 5, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })

  it('空代码块退格（删开栏末个 `）→ 整块删除且保留缩进（del-codeblock）', () => {
    // 事务前 "  ```\n  ```"、光标 5；退格删 [4,5) 的 ` → 快照 "  ``\n  ```"
    const r = planDeleteRuleModification(engine, inputCtx('  ``\n  ```', 4, 'delete.backward', '', [{ anchor: 4, head: 4 }], { from: 4, to: 5, text: '`' }))
    // 引擎命中 [0,11) 替换 [[1]]="  "；换算：to 11-1=10 → 快照 [0,10) → "  "
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 10, text: '  ' }],
      selection: { anchor: 2, head: 2 },
    })
  })

  it('双链末尾退格（删 ]）→ 联动删除整个 ![[...]]（del-wikilink）', () => {
    // 事务前 ![[img.png]]、光标 12；退格删 [11,12) 的 ] → 快照 ![[img.png]
    const r = planDeleteRuleModification(engine, inputCtx('![[img.png]', 11, 'delete.backward', '', [{ anchor: 11, head: 11 }], { from: 11, to: 12, text: ']' }))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 11, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })

  it('有内容的 $a$ 删闭合 $ 不触发（上游语义：仅空对联动）', () => {
    // 事务前 $a$、光标 3；退格删 [2,3) 的 $：右侧无 $ 可配
    const r = planDeleteRuleModification(engine, inputCtx('$a', 2, 'delete.backward', '', [{ anchor: 2, head: 2 }], { from: 2, to: 3, text: '$' }))
    expect(r).toBeNull()
  })

  it('delete.cut 删整对（如剪切整个 ![[img.png]]）→ 换算后空操作返回 null（原生即终态）', () => {
    const r = planDeleteRuleModification(engine, inputCtx('', 0, 'delete.cut', '', [{ anchor: 0, head: 0 }], { from: 0, to: 12, text: '![[img.png]]' }))
    expect(r).toBeNull()
  })
})

describe('Delete 管线：触发面门控与边界', () => {
  const engine = engineOf(DELETE_RULE_IDS)
  /** $|$ 退格场景的合法 delete 上下文（事件名可覆写） */
  const deleteCtx = (userEvent: string, extra: Partial<RuleInputPipelineContext> = {}): RuleInputPipelineContext => ({
    ...inputCtx('$', 0, userEvent, '', [{ anchor: 0, head: 0 }], { from: 0, to: 1, text: '$' }),
    ...extra,
  })

  it('白名单五类可消费，dedent 与非 delete 事件不响应', () => {
    expect(pipelineConsumesDeleteEvent('delete.backward')).toBe(true)
    expect(pipelineConsumesDeleteEvent('delete.forward')).toBe(true)
    expect(pipelineConsumesDeleteEvent('delete.selection')).toBe(true)
    expect(pipelineConsumesDeleteEvent('delete.cut')).toBe(true)
    expect(pipelineConsumesDeleteEvent('delete.line')).toBe(true)
    expect(pipelineConsumesDeleteEvent('delete.dedent')).toBe(false)
    expect(pipelineConsumesDeleteEvent('input.type')).toBe(false)
    expect(pipelineConsumesDeleteEvent('undo')).toBe(false)
  })

  it('白名单外 delete.* 不产出计划', () => {
    expect(planDeleteRuleModification(engine, deleteCtx('delete.dedent'))).toBeNull()
    expect(planDeleteRuleModification(engine, deleteCtx('input.type'))).toBeNull()
  })

  it('inputText 非空（违背平台契约）不消费；replaced 为 null 不消费', () => {
    expect(planDeleteRuleModification(engine, deleteCtx('delete.backward', { inputText: 'x' }))).toBeNull()
    expect(planDeleteRuleModification(engine, deleteCtx('delete.backward', { replaced: null }))).toBeNull()
    expect(planDeleteRuleModification(engine, deleteCtx('delete.backward', { replaced: { from: 0, to: 0, text: '' } }))).toBeNull()
  })

  it('多选区（多区间 replaced 最小包围 + 拼接语义）→ null：事务前重建不可信，不猜', () => {
    // 双光标各自退格删 $：快照 "x" 残留双光标，replaced 为两区间拼接
    const r = planDeleteRuleModification(
      engine,
      inputCtx('x', 0, 'delete.backward', '', [
        { anchor: 0, head: 0 },
        { anchor: 1, head: 1 },
      ], { from: 0, to: 2, text: '$$' }),
    )
    expect(r).toBeNull()
  })
})

// ===== 工单 #9：SelectKey 触发管线（选中包裹计划） =====
//
// 语境约定：快照 text 为键入后文档（选区已被键入字符替换）、replaced
// 为被替换的选区内容（包裹目标）、inputText 为触发键。

describe('SelectKey 管线：内置规则选中包裹矩阵（真实数据端到端）', () => {
  const engine = engineOf(SELECTKEY_RULE_IDS)

  /** 选中 hello（[0,5)）后键入触发键的上下文 */
  const wrapCtx = (key: string): RuleInputPipelineContext =>
    inputCtx(key, 1, 'input.type', key, [{ anchor: 1, head: 1 }], { from: 0, to: 5, text: 'hello' })

  it('选中后键 · → 行内代码包裹，$0 tabstop 覆盖选中文本（sel-wrap-backtick）', () => {
    const r = planSelectKeyRuleModification(engine, wrapCtx('·'))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '`hello`' }],
      selection: { anchor: 1, head: 1 },
    })
    // ${0:${SEL}} → $0 组覆盖 hello（光标落组首）
    expect(r?.tabstops).toEqual([{ number: 0, from: 1, to: 6 }])
  })

  it('选中后键 【 → [ ] 半角方括号包裹（sel-wrap-symbols，函数体规则）', () => {
    const r = planSelectKeyRuleModification(engine, wrapCtx('【'))
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '[hello]' }],
      selection: { anchor: 1, head: 1 },
    })
  })

  it('选中后键 ¥ → $ $ 包裹（sel-wrap-symbols）', () => {
    const r = planSelectKeyRuleModification(engine, wrapCtx('¥'))
    expect(r?.plan?.changes[0]?.text).toBe('$hello$')
  })

  it('选中后键 “ → 全角引号配对包裹（sel-wrap-quotes，函数体规则）', () => {
    const r = planSelectKeyRuleModification(engine, wrapCtx('“'))
    expect(r?.plan?.changes[0]?.text).toBe('“hello”')
  })

  it('选中后键 （ → 全角括号配对包裹（sel-wrap-cjk-brackets，函数体规则）', () => {
    const r = planSelectKeyRuleModification(engine, wrapCtx('（'))
    expect(r?.plan?.changes[0]?.text).toBe('（hello）')
  })

  it('非触发键（x）→ null：包裹目标保留在 replaced 但无规则命中', () => {
    expect(planSelectKeyRuleModification(engine, wrapCtx('x'))).toBeNull()
  })

  it('选中后键 】（无对应规则）→ null', () => {
    expect(planSelectKeyRuleModification(engine, wrapCtx('】'))).toBeNull()
  })
})

describe('SelectKey 管线：触发面门控与边界', () => {
  const engine = engineOf(SELECTKEY_RULE_IDS)

  it('纯插入（replaced null）→ null（Input 管线领地）', () => {
    const r = planSelectKeyRuleModification(
      engine,
      inputCtx('·', 1, 'input.type', '·', [{ anchor: 1, head: 1 }], null),
    )
    expect(r).toBeNull()
  })

  it('IME 定稿（input.type.compose）不适用 SelectKey：replaced 恒 null（平台 #399 边界）', () => {
    // 即便组合输入在视觉上替换了选区，平台对 compose 补驱动恒报 null——
    // 组合事务先于 compositionend，替换侧无法归因
    const r = planSelectKeyRuleModification(
      engine,
      inputCtx('·', 1, 'input.type.compose', '·', [{ anchor: 1, head: 1 }], null),
    )
    expect(r).toBeNull()
  })

  it('delete.* 事件不进 SelectKey 管线（replaced 语义为被删文本）', () => {
    const r = planSelectKeyRuleModification(
      engine,
      inputCtx('', 0, 'delete.selection', '', [{ anchor: 0, head: 0 }], { from: 0, to: 5, text: 'hello' }),
    )
    expect(r).toBeNull()
  })

  it('多选区替换（多区间 replaced 拼接语义）→ null：单计划无法忠实表达多区间', () => {
    const r = planSelectKeyRuleModification(
      engine,
      inputCtx('··', 1, 'input.type', '··', [
        { anchor: 1, head: 1 },
        { anchor: 2, head: 2 },
      ], { from: 0, to: 11, text: 'hello world' }),
    )
    expect(r).toBeNull()
  })

  it('多字符键入（—— 形态）不命中：引擎 triggerKeys 逐字符解析，多字符键必然不中', () => {
    const r = planSelectKeyRuleModification(
      engine,
      inputCtx('——', 2, 'input.type', '——', [{ anchor: 2, head: 2 }], { from: 0, to: 5, text: 'hello' }),
    )
    expect(r).toBeNull()
  })
})

// ===== 工单 #6：compose 去重核验（平台单发结论 + 双发防御性钉住） =====
//
// 平台核验结论（vsidian liveInstance.ts @ origin/main，2026-10-09 核对）：
// IME 定稿不会双发——两条驱动路径物理分离且互斥：
// 1. 事务路径（maybeDriveAddonBehaviors）双重门：userEvent 含 '.compose'
//    显式排除在前，组合期门控（composing / blankComposition 在场）在后
//    ——Chromium 实证定稿事务先于 compositionend 派发、恒处于组合期
//    窗口内，两道门至少一道拦截；
// 2. compositionend 钩子（maybeDriveAddonBehaviorsForComposeCommit）：
//    每次组合结束至多补发一次 'input.type.compose'（净定稿文本）。
// 端到端实证：平台 test/browser/addonT07Behaviors.mjs 场景 4（真实 CDP
// Input.imeSetComposition + insertText）断言「定稿驱动恰好一次」。compositionend
// 之后的普通 input.type 事务是独立键入（如定稿后按键），本应各自驱动——
// 不属同一定稿的双发。插件侧无需显式去重（管线纯函数、无跨调用状态）；
// 本节测试钉住两道边界：同一次驱动内三管线对 compose 互斥，与异常双发
// 下修饰已生效的重复驱动不二次改写（真实时序：链首次 applyEdits 在其
// await 求值时同步 dispatch 修饰事务，早于任何后续驱动微任务——第二次
// 驱动到达时文档已演进）。

describe('工单 #6：compose 事件单次驱动内三管线互斥（不重复处理）', () => {
  const engine = engineOf([...DELETE_RULE_IDS, ...SELECTKEY_RULE_IDS, 'builtin-fw2hw-double'])

  it('Delete 管线白名单不含 compose：input.type.compose（即便携带删除侧形态）→ null', () => {
    expect(
      planDeleteRuleModification(
        engine,
        inputCtx('。。', 2, 'input.type.compose', '。'),
      ),
    ).toBeNull()
    expect(
      planDeleteRuleModification(
        engine,
        inputCtx('。', 0, 'input.type.compose', '', [{ anchor: 0, head: 0 }], { from: 0, to: 2, text: '。。' }),
      ),
    ).toBeNull()
  })

  it('SelectKey 管线仅认 input.type：compose 事件即便异常携带 replaced → null', () => {
    // 平台对 compose 补驱动 replaced 恒 null（组合事务先于 compositionend，
    // 替换侧无法归因）——本例防御性模拟「上游异常给 compose 事件携带
    // replaced」的形态，钉住 userEvent 门独立于 replaced 形态生效
    const r = planSelectKeyRuleModification(
      engine,
      inputCtx('·', 1, 'input.type.compose', '·', [{ anchor: 1, head: 1 }], { from: 0, to: 1, text: 'x' }),
    )
    expect(r).toBeNull()
  })
})

describe('工单 #6：异常双发下的行为安全（修饰已生效后的重复驱动不二次改写）', () => {
  it('同一 IME 定稿双发（compose 补发 + 普通事务重复到达）：第二次以演进后文档进管线 → 不再命中', () => {
    const engine = engineOf(['builtin-fw2hw-double'])
    // 第一次：compositionend 补发路径（input.type.compose，净定稿文本）
    const first = planInputRuleModification(engine, inputCtx('。。', 2, 'input.type.compose', '。'))
    expect(first?.changes).toEqual([{ offset: 0, length: 2, text: '.' }])
    // 平台应用计划后的文档演进（changes[0] 落盘）
    const change = first?.changes[0]
    expect(change).toBeDefined()
    const applied =
      change !== undefined
        ? '。。'.slice(0, change.offset) + change.text + '。。'.slice(change.offset + change.length)
        : ''
    expect(applied).toBe('.')
    // 万一同一定稿又以普通 input.type 双发：第二次驱动到达时修饰事务已
    // 落盘（平台时序保证），以演进后快照进管线——文档中已无全角句号，
    // 规则不再命中 → null，无第二次改写（无双重转换）
    expect(planInputRuleModification(engine, inputCtx(applied, 1, 'input.type', '。'))).toBeNull()
  })
})

// ===== 工单 #27：保护区 × 规则触发（「用户规则尊重保护区」的管线注入位） =====
//
// 语义锚点：上游 rule_processor.ts:22-29——检查列 = 事件类为 input（前缀）
// 时回退一列（刚键入字符所在列），否则用列本身；命中保护区 → 规则不触发。
// 上游仅 Input 类（triggerCvtRule）有此检查；Delete/SelectKey 为本票对
// #9 管线的对称扩展（票面范围），规格记录于 docs/specs/protected-zones.md。

describe('保护区注入：Input 管线（上游语义同构）', () => {
  const engine = engineOf(['builtin-fw2hw-double'])

  /** stub 探针：列 ∈ [2,5) 为保护区（覆盖注入形态的最小可控行内区间） */
  const stubZone = { isProtected: (_line: string, column: number) => column >= 2 && column < 5 }

  it('检查列回退一列：`。。` 光标列 4 → 检查列 3 ∈ 保护区 → 不触发', () => {
    // 快照 ab。。（光标 4，inputText 。）：列 4 回退 3，落在 [2,5) → null
    const r = planInputRuleModification(engine, inputCtx('ab。。', 4, 'input.type', '。'), {
      protectedZone: stubZone,
    })
    expect(r).toBeNull()
  })

  it('同一行光标列 2（检查列 1 出区）→ 照常触发（回退语义的出区对照）', () => {
    const r = planInputRuleModification(engine, inputCtx('。。', 2, 'input.type', '。'), {
      protectedZone: stubZone,
    })
    expect(r?.changes[0]?.text).toBe('.')
  })

  it('IME 定稿（input.type.compose）同样回退一列并跳过', () => {
    const r = planInputRuleModification(engine, inputCtx('ab。。', 4, 'input.type.compose', '。'), {
      protectedZone: stubZone,
    })
    expect(r).toBeNull()
  })

  it('真实探针（{{}} 模板）：`{{。。}}` 内键入 → 不触发；区外 `x。。` → 触发', () => {
    const zone = {
      isProtected: (line: string, column: number) =>
        isPositionProtected(line, column, parseUserDefinedRegExp('{{.*?}}|++')),
    }
    expect(
      planInputRuleModification(engine, inputCtx('{{。。}}', 4, 'input.type', '。'), {
        protectedZone: zone,
      }),
    ).toBeNull()
    expect(
      planInputRuleModification(engine, inputCtx('x。。', 3, 'input.type', '。'), {
        protectedZone: zone,
      })?.changes[0]?.text,
    ).toBe('.')
  })

  it('多行文档：保护区判定只看光标所在行', () => {
    const zone = {
      isProtected: (line: string, column: number) =>
        isPositionProtected(line, column, parseUserDefinedRegExp('{{.*?}}|++')),
    }
    // 第二行 {{。。}} 内键入、首行有无关 {{x}}：判定行 = 第二行
    expect(
      planInputRuleModification(engine, inputCtx('{{x}}\n{{。。}}', 10, 'input.type', '。'), {
        protectedZone: zone,
      }),
    ).toBeNull()
  })
})

describe('保护区注入：Delete 管线（票面对称扩展，列不回退）', () => {
  const engine = engineOf(DELETE_RULE_IDS)

  /** stub 探针：列 ∈ [0,2) 为保护区 */
  const stubZone = { isProtected: (_line: string, column: number) => column < 2 }

  it('事务前虚拟光标列 1 ∈ 保护区 → 联动删除不触发', () => {
    // 事务前 【】、退格删 【（replaced {0,1}）：虚拟光标 = to = 1，列不回退
    const r = planDeleteRuleModification(
      engine,
      inputCtx('】', 0, 'delete.backward', '', [{ anchor: 0, head: 0 }], { from: 0, to: 1, text: '【' }),
      { protectedZone: stubZone },
    )
    expect(r).toBeNull()
  })

  it('delete.* 事件检查列不回退：列 1 即查列 1（对照 Input 的回退）', () => {
    // 同场景把保护区收窄到仅列 0（若错误回退会查列 0 → 误跳过）
    const zone0 = { isProtected: (_l: string, c: number) => c === 0 }
    const r = planDeleteRuleModification(
      engine,
      inputCtx('】', 0, 'delete.backward', '', [{ anchor: 0, head: 0 }], { from: 0, to: 1, text: '【' }),
      { protectedZone: zone0 },
    )
    expect(r?.plan?.changes[0]?.text).toBe('')
  })

  it('保护区外照常联动删除', () => {
    const zone = {
      isProtected: (line: string, column: number) =>
        isPositionProtected(line, column, parseUserDefinedRegExp('{{.*?}}|++')),
    }
    const r = planDeleteRuleModification(
      engine,
      inputCtx('】', 0, 'delete.backward', '', [{ anchor: 0, head: 0 }], { from: 0, to: 1, text: '【' }),
      { protectedZone: zone },
    )
    expect(r?.plan).toEqual({
      changes: [{ offset: 0, length: 1, text: '' }],
      selection: { anchor: 0, head: 0 },
    })
  })
})

describe('保护区注入：SelectKey 管线（票面对称扩展，input 类回退一列）', () => {
  const engine = engineOf(SELECTKEY_RULE_IDS)

  /** wrapCtx 同上游测试：选中 hello [0,5) 键 ·；检查列 = replaced.from 列 0 回退 → 0 */
  const wrapCtx = (key: string): RuleInputPipelineContext =>
    inputCtx(key, 1, 'input.type', key, [{ anchor: 1, head: 1 }], { from: 0, to: 5, text: 'hello' })

  it('替换起点列 0 ∈ 保护区 → 包裹不触发', () => {
    const zone = { isProtected: (_l: string, c: number) => c === 0 }
    expect(planSelectKeyRuleModification(engine, wrapCtx('·'), { protectedZone: zone })).toBeNull()
  })

  it('保护区只罩列 1（回退后出区）→ 照常包裹（回退语义对照）', () => {
    const zone = { isProtected: (_l: string, c: number) => c === 1 }
    const r = planSelectKeyRuleModification(engine, wrapCtx('·'), { protectedZone: zone })
    expect(r?.plan?.changes[0]?.text).toBe('`hello`')
  })

  it('真实探针：事务前重建文档 `{{hello}}` 内选区替换 → 不触发', () => {
    // replaced.text = {{hello}}（事务前选区内容），重建 docText 即 {{hello}}
    const zone = {
      isProtected: (line: string, column: number) =>
        isPositionProtected(line, column, parseUserDefinedRegExp('{{.*?}}|++')),
    }
    const ctx = inputCtx('·', 1, 'input.type', '·', [{ anchor: 1, head: 1 }], {
      from: 0,
      to: 9,
      text: '{{hello}}',
    })
    expect(planSelectKeyRuleModification(engine, ctx, { protectedZone: zone })).toBeNull()
  })
})
