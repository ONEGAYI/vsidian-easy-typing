// 自动格式化行为族接入测试（工单 #26）：注册形状契约（06-autoformat /
// input-rules 独占组 / atomic）、onInput 全链（AddonInputContext 形状 →
// 计划）、设置门（autoFormat 总门 + effective 拉取刷新 + 失败保持）、
// #12 粘贴标记注入与语言对富结构种子。
import { describe, expect, it } from 'vitest'
import { createPasteMarker } from '../src/pasteMarker'
import { pickMessages } from '../src/i18n'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { RICH_STRUCTURE_DEFAULTS } from '../src/settings/defaults'
import {
  INPUT_RULE_EXCLUSIVE_GROUP,
  inputContextIsMainInstance,
  type InputContextOwnership,
} from '../src/ruleBehaviorIntercept'
import {
  AUTO_FORMAT_LOCAL_ID,
  createAutoFormatGate,
  defaultAutoFormatEngineSettings,
  registerAutoFormatBehavior,
} from '../src/autoFormatIntercept'
import type { SyntaxQuery } from '../src/syntaxTreeQuery'
import { makeSyntaxFake } from './syntaxFake'
import type { AddonBehaviorRegistration } from '../types/vendor/shared/addonBehaviors'

/** 最近一次 inputCtx 的文档文本——reg.onInput(inputCtx(...)) 中 inputCtx
 *  先求值，queryOf 在 onInput 内部读取（#5 判定源与断言坐标一致） */
let lastCtxDoc = ''

/** 语法查询工厂（#5 接线形态：活动文档同文 fake） */
const syntaxQueryOf = (): SyntaxQuery | null => makeSyntaxFake(lastCtxDoc).query

/** AddonInputContext 形状（快照后：text 已含键入） */
function inputCtx(text: string, head: number, inputText: string, userEvent = 'input.type') {
  lastCtxDoc = text
  return {
    userEvent,
    inputText,
    replaced: null,
    docUri: 'file:///a.md',
    snapshot: { text, selections: [{ anchor: head, head }], version: 1, revision: 1 },
  }
}

function registerAll(options: {
  effective?: Record<string, unknown>
  language?: string
  registerResult?: { ok: true; key: string } | { ok: false; reason: string }
}) {
  const registrations: AddonBehaviorRegistration[] = []
  const requestedTopics: string[] = []
  const onChangedCallbacks: Array<() => void> = []
  const outcomes = registerAutoFormatBehavior({
    behaviors: {
      register: (reg) => {
        registrations.push(reg)
        return options.registerResult ?? { ok: true as const, key: `ONEGAYI.vsidian-easy-typing#${reg.id}` }
      },
      onChanged: (cb) => {
        onChangedCallbacks.push(cb)
        return () => {}
      },
    },
    channel: {
      request: (topic) => {
        requestedTopics.push(topic)
        return Promise.resolve({
          ok: true as const,
          result: { effective: options.effective ?? {} },
        })
      },
    },
    language: options.language ?? 'zh-CN',
    marker: createPasteMarker(),
    queryOf: syntaxQueryOf,
  })
  return { registrations, requestedTopics, onChangedCallbacks, outcomes }
}

describe('注册形状契约', () => {
  it('单族注册：id=06-autoformat、独占组 input-rules、history=atomic、i18n 名称', () => {
    const { registrations } = registerAll({})
    expect(registrations.length).toBe(1)
    const reg = registrations[0]!
    expect(reg.id).toBe(AUTO_FORMAT_LOCAL_ID)
    expect(AUTO_FORMAT_LOCAL_ID).toBe('06-autoformat')
    expect(reg.exclusiveGroup).toBe(INPUT_RULE_EXCLUSIVE_GROUP)
    expect(reg.history).toBe('atomic')
    expect(reg.name).toEqual({
      'zh-cn': pickMessages('zh-CN').ruleFamilies.autoFormat.name,
      en: pickMessages('en-US').ruleFamilies.autoFormat.name,
    })
    expect(reg.description).toBeDefined()
    expect((reg.examples ?? []).length).toBeGreaterThan(0)
    expect(typeof reg.onInput).toBe('function')
  })

  it('注册名为双语映射：en 页面语言下不换名（语言仅影响 desc/examples）', () => {
    const { registrations } = registerAll({ language: 'en-US' })
    expect(registrations[0]!.name).toEqual({
      'zh-cn': pickMessages('zh-CN').ruleFamilies.autoFormat.name,
      en: pickMessages('en-US').ruleFamilies.autoFormat.name,
    })
  })

  it('注册拒绝（duplicate-id）不是故障：结果记录 ok:false', () => {
    const { outcomes } = registerAll({ registerResult: { ok: false, reason: 'duplicate-id' } })
    expect(outcomes).toEqual([{ localId: AUTO_FORMAT_LOCAL_ID, ok: false, reason: 'duplicate-id' }])
  })
})

