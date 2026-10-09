// onChanged 刷新节流（审查第 4 轮 C-R4-2）：平台 behaviors.onChanged 每次
// 输入触发，三处 gate 直接挂 refresh = 每键 3 次设置通道请求 + 全量重解析；
// 本工具把刷新压到「节流窗内首次触发」，设置改动最迟一个窗口后的下一次
// 输入生效（消费键均为低频项：debug / #27 双开 / autoformat 配置）。
import { describe, expect, it } from 'vitest'
import { createThrottledRefresh } from '../src/throttle'

describe('createThrottledRefresh（onChanged 观察刷新节流，C-R4-2）', () => {
  it('窗口内多次触发只刷一次；跨窗后首次触发再刷', () => {
    let clock = 1_000
    let refreshes = 0
    const throttled = createThrottledRefresh(
      async () => {
        refreshes++
      },
      3000,
      () => clock,
    )

    throttled() // 窗口起点：立即刷
    clock += 100; throttled()
    clock += 500; throttled()
    expect(refreshes).toBe(1)

    clock += 3000 // 跨出窗口
    throttled()
    expect(refreshes).toBe(2)

    clock += 100; throttled()
    expect(refreshes).toBe(2)
  })

  it('refresh 异步拒绝不外溢（onChanged 回调是 void 语境，通道失败不产生 unhandledrejection）', async () => {
    let clock = 0
    const throttled = createThrottledRefresh(
      async () => {
        throw new Error('channel down')
      },
      3000,
      () => clock,
    )
    throttled()
    await Promise.resolve() // 微任务排空后无未处理拒绝即通过
  })
})
