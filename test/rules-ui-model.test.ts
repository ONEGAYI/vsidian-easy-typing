// 规则管理 UI 纯逻辑矩阵（工单 #16）：表单模型换算（options 拆解/装配、
// escape/unescape 往返、函数只读锁）、表单校验、作用域切换、拖拽索引换算、
// 列表预览、单规则试运行与 JS 词法器。上游语义对照 easy_typing_settings_tab /
// rule_edit_modal（锚点见 src/rules/rules-ui-model.ts 头注）。
import { describe, expect, it } from 'vitest'
import { RuleScope, RuleTriggerMode, RuleType, type SimpleRule } from '../src/rules/rule-engine'
import {
  buildSimpleRuleFromForm,
  computeDropIndex,
  defaultRuleFormModel,
  formModelFromSimpleRule,
  previewRuleText,
  testSingleRule,
  toggleFormScope,
  tokenizeJs,
  validateRuleForm,
} from '../src/rules/rules-ui-model'

// ===== 表单模型：规则 → 表单 =====

describe('formModelFromSimpleRule（规则 → 表单初值）', () => {
  it('options 全量拆解：类型/触发模式/正则/函数/作用域', () => {
    const rule: SimpleRule = {
      id: 'u1',
      trigger: 'a(b)',
      trigger_right: 'c',
      replacement: 'x',
      options: 'TrFfc',
      regex_flags: 'Mi',
      priority: 7,
      description: 'd',
      enabled: false,
      scope_language: 'python',
    }
    const model = formModelFromSimpleRule(rule)
    expect(model.ruleType).toBe(RuleType.Input)
    expect(model.triggerMode).toBe(RuleTriggerMode.Tab)
    expect(model.isRegex).toBe(true)
    expect(model.functionLocked).toBe(true)
    expect(model.scopes).toEqual([RuleScope.Formula, RuleScope.Code])
    expect(model.priority).toBe(7)
    expect(model.enabled).toBe(false)
    expect(model.description).toBe('d')
    expect(model.scopeLanguage).toBe('python')
  })

  it('Delete/SelectKey 类型与归一 flags', () => {
    const del = formModelFromSimpleRule({ trigger: 'x', replacement: '', options: 'd' })
    expect(del.ruleType).toBe(RuleType.Delete)
    expect(del.triggerMode).toBe(RuleTriggerMode.Auto)
    const sk = formModelFromSimpleRule({ trigger: '\\[', replacement: '', options: 's' })
    expect(sk.ruleType).toBe(RuleType.SelectKey)
    const flags = formModelFromSimpleRule({ trigger: 'x', replacement: '', options: 'r', regex_flags: 'gimx' })
    // 归一：非法字符剔除（g/x 非 i/m/u）、去重、定序
    expect(flags.regexFlags).toBe('im')
  })

  it('非正则触发式的真实控制字符转可见转义', () => {
    const model = formModelFromSimpleRule({ trigger: 'a\nb\\c', replacement: '', options: '' })
    expect(model.trigger).toBe('a\\nb\\\\c')
  })

  it('缺省字段回表单默认值（上游 create 分支同型）', () => {
    const model = formModelFromSimpleRule({ trigger: 'x', replacement: 'y' })
    expect(model.priority).toBe(100)
    expect(model.enabled).toBe(true)
    expect(model.scopes).toEqual([RuleScope.All])
    expect(model.functionLocked).toBe(false)
  })
})

// ===== 表单模型：表单 → 规则 =====

