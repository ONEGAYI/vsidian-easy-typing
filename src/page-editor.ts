// 编辑器页入口（工单 #22 脚手架 + 工单 #7 首个功能接入）：经 SDK 构建
// 桥打成 chrome114 IIFE。消费形态参照 vsidian
// test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { taboutCommand } from './taboutIntercept'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  // 实验 cm6 入口（清单已声明 ^1.1.0）：CM6 运行时值只经此取得——直接
  // import @codemirror/* 值被构建桥双防线拒绝（脚手架规约）
  const cm6 = sdk.experimental.cm6
  if (cm6 === undefined) {
    // 正常装载流不会到这（宿主兼容判定先拦清单不匹配的组件）；此处
    // 防御性早退——本页功能全部依赖共享运行时
    return
  }

  // Tabout keymap（工单 #7）：**落穿层**——普通扩展槽（平台扩展数组
  // 末位），不用 Prec 抢先。平台 Tab 三段链（围栏越界 → 表格导航 →
  // 正文缩进）先处理；命中配对场景（栈匹配 / 选区包围）才接管，其余
  // return false 透传。可达性与冲突核对结论见 docs/specs/tabout.md
  // 「平台 Tab 冲突核对」节。设置门控（上游 settings.Tabout）随本
  // 组件设置票接线：关闭时不注册本 keymap。
  sdk.registerExtension(cm6.view.keymap.of([{ key: 'Tab', run: taboutCommand }]))
})
