// 规则引擎内核机制矩阵（工单 #1）：逐项钉住上游 rule_engine.ts 的机制语义——
// options 旗标解析、左右正则匹配（左端锚定/右端起始）、捕获组引用 [[n]]/[[Rn]]、
// flags（i/m/u）、作用域与代码语言过滤、优先级与插入序、正则缓存、函数替换体、
// 替换体反转义。上游对照：easy-typing-obsidian v6.0.9 src/rule_engine.ts。
//
// 本票边界（工单 #1 硬边界，口径见 docs/specs/rule-engine.md）：
// - Tabstop 语法解析（$0/$1 → 占位符与光标）归 #14：替换体中的 $0 保留为
//   字面标记，ApplyResult.tabstops 恒为空，cursor 取插入尾（上游无 tabstop
//   分支的同款语义）。
// - Delete/SelectKey 仅建模（枚举/规则形态/process 分派在位），触发管线归 #9；
//   本文件用 kind:Delete/SelectKey 的用例只验证内核共享路径，不是端到端。
import { describe, expect, it, vi } from 'vitest'
import {
  RuleEngine,
  RuleScope,
  RuleTriggerMode,
  RuleType,
  type ApplyResult,
  type SimpleRule,
  type TxContext,
} from '../src/rules/rule-engine'

/** 构造 Input 类触发上下文：docText 已含刚键入的字符，selection 在其后 */
function inputCtx(docText: string, cursor: number, overrides: Partial<TxContext> = {}): TxContext {
  return {
    kind: RuleType.Input,
    docText,
    selection: { from: cursor, to: cursor },
    inserted: '',
    changeType: 'input.type',
    scopeHint: RuleScope.Text,
    ...overrides,
  }
}

/** 注册单条自定义规则的最小引擎（内核机制隔离测试用，不带内置规则） */
function engineWith(rule: SimpleRule, reportError?: (id: string, msg: string) => void): RuleEngine {
  const engine = new RuleEngine({ reportError })
  engine.addSimpleRule(rule)
  return engine
}

describe('parseOptions 旗标语义（上游 RuleEngine.parseOptions）', () => {
  it('空 options：Input / Auto / 非正则 / 非函数 / 作用域 All', () => {
    expect(RuleEngine.parseOptions('')).toEqual({
      type: RuleType.Input,
      triggerMode: RuleTriggerMode.Auto,
      isRegex: false,
      isFunctionReplacement: false,
      scope: [RuleScope.All],
    })
  })

  it('rF = Input 正则 + 函数体；组合旗标各归各位', () => {
    expect(RuleEngine.parseOptions('rF')).toMatchObject({
      type: RuleType.Input,
      isRegex: true,
      isFunctionReplacement: true,
      triggerMode: RuleTriggerMode.Auto,
    })
  })

  it('d / s 分别判 Delete / SelectKey；T 判 Tab 触发模式', () => {
    expect(RuleEngine.parseOptions('d').type).toBe(RuleType.Delete)
    expect(RuleEngine.parseOptions('drF').type).toBe(RuleType.Delete)
    expect(RuleEngine.parseOptions('s').type).toBe(RuleType.SelectKey)
    expect(RuleEngine.parseOptions('T').triggerMode).toBe(RuleTriggerMode.Tab)
    expect(RuleEngine.parseOptions('rT').triggerMode).toBe(RuleTriggerMode.Tab)
  })

  it('作用域：t/f/c 组合；a 或无 t/f/c 时为 All', () => {
    expect(RuleEngine.parseOptions('t').scope).toEqual([RuleScope.Text])
    expect(RuleEngine.parseOptions('f').scope).toEqual([RuleScope.Formula])
    expect(RuleEngine.parseOptions('c').scope).toEqual([RuleScope.Code])
    expect(RuleEngine.parseOptions('rtf').scope).toEqual([RuleScope.Text, RuleScope.Formula])
    expect(RuleEngine.parseOptions('a').scope).toEqual([RuleScope.All])
    expect(RuleEngine.parseOptions('at').scope).toEqual([RuleScope.All])
  })
})