describe('onInput 全链（真实 AddonInputContext 形状）', () => {
  it('中文后键入半角字母 → 计划（#25 零命中基线的空位承接）', async () => {
    const { registrations } = registerAll({})
    const reg = registrations[0]!
    const plan = reg.onInput(inputCtx('中文a', 3, 'a'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 3, text: '中文 a' }],
      selection: { anchor: 4, head: 4 },
    })
  })

  it('autoFormat 总门关闭 → 恒 null（不占用独占组，规则五族不受影响）', async () => {
    const { registrations } = registerAll({ effective: { autoFormat: false } })
    await Promise.resolve()
    expect(registrations[0]!.onInput(inputCtx('中文a', 3, 'a'))).toBeNull()
  })

  it('设置页细粒度键生效（autoCapital 开启 → 句首大写计划）', async () => {
    const { registrations } = registerAll({ effective: { autoCapital: true } })
    await Promise.resolve()
    const plan = registrations[0]!.onInput(inputCtx('abc', 1, 'a'))
    expect(plan).toEqual({
      changes: [{ offset: 0, length: 3, text: 'Abc' }],
      selection: { anchor: 1, head: 1 },
    })
  })

  it('delete.* 与粘贴窗内输入返回 null（#12 联动经注入的 marker）', async () => {
    const marker = createPasteMarker()
    const registrations: AddonBehaviorRegistration[] = []
    registerAutoFormatBehavior({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: 'k' }
        },
        onChanged: () => () => {},
      },
      channel: { request: () => Promise.resolve({ ok: true as const, result: { effective: {} } }) },
      language: 'zh-CN',
      marker,
      queryOf: syntaxQueryOf,
    })
    const reg = registrations[0]!
    expect(reg.onInput(inputCtx('中文a', 3, 'a', 'delete.backward'))).toBeNull()
    marker.markPaste(true)
    expect(reg.onInput(inputCtx('中文a', 3, 'a'))).toBeNull()
    expect(marker.plainPasteInProgress).toBe(false) // 纯文本意图已一次性消费
  })

  it('语法查询缺席（queryOf 返回 null）→ 恒 null 不格式化（#5：不 fallback）', () => {
    const registrations: AddonBehaviorRegistration[] = []
    registerAutoFormatBehavior({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: 'k' }
        },
        onChanged: () => () => {},
      },
      channel: { request: () => Promise.resolve({ ok: true as const, result: { effective: {} } }) },
      language: 'zh-CN',
      marker: createPasteMarker(),
      queryOf: () => null,
    })
    expect(registrations[0]!.onInput(inputCtx('中文a', 3, 'a'))).toBeNull()
  })

  it('设置门：装载时与每次 onChanged 拉取 effective', () => {
    const { requestedTopics, onChangedCallbacks } = registerAll({})
    expect(requestedTopics.filter((t) => t === SETTINGS_TOPIC.get).length).toBeGreaterThanOrEqual(1)
    onChangedCallbacks.forEach((cb) => cb())
    expect(requestedTopics.filter((t) => t === SETTINGS_TOPIC.get).length).toBeGreaterThanOrEqual(2)
  })
})

