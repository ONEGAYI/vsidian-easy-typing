// 发布脚本骨架（工单 #24）：打包 → 体积与内容检查 → VSIX 解包冒烟；
// release 子命令另做版本号 bump 与 CHANGELOG 日期段切换。
//
//   npm run package               # compile + 打包 + 检查 + 冒烟（只产本地 VSIX）
//   npm run release -- <x.y.z>    # bump + CHANGELOG Unreleased 转正 + 打包 + 冒烟
//
// 打包命令与 CI（#23 的 VSIX 步骤）同款形态：npx @vscode/vsce package
// --no-dependencies（esbuild bundle 自包含，无 node_modules；vsce 经
// package.json 的 vscode:prepublish 自动重建三产物）。
//
// 发行护栏（票面红线）：对外发布 VSIX 需「vsidian 附加组件 API 落账发行」
// 与「用户明确授权」二者齐备，缺一不发布。本脚本不提供任何上传/发布路径
// （无 marketplace / gh release 通道，恒为 dry-run 语义——只产本地 VSIX），
// 真实发行是人工动作。vsidian API 现为 1.0.0 候选未发行，本插件前期只做
// 本地安装验证（真实安装态冒烟归工单 #21 人工清单，本脚本的「冒烟」是
// VSIX 解包结构校验：dist 三产物与页面样式在场、manifest 合法、
// extensionDependencies / vsidianAddon 声明与仓库清单一致）。
//
// 纯函数（parseUnzipListing / parsePszListing / inspectVsixEntries /
// inspectVsixManifest / promoteUnreleased / validateVersionArg）由
// test/release.test.ts 契约测试钉住，模式对齐 vsidian 主仓
// scripts/release.mjs。

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SIZE_LIMITS = {
  // 解压总量：2026-10-09 基线约 242 KB / 9 文件（三 JS 产物共约 226 KB +
  // settings.css 12.7 KB + manifest/readme/license 约 5.5 KB）。本插件零
  // 运行时依赖、无随包二进制资产（对比 vsidian 主仓的 KaTeX/Mermaid/PDF），
  // 红线语义是「防意外塞进大文件/依赖」而非精确预算：警告线 1 MB 留 4 倍
  // 余量容纳页面功能继续增长，失败线 2 MB 拦截误引入运行时依赖或资产。
  totalWarnBytes: 1 * 1024 * 1024,
  totalMaxBytes: 2 * 1024 * 1024,
  // 单文件：最大项 dist/editor.js 基线约 93 KB（规则数据与页面逻辑），
  // 警告线 512 KB / 失败线 1 MB——同样防意外，不为正常增长设障。
  fileWarnBytes: 512 * 1024,
  fileMaxBytes: 1 * 1024 * 1024,
}

// 必需结构文件：VSIX 根（统一按小写 basename 匹配，实测形态
// [Content_Types].xml 大小写混合）。
const REQUIRED_ROOT = ['extension.vsixmanifest', '[content_types].xml']

// 必需运行时资产：vsce 自动打入的 manifest/readme/license/changelog +
// dist 四产物。settings.css 是 extension.ts registerPage 登记的页面样式
// （css: ['dist/settings.css']），缺失则规则管理页无样式。
const REQUIRED_RUNTIME = [
  'package.json',
  'readme.md',
  'readme.en.md', // #19 双语 README——vsce 对仓库 README.en.md 自动打入
  'changelog.md', // vsce 对仓库 CHANGELOG.md 自动打入（实测小写形态）
  'license', // 实测形态 LICENSE.txt，前缀匹配兜底
  'dist/extension.js',
  'dist/editor.js',
  'dist/settings.js',
  'dist/settings.css',
]

