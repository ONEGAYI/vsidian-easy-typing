// 编辑器页入口（工单 #22 脚手架 + #7/#8/#11/#12/#14/#18 功能接入）：经
// SDK 构建桥打成 chrome114 IIFE。消费形态参照 vsidian
// test/examples/input-behavior/src/page-editor.ts。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import type { EditorView } from '@codemirror/view'
import { createBetterBackspaceCommand } from './backspaceIntercept'
import { buildToggleCommentCommandDefinition, createToggleCommentCommandHandler } from './commentToggle'
import { createCollapseEnterGate, createFoldEnterCommand } from './foldEnter'
import { createNewLineBelowCommand, createNewLineBelowGate } from './newLineBelow'
import { createTaboutCommand } from './taboutIntercept'
import { pickMessages } from './i18n'
import { debugLog, setDebugEnabled } from './logging'
import {
  buildSelectBlockCommandDefinition,
  createEnhanceModAGate,
  createModACommand,
  createSelectBlockCommandHandler,
} from './modaIntercept'
import { RuleEngine } from './rules/rule-engine'
import { PageRulesClient } from './rules/rules-page'
import { createTabstopNavigation } from './tabstopNav'
import { createSmartPastePasteHandler } from './smartPasteIntercept'
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
import {
  registerRuleDeleteSelectKeyBehaviors,
  registerRuleInputBehaviors,
  createRuleSnapshotSource,
} from './ruleBehaviorIntercept'
import { registerAutoFormatBehavior, createAutoFormatGate } from './autoFormatIntercept'
import { registerFormattingCommands } from './formattingCommands'
import { NOTICE_TOPIC, SETTINGS_TOPIC } from './settings/store'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'ONEGAYI.vsidian-easy-typing'

/**
 * 单布尔键设置门（三键行为门控的公共形态，语义对齐 modaIntercept 的
 * enhanceModA 门）：通道失败保持上次值（瞬时故障不翻转拦截行为）；
 * 有效载荷仅认 boolean true。初值由调用方传上游出厂默认——通道首次
 * 返回前不翻转默认行为（「关闭 = 不注册等价」与「默认开 = 上游恒开」
 * 同一方向）。
 */
