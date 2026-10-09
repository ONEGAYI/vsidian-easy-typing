// 自定义正则保护区纯逻辑测试（工单 #27）：UserDefinedRegExp 多行字符串
// 解析（行尾 |xy 旗标语义）与逐行匹配（上游 core.ts:525-624
// splitTextWithLinkAndUserDefined + isCursorInUserDefinedRegexBlock 的移植）。
// 默认模板全场景（{{...}} / <...> / callout / URL / email / tag 注释行）+
// 边界（嵌套 / 跨行 / 冲突 / 零宽）矩阵。
import { describe, expect, it } from 'vitest'
import { DEFAULT_EFFECTIVE_SETTINGS } from '../src/settings/defaults'
import { SpaceState } from '../src/formatting/inlineParts'
import {
  isPositionProtected,
  matchProtectedRanges,
  parseUserDefinedRegExp,
} from '../src/userDefinedRegex'

/** 解析快捷（默认 = 上游出厂模板字符串） */
function rulesOf(regExps: string = DEFAULT_EFFECTIVE_SETTINGS.userDefinedRegExp) {
  return parseUserDefinedRegExp(regExps)
}

/** 匹配快捷：默认模板下取命中区间形（[begin, end)） */
function spansOf(line: string, regExps?: string) {
  return matchProtectedRanges(line, rulesOf(regExps)).map((r) => [r.begin, r.end])
}

// ===== 解析：|xy 旗标语义（上游 str2SpaceState） =====

describe('解析：默认模板（上游 DEFAULT_SETTINGS 逐字）', () => {
  it('注释行与空行跳过，产出 5 条规则', () => {
    const rules = rulesOf()
    expect(rules.map((r) => r.source)).toEqual([
      '{{.*?}}',
      '<.*?>',
      '\\[\\!.*?\\][-+]{0,1}',
      '(file:///|https?://|ftp://|obsidian://|zotero://|www.)[^\\s（）《》。,，！？;；：“”‘’\\)\\(\\[\\]\\{\\}]+',
      '[a-zA-Z0-9_\\-.]+@[a-zA-Z0-9_\\-.]+',
    ])
  })

  it('旗标三档：|++ 严格、|-- 无、|-+ 左无右严、|=+ 左软右严', () => {
    const rules = rulesOf()
    expect([rules[0]!.leftSpaceRequire, rules[0]!.rightSpaceRequire]).toEqual([
      SpaceState.strict,
      SpaceState.strict,
    ])
    expect([rules[1]!.leftSpaceRequire, rules[1]!.rightSpaceRequire]).toEqual([
      SpaceState.none,
      SpaceState.none,
    ])
    expect([rules[2]!.leftSpaceRequire, rules[2]!.rightSpaceRequire]).toEqual([
      SpaceState.none,
      SpaceState.strict,
    ])
    const soft = parseUserDefinedRegExp('{{.*?}}|=+')
    expect([soft[0]!.leftSpaceRequire, soft[0]!.rightSpaceRequire]).toEqual([
      SpaceState.soft,
      SpaceState.strict,
    ])
  })
})

describe('解析：行过滤规则（上游 regNull / regSRequire）', () => {
  it('空行与纯空白行跳过', () => {
    expect(rulesOf('\n{{.*?}}|++\n   \n').length).toBe(1)
  })

  it('// 开头行是注释行，跳过（默认模板 tag 行不生效即此语义）', () => {
    expect(rulesOf('// 注释\n{{.*?}}|++')).toHaveLength(1)
    // 默认模板第 6 行以 // Tags in Obsidian 开头 → 整行跳过
    expect(rulesOf().some((r) => r.source.includes('#'))).toBe(false)
  })

  it('行尾无 |xy 旗标（或旗标不完整）跳过', () => {
    expect(rulesOf('{{.*?}}')).toHaveLength(0) // 无旗标
    expect(rulesOf('{{.*?}}|+')).toHaveLength(0) // 单字符旗标
    expect(rulesOf('{{.*?}}|x+')).toHaveLength(0) // 非法字符
    expect(rulesOf('{{.*?}}|++多余')).toHaveLength(0) // 旗标后还有尾随
  })

  it('长度 ≤ 3 的行跳过（旗标本身无正则体）', () => {
    expect(rulesOf('|++')).toHaveLength(0)
    expect(rulesOf('|--')).toHaveLength(0)
  })

  it('非法正则跳过，不抛出（上游 try/catch → console.error）', () => {
    expect(rulesOf('[|++\n{{.*?}}|++')).toHaveLength(1)
    expect(rulesOf('(a|++')).toHaveLength(0)
  })

  it('正则体自身可含 |（尾 3 字符固定切分旗标）', () => {
    const rules = rulesOf('a|b|-+')
    expect(rules).toHaveLength(1)
    expect(rules[0]!.source).toBe('a|b')
  })
})

