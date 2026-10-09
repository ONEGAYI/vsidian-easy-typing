// 内置规则匹配矩阵（工单 #1）：上游 default_rules.ts 全量规则的触发/不触发/边界
// 三档用例。上游对照：easy-typing-obsidian v6.0.9 src/default_rules.ts。
//
// 计数口径：上游 v6.0.9 实测 20 条（default_rules.ts 的 id 与六语言包
// builtinRuleDescriptions 键集一致），票面「22 条」为计数偏差，本矩阵按
// 全量口径覆盖 20 条（见 docs/specs/rule-engine.md 已知边界）。
//
// 口径约定：
// - docText 已含刚键入的字符（上游 transactionFilter 后置触发语义），
//   selection 光标位于其后；坐标为 LF 偏移。
// - $0/$1 占位符已随 #14 解析（上游 parseTabstops 恢复）：newText 去标记、
//   tabstops 填充文档绝对坐标、cursor 落最小编号占位符起点；分组导航归 #15。
// - Delete/SelectKey 用例分两档：Input 触发下「不触发」（类型门控）与
//   kind:Delete/SelectKey 的「内核共享路径冒烟」——触发管线与端到端归 #9。
import { describe, expect, it } from 'vitest'
import { RuleEngine, RuleScope, RuleType, type TxContext } from '../src/rules/rule-engine'
import { DEFAULT_BUILTIN_RULES } from '../src/rules/default-rules'

/** 装载全部内置规则的全新引擎（用例间无状态串扰） */
function builtinEngine(): RuleEngine {
  const engine = new RuleEngine()
  engine.addSimpleRules(DEFAULT_BUILTIN_RULES)
  return engine
}

// 矩阵默认作用域 All（等价「无作用域限制」）：上游 triggerCvtRule 以光标处
// 实际判定传入 scopeHint；作用域门控用例在 rule-engine-core 覆盖
function inputCtx(docText: string, cursor: number, overrides: Partial<TxContext> = {}): TxContext {
  return {
    kind: RuleType.Input,
    docText,
    selection: { from: cursor, to: cursor },
    inserted: '',
    changeType: 'input.type',
    scopeHint: RuleScope.All,
    ...overrides,
  }
}

describe('数据完整性（上游 20 条全量移植）', () => {
  it('规则数 20、id 唯一、各带描述', () => {
    expect(DEFAULT_BUILTIN_RULES).toHaveLength(20)
    const ids = DEFAULT_BUILTIN_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(20)
    for (const rule of DEFAULT_BUILTIN_RULES) {
      expect(rule.description, `${rule.id} 缺描述`).toBeTruthy()
    }
  })

  it('默认启用状态：仅「CJK 后半角标点转全角」默认关', () => {
    const disabled = DEFAULT_BUILTIN_RULES.filter((r) => r.enabled === false)
    expect(disabled.map((r) => r.id)).toEqual(['builtin-conv-hw2fw'])
  })

  it('优先级分层与上游头注一致（3/5/10×6/15/30×5/40×4/50×2）', () => {
    const byPriority = new Map<number, number>()
    for (const rule of DEFAULT_BUILTIN_RULES) {
      byPriority.set(rule.priority ?? 100, (byPriority.get(rule.priority ?? 100) ?? 0) + 1)
    }
    expect(Object.fromEntries([...byPriority].sort(([a], [b]) => a - b))).toEqual({
      3: 1, 5: 1, 10: 6, 15: 1, 30: 5, 40: 4, 50: 2,
    })
  })
})

