// 发布脚本契约测试（工单 #24）：钉住 scripts/release.mjs 的纯函数语义——
// VSIX 内容清单与体积红线、解包 manifest 冒烟口径、CHANGELOG Unreleased
// 转正算法与版本号校验。主流程（spawn vsce / PowerShell 读 zip）不在此
// 测：跨进程 IO 归 `npm run package` 端到端承载（真实产物实测）。
// 另钉两组仓库现状契约：CHANGELOG 结构（Keep a Changelog + Unreleased）
// 与 .vscodeignore 排除清单（黑名单输入侧；产物输出侧由禁止模式钉住）。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  SIZE_LIMITS,
  parseUnzipListing,
  parsePszListing,
  inspectVsixEntries,
  inspectVsixManifest,
  promoteUnreleased,
  validateVersionArg,
} from '../scripts/release.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 2026-10-09 实测打包基线（10 文件、解压约 248 KB）的最小形态。
const BASE_ENTRIES = [
  { size: 1911, name: '[Content_Types].xml' },
  { size: 3000, name: 'extension.vsixmanifest' },
  { size: 1190, name: 'extension/LICENSE.txt' },
  { size: 1485, name: 'extension/package.json' },
  { size: 2929, name: 'extension/readme.md' },
  { size: 4200, name: 'extension/changelog.md' },
  { size: 95168, name: 'extension/dist/editor.js' },
  { size: 64144, name: 'extension/dist/extension.js' },
  { size: 12676, name: 'extension/dist/settings.css' },
  { size: 75940, name: 'extension/dist/settings.js' },
]

const REPO_PKG = {
  name: 'vsidian-easy-typing',
  publisher: 'ONEGAYI',
  version: '0.1.0',
  main: './dist/extension.js',
  extensionDependencies: ['onegayi.vsidian'],
  vsidianAddon: {
    manifestVersion: 1,
    api: '^1.0.0',
    experimental: { cm6: '^1.1.0', headingFold: '^1.0.0' },
  },
}

describe('zip 条目解析（unzip 与 PowerShell 双通道）', () => {
  it('parseUnzipListing：解析 unzip -l 行，跳过表头与合计', () => {
    const text = [
      'Archive:  x.vsix',
      '  Length      Date    Time    Name',
      '---------  ---------- -----   ----',
      '     1911  2026-10-09 12:00   [Content_Types].xml',
      '     3000  2026-10-09 12:00   extension.vsixmanifest',
      '---------                     -------',
      '    95388                     9 files',
    ].join('\n')
    expect(parseUnzipListing(text)).toEqual([
      { size: 1911, name: '[Content_Types].xml' },
      { size: 3000, name: 'extension.vsixmanifest' },
    ])
  })

  it('parsePszListing：解析「大小\\t路径」行，跳过杂行', () => {
    const text = ['1911\t[Content_Types].xml', '', '3000\textension.vsixmanifest'].join('\n')
    expect(parsePszListing(text)).toEqual([
      { size: 1911, name: '[Content_Types].xml' },
      { size: 3000, name: 'extension.vsixmanifest' },
    ])
  })
})