function createBooleanSettingGate(
  channel: VsidianAddonPageSdk['channel'],
  key: 'tabout' | 'betterBackspace' | 'smartPaste',
  initial: boolean,
): { enabled(): boolean; refresh(): Promise<void> } {
  let current = initial
  return {
    enabled: () => current,
    refresh: async () => {
      const outcome = await channel.request(SETTINGS_TOPIC.get, null)
      if (outcome.ok !== true) return
      const effective = (outcome.result as { effective?: unknown } | null)?.effective
      current = (effective as Record<string, unknown> | null)?.[key] === true
    },
  }
}

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
  // 轮询自动重载（外部同步工具改写或 #16 UI 编辑后即时生效）。快照同时
  // 喂规则源（rulesSource）——#25/#9 行为族引擎经其同步重建（审查
  // B-F1 / C-P1-2 修复），PageRulesClient.engine 保留为数据链诊断面。
  const rulesSource = createRuleSnapshotSource()
  const ruleClient = new PageRulesClient({
    engine: new RuleEngine(),
    channel: sdk.channel,
    onReload: (snapshot) => rulesSource.update(snapshot),
  })
  await ruleClient.load()
  ruleClient.startWatch()
  sdk.onDispose(() => ruleClient.stopWatch())

  // debug 日志门控接线（审查 C-P2-2 修复）：logging 模块的 debugEnabled 是
  // bundle 内单例——宿主 extension.ts 的 setDebugEnabled 接线只改宿主
  // bundle 那份实例，页面 IIFE 各持一份恒 false 的副本（页面侧 debugLog
  // 全为死路径）。本页装载时经 #3 设置通道拉 effective.debug 接线本份
  // 实例；通道失败保持上次值（装载首拉失败 = 默认关，安全方向）。
  const refreshDebugGate = async (): Promise<void> => {
    const outcome = await sdk.channel.request(SETTINGS_TOPIC.get, null)
    if (outcome.ok !== true) return
    const effective = (outcome.result as { effective?: unknown } | null)?.effective
    setDebugEnabled((effective as { debug?: unknown } | null)?.debug === true)
  }
  void refreshDebugGate()

  // 行为开关门控族（审查 B-F5 修复）：tabout / betterBackspace / smartPaste
  // 三键运行时门（上游 settings.Tabout / BetterBackspace / SmartPaste，
  // 三键出厂默认均开）。形态对齐 #11/#18「恒注册 + 设置门控透传」——
  // 关闭时行为与不注册本组件扩展等价，运行时开关即时生效。装载拉取 +
  // 焦点回归刷新（#18 形态：Tab/Backspace 是高频透传键，不挂按键级刷新
  // 避免每键一次通道请求；设置页改开关后回到编辑器即按新值判定）。
  const behaviorGates = {
    tabout: createBooleanSettingGate(sdk.channel, 'tabout', true),
    betterBackspace: createBooleanSettingGate(sdk.channel, 'betterBackspace', true),
    smartPaste: createBooleanSettingGate(sdk.channel, 'smartPaste', true),
  }
  const refreshBehaviorGates = (): void => {
    for (const gate of Object.values(behaviorGates)) void gate.refresh()
  }
  refreshBehaviorGates()
  sdk.registerExtension(
    cm6.view.EditorView.updateListener.of((update) => {
      if (update.focusChanged) {
        refreshBehaviorGates()
        void refreshDebugGate()
      }
    }),
  )

  // Tabout keymap（工单 #7）：**落穿层**——普通扩展槽（平台扩展数组
  // 末位），不用 Prec 抢先。平台 Tab 三段链（围栏越界 → 表格导航 →
  // 正文缩进）先处理；命中配对场景（栈匹配 / 选区包围）才接管，其余
  // return false 透传。可达性与冲突核对结论见 docs/specs/tabout.md
  // 「平台 Tab 冲突核对」节。设置门控（上游 settings.Tabout）经上方
  // behaviorGates 接线（关闭时透传 = 不注册等价，审查 B-F5 修复）。
  sdk.registerExtension(
    cm6.view.keymap.of([{ key: 'Tab', run: createTaboutCommand({ isEnabled: () => behaviorGates.tabout.enabled() }) }]),
  )

  // BetterBackspace keymap（工单 #8）：**抢先层**（票面评论定案，
  // Prec.high）——先于平台 Backspace 情境链（symbolAutocomplete 删空对
  // → listEditing 退格清层 → tableEditing 表格删除）尝试。接管面仅
  // 顶级空列表项（合并/清行 + 有序重编号，平台无此能力）与空引用行
  // （联降/降级/合并）；嵌套空项与空任务项 return false 让位平台（树
  // 判 dedent / 一次清整段前缀更准，避免双重接管）。可达性与让位面
  // 核对结论见 docs/specs/backspace.md「平台 Backspace 冲突核对」节。
  // 设置门控（上游 settings.BetterBackspace）经上方 behaviorGates 接线
  //（关闭时透传 = 不注册等价，审查 B-F5 修复）。
  sdk.registerExtension(
    cm6.state.Prec.high(
      cm6.view.keymap.of([
        { key: 'Backspace', run: createBetterBackspaceCommand({ isEnabled: () => behaviorGates.betterBackspace.enabled() }) },
      ]),
    ),
  )

  // ============================================================
  // 工单 #15 增量块：Tabstop 占位符导航态（规则替换体 $0/$1/... 的
  // Tab 跳转 + 当前占位符高亮）。独立成块（不动上方既有装配），降低与
  // 并行工单的合并冲突。
  // ============================================================

  // 导航模块（StateField + 高亮主题 + commands）：同一实例的 extension 与
  // activateTabstops 绑定同一 StateField 身份，多编辑器实例（主正文与嵌入
  // 视图）各自挂 extension 即可（field 按视图状态隔离）。
  const tabstopNav = createTabstopNavigation(cm6)
  sdk.registerExtension(tabstopNav.extension)

  // Tab/Shift-Tab keymap：**抢先层**（Prec.high，#402 四层按键契约第 2 层）
  // ——上游 handleTabDown 首位语义（tabstop 存在时优先于一切 Tab 分支），
  // 先于平台 Tab 情境链（围栏越界 → 表格导航 → 正文缩进）与 #7 Tabout
  // 落穿层；导航态未激活一律 return false 落穿，平台与 #7 行为零改动。
  // 跳转顺序 $0 → $1 → $2（上游口径），跳至最后一组即收尾。仲裁结论与
  // 层级设计见 docs/specs/tabstop.md「Tab 仲裁」节。
  sdk.registerExtension(
    cm6.state.Prec.high(
      cm6.view.keymap.of([
        { key: 'Tab', run: tabstopNav.tabCommand },
        { key: 'Shift-Tab', run: tabstopNav.shiftTabCommand },
      ]),
    ),
  )

  // #25 行为链接线点：规则计划（changes + selection）应用后，若
  // ApplyResult.tabstops 非空，调用 tabstopNav.activateTabstops(view,
  // result.tabstops) 建立导航态——引擎 cursor 已落首组起点，激活事务把
  // 选区重设为「首组逐 range 全选」（多光标）。本票不接 onInput 管线
  //（#25 并行中），全链路由单元测试直接驱动该接口承载
  //（test/tabstopNav.test.ts）。

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

  // SmartPaste 粘贴续接 + 纯文本粘贴（工单 #12 独立增量块）：粘贴拦截走
  // **实验 cm6 domEventHandlers({ paste })**——扩展槽在平台扩展数组末位，
  // domEventHandlers 按扩展序执行且**后于平台富文本/图片粘贴处理器、先于
  // CM6 内建 paste**：平台命中场景（图片项、富文本转换）已在前面接管，
  // 其余纯文本粘贴落穿到本层；命中列表/引用续接才 preventDefault 接管，
  // 恒等续接与未命中一律 return false 透传原生链（多光标行分配等平台语
  // 义保持）。选型理由与让位面核对见 docs/specs/smart-paste.md。设置门控
  //（上游 settings.SmartPaste）经上方 behaviorGates 接线（isSmartPasteEnabled
  // 注入位——关闭 = 不续接仍透传粘贴，审查 B-F5 修复）。
  const pasteMarker = createPasteMarker()
  sdk.registerExtension(
    cm6.view.EditorView.domEventHandlers({
      paste: createSmartPastePasteHandler({
        marker: pasteMarker,
        editableFacet: cm6.view.EditorView.editable,
        isSmartPasteEnabled: () => behaviorGates.smartPaste.enabled(),
      }),
    }),
  )

  // 视图捕获（命令回调无 view 入参）：ViewPlugin 登记挂载本组件扩展的在
  // 场编辑器——当前平台附加组件扩展槽仅挂主正文 Live 实例（嵌入/悬停视图
  // 不经此登记，登记面以平台装配事实为准），命令按聚焦者优先取目标。
  const viewRegistry = createEditorViewRegistry()
  sdk.registerExtension(createViewTrackerExtension(cm6.view.ViewPlugin, viewRegistry))
  // 焦点 CM6 视图探测（findFromDOM 对嵌入/悬停实例同样命中）：供命令族做
  // 「聚焦视图不在登记表 = 嵌入实例」的拒绝口径（审查 B-F3）——聚焦嵌入
  // 视图时命令拒绝执行，不误写主文档兜底。
  const getFocusedView = (): EditorView | null => {
    const active = document.activeElement
    return active instanceof HTMLElement ? (cm6.view.EditorView.findFromDOM(active) as EditorView | null) : null
  }

  // 纯文本粘贴命令（工单 #12，**平台稳定 API**——统一快捷键管理 + 命令面
  // 板）：Mod+Shift+V（规范键序，避开 vsidian#417 形态）置纯文本标记后合
  // 成纯文本 paste 事件交既有粘贴链（SmartPaste 续接与 CM6 多光标语义全
  // 保留）；#26 格式化管线经 pasteMarker 消费跳过格式化。剪贴板读取
  // navigator 优先、宿主通道回退（extension.ts enable scope 注册 topic）。
  // （commands 复用 #11 块的声明——同为 sdk.commands，合并时去重。）
  if (commands !== undefined) {
    const messages = pickMessages(navigator.language)
    const registration = commands.register(
      buildPlainPasteCommandDefinition(messages.commands.pastePlainTitle),
      createPlainPasteCommandHandler({
        marker: pasteMarker,
        views: viewRegistry,
        getFocusedView,
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

  // ============================================================
  // 工单 #13 增量块：Enter 族——当前行下方新建行（Mod+Enter，上游
  // goNewLineAfterCurLine 移植）。独立成块（不动上方既有装配），降低与
  // 并行工单的合并冲突。
  // ============================================================

  // newLineBelow 设置门（#3 通道，#13 新增本仓键、默认开——上游命令恒
  // 可用的等价默认）：装载拉取 + 焦点回归刷新（对齐 #11/#18 门形态）。
  const newLineBelowGate = createNewLineBelowGate(sdk.channel)
  void newLineBelowGate.refresh()

  // Mod+Enter 抢先层（Prec.high，#402 四层契约第 2 层「可替代平台键位」）：
  // 平台侧 Mod+Enter 并非无主——defaultKeymap（extraExtensions 普通槽）内建
  // `Mod-Enter → insertBlankLine`（插空行 + 自动缩进，无前缀延续）。本层先
  // 于它尝试，命中面（功能开 + 单选区 + 非组合/非只读）接管为前缀延续版
  //「下方新建行」（列表续标记/有序递增/任务重置/引用续前缀——平台没有
  // 的净增量）；其余 return false 落穿，平台 insertBlankLine 兜底（透传 ≠
  // 无操作，键位永不失效）。与 #18（Enter）/#7（Tab）不同键位，无同键
  // 竞争。仲裁核对见 docs/specs/new-line-below.md「层归属与平台
  // Mod+Enter 仲裁」节。
  sdk.registerExtension(
    cm6.state.Prec.high(
      cm6.view.keymap.of([
        {
          key: 'Mod-Enter',
          run: createNewLineBelowCommand({ isEnabled: () => newLineBelowGate.enabled() }),
        },
      ]),
    ),
  )
  sdk.registerExtension(
    cm6.view.EditorView.updateListener.of((update) => {
      if (update.focusChanged) void newLineBelowGate.refresh()
    }),
  )

  // ============================================================
  // 工单 #25 增量块：onInput 行为链——#1 规则内核（Input 类）按功能族
  // 注册进平台稳定行为链。族清单/默认链序/独占组/撤销边界（全 atomic）
  // 见 docs/specs/rule-engine.md「#25 行为链接入」节与
  // src/ruleBehaviorIntercept.ts 头注。平台行为冲突管理以族为粒度逐项
  // 开关与调序（内置规则逐条开关的插件侧承载形态）；规则错误经
  // RULE_ERROR_TOPIC 通道由宿主显示 i18n 警告。
  // ============================================================

  const behaviors = sdk.behaviors
  if (behaviors !== undefined) {
    const ruleRuntime = registerRuleInputBehaviors({
      behaviors,
      channel: sdk.channel,
      language: navigator.language,
      rulesSource,
    })
    for (const outcome of ruleRuntime.outcomes) {
      if (!outcome.ok) {
        // 普通 API 拒绝不算故障：经 debugLog 留痕便于诊断（logging.ts 约定）
        debugLog('rule behavior register rejected:', outcome.localId, outcome.reason)
      }
    }

    // #15×#25 接线：行为链计划应用后的 docChanged 事务里取走暂存的
    // tabstop 组激活导航态（坐标为应用后文档绝对坐标，直接可用；读即
    // 消费，无残留）。pending 只在 onInput 命中含占位符的计划后非空，
    // 窗口极小——若被无关 docChanged 事务抢先消费，导航态静默不激活，
    // 下次输入即恢复，不视为故障（口径见 tabstop.md「行为链接线」节）。
    // 消费一致性校验（审查 B-F2 修复）：传 view.state.doc——暂存的计划
    // 变更未在文档上呈现（applyEdit 回环窗口内用户键入先到、或计划被
    // stale-snapshot 拒绝）即丢弃，不再以计划后坐标错误激活。
    sdk.registerExtension(
      cm6.view.EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        const pending = ruleRuntime.consumePendingTabstops(update.view.state.doc)
        if (pending.length > 0) tabstopNav.activateTabstops(update.view, pending)
      }),
    )
  }

  // ============================================================
  // 工单 #9 增量块：Delete 联动删除与 SelectKey 选中包裹——#1 内核剩余
  // 两类触发（delete.* 白名单 / input.type 选区替换）按功能族注册进同一
  // 行为链。族设计（06-delete-rules / 07-selectkey-rules，与 #25 五族共
  // 用 input-rules 独占组）、事务前重建与坐标换算见
  // docs/specs/rule-engine.md「#9 Delete/SelectKey 触发接入」节。
  // ============================================================

  if (behaviors !== undefined) {
    const triggerRuntime = registerRuleDeleteSelectKeyBehaviors({
      behaviors,
      channel: sdk.channel,
      language: navigator.language,
      rulesSource,
    })
    for (const outcome of triggerRuntime.outcomes) {
      if (!outcome.ok) {
        // 普通 API 拒绝不算故障：经 debugLog 留痕便于诊断（logging.ts 约定）
        debugLog('trigger rule behavior register rejected:', outcome.localId, outcome.reason)
      }
    }

    // #15×#9 接线：独立暂存槽 + 独立 docChanged 监听（与 #25 通道互不干
    // 扰——独占组保证一次输入至多一族命中）。SelectKey 包裹计划携带
    // ${0:${SEL}} 的 $0 组（覆盖选中文本），计划应用后激活导航态。消费
    // 一致性校验同 #25（B-F2：传 doc 校验替换形态，失配丢弃）。
    sdk.registerExtension(
      cm6.view.EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        const pending = triggerRuntime.consumePendingTabstops(update.view.state.doc)
        if (pending.length > 0) tabstopNav.activateTabstops(update.view, pending)
      }),
    )
  }

  // ============================================================
  // 工单 #26 增量块：自动格式化行为族（06-autoformat）——语言对间距/
  // 前缀词典/自动大写/软空格符号的行级算法（src/formatting/）经
  // src/autoFormatPipeline.ts 接入。与 #25 五族共用 input-rules 独占组
  //（复刻上游「规则命中即短路格式化」链序）；设置经 #3 门面 effective
  //（autoFormat 总门在族回调内判定）；#12 粘贴联动消费 pasteMarker
  //（粘贴窗内跳过 + 纯文本意图一次性消费）。见 docs/specs/auto-format.md。
  // ============================================================

  if (behaviors !== undefined) {
    const [autoFormatOutcome] = registerAutoFormatBehavior({
      behaviors,
      channel: sdk.channel,
      language: navigator.language,
      marker: pasteMarker,
    })
    if (autoFormatOutcome !== undefined && !autoFormatOutcome.ok) {
      // 普通 API 拒绝不算故障：经 debugLog 留痕（logging.ts 约定）
      debugLog('autoformat behavior register rejected:', autoFormatOutcome.reason)
    }
  }

  // ============================================================
  // 工单 #2 增量块：注释切换命令（语言注释符表 + Markdown %%）——上游
  // comment_toggle.ts 的 Mod+/ 命令，**平台稳定 commands API**（统一快捷
  // 键管理 + 命令面板）。视图路由复用 #12 的 viewRegistry（登记表共享
  // 决策，供并行工单 #28 对照）；与平台内建 htmlComment 同弦并存的核对
  // 见 docs/specs/comment-toggle.md「平台键位冲突核对」节。
  // ============================================================

  if (commands !== undefined) {
    const registration = commands.register(
      buildToggleCommentCommandDefinition(
        pickMessages(navigator.language).commands.toggleCommentTitle,
      ),
      createToggleCommentCommandHandler({ views: viewRegistry }),
    )
    // 页面释放时注销命令（平台随代次回收，此处显式闭环）
    sdk.onDispose(() => registration.dispose())
  }

  // ============================================================
  // 工单 #28 增量块：格式化命令族——五命令经平台稳定 commands API 注册
  //（统一快捷键管理 + 命令面板）。格式化全文/选区、删除空行、选区转代码
  // 块为视图写命令（writes=true 仅 Live 正文接管宿主绑定），切换自动格式
  // 化为双模式非写命令（写 #3 生效值）。视图捕获共享 #12 块的 viewRegistry
  //（同工厂作用域、位置在前——评估结论见 docs/specs/formatting-commands.md
  //「视图路由」节）；命令面板无聚焦入口回退 views 面 main 句柄
  //（applyEdits 单请求）。文件排除（ExcludeFiles）命中 → 不执行 + 通知。
  // ============================================================

  if (commands !== undefined) {
    const formattingGate = createAutoFormatGate(sdk.channel)
    const formattingCommands = registerFormattingCommands({
      commands,
      channel: sdk.channel,
      gate: formattingGate,
      views: viewRegistry,
      getFocusedView,
      ...(sdk.views !== undefined ? { facetViews: sdk.views } : {}),
      notify: (request) => {
        // 尽力而为通道（上游 Notice 等价）；失败静默——通知不阻断命令语义
        void sdk.channel.request(NOTICE_TOPIC, request).catch(() => {})
      },
      messages: pickMessages(navigator.language),
    })
    for (const outcome of formattingCommands.outcomes) {
      if (!outcome.ok) {
        // 普通 API 拒绝不算故障：经 debugLog 留痕（logging.ts 约定）
        debugLog('formatting command register rejected:', outcome.localId, outcome.reason)
      }
    }
    // 页面释放时注销五命令（平台随代次回收，此处显式闭环）
    sdk.onDispose(() => formattingCommands.dispose())
  }
})
