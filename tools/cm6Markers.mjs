// @codemirror/state 与 @codemirror/view 发行产物中的稳定标记串（摘自
// ONEGAYI/vsidian@test/fixtures/addon-v02/sdk/buildAddon.mjs 的
// CM6_RUNTIME_MARKERS——独立仓中此表只保留这一处定义，蓝本要求同源）。
// 组件产物若含任一即证明打包进了第二份 CM6 运行时（第二道防线；第一道
// 是 tools/sdkBridge.mjs 的值导入拒绝）。
export const CM6_RUNTIME_MARKERS = [
  'Unrecognized extension value',
  'Widget decorations can only have zero-length ranges',
]
