// 自动格式化行为族接入测试（工单 #26）：注册形状契约（06-autoformat /
// input-rules 独占组 / atomic）、onInput 全链（AddonInputContext 形状 →
// 计划）、设置门（autoFormat 总门 + effective 拉取刷新 + 失败保持）、
// #12 粘贴标记注入与语言对富结构种子。
import { describe, expect, it } from 'vitest'
import { createPasteMarker } from '../src/pasteMarker'
import { pickMessages } from '../src/i18n'
import { SETTINGS_TOPIC } from '../src/settings/store'
import { RICH_STRUCTURE_DEFAULTS } from '../src/settings/defaults'
import { INPUT_RULE_EXCLUSIVE_GROUP } from '../src/ruleBehaviorIntercept'
import {
  AUTO_FORMAT_LOCAL_ID,
  createAutoFormatGate,
  defaultAutoFormatEngineSettings,
  registerAutoFormatBehavior,
} from '../src/autoFormatIntercept'
import type { AddonBehaviorRegistration } from '../types/vendor/shared/addonBehaviors'

/** AddonInputContext 形状（快照后：text 已含键入） */
function inputCtx(text: string, head: number, inputText: string, userEvent = 'input.type') {
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
    expect(reg.name).toBe(pickMessages('zh-CN').ruleFamilies.autoFormat.name)
    expect(reg.description).toBeDefined()
    expect((reg.examples ?? []).length).toBeGreaterThan(0)
    expect(typeof reg.onInput).toBe('function')
  })

  it('英文语言标签取英文字典名称', () => {
    const { registrations } = registerAll({ language: 'en-US' })
    expect(registrations[0]!.name).toBe(pickMessages('en-US').ruleFamilies.autoFormat.name)
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
    })
    const reg = registrations[0]!
    expect(reg.onInput(inputCtx('中文a', 3, 'a', 'delete.backward'))).toBeNull()
    marker.markPaste(true)
    expect(reg.onInput(inputCtx('中文a', 3, 'a'))).toBeNull()
    expect(marker.plainPasteInProgress).toBe(false) // 纯文本意图已一次性消费
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
