// 规则引擎内核（工单 #1）——纯逻辑模块，零平台依赖。
//
// 移植自 easy-typing-obsidian v6.0.9（MIT，Yaozhuwa）src/rule_engine.ts，
// 匹配 / 替换 / 捕获组引用 / 作用域 / 优先级 / 正则缓存语义逐条对照移植。
//
// 【设计决策：作用域判定可注入】上游作用域限定依赖语法树（syntax.ts
// detectRuleScope 经 syntaxTree 判行类型）；vsidian live 编辑器的
// experimental.cm6.language.syntaxTree 恒为未解析空树（平台已知边界，见
// vsidian#406 诚实边界）。因此本内核不做任何语法树判定：TxContext 的
// scopeHint / scopeLanguage 由调用方注入——#25 行为链接入时传正则降级版
// 判定，#5 语法树版就绪后换传即可，内核零改动。
//
// 【与上游的刻意偏差】（其余逐行对照）：
// 1. Notice 剥离：上游三处 `new Notice(...)`（替换函数解析失败 / 非法正则 /
//    运行时异常节流上报）改为可注入的 reportError 回调（构造选项），
//    #25 宿主接入时映射到 i18n 通知通道；
// 2. TabstopSpec 就地定义：上游从 tabstop.ts 导入（该文件含 CM6 依赖），
//    本模块只保留纯数据形状；
// 3. 函数替换体预注册化（#17，vsidian#405 平台定案）：上游把 F 旗标规则
//    的函数体字符串经 `new Function` 动态编译；本内核删除该路径——附加
//    组件页面 CSP 不放行 unsafe-eval，动态构造必被拦截。等价能力改为
//    预注册函数表：SimpleRule.replacement 携带 `{kind:'function', ref}`
//    引用对象，装载时查表注入真函数（src/rules/function-table.ts）。未知
//    ref / 签名与规则类型不符 / 遗留字符串函数体一律拒绝装载并经
//    reportError 上报（死替换体兜底，规则不再命中）——取代 #25 时代的
//    CSP 静默降级（6 条 Input 函数体规则装载期整链失效的场景由此根治）。
//    用户自定义函数体由「规则组件化 fork」承接（ADR-0003）。
//
// 【#14 已接入】Tabstop 语法解析（$n / ${n:default} → TabstopSpec，含默认值
// 内嵌套 ${SEL}/${KEY} 展开与 number 升序排序）恢复上游 parseTabstops——
// newText 去标记、tabstops 填充、cursor 落最小编号占位符起点。分组导航的
// 执行归 #15。
//
// 【数据形状为 #25 预留】TxContext 对齐平台 AddonInputContext 的映射面：
// docText ↔ snapshot.text（LF 坐标）、selection ↔ 光标区间、changeType ↔
// userEvent、scopeHint/scopeLanguage ↔ 注入的行类型判定；ApplyResult 的
// matchRange/newText/cursor/tabstops 对齐行为链计划（changes + selection）。

import { FUNCTION_TABLE_BY_REF, signatureKindForRuleType, type FunctionTableEntry, type SelectKeyTransformFn, type TextTransformFn } from './function-table'

/** 引擎可消费的函数表形态（ref → 条目） */
export type FunctionTableLike = ReadonlyMap<string, FunctionTableEntry>

// ===== 枚举 =====

export enum RuleType {
  Input = 'input',
  Delete = 'delete',
  SelectKey = 'selectKey',
}

export enum RuleTriggerMode {
  Auto = 'auto',
  Tab = 'tab',
}

export enum RuleScope {
  Text = 'text',
  Formula = 'formula',
  Code = 'code',
  All = 'all',
}

// ===== 接口 =====

/** 占位符规格（纯数据形状；语法解析在本模块，分组导航归 #15） */
export interface TabstopSpec {
  number: number;
  from: number;
  to: number;
}

