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
