// 文件排除匹配测试（工单 #28）：上游 isCurrentFileExclude 前缀语义的
// Vsidian docUri 映射——URI 解码、段边界后缀、条目归一、防御面。
import { describe, expect, it } from 'vitest'
import { docUriToPath, isDocUriExcluded, type DocUriParser } from '../src/fileExclusion'

/** 固定路径解析器（node 无 URL 文件解码差异；等价浏览器 new URL） */
function fakeParser(): DocUriParser {
  return {
    parse: (uri) => {
      const m = /^file:\/\/([^?]*)(?:\?|$)/.exec(uri)
      return m !== null ? { path: m[1]! } : null
    },
  }
}

describe('docUriToPath：URI → 解码路径', () => {
  it('标准文件 URI：解码百分号编码并去首部斜杠', () => {
    expect(docUriToPath('file:///d%3A/Vault/DailyNote/test.md', fakeParser())).toBe(
      'd:/Vault/DailyNote/test.md',
    )
  })

  it('中文路径解码；反斜杠归一为斜杠', () => {
    expect(docUriToPath('file:///D/%E7%AC%94%E8%AE%B0/a.md', fakeParser())).toBe('D/笔记/a.md')
    expect(docUriToPath('file:///D:\\Note\\a.md', fakeParser())).toBe('D:/Note/a.md')
  })

  it('坏编码（孤立 %）不抛错按原样；非 file 串原样比对', () => {
    expect(docUriToPath('file:///a%zz/b.md', fakeParser())).toBe('a%zz/b.md')
    expect(docUriToPath('DailyNote/test.md', fakeParser())).toBe('DailyNote/test.md')
  })
})

describe('isDocUriExcluded：上游前缀语义（段边界后缀版）', () => {
  const parser = fakeParser()
  const uri = (p: string): string => `file:///d%3A/Vault/${p}`

  it('精确文件路径命中；无中生有的前缀不命中', () => {
    expect(isDocUriExcluded(uri('DailyNote/test.md'), ['DailyNote/test.md'], parser)).toBe(true)
    expect(isDocUriExcluded(uri('DailyNote/testx.md'), ['DailyNote/test.md'], parser)).toBe(false)
  })

  it('文件夹条目：带尾斜杠与不带尾斜杠（下一字符为 /）等价命中', () => {
    for (const entry of ['DailyNote/', 'DailyNote', '/DailyNote/', '\\DailyNote\\']) {
      expect(isDocUriExcluded(uri('DailyNote/WeekNotes/a.md'), [entry], parser)).toBe(true)
    }
    // 段中间截断不算前缀（上游 next-char 边界）
    expect(isDocUriExcluded(uri('DailyNoteX/a.md'), ['DailyNote'], parser)).toBe(false)
    expect(isDocUriExcluded(uri('DailyNotex/a.md'), ['DailyNote/'], parser)).toBe(false)
  })

  it('多级前缀（子文件夹）与多根/中路径同名目录边界命中（已知近似）', () => {
    expect(isDocUriExcluded(uri('DailyNote/WeekNotes/a.md'), ['DailyNote/WeekNotes'], parser)).toBe(true)
    // vault 相对路径 = 任意段边界后缀：嵌套同名目录也命中（记录于规格）
    expect(isDocUriExcluded('file:///v/sub/DailyNote/x.md', ['DailyNote/'], parser)).toBe(true)
  })

  it('排除域外路径不命中；多条目任一命中即排除', () => {
    expect(isDocUriExcluded(uri('Other/x.md'), ['DailyNote/'], parser)).toBe(false)
    expect(isDocUriExcluded(uri('Other/x.md'), ['Nope/', 'Other'], parser)).toBe(true)
  })

  it('防御面：空清单 / 空 docUri / 空白条目永不命中；非字符串条目跳过', () => {
    expect(isDocUriExcluded(uri('a.md'), [], parser)).toBe(false)
    expect(isDocUriExcluded('', ['a'], parser)).toBe(false)
    expect(isDocUriExcluded(uri('a.md'), ['', '   '], parser)).toBe(false)
    expect(isDocUriExcluded(uri('a.md'), [42 as unknown as string, 'a.md'], parser)).toBe(true)
  })
})