/**
 * 函数引用形态（#17）：F 旗标规则的 replacement 载体。票面
 * `{"replace":{"kind":"function","ref":"..."}}` 示例的字段化形态——
 * 规则 JSON 只存声明性数据与函数引用，函数本体在预注册函数表。
 */
export interface FunctionReplacementRef {
  kind: 'function';
  ref: string;
}

/** unknown → FunctionReplacementRef 形状校验（ref 非空字符串） */
export function isFunctionReplacementRef(value: unknown): value is FunctionReplacementRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return raw['kind'] === 'function' && typeof raw['ref'] === 'string' && raw['ref'].length > 0;
}

/** 规则的完整执行形态（由 SimpleRule 归一而来；函数替换体已解析为真函数） */
export interface ConvertRule {
  id: string;
  description: string;
  enabled: boolean;
  type: RuleType;
  triggerMode: RuleTriggerMode;
  triggerKeys?: string[];
  scope: RuleScope[];
  scopeLanguage?: string;
  regexFlags?: string;
  priority: number;
  match: {
    left: string;
    right: string;
    isRegex: boolean;
  };
  replacement: string | TextTransformFn | SelectKeyTransformFn;
}

/**
 * 规则的存储/序列化形态（内置数据与 #14 用户规则 JSON 的载体）。
 * replacement 为字符串字面量或函数引用对象（F 旗标 + 引用对象成对出现）。
 */
export interface SimpleRule {
  id?: string;
  trigger: string;
  trigger_right?: string;
  replacement: string | FunctionReplacementRef;
  /** 旗标串：d=Delete 类 s=SelectKey 类 T=Tab 触发 r=正则 F=函数替换体 t/f/c=作用域 a=全部 */
  options?: string;
  enabled?: boolean;
  description?: string;
  priority?: number;
  scope_language?: string;
  regex_flags?: string;
}

/** 触发上下文：由调用方组装（#25 行为链 / #9 删除与选中管线） */
export interface TxContext {
  kind: RuleType;
  docText: string;
  selection: { from: number; to: number };
  inserted: string;
  changeType: string;
  /** 光标处作用域判定（注入面——内核不做语法树判定，见模块头注） */
  scopeHint: RuleScope;
  scopeLanguage?: string;
  debug?: boolean;
  key?: string;
}

/** 命中结果：matchRange 为 LF 坐标的替换区间，对齐行为链计划 */
export interface ApplyResult {
  newText: string;
  cursor: number;
  tabstops: TabstopSpec[];
  matchRange: { from: number; to: number };
}

interface MatchInfo {
  leftMatches: string[];
  rightMatches: string[];
  matchRange: { from: number; to: number };
  selectionText?: string;
  key?: string;
}

interface CachedRegex {
  left: RegExp | null;
  right: RegExp | null;
}

/** 构造选项 */
export interface RuleEngineOptions {
  /**
   * 规则错误上报通道（上游为 Obsidian Notice）。收到即意味着该条规则被
   * 跳过或替换体不可用；#25 宿主接入时映射到 i18n 通知。
   */
  reportError?: (ruleId: string, message: string) => void;
  /**
   * 函数表注入（缺省组件内置表 FUNCTION_TABLE_BY_REF）。测试注入自定义
   * 表；规则组件化 fork 直接扩展 function-table.ts（见 ADR-0003），无需
   * 经此注入。
   */
  functionTable?: FunctionTableLike;
}

// ===== 工具 =====

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== RuleEngine =====

export class RuleEngine {
  private rulesById: Map<string, ConvertRule> = new Map();
  private sortedRules: ConvertRule[] = [];
  private ruleIdCounter: number = 0;
  private fnErrorLastNotify: Map<string, number> = new Map();
  private readonly reportError: ((ruleId: string, message: string) => void) | undefined;
  private readonly functionTable: FunctionTableLike;

  /** 编译后正则缓存：key 为 rule.id（含 null = 已知非法，避免反复编译） */
  private regexCache: Map<string, CachedRegex | null> = new Map();