describe('设置门与富结构种子', () => {
  it('默认引擎配置：语言对取 RICH_STRUCTURE_DEFAULTS 种子、空格档 soft', () => {
    const s = defaultAutoFormatEngineSettings()
    expect(s.autoFormat).toBe(true)
    expect(s.lineFormat.languagePairs).toEqual(
      RICH_STRUCTURE_DEFAULTS.languagePairs.map((p) => ({ a: p.a, b: p.b })),
    )
    expect(s.lineFormat.prefixDictionary).toBe('n8n, /[1234][dD]/\npython3, Python3')
    expect(s.lineFormat.autoCapital).toBe(false)
    expect(s.lineFormat.inlineCodeSpaceMode).toBe(1) // SpaceState.soft
  })

  it('gate：effective 到达后替换缓存；通道失败保持上次值', async () => {
    let response: { ok: true; result: unknown } | { ok: false; reason: string } = {
      ok: true,
      result: { effective: { autoCapital: true } },
    }
    const gate = createAutoFormatGate({ request: () => Promise.resolve(response) })
    expect(gate.settings().lineFormat.autoCapital).toBe(false) // 首拉前出厂默认
    await gate.refresh()
    expect(gate.settings().lineFormat.autoCapital).toBe(true)
    response = { ok: false, reason: 'released' }
    await gate.refresh()
    expect(gate.settings().lineFormat.autoCapital).toBe(true) // 失败保持
  })

  /** mock 通道返回值收窄（判别联合字面量形态） */
  const respond = (outcome: unknown) =>
    Promise.resolve(outcome as { ok: true; result: unknown } | { ok: false; reason: string })

  it('gate：RULES 通道下发语言对与自定义类（#49 引擎消费接线）', async () => {
    const responses = new Map<string, unknown>([
      ['easyTyping.settings.get', { ok: true, result: { effective: {} } }],
      [
        'easyTyping.rules.get',
        {
          ok: true,
          result: {
            revision: 3,
            builtin: [],
            user: [],
            deletedBuiltinRuleIds: [],
            languagePairs: [{ a: ' japanese ', b: 'english' }],
            customScriptCategories: [{ name: 'greek', pattern: 'Α-Ωα-ω' }],
          },
        },
      ],
    ])
    const gate = createAutoFormatGate({
      request: (topic: string) => respond(responses.get(topic) ?? { ok: false, reason: 'rejected' }),
    })
    await gate.refresh()
    expect(gate.settings().lineFormat.languagePairs).toEqual([{ a: 'japanese', b: 'english' }])
    expect(gate.settings().lineFormat.customScriptCategories).toEqual([
      { name: 'greek', pattern: 'Α-Ωα-ω' },
    ])
  })

  it('gate：RULES 通道失败/畸形保持当前富结构值（两轮刷新钉住：首轮成功下发的用户值不被 settings 面重建打回种子——审查轮 1 P1）', async () => {
    let rulesResponse: unknown = {
      ok: true,
      result: { languagePairs: [], customScriptCategories: [] }, // 用户删光全部对（合法态）
    }
    const gate = createAutoFormatGate({
      request: (topic: string) =>
        respond(
          topic === 'easyTyping.settings.get'
            ? { ok: true, result: { effective: {} } }
            : rulesResponse,
        ),
    })
    await gate.refresh()
    expect(gate.settings().lineFormat.languagePairs).toEqual([])
    // settings 成功 + rules 失败（瞬时超时）：保持用户值，不回出厂种子
    rulesResponse = { ok: false, reason: 'timeout' }
    await gate.refresh()
    expect(gate.settings().lineFormat.languagePairs).toEqual([])
    expect(gate.settings().lineFormat.customScriptCategories).toEqual([])
    // 首拉前通道失败保持出厂种子（三对）
    const freshGate = createAutoFormatGate({
      request: (topic: string) =>
        respond(
          topic === 'easyTyping.settings.get'
            ? { ok: true, result: { effective: {} } }
            : { ok: false, reason: 'rejected' },
        ),
    })
    await freshGate.refresh()
    expect(freshGate.settings().lineFormat.languagePairs).toEqual(
      RICH_STRUCTURE_DEFAULTS.languagePairs.map((p) => ({ a: p.a, b: p.b })),
    )
    // 畸形字段（languagePairs 非数组）同样保持当前值
    rulesResponse = { ok: true, result: { languagePairs: 'bad', customScriptCategories: [] } }
    await gate.refresh()
    expect(gate.settings().lineFormat.languagePairs).toEqual([])
  })

  it('gate：effective 值类型失配回默认（fail-safe）', async () => {
    const gate = createAutoFormatGate({
      request: () =>
        Promise.resolve({ ok: true as const, result: { effective: { autoCapital: 'yes', prefixDictionary: 3 } } }),
    })
    await gate.refresh()
    expect(gate.settings().lineFormat.autoCapital).toBe(false)
    expect(gate.settings().lineFormat.prefixDictionary).toBe('n8n, /[1234][dD]/\npython3, Python3')
  })

  it('gate：SpaceMode 字符串档位映射为数字档位', async () => {
    const gate = createAutoFormatGate({
      request: () =>
        Promise.resolve({
          ok: true as const,
          result: {
            effective: { inlineCodeSpaceMode: 'strict', inlineFormulaSpaceMode: 'none' },
          },
        }),
    })
    await gate.refresh()
    expect(gate.settings().lineFormat.inlineCodeSpaceMode).toBe(2)
    expect(gate.settings().lineFormat.inlineFormulaSpaceMode).toBe(0)
  })
})