describe('normalizeRegexFlags（仅 i/m/u，去重排序）', () => {
  it('过滤非法旗标并小写化', () => {
    expect(RuleEngine.normalizeRegexFlags('gIMx')).toBe('im')
    expect(RuleEngine.normalizeRegexFlags('uu i')).toBe('iu')
    expect(RuleEngine.normalizeRegexFlags('xyz')).toBe('')
    expect(RuleEngine.normalizeRegexFlags('')).toBe('')
  })
})

describe('validateRegex / escapeText / unescapeText / 触发键解析（静态工具）', () => {
  it('validateRegex：合法返回 null，非法返回带字段的错误信息', () => {
    expect(RuleEngine.validateRegex({ trigger: 'a(b', trigger_right: '', replacement: '', options: 'r' })).toMatch(/^trigger:/)
    expect(RuleEngine.validateRegex({ trigger: 'ok', trigger_right: '(x', replacement: '', options: 'r' })).toMatch(/^trigger_right:/)
    expect(RuleEngine.validateRegex({ trigger: 'a(b', replacement: '', options: '' })).toBeNull()
  })

  it('escapeText / unescapeText 互逆：控制字符可见化与还原', () => {
    const raw = 'a\nb\tc\\d\re'
    const visible = RuleEngine.escapeText(raw)
    expect(visible).toBe('a\\nb\\tc\\\\d\\re')
    expect(RuleEngine.unescapeText(visible)).toBe(raw)
    // escapeText 默认转义反斜杠；preserveBackslashes 保留（上游 UI 语义）
    expect(RuleEngine.escapeText('a\\b', true)).toBe('a\\b')
  })

  it('parseSelectKeyRuleTriggerKeys：逐字符切分，反斜杠转义还原', () => {
    expect(RuleEngine.parseSelectKeyRuleTriggerKeys('·ab')).toEqual(['·', 'a', 'b'])
    expect(RuleEngine.parseSelectKeyRuleTriggerKeys('\\·\\【')).toEqual(['·', '【'])
  })
})

describe('normalizeRule 规则归一（SimpleRule → ConvertRule）', () => {
  it('默认值：priority 100、enabled true；regex_flags 仅正则规则归一', () => {
    const rule = RuleEngine.normalizeRule({ trigger: 'x', replacement: 'y', options: 'r', regex_flags: 'GI' })
    expect(rule.priority).toBe(100)
    expect(rule.enabled).toBe(true)
    expect(rule.regexFlags).toBe('i')
    expect(RuleEngine.normalizeRule({ trigger: 'x', replacement: 'y', regex_flags: 'i' }).regexFlags).toBeUndefined()
  })

  it('SelectKey 类：trigger 解析为 triggerKeys，匹配面清空，triggerMode 恒 Auto', () => {
    const rule = RuleEngine.normalizeRule({ trigger: '【¥￥', replacement: 'x', options: 'sF' })
    expect(rule.type).toBe(RuleType.SelectKey)
    expect(rule.triggerKeys).toEqual(['【', '¥', '￥'])
    expect(rule.match).toEqual({ left: '', right: '', isRegex: false })
    expect(rule.triggerMode).toBe(RuleTriggerMode.Auto)
  })

  it('Delete 类强制 Auto 触发模式（T 旗标不生效）', () => {
    const rule = RuleEngine.normalizeRule({ trigger: '$', replacement: '', options: 'dT' })
    expect(rule.type).toBe(RuleType.Delete)
    expect(rule.triggerMode).toBe(RuleTriggerMode.Auto)
  })

  it('F 旗标把函数体字符串编译为函数', () => {
    const rule = RuleEngine.normalizeRule({
      trigger: 'x',
      replacement: "return leftMatches[0] + '!';",
      options: 'rF',
    })
    expect(typeof rule.replacement).toBe('function')
    expect((rule.replacement as (l: string[], r: string[]) => string)(['x'], [])).toBe('x!')
  })

  it('函数体编译失败：静默为永不返回的替换体并上报，不中断装配', () => {
    const reportError = vi.fn()
    const engine = new RuleEngine({ reportError })
    engine.addSimpleRule({ trigger: 'x', replacement: 'return syntax error((', options: 'rF' })
    expect(reportError).toHaveBeenCalledTimes(1)
    // 死替换体：函数返回 undefined → process 永不命中
    expect(engine.process(inputCtx('x', 1))).toBeNull()
  })
})