describe('buildSimpleRuleFromForm（表单 → 规则装配）', () => {
  it('options 旗标拼装：Input+Tab+正则+作用域细分', () => {
    const model = defaultRuleFormModel()
    model.triggerMode = RuleTriggerMode.Tab
    model.isRegex = true
    model.scopes = [RuleScope.Text, RuleScope.Code]
    const rule = buildSimpleRuleFromForm(model)
    expect(rule.options).toBe('Trtc')
  })

  it('Delete 类不带 T；All 不带作用域字符；SelectKey + 正则残留 = 上游同形', () => {
    const del = buildSimpleRuleFromForm({ ...defaultRuleFormModel(), ruleType: RuleType.Delete, triggerMode: RuleTriggerMode.Tab })
    expect(del.options).toBe('d')
    // 上游 buildSimpleRule 对 isRegex 无条件拼 r（SelectKey 表单隐藏正则 chip，
    // 该组合不可达；此处钉住与上游一致的装配语义）
    const sk = buildSimpleRuleFromForm({ ...defaultRuleFormModel(), ruleType: RuleType.SelectKey, isRegex: true })
    expect(sk.options).toBe('sr')
    const all = buildSimpleRuleFromForm({ ...defaultRuleFormModel(), scopes: [RuleScope.All] })
    expect(all.options).toBeUndefined()
  })

  it('非正则 trigger unescape 还原（与 escapeText 往返闭合）', () => {
    const source: SimpleRule = { trigger: 'a\nb\\c', trigger_right: 'd\te', replacement: 'r' }
    const model = formModelFromSimpleRule(source)
    const round = buildSimpleRuleFromForm(model)
    expect(round.trigger).toBe('a\nb\\c')
    expect(round.trigger_right).toBe('d\te')
  })

  it('空串可选字段归 undefined；scope_language 仅 Code 作用域携带', () => {
    const model = defaultRuleFormModel()
    model.description = ''
    model.triggerRight = ''
    model.scopeLanguage = 'python'
    let rule = buildSimpleRuleFromForm(model)
    expect(rule.description).toBeUndefined()
    expect(rule.trigger_right).toBeUndefined()
    expect(rule.scope_language).toBeUndefined() // scopes=[All] 不带 language
    model.scopes = [RuleScope.Text]
    rule = buildSimpleRuleFromForm(model)
    expect(rule.scope_language).toBeUndefined() // Text 作用域不携带
    model.scopes = [RuleScope.Code, RuleScope.Text]
    rule = buildSimpleRuleFromForm(model)
    expect(rule.scope_language).toBe('python')
  })

  it('regex_flags 归一并随 isRegex 开关携带', () => {
    const model = defaultRuleFormModel()
    model.isRegex = true
    model.regexFlags = 'umi'
    expect(buildSimpleRuleFromForm(model).regex_flags).toBe('imu')
    model.isRegex = false
    expect(buildSimpleRuleFromForm(model).regex_flags).toBeUndefined()
  })

  it('函数只读锁：replacement 恒取原值（原函数体不可编辑也不可丢失）', () => {
    const original: SimpleRule = {
      trigger: 'x',
      replacement: 'return leftMatches[0];',
      options: 'F',
    }
    const model = formModelFromSimpleRule(original)
    expect(model.functionLocked).toBe(true)
    model.trigger = 'y'
    model.replacement = '篡改体' // 表单只读失效时的防御面：装配仍保留原值
    const rule = buildSimpleRuleFromForm(model, original)
    expect(rule.replacement).toBe('return leftMatches[0];')
    expect(rule.options).toContain('F')
  })

  it('表单 ⇄ 规则全字段往返（非函数规则）', () => {
    const source: SimpleRule = {
      id: 'u-9',
      trigger: '(\\d)',
      trigger_right: '、',
      replacement: 'R$0',
      options: 'Trtf',
      regex_flags: 'mu',
      priority: 42,
      description: 'desc',
      enabled: false,
    }
    const round = buildSimpleRuleFromForm(formModelFromSimpleRule(source))
    expect(round).toEqual({ ...source, id: undefined, trigger_right: '、' })
  })
})

// ===== 校验 =====