// ===== 工单 #27：格式化管线的保护区接入（设置驱动内置计算） =====
//
// 语义锚点：上游 core.ts:181-183——UserDefinedRegSwitch 开 → UserDefinedRegExp
// 进分区解析（user 分区生效）；关 → 不带。内置计算为 #26 注入缝
// protectedRangesFor 的默认实现，外部注入仍优先。

describe('#27 保护区：设置驱动内置计算', () => {
  /** 计划的变更分段应用到快照文本 → 最终行（变更表形态断言的可读化） */
  function applyPlan(text: string, plan: { changes: Array<{ offset: number; length: number; text: string }> } | null): string {
    expect(plan).not.toBeNull()
    let out = text
    for (const c of [...plan!.changes].sort((a, b) => b.offset - a.offset)) {
      out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
    }
    return out
  }

  async function registerWithEffective(effective: Record<string, unknown>) {
    const registrations: AddonBehaviorRegistration[] = []
    registerAutoFormatBehavior({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: 'k' }
        },
        onChanged: () => () => {},
      },
      channel: {
        request: () => Promise.resolve({ ok: true as const, result: { effective } }),
      },
      language: 'zh-CN',
      marker: createPasteMarker(),
      queryOf: syntaxQueryOf,
    })
    await Promise.resolve() // gate refresh 微任务
    return registrations[0]!
  }

  it('默认生效（switch 出厂 true + 出厂模板）：{{}} 内键入 → 全行保护区无格式化', async () => {
    const reg = await registerWithEffective({})
    // 快照 {{中文a}}（head=5，inputText=a）：{{.*?}} 命中 [0,7) 覆盖整行
    expect(reg.onInput(inputCtx('{{中文a}}', 5, 'a'))).toBeNull()
  })

  it('userDefinedRegSwitch 关闭 → 同场景恢复格式化（上游开关语义）', async () => {
    const reg = await registerWithEffective({ userDefinedRegSwitch: false })
    expect(applyPlan('{{中文a}}', reg.onInput(inputCtx('{{中文a}}', 5, 'a')))).toBe('{{中文 a}}')
  })

  it('行内混合：保护区外边界照常格式化，{{}} 区间内容不动', async () => {
    const reg = await registerWithEffective({})
    // 快照 中文a{{x}}中文（head=3，inputText=a）：中|a 边界插空格；
    // {{x}} 为 user 分区（|++ 严格空格两侧）——边界空格由分区策略驱动
    expect(applyPlan('中文a{{x}}中文', reg.onInput(inputCtx('中文a{{x}}中文', 3, 'a')))).toBe(
      '中文 a {{x}} 中文',
    )
  })

  it('用户自定义模板经设置生效（\\d+|--：数字保护区邻接不插空格）', async () => {
    const reg = await registerWithEffective({ userDefinedRegExp: '\\d+|--' })
    // 快照 文1文（head=2，inputText=1）：chinese-digit 语言对想加空格，
    // 数字在保护区且旗标 none/none → 无变更
    expect(reg.onInput(inputCtx('文1文', 2, '1'))).toBeNull()
  })

  it('外部 protectedRangesFor 注入优先于内置计算（#26 注入缝保留）', async () => {
    const registrations: AddonBehaviorRegistration[] = []
    registerAutoFormatBehavior({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: 'k' }
        },
        onChanged: () => () => {},
      },
      channel: {
        request: () => Promise.resolve({ ok: true as const, result: { effective: {} } }),
      },
      language: 'zh-CN',
      marker: createPasteMarker(),
      queryOf: syntaxQueryOf,
      // 外部只保护 [0,3)（{{中）：a 与 }} 仍在区外，格式化可发生
      protectedRangesFor: (line) =>
        line.startsWith('{{中')
          ? [{ begin: 0, end: 3, leftSpaceRequire: 'none', rightSpaceRequire: 'none' }]
          : [],
    })
    const reg = registrations[0]!
    // 快照 {{中文a}}：外部区间 [0,3)，a 与 }} 区间外——中文|a 边界照常格式化
    expect(applyPlan('{{中文a}}', reg.onInput(inputCtx('{{中文a}}', 5, 'a')))).toBe('{{中文 a}}')
  })
})

