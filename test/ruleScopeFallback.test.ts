// 作用域判定降级实现测试（工单 #25）：上游 detectRuleScope（syntax.ts）
// 经 CM6 syntaxTree 判 math/code 节点名；vsidian live 编辑器该入口恒为
// 未解析空树（vsidian#406），行为链管线按规格注入本文本正则降级版。
// 本文件钉住降级版的判定口径：围栏代码块（含语言与关闭）、数学区间
// （$...$ 行内 / $$...$$ 块级）、行内代码跳过与转义。近似边界（货币
// 符号误判等）记录在 docs/specs/rule-engine.md「#25 行为链接入」节。
import { describe, expect, it } from 'vitest'
import { RuleScope } from '../src/rules/rule-engine'
import { detectScopeFromText } from '../src/ruleScopeFallback'

describe('detectScopeFromText：正文默认', () => {
  it('普通文本 → Text', () => {
    expect(detectScopeFromText('你好 world', 5)).toEqual({ scope: RuleScope.Text })
  })

  it('空文档与越界光标钳制（防御，不抛错）', () => {
    expect(detectScopeFromText('', 0)).toEqual({ scope: RuleScope.Text })
    expect(detectScopeFromText('abc', 99)).toEqual({ scope: RuleScope.Text })
  })
})

describe('detectScopeFromText：围栏代码块 → Code', () => {
  it('光标在 ``` 围栏内 → Code，语言取开栏信息串首 token', () => {
    const doc = '```python\nx = 1\n```'
    expect(detectScopeFromText(doc, 12)).toEqual({ scope: RuleScope.Code, language: 'python' })
  })

  it('开栏无信息串 → language undefined', () => {
    const doc = '```\ncode\n```'
    expect(detectScopeFromText(doc, 5)).toEqual({ scope: RuleScope.Code, language: undefined })
  })

  it('光标在围栏行（开栏/关栏行）→ Text（围栏标记行不是代码内容）', () => {
    const doc = '```js\ncode\n```'
    expect(detectScopeFromText(doc, 3).scope).toBe(RuleScope.Text)
    expect(detectScopeFromText(doc, doc.length).scope).toBe(RuleScope.Text)
  })

  it('已关闭围栏之后 → Text', () => {
    const doc = '```js\ncode\n```\nafter'
    expect(detectScopeFromText(doc, doc.length).scope).toBe(RuleScope.Text)
  })

  it('~~~ 围栏同口径；关闭须同字符且长度不小于开栏', () => {
    expect(detectScopeFromText('~~~ts\nx\n~~~', 7)).toEqual({ scope: RuleScope.Code, language: 'ts' })
    // ``` 开 ~~~ 关不闭合：仍在 Code
    expect(detectScopeFromText('```\nx\n~~~\ny', 12).scope).toBe(RuleScope.Code)
  })

  it('多段围栏逐段判定', () => {
    const doc = '```js\na\n```\ntext\n```py\nb\n```'
    expect(detectScopeFromText(doc, 7)).toEqual({ scope: RuleScope.Code, language: 'js' })
    expect(detectScopeFromText(doc, 15).scope).toBe(RuleScope.Text)
    expect(detectScopeFromText(doc, 25)).toEqual({ scope: RuleScope.Code, language: 'py' })
  })

  it('缩进不超过三空格的围栏有效（Markdown 围栏口径）', () => {
    expect(detectScopeFromText('   ```js\nx', 9)).toEqual({ scope: RuleScope.Code, language: 'js' })
  })
})

describe('detectScopeFromText：数学区间 → Formula', () => {
  it('行内 $...$ 光标在区间内 → Formula', () => {
    expect(detectScopeFromText('$x$', 2).scope).toBe(RuleScope.Formula)
  })

  it('块级 $$...$$ 跨行区间内 → Formula；区间外 → Text', () => {
    const doc = '$$\nx^2\n$$'
    expect(detectScopeFromText(doc, 4).scope).toBe(RuleScope.Formula)
    expect(detectScopeFromText(doc, doc.length).scope).toBe(RuleScope.Text)
  })

  it('未配对单 $ 到行尾重置（行内区间不跨行）；$$ 未闭合保持块级', () => {
    // 前一行未配对 $ 不影响下一行
    expect(detectScopeFromText('a $100\nb', 8).scope).toBe(RuleScope.Text)
    expect(detectScopeFromText('$$\nx', 4).scope).toBe(RuleScope.Formula)
  })

  it('转义 \\$ 不开区间', () => {
    expect(detectScopeFromText('价格 \\$5 和 \\$6 之间', 10).scope).toBe(RuleScope.Text)
  })

  it('行内代码 `...` 内的 $ 不参与配对', () => {
    expect(detectScopeFromText('`$x$` 后', 4).scope).toBe(RuleScope.Text)
  })
})
