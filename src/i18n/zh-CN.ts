// 中文字典（zh 类型源）：Messages 类型由本文件 typeof 推导，英文键集以
// 编译期类型 + parity 测试双保险对齐。文案对照上游 src/lang/locale/zh-CN.ts，
// excludeFiles 与枚举项按平台形态改写（数组语义 / 枚举值在 desc 说明）。
const zhMessages = {
  commands: {
    // 工单 #12 纯文本粘贴命令标题（区别于平台「粘贴纯文本」：本命令同时
    // 置跳过自动格式化标记，#26 格式化管线消费）
    pastePlainTitle: '纯文本粘贴（跳过自动格式化）',
    // 工单 #2 注释切换命令标题（上游 locale commands.toggleComment，括注
    // 区别于平台内建 HTML 注释操作）
    toggleCommentTitle: '切换注释（代码块按语言，正文用 %%）',
    // 工单 #28 格式化命令族标题（文案对照上游 locale commands 词条）
    formatArticleTitle: '格式化全文',
    formatSelectionTitle: '格式化选中部分/当前行',
    deleteBlankLinesTitle: '删除选中部分/全文的多余空白行',
    toggleAutoFormatTitle: '切换自动格式化开关',
    convertCodeBlockTitle: '插入代码块',
  },
  settings: {
    tabout: {
      name: 'Tab 跳出配对符号',
      desc: '按 Tab 键跳出配对符号，如【】、（）、《》、引号、行内代码等',
    },
    smartPaste: {
      name: '智能粘贴',
      desc: '在列表或引用块中粘贴时，自动添加缩进和列表/引用符号',
    },
    betterCodeEdit: {
      name: '增强代码块编辑',
      desc: '增强代码块内的编辑（Cmd/Ctrl+A 选中、Tab、删除、粘贴）',
    },
    betterBackspace: {
      name: '智能退格键',
      desc: '增强删除空列表项或空引用行的功能',
    },
    autoFormat: {
      name: '输入时自动格式化',
      desc: '是否在编辑文档时自动格式化文本，自动格式化的总开关',
    },
    autoFormatPaste: {
      name: '粘贴时自动格式化',
      desc: '粘贴时是否自动格式化，CMD/CTRL+SHIFT+V 无格式粘贴时不触发',
    },
    excludeFiles: {
      name: '排除文件夹/文件',
      desc: '每项填一个要排除的文件夹或文件路径（如 DailyNote/、DailyNote/WeekNotes/、DailyNote/test.md），被排除的文件不受本插件影响',
    },
    autoCapital: {
      name: '句首字母大写',
      desc: '英文每个句首字母大写',
    },
    prefixDictionary: {
      name: '前缀词典',
      desc: '用逗号、空格或换行分隔，支持词或 /正则/。匹配的 token 不会被插入空格，正在输入的前缀也会暂不插入空格',
    },
    softSpaceLeftSymbols: {
      name: '自定义左侧软空格额外符号',
      desc: "常见的全角标点、引号（' \"）和左括号（[ ( {）已内置支持，在此添加额外的左侧符号（如 -）",
    },
    softSpaceRightSymbols: {
      name: '自定义右侧软空格额外符号',
      desc: "常见的全角标点、引号（' \"）、右括号（] ) }）以及半角标点（. , ? ! : ;）已内置为右软空格符号，在此添加额外的右侧符号（如 -）",
    },
    inlineCodeSpaceMode: {
      name: '行内代码与文本的空格策略',
      desc: "三档：none 不要求空格、soft 软空格、strict 严格空格",
    },
    inlineFormulaSpaceMode: {
      name: '行内公式与文本的空格策略',
      desc: '三档：none 不要求空格、soft 软空格、strict 严格空格',
    },
    inlineLinkSpaceMode: {
      name: '链接与文本的空格策略',
      desc: '定义 [[双链]] 与 [Markdown 链接](...) 和文本之间的空格策略，三档：none 不要求空格、soft 软空格、strict 严格空格',
    },
    inlineLinkSmartSpace: {
      name: '链接智能空格',
      desc: '开启后把 [[双链]] 与 [Markdown 链接](...) 作为整体词元做智能空格判定；关闭时完全按「链接与文本的空格策略」三档处理',
    },
    userDefinedRegSwitch: {
      name: '自定义正则表达式开关',
      desc: '开启后自定义正则匹配的内容不进行格式化，且可以设置匹配内容与其他文本之间的空格策略',
    },
    userDefinedRegExp: {
      name: '自定义正则表达式',
      desc: '每行一条表达式，行尾不要随意加空格。每行末尾 3 个字符固定为 | 和两个空格策略符号（- 不要求空格、= 软空格、+ 严格空格），分别为匹配区块左右两侧的策略。以 // 开头的行作为注释',
    },
    userRulesRespectUserDefinedRegexBlocks: {
      name: '自定义正则区块同时阻止用户规则',
      desc: '启用后，命中自定义正则区块的文本将不会触发自动用户规则',
    },
    debug: {
      name: '在控制台输出调试信息',
      desc: '开启后在控制台输出调试信息（前缀 [vsidian-easy-typing]）',
    },
    strictModeEnter: {
      name: '严格换行模式回车增强',
      desc: '宿主渲染为严格换行（Vsidian「阅读宽松换行」关闭）且本开关开启时，普通文本行一次回车按所选模式产生两个换行符或行尾两空格；引用行按所选模式延续前缀',
    },
    strictLineMode: {
      name: '严格换行的回车模式',
      desc: 'enter_twice 两次回车、two_space 两个空格加回车、mix_mode 混合模式；仅在开启「严格换行模式回车增强」后生效',
    },
    enhanceModA: {
      name: '增强 Ctrl/Cmd+A 功能',
      desc: '第一次选中当前行，第二次选中当前文本块，第三次选中全文',
    },
    collapsePersistentEnter: {
      name: '折叠标题回车不展开',
      desc: '在折叠的标题行按回车时，不展开折叠内容，直接在下方添加同级标题行',
    },
    newLineBelow: {
      name: 'Ctrl/Cmd+Enter 在下方新建行',
      desc: '在当前行下方新建一行并延续列表或引用前缀（有序列表自动递增、任务项重置为未完成）；关闭时回退编辑器内建行为（仅插入空行）',
    },
  },
  // 设置分组标题与枚举档位标签（#477：经宿主声明式表单呈现，标题用
  // AddonLocalizedText 双语映射——键形同 #45/#464 的 zh-cn/en）
  settingsGroups: {
    editEnhance: '编辑增强',
    autoFormat: '自动格式化',
    general: '通用',
    experimental: '实验功能',
  },
  enumLabels: {
    spaceNone: '不要求空格',
    spaceSoft: '软空格',
    spaceStrict: '严格空格',
    strictLineEnterTwice: '两次回车',
    strictLineTwoSpace: '两个空格加回车',
    strictLineMix: '混合模式',
  },
  noHost: '当前扩展宿主中未找到 Vsidian（onegayi.vsidian）',
  // 「选择当前块」命令标题（工单 #11；文案对齐上游 locale commands.selectBlock）
  commandSelectBlock: '选择当前文本块',
  // 行为族名称/说明（工单 #25；examples 为行为管理界面展示的输入→输出示例）
  ruleFamilies: {
    punctCollapse: {
      name: '连续全角标点转半角',
      desc: '连续输入两个相同的全角标点时转换为对应半角形式（如 。。 → .）',
      examples: ['。。 → .', '！！ → !'],
    },
    autopair: {
      name: '全角括号引号自动配对',
      desc: '输入全角括号/引号自动补全配对；已有配对时输入右侧符号自动跳过',
      examples: ['（ → （）', '《》 内输入 》 → 跳过'],
    },
    symbolConvert: {
      name: '符号组合转换',
      desc: '间隔号 ·· 转行内代码、行内代码续输 · 升级为代码块、￥/$ 组合转公式、行首 》/、 转引用标记或斜杠',
      examples: ['·· → 行内代码', '行首 》 → > '],
    },
    punctExpand: {
      name: 'CJK 后半角标点转全角',
      desc: '中英文字符后输入半角标点转换为全角形式（上游默认关闭，规则数据态默认关）',
      examples: ['中文, → 中文，'],
    },
    quote: {
      name: '引用标记转换',
      desc: '输入 > 或 》 转为 Markdown 引用标记，引用标记后自动补空格',
      examples: ['行首 > → > '],
    },
    deletePair: {
      name: '成对结构联动删除',
      desc: '删除空公式/高亮/空代码块/双链等成对结构的一端时联动删除整对（$|$、==|==、【|】、![[...]] 等）',
      examples: ['$|$ 退格 → 删除整对', '【|】 退格 → 删除整对'],
    },
    selectKeyWrap: {
      name: '选中文本按键包裹',
      desc: '选中文本后输入触发键包裹为对应符号：· → 行内代码、【 → []、¥/￥ → $$、全角引号与《（ → 配对符号',
      examples: ['选中后按 · → `行内代码`', '选中后按 【 → [选中]'],
    },
    // 工单 #26 自动格式化族（上游 Formater：语言对间距/前缀词典/大写/软空格）
    autoFormat: {
      name: '输入自动格式化（中英空格等）',
      desc: '在语言对边界（如中英、中数）自动插入空格；前缀词典词条内部不加空格；句首大写与软空格符号经设置页配置（规则链命中时本次输入不格式化）',
      examples: ['中文a → 中文 a', 'n8n 词条内部不加空格', '中文`a` → 中文 `a`'],
    },
  },
  // 规则错误通知模板（工单 #25；{id} 规则 id、{message} 引擎上报的技术细节）
  ruleError: {
    notify: '输入规则 {id} 已跳过：{message}',
  },
  // 通用通知文案（工单 #28；上游 Obsidian Notice 的宿主等价通道消费——
  // 页面经 NOTICE_TOPIC 上报，宿主 showInformationMessage 承接）
  notices: {
    autoFormatToggledOn: '自动格式化已开启',
    autoFormatToggledOff: '自动格式化已关闭',
    commandFileExcluded: '当前文件在排除清单（排除文件夹/文件）中，命令未执行',
  },
  // 设置页五 Tab 文案（工单 #55）：Tab 名对照上游 locale headers.tabs
  //（user-rules 按票面用「自定义规则」）；卡片标题对照上游设置页卡片结构；
  // hero 为顶部项目名与上游来源链接块（MIT 双署名致敬）；联动置灰提示为
  // 行 title 悬停文案（纯 UI 态，决策 11）
  settingsTabs: {
    tabs: {
      editEnhance: '编辑增强',
      autoFormat: '自动格式化',
      builtinRules: '内置规则',
      userRules: '自定义规则',
      other: '其他设置',
    },
    heroTitle: 'Vsidian Easy Typing 输入体验增强',
    heroSourceLabel: '基于上游项目（MIT 协议）：',
    heroLinkText: 'easy-typing-obsidian',
    cards: {
      editEnhance: '增强编辑设置',
      autoFormat: '自动格式化设置',
      inlineSpace: '行内元素间空格',
      prefixDict: '前缀词典',
      customRegex: '自定义正则区块',
      excludeFiles: '指定文件不自动格式化',
      experimental: '实验功能',
    },
    hintDisabledByMaster: '「输入时自动格式化」总开关已关闭，此设置暂不可用',
    hintDisabledByRegexSwitch: '「自定义正则表达式开关」已关闭，此设置暂不可用',
    statusUpdateFailed: '设置写入失败',
    // 作用域相关（#55 切片 2）：清除覆盖语义 = 恢复继承用户默认值（非恢复
    // 出厂默认——vendor AddonSettingsContextApi.clearWorkspaceOverride 注释）
    rulesScopeNote: '本页规则为用户级数据：全局共享，不随工作区隔离',
    badgeWorkspaceOverride: '工作区覆盖',
    clearOverrideAction: '清除覆盖',
    clearOverrideTitle: '清除工作区覆盖：此设置恢复继承用户默认值（非恢复出厂默认）',
    statusOverrideCleared: '已清除工作区覆盖，恢复继承用户默认值',
    statusClearOverrideFailed: '清除工作区覆盖失败',
  },
  // 规则管理设置页文案（工单 #16）：对照上游 locale headers.toolTip.
  // ruleEditModal.dropdownOptions 词条，按平台自绘页形态改写
  rulesPage: {
    title: '规则管理',
    intro: '编辑自定义转换规则、停用或恢复内置规则；所有变更经宿主统一保存，并即时同步到打开的编辑器。',
    status: {
      loadFailed: '规则数据加载失败，请稍后重开此页',
      actionFailed: '操作失败',
      resetSuccess: '内置规则已重置',
      importInvalidJson: '文件格式错误：不是有效的 JSON 规则数组',
      importTooLarge: '文件过大：导入文件超过 2MB 上限，请分批导入',
      importTooManyRules: '规则条数超限：单次导入最多 5000 条，请分批导入',
      importNoRules: '文件中没有可导入的规则',
      importSuccess: '导入了 {imported} 条规则，跳过 {skipped} 条重复规则',
      noRulesToExport: '没有可导出的用户规则',
    },
    userRules: {
      title: '用户规则',
      add: '添加规则',
      import: '导入',
      export: '导出',
      empty: '暂无用户规则，点击「添加规则」创建第一条',
      moveUp: '上移选中规则',
      moveDown: '下移选中规则',
    },
    builtinRules: {
      title: '内置规则',
      resetAll: '重置内置规则',
      enable: '启用/停用内置规则',
      layerHint: '内置规则在此页逐条启停；Vsidian 行为管理中的禁用与本页开关是两层独立设置，两者都开启才会生效。被宿主禁用的条目呈灰态，悬停可查看原因。',
    },
    deletedRules: {
      title: '已停用的内置规则',
      empty: '没有已停用的内置规则',
    },
    hostDisabled: {
      behaviorDisabledTooltip:
        '已在插件行为管理中被禁用：此处开关仍可调整，但需在 Vsidian 的行为管理中重新启用后才会生效',
      addonDisabledTooltip: '组件已停用：所有规则不会生效，请在 Vsidian 的组件管理中启用本组件',
    },
    ruleItem: {
      edit: '编辑规则',
      remove: '删除规则',
      enable: '启用/停用规则',
      typeInput: '输入',
      typeDelete: '删除',
      typeSelectKey: '选中替换',
      fnTag: '函数',
      scopeFormula: '公式',
      scopeCode: '代码',
    },
    form: {
      addTitle: '添加规则',
      editTitle: '编辑规则',
      fieldType: '类型',
      fieldTriggerMode: '触发方式',
      triggerModeAuto: '自动',
      triggerModeTab: 'Tab 键',
      triggerModeTabPending: 'Tab 触发等待平台键位面开放，当前不可用（规则不会命中）',
      groupMatch: '匹配条件',
      fieldIsRegex: '使用正则表达式匹配',
      fieldTrigger: '光标前匹配',
      fieldTriggerSelectKey: '触发按键字符',
      fieldTriggerRight: '光标后匹配',
      hintTriggerEscape: '\\\\：反斜杠，\\n：换行，\\t：制表符',
      fieldRegexFlags: '正则标志',
      fieldRegexFlagsDesc: '仅支持 i / m / u，例如 im',
      groupReplacement: '替换',
      fieldReplacement: '替换内容',
      fieldReplacementDescSelectKey: '${SEL}：选中的文本内容，${0:${SEL}}：光标继续选中。',
      fieldReplacementDescInputDelete: '[[0]]：左侧第0捕获组，[[R1]]：右侧第1捕获组。',
      hintTabstop: '$0：光标位置，$1/$2：按 Tab 跳转的位置，${1:text}：跳转并选中 text。',
      fieldIsFunction: '函数式替换',
      fieldFunctionRef: '预注册函数',
      fnGroupText: '输入 / 删除类（leftMatches / rightMatches）',
      fnGroupSelectKey: '选中替换类（selectionText / key）',
      functionReadonlyHint: '替换函数本体存于组件代码的预注册函数表，不随规则 JSON 存储与编辑；需要自定义变换函数时，请 fork 本组件（或做成小组件 VSIX），把函数加入函数表后按 ref 引用。',
      functionHintInputDelete: '参数：leftMatches (string[])、rightMatches (string[])。返回字符串或 undefined 跳过。',
      functionHintSelectKey: '参数：selectionText (string)、key (string)。返回字符串或 undefined 跳过。',
      groupOther: '其他',
      fieldScope: '作用域',
      scopeAll: '全部',
      scopeText: '文本',
      scopeFormula: '公式',
      scopeCode: '代码',
      fieldScopeLanguage: '语言（可选）',
      fieldPriority: '优先级',
      fieldPriorityDesc: '数值越小，优先级越高，默认 100',
      fieldDescription: '描述',
      enabled: '启用该规则',
      buttonSave: '保存',
      buttonCancel: '取消',
      invalidRegex: '正则表达式无效',
      errTriggerRequired: '触发式不能为空',
      errFunctionRefRequired: '请选择一个预注册函数',
      errFunctionRefInvalid: '所选函数与规则类型不匹配，请重新选择',
    },
    testEditor: {
      title: '规则测试',
      desc: '输入测试文本并试运行当前表单中的规则：光标位置即模拟的输入位置；选中替换类规则请选中一段文本，以触发按键的第一个字符模拟按键。',
      inputLabel: '测试文本',
      outputLabel: '试运行结果',
      miss: '未命中：当前文本与光标位置不触发该规则',
      hit: '命中（{range} 为被替换区间，▏为替换后的光标位置）',
    },
    spacing: {
      title: '语言间空格策略',
      intro: '管理自动加空格的语言对与自定义语言/符号词典；变更即时保存并同步到打开的编辑器。',
      pairsTitle: '现役语言对',
      pairAdd: '添加语言对',
      pairInvalid: '请选择两个不同的类别',
      pairRemove: '删除该语言对',
      categoriesTitle: '自定义语言/符号词典',
      categoryName: '名称',
      categoryPattern: '字符/模式',
      categoryPatternHint: '字符类内部片段（如 Α-Ωα-ω，不含方括号）；匹配的字符与语言对参与自动加空格。',
      categoryAdd: '添加',
      categoryRemove: '删除该条目',
      categoryInvalid: '名称与字符/模式都不能为空',
      categoryConflict: '名称与现有词典条目或内置脚本类重复，请换一个名称',
      empty: '暂无',
    },
    scriptNames: {
      chinese: '中文',
      japanese: '日文',
      korean: '韩文',
      cjk: '中日韩',
      english: '英文',
      digit: '数字',
      russian: '俄文',
    },
    storage: {
      dataDirLabel: '规则数据目录',
      dataDirDesc: '规则文件（builtin-rules.json / user-rules.json）保存在 Vsidian 组件数据目录，外部同步工具可直接编辑，编辑器会自动重载：',
    },
  },
  // 内置规则描述本地化（工单 #19；对照上游 locale builtinRuleDescriptions）：
  // 按规则 id 映射——展示层（规则管理页列表预览）以此优先于数据态
  // description（default-rules.ts 保持上游中文数据原样，不随语言改写存储）
  builtinRuleDescriptions: {
    'builtin-autopair-input': '输入全角括号/引号时自动补全配对',
    'builtin-autopair-jump': '输入右侧配对符号时自动跳过，避免重复插入',
    'builtin-autopair-delete': '删除全角括号/引号时同时删除配对',
    'builtin-conv-backtick': '连续中文间隔号 ·· 转行内代码',
    'builtin-conv-codeblock': '行内代码中继续输入 · 升级为代码块',
    'builtin-conv-formula': '￥/$ 符号组合转行内或块级公式',
    'builtin-conv-linestart': '行首 》 转引用标记、行首 、 转斜杠',
    'builtin-conv-hw2fw': 'CJK字符后半角标点转全角',
    'builtin-fw2hw-double': '连续输入两个相同全角标点转对应半角',
    'builtin-del-inline-formula': '删除行内公式 $...$ 配对',
    'builtin-del-highlight': '删除高亮 ==...== 配对',
    'builtin-del-block-formula': '删除块级公式 $$...$$ 配对',
    'builtin-del-codeblock': '快速删除空代码块',
    'builtin-del-wikilink': '快速删除双链及嵌入（![[]]）',
    'builtin-sel-wrap-backtick': '选中文字后输入 · 包裹为行内代码',
    'builtin-sel-wrap-symbols': '选中文字后输入 【/¥/￥ 包裹为 []/$$',
    'builtin-sel-wrap-quotes': '选中文字后输入全角引号，配对引号包裹',
    'builtin-sel-wrap-cjk-brackets': '选中文字后输入《（，配对括号包裹',
    'builtin-quote-convert': '输入 > 或 》 转为 Markdown 引用标记',
    'builtin-quote-space': '引用标记 > 后自动补空格',
  },
}

export { zhMessages }
