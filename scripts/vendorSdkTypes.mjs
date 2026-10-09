#!/usr/bin/env node
// vendorSdkTypes.mjs — Vsidian SDK 类型快照生成/校验（工单 #22）。
//
// 用法：
//   npm run vendor:sdk                          # 生成/刷新 types/vendor/
//   npm run vendor:check                        # 校验已提交快照无漂移（CI 用）
//   node scripts/vendorSdkTypes.mjs --source <vsidian仓路径> --commit <rev> [--check]
//
// 快照语义（ADR-0001）：
// - 入口文件（VENDOR_ENTRIES）保留完整导出类型面（interface/type/enum 与
//   被类型引用的同文件常量）；经 type 导入发现的 vsidian 内部模块只保留
//   「被引用名字」的类型可达闭包——避免把平台内部实现整面拖进快照。
// - 值级导出（校验函数、运行时数据表）一律剥离；宿主实现以类型为准。
// - 产物按 vsidian 源码目录结构镜像到 types/vendor/（去掉 src/ 前缀），
//   文件相对导入路径原样有效，无需改写。
// - 每个文件头标注来源 commit；升级快照 = --commit <新rev> 重跑 + 评审 diff。
//
// 源仓定位：--source > 环境变量 VSIDIAN_SOURCE_REPO > ../vscode-obsidian-like-editor
// （相对本仓库根）。读取经 `git show <commit>:<path>`——按提交快照取文，
// 不受源仓工作树状态影响。
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 当前快照锚定的 vsidian 提交（re-vendor 升级时随变更修改此常量并重跑） */
const DEFAULT_COMMIT = '7651616e466d4950ee40880079634e3a78424162'

/**
 * vendor 入口：公开 API 面文件，保留完整导出类型面。
 * 页面 SDK（addonPage 及六组能力 facet）+ 宿主注册表（addonRegistry 的
 * setup/enable 上下文与 AddonDefinition）+ 身份声明（addonIdentity）。
 */
const VENDOR_ENTRIES = [
  'src/shared/addonPage.ts',
  'src/shared/addonEditApi.ts',
  'src/shared/addonBehaviors.ts',
  'src/shared/addonSettings.ts',
  'src/shared/addonRenderers.ts',
  'src/shared/addonCommands.ts',
  'src/shared/addonUi.ts',
  'src/shared/addonStorage.ts',
  'src/shared/addonFoldApi.ts',
  'src/shared/addonIdentity.ts',
  'src/host/addons/addonRegistry.ts',
]

const HEADER_LINES = (commit, srcPath) => [
  `// vendored from ONEGAYI/vsidian@${commit} — ${srcPath}`,
  '// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被',
  '// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；',
  '// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。',
]

// ---------------------------------------------------------------- CLI 参数

