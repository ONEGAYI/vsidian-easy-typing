// 前缀词典测试（工单 #26）：解析（字面词/正则条目/分隔符）、精确命中、
// 前缀判定、抑制矩阵与最长前缀匹配——上游 prefix_dictionary.ts 语义。
// 字面词匹配**区分大小写**（上游实现的实口径；默认词条 python3/Python3
// 双写即为此服务——注释里的 "Case-insensitive" 与实现不符，以实现为准）。
import { describe, expect, it } from 'vitest'
import { PrefixDictionary } from '../src/formatting/prefixDictionary'

/** 默认词条（上游 DEFAULT_SETTINGS.PrefixDictionary 原样） */
const DEFAULT_RAW = 'n8n, /[1234][dD]/\npython3, Python3'

describe('解析', () => {
  it('逗号/空格/换行分隔；正则条目 /.../ 形态（内部可含逗号）', () => {
    const dict = new PrefixDictionary('n8n, python3')
    expect(dict.isExactMatch('n8n')).toBe(true)
    expect(dict.isExactMatch('python3')).toBe(true)
    expect(dict.isExactMatch('python')).toBe(false)
  })

  it('正则条目带旗标', () => {
    const dict = new PrefixDictionary('/^v\\d+$/')
    expect(dict.isExactMatch('v1')).toBe(true)
    expect(dict.isExactMatch('x')).toBe(false)
  })

  it('非法正则条目跳过，不抛错', () => {
    expect(() => new PrefixDictionary('/([/ , n8n')).not.toThrow()
    const dict = new PrefixDictionary('/([/ , n8n')
    expect(dict.isExactMatch('n8n')).toBe(true)
  })

  it('空串/纯空白 → 空词典', () => {
    expect(new PrefixDictionary('').isExactMatch('n8n')).toBe(false)
    expect(new PrefixDictionary('   ').isExactMatch('n8n')).toBe(false)
  })
})

describe('精确命中（isExactMatch）', () => {
  const dict = new PrefixDictionary(DEFAULT_RAW)

  it('字面词精确命中；大小写敏感', () => {
    expect(dict.isExactMatch('n8n')).toBe(true)
    expect(dict.isExactMatch('N8N')).toBe(false)
    expect(dict.isExactMatch('python3')).toBe(true)
    expect(dict.isExactMatch('Python3')).toBe(true)
    expect(dict.isExactMatch('PYTHON3')).toBe(false)
  })

  it('正则条目全 token 锚定命中', () => {
    expect(dict.isExactMatch('1d')).toBe(true)
    expect(dict.isExactMatch('4D')).toBe(true)
    expect(dict.isExactMatch('5d')).toBe(false)
    expect(dict.isExactMatch('x1d')).toBe(false) // 子串不命中（锚定）
  })
})

describe('前缀判定（isPrefixOfWord）', () => {
  const dict = new PrefixDictionary(DEFAULT_RAW)

  it('是某字面词的真前缀 → true（正则条目不参与前缀）', () => {
    expect(dict.isPrefixOfWord('n')).toBe(true)
    expect(dict.isPrefixOfWord('n8')).toBe(true)
    expect(dict.isPrefixOfWord('n8n')).toBe(false) // 等长非前缀
    expect(dict.isPrefixOfWord('python')).toBe(true)
    expect(dict.isPrefixOfWord('1')).toBe(false) // 正则条目不算词
    expect(dict.isPrefixOfWord('')).toBe(false)
  })
})

describe('抑制矩阵（shouldSuppressSpace）', () => {
  const dict = new PrefixDictionary(DEFAULT_RAW)

  it('规则 1：精确命中 → 任意位置抑制', () => {
    expect(dict.shouldSuppressSpace('n8n', true)).toBe(true)
    expect(dict.shouldSuppressSpace('n8n', false)).toBe(true)
  })

  it('规则 2：词前缀 + 光标处 → 抑制（输入进行时暂缓）', () => {
    expect(dict.shouldSuppressSpace('n', true)).toBe(true)
  })

  it('规则 3：词前缀 + 非光标 → 不抑制', () => {
    expect(dict.shouldSuppressSpace('n', false)).toBe(false)
  })

  it('规则 4：全不命中 → 不抑制', () => {
    expect(dict.shouldSuppressSpace('xyz', true)).toBe(false)
    expect(dict.shouldSuppressSpace('xyz', false)).toBe(false)
  })
})

describe('最长前缀匹配（findLongestMatchFromStart）', () => {
  const dict = new PrefixDictionary(DEFAULT_RAW)

  it('字面词前缀长度', () => {
    expect(dict.findLongestMatchFromStart('n8n')).toBe(3)
    expect(dict.findLongestMatchFromStart('python3x')).toBe(7)
    expect(dict.findLongestMatchFromStart('zzz')).toBe(-1)
  })

  it('正则条目起点锚定匹配长度', () => {
    expect(dict.findLongestMatchFromStart('1d5')).toBe(2)
  })
})
