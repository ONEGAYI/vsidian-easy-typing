// 范例文档结构契约（工单 #20）：钉住 docs/showcase.md 与
// docs/architecture.md 的必需节、checklist 可执行性（步骤 + 命令 +
// 身份字段清单）、致敬三要素（双署名 / 功能对应表 / 永不移植三条）与
// blocked 现状——改版或裁剪时漂移掉导览骨架、或相对链接腐烂，本测试
// 即红灯。形态对齐 manual-verification.test.ts（#21）。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readDoc(rel: string): string {
  const p = path.join(repoRoot, rel)
  if (!existsSync(p)) throw new Error(`${rel} 不存在`)
  return readFileSync(p, 'utf8')
}

// showcase 六大节锚点（标题前缀，含序号防重排漂移）——与票面范围一一对应：
// 工程结构导览（构建桥/vendor/CI 与发布）、开票流程、里程碑、跨仓互链、
// 致敬与许可、blocked 现状。
const SHOWCASE_SECTIONS: readonly string[] = [
  '## 一、范例价值速览',
  '## 二、以本仓库为模板的起步 checklist',
  '### 第 1 步：复制仓库与改写身份字段',
  '### 第 2 步：处理 LICENSE（署名规则）',
  '### 第 3 步：re-vendor SDK 类型快照',
  '### 第 4 步：裁剪领域代码与测试',
  '### 第 5 步：核对打包内容清单（REQUIRED_RUNTIME 注意点）',
  '### 第 6 步：本地验证与首提交',
  '## 三、工程设施如何复制',
  '### 构建桥（tools/ 三件套 + build.mjs）',
  '### vendor 类型快照（scripts/vendorSdkTypes.mjs）',
  '### CI 与发布',
  '## 四、流程约定：开票、里程碑与跨仓互链',
  '### 开票与规格先行',
  '### 里程碑节奏',
  '### 与 vsidian 主仓库的跨仓互链',
  '## 五、上游致敬与许可',
  '### 许可',
  '### 功能对应表',
  '### 永不移植清单（三条）',
  '### blocked 项现状（#4 / #5 / #10）',
]

// architecture 六节锚点——三入口、分层地图、触发四通道、平台接入三件套、
// 依赖方向纪律、测试形态。
const ARCHITECTURE_SECTIONS: readonly string[] = [
  '## 一、三入口与三产物',
  '## 二、分层模块地图',
  '## 三、触发四通道',
  '## 四、平台接入三件套',
  '## 五、依赖方向纪律（改代码前的核对清单）',
  '## 六、测试形态',
]

