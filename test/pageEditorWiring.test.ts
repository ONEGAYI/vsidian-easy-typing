// page-editor 装配序结构契约（review-loops 第 1 轮 B-F2）：BetterCodeEdit
// 三处接线的**相对装配序**此前仅由注释与规格承载，CM6 升级或 SDK 装配
// 行为变化时无红灯。用文本行序断言钉住三条承重序（同槽/同层内 CM6 按
// 扩展数组原序尝试——dist 源码 flatten/computeHandlers 已核）：
// 1. #10 粘贴对齐注册在 #12 SmartPaste **之前**（上游 cm_extensions.ts
//    分支顺序 112 → 168 的等价形态：代码块命中即接管，SmartPaste 不再看）；
// 2. #10 Backspace 注册在 #8 BetterBackspace **之后**（同层 Prec.high 按
//    注册序即尝试序，#8 空列表/引用项先试）；
// 3. Mod+A 合成链 `modARun(view) || codeBlockModARun(view)` 在单一 keymap
//    binding 内（无中间 keymap 可打断 #11 透传按键的 refresh hook）。
// 断言粒度取工厂调用锚点行号相对序，不锁绝对行号与注释措辞。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pageEditorPath = path.join(repoRoot, 'src/page-editor.ts')
const source = readFileSync(pageEditorPath, 'utf8')

function lineOf(anchor: string): number {
  // 锚点取「注册调用语境」子串（paste:/run: 前缀），而非工厂名本身——
  // 工厂名首次出现是 import 行，与注册序无因果（第 2 轮复核 P3-2 修复）
  const index = source.indexOf(anchor)
  expect(index, `锚点不在 page-editor.ts 源码中: ${anchor}`).toBeGreaterThanOrEqual(0)
  return source.slice(0, index).split('\n').length
}

describe('page-editor 装配序契约（BetterCodeEdit 三接线）', () => {
  it('#10 粘贴对齐注册在 #12 SmartPaste 之前（代码块分支先看，上游分支顺序）', () => {
    expect(lineOf('paste: createCodeBlockPasteHandler({')).toBeLessThan(lineOf('paste: createSmartPastePasteHandler({'))
  })

  it('#10 Backspace 注册在 #8 BetterBackspace 之后（同层注册序即尝试序，#8 先试）', () => {
    expect(lineOf('run: createBetterBackspaceCommand(')).toBeLessThan(lineOf('run: createCodeBlockBackspaceCommand('))
  })

  it('Mod+A 合成链在单一 keymap binding 内（#11 || #10 原子 OR，refresh hook 不被打断）', () => {
    expect(source).toContain('modARun(view) || codeBlockModARun(view)')
  })
})

// 共享设置拉取通道装配契约（工单 #32）：一次 focusChanged 的 8 个设置门
// refresh 与装载期首拉若绕过共享通道（直传 sdk.channel），8 次独立
// SETTINGS_TOPIC.get 放大（宿主侧每请求 structuredClone 全量 effective）
// 即回潮。钉住两条：共享通道创建先于首个 gate 装配；全部 get 消费工厂
// 不再直传 sdk.channel（ruleClient / plainPaste / formattingCommands 的
// update 注入不在 get 消费面，不在此列）。
describe('page-editor 共享设置通道装配契约（#32）', () => {
  it('共享通道创建在首个 gate 装配之前（debug 门消费点先于 behaviorGates）', () => {
    expect(lineOf('const settingsChannel = createSharedSettingsChannel(')).toBeLessThan(
      lineOf('createBooleanSettingGate(settingsChannel'),
    )
  })

  it('get 消费工厂不再直传 sdk.channel（绕过共享层即失去并发合并，防回潮）', () => {
    const directAnchors = [
      'createBooleanSettingGate(sdk.channel',
      'createEnhanceModAGate(sdk.channel',
      'createCollapseEnterGate(sdk.channel',
      'createNewLineBelowGate(sdk.channel',
      'createAutoFormatGate(sdk.channel',
      'sdk.channel.request(SETTINGS_TOPIC.get',
    ]
    for (const anchor of directAnchors) {
      expect(source).not.toContain(anchor)
    }
  })

  it('sdk.channel 直传总数受控（评审 R1-F2：枚举锚点拦不住新工厂名，总量断言强制过目）', () => {
    // 现状 5 处：ruleClient（RULES 族，非 get）/ 共享包装器入参（get 的
    // 唯一合法上游）/ plainPaste 剪贴板（非 get）/ formattingCommands 注入
    // （仅 update 写）/ NOTICE。新增第 6 处直传必须过目更新此数——若它
    // 是 get 消费点，改走 settingsChannel 而不是放宽断言。
    const directUses = source.match(/sdk\.channel/g) ?? []
    expect(directUses.length).toBe(5)
  })
})

// #30 strictEnter 装配契约：Enter 键同层（Prec.high）仲裁靠注册序——
// #18 foldEnter 先注册先尝试（折叠标题行优先），#30 strictEnter 后注册；
// 装配序被 CM6 升级或块重排破坏时红灯（ADR-0002 §三.B.2 定案）。
describe('page-editor #30 装配契约（strictEnter 仲裁与接线）', () => {
  it('#30 strict Enter 注册在 #18 foldEnter 之后（同层注册序即尝试序，折叠先试）', () => {
    expect(lineOf('run: createFoldEnterCommand(')).toBeLessThan(
      lineOf('run: createStrictEnterCommand('),
    )
  })

  it('Mod+Enter 严格注入接线在位（createNewLineBelowCommand 携带 strict 依赖块）', () => {
    expect(source).toContain('strict: {')
  })

  it('宿主严格渲染门消费 hostSettings 白名单键（editor.readingBreaks，#457 契约）', () => {
    expect(source).toContain("get('editor.readingBreaks')")
  })
})