describe('builtin-autopair-input（输入全角括号/引号自动补全，rF/10）', () => {
  // 上游数据怪癖（原样保留）：触发类 [（《「『“”‘’《] 不含 【，但替换表
  // p 含 '【'——键入 【 不自动补全，而删除类 builtin-autopair-delete 的
  // 触发类含 【。按上游数据移植，不擅自放宽。
  it.each([
    ['a（', 2, '（）'],
    ['好《', 2, '《》'],
    ['「', 1, '「」'],
    ['『', 1, '『』'],
    ['“', 1, '“”'],
    ['”', 1, '“”'],
    ['‘', 1, '‘’'],
    ['’', 1, '‘’'],
  ])('触发：%s 光标 %i → %s（$0 解析为空占位）', (doc, cursor, expected) => {
    const result = builtinEngine().process(inputCtx(doc, cursor))
    expect(result?.newText).toBe(expected)
  })

  it('触发断言（tabstop 形态）：$0 去标记后 tabstops 填空占位、cursor 落其上', () => {
    const result = builtinEngine().process(inputCtx('a（', 2))
    expect(result?.tabstops).toEqual([{ number: 0, from: 2, to: 2 }])
    expect(result?.cursor).toBe(2)
  })

  it('不触发：半角括号与 【 不在触发类（上游触发类原样）', () => {
    expect(builtinEngine().process(inputCtx('a(', 2))).toBeNull()
    expect(builtinEngine().process(inputCtx('a【', 2))).toBeNull()
  })

  it('边界：matchRange 只覆盖刚键入的字符', () => {
    const result = builtinEngine().process(inputCtx('a（', 2))
    expect(result?.matchRange).toEqual({ from: 1, to: 2 })
  })
})

describe('builtin-autopair-jump（输入右配对符跳过，rF/5）', () => {
  // 光标在配对内刚键入的右符之后（后置触发语义：配对由 autopair 先行
  // 插入，用户再键入右符 → 光标在「左配对+右符」之后、原右配对之前）
  it.each([
    ['《》》', 2, '《》'],
    ['（））', 2, '（）'],
    ['“””', 2, '“”'],
    ['‘’’', 2, '‘’'],
  ])('触发：%s 光标 %i → %s（吃掉重复右符）', (doc, cursor, expected) => {
    const result = builtinEngine().process(inputCtx(doc, cursor))
    expect(result?.newText).toBe(expected)
    expect(result?.matchRange).toEqual({ from: 0, to: cursor + 1 })
  })

  it('不触发：右侧是配对之外的字符', () => {
    expect(builtinEngine().process(inputCtx('《》x', 3))).toBeNull()
  })

  it('边界：右侧符号与配对端不匹配 → jump 放弃，落穿到 autopair-input', () => {
    // 左侧是 ‘’，刚键入 ”：右侧 ” 匹配右正则但不是 ‘’ 的配对端 → 函数
    // 返回 undefined；随后 autopair-input 命中（leftDoc 末字符 ’ 在触发类）
    const result = builtinEngine().process(inputCtx('‘’”', 2))
    expect(result?.newText).toBe('‘’')
    expect(result?.matchRange).toEqual({ from: 1, to: 2 })
  })
})

describe('builtin-autopair-delete（删除配对，drF/10，触发管线归 #9）', () => {
  it('Input 触发下不触发（类型门控）', () => {
    expect(builtinEngine().process(inputCtx('【】', 2))).toBeNull()
  })

  it('共享路径冒烟：删除 【 时右侧恰为 】 → 连带删除', () => {
    const engine = builtinEngine()
    const result = engine.process({
      kind: RuleType.Delete,
      docText: '【】',
      selection: { from: 1, to: 1 },
      inserted: '',
      changeType: 'delete.backward',
      scopeHint: RuleScope.All,
    })
    expect(result?.newText).toBe('')
    expect(result?.matchRange).toEqual({ from: 0, to: 2 })
  })

  it('共享路径边界：配对端不匹配 → 不触发', () => {
    const engine = builtinEngine()
    const result = engine.process({
      kind: RuleType.Delete,
      docText: '【）',
      selection: { from: 1, to: 1 },
      inserted: '',
      changeType: 'delete.backward',
      scopeHint: RuleScope.All,
    })
    expect(result).toBeNull()
  })
})

