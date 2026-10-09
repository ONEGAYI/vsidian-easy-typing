// onInput → 规则引擎触发管线（工单 #25）：把 #1 内核接进 vsidian 稳定
// 行为链——「执行面无需补 API」结论的落地层。
//
// 数据流：AddonInputContext（结构子集）→ TxContext（映射表见
// docs/specs/rule-engine.md「平台映射」节）→ RuleEngine.process（Input
// 类）→ ApplyResult → AddonBehaviorInputPlan（{changes, selection}）。
// 上游对照 rule_processor.ts triggerCvtRule 与 cm_extensions.ts
// tryProcessInput 的规则触发段；平台行为链已先行判定的门控（只读 / IME
// 组合中间态 / 表格格区 / 代码上下文 / paste·drop·undo）不在此重复。
//
// 【userEvent 原样保留在入口】区分普通键入（input.type）与 IME 定稿
// （input.type.compose）的信息不在此丢失——#6 compose 去重、#9 Delete/
// SelectKey、#26 格式化管线都从同一入口形状挂接。
//
// 【选区语义】快照 selections 不含主选区标记（平台 AddonEditorSnapshot
// 不携带 mainIndex）：管线取首个（最左）选区，上游取 asSingle().main
// ——单光标（主流形态）两者一致，多光标差异记录于规格。Input 类仅处理
// 塌缩选区（上游 notSelected 同口径；选区替换形态归 #9 SelectKey）。
// 计划 selection 为单一 {anchor, head}，平台按 EditorSelection.single
// 应用——命中即坍缩其余光标，与上游 dispatch 单选区行为等价。
import { RuleEngine, RuleType, type ApplyResult, type TxContext } from './rules/rule-engine'
import { detectScopeFromText } from './ruleScopeFallback'

/** 管线输入面：AddonInputContext 的结构子集（管线只消费这些字段） */
export interface RuleInputPipelineContext {
  readonly userEvent: string
  readonly inputText: string
  readonly snapshot: {
    readonly text: string
    readonly selections: ReadonlyArray<{ anchor: number; head: number }>
  }
}

/** 行为链修饰计划（对齐 AddonBehaviorInputPlan 的核心两件套；changes
 * 形状兼容 SerChange——length 恒显式携带） */
export interface RuleInputBehaviorPlan {
  changes: Array<{ offset: number; length: number; text: string }>
  selection: { anchor: number; head: number }
}

/** Input 类触发面：普通键入 + IME 定稿（delete.* 归 #9 Delete 管线） */
export function pipelineConsumesUserEvent(userEvent: string): boolean {
  return userEvent === 'input.type' || userEvent === 'input.type.compose'
}

/**
 * 单次输入的规则修饰计划：无命中返回 null（行为链照常，链上后续/平台
 * 原生不受影响）。纯函数——多族/多次调用间无共享状态，#6/#26 可无侵入
 * 包裹。
 */
export function planInputRuleModification(
  engine: RuleEngine,
  ctx: RuleInputPipelineContext,
  options: { debug?: boolean } = {},
): RuleInputBehaviorPlan | null {
  if (!pipelineConsumesUserEvent(ctx.userEvent)) return null
  const first = ctx.snapshot.selections[0]
  if (first === undefined) return null
  const from = Math.min(first.anchor, first.head)
  const to = Math.max(first.anchor, first.head)
  if (from !== to) return null // 非塌缩选区：Input 类不处理（SelectKey 归 #9）
  if (from > ctx.snapshot.text.length) return null // 防御：越界坐标不进引擎

  const scope = detectScopeFromText(ctx.snapshot.text, from)
  const tx: TxContext = {
    kind: RuleType.Input,
    docText: ctx.snapshot.text,
    selection: { from, to },
    inserted: ctx.inputText,
    changeType: ctx.userEvent,
    scopeHint: scope.scope,
    ...(scope.language !== undefined ? { scopeLanguage: scope.language } : {}),
    ...(options.debug === true ? { debug: true } : {}),
  }
  const result = engine.process(tx)
  if (result === null) return null
  return applyResultToPlan(result)
}

/**
 * ApplyResult → 行为链计划（matchRange + newText → changes；cursor →
 * selection）。#14 落地 $0 解析后 tabstop 组转多光标选区在此换算（规格
 * 「平台映射」节预留）。
 */
export function applyResultToPlan(result: ApplyResult): RuleInputBehaviorPlan {
  return {
    changes: [
      {
        offset: result.matchRange.from,
        length: result.matchRange.to - result.matchRange.from,
        text: result.newText,
      },
    ],
    selection: { anchor: result.cursor, head: result.cursor },
  }
}
