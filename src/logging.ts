// debug 日志门控（工单 #3 最小实现）：上游 utils.ts print/setDebug 的移植
// 形态。门控状态由设置链路驱动（debug 键 → extension.ts 接线
// setDebugEnabled），业务代码统一经 debugLog 输出，不直接碰 console。
// 输出落扩展宿主控制台（页面 bundle 内同样可用，console 两环境共有）。
const LOG_PREFIX = '[vsidian-easy-typing]'

let debugEnabled = false

/** 设置日志门控（debug 键生效值变化时调用） */
export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled
}

/** 当前门控状态（诊断/测试面） */
export function isDebugEnabled(): boolean {
  return debugEnabled
}

/** 门控开启时输出一行调试日志（统一前缀，便于用户过滤） */
export function debugLog(...parts: unknown[]): void {
  if (!debugEnabled) return
  console.log(LOG_PREFIX, ...parts)
}
