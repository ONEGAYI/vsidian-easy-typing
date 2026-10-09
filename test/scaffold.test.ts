// 脚手架冒烟与结构契约（工单 #22）：证明测试设施工作的同时，钉住
// manifest 声明、vendor 快照纪律与源码导入纪律三组易回归事实。
// 「experimental 范围必须 ^」是平台兼容判定的实证坑（精确版本在宿主升级
// 即判不兼容），由本测试钉死。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface ManifestContract {
  main: string
  engines: { vscode: string }
  extensionDependencies: string[]
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  vsidianAddon: {
    manifestVersion: number
    api: string
    experimental: Record<string, string>
  }
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'))
}

function listFiles(dirRel: string, out: string[] = []): string[] {
  const dir = path.join(repoRoot, dirRel)
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      listFiles(path.join(dirRel, name), out)
    } else {
      out.push(path.join(dirRel, name).replaceAll('\\', '/'))
    }
  }
  return out
}

describe('manifest 契约（vsidianAddon 清单与依赖锁定）', () => {
  const pkg = readJson('package.json') as ManifestContract

  it('vsidianAddon 声明：api 与 experimental 范围一律用 ^', () => {
    expect(pkg.vsidianAddon.manifestVersion).toBe(1)
    expect(pkg.vsidianAddon.api).toBe('^1.0.0')
    expect(pkg.vsidianAddon.experimental).toEqual({ cm6: '^1.1.0' })
  })

  it('宿主依赖与下界对齐', () => {
    expect(pkg.extensionDependencies).toEqual(['onegayi.vsidian'])
    expect(pkg.engines.vscode).toBe('^1.82.3')
    expect(pkg.main).toBe('./dist/extension.js')
  })

  it('依赖全部精确版本（无 ^ / ~ 前缀）', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [name, range] of Object.entries(deps)) {
      expect(range, `${name} 应为精确版本`).toMatch(/^\d/)
    }
  })
})

describe('vendor SDK 类型快照纪律', () => {
  const vendorFiles = listFiles('types/vendor').filter((f) => f.endsWith('.ts'))

  it('快照在场且非空', () => {
    expect(vendorFiles.length).toBeGreaterThanOrEqual(17)
    for (const entry of [
      'types/vendor/shared/addonPage.ts',
      'types/vendor/shared/addonBehaviors.ts',
      'types/vendor/shared/addonSettings.ts',
      'types/vendor/shared/addonStorage.ts',
      'types/vendor/host/addons/addonRegistry.ts',
    ]) {
      expect(existsSync(path.join(repoRoot, entry)), `${entry} 缺失`).toBe(true)
    }
  })

  it('每个快照文件头标注来源 commit（vendored from ONEGAYI/vsidian@）', () => {
    expect(vendorFiles.length).toBeGreaterThan(0)
    for (const rel of vendorFiles) {
      const head = readFileSync(path.join(repoRoot, rel), 'utf8').split('\n')[0]
      expect(head, `${rel} 缺 vendored 头`).toMatch(/^\/\/ vendored from ONEGAYI\/vsidian@[0-9a-f]{40} — /)
    }
  })
})

describe('源码导入纪律（构建桥第一道防线的测试侧镜像）', () => {
  const srcFiles = listFiles('src').filter((f) => f.endsWith('.ts'))

  it('@codemirror/* 与 types/vendor 只允许 type-only 导入', () => {
    expect(srcFiles.length).toBeGreaterThan(0)
    for (const rel of srcFiles) {
      const lines = readFileSync(path.join(repoRoot, rel), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!/^\s*import\s/.test(line)) return
        // 目标是 @codemirror/* 或 types/vendor 的导入行必须是 import type
        // （逐行判定，约定导入语句单行书写——构建桥与产物扫描是兜底防线）
        if (!/['"](?:@codemirror\/|[^'"]*types\/vendor)/.test(line)) return
        expect(
          /^\s*import\s+type\b/.test(line),
          `${rel}:${index + 1} 值导入 @codemirror/* 或 vendor（只允许 import type）：${line.trim()}`,
        ).toBe(true)
      })
    }
  })
})

describe('LICENSE 双署名', () => {
  it('保留上游版权行并附本项目声明', () => {
    const text = readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8')
    expect(text).toContain('Copyright (c) 2026 Yaozhu Ye')
    expect(text).toContain('vsidian-easy-typing contributors')
    expect(text).toContain('MIT License')
  })
})
