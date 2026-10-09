// 内置规则数据（工单 #1）——上游 easy-typing-obsidian v6.0.9
// src/default_rules.ts 全量原样移植（纯数据，零平台依赖）。
//
// 计数口径：上游实测 20 条（default_rules.ts 的 id 与六语言包
// builtinRuleDescriptions 键集一致），票面「22 条」为计数偏差，按全量
// 口径移植（见 docs/specs/rule-engine.md 已知边界）。
//
// 【#17 函数引用形态】上游 10 条函数体规则（F 旗标 + 函数体字符串）在此
// 迁移为函数引用：replacement 为 `{kind:'function', ref:'<id>'}`，函数本体
// 是 src/rules/function-table.ts 内的真函数（逐条语义对照，ref 映射表见
// 该模块头注）。平台 CSP 不放行 unsafe-eval，new Function 动态构造必被
// 拦截——引用形态是函数替换体在本平台的唯一装载形态（ADR-0002）。
// 匹配面（trigger/trigger_right/regex_flags）、优先级、描述与其余规则
// 仍为上游数据逐字段原样。
//
// description 为上游数据原样保留（中文）；展示层本地化沿用上游模式——
// 以规则 id 为键映射语言包 builtinRuleDescriptions（归 #19 i18n 完整化），
// 本模块不承载用户可见渲染。
//
// 内置规则逐条开关走平台「行为冲突管理」（行为注册粒度），本模块的
// enabled 字段是数据态默认值，不自建开关 UI（口径见工单 #1）。
import type { SimpleRule } from './rule-engine'

// 优先级分层（数字越小越优先）:
//   10: 自动配对 + 基础转换
//   15: 半角转全角（CJK字符后）
//   20: 全角转半角（连续两个全角标点）
//   30: 删除配对
//   40: 选中替换
//   50: 引用处理
//   100+: 用户自定义规则

