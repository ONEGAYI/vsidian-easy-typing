// test/integration/testHost.mjs 的编译期类型声明（test/integration/testHost.test.ts
// 消费）。对齐 scripts/release.d.mts 先例：只描述契约测试用到的契约面。
// 机制移植自 vsidian 主仓 testHost（ONEGAYI/vsidian@0e5d5bc7）。

export interface TestHostArgsOptions {
  workspaceDir: string
  testsPath: string
  extensionPath: string
  extensionsDir: string
  userDataDir: string
  disableExtensions?: boolean
  extraExtensionPaths?: string[]
}

export function buildTestHostArgs(options: TestHostArgsOptions): string[]

export function writeTestWorkspaceFile(
  workspaceDir: string,
  writeFile?: (filePath: string, content: string, encoding: string) => void,
): string

export interface PortableShardHost {
  portableDir: string
  extensionsDir: string
  userDataDir: string
  env: Record<string, string | undefined>
}

export function createPortableShardHost(baseDir: string, shard: number, env?: NodeJS.ProcessEnv): PortableShardHost

export interface RemoveDirOptions {
  recursive: boolean
  force: boolean
  maxRetries: number
  retryDelay: number
}

export function cleanupTestDirs(
  dirs: string[],
  parent: string,
  remove?: (dir: string, options: RemoveDirOptions) => void,
): string[]

export type TestHostMode = 'desktop' | 'foreground'

export function resolveTestHostMode(platform?: string, env?: NodeJS.ProcessEnv): TestHostMode

export interface HostReportVerdict {
  ok: boolean
  pardon: boolean
  failCount: number
  planned: number
  doneCount: number
  missing: string[]
  notStarted: number
  reason: string
}

export function evaluateHostReport(lines: string[], exitCode: number): HostReportVerdict

export interface RunTestHostOptions {
  executable: string
  args: string[]
  env?: NodeJS.ProcessEnv
  mode?: TestHostMode
  timeoutMs?: number
  stdout?: { write(chunk: string | Buffer): void }
  stderr?: { write(chunk: string | Buffer): void }
  reportPath?: string
}

export function runTestHost(options: RunTestHostOptions): Promise<number>
