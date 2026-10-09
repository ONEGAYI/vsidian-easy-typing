// 编辑器页入口（工单 #22 脚手架 + 工单 #7 Tabout + 工单 #14 规则装载 +
// 工单 #18 折叠标题 Enter 拦截）：经 SDK 构建桥打成 chrome114 IIFE。
// 消费形态参照 vsidian test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { betterBackspaceCommand } from './backspaceIntercept'
import { createCollapseEnterGate, createFoldEnterCommand } from './foldEnter'
import { taboutCommand } from './taboutIntercept'
import { pickMessages } from './i18n'
import { debugLog } from './logging'
import {
  buildSelectBlockCommandDefinition,
  createEnhanceModAGate,
  createModACommand,
  createSelectBlockCommandHandler,
} from './modaIntercept'
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

  // ============================================================
  // 工单 #11 增量块：EnhanceModA 渐进选择 + 「选择当前块」命令。
  // 独立成块（不动上方既有装配），降低与并行工单的合并冲突。
  // ============================================================

  // 设置门：装载即拉取 enhanceModA 生效值（#3 设置通道，默认关）；焦点
  // 回归与透传按键时刷新——设置页改开关后回到编辑器即按新值判定
  const modAGate = createEnhanceModAGate(sdk.channel)
  void modAGate.refresh()

  // Mod+A 抢先层（票面评论定案 Prec.high）：平台保留键闸（undo/redo）
  // 之后、平台普通情境链之前；功能关或状态机失配一律 return false 落穿
  // ——平台原生 Mod+A 全选照常执行（透传即接管边界）。实验层 keymap 不进
  // 平台统一快捷键管理；registerExtension 无撤销句柄，采用「恒注册 + 设置
  // 门控透传」形态（关闭时行为与不注册等价，运行时开关即时生效）。
  const modARun = createModACommand({ isEnabled: () => modAGate.enabled() })
  sdk.registerExtension(
    cm6.state.Prec.high(
      cm6.view.keymap.of([
        {
          key: 'Mod-a',
          run: (view) => {
            const handled = modARun(view)
            // 透传按键顺带拉新设置（fire-and-forget，下一次按键生效——
            // 关闭→开启运行时翻转的兜底通道，主通道是焦点回归刷新）
            if (!handled) void modAGate.refresh()
            return handled
          },
        },
      ]),
    ),
  )
  sdk.registerExtension(
    cm6.view.EditorView.updateListener.of((update) => {
      if (update.focusChanged) void modAGate.refresh()
    }),
  )

  // 「选择当前块」命令：平台稳定 commands API（统一快捷键管理 + 命令
  // 面板；默认未绑定——上游无默认热键，绑定入口由平台快捷键管理承担）。
  // 焦点视图优先（编辑器内触发），命令面板触发（焦点在宿主 UI）回退主
  // 视图快照路径。
  const commands = sdk.commands
  if (commands !== undefined) {
    const registered = commands.register(
      buildSelectBlockCommandDefinition(pickMessages(navigator.language)),
      createSelectBlockCommandHandler({
        cm6,
        views: sdk.views,
        getFocusedView: () => {
          const active = document.activeElement
          return active instanceof HTMLElement ? cm6.view.EditorView.findFromDOM(active) : null
        },
      }),
    )
    if (!registered.ok) {
      // 普通 API 拒绝不算故障：经 debugLog 留痕便于诊断（logging.ts 约定）
      debugLog('select-block command register rejected:', registered.reason)
    }
  }

  // ============================================================
  // 工单 #18 增量块：CollapsePersistentEnter 折叠标题 Enter 拦截。
  // 独立成块（不动上方既有装配），降低与并行工单的合并冲突。
  // ============================================================

  // 折叠查询消费 experimental.headingFold（清单已声明 ^1.0.0）。入口缺席
  //（宿主旧版）时本功能静默不注册——防御性处理，不算故障（清单兼容判定
  // 已在装载期拦住不匹配宿主，此处是防御深度）。
  const headingFold = sdk.experimental.headingFold
  if (headingFold !== undefined) {
    // collapsePersistentEnter 设置门（#3 通道，上游默认关）：装载拉取 +
    // 焦点回归刷新（对齐 #11 modAGate 形态——设置页改开关后回到编辑器
    // 即按新值判定）。
    const collapseEnterGate = createCollapseEnterGate(sdk.channel)
    void collapseEnterGate.refresh()

    // Enter 抢先层（Prec.high，票面 #402 分层核对）：先于平台 Enter 情境
    // 链（列表续行/表格/普通换行）尝试。接管面 = 功能开 + 光标在被折叠
    // 的 ATX 标题行（folds() 命中，查询前有零开销行门槛）；命中在折叠
    // 区间末尾新建同级标题行（折叠保持）；其余 return false 落穿。仲裁
    // 核对见 docs/specs/fold-enter.md「层归属与平台 Enter 仲裁」节。
    // 方法经箭头包装注入（不裸传方法引用，规避 this 绑定假设）。
    sdk.registerExtension(
      cm6.state.Prec.high(
        cm6.view.keymap.of([
          {
            key: 'Enter',
            run: createFoldEnterCommand({
              folds: (instanceId) => headingFold.folds(instanceId),
              isEnabled: () => collapseEnterGate.enabled(),
            }),
          },
        ]),
      ),
    )
    sdk.registerExtension(
      cm6.view.EditorView.updateListener.of((update) => {
        if (update.focusChanged) void collapseEnterGate.refresh()
      }),
    )
  }
})