describe('validateRuleForm（保存前校验）', () => {
  it('触发式为空 → required', () => {
    const model = defaultRuleFormModel()
    expect(validateRuleForm(model)).toEqual({ field: 'trigger', kind: 'required' })
    model.trigger = '   '
    expect(validateRuleForm(model)?.kind).toBe('required')
  })

  it('非法左正则 → trigger invalid-regex（附宿主错误详情）', () => {
    const model = defaultRuleFormModel()
    model.trigger = '(unclosed'
    model.isRegex = true
    const error = validateRuleForm(model)
    expect(error).toMatchObject({ field: 'trigger', kind: 'invalid-regex' })
    expect(error!.kind === 'invalid-regex' && error.detail.startsWith('trigger:')).toBe(true)
  })

  it('非法右正则 → triggerRight invalid-regex；合法全字段 → null', () => {
    const model = defaultRuleFormModel()
    model.isRegex = true
    model.trigger = 'ok'
    model.triggerRight = '[bad'
    expect(validateRuleForm(model)).toMatchObject({ field: 'triggerRight', kind: 'invalid-regex' })
    model.triggerRight = '[ba]d?'
    expect(validateRuleForm(model)).toBeNull()
  })

  it('非正则模式不校验正则语法', () => {
    const model = defaultRuleFormModel()
    model.trigger = '(unclosed'
    expect(validateRuleForm(model)).toBeNull()
  })
})

// ===== 作用域切换 =====

describe('toggleFormScope（上游 toggleRuleScope 语义）', () => {
  it('点 All 清其余；细分与 All 互斥', () => {
    expect(toggleFormScope([RuleScope.Text], RuleScope.All)).toEqual([RuleScope.All])
    expect(toggleFormScope([RuleScope.All], RuleScope.Code)).toEqual([RuleScope.Code])
  })

  it('细分多选与取消；取消到空回 All', () => {
    expect(toggleFormScope([RuleScope.Text], RuleScope.Code)).toEqual([RuleScope.Text, RuleScope.Code])
    expect(toggleFormScope([RuleScope.Text, RuleScope.Code], RuleScope.Text)).toEqual([RuleScope.Code])
    expect(toggleFormScope([RuleScope.Text], RuleScope.Text)).toEqual([RuleScope.All])
  })
})

// ===== 拖拽索引换算 =====

describe('computeDropIndex（上游 drop 处理器换算）', () => {
  it('源在目标上方：落下半区 = 目标本位，上半区 = 目标-1', () => {
    expect(computeDropIndex(1, 3, true)).toBe(3)
    expect(computeDropIndex(1, 3, false)).toBe(2)
    expect(computeDropIndex(1, 1, false)).toBeNull() // 自身上半区 = no-op
    expect(computeDropIndex(1, 1, true)).toBe(2) // 自身下半区 = 下移一位
  })

  it('源在目标下方：落下半区 = 目标+1，上半区 = 目标', () => {
    expect(computeDropIndex(4, 1, true)).toBe(2)
    expect(computeDropIndex(4, 1, false)).toBe(1)
    expect(computeDropIndex(4, 4, false)).toBeNull() // 上半区紧邻自身 = no-op
    expect(computeDropIndex(4, 4, true)).toBe(5) // 下移一位
  })

  it('负索引防御 → null', () => {
    expect(computeDropIndex(-1, 0, true)).toBeNull()
    expect(computeDropIndex(0, -1, true)).toBeNull()
  })
})

// ===== 列表预览 =====

describe('previewRuleText（无 description 时的触发 → 替换形态）', () => {
  it('description 优先', () => {
    expect(previewRuleText({ trigger: 'x', replacement: 'y', description: '首' })).toBe('首')
  })

  it('非正则触发式转义展示；F 旗标函数体原样展示（上游 repl 分支同语义）；右侧触发式拼接', () => {
    expect(previewRuleText({ trigger: 'a\n', replacement: 'b', options: '' })).toBe('a\\n → b')
    // 上游 repl = typeof replacement === 'string' ? replacement : '(fn)'——
    // 序列化数据中 F 规则的函数体是字符串，列表预览原样展示
    expect(previewRuleText({ trigger: 'x', replacement: 'return 1;', options: 'F' })).toBe('x → return 1;')
    expect(previewRuleText({ trigger: '(', trigger_right: ')', replacement: '', options: 'r' })).toBe('( … ) → ')
  })
})

// ===== 单规则试运行 =====