describe('builtin-conv-backtick（·· 转行内代码，10）', () => {
  it('触发：a·· → 行内代码（$0 解析为空占位，cursor 落标记间）', () => {
    const result = builtinEngine().process(inputCtx('a··', 3))
    expect(result?.newText).toBe('``')
    expect(result?.matchRange).toEqual({ from: 1, to: 3 })
    expect(result?.tabstops).toEqual([{ number: 0, from: 2, to: 2 }])
    expect(result?.cursor).toBe(2)
  })

  it('不触发：单个 ·', () => {
    expect(builtinEngine().process(inputCtx('·', 1))).toBeNull()
  })

  it('边界：三个 · 取末尾两个', () => {
    const result = builtinEngine().process(inputCtx('x···', 4))
    expect(result?.newText).toBe('``')
    expect(result?.matchRange).toEqual({ from: 2, to: 4 })
  })
})

describe('builtin-conv-codeblock（`·` 升级代码块，r/10）', () => {
  it('触发：行首 `·` → 代码块（[[1]] 缩进捕获为空）', () => {
    const result = builtinEngine().process(inputCtx('`·`', 2))
    expect(result?.newText).toBe('```\n```')
    expect(result?.matchRange).toEqual({ from: 0, to: 3 })
    expect(result?.tabstops).toEqual([{ number: 0, from: 3, to: 3 }])
  })

  it('不触发：行中 `·`（lookbehind 行首不满足）', () => {
    expect(builtinEngine().process(inputCtx('x`·`', 3))).toBeNull()
  })

  it('边界：缩进捕获 [[1]] 两侧生效', () => {
    const result = builtinEngine().process(inputCtx('  `·`', 4))
    expect(result?.newText).toBe('  ```\n  ```')
  })
})

describe('builtin-conv-formula（￥/$ 组合转公式，rF/10）', () => {
  it.each([
    ['￥￥', 2],
    ['¥¥', 2],
    ['$￥', 2],
    ['$$', 2],
  ])('触发：%s 右侧无 $ → 行内公式（$0 解析，tabstop 落两个 $ 之间）', (doc, cursor) => {
    const result = builtinEngine().process(inputCtx(doc, cursor))
    expect(result?.newText).toBe('$$')
    expect(result?.matchRange).toEqual({ from: 0, to: cursor })
    expect(result?.tabstops).toEqual([{ number: 0, from: 1, to: 1 }])
  })

  it('触发：右侧恰为 $ → 块级公式（\\n 反转义为真实换行）', () => {
    // 光标在 ￥￥ 之后（右侧已存在 $，如「￥$」前再补一个 ￥）
    const result = builtinEngine().process(inputCtx('￥￥$', 2))
    expect(result?.newText).toBe('$$\n\n$$')
    expect(result?.matchRange).toEqual({ from: 0, to: 3 })
    expect(result?.tabstops).toEqual([{ number: 0, from: 3, to: 3 }])
  })

  it('不触发：单个 ￥', () => {
    expect(builtinEngine().process(inputCtx('￥', 1))).toBeNull()
  })
})

describe('builtin-conv-linestart（行首 》/、 转换，rF/10）', () => {
  it.each([
    ['\n》', '\n> '],
    ['》', '> '],
    ['、', '/'],
  ])('触发：%j → %j（上游替换表原样：、 无尾随空格）', (doc, expected) => {
    const result = builtinEngine().process(inputCtx(doc as string, (doc as string).length))
    expect(result?.newText).toBe(expected)
  })

  it('不触发：行中 》', () => {
    expect(builtinEngine().process(inputCtx('a》', 2))).toBeNull()
  })
})

describe('builtin-conv-hw2fw（CJK 后半角标点转全角，rF/15，默认关）', () => {
  it('默认不启用：好, 不变换', () => {
    expect(builtinEngine().process(inputCtx('好,', 2))).toBeNull()
  })

  it('启用后触发：好, → 好， / 好. → 好。 / 好( → 好配对括号', () => {
    const engine = builtinEngine()
    engine.setEnabled('builtin-conv-hw2fw', true)
    expect(engine.process(inputCtx('好,', 2))?.newText).toBe('好，')
    expect(engine.process(inputCtx('好(', 2))?.newText).toBe('好（）')
    expect(engine.process(inputCtx('好.', 2))?.newText).toBe('好。')
  })

  it('不触发：拉丁字母后的半角标点（CJK 类不满足）', () => {
    const engine = builtinEngine()
    engine.setEnabled('builtin-conv-hw2fw', true)
    expect(engine.process(inputCtx('a,', 2))).toBeNull()
  })
})

