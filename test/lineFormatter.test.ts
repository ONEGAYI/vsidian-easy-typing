// 行级格式化矩阵（工单 #26；#4 补格收口至 88 场景；#70 补 20 场景至 108）：formatLine 全场景
// 回归——期望值经**上游差异化验证**固定（上游 core.ts formatLine 以伪
// syntaxTree 注入本移植切出的 code/formula 区段，与
// src/formatting/lineFormatter.ts 逐场景比对等价后回填；复跑方法见
// docs/specs/auto-format.md「上游对照」节）。
//
// 矩阵维度：语言对（默认三对 + 日/韩/俄/CJK 元类/自定义类/未知类/空表）×
// 前缀词典（字面词精确/前缀暂缓/跨脚本扩展/词典过期补插/正则条目）× 大写
// 开关（句首形态族 + 句中标点族 + 守卫）× 行内分区（代码/公式/链接/
// $qquad$ 计为文本空隔/软空格符号/<br>/转义 $）× 光标位置语义（键入
// 区间/越界回退）× 行内间距三档（none/soft/strict × code/formula/
// wikilink/mdlink，含 strict 补足 soft 状态、链接智能空格子分支与非
// text 分区直接相邻——#4 验收矩阵）。
import { describe, expect, it } from 'vitest'
import { formatLine, type LineFormatSettings, type LineSyntaxContext } from '../src/formatting/lineFormatter'
import { SpaceState } from '../src/formatting/inlineParts'
import { makeSyntaxFake } from './syntaxFake'

/** 单行文档的树版判定源（#5：fake 判定链，行号恒 1；doc/query 与行文本同源） */
function syntaxOf(line: string): LineSyntaxContext {
  const fake = makeSyntaxFake(line)
  return { doc: fake.doc, query: fake.query, lineNumber: 1 }
}

/** 矩阵基准设置（上游 DEFAULT_SETTINGS 的行格式化子集，逐键对照） */
function baseSettings(): LineFormatSettings {
  return {
    languagePairs: [
      { a: 'chinese', b: 'english' },
      { a: 'chinese', b: 'digit' },
      { a: 'digit', b: 'english' },
    ],
    customScriptCategories: [],
    prefixDictionary: 'n8n, /[1234][dD]/' + String.fromCharCode(10) + 'python3, Python3, b站',
    autoCapital: false,
    softSpaceLeftSymbols: '-',
    softSpaceRightSymbols: '-',
    inlineCodeSpaceMode: SpaceState.soft,
    inlineFormulaSpaceMode: SpaceState.soft,
    inlineLinkSpaceMode: SpaceState.soft,
    inlineLinkSmartSpace: true,
  }
}

/** 上游设置键 → 本移植键（与差异化工具的映射一致） */
function applyOverrides(base: LineFormatSettings, o: Record<string, unknown>): LineFormatSettings {
  return {
    ...base,
    ...(o.languagePairs !== undefined
      ? { languagePairs: o.languagePairs as LineFormatSettings['languagePairs'] }
      : {}),
    ...(o.customScriptCategories !== undefined
      ? { customScriptCategories: o.customScriptCategories as LineFormatSettings['customScriptCategories'] }
      : {}),
    ...(o.AutoCapital !== undefined ? { autoCapital: o.AutoCapital as boolean } : {}),
    ...(o.SoftSpaceLeftSymbols !== undefined ? { softSpaceLeftSymbols: o.SoftSpaceLeftSymbols as string } : {}),
    ...(o.SoftSpaceRightSymbols !== undefined ? { softSpaceRightSymbols: o.SoftSpaceRightSymbols as string } : {}),
    ...(o.InlineCodeSpaceMode !== undefined ? { inlineCodeSpaceMode: o.InlineCodeSpaceMode as SpaceState } : {}),
    ...(o.InlineFormulaSpaceMode !== undefined
      ? { inlineFormulaSpaceMode: o.InlineFormulaSpaceMode as SpaceState }
      : {}),
    ...(o.InlineLinkSpaceMode !== undefined ? { inlineLinkSpaceMode: o.InlineLinkSpaceMode as SpaceState } : {}),
    ...(o.InlineLinkSmartSpace !== undefined ? { inlineLinkSmartSpace: o.InlineLinkSmartSpace as boolean } : {}),
  }
}

