// 编辑器页入口（工单 #22 脚手架 + 工单 #7 Tabout + 工单 #14 规则装载）：
// 经 SDK 构建桥打成 chrome114 IIFE。消费形态参照 vsidian
// test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { taboutCommand } from './taboutIntercept'
import { RuleEngine } from './rules/rule-engine'
import { PageRulesClient } from './rules/rules-page'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

defineAddonPage(ADDON_ID, async (sdk: VsidianAddonPageSdk) => {
  // 实验 cm6 入口（清单已声明 ^1.1.0）：CM6 运行时值只经此取得——直接
  // import @codemirror/* 值被构建桥双防线拒绝（脚手架规约）
  const cm6 = sdk.experimental.cm6
  if (cm6 === undefined) {
    // 正常装载流不会到这（宿主兼容判定先拦清单不匹配的组件）；此处
    // 防御性早退——本页功能全部依赖共享运行时
    return
  }

  // 规则引擎装载（工单 #14 数据链）：拉取宿主快照装载引擎 + revision
  // 轮询自动重载（外部同步工具改写或 #16 UI 编辑后即时生效）。引擎的
  // 输入触发消费（process 调用）归 #25 行为链接入。
  const ruleClient = new PageRulesClient({ engine: new RuleEngine(), channel: sdk.channel })
  await ruleClient.load()
  ruleClient.startWatch()
  sdk.onDispose(() => ruleClient.stopWatch())

  // Tabout keymap（工单 #7）：**落穿层**——普通扩展槽（平台扩展数组
  // 末位），不用 Prec 抢先。平台 Tab 三段链（围栏越界 → 表格导航 →
  // 正文缩进）先处理；命中配对场景（栈匹配 / 选区包围）才接管，其余
  // return false 透传。可达性与冲突核对结论见 docs/specs/tabout.md
  // 「平台 Tab 冲突核对」节。设置门控（上游 settings.Tabout）随本
  // 组件设置票接线：关闭时不注册本 keymap。
  sdk.registerExtension(cm6.view.keymap.of([{ key: 'Tab', run: taboutCommand }]))
})
