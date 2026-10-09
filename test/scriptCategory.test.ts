// 脚本分类测试（工单 #26）：上游 script_category.ts 的分类/字符类解析/
// 语言对正则生成矩阵——区段覆盖（中日韩俄数字英文 + 边界码位）与
// 自定义类查找。
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_CATEGORIES,
  ScriptCategory,
  buildPairRegexps,
  classifyChar,
  resolveCharClass,
} from '../src/formatting/scriptCategory'

describe('classifyChar 区段矩阵', () => {
  const cases: Array<[string, ScriptCategory]> = [
    ['中', ScriptCategory.Chinese],
    ['龯', ScriptCategory.Chinese], // U+4DBF 扩展 A 上界
    ['あ', ScriptCategory.Japanese],
    ['ア', ScriptCategory.Japanese],
    ['한', ScriptCategory.Korean],
    ['A', ScriptCategory.English],
    ['z', ScriptCategory.English],
    ['5', ScriptCategory.Digit],
    ['р', ScriptCategory.Russian], // U+0440 西里尔
    ['。', ScriptCategory.Unknown], // CJK 标点归 Unknown（isCJKContext 另行补判）
    [' ', ScriptCategory.Unknown],
  ]
  for (const [ch, expected] of cases) {
    it(`classifyChar(${JSON.stringify(ch)}) → ${expected}`, () => {
      expect(classifyChar(ch)).toBe(expected)
    })
  }

  it('空串与 undefined 形态归 Unknown', () => {
    expect(classifyChar('')).toBe(ScriptCategory.Unknown)
  })
})

describe('resolveCharClass', () => {
  it('内置类 → 字符类片段（Chinese 区段原样）', () => {
    expect(resolveCharClass(ScriptCategory.Chinese)).toBe('\\u4e00-\\u9fff\\u3400-\\u4dbf')
    expect(resolveCharClass('english')).toBe('A-Za-z')
    expect(resolveCharClass('digit')).toBe('0-9')
  })

  it('CJK 元类展开为中日韩并集', () => {
    const cjk = resolveCharClass(ScriptCategory.CJK)
    expect(cjk).toContain('\\u4e00-\\u9fff')
    expect(cjk).toContain('\\u3040-\\u309f')
    expect(cjk).toContain('\\uac00-\\ud7af')
  })

  it('自定义类按名查找（pattern 为字符类内部片段）', () => {
    expect(resolveCharClass('greek', [{ name: 'greek', pattern: '\\u0391-\\u03c9' }])).toBe('\\u0391-\\u03c9')
    expect(resolveCharClass('greek')).toBe('')
    expect(resolveCharClass('other', [{ name: 'greek', pattern: 'X' }])).toBe('')
  })

  it('Unknown → 空串', () => {
    expect(resolveCharClass(ScriptCategory.Unknown)).toBe('')
  })
})

describe('buildPairRegexps', () => {
  it('中英对 → 两条方向正则，均命中对应邻接', () => {
    const [ab, ba] = buildPairRegexps('chinese', 'english')
    expect(ab).toBeDefined()
    expect(ba).toBeDefined()
    expect(ab!.test('中a')).toBe(true)
    expect(ab!.test('a中')).toBe(false)
    expect(ba!.test('a中')).toBe(true)
    expect(ba!.test('中a')).toBe(false)
  })

  it('自定义类参与对正则', () => {
    const regs = buildPairRegexps('greek', 'chinese', [{ name: 'greek', pattern: '\\u0391-\\u03c9' }])
    expect(regs.length).toBe(2)
    expect(regs[0]!.test('α中')).toBe(true)
  })

  it('未知类 → 空数组（该对不参与匹配）', () => {
    expect(buildPairRegexps('nosuch', 'english')).toEqual([])
  })

  it('内置类清单含 CJK 元类、不含 Unknown', () => {
    expect(BUILTIN_CATEGORIES).toContain(ScriptCategory.CJK)
    expect(BUILTIN_CATEGORIES).not.toContain(ScriptCategory.Unknown)
    expect(BUILTIN_CATEGORIES.length).toBe(7)
  })
})
