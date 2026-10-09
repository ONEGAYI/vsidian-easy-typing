// 编辑器页入口（工单 #22 脚手架 + 工单 #7 首个功能接入）：经 SDK 构建
// 桥打成 chrome114 IIFE。消费形态参照 vsidian
// test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { betterBackspaceCommand } from './backspaceIntercept'
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

  // BetterBackspace keymap（工单 #8）：**抢先层**（票面评论定案，
  // Prec.high）——先于平台 Backspace 情境链（symbolAutocomplete 删空对
  // → listEditing 退格清层 → tableEditing 表格删除）尝试。接管面仅
  // 顶级空列表项（合并/清行 + 有序重编号，平台无此能力）与空引用行
  // （联降/降级/合并）；嵌套空项与空任务项 return false 让位平台（树
  // 判 dedent / 一次清整段前缀更准，避免双重接管）。可达性与让位面
  // 核对结论见 docs/specs/backspace.md「平台 Backspace 冲突核对」节。
  // 设置门控（上游 settings.BetterBackspace）随设置票接线。
  sdk.registerExtension(
    cm6.state.Prec.high(cm6.view.keymap.of([{ key: 'Backspace', run: betterBackspaceCommand }])),
  )
})