describe('左右匹配语义（左端正则锚定 / 右端起始匹配）', () => {
  it('非正则触发按字面转义：. 与 ( 不当元字符', () => {
    const dot = engineWith({ trigger: '.', replacement: 'DOT', options: '' })
    expect(dot.process(inputCtx('a.', 2))?.newText).toBe('DOT')
    expect(dot.process(inputCtx('ax', 2))).toBeNull()
    const paren = engineWith({ trigger: '(', replacement: 'P', options: '' })
    expect(paren.process(inputCtx('a(', 2))?.newText).toBe('P')
  })

  it('左正则必须匹配到左文末尾（贪婪取最长）', () => {
    const engine = engineWith({ trigger: 'a+', replacement: '[$0 marker]', options: 'r' })
    const result = engine.process(inputCtx('aaa', 3))
    expect(result?.matchRange).toEqual({ from: 0, to: 3 })
  })

  it('右正则锚定右文起始；右侧不匹配则整条不触发', () => {
    const engine = engineWith({ trigger: 'a', trigger_right: 'b|c', replacement: 'X', options: 'r' })
    expect(engine.process(inputCtx('abc', 1))?.newText).toBe('X')
    expect(engine.process(inputCtx('axc', 1))).toBeNull()
  })

  it('右侧可选（空匹配放行）与缺省（无右侧约束）', () => {
    const optional = engineWith({ trigger: '好', trigger_right: '\\)?', replacement: 'X', options: 'r' })
    expect(optional.process(inputCtx('好', 1))?.newText).toBe('X')
    expect(optional.process(inputCtx('好)', 1))?.newText).toBe('X')
    const noRight = engineWith({ trigger: '好', replacement: 'X', options: '' })
    expect(noRight.process(inputCtx('好', 1))?.newText).toBe('X')
  })
})

describe('捕获组引用 [[n]] / [[Rn]] 与 ${SEL} / ${KEY}', () => {
  it('[[n]] 取左匹配组，[[Rn]] 取右匹配组', () => {
    const engine = engineWith({
      trigger: 'a(b)',
      trigger_right: '(z)',
      replacement: '[[1]]|[[R1]]',
      options: 'r',
    })
    expect(engine.process(inputCtx('abz', 2))?.newText).toBe('b|z')
  })

  it('[[n]] 左组缺省时回退右组，双双缺省为空串', () => {
    const engine = engineWith({
      trigger: 'a(b)',
      trigger_right: '(z)',
      replacement: '[[9]]|[[R9]]|[[1]]',
      options: 'r',
    })
    expect(engine.process(inputCtx('abz', 2))?.newText).toBe('||b')
  })

  it('SelectKey 执行路径展开 ${SEL}/${KEY}（共享路径，触发管线归 #9）', () => {
    const engine = engineWith({ trigger: '·', replacement: '<${SEL}|${KEY}>', options: 's' })
    const result = engine.process({
      kind: RuleType.SelectKey,
      docText: 'xabcz',
      selection: { from: 1, to: 4 },
      inserted: '·',
      changeType: 'input.type',
      scopeHint: RuleScope.Text,
      key: '·',
    })
    // 本票边界：${0:...} 占位符不解析（归 #14），${SEL}/${KEY} 展开为真实文本
    expect(result?.newText).toBe('<abc|·>')
    expect(result?.matchRange).toEqual({ from: 1, to: 4 })
  })
})

describe('flags（i/m/u）', () => {
  it('i：大小写不敏感', () => {
    const engine = engineWith({ trigger: 'ok', replacement: 'X', options: 'r', regex_flags: 'i' })
    expect(engine.process(inputCtx('OK', 2))?.newText).toBe('X')
  })

  it('m：^ 在行首锚定（含 \n 后）', () => {
    const withM = engineWith({ trigger: '^x', replacement: 'M', options: 'r', regex_flags: 'm' })
    expect(withM.process(inputCtx('a\nx', 3))?.newText).toBe('M')
    const withoutM = engineWith({ trigger: '^x', replacement: 'N', options: 'r' })
    expect(withoutM.process(inputCtx('a\nx', 3))).toBeNull()
  })

  it('u：u 旗标随编译进入正则（iu 组合可用）', () => {
    const engine = engineWith({ trigger: 'ok', replacement: 'X', options: 'r', regex_flags: 'iu' })
    expect(engine.process(inputCtx('Ok', 2))?.newText).toBe('X')
  })
})

