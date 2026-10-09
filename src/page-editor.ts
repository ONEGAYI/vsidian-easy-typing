// 编辑器页入口（工单 #22 脚手架 + #7/#8/#12 功能接入）：经 SDK 构建
// 桥打成 chrome114 IIFE。消费形态参照 vsidian
// test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { betterBackspaceCommand } from './backspaceIntercept'
import { taboutCommand } from './taboutIntercept'
import { createSmartPastePasteHandler } from './smartPasteIntercept'
import { pickMessages } from './i18n'
import { createPasteMarker } from './pasteMarker'
import {
  buildPlainPasteClipboardReader,
  buildPlainPasteCommandDefinition,
  createEditorViewRegistry,
  createPlainPasteCommandHandler,
  createViewTrackerExtension,
  defaultWebReadText,
  dispatchPlainPasteEvent,
} from './plainPasteCommand'

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

  // SmartPaste 粘贴续接 + 纯文本粘贴（工单 #12 独立增量块）：粘贴拦截走
  // **实验 cm6 domEventHandlers({ paste })**——扩展槽在平台扩展数组末位，
  // domEventHandlers 按扩展序执行且**后于平台富文本/图片粘贴处理器、先于
  // CM6 内建 paste**：平台命中场景（图片项、富文本转换）已在前面接管，
  // 其余纯文本粘贴落穿到本层；命中列表/引用续接才 preventDefault 接管，
  // 恒等续接与未命中一律 return false 透传原生链（多光标行分配等平台语
  // 义保持）。选型理由与让位面核对见 docs/specs/smart-paste.md。设置门控
  //（上游 settings.SmartPaste）随设置接线，当前恒开。
  const pasteMarker = createPasteMarker()
  sdk.registerExtension(
    cm6.view.EditorView.domEventHandlers({
      paste: createSmartPastePasteHandler({
        marker: pasteMarker,
        editableFacet: cm6.view.EditorView.editable,
      }),
    }),
  )

  // 视图捕获（命令回调无 view 入参）：ViewPlugin 登记主正文与嵌入实例的
  // 在场编辑器，命令按聚焦者优先取目标
  const viewRegistry = createEditorViewRegistry()
  sdk.registerExtension(createViewTrackerExtension(cm6.view.ViewPlugin, viewRegistry))

  // 纯文本粘贴命令（工单 #12，**平台稳定 API**——统一快捷键管理 + 命令面
  // 板）：Mod+Shift+V（规范键序，避开 vsidian#417 形态）置纯文本标记后合
  // 成纯文本 paste 事件交既有粘贴链（SmartPaste 续接与 CM6 多光标语义全
  // 保留）；#26 格式化管线经 pasteMarker 消费跳过格式化。剪贴板读取
  // navigator 优先、宿主通道回退（extension.ts enable scope 注册 topic）。
  const commands = sdk.commands
  if (commands !== undefined) {
    const messages = pickMessages(navigator.language)
    const registration = commands.register(
      buildPlainPasteCommandDefinition(messages.commands.pastePlainTitle),
      createPlainPasteCommandHandler({
        marker: pasteMarker,
        views: viewRegistry,
        readClipboardText: buildPlainPasteClipboardReader({
          webReadText: defaultWebReadText(),
          channelRequest: (topic) => sdk.channel.request(topic, null),
        }),
        dispatchPlainPaste: dispatchPlainPasteEvent,
      }),
    )
    // 页面释放时注销命令（平台随代次回收，此处显式闭环）
    sdk.onDispose(() => registration.dispose())
  }
})