function parseArgs(argv) {
  const out = { check: false, source: null, commit: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') out.check = true
    else if (arg === '--source') out.source = argv[++i]
    else if (arg.startsWith('--source=')) out.source = arg.slice('--source='.length)
    else if (arg === '--commit') out.commit = argv[++i]
    else if (arg.startsWith('--commit=')) out.commit = arg.slice('--commit='.length)
    else {
      console.error(`[vendor] 未知参数 ${arg}`)
      process.exit(2)
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const sourceRepo = path.resolve(
  args.source ?? process.env.VSIDIAN_SOURCE_REPO ?? path.join(repoRoot, '..', '..', 'vscode-obsidian-like-editor'),
)
if (!statSync(path.join(sourceRepo, '.git'), { throwIfNoEntry: false })) {
  console.error(`[vendor] 源仓不是 git 仓库：${sourceRepo}（用 --source 或 VSIDIAN_SOURCE_REPO 指定 vsidian 本体仓）`)
  process.exit(2)
}
const commitArg = args.commit ?? DEFAULT_COMMIT
const commit = execFileSync('git', ['-C', sourceRepo, 'rev-parse', `${commitArg}^{commit}`], {
  encoding: 'utf8',
}).trim()

function readSourceFile(srcPath) {
  return execFileSync('git', ['-C', sourceRepo, 'show', `${commit}:${srcPath}`], { encoding: 'utf8' })
}

// ---------------------------------------------------------------- 变换核心

const IDENT_RE = /\b[A-Za-z_$][\w$]*\b/g

/** 词法级标识符收集（注释与字符串字面量天然排除——文档注释里提到的
 *  函数名不算引用，避免误保留/误报错） */
function collectIdentifiers(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const ids = new Set()
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.Identifier) ids.add(scanner.getTokenText())
  }
  return ids
}

/** 词法级 `typeof <标识符>` 引用收集（跳过中间空白/注释 token） */
function collectTypeofNames(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const names = []
  let pendingTypeof = false
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.TypeOfKeyword) {
      pendingTypeof = true
      continue
    }
    if (kind === ts.SyntaxKind.Identifier && pendingTypeof) {
      names.push(scanner.getTokenText())
      pendingTypeof = false
      continue
    }
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia && kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.NewLineTrivia) {
      pendingTypeof = false
    }
  }
  return names
}

/** 单文件变换：返回 { text, requests }。
 *  roots = null 表示完整导出类型面；否则只保留 roots 类型可达闭包。
 *  requests = Map<模块源路径, Set<需要的导出名>>（type 导入的目标）。 */