describe('builtin-fw2hw-double（连续两个全角标点转半角，rF/3）', () => {
  it.each([
    ['。。', '.'],
    ['，，', ','],
    ['！！', '!'],
    ['？？', '?'],
    ['《《', '<'],
    ['｜｜', '|'],
    ['（（', '()'],
  ])('触发：%s → %s（$0 解析为空占位）', (doc, expected) => {
    const result = builtinEngine().process(inputCtx(doc, 2))
    expect(result?.newText).toBe(expected)
  })

  it('不触发：两个不同全角标点', () => {
    expect(builtinEngine().process(inputCtx('。，', 2))).toBeNull()
  })

  it('边界：优先级 3 抢在行首转换与引用转换之前（》》 → >）', () => {
    const result = builtinEngine().process(inputCtx('》》', 2))
    expect(result?.newText).toBe('>')
  })

  it('边界：右侧带配对端（（（） 光标 2 → () 吃掉右端', () => {
    // 光标在第二个 （ 之后、） 之前（在已有 （） 前再键入一个 （）
    const result = builtinEngine().process(inputCtx('（（）', 2))
    expect(result?.newText).toBe('()')
    expect(result?.matchRange).toEqual({ from: 0, to: 3 })
  })
})

describe('Delete 类内置规则（d/dr/30，触发管线归 #9）', () => {
  it('五条规则全部建模为 Delete 类', () => {
    const engine = builtinEngine()
    for (const id of [
      'builtin-autopair-delete',
      'builtin-del-inline-formula',
      'builtin-del-highlight',
      'builtin-del-block-formula',
      'builtin-del-codeblock',
      'builtin-del-wikilink',
    ]) {
      expect(engine.getRule(id)?.type, `${id} 应为 Delete 类`).toBe(RuleType.Delete)
    }
  })

  it('Input 触发下均不触发', () => {
    const engine = builtinEngine()
    for (const [doc, cursor] of [['$$', 1], ['==x==', 4], ['```\n```', 3]] as const) {
      expect(engine.process(inputCtx(doc, cursor)), `${doc}`).toBeNull()
    }
  })

  it('共享路径冒烟：$$ 配对删除 / 块级公式删除 / 空代码块删除 / 双链删除', () => {
    const engine = builtinEngine()
    const del = (docText: string, cursor: number) =>
      engine.process({
        kind: RuleType.Delete,
        docText,
        selection: { from: cursor, to: cursor },
        inserted: '',
        changeType: 'delete.backward',
        scopeHint: RuleScope.All,
      })
    expect(del('$$', 1)).toMatchObject({ newText: '', matchRange: { from: 0, to: 2 } })
    expect(del('$$\n\n$$', 3)).toMatchObject({ newText: '', matchRange: { from: 0, to: 6 } })
    expect(del('```\n```', 3)).toMatchObject({ newText: '', matchRange: { from: 0, to: 7 } })
    expect(del('见[[链接]]', 7)).toMatchObject({ newText: '', matchRange: { from: 1, to: 7 } })
    expect(del('嵌入![[图]]尾', 8)).toMatchObject({ newText: '', matchRange: { from: 2, to: 8 } })
  })
})

