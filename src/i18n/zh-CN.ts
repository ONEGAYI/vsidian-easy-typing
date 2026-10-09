// 中文字典（zh 类型源）：Messages 类型由本文件 typeof 推导，英文键集以
// 编译期类型 + parity 测试双保险对齐。文案对照上游 src/lang/locale/zh-CN.ts，
// excludeFiles 与枚举项按平台形态改写（数组语义 / 枚举值在 desc 说明）。
const zhMessages = {
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
  },
  // 规则错误通知模板（工单 #25；{id} 规则 id、{message} 引擎上报的技术细节）
  ruleError: {
    notify: '输入规则 {id} 已跳过：{message}',
  },
}

export { zhMessages }
