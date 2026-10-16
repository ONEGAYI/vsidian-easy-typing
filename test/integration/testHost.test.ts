// 宿主启动器契约测试：钉住移植自 vsidian 主仓（ONEGAYI/vsidian@0e5d5bc7）
// 的静默宿主启动标准——真宿主测试一律经 testHost.mjs 启动器起宿主，
// Windows 默认经独立窗口站+隐藏桌面静默启动（hiddenDesktop.ps1：不抢用户
// 焦点、隔离用户剪贴板、Job 对象兜杀整棵进程树），
// VSIDIAN_TEST_HOST_MODE=foreground 仅作无交互桌面环境（SSH/服务会话）
// 的显式逃生门；宿主输出全量落盘报告，非零退出的放行判定不得只数 FAIL
// 行——「零 FAIL 但计划用例未全部取得终态」的宿主截断必须判败并点名缺失
// 用例（上游 #211 收尾噪声误放行 / #254 截断判定的契约化，issue 号指
// ONEGAYI/vsidian）。深度进程树保障（SIGINT 清理 / 父启动器退出兜杀 /
// 包装层故障清理 / 剪贴板隔离探针）与超时最近输出快照契约（对应机制
// TAIL_LINES 环形缓冲已随 testHost.mjs 移植，测试留上游）均由上游
// testHost.test.mjs 覆盖，本仓不重复移植；机制回流以上游该文件为准。
// 已知边界：hiddenDesktop.ps1 无 BOM，非 UTF-8 代码页（ACP≠65001）的
// Windows 上中文诊断串乱码并致本文件静默探针断言失败——上游同源同缺
// 陷，属上游回流项，不在本仓单独修（破坏字节级同源契约）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildTestHostArgs,
  cleanupTestDirs,
  createPortableShardHost,
  evaluateHostReport,
  resolveTestHostMode,
  runTestHost,
  writeTestWorkspaceFile,
} from './testHost.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

// 与启动器的模式开关同一语义：非 Windows 平台（CI ubuntu）或用户显式选择
// 前台模式时跳过独立桌面专项。
const skipDesktop = process.platform !== 'win32' || process.env.VSIDIAN_TEST_HOST_MODE === 'foreground'

