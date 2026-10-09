// 纯文本粘贴标记（工单 #12 标记层）——上游 easy-typing-obsidian
// `src/main.ts:75-83`（Mod-v / Mod-Shift-v 键位标记）与 `:274-283`
//（markPaste：500ms 窗口双标志 + 到期清零）的纯逻辑移植。
//
// 语义（上游 plugin_context 双标志）：
// - `pasteDetected`：一次粘贴正在发生（普通/纯文本按键都置）——#26 自动
//   格式化以 `事务含 paste || pasteDetected` 识别粘贴（上游
//   cm_extensions.ts:556；平台侧重写事务可能不带 paste userEvent，此标志
//   是补充信号）；
// - `plainPasteInProgress`：**纯文本意图**（跳过自动格式化）——一次性
//   消费（上游 :559 观察即清），窗口内重复非纯文本标记不清除（上游
//   `if (plain)` 语义——纯文本粘贴链路中的普通粘贴事件不冲掉意图）。
//
// 与上游的差异：上游用 setTimeout 后台清零，本仓改**读取惰性判定**
//（now < expiresAt）——消费面读时才判到期，无需后台定时器；窗口时长与
// 重复标记续窗语义不变。这是 #26 格式化管线的**联动缝**：本票只落标记
// 与置位路径，消费归 #26。

/** 标记窗口时长（上游 markPaste 的 500ms） */
export const PASTE_MARK_WINDOW_MS = 500

/** 注入时钟（测试假时钟；生产 Date.now） */
export interface PasteMarkerClock {
  now(): number
}

/** 粘贴标记（#26 自动格式化的跳过信号源） */
export interface PasteMarker {
  /** 窗口内为 true（普通/纯文本标记都置） */
  readonly pasteDetected: boolean
  /** 窗口内且纯文本意图未消费 */
  readonly plainPasteInProgress: boolean
  /** 标记一次粘贴（plain = 纯文本意图；续窗自本次起算） */
  markPaste(plain: boolean): void
  /** 一次性消费纯文本意图（消费后 pasteDetected 仍在窗口内） */
  consumePlainPaste(): boolean
  /** 显式清零 */
  reset(): void
}

/** 构造粘贴标记（惰性到期；clock 注入便于测试） */
export function createPasteMarker(clock: PasteMarkerClock = { now: () => Date.now() }): PasteMarker {
  let expiresAt = -Infinity
  let plain = false
  const marker: PasteMarker = {
    get pasteDetected() {
      return clock.now() < expiresAt
    },
    get plainPasteInProgress() {
      return clock.now() < expiresAt && plain
    },
    markPaste(isPlain: boolean) {
      expiresAt = clock.now() + PASTE_MARK_WINDOW_MS
      if (isPlain) plain = true
    },
    consumePlainPaste() {
      if (!marker.plainPasteInProgress) return false
      plain = false
      return true
    },
    reset() {
      expiresAt = -Infinity
      plain = false
    },
  }
  return marker
}
