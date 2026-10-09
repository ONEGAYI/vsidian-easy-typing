/**
 * onChanged 观察刷新节流（审查第 4 轮 C-R4-2）。
 *
 * 平台 behaviors.onChanged 每次用户输入都触发——gate 直接挂 refresh 等于
 * 每键一次设置通道请求（三处 gate 即每键三次，宿主侧 structuredClone 全量
 * effective）。gate 消费的键（debug / #27 双开 / autoformat 配置）均为
 * 极低频变更项：节流窗内只保留首次触发，设置改动最迟一个窗口后的下一次
 * 输入生效。
 */

/** 产出节流回调：窗口内首次触发执行 refresh，其余吞掉；now 注入供测试 */
export function createThrottledRefresh(
  refresh: () => Promise<void>,
  windowMs = 3000,
  now: () => number = () => Date.now(),
): () => void {
  let lastRefreshAt = -Infinity
  return () => {
    const at = now()
    if (at - lastRefreshAt < windowMs) return
    lastRefreshAt = at
    void refresh().catch(() => {
      /* onChanged 回调是 void 语境：通道失败保持上次缓存值，不外溢拒绝 */
    })
  }
}