  /** 「全部规则作用域含 All」惰性缓存（审查 C-P1-1：调用方据此跳过
   * 作用域计算——scopeHint 不参与命中判定时免全文扫描）；规则集变化
   *（add/remove/clear/update）置 null 失效 */
  private unscopedCache: boolean | null = null;

  constructor(options: RuleEngineOptions = {}) {
    this.reportError = options.reportError;
    this.functionTable = options.functionTable ?? FUNCTION_TABLE_BY_REF;
  }

  // ===== 静态工具 =====

  static parseOptions(options: string = ''): {
    type: RuleType;
    triggerMode: RuleTriggerMode;
    isRegex: boolean;
    isFunctionReplacement: boolean;
    scope: RuleScope[];
  } {
    const type = options.includes('d') ? RuleType.Delete
      : options.includes('s') ? RuleType.SelectKey
        : RuleType.Input;

    const triggerMode = options.includes('T') ? RuleTriggerMode.Tab
      : RuleTriggerMode.Auto;

    const isRegex = options.includes('r');

    const isFunctionReplacement = options.includes('F');

    const scope: RuleScope[] = [];
    if (options.includes('a') || (!options.includes('t') && !options.includes('f') && !options.includes('c'))) {
      scope.push(RuleScope.All);
    } else {
      if (options.includes('t')) scope.push(RuleScope.Text);
      if (options.includes('f')) scope.push(RuleScope.Formula);
      if (options.includes('c')) scope.push(RuleScope.Code);
    }

    return { type, triggerMode, isRegex, isFunctionReplacement, scope };
  }

  static normalizeRegexFlags(flags: string = ''): string {
    const normalized = flags.toLowerCase().replace(/[^imu]/g, '');
    return Array.from(new Set(normalized.split(''))).sort((a, b) => 'imu'.indexOf(a) - 'imu'.indexOf(b)).join('');
  }

  /**
   * 保存 SimpleRule 前校验正则：合法返回 null，非法返回错误信息。
   * （#14 用户规则编辑链路消费）
   */
  static validateRegex(rule: SimpleRule): string | null {
    const opts = RuleEngine.parseOptions(rule.options);
    if (!opts.isRegex) return null;
    const regexFlags = RuleEngine.normalizeRegexFlags(rule.regex_flags);

    const leftPattern = rule.trigger;
    const rightPattern = rule.trigger_right ?? '';

    if (leftPattern) {
      try {
        new RegExp('(?:' + leftPattern + ')', regexFlags);
      } catch (e) {
        return `trigger: ${(e as Error).message}`;
      }
    }
    if (rightPattern) {
      try {
        new RegExp('(?:' + rightPattern + ')', regexFlags);
      } catch (e) {
        return `trigger_right: ${(e as Error).message}`;
      }
    }
    return null;
  }

  /**
   * 真实控制字符转可见转义序列（UI 展示用，escapeText 的逆）。
   */
  static escapeText(text: string, preserveBackslashes: boolean = false): string {
    let result = text;
    if (!preserveBackslashes) {
      result = result.replace(/\\/g, '\\\\');
    }
    return result
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r');
  }