/** 提取 markdown 相对链接目标（排除 http 与锚点），供防悬空校验 */
function relativeLinkTargets(doc: string): string[] {
  return [...doc.matchAll(/\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((t) => !/^(https?:|#|mailto:)/.test(t))
}

describe('范例导读结构契约（#20 showcase）', () => {
  it('必需节全覆盖（六大节 + 六步 checklist + 设施/流程/致敬子节）', () => {
    const doc = readDoc('docs/showcase.md')
    for (const prefix of SHOWCASE_SECTIONS) {
      expect(doc.includes(prefix), `缺少节：${prefix}…`).toBe(true)
    }
  })

  it('checklist 可执行：验证命令块在场、身份字段五落点齐全', () => {
    const doc = readDoc('docs/showcase.md')
    // 第 6 步的本地验证命令（可操作判据）
    for (const cmd of ['npm ci', 'npm run compile', 'npm run test', 'npm run package']) {
      expect(doc.includes(cmd), `checklist 缺验证命令：${cmd}`).toBe(true)
    }
    // 身份字段清单五落点（字段清单齐全）
    for (const field of [
      'package.json',
      'SELF_ID',
      'ADDON_ID',
      'LOG_PREFIX',
      'test/scaffold.test.ts',
    ]) {
      expect(doc.includes(field), `身份字段清单缺落点：${field}`).toBe(true)
    }
  })

  it('工程设施三节各含核心机制锚点（双防线 / re-vendor / 护栏）', () => {
    const doc = readDoc('docs/showcase.md')
    expect(doc).toContain('tools/sdkBridge.mjs')
    expect(doc).toContain('tools/cm6Markers.mjs')
    expect(doc).toContain('npm run vendor:sdk')
    expect(doc).toContain('npm run vendor:check')
    expect(doc).toContain('REQUIRED_RUNTIME')
    expect(doc).toContain('npm run release -- <x.y.z>')
  })

  it('流程节含规格三要素与跨仓互链四步', () => {
    const doc = readDoc('docs/showcase.md')
    for (const k of ['验收口径', '上游对照', '平台映射']) {
      expect(doc, `规格三要素缺：${k}`).toContain(k)
    }
    expect(doc).toContain('platform-dependency')
    expect(doc).toContain('DEFAULT_COMMIT')
  })

  it('致敬三要素：MIT 双署名、功能对应表（≥20 工单行）、永不移植三条', () => {
    const doc = readDoc('docs/showcase.md')
    expect(doc).toContain('MIT')
    expect(doc).toContain('Yaozhuwa')
    // 功能对应表行：| #<票号> | 形态，逐行计数
    const ticketRows = [...doc.matchAll(/^\| #\d+ \|/gm)]
    expect(ticketRows.length, '功能对应表工单行不足 20').toBeGreaterThanOrEqual(20)
    // 永不移植三条
    for (const item of ['MS-IME', 'macOS 右键菜单', 'TryFixChineseIME']) {
      expect(doc, `永不移植清单缺：${item}`).toContain(item)
    }
  })

  it('blocked 三项现状在场（#4 / #5 / #10）', () => {
    const doc = readDoc('docs/showcase.md')
    expect(doc).toContain('#4 行内间距策略')
    expect(doc).toContain('#5 语法树行类型适配')
    expect(doc).toContain('#10 BetterCodeEdit')
  })

  it('与 architecture 互指（两份导览各说各话、互为入口）', () => {
    expect(readDoc('docs/showcase.md')).toContain('docs/architecture.md')
    expect(readDoc('docs/architecture.md')).toContain('docs/showcase.md')
  })
})

describe('代码导览结构契约（#20 architecture）', () => {
  it('必需六节全覆盖', () => {
    const doc = readDoc('docs/architecture.md')
    for (const prefix of ARCHITECTURE_SECTIONS) {
      expect(doc.includes(prefix), `缺少节：${prefix}…`).toBe(true)
    }
  })

  it('触发四通道与分层四层在场（表格锚点）', () => {
    const doc = readDoc('docs/architecture.md')
    for (const ch of ['行为链', 'keymap', '命令', '粘贴事件']) {
      expect(doc, `触发通道缺：${ch}`).toContain(ch)
    }
    for (const layer of ['L0 纯逻辑内核', 'L1 算法层', 'L2 接入层', 'L3 平台接线层']) {
      expect(doc, `分层缺：${layer}`).toContain(layer)
    }
  })

  it('依赖方向纪律含核心条目（import type / 零平台依赖 / 动态代码禁令）', () => {
    const doc = readDoc('docs/architecture.md')
    expect(doc).toContain('import type')
    expect(doc).toContain('零平台依赖')
    expect(doc).toContain('new Function')
  })
})

describe('导览文档链接不悬空（#20）', () => {
  const docs: readonly string[] = ['docs/showcase.md', 'docs/architecture.md']

  it.each(docs)('%s 相对链接目标全部存在', (rel) => {
    const doc = readDoc(rel)
    const base = path.dirname(path.join(repoRoot, rel))
    const missing = relativeLinkTargets(doc)
      .map((t) => path.resolve(base, t.replaceAll('/', path.sep)))
      .filter((p) => !existsSync(p))
    expect(missing, `悬空链接：${missing.join(', ')}`).toEqual([])
  })

  it('README 指向两份导览（范例模板段补链，工单 #20）', () => {
    const readme = readDoc('README.md')
    expect(readme).toContain('docs/showcase.md')
    expect(readme).toContain('docs/architecture.md')
  })
})
