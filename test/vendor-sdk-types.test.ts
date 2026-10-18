// vendorSdkTypes 闭包并集契约（#55 re-vendor 回归锚）。
//
// 背景：re-vendor 至 f7b80d6e 时，入口 addonBehaviors/addonEditApi 请求的
// protocol:SerChange 被 addonRefViews 轮次请求的 HoverPreviewFailReason
// 覆盖，快照丢导出 → 消费方 TS2305。根因是 generateAll() 同轮竞态：后到
// 的更小 roots 请求在目标模块已定 roots 后单独成轮，处理时未并入既有
// roots 即整体覆盖。本测试用最小 fixture 源仓复现该竞态形态并钉死并集
// 语义；经 --out 输出到临时目录，不触碰真实 types/vendor/ 快照。
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 生成器逐 VENDOR_ENTRIES 入口读文件——fixture 仓须让全部 11 个入口
 *  存在（无关入口给空壳），再布置竞态形态：
 *  - addonPage（入口 #1，先处理）→ 发现闭包模块 addonRefViews；
 *  - addonRefViews → 请求 protocol 的 HoverPreviewFailReason；
 *  - addonEditApi / addonBehaviors（入口 #2/#3，后处理）→ 请求 protocol
 *    的 SerChange。
 *  两路请求不同轮次到达 protocol，回归前 roots 会被后者覆盖。 */
function initFixtureRepo(dir: string): string {
  const git = (gitArgs: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', dir, ...gitArgs], {
      encoding: 'utf8',
    })
  execFileSync('git', ['init', dir], { encoding: 'utf8' })
  const write = (rel: string, text: string) => {
    const target = path.join(dir, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  for (const entry of [
    'src/shared/addonSettings.ts',
    'src/shared/addonRenderers.ts',
    'src/shared/addonCommands.ts',
    'src/shared/addonUi.ts',
    'src/shared/addonStorage.ts',
    'src/shared/addonFoldApi.ts',
    'src/shared/addonIdentity.ts',
    'src/host/addons/addonRegistry.ts',
  ]) {
    write(entry, 'export type Unused = 1\n')
  }
  write(
    'src/shared/protocol.ts',
    'export interface SerChange { op: string }\nexport type HoverPreviewFailReason = "x" | "y"\n',
  )
  write(
    'src/shared/addonRefViews.ts',
    'import type { HoverPreviewFailReason } from "./protocol"\nexport interface RefView { reason: HoverPreviewFailReason }\n',
  )
  write(
    'src/shared/addonPage.ts',
    'import type { RefView } from "./addonRefViews"\nexport interface PageSdk { ref: RefView }\n',
  )
  write(
    'src/shared/addonEditApi.ts',
    'import type { SerChange } from "./protocol"\nexport interface EditSnapshot { changes: SerChange[] }\n',
  )
  write(
    'src/shared/addonBehaviors.ts',
    'import type { SerChange } from "./protocol"\nexport interface InputContext { changes: SerChange[] }\n',
  )
  git(['add', '-A'])
  git(['commit', '-m', 'fixture'])
  return git(['rev-parse', 'HEAD']).trim()
}

describe('vendorSdkTypes 闭包并集（generateAll 轮次竞态）', () => {
  it(
    '后到的更小 roots 请求不得覆盖目标模块已定的闭包名字',
    () => {
      const sourceDir = mkdtempSync(path.join(tmpdir(), 'vet-vendor-src-'))
      const outDir = mkdtempSync(path.join(tmpdir(), 'vet-vendor-out-'))
      try {
        const commit = initFixtureRepo(sourceDir)
        execFileSync(
          'node',
          [
            path.join(repoRoot, 'scripts', 'vendorSdkTypes.mjs'),
            '--source',
            sourceDir,
            '--commit',
            commit,
            '--out',
            outDir,
          ],
          { encoding: 'utf8' },
        )
        const protocol = readFileSync(path.join(outDir, 'shared', 'protocol.ts'), 'utf8')
        // 回归前：SerChange 被 HoverPreviewFailReason 轮覆盖丢失（TS2305）
        expect(protocol).toContain('interface SerChange')
        expect(protocol).toContain('HoverPreviewFailReason')
        // 入口完整面不受 --out 与并集修复影响
        const editApi = readFileSync(path.join(outDir, 'shared', 'addonEditApi.ts'), 'utf8')
        expect(editApi).toContain('EditSnapshot')
      } finally {
        rmSync(sourceDir, { recursive: true, force: true })
        rmSync(outDir, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