  /**
   * 替换体中的转义序列还原：\n → 换行、\t → 制表、\r → CR、\\\\ → 反斜杠。
   * TS 源码里已是真实换行的字符串不受影响。
   */
  static unescapeText(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length) {
        switch (text[i + 1]) {
          case 'n': result += '\n'; i++; break;
          case 't': result += '\t'; i++; break;
          case 'r': result += '\r'; i++; break;
          case '\\': result += '\\'; i++; break;
          default: result += text[i]; break;
        }
      } else {
        result += text[i];
      }
    }
    return result;
  }

  /** SelectKey 规则触发键序列解析：逐字符切分，反斜杠转义还原 */
  static parseSelectKeyRuleTriggerKeys(pattern: string): string[] {
    const keys: string[] = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '\\' && i + 1 < pattern.length) {
        keys.push(pattern[i + 1]);
        i++;
      } else {
        keys.push(pattern[i]);
      }
    }
    return keys;
  }

  /**
   * F 旗标替换体解析（#17 预注册形态）：函数引用对象查表注入真函数；
   * 以下三种形态拒绝装载（死替换体兜底 + reportError）——未知 ref、
   * 签名种类与规则类型不符、遗留字符串函数体（`new Function` 路径已
   * 删除，CSP 平台动态构造必炸，保留只会制造静默降级）。
   */
  static resolveFunctionReplacement(
    replacement: SimpleRule['replacement'],
    type: RuleType,
    table: FunctionTableLike,
  ): { fn: TextTransformFn | SelectKeyTransformFn } | { error: string } {
    if (typeof replacement === 'string') {
      return {
        error:
          `function body strings are no longer supported (page CSP blocks dynamic code); ` +
          `use {"kind":"function","ref":"<id>"} instead (fork the component for custom functions)`,
      };
    }
    const entry = table.get(replacement.ref);
    if (!entry) return { error: `unknown function ref "${replacement.ref}"` };
    const want = signatureKindForRuleType(type);
    if (entry.signature !== want) {
      return {
        error: `function ref "${replacement.ref}" expects ${entry.signature} signature but rule type "${type}" requires ${want}`,
      };
    }
    return { fn: entry.fn };
  }

  static normalizeRule(
    simple: SimpleRule,
    reportError?: (ruleId: string, message: string) => void,
    functionTable: FunctionTableLike = FUNCTION_TABLE_BY_REF,
  ): Omit<ConvertRule, 'id'> {
    const opts = RuleEngine.parseOptions(simple.options);

    // 替换体归一（#17 预注册形态）：
    // - F 旗标 → 函数引用查表注入（解析失败拒绝装载，死替换体兜底）；
    // - 非 F 旗标却携带引用对象 → 形态失配，同样拒绝装载（外部脏数据防御）；
    // - 其余 → 字符串字面量原样。
    let replacement: ConvertRule['replacement'];
    if (opts.isFunctionReplacement) {
      const resolved = RuleEngine.resolveFunctionReplacement(
        simple.replacement,
        opts.type,
        functionTable,
      );
      if ('fn' in resolved) {
        replacement = resolved.fn;
      } else {
        console.error(
          `[RuleEngine] Failed to resolve function for rule "${simple.id ?? '?'}": ${resolved.error}`,
        );
        replacement = (): undefined => undefined;
        reportError?.(simple.id ?? '?', resolved.error);
      }
    } else if (isFunctionReplacementRef(simple.replacement)) {
      console.error(
        `[RuleEngine] Function ref replacement without F flag in rule "${simple.id ?? '?'}"`,
      );
      replacement = (): undefined => undefined;
      reportError?.(simple.id ?? '?', 'function ref replacement requires the F option flag');
    } else {
      replacement = simple.replacement;
    }

    if (opts.type === RuleType.SelectKey) {
      return {
        description: simple.description ?? '',
        enabled: simple.enabled ?? true,
        type: RuleType.SelectKey,
        triggerMode: RuleTriggerMode.Auto,
        triggerKeys: RuleEngine.parseSelectKeyRuleTriggerKeys(simple.trigger),
        scope: opts.scope,
        scopeLanguage: simple.scope_language,
        regexFlags: undefined,
        priority: simple.priority ?? 100,
        match: { left: '', right: '', isRegex: false },
        replacement,
      };
    }

    // T 触发模式仅对 Input 类有意义；Delete 类强制 Auto
    const triggerMode = opts.type === RuleType.Input
      ? opts.triggerMode
      : RuleTriggerMode.Auto;

    return {
      description: simple.description ?? '',
      enabled: simple.enabled ?? true,
      type: opts.type,
      triggerMode,
      triggerKeys: undefined,
      scope: opts.scope,
      scopeLanguage: simple.scope_language,
      regexFlags: opts.isRegex ? RuleEngine.normalizeRegexFlags(simple.regex_flags) : undefined,
      priority: simple.priority ?? 100,
      match: {
        left: simple.trigger,
        right: simple.trigger_right ?? '',
        isRegex: opts.isRegex,
      },
      replacement,
    };
  }

  // ===== 规则管理 =====

  private generateId(): string {
    return `rule-${++this.ruleIdCounter}`;
  }

  private insertSorted(rule: ConvertRule): void {
    let lo = 0, hi = this.sortedRules.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      // priority <= rule.priority：同优先级排在既有规则之后（注册序）
      if (this.sortedRules[mid].priority <= rule.priority) lo = mid + 1;
      else hi = mid;
    }
    this.sortedRules.splice(lo, 0, rule);
  }

  addRule(rule: Omit<ConvertRule, 'id'> & { id?: string }): string {
    const id = rule.id ?? this.generateId();
    const fullRule: ConvertRule = { ...rule, id };
    this.rulesById.set(id, fullRule);
    this.insertSorted(fullRule);
    this.unscopedCache = null;
    return id;
  }

  addSimpleRule(simple: SimpleRule): string {
    const normalized = RuleEngine.normalizeRule(simple, this.reportError, this.functionTable);
    return this.addRule({ ...normalized, id: simple.id });
  }

  addSimpleRules(rules: SimpleRule[]): string[] {
    return rules.map(r => this.addSimpleRule(r));
  }

  removeRule(id: string): boolean {
    if (!this.rulesById.has(id)) return false;
    this.rulesById.delete(id);
    this.regexCache.delete(id);
    this.unscopedCache = null;
    const idx = this.sortedRules.findIndex(r => r.id === id);
    if (idx !== -1) this.sortedRules.splice(idx, 1);
    return true;
  }

  updateRule(id: string, patch: Partial<Omit<ConvertRule, 'id'>>): boolean {
    const existing = this.rulesById.get(id);
    if (!existing) return false;

    // 匹配面 / 类型 / flags 变化 → 正则缓存失效
    if (patch.match !== undefined || patch.type !== undefined || patch.regexFlags !== undefined) {
      this.regexCache.delete(id);
    }
    // 作用域变化 → 全 All 短路缓存失效
    if (patch.scope !== undefined) {
      this.unscopedCache = null;
    }

    const priorityChanged = patch.priority !== undefined && patch.priority !== existing.priority;
    Object.assign(existing, patch);

    if (priorityChanged) {
      const idx = this.sortedRules.findIndex(r => r.id === id);
      if (idx !== -1) this.sortedRules.splice(idx, 1);
      this.insertSorted(existing);
    }
    return true;
  }

  setEnabled(id: string, enabled: boolean): void {
    const rule = this.rulesById.get(id);
    if (rule) rule.enabled = enabled;
  }

  getRules(): readonly ConvertRule[] {
    return this.sortedRules;
  }

  /**
   * 全部在册规则的作用域均含 All（或规则集为空）——process 对 scopeHint
   * 的过滤不参与任何命中判定（`scopeHint !== All && !rule.scope.includes(All)
   * && ...` 对含 All 规则恒短路），调用方可跳过作用域计算直接传
   * scopeHint = All（审查 C-P1-1 的 All 短路位）。惰性缓存，规则集变化
   * 时失效。
   */
  allRulesUnscoped(): boolean {
    if (this.unscopedCache === null) {
      this.unscopedCache = this.sortedRules.every(r => r.scope.includes(RuleScope.All));
    }
    return this.unscopedCache;
  }

  getRulesByType(type: RuleType): ConvertRule[] {
    return this.sortedRules.filter(r => r.type === type);
  }

  getRule(id: string): ConvertRule | undefined {
    return this.rulesById.get(id);
  }

  clear(): void {
    this.rulesById.clear();
    this.sortedRules = [];
    this.regexCache.clear();
    this.unscopedCache = null;
  }

  loadFromFiles(builtinRules: SimpleRule[], userRules: SimpleRule[]): void {
    this.clear();
    this.addSimpleRules(builtinRules);
    this.addSimpleRules(userRules);
  }

  // ===== 正则缓存 =====

  /**
   * 取或编译规则的缓存正则，避免每次输入重新编译。
   * 左正则尾部拼接 (?![\s\S])：命中必须延伸到左文末尾（刚键入的字符在
   * 匹配范围内）；编译失败缓存 null 并上报，规则视为不可用。
   */
  private getCachedRegex(rule: ConvertRule): CachedRegex | null {
    const existing = this.regexCache.get(rule.id);
    if (existing !== undefined) return existing;

    const leftPattern = rule.match.isRegex
      ? rule.match.left
      : escapeRegex(rule.match.left);
    const rightPattern = rule.match.isRegex
      ? rule.match.right
      : escapeRegex(rule.match.right);

    const regexFlags = rule.match.isRegex ? RuleEngine.normalizeRegexFlags(rule.regexFlags) : '';
    try {
      const cached: CachedRegex = {
        left: leftPattern ? new RegExp('(?:' + leftPattern + ')(?![\\s\\S])', regexFlags) : null,
        // 右正则 sticky 锚定串首：matchAtStart 只要 index===0 的匹配，y 标志
        // 免去非锚定 exec 的全文线性扫描（审查第 4 轮 C-R4-3；m 标志下
        // ^ 会错放宽到行首，y 与「仅串首」严格等价）
        right: rightPattern ? new RegExp('(?:' + rightPattern + ')', regexFlags + 'y') : null,
      };
      this.regexCache.set(rule.id, cached);
      return cached;
    } catch (e) {
      console.error(`[RuleEngine] Invalid regex in rule "${rule.id}":`, e);
      this.reportError?.(rule.id, `invalid regex: ${(e as Error).message}`);
      this.regexCache.set(rule.id, null);
      return null;
    }
  }

  // ===== 模板展开 =====

  private expandVariables(text: string, match: MatchInfo): string {
    // [[Rn]] → 右正则捕获组（须先于 [[n]] 处理，避免 [[R1]] 被 [[n]] 吞掉）
    text = text.replace(/\[\[R(\d+)\]\]/g, (_, n) => {
      const idx = parseInt(n);
      return match.rightMatches[idx] ?? '';
    });

    // [[n]] → 左正则捕获组，缺省回退右组
    text = text.replace(/\[\[(\d+)\]\]/g, (_, n) => {
      const idx = parseInt(n);
      return match.leftMatches[idx] ?? match.rightMatches[idx] ?? '';
    });

    // 独立 ${SEL} 与 ${KEY}（SelectKey 类）
    if (match.selectionText !== undefined) {
      text = text.replace(/\$\{SEL\}/g, match.selectionText);
    }
    if (match.key !== undefined) {
      text = text.replace(/\$\{KEY\}/g, match.key);
    }

    return text;
  }

  // ===== 占位符解析（#14 恢复上游 parseTabstops） =====

  /** 花括号深度配平：返回与 openIdx 的 `{` 配对的 `}` 下标，未闭合 -1 */
  private findMatchingBrace(text: string, openIdx: number): number {
    let depth = 1
    for (let i = openIdx + 1; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) return i }
    }
    return -1
  }

  /**
   * 占位符语法解析：`$n` 与 `${n:default}` 展开为 TabstopSpec 并从文本去
   * 标记。from/to 为文档绝对坐标（baseOffset + 已产出文本长度），默认值内
   * 嵌套的 ${SEL}/${KEY} 在此展开；未闭合 ${ 与非占位 $ 保留字面。产出按
   * number 升序排序（$0 最前——cursor 落 tabstops[0].from）。
   */
  private parseTabstops(
    text: string,
    baseOffset: number,
    match?: MatchInfo,
  ): [string, TabstopSpec[]] {
    const tabstops: TabstopSpec[] = []
    let result = ''
    let i = 0

    while (i < text.length) {
      if (text[i] === '$') {
        // ${n:default} 形式
        if (i + 1 < text.length && text[i + 1] === '{') {
          const closeIdx = this.findMatchingBrace(text, i + 1)
          if (closeIdx === -1) { result += text[i]; i++; continue }

          const inner = text.substring(i + 2, closeIdx)
          const colonIdx = inner.indexOf(':')

          let num: number
          let defaultVal: string

          if (colonIdx > -1) {
            num = parseInt(inner.substring(0, colonIdx))
            defaultVal = inner.substring(colonIdx + 1)
            // 默认值内嵌套变量展开（上游同序：SEL 先于 KEY）
            if (match?.selectionText !== undefined)
              defaultVal = defaultVal.replace(/\$\{SEL\}/g, match.selectionText)
            if (match?.key !== undefined)
              defaultVal = defaultVal.replace(/\$\{KEY\}/g, match.key)
          } else {
            num = parseInt(inner)
            defaultVal = ''
          }

          const from = baseOffset + result.length
          result += defaultVal
          const to = baseOffset + result.length
          tabstops.push({ number: num, from, to })
          i = closeIdx + 1
        }
        // $n 形式（空占位区间）
        else if (i + 1 < text.length && /\d/.test(text[i + 1])) {
          let numStr = ''
          let j = i + 1
          while (j < text.length && /\d/.test(text[j])) { numStr += text[j]; j++ }
          const num = parseInt(numStr)
          const pos = baseOffset + result.length
          tabstops.push({ number: num, from: pos, to: pos })
          i = j
        }
        else { result += text[i]; i++ }
      }
      else { result += text[i]; i++ }
    }

    // number 升序排序（$0 最前——cursor 取 tabstops[0].from）
    tabstops.sort((a, b) => a.number - b.number)

    return [result, tabstops]
  }

  // ===== 规则执行 =====

  private notifyFunctionError(ruleId: string, error: unknown): void {
    const now = Date.now();
    const last = this.fnErrorLastNotify.get(ruleId) ?? 0;
    if (now - last > 5000) {
      this.fnErrorLastNotify.set(ruleId, now);
      const msg = error instanceof Error ? error.message : String(error);
      this.reportError?.(ruleId, `runtime error: ${msg}`);
    }
    console.error(`[RuleEngine] Runtime error in rule "${ruleId}":`, error);
  }

  process(ctx: TxContext): ApplyResult | null {
    // 左右文惰性单次预切（审查第 4 轮 C-R4-3）：同一事务所有规则共享同一份
    // 切片——替代循环内每规则重复 slice 的 O(规则数 × 文档长) 复制
    const sliced: { left?: string; right?: string } = {};
    for (const rule of this.sortedRules) {
      if (!rule.enabled) continue;
      if (rule.type !== ctx.kind) continue;
      if (rule.triggerMode === RuleTriggerMode.Tab && ctx.changeType !== 'tab') continue;
      if (rule.triggerMode === RuleTriggerMode.Auto && ctx.changeType === 'tab') continue;

      // 作用域检查：任一侧 All 即「不限制」
      if (ctx.scopeHint !== RuleScope.All && !rule.scope.includes(RuleScope.All) && !rule.scope.includes(ctx.scopeHint)) continue;
      // 语言过滤仅在代码作用域内生效：Text+Code(py) 混合作用域仍可匹配
      // 普通文本，进入 Code 作用域才要求配置语言
      if (
        rule.scopeLanguage &&
        ctx.scopeHint === RuleScope.Code &&
        rule.scope.includes(RuleScope.Code) &&
        ctx.scopeLanguage !== rule.scopeLanguage
      ) continue;

      switch (ctx.kind) {
        case RuleType.SelectKey: {
          if (!rule.triggerKeys?.includes(ctx.key!)) continue;
          const result = this.applySelectKeyRule(rule, ctx);
          if (result) {
            if (ctx.debug) console.log('[RuleEngine] hit:', rule.id, rule.description);
            return result;
          }
          break;
        }
        default: {
          // Input 与 Delete 共用左右匹配路径（Delete 触发管线归 #9）
          const result = this.matchAndApplyTextRule(rule, ctx, sliced);
          if (result) {
            if (ctx.debug) console.log('[RuleEngine] hit:', rule.id, rule.description);
            return result;
          }
          break;
        }
      }
    }
    return null;
  }

  private matchAndApplyTextRule(
    rule: ConvertRule,
    ctx: TxContext,
    sliced: { left?: string; right?: string },
  ): ApplyResult | null {
    const { from, to } = ctx.selection;
    // 事务级共享切片（C-R4-3）：首个到达的规则付一次 O(L)，其余规则复用
    const leftDoc = (sliced.left ??= ctx.docText.slice(0, from));
    const rightDoc = (sliced.right ??= ctx.docText.slice(to));

    const cached = this.getCachedRegex(rule);
    if (!cached) return null; // 非法正则，跳过
    const leftRegex = cached.left;
    const rightRegex = cached.right;

    const leftMatch = leftRegex ? leftRegex.exec(leftDoc) : [''];
    const rightMatch = rightRegex ? this.matchAtStart(rightDoc, rightRegex) : [''];
    if (!leftMatch || !rightMatch) return null;

    const matchFrom = from - leftMatch[0].length;
    const matchTo = to + rightMatch[0].length;

    return this.applyReplacement(rule, {
      leftMatches: [...leftMatch],
      rightMatches: [...rightMatch],
      matchRange: { from: matchFrom, to: matchTo },
    }, ctx);
  }

  private matchAtStart(doc: string, regex: RegExp): RegExpMatchArray | null {
    regex.lastIndex = 0;
    const match = regex.exec(doc);
    if (!match || match.index !== 0) return null;
    return match;
  }

  private applySelectKeyRule(rule: ConvertRule, ctx: TxContext): ApplyResult | null {
    const selectionText = ctx.docText.slice(ctx.selection.from, ctx.selection.to);

    return this.applyReplacement(rule, {
      leftMatches: [],
      rightMatches: [],
      matchRange: ctx.selection,
      selectionText,
      key: ctx.key!,
    }, ctx);
  }

  private applyReplacement(
    rule: ConvertRule,
    match: MatchInfo,
    _ctx: TxContext,
  ): ApplyResult | null {
    let text: string;

    if (typeof rule.replacement === 'function') {
      try {
        if (rule.type === RuleType.SelectKey) {
          const fn = rule.replacement as (sel: string, key: string) => string | void;
          const result = fn(match.selectionText!, match.key!);
          if (result === undefined) return null;
          text = result as string;
        } else {
          const fn = rule.replacement as (l: string[], r: string[]) => string | void;
          const result = fn(match.leftMatches, match.rightMatches);
          if (result === undefined) return null;
          text = result as string;
        }
      } catch (e) {
        this.notifyFunctionError(rule.id, e);
        return null;
      }
    } else {
      text = rule.replacement;
    }

    // 替换体反转义 \n / \t / \r / \\
    text = RuleEngine.unescapeText(text);

    // 展开 [[n]]、[[Rn]]、独立 ${SEL}、${KEY}
    text = this.expandVariables(text, match);

    // 占位符解析（#14 恢复上游）：newText 去标记、tabstops 填充，
    // cursor 落最小编号占位符起点；无占位符时取替换区间起点 + 文本长度
    const [finalText, tabstops] = this.parseTabstops(text, match.matchRange.from, match);

    const cursor = tabstops.length > 0
      ? tabstops[0].from
      : match.matchRange.from + finalText.length;

    return {
      newText: finalText,
      cursor,
      tabstops,
      matchRange: match.matchRange,
    };
  }
}