function transformFile(srcPath, source, roots) {
  const sf = ts.createSourceFile(srcPath, source, ts.ScriptTarget.Latest, true)
  const imports = [] // { stmt, module, specifiers: [{exported, local, typeOnly}] }
  const typeReexports = [] // export type { ... } from '...'
  const decls = [] // { stmt, names: string[], kind: 'type'|'const'|'func', exported: boolean }

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
      const specifiers = []
      for (const el of stmt.importClause.namedBindings.elements) {
        specifiers.push({
          exported: (el.propertyName ?? el.name).text,
          local: el.name.text,
          typeOnly: !!el.isTypeOnly,
        })
      }
      imports.push({ stmt, module: stmt.moduleSpecifier.text, specifiers })
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.isTypeOnly
    ) {
      typeReexports.push({ stmt, module: stmt.moduleSpecifier.text })
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      decls.push({ stmt, names: [stmt.name.text], kind: 'type', exported: stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false })
    } else if (ts.isVariableStatement(stmt)) {
      const names = []
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text)
      }
      if (names.length > 0) {
        decls.push({ stmt, names, kind: 'const', exported: stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false })
      }
    } else if ((ts.isFunctionDeclaration(stmt) && stmt.name) || ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text
      if (name) decls.push({ stmt, names: [name], kind: 'func', exported: stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false })
    }
    // 其余语句（表达式、export * 等）一律丢弃
  }

  // 种子：roots 模式取名字命中的导出类型声明；完整模式取全部导出类型声明
  const kept = new Set()
  const seed = (d) => d.kind === 'type' && d.exported && (roots === null || roots.has(d.names[0]))
  for (const d of decls) if (seed(d)) kept.add(d)

  // 文件内可达闭包：被保留文本引用的声明继续保留。类型/枚举按标识符引用；
  // 常量（含 const 箭头函数）只在被 `typeof <名字>` 引用时保留——接口属性
  // 名与顶层声明同名时不算引用（实测坑：MenuContextSnapshot.hasSelection
  // 属性名误保了同名 const 谓词函数）。
  for (let changed = true; changed; ) {
    changed = false
    const joined = [...kept].map((d) => d.stmt.getFullText(sf)).join('\n')
    const ids = collectIdentifiers(joined)
    const typeofNames = new Set(collectTypeofNames(joined))
    for (const d of decls) {
      if (kept.has(d)) continue
      const referenced =
        d.kind === 'const'
          ? d.names.some((n) => typeofNames.has(n))
          : d.names.some((n) => ids.has(n))
      if (!referenced) continue
      if (d.kind === 'func') {
        throw new Error(
          `${srcPath}: 保留的类型引用了函数/类「${d.names[0]}」——类型快照不携带实现，` +
            '请把该引用改写为结构类型或调整 VENDOR_ENTRIES 根名字',
        )
      }
      kept.add(d)
      changed = true
    }
  }

  const keptText = [...kept].map((d) => d.stmt.getFullText(sf)).join('\n')
  const keptIds = collectIdentifiers(keptText)

  // 跨文件值引用 typeof <导入名>：type-only 导入不能作值用（TS1361）——当前面无此形态，出现即报错
  for (const name of collectTypeofNames(keptText)) {
    const imp = imports.find((i) => i.specifiers.some((s) => s.local === name))
    if (imp) {
      throw new Error(`${srcPath}: 保留的类型经 typeof 引用了导入值「${name}」（来自 ${imp.module}）——跨文件值引用不受支持，需人工改写`)
    }
  }

  // 导入裁剪：只保留被引用的具名符号，全部输出为 import type
  const requests = new Map()
  const importLines = []
  for (const imp of imports) {
    const referenced = imp.specifiers.filter((s) => keptIds.has(s.local))
    if (referenced.length === 0) continue
    if (!imp.module.startsWith('.')) {
      importLines.push(`import type { ${referenced.map((s) => (s.exported === s.local ? s.local : `${s.exported} as ${s.local}`)).join(', ')} } from '${imp.module}'`)
      continue
    }
    const resolved = resolveModule(srcPath, imp.module)
    if (!resolved) {
      throw new Error(`${srcPath}: 无法解析相对导入 ${imp.module}（.ts / index.ts 均不存在）`)
    }
    const names = referenced.map((s) => s.exported)
    const bucket = requests.get(resolved) ?? new Set()
    for (const n of names) bucket.add(n)
    requests.set(resolved, bucket)
    importLines.push(`import type { ${referenced.map((s) => (s.exported === s.local ? s.local : `${s.exported} as ${s.local}`)).join(', ')} } from '${imp.module}'`)
  }

  // type 再导出保留原文（具名 type re-export 不裁剪——开销为零；目标模块进请求表）
  const reexportLines = []
  for (const re of typeReexports) {
    reexportLines.push(re.stmt.getFullText(sf).trim())
    const resolved = resolveModule(srcPath, re.module)
    if (resolved) {
      const names = re.stmt.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
      const bucket = requests.get(resolved) ?? new Set()
      for (const n of names) bucket.add(n)
      requests.set(resolved, bucket)
    }
  }

  const body = [importLines.join('\n'), reexportLines.join('\n'), keptText]
    .filter((s) => s.trim().length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .trimEnd()

  return { text: `${HEADER_LINES(commit, srcPath).join('\n')}\n\n${body}\n`, requests }
}

/** 相对导入 → vsidian 源码路径（相对源仓根）；解析失败返回 null */
function resolveModule(fromPath, module) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), module))
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    try {
      execFileSync('git', ['-C', sourceRepo, 'cat-file', '-e', `${commit}:${candidate}`], { stdio: 'ignore' })
      return candidate
    } catch {
      // 尝试下一个
    }
  }
  return null
}

// ---------------------------------------------------------------- 全局闭包