describe('inspectVsixEntries（内容清单与体积红线）', () => {
  it('基线清单通过：必需产物齐全、无禁止文件、体积在阈值内', () => {
    const result = inspectVsixEntries(BASE_ENTRIES)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.totalBytes).toBe(BASE_ENTRIES.reduce((s, e) => s + e.size, 0))
  })

  it('缺任一运行时产物即失败（含页面样式 settings.css）', () => {
    for (const name of [
      'extension/dist/extension.js',
      'extension/dist/editor.js',
      'extension/dist/settings.js',
      // extension.ts registerPage 登记 css: ['dist/settings.css']，缺失则页面裸奔
      'extension/dist/settings.css',
      'extension/package.json',
      'extension/readme.md',
      'extension/changelog.md',
    ]) {
      const result = inspectVsixEntries(BASE_ENTRIES.filter((e) => e.name !== name))
      expect(result.ok, `缺 ${name} 应报错`).toBe(false)
    }
  })

  it('缺结构文件（vsixmanifest / Content_Types）即失败，大小写不敏感', () => {
    const noManifest = inspectVsixEntries(BASE_ENTRIES.filter((e) => !e.name.endsWith('vsixmanifest')))
    expect(noManifest.ok).toBe(false)
    const noTypes = inspectVsixEntries(BASE_ENTRIES.filter((e) => !/content_types/i.test(e.name)))
    expect(noTypes.ok).toBe(false)
  })

  it('LICENSE 形态兼容 LICENSE.txt 与裸 LICENSE', () => {
    const bare = BASE_ENTRIES.filter((e) => !/license/i.test(e.name))
    bare.push({ size: 1000, name: 'extension/LICENSE' })
    expect(inspectVsixEntries(bare).errors).toEqual([])
  })

  it('禁止模式拦截：源码 / 测试 / 文档 / node_modules / sourcemap / lockfile / 嵌套 vsix', () => {
    for (const [name, label] of [
      ['extension/src/page-editor.ts', 'TypeScript 源码'],
      ['extension/test/release.test.ts', '测试'],
      ['extension/types/vendor/x.ts', 'vendor 类型快照'],
      ['extension/tools/buildLib.mjs', '构建桥'],
      ['extension/scripts/release.mjs', '发布脚本'],
      ['extension/docs/specs/rule-engine.md', '项目文档'],
      ['extension/node_modules/foo/index.js', 'node_modules'],
      ['extension/.github/workflows/ci.yml', 'GitHub 平台配置'],
      ['extension/dist/editor.js.map', 'sourcemap'],
      ['extension/package-lock.json', 'npm lockfile'],
      ['extension/nested.vsix', 'VSIX 嵌套'],
    ] as Array<[string, string]>) {
      const result = inspectVsixEntries([...BASE_ENTRIES, { size: 100, name }])
      expect(result.ok, `${label} ${name} 进包应报错`).toBe(false)
    }
  })

  it('未知顶层条目拒绝（黑名单拦不住的工具残留，白名单兜底）', () => {
    const result = inspectVsixEntries([...BASE_ENTRIES, { size: 10, name: 'extension/.zcode/config' }])
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/未知顶层/)
  })

  it('dist/ 下未登记产物拒绝（构建实验残留）', () => {
    const result = inspectVsixEntries([...BASE_ENTRIES, { size: 10, name: 'extension/dist/debug.js' }])
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/未登记/)
  })

  it('解压总量：超警告线只警告，超失败线报错', () => {
    // 构造总量落进 (警告线, 失败线) 区间的场景：三个 dist 大文件各 500 KB
    // （单文件不触 512 KB 警告线），总量约 1.5 MB——只触发总量警告。
    const KB = 1024
    const inflated = BASE_ENTRIES.map((e) =>
      e.name === 'extension/dist/editor.js' ||
      e.name === 'extension/dist/extension.js' ||
      e.name === 'extension/dist/settings.js'
        ? { ...e, size: 500 * KB }
        : e,
    )
    expect(inspectVsixEntries(inflated).warnings.some((w) => w.includes('解压总体积'))).toBe(true)
    expect(inspectVsixEntries(inflated).ok).toBe(true)
    // 各 800 KB × 3 → 总量约 2.4 MB 超失败线（单文件 800 KB 未超 1 MB 失败线）
    const overMax = BASE_ENTRIES.map((e) =>
      e.name === 'extension/dist/editor.js' ||
      e.name === 'extension/dist/extension.js' ||
      e.name === 'extension/dist/settings.js'
        ? { ...e, size: 800 * KB }
        : e,
    )
    expect(inspectVsixEntries(overMax).ok).toBe(false)
    expect(inspectVsixEntries(overMax).errors.join('\n')).toMatch(/解压总体积/)
  })

  it('单文件：超警告线只警告，超失败线报错', () => {
    const withBig = BASE_ENTRIES.map((e) =>
      e.name === 'extension/dist/editor.js' ? { ...e, size: SIZE_LIMITS.fileWarnBytes + 1 } : e,
    )
    expect(inspectVsixEntries(withBig).warnings.some((w) => w.includes('单文件'))).toBe(true)
    expect(inspectVsixEntries(withBig).ok).toBe(true)
    const overMax = BASE_ENTRIES.map((e) =>
      e.name === 'extension/dist/editor.js' ? { ...e, size: SIZE_LIMITS.fileMaxBytes + 1 } : e,
    )
    expect(inspectVsixEntries(overMax).ok).toBe(false)
  })
})

