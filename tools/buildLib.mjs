// 构建库（复制自 ONEGAYI/vsidian@test/examples/tools/buildLib.mjs 并收敛为
// 单工程形态，蓝本见 vsidian test/examples/README.md「复制到独立仓库」清单）：
// 页面 IIFE（SDK 构建桥 + CM6 双红线）+ 宿主 CJS（external vscode）+
// 产物扫描（无 vsidian 内部路径 / 裸 require / CM6 运行时标记）。
// 构建通过即扫描通过——「npm run build」即双防线入口。
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSdkBridgePlugin } from './sdkBridge.mjs'
import { CM6_RUNTIME_MARKERS } from './cm6Markers.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 产物中不得出现的 vsidian 内部路径标记（type-only 导入被 esbuild 剥离；
 * 产物含任一即证明把平台内部代码或 vendor 快照的值级代码打进了 bundle——
 * SDK 类型只允许经 types/vendor 的 type-only 导入消费）。
 */
export const INTERNAL_PATH_MARKERS = [
  'src/shared',
  'src/host',
  'test/fixtures',
  'test/examples',
  'types/vendor',
]

/**
 * 产物静态扫描（验收：产物无内部路径导入、裸 require 或重复 CM6）。
 * - page（浏览器 IIFE）：不得含任何 require( 调用（自包含）；
 * - host（扩展宿主 CJS）：仅允许 require('vscode')（engines 依赖，external）。
 * 两种产物都不得含 CM6 运行时标记与内部路径标记。
 */
export function scanArtifact(productPath, kind) {
  const text = readFileSync(productPath, 'utf8')
  for (const marker of CM6_RUNTIME_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`${productPath} 含 CM6 运行时标记「${marker}」——本插件产物不得重打包 @codemirror/*`)
    }
  }
  for (const marker of INTERNAL_PATH_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`${productPath} 含 vsidian 内部路径标记「${marker}」——本插件不得导入 Vsidian 内部代码或 vendor 值代码`)
    }
  }
  const requires = [...text.matchAll(/require\(\s*(['"])([^'"]*)\1\s*\)/g)].map((m) => m[2])
  if (kind === 'page' && requires.length > 0) {
    throw new Error(`${productPath} 含 require 调用（${requires.join(', ')}）——页面产物须为自包含 IIFE`)
  }
  if (kind === 'host') {
    const bare = requires.filter((id) => id !== 'vscode')
    if (bare.length > 0) {
      throw new Error(`${productPath} 含 vscode 之外的裸 require（${bare.join(', ')}）——宿主产物仅允许依赖 vscode`)
    }
  }
}

/**
 * 构建本插件。页面入口（编辑器页/设置页）打成 chrome114 IIFE（对齐下界
 * 宿主 1.82.3 = Electron 25 / Chromium 114，经 SDK 构建桥解析虚拟模块
 * vsidian-addon-sdk 并拒绝 @codemirror/* 值导入）；宿主入口打成 node18
 * CJS（external vscode）。src/ 下的 .css 随页面拷入 dist/。逐产物扫描。
 *
 * @param {object} input
 * @param {Array<{ entry: string, out: string }>} input.pages 页面入口（相对仓库根）
 * @param {string} input.host 宿主入口（相对仓库根，产物固定 dist/extension.js）
 * @param {(message: string) => void} [input.log]
 */
export async function buildAddon({ pages, host, log = console.log }) {
  const distDir = path.join(repoRoot, 'dist')
  mkdirSync(distDir, { recursive: true })
  const sdkBridge = createSdkBridgePlugin()
  for (const page of pages) {
    const outfile = path.join(repoRoot, page.out)
    mkdirSync(path.dirname(outfile), { recursive: true })
    await build({
      entryPoints: [path.join(repoRoot, page.entry)],
      outfile,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome114',
      minify: true,
      sourcemap: false,
      logLevel: 'silent',
      plugins: [sdkBridge],
    })
    scanArtifact(outfile, 'page')
    log(`[build] 页面 ${page.entry} -> ${page.out}（${statSync(outfile).size} B，扫描通过）`)
  }
  const hostOut = path.join(repoRoot, 'dist', 'extension.js')
  await build({
    entryPoints: [path.join(repoRoot, host)],
    outfile: hostOut,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    minify: true,
    sourcemap: false,
    logLevel: 'silent',
    external: ['vscode'],
  })
  scanArtifact(hostOut, 'host')
  log(`[build] 宿主 ${host} -> dist/extension.js（${statSync(hostOut).size} B，扫描通过）`)
  // 样式随页面拷贝（src/*.css -> dist/，装载登记 css: ['dist/editor.css'] 等；
  // 脚手架阶段尚无样式文件，保留通道供后续票使用）
  for (const name of readdirSync(path.join(repoRoot, 'src'))) {
    if (name.endsWith('.css')) {
      cpSync(path.join(repoRoot, 'src', name), path.join(distDir, name))
      log(`[build] 样式 ${name} -> dist/`)
    }
  }
  return { distDir }
}
