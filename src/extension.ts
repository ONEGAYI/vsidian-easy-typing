// 宿主入口（工单 #22 脚手架形态 + #3 设置链路 + #14 规则存储链路）。消费面
// 全部经公开路径：
// - 清单声明 vsidianAddon（package.json）+ extensionDependencies；
// - registerAddon 两段生命周期：setup 注册设置定义、设置通信、规则存储
//   通道与自有设置页入口（普通停用后仍可配置），enable 注册编辑器页入口、
//   编辑器页规则通道与运行装配；
// - 页面产物 dist/editor.js 与 dist/settings.js（src/page-*.ts 经 SDK 构建
//   桥打成 chrome114 IIFE）。
// 行为注册、命令族随功能票（M1 起）在此扩展。
import * as vscode from 'vscode'
import type { AddonDefinition, AddonSetupContext } from '../types/vendor/host/addons/addonRegistry'
import type { VsidianHostExports } from './host-api'
import { pickMessages } from './i18n'
import { attachSettings, SETTINGS_TOPIC, type EasyTypingSettingsFacade } from './settings/store'
import { buildSettingDefinitions } from './settings/definitions'
import { HostRulesService, registerRulesChannels } from './rulesHost'
import { debugLog, setDebugEnabled } from './logging'

/** 本扩展 ID（publisher.name，装载器按此核对入口身份） */
const SELF_ID = 'ONEGAYI.vsidian-easy-typing'
/** Vsidian 本体扩展 ID */
const HOST_ID = 'onegayi.vsidian'

/** 设置门面（setup 常驻；普通停用后仍可配置，随组件代次释放重建） */
let settingsFacade: EasyTypingSettingsFacade | null = null

/**
 * 规则数据服务（工单 #14，setup 常驻）：ctx.storage 单写点 + 规则文件
 * watcher + revision 代次。setup/enable 两作用域通道共用同一实例
 * （设置页规则管理 UI 归 #16，走 setup 通道；编辑器页引擎装载走
 * enable 通道——两通道表独立，同名 topic 各自注册不冲突）。
 */
let rulesService: HostRulesService | null = null

/** setup scope 通道：设置读取/写入/清覆盖（#16 自绘设置页与诊断消费） */
function registerSettingsChannels(setupCtx: AddonSetupContext): void {
  setupCtx.channel.handle(SETTINGS_TOPIC.get, () => {
    const facade = settingsFacade
    if (!facade) return null
    return { ...setupCtx.settings.get(), effective: facade.effective }
  })
  setupCtx.channel.handle(SETTINGS_TOPIC.update, (payload) => {
    const request = payload as { scope?: unknown; patch?: unknown }
    if (
      (request?.scope !== 'user' && request?.scope !== 'workspace') ||
      typeof request?.patch !== 'object' || request?.patch === null || Array.isArray(request.patch)
    ) {
      return { ok: false, reason: 'invalid-payload' }
    }
    return settingsFacade?.update(request.scope, request.patch as Record<string, unknown>) ?? {
      ok: false,
      reason: 'rejected',
    }
  })
  setupCtx.channel.handle(SETTINGS_TOPIC.clearOverride, (payload) => {
    const request = payload as { key?: unknown }
    if (typeof request?.key !== 'string' || request.key.length === 0) {
      return { ok: false, reason: 'invalid-payload' }
    }
    return settingsFacade?.clearWorkspaceOverride(request.key) ?? { ok: false, reason: 'rejected' }
  })
}

/** 设置链路装配：定义注册 + 门面挂接 + debug 日志门控实时刷新 */
function attachSettingsLink(setupCtx: AddonSetupContext): void {
  const messages = pickMessages(vscode.env.language)
  setupCtx.settings.registerDefinitions(buildSettingDefinitions(messages))
  const facade = attachSettings(setupCtx.settings)
  settingsFacade = facade
  // debug 开关接入日志通道（设置驱动的门控，onChanged 实时生效）
  facade.onEffectiveChange((effective) => setDebugEnabled(effective.debug))
  setDebugEnabled(facade.effective.debug)
  debugLog('settings attached', facade.effective)
}

const definition: AddonDefinition = {
  setup(setupCtx) {
    // 自有设置页入口：设置功能票（M3）前为占位空页——先落登记链路，
    // 页面内容由 src/page-settings.ts 随设置票填充
    setupCtx.settings.registerPage({ entry: 'dist/settings.js' })
    // 设置 schema 注册（工单 #3）：23 项进 Vsidian 设置页「附加组件」分页
    attachSettingsLink(setupCtx)
    registerSettingsChannels(setupCtx)
    // 规则存储链路（工单 #14）：storage 单写点 + setup 作用域通道
    // （#16 规则管理 UI 经此消费；不触碰 #3 的 SETTINGS_TOPIC handler）
    rulesService?.dispose() // 代次重注册：旧实例 watcher 计时器显式收尾
    rulesService = new HostRulesService(setupCtx.storage)
    registerRulesChannels(setupCtx.channel, rulesService)
  },
  enable(enableCtx) {
    enableCtx.pages.registerEditor({ entry: 'dist/editor.js' })
    // 编辑器页规则通道（enable 作用域，与 setup 通道表独立；停用即随代次注销）
    if (rulesService) {
      registerRulesChannels(enableCtx.channel, rulesService)
    }
    enableCtx.onDispose(() => {
      // 运行释放回调：功能票在此注销运行期资源（设置门面与规则服务属
      // setup 生命周期，不在此释放——停用不删规则数据）
    })
  },
}

async function activate(_context: vscode.ExtensionContext): Promise<void> {
  const messages = pickMessages(vscode.env.language)
  const ext = vscode.extensions.getExtension<VsidianHostExports>(HOST_ID)
  if (!ext) {
    // 开发者向诊断信息（经 i18n 字典，非用户可见通知）
    throw new Error(`${SELF_ID}: ${messages.noHost}`)
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
