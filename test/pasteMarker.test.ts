// 纯文本粘贴标记（工单 #12 标记层，#26 格式化管线的联动缝）——上游
// `src/main.ts:274-283`（markPaste：500ms 窗口双标志）与
// `src/main.ts:75-83`（Mod-v / Mod-Shift-v 键位标记）的纯逻辑移植。
// 消费面（#26 自动格式化）按 `pasteDetected || 事务含 paste` 识别粘贴、
// `consumePlainPaste()` 一次性消费纯文本意图跳过格式化（上游
// cm_extensions.ts:556-559 同构）。
import { describe, expect, it } from 'vitest'
import { createPasteMarker, PASTE_MARK_WINDOW_MS } from '../src/pasteMarker'

/** 假时钟：手动推进 */
function fakeClock(start = 0) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('createPasteMarker：窗口与标志语义', () => {
  it('markPaste(false)：只置 pasteDetected，不置纯文本意图', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(false)
    expect(marker.pasteDetected).toBe(true)
    expect(marker.plainPasteInProgress).toBe(false)
  })

  it('markPaste(true)：双标志齐置（上游 plain 同时置 pasteDetected）', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    expect(marker.pasteDetected).toBe(true)
    expect(marker.plainPasteInProgress).toBe(true)
  })

  it('窗口到期双标志失效（读取惰性判定，无需后台定时器）', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    clock.advance(PASTE_MARK_WINDOW_MS - 1)
    expect(marker.pasteDetected).toBe(true)
    clock.advance(1)
    expect(marker.pasteDetected).toBe(false)
    expect(marker.plainPasteInProgress).toBe(false)
  })

  it('窗口内重复 markPaste(false) 不清除纯文本意图（上游 if(plain) 语义）', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    clock.advance(100)
    marker.markPaste(false)
    expect(marker.pasteDetected).toBe(true)
    expect(marker.plainPasteInProgress).toBe(true)
  })

  it('重复 markPaste 续窗：自最后一次标记起算 500ms', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    clock.advance(PASTE_MARK_WINDOW_MS - 1)
    marker.markPaste(false)
    clock.advance(PASTE_MARK_WINDOW_MS - 1)
    expect(marker.pasteDetected).toBe(true)
    clock.advance(1)
    expect(marker.pasteDetected).toBe(false)
  })
})

describe('consumePlainPaste：一次性消费（#26 联动缝）', () => {
  it('纯文本意图只消费一次；消费后 pasteDetected 仍在窗口内', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    expect(marker.consumePlainPaste()).toBe(true)
    expect(marker.plainPasteInProgress).toBe(false)
    expect(marker.consumePlainPaste()).toBe(false)
    expect(marker.pasteDetected).toBe(true)
  })

  it('未标记纯文本或窗口已过 → 消费返回 false', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    expect(marker.consumePlainPaste()).toBe(false)
    marker.markPaste(false)
    expect(marker.consumePlainPaste()).toBe(false)
    marker.markPaste(true)
    clock.advance(PASTE_MARK_WINDOW_MS)
    expect(marker.consumePlainPaste()).toBe(false)
  })

  it('过期后重新标记可再次消费', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    marker.consumePlainPaste()
    clock.advance(PASTE_MARK_WINDOW_MS)
    marker.markPaste(true)
    expect(marker.consumePlainPaste()).toBe(true)
  })
})

describe('reset：显式清零', () => {
  it('清双标志且可重新标记', () => {
    const clock = fakeClock()
    const marker = createPasteMarker(clock)
    marker.markPaste(true)
    marker.reset()
    expect(marker.pasteDetected).toBe(false)
    expect(marker.plainPasteInProgress).toBe(false)
    marker.markPaste(true)
    expect(marker.plainPasteInProgress).toBe(true)
  })
})