/** 迭代到不动点：入口（完整面）+ 发现模块（按请求名字）逐轮处理 */
function generateAll() {
  const full = new Map() // srcPath -> text（完整面入口）
  const rooted = new Map() // srcPath -> { roots: Set, text }
  const pending = new Map() // srcPath -> Set<names> | null（null = 完整面）
  const entrySet = new Set(VENDOR_ENTRIES)
  for (const entry of VENDOR_ENTRIES) pending.set(entry, null) // null = 完整面

  for (let round = 1; ; round++) {
    const queue = [...pending.entries()]
    pending.clear()
    if (queue.length === 0) break
    for (const [srcPath, names] of queue) {
      const source = readSourceFile(srcPath)
      const result = transformFile(srcPath, source, names)
      if (names === null) {
        const prev = full.get(srcPath)
        if (prev !== undefined && prev !== result.text) throw new Error(`${srcPath}: 完整面产物在两轮间不一致（不应发生）`)
        full.set(srcPath, result.text)
      } else {
        const prev = rooted.get(srcPath)
        if (prev && isSubset(names, prev.roots) && prev.text === result.text) continue
        rooted.set(srcPath, { roots: new Set(names), text: result.text })
      }
      for (const [dep, depNames] of result.requests) {
        // 入口文件（含尚未处理的）与已定完整面的模块：完整面覆盖一切请求
        if (full.has(dep) || entrySet.has(dep)) continue
        const existing = rooted.get(dep)?.roots ?? new Set()
        if (isSubset(depNames, existing)) continue
        const merged = new Set([...existing, ...depNames])
        const queued = pending.get(dep) ?? new Set()
        for (const n of merged) queued.add(n)
        pending.set(dep, queued)
      }
    }
    if (round > 12) throw new Error('闭包迭代超过 12 轮未收敛（不应发生）')
  }
  return { full, rooted }
}

function isSubset(small, big) {
  for (const n of small) if (!big.has(n)) return false
  return true
}

// ---------------------------------------------------------------- 输出/校验

const outDir = path.join(repoRoot, 'types', 'vendor')
const toOutPath = (srcPath) => path.join(outDir, srcPath.replace(/^src\//, ''))

function collectExistingFiles(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collectExistingFiles(full, base))
    else if (name.endsWith('.ts')) out.push(path.relative(base, full).replaceAll('\\', '/'))
  }
  return out
}

const { full, rooted } = generateAll()
const generated = new Map()
for (const [p, text] of full) generated.set(p.replace(/^src\//, ''), text)
for (const [p, info] of rooted) generated.set(p.replace(/^src\//, ''), info.text)

if (args.check) {
  const existing = collectExistingFiles(outDir)
  const problems = []
  for (const [rel, text] of generated) {
    const diskPath = path.join(outDir, rel)
    const disk = statSync(diskPath, { throwIfNoEntry: false })
    if (!disk) problems.push(`缺失：types/vendor/${rel}`)
    else if (readFileSync(diskPath, 'utf8') !== text) problems.push(`漂移：types/vendor/${rel}（源已变或生成器已改，重跑 npm run vendor:sdk）`)
  }
  for (const rel of existing) {
    if (!generated.has(rel)) problems.push(`多余：types/vendor/${rel}（生成器不再产出，请删除）`)
  }
  if (problems.length > 0) {
    console.error(`[vendor:check] 快照与生成器不一致（锚定 ${commit}）：\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`[vendor:check] 快照一致：${generated.size} 个文件，锚定 ONEGAYI/vsidian@${commit.slice(0, 8)}`)
} else {
  rmSync(outDir, { recursive: true, force: true })
  let created = 0
  let updated = 0
  for (const [rel, text] of [...generated.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = path.join(outDir, rel)
    mkdirSync(path.dirname(outPath), { recursive: true })
    const existed = statSync(outPath, { throwIfNoEntry: false })
    writeFileSync(outPath, text)
    existed ? updated++ : created++
  }
  const rootedList = [...rooted.keys()].map((p) => p.replace(/^src\//, ''))
  console.log(`[vendor] 生成 ${created} 个 / 覆盖 ${updated} 个文件到 types/vendor/（锚定 ONEGAYI/vsidian@${commit.slice(0, 8)}）`)
  console.log(`[vendor] 完整面 ${full.size} 个；最小闭包 ${rooted.size} 个：${rootedList.join('、') || '无'}`)
}
