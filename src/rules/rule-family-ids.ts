// 规则族种子的数据面（工单 #50 抽取）：localId、覆盖的内置规则 id 集与
// 用户规则触发类归族。此前定义在 src/ruleBehaviorIntercept.ts（注册侧），
// #50 规则页灰态判定需要「规则 → 覆盖行为族」的同一映射——单一事实源
// 落本模块（纯数据 + 纯函数，零平台依赖），注册侧 import 数据在此附加
// i18n 键组装，规则页直接消费 coveringBehaviorLocalIds。
//
// 【灰态语义（ADR-0016 两层禁用口径的组件侧消费）】宿主行为管理以行为
// （族）为粒度逐项禁用；规则条目与行为族是多对多关系——内置规则按种子
// ruleIds 归单族，用户规则按触发类归族（Input 类并入全部五个 Input 族，
// 每族一份实例；Delete → 06；SelectKey → 07，与 resolveRuleFamilies 归族
// 口径一致）。条目灰态判定 = 覆盖族**全部**被宿主禁用（任一族在场即可
// 触发，全禁才是真正不生效）。
import { RuleEngine, RuleType, type SimpleRule } from './rule-engine'

/** 规则族种子数据面（localId 数值前缀编码默认链序，i18n 键归注册侧） */
export interface RuleFamilySeedData {
  readonly localId: string
  readonly ruleIds: readonly string[]
  readonly userRuleType: RuleType
}

/** #25 五个 Input 族种子（上游优先级 3/5+10/10/15/50） */
export const RULE_INPUT_FAMILY_SEEDS: readonly RuleFamilySeedData[] = [
  // 上游优先级 3：连续全角标点转半角
  {
    localId: '01-punct-collapse',
    ruleIds: ['builtin-fw2hw-double'],
    userRuleType: RuleType.Input,
  },
  // 上游优先级 5：配对跳过（配对补全 builtin-autopair-input 已随 #56 清退，
  // 平台符号补全兜底；引用其函数表的用户规则仍归本族）
  {
    localId: '02-autopair',
    ruleIds: ['builtin-autopair-jump'],
    userRuleType: RuleType.Input,
  },
  // 上游优先级 10：·· 转行内代码 / `· 升级代码块 / ￥$ 转公式 / 行首 》、 转换
  {
    localId: '03-symbol-convert',
    ruleIds: [
      'builtin-conv-backtick',
      'builtin-conv-codeblock',
      'builtin-conv-formula',
      'builtin-conv-linestart',
    ],
    userRuleType: RuleType.Input,
  },
  // 上游优先级 15：CJK 后半角标点转全角（上游数据默认关）
  {
    localId: '04-punct-expand',
    ruleIds: ['builtin-conv-hw2fw'],
    userRuleType: RuleType.Input,
  },
  // 上游优先级 50：引用标记转换与补空格
  {
    localId: '05-quote',
    ruleIds: ['builtin-quote-convert', 'builtin-quote-space'],
    userRuleType: RuleType.Input,
  },
]

/** #9 Delete/SelectKey 族种子（上游优先级 10+30 / 40；编号延续分层编码） */
export const RULE_DELETE_SELECTKEY_FAMILY_SEEDS: readonly RuleFamilySeedData[] = [
  // 上游优先级 10（autopair-delete）+ 30（五条联动删除）：删除成对结构一端时联动删除
  {
    localId: '06-delete-rules',
    ruleIds: [
      'builtin-autopair-delete',
      'builtin-del-inline-formula',
      'builtin-del-highlight',
      'builtin-del-block-formula',
      'builtin-del-codeblock',
      'builtin-del-wikilink',
    ],
    userRuleType: RuleType.Delete,
  },
  // 上游优先级 40：选中文本后按键包裹
  {
    localId: '07-selectkey-rules',
    ruleIds: [
      'builtin-sel-wrap-backtick',
      'builtin-sel-wrap-symbols',
      'builtin-sel-wrap-quotes',
    ],
    userRuleType: RuleType.SelectKey,
  },
]

/** 全部规则族种子（01–07，默认链序） */
export const ALL_RULE_FAMILY_SEEDS: readonly RuleFamilySeedData[] = [
  ...RULE_INPUT_FAMILY_SEEDS,
  ...RULE_DELETE_SELECTKEY_FAMILY_SEEDS,
]

/** 按触发类收族（用户规则归族口径；内置规则查表未命中时的防御回退同径） */
function seedsByType(type: RuleType): string[] {
  return ALL_RULE_FAMILY_SEEDS.filter((seed) => seed.userRuleType === type).map((seed) => seed.localId)
}

/**
 * 规则 → 覆盖它的行为族 localId 集（#50 规则页灰态判定输入）：
 * - 内置规则按种子 ruleIds 查表（单族；查表未命中回退按触发类归族——
 *   契约测试钉住出厂内置规则全覆盖，回退仅为防御深度）；
 * - 用户规则按触发类归族（Input → 五个 Input 族、Delete → 06、
 *   SelectKey → 07）。
 * 灰态判定 = 返回集**全部**成员被宿主禁用（见模块头注）。
 */
export function coveringBehaviorLocalIds(rule: SimpleRule, isBuiltin: boolean): string[] {
  const ruleId = rule.id
  if (isBuiltin && ruleId !== undefined) {
    const hits = ALL_RULE_FAMILY_SEEDS.filter((seed) => seed.ruleIds.includes(ruleId)).map(
      (seed) => seed.localId,
    )
    if (hits.length > 0) return hits
  }
  return seedsByType(RuleEngine.parseOptions(rule.options).type)
}
