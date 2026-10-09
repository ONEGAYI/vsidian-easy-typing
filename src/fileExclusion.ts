// 文件排除匹配（工单 #28）：上游 formatting_commands.ts isCurrentFileExclude 的
// 前缀匹配语义移植 + Vsidian docUri 映射。
//
// 【上游语义】（formatting_commands.ts:7-28）：ExcludeFiles 多行条目与
// **vault 相对路径**比对——精确相等，或条目是文档路径前缀且下一字符为
// '/'、'\'，或条目自身以 '/'、'\' 结尾（文件夹条目两种写法等价）。
// 上游消费点：cm_extensions.ts:417（输入自动格式化跳过）——手工命令
// 上游不检查排除；本仓按票面口径命令侧亦接入（见 docs/specs/
// formatting-commands.md「文件排除」节）。
//
// 【Vsidian 映射】docUri 是 vscode.Uri.toString() 全 URI（如
// `file:///d%3A/Vault/DailyNote/test.md`），#3 的 excludeFiles 条目沿上游
// 形态写 vault 相对路径（`DailyNote/`、`DailyNote/test.md`）。webview 侧
// 拿不到 workspace 根路径，vault 相对路径 = 文档绝对路径的**段边界后缀**
// （相对任一目录前缀）；多根工作区时任一根的边界都命中，同名中间目录
// 也可能命中——记录为已知近似。判定分解为：URI → 解码路径（URL 解析
// pathname + decodeURIComponent，坏编码回退原文），逐段边界枚举后缀，
// 后缀套用上游精确/带边界前缀规则。
// 解析器经 DocUriParser 注入（页面用全局 URL，node 测试注入替身），不引运行时依赖

/** URI 解析依赖（页面装配注入 VSCode 版 URL；node 测试注入替身） */
export interface DocUriParser {
  /** 解析 URI 字符串（vscode-uri 的 URI.parse 等价物） */
  parse(uri: string): { path: string } | null
}

/** 浏览器默认解析器（全局 URL；无 URL 环境返回 null → 原样比对） */
export function defaultDocUriParser(): DocUriParser {
  return {
    parse(uri: string): { path: string } | null {
      if (typeof URL !== 'function') return null
      try {
        return { path: new URL(uri).pathname }
      } catch {
        return null
      }
    },
  }
}

/** docUri → 解码路径（'/' 分隔、去首部 '/'；解析失败用原串） */
export function docUriToPath(docUri: string, parser: DocUriParser = defaultDocUriParser()): string {
  const parsed = parser.parse(docUri)
  let raw = parsed !== null ? parsed.path : docUri
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // 坏编码（孤立 % 等）：按原样比对，不抛错
  }
  const normalized = raw.replace(/\\/g, '/')
  return normalized.startsWith('/') ? normalized.slice(1) : normalized
}

/** 排除条目归一（'\'→'/'、去首部 '/'；上游 isCurrentFileExclude 同形态） */
function normalizeEntry(entry: string): string {
  const normalized = entry.replace(/\\/g, '/')
  return normalized.startsWith('/') ? normalized.slice(1) : normalized
}

/**
 * 上游前缀规则的段边界后缀版：路径在段边界上以条目为前缀（或全等）。
 * path 为已归一路径（'/' 分隔、无首部 '/'），entry 为已归一条目。
 */
function pathMatchesEntry(path: string, entry: string): boolean {
  if (entry.length === 0) return false // 空条目永不命中（上游 substring 语义同）
  let boundary = 0
  for (;;) {
    const candidate = path.slice(boundary)
    if (candidate === entry) return true
    if (
      candidate.startsWith(entry) &&
      (entry.endsWith('/') || candidate.charAt(entry.length) === '/')
    ) {
      return true
    }
    const nextSlash = path.indexOf('/', boundary)
    if (nextSlash === -1) return false
    boundary = nextSlash + 1
  }
}

/**
 * 当前文档是否被 ExcludeFiles 排除（上游 isCurrentFileExclude 的 Vsidian
 * 形态）：docUri 解码路径按段边界后缀套用上游精确/带边界前缀规则。
 * 供命令族（#28）与自动格式化族（#26 的 ctx.docUri 消费）共用。
 */
export function isDocUriExcluded(
  docUri: string,
  excludeFiles: readonly string[],
  parser: DocUriParser = defaultDocUriParser(),
): boolean {
  if (docUri.length === 0 || excludeFiles.length === 0) return false
  const path = docUriToPath(docUri, parser)
  for (const rawEntry of excludeFiles) {
    if (typeof rawEntry !== 'string') continue
    const entry = normalizeEntry(rawEntry.trim())
    if (pathMatchesEntry(path, entry)) return true
  }
  return false
}

//（解析器经 DocUriParser 注入，页面用全局 URL，node 测试注入替身）