describe('inspectVsixManifest（解包冒烟：manifest 合法性与声明核对）', () => {
  const manifestText = JSON.stringify(REPO_PKG, null, 2)

  it('与仓库清单一致的 manifest 通过', () => {
    const result = inspectVsixManifest(manifestText, REPO_PKG)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('非法 JSON 报错', () => {
    expect(inspectVsixManifest('{oops', REPO_PKG).ok).toBe(false)
  })

  it('版本与仓库不一致报错（打包时版本漂移）', () => {
    const drifted = JSON.stringify({ ...REPO_PKG, version: '0.0.9' })
    const result = inspectVsixManifest(drifted, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/version/)
  })

  it('extensionDependencies 缺宿主声明报错', () => {
    const noDeps = JSON.stringify({ ...REPO_PKG, extensionDependencies: [] })
    const result = inspectVsixManifest(noDeps, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/extensionDependencies/)
  })

  it('vsidianAddon 身份声明缺失或漂移报错（宿主发现机制的入口）', () => {
    const missing = JSON.stringify({ ...REPO_PKG, vsidianAddon: undefined })
    expect(inspectVsixManifest(missing, REPO_PKG).ok).toBe(false)
    const drifted = JSON.stringify({
      ...REPO_PKG,
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: {} },
    })
    const result = inspectVsixManifest(drifted, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/vsidianAddon/)
  })

  it('main 入口漂移报错', () => {
    const drifted = JSON.stringify({ ...REPO_PKG, main: './out/extension.js' })
    const result = inspectVsixManifest(drifted, REPO_PKG)
    expect(result.ok).toBe(false)
    expect(result.errors.join('\n')).toMatch(/main/)
  })
})

describe('promoteUnreleased（CHANGELOG Unreleased 段转正）', () => {
  const source = [
    '# Changelog',
    '',
    '头部说明若干行。',
    '',
    '## Unreleased - 开发中',
    '',
    '### 新增',
    '',
    '- 首个条目（#1）',
    '- 第二个条目（#7）',
    '',
    '## 0.0.9 - 2026-09-01',
    '',
    '- 旧版本条目',
  ].join('\n')

  it('转正：版本段补日期，顶部重建空 Unreleased 段，正文与旧版本段原样保留', () => {
    const out = promoteUnreleased(source, '0.1.0', '2026-10-09')
    const lines = out.split('\n')
    expect(lines.filter((l) => /^## /.test(l))).toEqual([
      '## Unreleased - 开发中',
      '## 0.1.0 - 2026-10-09',
      '## 0.0.9 - 2026-09-01',
    ])
    expect(out).toContain('- 首个条目（#1）')
    expect(out).toContain('- 旧版本条目')
    // 重建的空 Unreleased 段位于版本段之前（顶部）
    expect(out.indexOf('## Unreleased')).toBeLessThan(out.indexOf('## 0.1.0'))
  })

  it('Unreleased 段缺失时抛错', () => {
    const noSection = source.replace('## Unreleased - 开发中\n\n### 新增', '### 新增')
    expect(() => promoteUnreleased(noSection, '0.1.0', '2026-10-09')).toThrow(/Unreleased/)
  })

  it('Unreleased 段为空（无条目）时抛错', () => {
    const empty = '# Changelog\n\n## Unreleased - 开发中\n\n## 0.0.9 - 2026-09-01\n\n- 旧条目\n'
    expect(() => promoteUnreleased(empty, '0.1.0', '2026-10-09')).toThrow(/为空|无条目/)
  })

  it('目标版本号已存在时抛错（防重复发版）', () => {
    expect(() => promoteUnreleased(source, '0.0.9', '2026-10-09')).toThrow(/已存在/)
  })
})

describe('validateVersionArg（语义化版本校验）', () => {
  it('合法 x.y.z 原样返回', () => {
    expect(validateVersionArg('0.1.0')).toBe('0.1.0')
    expect(validateVersionArg('1.20.3')).toBe('1.20.3')
  })

  it('前缀 / 缺段 / 非数字一律拒绝', () => {
    for (const bad of ['v0.1.0', '0.1', '0.1.0.0', 'abc', '0.1.0-beta']) {
      expect(() => validateVersionArg(bad), bad).toThrow(/版本号/)
    }
  })
})

describe('仓库现状契约（CHANGELOG 结构与 .vscodeignore 输入侧黑名单）', () => {
  it('CHANGELOG.md 在场：Keep a Changelog 头部说明 + 非空 Unreleased 段', () => {
    const file = path.join(repoRoot, 'CHANGELOG.md')
    expect(existsSync(file), 'CHANGELOG.md 缺失').toBe(true)
    const text = readFileSync(file, 'utf8')
    expect(text).toMatch(/Keep a Changelog/)
    expect(text).toMatch(/^## Unreleased/m)
    // Unreleased 段非空：标题之后、下一版本段之前存在非空行
    const lines = text.split(/\r?\n/)
    const start = lines.findIndex((l) => /^## Unreleased/.test(l))
    const end = lines.findIndex((l, i) => i > start && /^## \d/.test(l))
    const body = lines.slice(start + 1, end < 0 ? lines.length : end).join('')
    expect(body.trim().length, 'Unreleased 段应有条目骨架').toBeGreaterThan(0)
  })

  it('.vscodeignore 排除源码/测试/文档/工程设施（与检查器禁止模式同源）', () => {
    const text = readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8')
    for (const pattern of [
      'src/**',
      'test/**',
      'types/**',
      'tools/**',
      'scripts/**',
      'docs/**',
      'node_modules/**',
      '**/*.map',
      'package-lock.json',
    ]) {
      expect(text, `应排除 ${pattern}`).toContain(pattern)
    }
  })

  it('SIZE_LIMITS 双线语义：警告线严于失败线、均为正数', () => {
    expect(SIZE_LIMITS.totalWarnBytes).toBeLessThan(SIZE_LIMITS.totalMaxBytes)
    expect(SIZE_LIMITS.fileWarnBytes).toBeLessThan(SIZE_LIMITS.fileMaxBytes)
    // 总量失败线须容纳当前基线（约 242 KB 解压）
    expect(SIZE_LIMITS.totalMaxBytes).toBeGreaterThan(240 * 1024)
  })
})
