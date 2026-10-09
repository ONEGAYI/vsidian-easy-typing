// 人工验证清单结构契约（工单 #21）：钉住 docs/manual-verification.md 的
// 功能域覆盖与条目可执行性——每节在场、每个 A 条目含步骤与「预期」、
// 占位节（#28 命令族 / #19 i18n）与宿主矩阵要素不缺。后续票并入后漏补
// 占位、或改版时漂移掉验收骨架，本测试即红灯。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docPath = path.join(repoRoot, 'docs', 'manual-verification.md')

function readDoc(): string {
  if (!existsSync(docPath)) throw new Error('docs/manual-verification.md 不存在')
  return readFileSync(docPath, 'utf8')
}

// 功能域节锚点（标题前缀，含序号防重排漂移）——与票面范围一一对应：
// 规则引擎三触发面、Tabstop、格式化、保护区、七个编辑增强域、设置/规则
// 页、IME 专项，加 #28/#19 两个占位节。
const DOMAIN_SECTION_PREFIXES: readonly string[] = [
  '## 一、规则引擎 Input 触发（',
  '## 二、规则引擎 Delete / SelectKey 触发（',
  '## 三、Tabstop 占位符导航（',
  '## 四、自动格式化（',
  '## 五、自定义正则保护区（',
  '## 六、Tab 跳出 Tabout（',
  '## 七、智能退格 Backspace（',
  '## 八、渐进选择 Mod+A 与「选择当前块」（',
  '## 九、智能粘贴 SmartPaste 与纯文本粘贴（',
  '## 十、折叠标题处 Enter 新建同级标题（',
  '## 十一、当前行下方新建行（',
  '## 十二、注释切换（',
  '## 十三、规则存储与规则管理页（',
  '## 十四、设置页与设置生效（',
  '## 十五、IME 定稿链路专项（',
  '## 十六、命令族（',
  '## 十七、界面语言 i18n 完整化（',
]

describe('人工验证清单结构契约（#21）', () => {
  it('功能域节全覆盖（十七节，含 #28/#19 占位节）', () => {
    const doc = readDoc()
    for (const prefix of DOMAIN_SECTION_PREFIXES) {
      expect(doc.includes(prefix), `缺少功能域节：${prefix}…`).toBe(true)
    }
  })

  it('每个 A 条目含「预期」（步骤可执行、结果可判定）', () => {
    const doc = readDoc()
    const lines = doc.split('\n')
    const entries: { id: string; body: string[] }[] = []
    for (const line of lines) {
      const match = /^### (A\d+)\./.exec(line)
      if (match) {
        entries.push({ id: match[1], body: [] })
      } else if (entries.length > 0 && !line.startsWith('## ')) {
        // 条目正文累计到下一节/条目为止（### 行在上方 match 分支已开新条目）
        entries[entries.length - 1].body.push(line)
      }
    }
    expect(entries.length).toBeGreaterThan(30)
    // 预期可为独立段落（「预期：」）或内嵌步骤（「……：预期补全为……」），
    // 只要求每条有可判定的结果表述
    const missing = entries
      .filter((e) => !e.body.some((l) => l.includes('预期')))
      .map((e) => e.id)
    expect(missing, `以下条目缺「预期」：${missing.join(', ')}`).toEqual([])
  })

  it('真实 IME / 物理键盘 / 视觉观感三面口径显式成节', () => {
    const doc = readDoc()
    expect(doc).toContain('真实 IME（微软拼音等）')
    expect(doc).toContain('物理键盘')
    expect(doc).toContain('视觉观感')
  })

  it('宿主版本矩阵三要素：vsidian 基线 commit / VSIX 安装态 / 1.82.3 下界', () => {
    const doc = readDoc()
    expect(doc).toContain('9107e2f0554d8b5c1637d16e1d1b375543b01c1c')
    expect(doc).toContain('--install-extension')
    expect(doc).toContain('1.82.3')
    // 先装宿主再装组件（extensionDependencies 依赖顺序）在步骤中写明
    expect(doc).toContain('先装宿主再装组件')
  })

  it('历轮执行记录表骨架与归档约定在场', () => {
    const doc = readDoc()
    expect(doc).toContain('## 当前执行记录')
    expect(doc).toContain('## 历轮执行记录落档约定')
    // 轮级表与逐项表两个骨架的列头
    expect(doc).toContain('| 轮次 | 日期 | 执行人 | 环境摘要 | 覆盖范围 | 结果 | 备注 |')
    expect(doc).toContain('| 项 | 结果 | 备注（日期 / 环境 / 复现证据） |')
  })

  it('已知边界汇总表在场且被条目引用（B 编号体系）', () => {
    const doc = readDoc()
    expect(doc).toContain('## 已知边界与「不是缺陷」汇总')
    // 汇总表存在 B 编号行，且正文（表外）有 B 编号引用（边界提示不悬空）
    const boundaryIds = [...doc.matchAll(/^\| (B\d+) \|/gm)].map((m) => m[1])
    expect(boundaryIds.length).toBeGreaterThanOrEqual(15)
    const nonTableText = doc
      .split('\n')
      .filter((l) => !/^\| (?:B\d+ |编号) /.test(l))
      .join('\n')
    const referenced = new Set([...nonTableText.matchAll(/\bB\d+\b/g)].map((m) => m[0]))
    const dangling = boundaryIds.filter((id) => !referenced.has(id))
    expect(dangling, `未被条目引用的边界：${dangling.join(', ')}`).toEqual([])
  })

  it('占位节明示待补状态（#28/#19 并行票并入后补录）', () => {
    const doc = readDoc()
    expect(doc).toContain('占位待补')
    expect(doc).toContain('#28')
    expect(doc).toContain('#19')
  })
})
