// debug 日志门控契约（工单 #3）：设置驱动的最小日志通道——上游 utils.ts
// print/setDebug 的移植形态。输出经 console（宿主侧 = 扩展宿主控制台），
// 统一前缀便于用户过滤；门控状态由设置链路（debug 键）驱动。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { debugLog, isDebugEnabled, setDebugEnabled } from '../src/logging'

afterEach(() => {
  setDebugEnabled(false)
  vi.restoreAllMocks()
})

describe('debug 日志门控', () => {
  it('默认关闭：debugLog 不输出', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(isDebugEnabled()).toBe(false)
    debugLog('不应出现')
    expect(log).not.toHaveBeenCalled()
  })

  it('开启后输出且带统一前缀', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    setDebugEnabled(true)
    expect(isDebugEnabled()).toBe(true)
    debugLog('规则命中', { rule: 'builtin-conv-backtick' })
    expect(log).toHaveBeenCalledTimes(1)
    const args = log.mock.calls[0]
    expect(args[0]).toBe('[vsidian-easy-typing]')
    expect(args[1]).toBe('规则命中')
  })

  it('再关闭即停止输出', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    setDebugEnabled(true)
    setDebugEnabled(false)
    debugLog('不应出现')
    expect(log).not.toHaveBeenCalled()
  })
})