describe('宿主启动器契约（静默标准，移植 vsidian@0e5d5bc7）', () => {
  it('机制两件套在场：启动策略与隐藏桌面脚本', () => {
    expect(existsSync(path.join(here, 'testHost.mjs')), 'testHost.mjs 缺失').toBe(true)
    expect(existsSync(path.join(here, 'hiddenDesktop.ps1')), 'hiddenDesktop.ps1 缺失').toBe(true)
  })

  it('开发态与安装态共用同一参数集并隔离 profile', () => {
    const base = {
      workspaceDir: 'D:\\fixture',
      testsPath: 'D:\\suite\\index.js',
      extensionsDir: 'D:\\cache\\extensions',
      userDataDir: 'D:\\cache\\user-data',
    }
    const dev = buildTestHostArgs({ ...base, extensionPath: 'D:\\repo' })
    const installed = buildTestHostArgs({ ...base, extensionPath: 'D:\\installed' })
    expect(installed).toEqual(
      dev.map((arg) => (arg === '--extensionDevelopmentPath=D:\\repo' ? '--extensionDevelopmentPath=D:\\installed' : arg)),
    )
    expect(dev).toContain('--extensionTestsPath=D:\\suite\\index.js')
    expect(dev).toContain('--extensions-dir=D:\\cache\\extensions')
    expect(dev).toContain('--user-data-dir=D:\\cache\\user-data')
    expect(dev.at(-1)).toBe('D:\\fixture')
    expect(buildTestHostArgs({ ...base, extensionPath: 'D:\\repo', disableExtensions: true })).toContain('--disable-extensions')
  })

  it('并行分片共用程序但各有便携数据目录，不污染父进程环境', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'et-portable-shards-'))
    const inherited = { VSCODE_PORTABLE: 'inherited', MARKER: 'kept' }
    try {
      const first = createPortableShardHost(dir, 1, inherited)
      const second = createPortableShardHost(dir, 2, inherited)
      expect(first.portableDir).not.toBe(second.portableDir)
      for (const shard of [first, second]) {
        expect(existsSync(shard.portableDir), 'VSCode 启动前必须预建便携目录').toBe(true)
        expect(shard.userDataDir).toBe(path.join(shard.portableDir, 'user-data'))
        expect(shard.extensionsDir).toBe(path.join(shard.portableDir, 'extensions'))
        expect(shard.env.VSCODE_PORTABLE).toBe(shard.portableDir)
        expect(shard.env.MARKER).toBe('kept')
      }
      expect(inherited.VSCODE_PORTABLE).toBe('inherited')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writeTestWorkspaceFile 生成单 folder 的 .code-workspace（multi-root 形态起步，根增删不触发 reload）', () => {
    const writes: Array<{ p: string; content: string }> = []
    const dir = path.join(tmpdir(), 'et-wsfile', 'ws')
    const file = writeTestWorkspaceFile(dir, (p, content) => writes.push({ p, content }))
    // 文件是工作区目录的兄弟文件（不进任何根的扫描范围），名字随目录
    expect(file.endsWith(`${path.sep}ws.code-workspace`), `workspace 文件路径形态：${file}`).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0].p).toBe(file)
    // folders 恰一个（= fixture 工作区根）、路径正斜杠（Windows 反斜杠的 JSON 转义形态免歧义）
    const parsed = JSON.parse(writes[0].content) as { folders: Array<{ path: string }> }
    expect(parsed.folders).toEqual([{ path: dir.split(path.sep).join('/') }])
  })

  it('静默模式判定：Windows 默认独立桌面，foreground 仅显式逃生门，非法值拒绝', () => {
    expect(resolveTestHostMode('win32', {})).toBe('desktop')
    expect(resolveTestHostMode('win32', { VSIDIAN_TEST_HOST_MODE: 'foreground' })).toBe('foreground')
    expect(resolveTestHostMode('linux', {})).toBe('foreground')
    expect(() => resolveTestHostMode('win32', { VSIDIAN_TEST_HOST_MODE: 'wrong' })).toThrow(/VSIDIAN_TEST_HOST_MODE/)
  })

  // #254 启动器契约：宿主退出码非零时的报告判定不得只数 FAIL 行——
  // 「零 FAIL 但计划用例未全部取得终态」是宿主中途截断的真实形态，
  // 判败必须列出缺失用例的身份（有 START 无终态的名称 + 未开始数量）。
  const caseLog = (kind: string, name: string) => `[集成测试][${kind}] ${name}`

  function reportLines({ plan, pass = [], fail = [], startedWithoutEnd = [], noiseExit = 1 }: {
    plan?: { executed: number; total: number; detail?: string }
    pass?: string[]
    fail?: string[]
    startedWithoutEnd?: string[]
    noiseExit?: number
  }): string[] {
    const lines = ['[testHost] 运行报告 2026-10-01T00:00:00.000Z']
    if (plan) lines.push(`[集成测试] 执行 ${plan.executed}/${plan.total} 项${plan.detail ?? ''}`)
    for (const name of pass) {
      lines.push(caseLog('START', name), caseLog('PASS', name), `[集成测试][TIME] 12ms ${name}`)
    }
    for (const name of fail) {
      lines.push(caseLog('START', name), caseLog('FAIL', name), `[集成测试][TIME] 12ms ${name}`)
    }
    for (const name of startedWithoutEnd) lines.push(caseLog('START', name))
    lines.push(`[testHost] 宿主退出码 ${noiseExit}`)
    return lines
  }

  it('报告判定：零 FAIL 但零终态（首用例即截断）判败并点名缺失用例', () => {
    const verdict = evaluateHostReport(reportLines({
      plan: { executed: 1, total: 234 },
      startedWithoutEnd: ['索引维护：工作区根增删与嵌套根归属（#198）'],
    }), 1)
    expect(verdict.ok).toBe(false)
    expect(verdict.pardon).toBe(false)
    expect(verdict.failCount).toBe(0)
    expect(verdict.planned).toBe(1)
    expect(verdict.doneCount).toBe(0)
    expect(verdict.missing).toEqual(['索引维护：工作区根增删与嵌套根归属（#198）'])
    expect(verdict.notStarted).toBe(0)
    expect(verdict.reason).toMatch(/索引维护：工作区根增删/)
  })

  it('报告判定：分片中途缺项判败并区分缺终态与未开始', () => {
    const passed = Array.from({ length: 52 }, (_, i) => `用例 ${i + 1}`)
    const verdict = evaluateHostReport(reportLines({
      plan: { executed: 59, total: 234, detail: '（分片 2/4，本片 59 项）' },
      pass: passed,
      startedWithoutEnd: ['跨根 rename（#199）', '悬停预览刷新（#224）', '图片三层失效（#201）'],
    }), 1)
    expect(verdict.ok).toBe(false)
    expect(verdict.doneCount).toBe(52)
    expect(verdict.missing).toEqual(['跨根 rename（#199）', '悬停预览刷新（#224）', '图片三层失效（#201）'])
    // START 共 55（52 完成 + 3 无终态），59 - 55 = 4 项未开始
    expect(verdict.notStarted).toBe(4)
    expect(verdict.reason).toMatch(/3 项有始无终/)
    expect(verdict.reason).toMatch(/4 项未开始/)
  })

  it('报告判定：筛选用例缺项同样判败（计划 2 项只终态 1 项）', () => {
    const verdict = evaluateHostReport(reportLines({
      plan: { executed: 2, total: 234, detail: '（筛选 "根增删,rename"）' },
      pass: ['工作区根增删（#198）'],
    }), 1)
    expect(verdict.ok).toBe(false)
    expect(verdict.missing).toEqual([])
    expect(verdict.notStarted).toBe(1)
  })

  it('报告判定：全部计划用例取得终态且零 FAIL 的非零退出按收尾噪声放行', () => {
    const passed = Array.from({ length: 59 }, (_, i) => `用例 ${i + 1}`)
    const verdict = evaluateHostReport(reportLines({
      plan: { executed: 59, total: 234, detail: '（分片 2/4，本片 59 项）' },
      pass: passed,
    }), 1)
    expect(verdict.ok).toBe(true)
    expect(verdict.pardon).toBe(true)
    expect(verdict.failCount).toBe(0)
    expect(verdict.doneCount).toBe(59)
  })

  it('报告判定：存在 FAIL 行时无论终态计数如何都判败；退出码 0 直接通过', () => {
    const failed = evaluateHostReport(reportLines({
      plan: { executed: 2, total: 2 },
      pass: ['用例 1'],
      fail: ['用例 2'],
    }), 1)
    expect(failed.ok).toBe(false)
    expect(failed.pardon).toBe(false)
    expect(failed.failCount).toBe(1)
    expect(failed.reason).toMatch(/FAIL 1/)

    const zeroExit = evaluateHostReport(reportLines({ plan: { executed: 1, total: 1 }, pass: ['用例 1'] }), 0)
    expect(zeroExit.ok).toBe(true)
    expect(zeroExit.pardon).toBe(false)
  })

  it('报告判定：缺计划行不得放行非零退出；空片计划 0 同样判败且措辞区分', () => {
    const verdict = evaluateHostReport([
      '[testHost] 运行报告 2026-10-01T00:00:00.000Z',
      '[testHost] 宿主退出码 1',
    ], 1)
    expect(verdict.ok).toBe(false)
    expect(verdict.planned).toBe(0)
    expect(verdict.reason).toMatch(/计划行/)

    // 空片（分片允许「筛选结果少于片数」）：计划行在但为 0——判败不放行，
    // 措辞不得误报「未见计划行」
    const emptyShard = evaluateHostReport(reportLines({
      plan: { executed: 0, total: 234, detail: '（分片 3/4，本片 0 项）' },
    }), 1)
    expect(emptyShard.ok).toBe(false)
    expect(emptyShard.planned).toBe(0)
    expect(emptyShard.reason).toMatch(/计划执行 0 项/)
    expect(emptyShard.reason).not.toMatch(/未见计划行/)
  })

  it('前台启动器原样传递真实进程输出和非零退出码', async () => {
    let output = ''
    const code = await runTestHost({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("launcher probe"); process.exit(17)'],
      env: process.env,
      mode: 'foreground',
      stdout: { write: (chunk) => { output += chunk.toString() } },
      stderr: { write: () => {} },
    })
    expect(code).toBe(17)
    expect(output).toBe('launcher probe')
  })

  it('宿主运行按 reportPath 落盘完整报告：逐例输出与尾部退出码', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'et-host-report-'))
    // 嵌套路径：报告目录不存在时应自动创建（真实启动器把报告放进缓存目录）
    const reportPath = path.join(dir, 'nested', 'integration.log')
    try {
      const code = await runTestHost({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("report probe out\\n"); process.stderr.write("report probe err\\n"); process.exit(9)'],
        env: process.env,
        mode: 'foreground',
        reportPath,
      })
      expect(code).toBe(9)
      const report = readFileSync(reportPath, 'utf8')
      expect(report, '报告应包含子进程 stdout').toMatch(/report probe out/)
      expect(report, '报告应包含子进程 stderr').toMatch(/report probe err/)
      expect(report, '报告尾部应有退出码摘要行').toMatch(/\[testHost\] 宿主退出码 9/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('超时终止以 124 退出并落盘报告', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'et-host-timeout-'))
    const reportPath = path.join(dir, 'integration-timeout.log')
    try {
      const code = await runTestHost({
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => process.exit(0), 8000)'],
        env: process.env,
        mode: 'foreground',
        timeoutMs: 600,
        reportPath,
      })
      expect(code).toBe(124)
      expect(readFileSync(reportPath, 'utf8')).toMatch(/\[testHost\] 宿主退出码 124/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('临时目录清理遇到占用仍继续清理其余目录，并拒绝越界目标', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'et-cleanup-'))
    const locked = path.join(parent, 'locked')
    const removable = path.join(parent, 'removable')
    mkdirSync(locked)
    mkdirSync(removable)
    const removed: string[] = []
    try {
      const failures = cleanupTestDirs([locked, removable, path.join(parent, '..', 'outside')], parent, (dir, options) => {
        removed.push(dir)
        if (dir === locked) throw new Error('locked')
        rmSync(dir, options)
      })
      expect(removed).toEqual([locked, removable])
      expect(existsSync(removable)).toBe(false)
      expect(failures).toHaveLength(2)
      expect(failures[0]).toMatch(/locked/)
      expect(failures[1]).toMatch(/outside/)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('Windows 静默独立桌面：输出透传、非零退出码与前台 PID 诊断',
    { skip: skipDesktop, timeout: 60_000 }, async () => {
      let output = ''
      let diagnostics = ''
      const code = await runTestHost({
        executable: process.execPath,
        args: ['-e', 'process.stdout.write("desktop probe"); process.exit(23)'],
        env: process.env,
        mode: 'desktop',
        stdout: { write: (chunk) => { output += chunk.toString() } },
        stderr: { write: (chunk) => { diagnostics += chunk.toString() } },
      })
      expect(code).toBe(23)
      expect(output).toMatch(/desktop probe/)
      expect(diagnostics).toMatch(/观察期间前台 PID/)
    })
})
