// Release 工作流结构契约（发布链 2026-10-20）：钉住
// .github/workflows/release.yml 的触发配置与关键步骤在场——v* 标签触发
// 发布、dispatch 补跑入口、双开关 gate 与「同一份字节」链路（marketplace
// 从 Release 下载 VSIX 而非重新打包）。模式对齐 test/ci-workflow.test.ts：
// 文本断言而非 YAML 解析（无 YAML 解析依赖），断言粒度取关键行。
//
// 主仓踩坑的回归锚点（vsidian release.yml git 历史实证，条件断言钉住）：
// - if 表达式须以 ${{ }} 显式包裹（裸 ! 被 YAML 解释为标签锚点）；
// - marketplace 的 if 须带 !cancelled() 豁免（隐式 success() && 前缀会让
//   dispatch 补跑场景整条判 false）；
// - marketplace 须受 MARKETPLACE_PUBLISH variable gate（双开关语义，
//   未配置时推 tag 只产出 GitHub Release）。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/release.yml')

describe('Release 工作流结构契约', () => {
  it('workflow 文件在场', () => {
    expect(existsSync(workflowPath), '.github/workflows/release.yml 缺失').toBe(true)
  })

  it('v* 标签触发发布，workflow_dispatch 供补跑', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toMatch(/push:\s*\n\s*tags:\s*\[\s*'v\*'\s*\]/)
    expect(text).toMatch(/^\s*workflow_dispatch:\s*$/m)
  })

  it('release job 仅 tag 推送执行，检出带完整历史与标签（HEAD 命中校验依赖）', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toMatch(/if:\s*github\.event_name == 'push'/)
    expect(text).toMatch(/fetch-depth:\s*0/)
    expect(text).toMatch(/fetch-tags:\s*true/)
  })

  it('发布链经 npm run release:publish（脚本 publish 子命令，检查失败即中止）', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toContain('npm run release:publish')
    expect(text).toContain('GH_TOKEN: ${{ github.token }}')
  })

  it('marketplace：双开关 gate + !cancelled() 豁免 + ${{ }} 包裹（三处主仓踩坑回归锚点）', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toMatch(
      /if:\s*\$\{\{\s*!cancelled\(\)\s*&&\s*vars\.MARKETPLACE_PUBLISH == 'true'/,
    )
  })

  it('marketplace 从 Release 下载同一 VSIX（同一份字节，不重新打包）', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toContain('gh release download')
    expect(text).toContain("-R \"$GITHUB_REPOSITORY\"")
    expect(text).toContain('vsce publish --no-dependencies --packagePath ./*.vsix')
    expect(text).toContain('VSCE_PAT: ${{ secrets.VSCE_PAT }}')
  })
})