export const DEFAULT_BUILTIN_RULES: (SimpleRule & { id: string })[] = [
  // ===== 自动配对 (priority 10) =====
  {
    id: 'builtin-autopair-input',
    trigger: '[（《「『“”‘’《]',
    replacement: { kind: 'function', ref: 'autopairInput' },
    options: 'rF',
    priority: 10,
    description: '输入全角括号/引号时自动补全配对',
  },
  {
    id: 'builtin-autopair-jump',
    trigger: "《》|“”|““|‘’|‘‘|（）",
    trigger_right: "》|”|’|）",
    replacement: { kind: 'function', ref: 'autopairJump' },
    options: 'rF',
    priority: 5,
    description: '输入右侧配对符号时自动跳过，避免重复插入'
  },
  {
    id: 'builtin-autopair-delete',
    trigger: "[【（《「『“‘]",
    trigger_right: "[】）》」』”’]",
    replacement: { kind: 'function', ref: 'autopairDelete' },
    options: 'drF',
    priority: 10,
    description: '删除全角括号/引号时同时删除配对',
  },

  // ===== 基础转换 (priority 10) =====
  { id: 'builtin-conv-backtick', trigger: '··', replacement: '`$0`', priority: 10, description: '连续中文间隔号 ·· 转行内代码' },
  {
    id: 'builtin-conv-codeblock',
    trigger: '(?<=^|\\n)([ \\t]*)`·',
    trigger_right: '`',
    replacement: '[[1]]```$0\n[[1]]```',
    options: 'r',
    priority: 10,
    description: '行内代码中继续输入 · 升级为代码块',
  },
  {
    id: 'builtin-conv-formula',
    trigger: '(￥￥|¥¥|\\$￥|\\$¥|\\$\\$)',
    trigger_right: '\\$?',
    replacement: { kind: 'function', ref: 'convFormula' },
    options: 'rF',
    priority: 10,
    description: '￥/$ 符号组合转行内或块级公式',
  },
  {
    id: 'builtin-conv-linestart',
    trigger: '(^|\\n)([》、])',
    replacement: { kind: 'function', ref: 'convLinestart' },
    options: 'rF',
    priority: 10,
    description: '行首 》 转引用标记、行首 、 转斜杠',
  },


  // ===== 半角转全角 (priority 15) =====
  {
    id: 'builtin-conv-hw2fw',
    trigger: '([\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af])([,.:?!;\(])',
    trigger_right: '\\)?',
    replacement: { kind: 'function', ref: 'convHw2fw' },
    options: 'rF',
    priority: 15,
    enabled: false,
    description: 'CJK字符后半角标点转全角',
  },

  // ===== 全角转半角 (priority 20) =====
  {
    id: 'builtin-fw2hw-double',
    trigger: "([。！；，：？》｜（《])\\1",
    trigger_right: '[）》]?',
    replacement: { kind: 'function', ref: 'fw2hwDouble' },
    options: 'rF',
    priority: 3,
    description: '连续输入两个相同全角标点转对应半角',
  },

  // ===== 删除配对 (priority 30) =====
  { id: 'builtin-del-inline-formula', trigger: '$', trigger_right: '$', replacement: '', options: 'd', priority: 30, description: '删除行内公式 $...$ 配对' },
  { id: 'builtin-del-highlight', trigger: '==', trigger_right: '==', replacement: '', options: 'd', priority: 30, description: '删除高亮 ==...== 配对' },
  { id: 'builtin-del-block-formula', trigger: '$$\n', trigger_right: '\n$$', replacement: '', options: 'd', priority: 30, description: '删除块级公式 $$...$$ 配对' },
  {
    id: 'builtin-del-codeblock',
    trigger: '(?<=^|\\n)([ \\t]*)```',
    trigger_right: '[ \\t]*\\n([ \\t]*)```',
    replacement: '[[1]]',
    options: 'dr',
    priority: 30,
    description: '快速删除空代码块',
  },
  {
    id: 'builtin-del-wikilink',
    trigger: ' ?!?\\[\\[[^\\n\\[\\]]*\\]\\]',
    replacement: '',
    options: 'dr',
    priority: 30,
    description: '快速删除双链及嵌入（![[]]）',
  },

  // ===== 选中替换 (priority 40) =====
  {
    id: 'builtin-sel-wrap-backtick',
    trigger: '·',
    replacement: '`${0:${SEL}}`',
    options: 's',
    priority: 40,
    description: '选中文字后输入 · 包裹为行内代码',
  },
  {
    id: 'builtin-sel-wrap-symbols',
    trigger: `【¥￥`,
    replacement: { kind: 'function', ref: 'selWrapSymbols' },
    options: 'sF',
    priority: 40,
    description: '选中文字后输入 【/¥/￥ 包裹为 []/$$',
  },
  {
    id: 'builtin-sel-wrap-quotes',
    trigger: `“”‘’`,
    replacement: { kind: 'function', ref: 'selWrapQuotes' },
    options: 'sF',
    priority: 40,
    description: '选中文字后输入全角引号，配对引号包裹',
  },
  {
    id: 'builtin-sel-wrap-cjk-brackets',
    trigger: `《（`,
    replacement: { kind: 'function', ref: 'selWrapCjkBrackets' },
    options: 'sF',
    priority: 40,
    description: '选中文字后输入《（，配对括号包裹',
  },

  // ===== 引用处理 (priority 50) =====
  { id: 'builtin-quote-convert', trigger: '((?:^|\\n)\\s*>*) ?[>》]', replacement: '[[1]]> $0', options: 'r', priority: 50, description: '输入 > 或 》 转为 Markdown 引用标记' },
  { id: 'builtin-quote-space', trigger: '((?:^|\\n)\\s*>+)([^ >》]+)', replacement: '[[1]] [[2]]$0', options: 'r', priority: 50, description: '引用标记 > 后自动补空格' },
]
