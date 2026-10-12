// 共享设置拉取通道（工单 #32）：页面级 get 请求在途去重。
//
// 背景：编辑器页一次 focusChanged 在同一同步块内触发 8 个设置门各自
// refresh（behaviorGates ×4 + debug + modA + collapseEnter + newLineBelow
// ——4 个独立 updateListener 的回调同步执行），此前各发一次
// SETTINGS_TOPIC.get；宿主侧每请求对 24 键 effective 全量
// structuredClone，8 次请求 = 8 次克隆 + 8 次宿主↔webview 消息往返。
// 装载期首拉（void gate.refresh() 装配序列）与 focusChanged 同批同步
// 发起，被同一机制顺带合并。
//
// 机制：包装 channel，在 request 层对并发的 SETTINGS_TOPIC.get + null
// payload 做在途 promise 去重——首个请求在途时后续同参请求复用同一
// promise，settle 即清槽。**非时间窗缓存**：无陈旧数据问题（设置页改
// 完回编辑器，下一次触发必拿新值）。
//
// 语义约束与边界：
// - 失败 outcome / 底层异常共享给全部并发调用方——各 gate 的
//   `outcome.ok !== true` 早退保持上次值逻辑不变（fail-safe 不翻转）；
// - 共享的 outcome 对象被多个 gate 消费，**调用方只读不写**（现状全部
//   gate 均满足，勿在 gate 内改写 effective 字段——会造成跨 gate 串扰）；
// - 非 SETTINGS_TOPIC.get 或非 null payload 一律透传原通道（update /
//   NOTICE / RULES 等不合并；未来若出现带载荷的 get 也不误合并）；
// - 合并窗口是「同一同步触发面的并发」：await 之后的新请求不合并，
//   退化为现状（多一次请求），不出错。
import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../../types/vendor/shared/addonPage'
import { SETTINGS_TOPIC } from './store'

/**
 * 包装页面通道：并发的 SETTINGS_TOPIC.get（null 载荷）共享一次真实
 * 请求（#32：focusChanged 8 gate refresh 的 8→1 收敛）。返回值与入参
 * 同类型，gate 工厂与 register 注入点零改动。
 */
export function createSharedSettingsChannel(
  channel: VsidianAddonPageSdk['channel'],
): VsidianAddonPageSdk['channel'] {
  let inFlight: Promise<AddonChannelOutcome> | null = null
  return {
    request: (topic, payload, opts) => {
      if (topic !== SETTINGS_TOPIC.get || payload !== null) {
        return channel.request(topic, payload, opts)
      }
      if (inFlight === null) {
        inFlight = channel.request(SETTINGS_TOPIC.get, null, opts)
        // settle 即清槽（两参 then 吸收 rejection，不产生浮泡未处理拒绝）
        void inFlight.then(
          () => {
            inFlight = null
          },
          () => {
            inFlight = null
          },
        )
      }
      return inFlight
    },
  }
}