describe('作用域限定与代码语言过滤（可注入判定，内核不做语法树判定）', () => {
  const mixed = { trigger: 'x', replacement: 'MIX', options: 'rtc', scope_language: 'py' } as const

  it('混合作用域 [Text, Code]+语言：Text 放行，Code 按语言过滤', () => {
    const engine = engineWith({ ...mixed })
    expect(engine.process(inputCtx('x', 1, { scopeHint: RuleScope.Text }))?.newText).toBe('MIX')
    expect(
      engine.process(inputCtx('x', 1, { scopeHint: RuleScope.Code, scopeLanguage: 'py' }))?.newText,
    ).toBe('MIX')
    expect(engine.process(inputCtx('x', 1, { scopeHint: RuleScope.Code, scopeLanguage: 'js' }))).toBeNull()
    // 上下文未给语言（undefined !== 'py'）→ 不放行（上游语义如实保留）
    expect(engine.process(inputCtx('x', 1, { scopeHint: RuleScope.Code }))).toBeNull()
  })

  it('scope 不含 hint 且规则非 All → 跳过；hint All 或规则 All 放行', () => {
    const textOnly = engineWith({ trigger: 'x', replacement: 'T', options: 't' })
    expect(textOnly.process(inputCtx('x', 1))?.newText).toBe('T')
    expect(
      textOnly.process(inputCtx('x', 1, { scopeHint: RuleScope.Formula })),
    ).toBeNull()
    expect(
      textOnly.process(inputCtx('x', 1, { scopeHint: RuleScope.All })),
    ).not.toBeNull()
    const allScope = engineWith({ trigger: 'x', replacement: 'A', options: '' })
    expect(
      allScope.process(inputCtx('x', 1, { scopeHint: RuleScope.Code, scopeLanguage: 'js' }))?.newText,
    ).toBe('A')
  })
})

describe('优先级、插入序与触发模式', () => {
  function twoRuleEngine(): RuleEngine {
    const engine = new RuleEngine()
    engine.addSimpleRule({ trigger: 'x', replacement: 'FIRST', options: '', priority: 5 })
    engine.addSimpleRule({ trigger: 'x', replacement: 'SECOND', options: '', priority: 10 })
    return engine
  }

  it('数字小者优先命中；同优先级按注册先后', () => {
    expect(twoRuleEngine().process(inputCtx('x', 1))?.newText).toBe('FIRST')
    const equal = new RuleEngine()
    equal.addSimpleRule({ trigger: 'x', replacement: 'EARLY', options: '', priority: 5 })
    equal.addSimpleRule({ trigger: 'x', replacement: 'LATE', options: '', priority: 5 })
    expect(equal.process(inputCtx('x', 1))?.newText).toBe('EARLY')
  })

  it('禁用规则跳过，setEnabled 恢复后可命中', () => {
    const engine = twoRuleEngine()
    engine.setEnabled(engine.getRules()[0]!.id, false)
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('SECOND')
    engine.setEnabled(engine.getRules()[0]!.id, true)
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('FIRST')
  })

  it('T 触发模式仅响应 changeType=tab；Auto 规则在 tab 事务跳过', () => {
    const tabRule = engineWith({ trigger: 'x', replacement: 'TAB', options: 'T' })
    expect(tabRule.process(inputCtx('x', 1))).toBeNull()
    expect(tabRule.process(inputCtx('x', 1, { changeType: 'tab' }))?.newText).toBe('TAB')
    const autoRule = engineWith({ trigger: 'x', replacement: 'AUTO', options: '' })
    expect(autoRule.process(inputCtx('x', 1, { changeType: 'tab' }))).toBeNull()
  })
})

