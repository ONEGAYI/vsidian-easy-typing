// 中文字典（zh 类型源）：Messages 类型由本文件 typeof 推导，英文键集以
// 编译期类型 + parity 测试双保险对齐。文案对照上游 src/lang/locale/zh-CN.ts，
// excludeFiles 与枚举项按平台形态改写（数组语义 / 枚举值在 desc 说明）。
const zhMessages = {
  commands: {
    // 工单 #12 纯文本粘贴命令标题（区别于平台「粘贴纯文本」：本命令同时
    // 置跳过自动格式化标记，#26 格式化管线消费）
    pastePlainTitle: '纯文本粘贴（跳过自动格式化）',
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
      desc: '严格换行的设置下，在普通文本行进行一次回车会根据所选模式产生两个换行符或者两个空格和回车',
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
  },
  noHost: '当前扩展宿主中未找到 Vsidian（onegayi.vsidian）',
  // 「选择当前块」命令标题（工单 #11；文案对齐上游 locale commands.selectBlock）
  commandSelectBlock: '选择当前文本块',
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
    },
    builtinRules: {
      title: '内置规则',
      resetAll: '重置内置规则',
      disable: '停用',
      platformToggleHint: '内置规则的逐条启用开关由 Vsidian 平台的「行为冲突管理」统一管理，不在此页；此处提供停用（移出规则表）与恢复入口。',
    },
    deletedRules: {
      title: '已停用的内置规则',
      restore: '恢复',
      empty: '没有已停用的内置规则',
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
      functionReadonlyHint: '函数替换体当前为只读展示，暂不支持编辑；保存时将保留原函数体不变。',
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
    },
    testEditor: {
      title: '规则测试',
      desc: '输入测试文本并试运行当前表单中的规则：光标位置即模拟的输入位置；选中替换类规则请选中一段文本，以触发按键的第一个字符模拟按键。',
      inputLabel: '测试文本',
      outputLabel: '试运行结果',
      miss: '未命中：当前文本与光标位置不触发该规则',
      hit: '命中（{range} 为被替换区间，▏为替换后的光标位置）',
    },
    storage: {
      dataDirLabel: '规则数据目录',
      dataDirDesc: '规则文件（builtin-rules.json / user-rules.json）保存在 Vsidian 组件数据目录，外部同步工具可直接编辑，编辑器会自动重载：',
    },
  },
}

export { zhMessages }
