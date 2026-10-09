// CI 工作流结构契约（工单 #23）：钉住 .github/workflows/ci.yml 的触发
// 配置与关键步骤在场——「push 与 PR 均触发」是票面验收项，步骤链
// （npm ci → compile → test → vendor:check → vsce）删任一环即回归。
// 用文本断言而非 YAML 解析：仓库 devDependencies 无 YAML 解析器，不为
// 一组结构断言引入新依赖；断言粒度取关键行，不锁步骤顺序与措辞。
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml')

describe('CI 工作流结构契约', () => {
  it('workflow 文件在场', () => {
    expect(existsSync(workflowPath), '.github/workflows/ci.yml 缺失').toBe(true)
  })

  it('push(main) 与 PR 均触发（票面验收）', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toMatch(/push:\s*\n\s*branches:\s*\[\s*main\s*\]/)
    expect(text).toMatch(/^\s*pull_request:\s*$/m)
  })

  it('步骤链覆盖四链路 + vendor 防漂移', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toContain('npm ci')
    expect(text).toContain('npm run compile')
    expect(text).toContain('npm test')
    expect(text).toContain('npm run vendor:check')
    expect(text).toContain('vsce package --no-dependencies')
  })

  it('VSIX 产物与失败报告经 artifact 上传，名称带 attempt 号', () => {
    const text = readFileSync(workflowPath, 'utf8')
    expect(text).toContain('actions/upload-artifact@v4')
    expect(text).toMatch(/name:\s*vsix-a\$\{\{ github\.run_attempt \}\}/)
    expect(text).toMatch(/name:\s*test-report-a\$\{\{ github\.run_attempt \}\}/)
  })
})