// 禁止模式：仓库管理与开发文件一律不得进入 VSIX（大小写不敏感），
// 与 .vscodeignore 黑名单同源——.vscodeignore 挡打包输入，这里挡最终产物。
const FORBIDDEN_PATTERNS = [
  [/^extension\/\.github\//, 'GitHub 平台配置'],
  [/\/\.git(\/|$)/, '.git 目录'],
  [/node_modules/, 'node_modules'],
  [/^extension\/src\//, 'TypeScript 源码'],
  [/^extension\/test\//, '测试'],
  [/^extension\/types\//, 'vendor 类型快照'],
  [/^extension\/tools\//, '构建桥'],
  [/^extension\/scripts\//, '仓库脚本'],
  [/^extension\/docs\//, '项目文档'],
  [/\.map$/, 'sourcemap'],
  [/\.tsx?$/, 'TypeScript 源文件'],
  [/package-lock\.json$/, 'npm lockfile'],
  [/\.vsix$/, 'VSIX 嵌套'],
  [/\.log$/, '日志'],
]

// extension/ 下顶层白名单：git 忽略不等于 vsce 排除（vsidian 主仓实证
// .zcode 等工具残留混入包内且黑名单拦不住），未知顶层条目一律拒绝；
// dist/ 内未登记产物同样拒绝（构建实验残留）。新增根级运行时资产须同步
// 登记此处与 REQUIRED_RUNTIME。
const ALLOWED_TOP = new Set([
  'dist',
  'package.json',
  'readme.md',
  'readme.en.md',
  'changelog.md',
  'license',
  'license.txt',
])
const ALLOWED_DIST = new Set(REQUIRED_RUNTIME.filter((rel) => rel.startsWith('dist/')))

/** 解析 `unzip -l` 输出为条目列表（name 含 `extension/` 前缀）。 */
export function parseUnzipListing(text) {
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+(.+)$/)
    if (m) entries.push({ size: Number(m[1]), name: m[2].trim() })
  }
  return entries
}

/** 解析 PowerShell ZipFile.OpenRead 输出（「大小\t路径」行，Windows 回退通道）。 */
export function parsePszListing(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.includes('\t'))
    .map((l) => {
      const [size, ...rest] = l.split('\t')
      return { size: Number(size), name: rest.join('\t') }
    })
}

/**
 * 检查 VSIX 条目：必需项齐全、无禁止文件、白名单外无多余条目、体积在
 * 阈值内。
 * @param {{size:number,name:string}[]} entries VSIX 内全部条目
 * @returns {{ok:boolean,errors:string[],warnings:string[],totalBytes:number}}
 */
export function inspectVsixEntries(entries) {
  const errors = []
  const warnings = []
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
  const lowerNames = entries.map((e) => e.name.toLowerCase())

  for (const root of REQUIRED_ROOT) {
    if (!lowerNames.includes(root)) errors.push(`缺少结构文件 ${root}`)
  }
  for (const rel of REQUIRED_RUNTIME) {
    if (rel === 'license') {
      const hit = lowerNames.some((n) => /^extension\/license(\.txt)?$/.test(n))
      if (!hit) errors.push('缺少 LICENSE（打包后应为 extension/LICENSE*）')
    } else if (!lowerNames.includes(`extension/${rel.toLowerCase()}`)) {
      errors.push(`缺少运行时资产 extension/${rel}`)
    }
  }

  for (const e of entries) {
    const lower = e.name.toLowerCase()
    // 顶层白名单：拦「多」出来的根级条目
    if (/^extension\//.test(lower)) {
      const rel = lower.slice('extension/'.length)
      const top = rel.split('/')[0]
      if (top && !ALLOWED_TOP.has(top)) {
        errors.push(`未知顶层条目 ${e.name}（新根级资产须登记白名单；本地工具/日志应进 .vscodeignore 排除）`)
        continue
      }
      // dist/ 白名单：拦构建实验残留
      if (rel.startsWith('dist/') && !ALLOWED_DIST.has(rel)) {
        errors.push(`dist/ 未登记产物 ${e.name}（新产物须登记 REQUIRED_RUNTIME）`)
      }
    }
    for (const [pattern, label] of FORBIDDEN_PATTERNS) {
      if (pattern.test(lower)) errors.push(`禁止文件 ${e.name}（${label}）`)
    }
  }

  if (totalBytes > SIZE_LIMITS.totalMaxBytes) {
    errors.push(`解压总体积 ${(totalBytes / 1048576).toFixed(2)} MB 超过上限 ${SIZE_LIMITS.totalMaxBytes / 1048576} MB`)
  } else if (totalBytes > SIZE_LIMITS.totalWarnBytes) {
    warnings.push(`解压总体积 ${(totalBytes / 1048576).toFixed(2)} MB 超过警告线 ${SIZE_LIMITS.totalWarnBytes / 1048576} MB`)
  }

  for (const e of entries) {
    if (e.size > SIZE_LIMITS.fileMaxBytes) {
      errors.push(`单文件 ${e.name} 为 ${(e.size / 1048576).toFixed(2)} MB，超过上限`)
    } else if (e.size > SIZE_LIMITS.fileWarnBytes) {
      warnings.push(`单文件 ${e.name} 为 ${(e.size / 1024).toFixed(0)} KB，超过警告线`)
    }
  }

  return { ok: errors.length === 0, errors, warnings, totalBytes }
}

/**
 * 解包冒烟的 manifest 校验：VSIX 内 extension/package.json 合法，且关键
 * 声明与仓库清单一致——version（打包时版本漂移）、main 入口、
 * extensionDependencies（宿主依赖）、vsidianAddon（附加组件身份声明，
 * 宿主发现机制的入口）。
 */
export function inspectVsixManifest(manifestText, repoPkg) {
  const errors = []
  let manifest = null
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    return { ok: false, errors: ['VSIX 内 extension/package.json 非合法 JSON'], warnings: [], totalBytes: 0 }
  }
  if (manifest.name !== repoPkg.name) errors.push(`manifest name 为 ${manifest.name}，与仓库 ${repoPkg.name} 不一致`)
  if (manifest.publisher !== repoPkg.publisher) errors.push(`manifest publisher 为 ${manifest.publisher}，与仓库 ${repoPkg.publisher} 不一致`)
  if (manifest.version !== repoPkg.version) errors.push(`manifest version 为 ${manifest.version}，与仓库 package.json 的 ${repoPkg.version} 不一致（版本漂移）`)
  if (manifest.main !== repoPkg.main) errors.push(`manifest main 为 ${manifest.main}，与仓库 ${repoPkg.main} 不一致`)
  const deps = JSON.stringify(manifest.extensionDependencies ?? [])
  if (deps !== JSON.stringify(repoPkg.extensionDependencies)) {
    errors.push(`manifest extensionDependencies 为 ${deps}，与仓库声明 ${JSON.stringify(repoPkg.extensionDependencies)} 不一致（宿主依赖声明）`)
  }
  if (JSON.stringify(manifest.vsidianAddon ?? null) !== JSON.stringify(repoPkg.vsidianAddon)) {
    errors.push('manifest vsidianAddon 身份声明缺失或与仓库不一致（宿主发现机制的入口）')
  }
  return { ok: errors.length === 0, errors, warnings: [], totalBytes: 0 }
}

/** 校验语义化版本参数（x.y.z，无前缀无预发布段），合法原样返回。 */
export function validateVersionArg(arg) {
  if (!/^\d+\.\d+\.\d+$/.test(arg)) {
    throw new Error(`版本号 ${JSON.stringify(arg)} 非法（应为 x.y.z 语义化版本，无 v 前缀、无预发布段）`)
  }
  return arg
}

/**
 * CHANGELOG Unreleased 段转正：顶部第一个 `## Unreleased` 段标题替换为
 * `## <version> - <date>`，并在其前重建空的 `## Unreleased - 开发中` 段。
 * Unreleased 段缺失或为空（无条目可转正）、目标版本号已存在时抛错。
 */
export function promoteUnreleased(content, version, date) {
  const lines = content.split(/\r?\n/)
  const unreleasedIdx = lines.findIndex((l) => /^## Unreleased\b/.test(l))
  if (unreleasedIdx < 0) throw new Error('CHANGELOG.md 中未找到 `## Unreleased` 段（维护流程：开发中条目一律记入该段）')
  if (lines.some((l) => new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`).test(l))) {
    throw new Error(`CHANGELOG.md 已存在 \`## ${version}\` 版本段（防重复发版）`)
  }
  const nextSection = lines.findIndex((l, i) => i > unreleasedIdx && /^## /.test(l))
  const body = lines.slice(unreleasedIdx + 1, nextSection < 0 ? lines.length : nextSection).join('')
  if (!body.trim()) throw new Error('Unreleased 段为空，无条目可转正（先补充该版变更条目）')

  lines[unreleasedIdx] = `## ${version} - ${date}`
  const out = [...lines.slice(0, unreleasedIdx), '## Unreleased - 开发中', '', ...lines.slice(unreleasedIdx)]
  return out.join('\n')
}

/** 列出 zip 内容；优先 unzip（CI Linux / Git Bash），Windows 回退 PowerShell。 */
function listZipEntries(vsixPath) {
  const unzip = spawnSync('unzip', ['-l', vsixPath], { encoding: 'utf8' })
  if (unzip.status === 0 && unzip.stdout) return parseUnzipListing(unzip.stdout)
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      "$z=[System.IO.Compression.ZipFile]::OpenRead($args[0])",
      'foreach($e in $z.Entries){ Write-Output ($e.Length.ToString() + "`t" + $e.FullName) }',
      '$z.Dispose()',
    ].join('; ')
    const out = spawnSync('powershell', ['-NoProfile', '-Command', ps, vsixPath], { encoding: 'utf8' })
    if (out.status !== 0) throw new Error(`无法读取 VSIX 内容：${out.stderr || 'unzip 与 PowerShell 均失败'}`)
    return parsePszListing(out.stdout)
  }
  throw new Error(`无法读取 VSIX 内容：${unzip.stderr || 'unzip 不可用'}`)
}

/** 读取 zip 内单文件文本（manifest 冒烟用）；通道回退逻辑同 listZipEntries。 */
function readZipEntry(vsixPath, entryName) {
  const unzip = spawnSync('unzip', ['-p', vsixPath, entryName], { encoding: 'utf8' })
  if (unzip.status === 0) return unzip.stdout
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      "$z=[System.IO.Compression.ZipFile]::OpenRead($args[0])",
      `foreach($e in $z.Entries){ if($e.FullName -eq '${entryName}'){ $r=New-Object System.IO.StreamReader($e.Open()); Write-Output $r.ReadToEnd(); $r.Dispose() } }`,
      '$z.Dispose()',
    ].join('; ')
    const out = spawnSync('powershell', ['-NoProfile', '-Command', ps, vsixPath], { encoding: 'utf8' })
    if (out.status !== 0 || !out.stdout) throw new Error(`无法读取 VSIX 内 ${entryName}：${out.stderr || 'unzip 与 PowerShell 均失败'}`)
    return out.stdout
  }
  throw new Error(`无法读取 VSIX 内 ${entryName}：${unzip.stderr || 'unzip 不可用'}`)
}

function git(args) {
  const out = spawnSync('git', args, { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${out.stderr}`)
  return out.stdout.trim()
}

function readRepoPkg(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  return {
    name: pkg.name,
    publisher: pkg.publisher,
    version: pkg.version,
    main: pkg.main,
    extensionDependencies: pkg.extensionDependencies,
    vsidianAddon: pkg.vsidianAddon,
  }
}

/** 打包 + 内容/体积检查 + 解包冒烟。日常入口（npm run package），不检查工作树。 */
function runPackage(root) {
  const pkg = readRepoPkg(root)

  console.log('打包 VSIX（vsce --no-dependencies，含 vscode:prepublish 三产物构建）…')
  // Windows 上 npx 是 .cmd，必须经 shell；参数拼接为整条命令避免 DEP0190（args+shell 组合）
  const vsce = spawnSync('npx @vscode/vsce package --no-dependencies', { cwd: root, encoding: 'utf8', shell: true })
  if (vsce.status !== 0) {
    console.error(vsce.stdout)
    console.error(vsce.stderr)
    process.exitCode = 1
    return
  }

  const vsixName = `${pkg.name}-${pkg.version}.vsix`
  const vsixPath = path.join(root, vsixName)
  if (!existsSync(vsixPath)) {
    console.error(`打包完成但未找到 ${vsixPath}`)
    process.exitCode = 1
    return
  }

  const entries = listZipEntries(vsixPath)
  const result = inspectVsixEntries(entries)
  console.log(`VSIX 共 ${entries.length} 个文件，解压 ${(result.totalBytes / 1024).toFixed(0)} KB（${vsixName}）`)
  for (const w of result.warnings) console.warn(`警告：${w}`)
  if (!result.ok) {
    for (const e of result.errors) console.error(`检查失败：${e}`)
    process.exitCode = 1
    return
  }
  console.log('包内容检查通过（必需清单 / 禁止模式 / 体积阈值）')

  // 安装态冒烟（票面口径）：VSIX 解包结构校验——manifest 合法性与声明核对。
  // 真实安装走宿主联调归工单 #21 人工清单，本脚本不模拟安装。
  const manifestText = readZipEntry(vsixPath, 'extension/package.json')
  const manifestResult = inspectVsixManifest(manifestText, pkg)
  if (!manifestResult.ok) {
    for (const e of manifestResult.errors) console.error(`冒烟失败：${e}`)
    process.exitCode = 1
    return
  }
  console.log('解包冒烟通过（manifest 合法、version/main/extensionDependencies/vsidianAddon 声明一致）')

  console.log('发行护栏提醒：本脚本只产本地 VSIX，无上传路径；对外发布需 vsidian API 落账发行 + 用户明确授权（缺一不发布），真实安装验证见工单 #21')
  return vsixPath
}

/** 发版准备：版本号 bump + CHANGELOG Unreleased 转正 + 打包。 */
function runRelease(root, versionArg) {
  const version = validateVersionArg(versionArg)
  const pkgPath = path.join(root, 'package.json')
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const pkgText = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(pkgText)
  if (pkg.version === version) {
    console.error(`package.json 已是 ${version}，无需发版`)
    process.exitCode = 1
    return
  }

  // 改文件前工作树必须干净：发版提交只含 package.json + CHANGELOG.md
  if (git(['status', '--porcelain']) !== '') {
    console.error('工作树不干净：发版前先提交或 stash（发版提交应只含 package.json 与 CHANGELOG.md）')
    process.exitCode = 1
    return
  }

  const changelog = readFileSync(changelogPath, 'utf8')
  const date = new Date().toISOString().slice(0, 10)
  let promoted
  try {
    promoted = promoteUnreleased(changelog, version, date)
  } catch (err) {
    console.error(String(err.message))
    process.exitCode = 1
    return
  }

  // package.json 只动 version 一行（文本级替换保持既有格式与排序）
  const bumped = pkgText.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
  if (bumped === pkgText) {
    console.error('package.json version 字段替换失败')
    process.exitCode = 1
    return
  }
  writeFileSync(pkgPath, bumped, 'utf8')
  writeFileSync(changelogPath, promoted, 'utf8')
  console.log(`版本号 bump：${pkg.version} → ${version}；CHANGELOG Unreleased 段转正为 ## ${version} - ${date}`)

  const vsixPath = runPackage(root)
  if (!vsixPath || process.exitCode) {
    console.error('打包或检查失败：发版文件已写入，可 `git checkout -- package.json CHANGELOG.md` 回滚')
    return
  }

  console.log('发版准备完成。后续人工步骤：')
  console.log(`  1. 提交发版变更（package.json + CHANGELOG.md，中文提交信息）`)
  console.log(`  2. 视需要打标签 git tag v${version}`)
  console.log('  3. 对外发布 VSIX 前核对护栏：vsidian 附加组件 API 已落账发行 + 用户明确授权，二者缺一不发布')
}

function main() {
  const argv = process.argv.slice(2)

  // 发行护栏的代码化边界：显式拒绝任何上传意图（本脚本无上传路径）
  if (argv.includes('--upload') || argv.includes('--publish')) {
    console.error('本脚本不提供上传/发布路径：对外发布 VSIX 需 vsidian 附加组件 API 落账发行 + 用户明确授权（缺一不发布），发布是人工动作')
    process.exitCode = 1
    return
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const command = argv.find((a) => !a.startsWith('--')) ?? 'package'

  if (command === 'package') {
    runPackage(root)
  } else if (command === 'release') {
    const versionArg = argv.filter((a) => !a.startsWith('--'))[1]
    if (!versionArg) {
      console.error('用法：npm run release -- <x.y.z>（如 npm run release -- 0.2.0）')
      process.exitCode = 1
      return
    }
    runRelease(root, versionArg)
  } else {
    console.error(`未知子命令 ${command}。用法：node scripts/release.mjs [package | release <x.y.z>]`)
    process.exitCode = 1
  }
}

// 仅在直接执行（node scripts/release.mjs）时跑主流程；契约测试 import 纯函数不触发
if (process.argv[1] && path.resolve(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