describe('testSingleRule（规则测试编辑器内核）', () => {
  it('Input 类：光标处命中 → 输出文本与结果光标', () => {
    const outcome = testSingleRule(
      { trigger: '--', replacement: '—', options: '' },
      { docText: 'a--b', from: 3, to: 3 },
    )
    expect(outcome.kind).toBe('hit')
    if (outcome.kind !== 'hit') return
    expect(outcome.result.matchRange).toEqual({ from: 1, to: 3 })
    expect(outcome.outputText).toBe('a—b')
    expect(outcome.cursor).toBe(2)
  })

  it('未命中 → miss', () => {
    const outcome = testSingleRule(
      { trigger: 'zz', replacement: '!', options: '' },
      { docText: 'abc', from: 3, to: 3 },
    )
    expect(outcome).toEqual({ kind: 'miss' })
  })

  it('Delete 类：kind=Delete 驱动匹配（光标在配对括号之间）', () => {
    const outcome = testSingleRule(
      { trigger: '【', trigger_right: '】', replacement: '', options: 'd' },
      { docText: 'a【】b', from: 2, to: 2 },
    )
    expect(outcome.kind).toBe('hit')
    if (outcome.kind !== 'hit') return
    expect(outcome.outputText).toBe('ab')
  })

  it('SelectKey 类：选区文本 + 显式按键（缺省首触发键）', () => {
    const rule: SimpleRule = {
      trigger: '\\[',
      replacement: '【${SEL}】',
      options: 's',
    }
    const explicit = testSingleRule(rule, { docText: 'word', from: 0, to: 4, key: '[' })
    expect(explicit.kind).toBe('hit')
    if (explicit.kind !== 'hit') return
    expect(explicit.outputText).toBe('【word】')
    // 缺省 key：触发键序列首个字符（\[ 解析为 [）
    const implicit = testSingleRule(rule, { docText: 'word', from: 0, to: 4 })
    expect(implicit.kind).toBe('hit')
  })

  it('SelectKey 类无可用触发键 → miss；光标越界钳制', () => {
    expect(testSingleRule({ trigger: '', replacement: 'x', options: 's' }, { docText: 'a', from: 0, to: 0 })).toEqual({ kind: 'miss' })
    const clamped = testSingleRule(
      { trigger: 'a', replacement: 'X', options: '' },
      { docText: 'a', from: 99, to: 99 },
    )
    expect(clamped.kind).toBe('hit')
  })

  it('Tab 模式规则在常规 changeType 下不命中（试运行口径 = Auto 模拟）', () => {
    const outcome = testSingleRule(
      { trigger: 'x', replacement: 'X', options: 'T' },
      { docText: 'x', from: 1, to: 1 },
    )
    expect(outcome.kind).toBe('miss')
  })

  it('捕获组与 tabstop 展开在试运行中可观测', () => {
    const outcome = testSingleRule(
      { trigger: '(\\w)@(\\w)', replacement: '[[1]]·$0[[2]]', options: 'r' },
      { docText: 'a@b', from: 3, to: 3 },
    )
    expect(outcome.kind).toBe('hit')
    if (outcome.kind !== 'hit') return
    expect(outcome.outputText).toBe('a·b')
    expect(outcome.result.tabstops.length).toBe(1)
    expect(outcome.result.tabstops[0]!.number).toBe(0)
  })
})

// ===== JS 词法器 =====

describe('tokenizeJs（上游 tokenizeJS 移植）', () => {
  it('关键字/字符串/数字/行注释/块注释分类', () => {
    const text = 'const a = "s"; // note\nreturn 42; /* bl\\ock */'
    const slices = tokenizeJs(text).map((t) => text.slice(t.from, t.to))
    expect(slices).toContain('const')
    expect(slices).toContain('"s"')
    expect(slices).toContain('42')
    expect(slices).toContain('return')
    expect(slices.filter((s) => s.startsWith('//'))).toHaveLength(1)
    expect(slices.some((s) => s.startsWith('/*') && s.endsWith('*/'))).toBe(true)
  })

  it('转义引号不终结字符串；非关键字词不着色；空串零 token', () => {
    expect(tokenizeJs('"a\\"b"')).toEqual([{ from: 0, to: 6, cls: 'et-hl-string' }])
    expect(tokenizeJs('foo')).toEqual([])
    expect(tokenizeJs('')).toEqual([])
  })
})
