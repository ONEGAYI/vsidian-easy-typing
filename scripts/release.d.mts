// scripts/release.mjs 的编译期类型声明（test/release.test.ts 消费）。
// 对齐 vsidian 主仓 scripts/genNls.d.mts 先例：工具脚本不进 tsconfig
// include，声明只描述契约测试用到的纯函数面。

export interface SizeLimits {
  /** 解压总量警告线（字节），超出仅警告 */
  totalWarnBytes: number
  /** 解压总量失败线（字节），超出非零退出 */
  totalMaxBytes: number
  /** 单文件警告线（字节） */
  fileWarnBytes: number
  /** 单文件失败线（字节） */
  fileMaxBytes: number
}

export interface ZipEntry {
  size: number
  name: string
}

export interface InspectResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  totalBytes: number
}

export interface RepoPkgShape {
  name: string
  publisher: string
  version: string
  main: string
  extensionDependencies: string[]
  vsidianAddon: {
    manifestVersion: number
    api: string
    experimental: Record<string, string>
  }
}

export const SIZE_LIMITS: SizeLimits

export function parseUnzipListing(text: string): ZipEntry[]
export function parsePszListing(text: string): ZipEntry[]
export function inspectVsixEntries(entries: ZipEntry[]): InspectResult
export function inspectVsixManifest(manifestText: string, repoPkg: RepoPkgShape): InspectResult
export function promoteUnreleased(content: string, version: string, date: string): string
export function validateVersionArg(arg: string): string