interface MatrixEntry {
  name: string
  line: string
  curCh: number
  prevCh: number | undefined
  settings?: Record<string, unknown>
  expected: {
    line: string
    cursorCh: number
    changes: Array<{ text: string; begin: number; end: number; origin: string }>
  }
}

// 表由差异化工具生成后回填（JSON 字面量形态，合法 TS）
const MATRIX: MatrixEntry[] = [
      { name: "zh-en-tail", line: "中文abc", curCh: 5, prevCh: 4,
        expected: {"line":"中文abc","cursorCh":5,"changes":[]} },
      { name: "en-zh-tail", line: "abc中文", curCh: 5, prevCh: 4,
        expected: {"line":"abc中文","cursorCh":5,"changes":[]} },
      { name: "zh-digit-tail", line: "中文1", curCh: 3, prevCh: 2,
        expected: {"line":"中文 1","cursorCh":4,"changes":[{"text":"中文 1","begin":0,"end":3,"origin":"中文1"}]} },
      { name: "digit-en-tail", line: "1a", curCh: 2, prevCh: 1,
        expected: {"line":"1 a","cursorCh":3,"changes":[{"text":"1 a","begin":0,"end":2,"origin":"1a"}]} },
      { name: "digit-zh-tail", line: "1中", curCh: 2, prevCh: 1,
        expected: {"line":"1 中","cursorCh":3,"changes":[{"text":"1 中","begin":0,"end":2,"origin":"1中"}]} },
      { name: "multi-boundary", line: "中文abc中文", curCh: 6, prevCh: 5,
        expected: {"line":"中文abc 中文","cursorCh":7,"changes":[{"text":"中文abc 中文","begin":0,"end":7,"origin":"中文abc中文"}]} },
      { name: "plain-english-noop", line: "abc def", curCh: 7, prevCh: 6,
        expected: {"line":"abc def","cursorCh":7,"changes":[]} },
      { name: "boundary-out-of-range", line: "中文abc", curCh: 5, prevCh: 5,
        expected: {"line":"中文abc","cursorCh":5,"changes":[]} },
      { name: "typing-mid-word", line: "中文abc", curCh: 4, prevCh: 3,
        expected: {"line":"中文abc","cursorCh":4,"changes":[]} },
      { name: "no-prevch-reformat", line: "中文abc", curCh: 5, prevCh: undefined,
        expected: {"line":"中文abc","cursorCh":5,"changes":[]} },
      { name: "whitespace-only", line: "   ", curCh: 3, prevCh: 2,
        expected: {"line":"   ","cursorCh":3,"changes":[]} },
      { name: "empty-line", line: "", curCh: 0, prevCh: undefined,
        expected: {"line":"","cursorCh":0,"changes":[]} },
      { name: "japanese-en", line: "あいa", curCh: 3, prevCh: 2,
        settings: {"languagePairs":[{"a":"japanese","b":"english"}]},
        expected: {"line":"あい a","cursorCh":4,"changes":[{"text":"あい a","begin":0,"end":3,"origin":"あいa"}]} },
      { name: "korean-en", line: "한글a", curCh: 3, prevCh: 2,
        settings: {"languagePairs":[{"a":"korean","b":"english"}]},
        expected: {"line":"한글 a","cursorCh":4,"changes":[{"text":"한글 a","begin":0,"end":3,"origin":"한글a"}]} },
      { name: "russian-en", line: "приветa", curCh: 7, prevCh: 6,
        settings: {"languagePairs":[{"a":"russian","b":"english"}]},
        expected: {"line":"привет a","cursorCh":8,"changes":[{"text":"привет a","begin":0,"end":7,"origin":"приветa"}]} },
      { name: "cjk-meta-en", line: "あ한a", curCh: 3, prevCh: 2,
        settings: {"languagePairs":[{"a":"cjk","b":"english"}]},
        expected: {"line":"あ한 a","cursorCh":4,"changes":[{"text":"あ한 a","begin":0,"end":3,"origin":"あ한a"}]} },
      { name: "cjk-meta-ko-zh", line: "한글中文", curCh: 4, prevCh: 3,
        settings: {"languagePairs":[{"a":"cjk","b":"chinese"}]},
        expected: {"line":"한글中 文","cursorCh":5,"changes":[{"text":"한글中 文","begin":0,"end":4,"origin":"한글中文"}]} },
      { name: "custom-greek-zh", line: "αβγ中", curCh: 4, prevCh: 3,
        settings: {"languagePairs":[{"a":"greek","b":"chinese"}],"customScriptCategories":[{"name":"greek","pattern":"\\u0391-\\u03c9"}]},
        expected: {"line":"αβγ 中","cursorCh":5,"changes":[{"text":"αβγ 中","begin":0,"end":4,"origin":"αβγ中"}]} },
      { name: "unknown-pair-ignored", line: "中文abc", curCh: 5, prevCh: 4,
        settings: {"languagePairs":[{"a":"nosuch","b":"english"}]},
        expected: {"line":"中文abc","cursorCh":5,"changes":[]} },
      { name: "empty-pairs-noop", line: "中文abc", curCh: 5, prevCh: 4,
        settings: {"languagePairs":[]},
        expected: {"line":"中文abc","cursorCh":5,"changes":[]} },
      { name: "dict-n8n-final", line: "中文n8n", curCh: 5, prevCh: 4,
        expected: {"line":"中文n8n","cursorCh":5,"changes":[]} },
      { name: "dict-n8n-first", line: "中文n", curCh: 3, prevCh: 2,
        expected: {"line":"中文 n","cursorCh":4,"changes":[{"text":"中文 n","begin":0,"end":3,"origin":"中文n"}]} },
      { name: "dict-n8n-mid", line: "中文 n8", curCh: 5, prevCh: 4,
        expected: {"line":"中文 n8","cursorCh":5,"changes":[]} },
      { name: "dict-python-prefix", line: "中文python", curCh: 8, prevCh: 7,
        expected: {"line":"中文python","cursorCh":8,"changes":[]} },
      { name: "dict-bstation", line: "中文b站", curCh: 4, prevCh: 3,
        expected: {"line":"中文b站","cursorCh":4,"changes":[]} },
      { name: "dict-bstation-first", line: "中文b", curCh: 3, prevCh: 2,
        expected: {"line":"中文 b","cursorCh":4,"changes":[{"text":"中文 b","begin":0,"end":3,"origin":"中文b"}]} },
      { name: "dict-expiry-python3x", line: "中文python3x", curCh: 10, prevCh: 9,
        expected: {"line":"中文 python3 x","cursorCh":12,"changes":[{"text":"中文 python3 x","begin":0,"end":10,"origin":"中文python3x"}]} },
      { name: "dict-expiry-n8ns", line: "中文n8ns", curCh: 6, prevCh: 5,
        expected: {"line":"中文 n 8 ns","cursorCh":9,"changes":[{"text":"中文 n 8 ns","begin":0,"end":6,"origin":"中文n8ns"}]} },
      { name: "dict-expiry-bstation-follow-cjk", line: "中文b站中", curCh: 5, prevCh: 4,
        expected: {"line":"中文b站中","cursorCh":5,"changes":[]} },
      { name: "dict-finalized-by-space", line: "中文n8n ", curCh: 6, prevCh: 5,
        expected: {"line":"中文n8n ","cursorCh":6,"changes":[]} },
      { name: "dict-regex-entry", line: "中文1d", curCh: 4, prevCh: 3,
        expected: {"line":"中文1d","cursorCh":4,"changes":[]} },
      { name: "dict-regex-expiry", line: "中文1d5", curCh: 5, prevCh: 4,
        expected: {"line":"中文 1d 5","cursorCh":7,"changes":[{"text":"中文 1d 5","begin":0,"end":5,"origin":"中文1d5"}]} },
      { name: "dict-python3-exact", line: "中文python3", curCh: 9, prevCh: 8,
        expected: {"line":"中文python3","cursorCh":9,"changes":[]} },
      { name: "cap-first", line: "abc", curCh: 1, prevCh: 0,
        settings: {"AutoCapital":true},
        expected: {"line":"Abc","cursorCh":1,"changes":[{"text":"Abc","begin":0,"end":3,"origin":"abc"}]} },
      { name: "cap-heading", line: "# abc", curCh: 3, prevCh: 2,
        settings: {"AutoCapital":true},
        expected: {"line":"# Abc","cursorCh":3,"changes":[{"text":"# Abc","begin":0,"end":5,"origin":"# abc"}]} },
      { name: "cap-quote", line: "> abc", curCh: 3, prevCh: 2,
        settings: {"AutoCapital":true},
        expected: {"line":"> Abc","cursorCh":3,"changes":[{"text":"> Abc","begin":0,"end":5,"origin":"> abc"}]} },
      { name: "cap-task", line: "- [ ] abc", curCh: 7, prevCh: 6,
        settings: {"AutoCapital":true},
        expected: {"line":"- [ ] Abc","cursorCh":7,"changes":[{"text":"- [ ] Abc","begin":0,"end":9,"origin":"- [ ] abc"}]} },
      { name: "cap-bold", line: "**abc", curCh: 3, prevCh: 2,
        settings: {"AutoCapital":true},
        expected: {"line":"**Abc","cursorCh":3,"changes":[{"text":"**Abc","begin":0,"end":5,"origin":"**abc"}]} },
      { name: "cap-mid-sentence", line: "end. next", curCh: 6, prevCh: 5,
        settings: {"AutoCapital":true},
        expected: {"line":"end. Next","cursorCh":6,"changes":[{"text":"end. Next","begin":0,"end":9,"origin":"end. next"}]} },
      { name: "cap-mid-sentence-cjk-punct", line: "结束。next", curCh: 4, prevCh: 3,
        settings: {"AutoCapital":true},
        expected: {"line":"结束。Next","cursorCh":4,"changes":[{"text":"结束。Next","begin":0,"end":7,"origin":"结束。next"}]} },
      { name: "cap-space-dot-guard", line: "x . y", curCh: 5, prevCh: 4,
        settings: {"AutoCapital":true},
        expected: {"line":"x . Y","cursorCh":5,"changes":[{"text":"x . Y","begin":0,"end":5,"origin":"x . y"}]} },
      { name: "cap-already-upper", line: "Abc", curCh: 3, prevCh: 2,
        settings: {"AutoCapital":true},
        expected: {"line":"Abc","cursorCh":3,"changes":[]} },
      { name: "cap-russian", line: "привет", curCh: 1, prevCh: 0,
        settings: {"AutoCapital":true},
        expected: {"line":"Привет","cursorCh":1,"changes":[{"text":"Привет","begin":0,"end":6,"origin":"привет"}]} },
      { name: "cap-off-default", line: "abc", curCh: 3, prevCh: 2,
        expected: {"line":"abc","cursorCh":3,"changes":[]} },
      { name: "code-text-before", line: "中文`a`", curCh: 5, prevCh: 4,
        expected: {"line":"中文 `a`","cursorCh":6,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
      { name: "code-text-after", line: "`a`中文", curCh: 5, prevCh: 4,
        expected: {"line":"`a` 中文","cursorCh":6,"changes":[{"text":" 中文","begin":3,"end":5,"origin":"中文"}]} },
      { name: "code-both-sides", line: "中文`a`中文", curCh: 6, prevCh: 5,
        expected: {"line":"中文 `a` 中文","cursorCh":8,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":5,"end":7,"origin":"中文"}]} },
      { name: "code-cursor-inside", line: "中文`ab", curCh: 5, prevCh: 4,
        expected: {"line":"中文`ab","cursorCh":5,"changes":[]} },
      { name: "formula-text", line: "$x$中文", curCh: 5, prevCh: 4,
        expected: {"line":"$x$ 中文","cursorCh":6,"changes":[{"text":" 中文","begin":3,"end":5,"origin":"中文"}]} },
      { name: "formula-dd", line: "中文$$x$$", curCh: 7, prevCh: 6,
        expected: {"line":"中文 $$x$$","cursorCh":8,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
      { name: "qquad-spacer", line: "中文$\\qquad$中文", curCh: 9, prevCh: 8,
        expected: {"line":"中文$\\qquad$中文","cursorCh":0,"changes":[]} },
      { name: "wikilink-smart-cjk", line: "中文[[a]]中文", curCh: 8, prevCh: 7,
        expected: {"line":"中文 [[a]] 中文","cursorCh":10,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":7,"end":9,"origin":"中文"}]} },
      { name: "wikilink-alias", line: "中文[[a|别名]]中文", curCh: 11, prevCh: 10,
        expected: {"line":"中文[[a|别名]]中文","cursorCh":11,"changes":[]} },
      { name: "mdlink-smart", line: "中文[a](b)中文", curCh: 9, prevCh: 8,
        expected: {"line":"中文 [a](b) 中文","cursorCh":11,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":8,"end":10,"origin":"中文"}]} },
      { name: "link-strict-nonsmart", line: "中文[[a]]中文", curCh: 8, prevCh: 7,
        settings: {"InlineLinkSmartSpace":false,"InlineLinkSpaceMode":2},
        expected: {"line":"中文 [[a]] 中文","cursorCh":10,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":7,"end":9,"origin":"中文"}]} },
      { name: "code-mode-none", line: "中文`a`", curCh: 5, prevCh: 4,
        settings: {"InlineCodeSpaceMode":0},
        expected: {"line":"中文`a`","cursorCh":5,"changes":[]} },
      { name: "code-mode-strict", line: "中文`a`", curCh: 5, prevCh: 4,
        settings: {"InlineCodeSpaceMode":2},
        expected: {"line":"中文 `a`","cursorCh":6,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
      // ── #4 验收矩阵：行内间距三档 × code/formula/wikilink/mdlink（期望值
      // 经上游差异化验证 16/16 等价回填，out/test/diff4 复跑）──
      { name: "formula-mode-none", line: "中文$x$中文", curCh: 7, prevCh: 6,
        settings: {"InlineFormulaSpaceMode":0},
        expected: {"line":"中文$x$中文","cursorCh":7,"changes":[]} },
      { name: "formula-mode-strict", line: "中文，$x$中文", curCh: 8, prevCh: 7,
        settings: {"InlineFormulaSpaceMode":2},
        expected: {"line":"中文， $x$ 中文","cursorCh":10,"changes":[{"text":"中文， ","begin":0,"end":3,"origin":"中文，"},{"text":" 中文","begin":6,"end":8,"origin":"中文"}]} },
      { name: "formula-soft-end-punct-noop", line: "中文，$x$", curCh: 6, prevCh: 5,
        expected: {"line":"中文，$x$","cursorCh":6,"changes":[]} },
      { name: "wikilink-mode-none-nonsmart", line: "中文[[a]]中文", curCh: 8, prevCh: 7,
        settings: {"InlineLinkSmartSpace":false,"InlineLinkSpaceMode":0},
        expected: {"line":"中文[[a]]中文","cursorCh":8,"changes":[]} },
      { name: "wikilink-mode-none-smart", line: "中文[[a]]中文", curCh: 8, prevCh: 7,
        settings: {"InlineLinkSpaceMode":0},
        expected: {"line":"中文 [[a]] 中文","cursorCh":10,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":7,"end":9,"origin":"中文"}]} },
      { name: "wikilink-nonsmart-soft", line: "中文[[a]]中文", curCh: 8, prevCh: 7,
        settings: {"InlineLinkSmartSpace":false},
        expected: {"line":"中文 [[a]] 中文","cursorCh":10,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":7,"end":9,"origin":"中文"}]} },
      { name: "mdlink-mode-none-nonsmart", line: "中文[a](b)中文", curCh: 9, prevCh: 8,
        settings: {"InlineLinkSmartSpace":false,"InlineLinkSpaceMode":0},
        expected: {"line":"中文[a](b)中文","cursorCh":9,"changes":[]} },
      { name: "mdlink-mode-none-smart", line: "中文[a](b)中文", curCh: 9, prevCh: 8,
        settings: {"InlineLinkSpaceMode":0},
        expected: {"line":"中文 [a](b) 中文","cursorCh":11,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":8,"end":10,"origin":"中文"}]} },
      { name: "mdlink-mode-strict-nonsmart", line: "中文[a](b)中文", curCh: 9, prevCh: 8,
        settings: {"InlineLinkSmartSpace":false,"InlineLinkSpaceMode":2},
        expected: {"line":"中文 [a](b) 中文","cursorCh":11,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":8,"end":10,"origin":"中文"}]} },
      { name: "mdlink-nonsmart-soft", line: "中文[a](b)中文", curCh: 9, prevCh: 8,
        settings: {"InlineLinkSmartSpace":false},
        expected: {"line":"中文 [a](b) 中文","cursorCh":11,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文","begin":8,"end":10,"origin":"中文"}]} },
      // ── #4 验收矩阵：链接智能空格子分支 ──
      { name: "smart-revert-space", line: "中文 [[别名]]中文", curCh: 11, prevCh: 10,
        expected: {"line":"中文[[别名]]中文","cursorCh":10,"changes":[{"text":"中文","begin":0,"end":3,"origin":"中文 "}]} },
      { name: "smart-empty-link-both-sides", line: "中文[[]]中文", curCh: 8, prevCh: 7,
        expected: {"line":"中文[[]]中文","cursorCh":8,"changes":[]} },
      { name: "smart-link-end-punct-noinsert", line: "中文[[别名，]]中文", curCh: 11, prevCh: 10,
        expected: {"line":"中文[[别名，]]中文","cursorCh":11,"changes":[]} },
      { name: "link-strict-smart-precedence", line: "中文[[别名]]", curCh: 8, prevCh: 7,
        settings: {"InlineLinkSpaceMode":2},
        expected: {"line":"中文 [[别名]]","cursorCh":9,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
      // ── #4 验收矩阵：非 text 分区直接相邻（端到端）──
      { name: "code-formula-adjacent", line: "中文`a`$x$中文", curCh: 10, prevCh: 9,
        expected: {"line":"中文 `a` $x$ 中文","cursorCh":13,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" ","begin":5,"end":5,"origin":""},{"text":" 中文","begin":8,"end":10,"origin":"中文"}]} },
      { name: "code-link-adjacent", line: "中文`a`[[b]]中文", curCh: 12, prevCh: 11,
        expected: {"line":"中文 `a` [[b]] 中文","cursorCh":15,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" ","begin":5,"end":5,"origin":""},{"text":" 中文","begin":10,"end":12,"origin":"中文"}]} },
      { name: "soft-right-symbol", line: "中文+$a$", curCh: 6, prevCh: 5,
        settings: {"SoftSpaceRightSymbols":"+"},
        expected: {"line":"中文+ $a$","cursorCh":7,"changes":[{"text":"中文+ ","begin":0,"end":3,"origin":"中文+"}]} },
      { name: "br-tag", line: "中文<br>`a`", curCh: 9, prevCh: 8,
        expected: {"line":"中文<br>`a`","cursorCh":9,"changes":[]} },
      { name: "fmt-separated-star", line: "*A*中文", curCh: 5, prevCh: 4,
        expected: {"line":"*A*中文","cursorCh":5,"changes":[]} },
      { name: "fmt-separated-star-tail", line: "中文*A*", curCh: 5, prevCh: 4,
        expected: {"line":"中文*A*","cursorCh":5,"changes":[]} },
      { name: "fmt-separated-underscore", line: "_i_中文", curCh: 5, prevCh: 4,
        expected: {"line":"_i_中文","cursorCh":5,"changes":[]} },
      { name: "cursor-shift-on-insert", line: "中文abc", curCh: 3, prevCh: 2,
        expected: {"line":"中文 abc","cursorCh":4,"changes":[{"text":"中文 abc","begin":0,"end":5,"origin":"中文abc"}]} },
      { name: "cursor-at-line-start", line: "abc", curCh: 1, prevCh: 0,
        expected: {"line":"abc","cursorCh":1,"changes":[]} },
      { name: "mixed-parts-line", line: "中文`a`中文$x$中文", curCh: 11, prevCh: 10,
        expected: {"line":"中文 `a` 中文 $x$ 中文","cursorCh":15,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"},{"text":" 中文 ","begin":5,"end":7,"origin":"中文"},{"text":" 中文","begin":10,"end":12,"origin":"中文"}]} },
      { name: "escaped-dollar", line: "中文\\$5abc", curCh: 7, prevCh: 6,
        expected: {"line":"中文\\$5abc","cursorCh":7,"changes":[]} },
      { name: "zh-punct-context", line: "中文，abc", curCh: 5, prevCh: 4,
        expected: {"line":"中文，abc","cursorCh":5,"changes":[]} },
      { name: "dict-in-other-token", line: "n8n 中文abc", curCh: 9, prevCh: 8,
        expected: {"line":"n8n 中文abc","cursorCh":9,"changes":[]} },
      { name: "zh-en-first", line: "中文a", curCh: 3, prevCh: 2,
        expected: {"line":"中文 a","cursorCh":4,"changes":[{"text":"中文 a","begin":0,"end":3,"origin":"中文a"}]} },
      { name: "en-zh-first", line: "abc中", curCh: 4, prevCh: 3,
        expected: {"line":"abc 中","cursorCh":5,"changes":[{"text":"abc 中","begin":0,"end":4,"origin":"abc中"}]} },
      { name: "qquad-cursor-mid", line: "中文$\\qquad$中文", curCh: 6, prevCh: 5,
        expected: {"line":"中文$\\qquad$中文","cursorCh":0,"changes":[]} },
      { name: "enter-finalize-dict", line: "中文n8n", curCh: 5, prevCh: 5,
        expected: {"line":"中文n8n","cursorCh":5,"changes":[]} },
      // ── 纯标记符文段不参与行内元素间距（本仓有意偏差，见 #70）──
      // 报告案例：`/` 与行内代码、`**` 与双链/Markdown 链接之间不再补
      // 空格（补空格会破坏 Markdown 语法，如 `** [a](b) **` 粗体失效）
      { name: "marker-slash-code", line: "/`x`", curCh: 4, prevCh: 3,
        expected: {"line":"/`x`","cursorCh":4,"changes":[]} },
      { name: "marker-bold-wikilink", line: "**[[a]]", curCh: 7, prevCh: 6,
        expected: {"line":"**[[a]]","cursorCh":7,"changes":[]} },
      { name: "marker-bold-mdlink", line: "**[a](b)", curCh: 8, prevCh: 7,
        expected: {"line":"**[a](b)","cursorCh":8,"changes":[]} },
      { name: "marker-bold-code", line: "**`x`", curCh: 5, prevCh: 4,
        expected: {"line":"**`x`","cursorCh":5,"changes":[]} },
      { name: "marker-bold-wikilink-closed", line: "**[[a]]**", curCh: 9, prevCh: 8,
        expected: {"line":"**[[a]]**","cursorCh":9,"changes":[]} },
      { name: "marker-bold-mdlink-closed", line: "**[a](b)**", curCh: 10, prevCh: 9,
        expected: {"line":"**[a](b)**","cursorCh":10,"changes":[]} },
      { name: "marker-italic-wikilink", line: "*[[a]]", curCh: 6, prevCh: 5,
        expected: {"line":"*[[a]]","cursorCh":6,"changes":[]} },
      { name: "marker-slash-formula", line: "/$x$", curCh: 4, prevCh: 3,
        expected: {"line":"/$x$","cursorCh":4,"changes":[]} },
      // 字符类元字符（\ 与 |）各自命中，不被字符类转义吞掉
      { name: "marker-backslash-code", line: "\\`x`", curCh: 4, prevCh: 3,
        expected: {"line":"\\`x`","cursorCh":4,"changes":[]} },
      { name: "marker-pipe-wikilink", line: "|[[a]]", curCh: 6, prevCh: 5,
        expected: {"line":"|[[a]]","cursorCh":6,"changes":[]} },
      // 正文间距不受标记符规则影响（回归保护）
      { name: "marker-rule-keeps-cjk-code", line: "中文`a`", curCh: 5, prevCh: 4,
        expected: {"line":"中文 `a`","cursorCh":6,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
      { name: "marker-rule-keeps-cjk-wikilink", line: "中文[[a]]", curCh: 7, prevCh: 6,
        expected: {"line":"中文 [[a]]","cursorCh":8,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
      { name: "marker-rule-keeps-text-tail", line: "a**", curCh: 3, prevCh: 2,
        expected: {"line":"a**","cursorCh":3,"changes":[]} },
      // ── strict 档同样不得插空格（审查 PR73-001：抬成 soft 挡不住 strict）──
      // 三档一律硬跳过标记符边界，四类行内元素 × 前后标记符覆盖
      { name: "marker-strict-mdlink", line: "**[a](b)**", curCh: 10, prevCh: 9,
        settings: {"InlineCodeSpaceMode":2,"InlineFormulaSpaceMode":2,"InlineLinkSpaceMode":2},
        expected: {"line":"**[a](b)**","cursorCh":10,"changes":[]} },
      { name: "marker-strict-wikilink", line: "**[[a]]**", curCh: 9, prevCh: 8,
        settings: {"InlineCodeSpaceMode":2,"InlineFormulaSpaceMode":2,"InlineLinkSpaceMode":2},
        expected: {"line":"**[[a]]**","cursorCh":9,"changes":[]} },
      { name: "marker-strict-code", line: "**`x`**", curCh: 7, prevCh: 6,
        settings: {"InlineCodeSpaceMode":2,"InlineFormulaSpaceMode":2,"InlineLinkSpaceMode":2},
        expected: {"line":"**`x`**","cursorCh":7,"changes":[]} },
      { name: "marker-strict-formula", line: "**$x$**", curCh: 7, prevCh: 6,
        settings: {"InlineCodeSpaceMode":2,"InlineFormulaSpaceMode":2,"InlineLinkSpaceMode":2},
        expected: {"line":"**$x$**","cursorCh":7,"changes":[]} },
      { name: "marker-strict-code-tail", line: "`a`**", curCh: 5, prevCh: 4,
        settings: {"InlineCodeSpaceMode":2},
        expected: {"line":"`a`**","cursorCh":5,"changes":[]} },
      { name: "marker-strict-cjk-prefixed", line: "中文**[[a]]**", curCh: 11, prevCh: 10,
        settings: {"InlineCodeSpaceMode":2,"InlineFormulaSpaceMode":2,"InlineLinkSpaceMode":2},
        expected: {"line":"中文**[[a]]**","cursorCh":11,"changes":[]} },
      // 正文 strict 语义不变（对照：正文后仍补空格）
      { name: "marker-strict-keeps-cjk", line: "中文`a`", curCh: 5, prevCh: 4,
        settings: {"InlineCodeSpaceMode":2},
        expected: {"line":"中文 `a`","cursorCh":6,"changes":[{"text":"中文 ","begin":0,"end":2,"origin":"中文"}]} },
]

describe('formatLine 上游验证矩阵', () => {
  it('矩阵规模完整（108 场景，防止表被误删）', () => {
    expect(MATRIX.length).toBe(108)
    expect(new Set(MATRIX.map((e) => e.name)).size).toBe(108)
  })

  for (const entry of MATRIX) {
    it(entry.name, () => {
      const result = formatLine(
        entry.line,
        entry.curCh,
        entry.prevCh,
        applyOverrides(baseSettings(), entry.settings ?? {}),
        syntaxOf(entry.line),
      )
      expect(result).toEqual(entry.expected)
    })
  }
})

describe('formatLine 结构契约', () => {
  it('空白行早退：原样返回零变更', () => {
    expect(formatLine('   ', 3, 2, baseSettings(), syntaxOf('   '))).toEqual({ line: '   ', cursorCh: 3, changes: [] })
  })

  it('空行早退', () => {
    expect(formatLine('', 0, undefined, baseSettings(), syntaxOf(''))).toEqual({ line: '', cursorCh: 0, changes: [] })
  })

  it('变更表按 begin 升序（多分区行）', () => {
    const line = '中文' + String.fromCharCode(96) + 'a' + String.fromCharCode(96) + '中文'
    const result = formatLine(line, 6, 5, baseSettings(), syntaxOf(line))
    const begins = result!.changes.map((c) => c.begin)
    expect([...begins].sort((a, b) => a - b)).toEqual(begins)
    expect(result!.changes.length).toBeGreaterThan(0)
  })

  it('查询拒绝返回 null（不格式化——#5 拒绝语义）', () => {
    const fake = makeSyntaxFake('中文abc')
    const reject = { lineTypeAt: () => ({ ok: false as const, reason: 'read-only' as const }), inlineAt: () => ({ ok: false as const, reason: 'read-only' as const }) }
    expect(formatLine('中文abc', 5, 4, baseSettings(), { doc: fake.doc, query: reject, lineNumber: 1 })).toBeNull()
  })

  it('保护区注入缝：user 区段内不参与语言对加空格（#27 缝存在性证明）', () => {
    // 行内坐标 [2,5) 的保护区盖住 abc：文|a 边界落在保护区，不加空格
    const withGuard = formatLine('中文abc', 5, 4, baseSettings(), syntaxOf('中文abc'), {
      protectedRanges: [
        { begin: 2, end: 5, leftSpaceRequire: SpaceState.none, rightSpaceRequire: SpaceState.none },
      ],
    })
    expect(withGuard!.changes).toEqual([])
    expect(withGuard!.line).toBe('中文abc')
  })

  it('保护区右空格要求参与邻接判定（strict → 后继 text 前置空格）', () => {
    // 中文[abc] 后接 text：user 区段 rightSpaceRequire=strict(2) > text start none
    const result = formatLine('中文[abc]中文', 10, 9, baseSettings(), syntaxOf('中文[abc]中文'), {
      protectedRanges: [
        { begin: 2, end: 7, leftSpaceRequire: SpaceState.none, rightSpaceRequire: SpaceState.strict },
      ],
    })
    expect(result!.line).toBe('中文[abc] 中文')
  })
})
