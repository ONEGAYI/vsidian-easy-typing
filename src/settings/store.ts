// 设置读写门面（工单 #3）：包装平台 AddonSettingsContextApi，对内提供
// 「生效设置」单一读取入口。消费形态对齐 vsidian input-behavior 样例的
// channel 拉取 + onChanged 刷新模式：
// - attach 时拉取快照合成生效值（默认回填）；
// - 平台 onChanged（持久化成功后广播）触发对账刷新并通知订阅者——功能票
//   经 facade.effective / onEffectiveChange 消费，不直接触碰平台 API；
// - fail-safe：快照值类型不符 / 枚举越界 / 数组项非字符串 → 该键回默认
//   （平台已按定义校验，此为防御深度，不向用户报错）。
// channel topic 常量一并导出：setup scope 通道（extension.ts 挂载）供
// #16 自绘设置页与诊断消费，宿主与页面共用同一常量源。
import type { AddonSettingsContextApi, AddonSettingsGetSnapshot } from '../../types/vendor/host/addons/addonRegistry'
import type { AddonSettingsUpdateResult } from '../../types/vendor/host/addons/addonSettingsService'
import type { AddonSettingValue } from '../../types/vendor/shared/addonSettings'
import { DEFAULT_EFFECTIVE_SETTINGS, EFFECTIVE_SETTING_KEYS, SPACE_MODE_VALUES, STRICT_LINE_MODE_VALUES, type EffectiveEasyTypingSettings } from './defaults'

/** setup scope 设置通道 topic（页面与宿主共用；载荷形状见各 handler） */
export const SETTINGS_TOPIC = {
  /** 拉取：{ values, sources, effective }（平台快照 + 合成生效值） */
  get: 'easyTyping.settings.get',
  /** 写入：payload { scope: 'user'|'workspace', patch: Record<string, unknown> } → AddonSettingsUpdateResult */
  update: 'easyTyping.settings.update',
  /** 清除工作区覆盖：payload { key: string } → AddonSettingsUpdateResult */
  clearOverride: 'easyTyping.settings.clearOverride',
} as const

/** 规则错误通知通道 topic（工单 #25）：页面侧规则引擎 reportError 上报 →
 * 宿主显示 i18n 警告。payload { ruleId: string; message: string }，返回
 * null（尽力而为通道，页面侧节流）。宿主与页面共用同一常量源（对齐
 * SETTINGS_TOPIC 的落位约定）。 */
export const RULE_ERROR_TOPIC = 'easyTyping.ruleError.notify'

/** 门面对外视图（生效值只读） */
export type EffectiveSettingsView = Readonly<EffectiveEasyTypingSettings>

export interface EasyTypingSettingsFacade {
  /** 当前生效设置（onChanged 后自动替换为新对象；旧引用快照语义） */
  readonly effective: EffectiveSettingsView
  /** 按批写入指定层（透传平台校验结果） */
  update(scope: 'user' | 'workspace', patch: Record<string, unknown>): Promise<AddonSettingsUpdateResult>
  /** 清除工作区对某键的覆盖（恢复继承用户默认） */
  clearWorkspaceOverride(key: string): Promise<AddonSettingsUpdateResult>
  /** 订阅生效设置变化（dispose 前有效；返回退订函数） */
  onEffectiveChange(callback: (settings: EffectiveSettingsView) => void): () => void
  /** 释放（注销平台 onChanged 订阅并清空订阅者；重复调用无害） */
  dispose(): void
}

const STRING_ENUM_KEYS: Readonly<Record<string, readonly string[]>> = {
  inlineCodeSpaceMode: SPACE_MODE_VALUES,
  inlineFormulaSpaceMode: SPACE_MODE_VALUES,
  inlineLinkSpaceMode: SPACE_MODE_VALUES,
  strictLineMode: STRICT_LINE_MODE_VALUES,
}

/** 快照值按定义类型校验（一层边界内的本组件 23 键形态；
 *  目标类型以默认值事实源的键类型为基准） */
function pickValidValue(key: string, value: unknown): AddonSettingValue | undefined {
  if (key === 'excludeFiles') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined
    return [...value]
  }
  const enumValues = STRING_ENUM_KEYS[key]
  if (enumValues) {
    return typeof value === 'string' && enumValues.includes(value) ? value : undefined
  }
  const fallback: unknown = (DEFAULT_EFFECTIVE_SETTINGS as unknown as Record<string, unknown>)[key]
  if (typeof fallback === 'boolean') {
    return typeof value === 'boolean' ? value : undefined
  }
  if (typeof fallback === 'string') {
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}

/** 快照 → 生效值：默认回填 + 非法值回退（fail-safe，不抛错） */
export function readEffectiveSettings(snapshot: AddonSettingsGetSnapshot): EffectiveEasyTypingSettings {
  const result: EffectiveEasyTypingSettings = {
    ...DEFAULT_EFFECTIVE_SETTINGS,
    excludeFiles: [...DEFAULT_EFFECTIVE_SETTINGS.excludeFiles],
  }
  const values = snapshot.values as Readonly<Record<string, unknown>>
  for (const key of EFFECTIVE_SETTING_KEYS) {
    const raw = values[key]
    if (raw === undefined) continue
    const valid = pickValidValue(key, raw)
    if (valid !== undefined) {
      // 值形态已由 pickValidValue 逐键校验（23 键均在 EffectiveEasyTypingSettings 内）
      ;(result as unknown as Record<string, unknown>)[key] = valid
    }
  }
  return result
}

/** 挂接平台设置 API，返回门面（extension.ts 在 setup 中调用） */
export function attachSettings(api: AddonSettingsContextApi): EasyTypingSettingsFacade {
  let current: EffectiveSettingsView = readEffectiveSettings(api.get())
  const listeners = new Set<(settings: EffectiveSettingsView) => void>()
  const changeHandle = api.onChanged(() => {
    current = readEffectiveSettings(api.get())
    for (const callback of listeners) callback(current)
  })
  return {
    get effective() {
      return current
    },
    update: (scope, patch) => api.update(scope, patch),
    clearWorkspaceOverride: (key) => api.clearWorkspaceOverride(key),
    onEffectiveChange(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    dispose() {
      changeHandle.dispose()
      listeners.clear()
    },
  }
}
