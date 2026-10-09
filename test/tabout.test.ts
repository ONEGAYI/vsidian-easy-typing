// Tabout 栈匹配算法矩阵（工单 #7，TDD 先行）——移植上游
// easy-typing-obsidian src/utils.ts:168-215（taboutCursorInPairedString）
// 与 src/main.ts:45-48（配对表）。纯逻辑零平台依赖，期望值按上游语义
// 逐例标注；接入层（EditorState 决策与 keymap Command）见
// test/taboutIntercept.test.ts。
import { describe, expect, it } from 'vitest'
import { TABOUT_PAIRS, taboutCursorInPairedString, type PairString } from '../src/taboutAlgorithm'

describe('配对表（上游 main.ts:45-48 移植）', () => {
  it('22 对与上游清单逐项一致（顺序保持原序——选中跳出嵌套取最外层依赖表序）', () => {
    expect(TABOUT_PAIRS).toEqual([
      { left: '【', right: '】' },
      { left: '（', right: '）' },
      { left: '《', right: '》' },
      { left: '“', right: '”' },
      { left: '‘', right: '’' },
      { left: '「', right: '」' },
      { left: '『', right: '』' },
      { left: "'", right: "'" },
      { left: '"', right: '"' },
      { left: '$$', right: '$$' },
      { left: '$', right: '$' },
      { left: '__', right: '__' },
      { left: '_', right: '_' },
      { left: '==', right: '==' },
      { left: '~~', right: '~~' },
      { left: '**', right: '**' },
      { left: '*', right: '*' },
      { left: '[[', right: ']]' },
      { left: '[', right: ']' },
      { left: '{', right: '}' },
      { left: '(', right: ')' },
      { left: '<', right: '>' },
    ] satisfies PairString[])
  })

  it('差异面在场：$ 与 < 是平台围栏 Tab 越界（vsidian #125）显式不登记的补位项', () => {
    // 平台 fenceEscape 不登记 $（行内公式无语法节点）与 <>（不自动补全）；
    // 其余 19 对与平台能力重叠——落穿层接入下平台先消费，本表自然让位。
    // 详见 docs/specs/tabout.md「平台 Tab 冲突核对」节。
    expect(TABOUT_PAIRS).toContainEqual({ left: '$', right: '$' })
    expect(TABOUT_PAIRS).toContainEqual({ left: '<', right: '>' })
  })
})

describe('栈匹配：22 对逐对紧贴跳出（光标紧贴闭合符左侧 → 跳闭合符之后）', () => {
  // input = <left>x<right>，光标在 x 与闭合符之间
  for (const { left, right } of TABOUT_PAIRS) {
    it(`${left}x␣${right} 紧贴 → 跳闭合符后`, () => {
      const input = `${left}x${right}`
      const cursor = left.length + 1
      expect(taboutCursorInPairedString(input, cursor, TABOUT_PAIRS)).toEqual({
        isSuccess: true,
        newPosition: cursor + right.length,
      })
    })
  }
})

describe('栈匹配：22 对逐对远距两步语义（闭合符不贴光标 → 先跳闭合符之前）', () => {
  // input = <left>xy<right>，光标在 x 后（与闭合符隔一个 y）
  for (const { left, right } of TABOUT_PAIRS) {
    it(`${left}x␣y 系远距 → 跳闭合符前`, () => {
      const input = `${left}xy${right}`
      expect(taboutCursorInPairedString(input, left.length + 1, TABOUT_PAIRS)).toEqual({
        isSuccess: true,
        newPosition: left.length + 2,
      })
    })
  }
})

describe('栈匹配：结构与边界语义', () => {
  it('无配对不命中', () => {
    expect(taboutCursorInPairedString('abcdef', 3, TABOUT_PAIRS)).toEqual({
      isSuccess: false,
      newPosition: 0,
    })
  })

  it('配对已闭合（光标在配对外）不命中', () => {
    expect(taboutCursorInPairedString('【x】', 4, TABOUT_PAIRS)).toEqual({
      isSuccess: false,
      newPosition: 0,
    })
  })

  it('嵌套取最内层闭合（【（x|）】 → 跳过 ））', () => {
    // 0=【 1=（ 2=x 3=） 4=】；光标 3 紧贴 ） → 跳到 4
    expect(taboutCursorInPairedString('【（x）】', 3, TABOUT_PAIRS)).toEqual({
      isSuccess: true,
      newPosition: 4,
    })
  })

  it('内层闭合后外层仍可跳（【（）|】 → 跳过 】）', () => {
    expect(taboutCursorInPairedString('【（）】', 3, TABOUT_PAIRS)).toEqual({
      isSuccess: true,
      newPosition: 4,
    })
  })

  it('自反符按出现顺序交替：*a|*b 命中（第二个 * 是闭合端）', () => {
    expect(taboutCursorInPairedString('*a*b', 2, TABOUT_PAIRS)).toEqual({
      isSuccess: true,
      newPosition: 3,
    })
  })

  it('光标后的单 $ 视为新开配对（上游保守语义：$ 货币/公式歧义）', () => {
    // $$x|$y：光标后的 $ 被 $|$ 对当作新 open 压入 tempStack，不构成
    // 闭合端 → 失败（上游行为，非缺陷——$ 单独出现有歧义）
    expect(taboutCursorInPairedString('$$x$y', 3, TABOUT_PAIRS)).toEqual({
      isSuccess: false,
      newPosition: 0,
    })
  })

  it('失配 close 忽略（【a)b|】 的 ) 无对应 open，跳过它跳 】）', () => {
    expect(taboutCursorInPairedString('【a)b】', 4, TABOUT_PAIRS)).toEqual({
      isSuccess: true,
      newPosition: 5,
    })
  })

  it('长度优先：[[a|]] 整对跳出（[[ 先于 [ 匹配，跳过 ]] 而非单个 ]）', () => {
    // sortedPairs 按 left 长度降序——若 [ 先试会错跳到位置 4
    expect(taboutCursorInPairedString('[[a]]', 3, TABOUT_PAIRS)).toEqual({
      isSuccess: true,
      newPosition: 5,
    })
  })

  it('光标在行首（cursor = 0）不命中', () => {
    expect(taboutCursorInPairedString('【x】', 0, TABOUT_PAIRS)).toEqual({
      isSuccess: false,
      newPosition: 0,
    })
  })

  it('空输入与空配对表安全失败', () => {
    expect(taboutCursorInPairedString('', 0, TABOUT_PAIRS)).toEqual({
      isSuccess: false,
      newPosition: 0,
    })
    expect(taboutCursorInPairedString('【x】', 2, [])).toEqual({
      isSuccess: false,
      newPosition: 0,
    })
  })
})