// ===== 匹配：默认模板全场景 =====

describe('匹配：{{...}} 模板占位符', () => {
  it('命中 {{...}} 区间', () => {
    expect(spansOf('前置{{name}}后置')).toEqual([[2, 10]])
  })

  it('同行多个占位符分别命中', () => {
    expect(spansOf('{{a}}中{{b}}')).toEqual([
      [0, 5],
      [6, 11],
    ])
  })

  it('嵌套形态取非贪婪最短（上游 .*? 语义）：{{a{{b}}c}} 命中首个最短闭合 {{a{{b}}', () => {
    expect(spansOf('{{a{{b}}c}}')).toEqual([[0, 8]])
  })

  it('未闭合 {{ 不命中（逐行匹配，不跨行延伸）', () => {
    expect(spansOf('文字{{abc')).toEqual([])
  })
})

describe('匹配：<...> 与 callout', () => {
  it('<xml> 命中（非贪婪最短）', () => {
    expect(spansOf('a<b>c')).toEqual([[1, 4]])
  })

  it('嵌套尖括号整段最短命中：<a<b> 取 <a<b>', () => {
    expect(spansOf('<a<b>')).toEqual([[0, 5]])
  })

  it('callout 标记 [!note] 命中（可选 -/+ 后缀在内）', () => {
    expect(spansOf('> [!note] 标题')).toEqual([[2, 9]])
    expect(spansOf('[!warning]- 文本')).toEqual([[0, 11]])
  })

  it('普通 [!...] 缺右括号不命中；[] 不带感叹号非命中', () => {
    expect(spansOf('文字 [!abc')).toEqual([])
    expect(spansOf('[] 内容')).toEqual([])
  })
})

describe('匹配：URL 与 email', () => {
  it('裸 URL 命中，止于空白/中文标点', () => {
    expect(spansOf('见https://a.com/x?t=1，结束')).toEqual([[1, 20]])
    expect(spansOf('www.example.com/path 后续')).toEqual([[0, 20]])
  })

  it('file/obsidian 协议同命中（模板协议前缀族）', () => {
    expect(spansOf('obsidian://open?vault=a')).toEqual([[0, 23]])
    expect(spansOf('file:///c:/x y')).toEqual([[0, 12]])
  })

  it('email 命中', () => {
    expect(spansOf('联系 mail@example.com 或')).toEqual([[3, 19]])
  })

  it('URL 不跨行（逐行独立）', () => {
    expect(spansOf('https://a.com')).toEqual([[0, 13]])
  })
})

// ===== 匹配：冲突与边界 =====

describe('匹配：与 wikilink/mdlink 的冲突检查（上游 matchWithReg checkArray）', () => {
  it('与 wikilink 重叠的用户正则命中弃用', () => {
    // [[a|b]] 整体是 wikilink；用户正则 a|b 的命中区间落在其内 → 弃
    expect(matchProtectedRanges('[[a|b]]', rulesOf('a|b|--'))).toEqual([])
  })

  it('与 mdlink 重叠弃用；不重叠的正常命中', () => {
    expect(matchProtectedRanges('[t](a.com)', rulesOf('a\\.com|--'))).toEqual([])
    expect(
      matchProtectedRanges('[t](x) a.com', rulesOf('a\\.com|--')).map((r) => [r.begin, r.end]),
    ).toEqual([[7, 12]])
  })

  it('多用户规则间：先到先得，后者与前者重叠即弃', () => {
    const rules = parseUserDefinedRegExp('\\d{3}|--\n\\d|--')
    expect(matchProtectedRanges('ab123cd', rules).map((r) => [r.begin, r.end])).toEqual([[2, 5]])
  })
})

describe('匹配：零宽与空命中防御', () => {
  it('可零宽匹配的正则不产生空区间、不死循环（上游无防御，移植侧防御）', () => {
    const rules = parseUserDefinedRegExp('x*|++')
    expect(matchProtectedRanges('abc', rules)).toEqual([])
  })

  it('空规则列表 → 无命中', () => {
    expect(matchProtectedRanges('{{a}}', [])).toEqual([])
  })
})

// ===== 光标位置判定（上游 isCursorInUserDefinedRegexBlock） =====

describe('isPositionProtected：列 ∈ [begin, end) 半开区间', () => {
  const rules = rulesOf()

  it('列 = begin 与 end-1 在区内；begin-1 与 end 在区外', () => {
    const line = '前置{{name}}后置' // 区间 [2, 10)
    expect(isPositionProtected(line, 2, rules)).toBe(true)
    expect(isPositionProtected(line, 9, rules)).toBe(true)
    expect(isPositionProtected(line, 1, rules)).toBe(false)
    expect(isPositionProtected(line, 10, rules)).toBe(false)
  })

  it('列在保护区外正常返回 false', () => {
    expect(isPositionProtected('普通文字', 2, rules)).toBe(false)
  })
})