// 实例一致性守卫（评审 R2-B1）：平台行为链同样驱动嵌入（embed）Live 实例
// ——其 ctx.snapshot/docUri 是嵌入实例的，而 queryOf 恒返回主实例查询，
// 作用域判定会以主文档同偏移误判嵌入文档。守卫注入后 onInput 入口比对，
// 不一致即放弃该次行为修饰。
describe('实例一致性守卫（评审 R2-B1：嵌入实例驱动不接管）', () => {
  function registerWithGuard(ownsContext: InputContextOwnership): AddonBehaviorRegistration {
    const registrations: AddonBehaviorRegistration[] = []
    registerAutoFormatBehavior({
      behaviors: {
        register: (reg) => {
          registrations.push(reg)
          return { ok: true as const, key: 'k' }
        },
        onChanged: () => () => {},
      },
      channel: { request: () => Promise.resolve({ ok: true as const, result: { effective: {} } }) },
      language: 'zh-CN',
      marker: createPasteMarker(),
      queryOf: syntaxQueryOf,
      ownsContext,
    })
    return registrations[0]!
  }

  it('ctx.snapshot.text ≠ 主视图文档（嵌入实例快照）→ onInput 直接 null（查询与格式化均不发生）', () => {
    // 守卫走快照全文比对路径（mainDocUri 不可得）：主视图文档是另一文本
    const reg = registerWithGuard((ctx) => inputContextIsMainInstance(ctx, null, '主实例的另一篇文档'))
    expect(reg.onInput(inputCtx('中文a', 3, 'a'))).toBeNull()
  })

  it('ctx.docUri ≠ 主实例 targetDocUri（嵌入目标文档）→ null；docUri 同源比对路径', () => {
    const reg = registerWithGuard((ctx) => inputContextIsMainInstance(ctx, 'file:///v/main.md', null))
    // 主实例驱动（同 URI）：照常格式化（守卫不误伤主实例键入）
    expect(reg.onInput({ ...inputCtx('中文a', 3, 'a'), docUri: 'file:///v/main.md' })).not.toBeNull()
    // 嵌入实例驱动（引用目标 B 的 URI）：不接管
    expect(reg.onInput({ ...inputCtx('中文a', 3, 'a'), docUri: 'file:///v/embed-b.md' })).toBeNull()
  })

  it('守卫返回 false 先于其余门控（与查询拒绝同一「不接管」语义，不占独占组）', () => {
    // 快照文本与主视图一致但守卫判否（活动视图缺席形态：主视图未挂）——
    // 即便设置全开 + 查询在场也直接放弃
    const reg = registerWithGuard(() => false)
    expect(reg.onInput(inputCtx('中文a', 3, 'a'))).toBeNull()
  })
})

// 工单 #28 增量：文件排除（ExcludeFiles × #407 docUri）——上游
// cm_extensions.ts:417 `!AutoFormat || isCurrentFileExclude` 的同序接入。
describe('文件排除（#28：excludeFiles × ctx.docUri）', () => {
  it('docUri 命中排除清单 → 恒 null（引用目标文档判定，非宿主文档）', async () => {
    const { registrations } = registerAll({ effective: { excludeFiles: ['DailyNote/'] } })
    await Promise.resolve()
    const reg = registrations[0]!
    // embed 视图语义：docUri 是引用目标 B（排除命中）——与宿主文档无关
    const embedCtx = { ...inputCtx('中文a', 3, 'a'), docUri: 'file:///v/DailyNote/引用目标.md' }
    expect(reg.onInput(embedCtx)).toBeNull()
    // 文件级精确命中同型
    expect(reg.onInput({ ...inputCtx('中文a', 3, 'a'), docUri: 'file:///v/DailyNote/a.md' })).toBeNull()
  })

  it('未命中清单照常格式化；autoFormat 关闭先于排除判定（上游同序）', async () => {
    const { registrations } = registerAll({ effective: { excludeFiles: ['DailyNote/'] } })
    await Promise.resolve()
    const ctx = { ...inputCtx('中文a', 3, 'a'), docUri: 'file:///v/free/a.md' }
    expect(registrations[0]!.onInput(ctx)).not.toBeNull()
  })

  it('gate：excludeFiles 数组校验（非字符串数组回默认空清单）', async () => {
    const gate = createAutoFormatGate({
      request: () => Promise.resolve({ ok: true as const, result: { effective: { excludeFiles: 'DailyNote/' } } }),
    })
    await gate.refresh()
    expect(gate.settings().excludeFiles).toEqual([])
    const gate2 = createAutoFormatGate({
      request: () =>
        Promise.resolve({ ok: true as const, result: { effective: { excludeFiles: ['DailyNote/', 3] } } }),
    })
    await gate2.refresh()
    expect(gate2.settings().excludeFiles).toEqual([])
  })
})