describe('SelectKey 类内置规则（s/sF/40，触发管线归 #9）', () => {
  it('四条规则建模为 SelectKey 类且触发键解析正确', () => {
    const engine = builtinEngine()
    expect(engine.getRule('builtin-sel-wrap-backtick')?.triggerKeys).toEqual(['·'])
    expect(engine.getRule('builtin-sel-wrap-symbols')?.triggerKeys).toEqual(['【', '¥', '￥'])
    expect(engine.getRule('builtin-sel-wrap-quotes')?.triggerKeys).toEqual(['“', '”', '‘', '’'])
    expect(engine.getRule('builtin-sel-wrap-cjk-brackets')?.triggerKeys).toEqual(['《', '（'])
    for (const id of [
      'builtin-sel-wrap-backtick',
      'builtin-sel-wrap-symbols',
      'builtin-sel-wrap-quotes',
      'builtin-sel-wrap-cjk-brackets',
    ]) {
      expect(engine.getRule(id)?.type, `${id} 应为 SelectKey 类`).toBe(RuleType.SelectKey)
    }
  })

  it('Input 触发下不触发（单 · 不包裹）', () => {
    expect(builtinEngine().process(inputCtx('·', 1))).toBeNull()
  })

  it('共享路径冒烟：选区 abc 按 · → 行内代码（${SEL} 展开 + $0 占位覆盖选区文本）', () => {
    const engine = builtinEngine()
    const result = engine.process({
      kind: RuleType.SelectKey,
      docText: 'xabcz',
      selection: { from: 1, to: 4 },
      inserted: '·',
      changeType: 'input.type',
      scopeHint: RuleScope.All,
      key: '·',
    })
    expect(result?.newText).toBe('`abc`')
    expect(result?.matchRange).toEqual({ from: 1, to: 4 })
    expect(result?.tabstops).toEqual([{ number: 0, from: 2, to: 5 }])
    expect(result?.cursor).toBe(2)
  })

  it('共享路径冒烟：选区 abc 按 ¥（sF 函数体）→ $ 包裹 + $0 占位覆盖选区', () => {
    const engine = builtinEngine()
    const result = engine.process({
      kind: RuleType.SelectKey,
      docText: 'xabcz',
      selection: { from: 1, to: 4 },
      inserted: '¥',
      changeType: 'input.type',
      scopeHint: RuleScope.All,
      key: '¥',
    })
    expect(result?.newText).toBe('$abc$')
    expect(result?.tabstops).toEqual([{ number: 0, from: 2, to: 5 }])
  })
})

describe('builtin-quote-convert（> / 》 转引用标记，r/50）', () => {
  it.each([
    ['>', '> '],
    ['\n>', '\n> '],
    ['>>', '>> '],
  ])('触发：%j → %j', (doc, expected) => {
    const result = builtinEngine().process(inputCtx(doc as string, (doc as string).length))
    expect(result?.newText).toBe(expected)
  })

  it('不触发：行中 >', () => {
    expect(builtinEngine().process(inputCtx('a>', 2))).toBeNull()
  })

  it('边界：引用中 》 续写（>》 → >> ，[>》] 消耗 》 后插入 > ）', () => {
    expect(builtinEngine().process(inputCtx('>》', 2))?.newText).toBe('>> ')
  })
})

describe('builtin-quote-space（引用标记后补空格，r/50）', () => {
  it('触发：>ab → > ab（$0 解析为尾部空占位，cursor 落补空格后）', () => {
    const result = builtinEngine().process(inputCtx('>ab', 3))
    expect(result?.newText).toBe('> ab')
    expect(result?.matchRange).toEqual({ from: 0, to: 3 })
    expect(result?.tabstops).toEqual([{ number: 0, from: 4, to: 4 }])
    expect(result?.cursor).toBe(4)
  })

  it('不触发：空格已在（> ab）', () => {
    expect(builtinEngine().process(inputCtx('> ab', 4))).toBeNull()
  })

  it('边界：嵌套引用 >>ab 与换行后 >ab（换行前缀不入匹配区间）', () => {
    expect(builtinEngine().process(inputCtx('>>ab', 4))?.newText).toBe('>> ab')
    const result = builtinEngine().process(inputCtx('a\n>ab', 5))
    expect(result?.newText).toBe('\n> ab')
    expect(result?.matchRange).toEqual({ from: 1, to: 5 })
  })
})
