// 宿主入口（工单 #22 脚手架形态）。消费面全部经公开路径：
// - 清单声明 vsidianAddon（package.json）+ extensionDependencies；
// - registerAddon 两段生命周期：setup 注册自有设置页入口（普通停用后仍可
//   配置），enable 注册编辑器页入口与运行装配；
// - 页面产物 dist/editor.js 与 dist/settings.js（src/page-*.ts 经 SDK 构建
//   桥打成 chrome114 IIFE）。
// 行为注册、设置定义、命令族随功能票（M1 起）在此扩展。
import * as vscode from 'vscode'
import type { AddonDefinition } from '../types/vendor/host/addons/addonRegistry'
import type { VsidianHostExports } from './host-api'

/** 本扩展 ID（publisher.name，装载器按此核对入口身份） */
const SELF_ID = 'ONEGAYI.vsidian-easy-typing'
/** Vsidian 本体扩展 ID */
const HOST_ID = 'onegayi.vsidian'

const definition: AddonDefinition = {
  setup(setupCtx) {
    // 自有设置页入口：设置功能票（M3）前为占位空页——先落登记链路，
    // 页面内容由 src/page-settings.ts 随设置票填充
    setupCtx.settings.registerPage({ entry: 'dist/settings.js' })
  },
  enable(enableCtx) {
    enableCtx.pages.registerEditor({ entry: 'dist/editor.js' })
    enableCtx.onDispose(() => {
      // 运行释放回调：功能票在此注销运行期资源
    })
  },
}

async function activate(_context: vscode.ExtensionContext): Promise<void> {
  const ext = vscode.extensions.getExtension<VsidianHostExports>(HOST_ID)
  if (!ext) {
    // 开发者向诊断信息；用户可见通知随功能票的 i18n 架构落地
    throw new Error(`${SELF_ID}: vsidian host (${HOST_ID}) not found in this extension host`)
  }
  const host = await ext.activate()
  const result = host.registerAddon({ id: SELF_ID }, definition)
  if (!result.ok) {
    throw new Error(`${SELF_ID}: registerAddon rejected (${result.reason})`)
  }
}

function deactivate(): void {}

// VSCode 扩展宿主契约：activate/deactivate 经 module.exports 公布。不用
// ESM export——esbuild CJS bundle 会把无 bundle 内消费者的入口导出消除为
// 死代码（0&&module.exports=...），显式赋值是可靠保留形态（蓝本实测坑）。
module.exports = { activate, deactivate }