describe('正则缓存', () => {
  it('非法正则：规则跳过并上报一次，同批其他规则仍可命中', () => {
    const reportError = vi.fn()
    const engine = new RuleEngine({ reportError })
    engine.addSimpleRule({ id: 'bad', trigger: '(', replacement: 'BAD', options: 'r', priority: 1 })
    engine.addSimpleRule({ trigger: 'x', replacement: 'GOOD', options: '', priority: 10 })
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('GOOD')
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError.mock.calls[0]![0]).toBe('bad')
    engine.process(inputCtx('x', 1))
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('updateRule 更换匹配面后缓存失效，新模式生效', () => {
    const engine = new RuleEngine()
    const id = engine.addSimpleRule({ trigger: 'a', replacement: 'A', options: '' })
    expect(engine.process(inputCtx('a', 1))?.newText).toBe('A')
    engine.updateRule(id, { match: { left: 'b', right: '', isRegex: false } })
    expect(engine.process(inputCtx('a', 1))).toBeNull()
    expect(engine.process(inputCtx('b', 1))?.newText).toBe('A')
  })

  it('removeRule 后可重用 id 缺省自增，getRules 同步收缩', () => {
    const engine = new RuleEngine()
    const id = engine.addSimpleRule({ trigger: 'a', replacement: 'A', options: '' })
    expect(engine.removeRule(id)).toBe(true)
    expect(engine.getRule(id)).toBeUndefined()
    expect(engine.getRules()).toHaveLength(0)
    expect(engine.removeRule(id)).toBe(false)
  })
})

describe('函数替换体执行', () => {
  it('返回 undefined 视为不命中，落穿到后续规则', () => {
    const engine = new RuleEngine()
    engine.addSimpleRule({
      trigger: 'x',
      replacement: "if (leftMatches[0] !== 'zzz') return undefined; return 'NEVER';",
      options: 'F',
      priority: 1,
    })
    engine.addSimpleRule({ trigger: 'x', replacement: 'FALLBACK', options: '', priority: 10 })
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('FALLBACK')
  })

  it('运行时异常：节流上报（5 秒内一次）且不命中，后续规则继续', () => {
    const reportError = vi.fn()
    const engine = new RuleEngine({ reportError })
    engine.addSimpleRule({ trigger: 'x', replacement: 'throw new Error("boom");', options: 'F', priority: 1 })
    engine.addSimpleRule({ trigger: 'x', replacement: 'NEXT', options: '', priority: 10 })
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('NEXT')
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('NEXT')
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError.mock.calls[0]![0]).toMatch(/^rule-/)
  })
})

describe('替换体后处理（反转义 + $0 字面保留边界）', () => {
  it('替换体中的 \\n/\\t/\\\\ 反转义为真实字符', () => {
    const engine = engineWith({ trigger: 'x', replacement: 'a\\n\\t\\\\b', options: '' })
    expect(engine.process(inputCtx('x', 1))?.newText).toBe('a\n\t\\b')
  })

  it('$0 保留为字面标记；tabstops 恒空，cursor 取插入尾（#14 边界）', () => {
    const engine = engineWith({ trigger: 'x', replacement: 'a$0b', options: '' })
    const result: ApplyResult | null = engine.process(inputCtx('-x', 2))
    expect(result).not.toBeNull()
    expect(result!.newText).toBe('a$0b')
    expect(result!.tabstops).toEqual([])
    expect(result!.cursor).toBe(result!.matchRange.from + 'a$0b'.length)
    expect(result!.matchRange).toEqual({ from: 1, to: 2 })
  })
})

describe('内核零平台依赖（票面验收：import 语句扫描钉住）', () => {
  it('src/rules 下不允许任何平台/运行时 import（obsidian/SDK/vscode/CM6/DOM）', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rules')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const file of files) {
      const lines = readFileSync(path.join(dir, file), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/^\s*import\b/.test(line)) return
        // 规则模块只允许模块内相对 type 导入（数据模块引用内核类型）
        expect(
          /^import type \{[^}]*\} from '\.\/[a-z-]+';?$/.test(line.trim()),
          `src/rules/${file}:${index + 1} 非法导入：${line.trim()}`,
        ).toBe(true)
        for (const banned of ['obsidian', 'vsidian-addon-sdk', 'vscode', '@codemirror', 'types/vendor']) {
          expect(line, `src/rules/${file}:${index + 1} 含平台依赖 ${banned}`).not.toContain(banned)
        }
      })
    }
  })
})
