// page-settings 语言源接线契约（工单 #58）：设置页语言源从 navigator.language
// （跟随 OS，与主设置分叉的交杂来源）改为消费平台 SDK locale（vsidian#582，
// 跟随 VSCode 主设置）。入口文件依赖构建桥虚拟模块（vitest 不可导入），
// 沿用 pageEditorWiring 的源文本契约形态钉住接线面：
// 1. 语言解析必须经 resolvePageLanguage 单一出口（locale facet 在场取平台
//    快照、空串落英文由 pickMessages 承接；缺席回落 navigator.language）；
// 2. sdk.locale.onChange 订阅接入 view.setLanguage（就地切换，保全页面状态）；
// 3. onDispose 内退订订阅（facet 代次释放自动回收之外的双保险）；
// 4. 防回潮：不再出现 navigator.language 直连 pickMessages/localeTagFor。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pageSettingsPath = path.join(repoRoot, 'src/page-settings.ts')
const source = readFileSync(pageSettingsPath, 'utf8')

describe('page-settings 语言源接线契约（#58）', () => {
  it('语言解析经单一出口 resolvePageLanguage（sdk.locale 入参 + navigator.language 回退）', () => {
    // 双消费点（messages / localeTag）共用同一表达式：出口收敛不许分叉
    const uses = source.match(/resolvePageLanguage\(sdk\.locale, navigator\.language\)/g) ?? []
    expect(uses.length).toBe(2)
  })

  it('locale facet 订阅接入 view.setLanguage（onChange 只通知变化，不回放首值）', () => {
    expect(source).toMatch(/sdk\.locale\?\.onChange\(\(locale[^)]*\) => view\.setLanguage\(locale\)\)/)
  })

  it('onDispose 内先退订 locale 订阅再释放视图（顺序钉住：退订不触达已释放视图）', () => {
    const disposeIndex = source.indexOf('sdk.onDispose(')
    expect(disposeIndex).toBeGreaterThanOrEqual(0)
    const disposeBody = source.slice(disposeIndex)
    const unsubIndex = disposeBody.indexOf('unsubscribeLocale?.()')
    const viewDisposeIndex = disposeBody.indexOf('view.dispose()')
    expect(unsubIndex).toBeGreaterThanOrEqual(0)
    expect(viewDisposeIndex).toBeGreaterThan(unsubIndex)
  })

  it('防回潮：navigator.language 不再直连字典映射（须先经单一出口解析）', () => {
    expect(source).not.toContain('pickMessages(navigator.language)')
    expect(source).not.toContain('localeTagFor(navigator.language)')
  })
})
