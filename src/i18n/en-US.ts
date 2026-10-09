// 英文字典：键集与中文完全一致（Messages 类型编译期钉住 + parity 测试
// 运行时钉住）。文案对照上游 src/lang/locale/en-US.ts，excludeFiles 与
// 枚举项按平台形态改写。
import type { Messages } from './index'

export const enMessages: Messages = {
  commands: {
    pastePlainTitle: 'Paste as plain text (skip auto formatting)',
  },
  settings: {
    tabout: {
      name: 'Tab Out of Paired Symbols',
      desc: 'Press Tab to move the cursor outside paired symbols like 【】, （）, 《》, quotes, or inline code.',
    },
    smartPaste: {
      name: 'Smart Paste in Lists & Quotes',
      desc: 'In lists or quote blocks, paste content automatically with proper indentation and list/quote markers.',
    },
    betterCodeEdit: {
      name: 'Enhance Codeblock Edit',
      desc: 'Improve editing in codeblocks (Tab, delete, paste, Cmd/Ctrl+A select).',
    },
    betterBackspace: {
      name: 'Smart Backspace',
      desc: 'Improve backspace feature for empty list item or empty quote line.',
    },
    autoFormat: {
      name: 'Auto formatting when typing',
      desc: 'Toggle auto-formatting of text while editing the document (master switch).',
    },
    autoFormatPaste: {
      name: 'Auto formatting on paste',
      desc: 'Toggle auto-formatting when pasting. CMD/CTRL+SHIFT+V (paste without formatting) will not trigger this.',
    },
    excludeFiles: {
      name: 'Exclude Folders/Files',
      desc: 'Each entry is an excluded folder or file path (e.g. DailyNote/, DailyNote/WeekNotes/, DailyNote/test.md). The add-on does not act on excluded files.',
    },
    autoCapital: {
      name: 'Capitalize the first letter of every sentence',
      desc: 'Capitalize the first letter of each sentence in English.',
    },
    prefixDictionary: {
      name: 'Prefix Dictionary',
      desc: 'Separate entries by commas, spaces, or newlines. Supports words and /regex/. Matching tokens will not have spaces inserted; prefixes being typed are also suppressed.',
    },
    softSpaceLeftSymbols: {
      name: 'Custom Extra Left Soft Space Symbols',
      desc: "Common full-width punctuation, quotes (' \") and opening brackets ([ ( {) are built in. Add extra left-side symbols here (such as -).",
    },
    softSpaceRightSymbols: {
      name: 'Custom Extra Right Soft Space Symbols',
      desc: "Common full-width punctuation, quotes (' \"), closing brackets (] ) }) and half-width punctuation (. , ? ! : ;) are built in. Add extra right-side symbols here (such as -).",
    },
    inlineCodeSpaceMode: {
      name: 'Space strategy between inline code and text',
      desc: 'Three levels: none (no space required), soft, strict.',
    },
    inlineFormulaSpaceMode: {
      name: 'Space strategy between inline formula and text',
      desc: 'Three levels: none (no space required), soft, strict.',
    },
    inlineLinkSpaceMode: {
      name: 'Space strategy between link and text',
      desc: 'Defines the spacing between [[wikilinks]] / [mdlinks](...) and text. Three levels: none (no space required), soft, strict.',
    },
    inlineLinkSmartSpace: {
      name: 'Smart space for links',
      desc: 'When enabled, [[wikilinks]] and [Markdown links](...) are treated as whole tokens for smart spacing; when disabled, the three-level link space strategy applies as-is.',
    },
    userDefinedRegSwitch: {
      name: 'User Defined RegExp Switch',
      desc: 'When enabled, content matched by custom regular expressions is not formatted, and the space strategy between matched content and other text can be configured.',
    },
    userDefinedRegExp: {
      name: 'User-defined Regular Expression, one expression per line',
      desc: 'One expression per line; do not add trailing spaces. The last 3 characters of each line are fixed: | plus two space strategy symbols (- no space, = soft space, + strict space), for the left and right sides of the matched block respectively. Lines starting with // are comments.',
    },
    userRulesRespectUserDefinedRegexBlocks: {
      name: 'User rules respect custom regex blocks',
      desc: 'When enabled, text matched by custom regex blocks will not trigger auto user rules.',
    },
    debug: {
      name: 'Print debug info in console',
      desc: 'Print debug information in the console (prefixed [vsidian-easy-typing]).',
    },
    strictModeEnter: {
      name: 'Strict Line breaks Mode',
      desc: 'In strict line breaks mode, pressing Enter once in normal text lines produces two line breaks or two spaces and Enter, depending on the selected mode.',
    },
    strictLineMode: {
      name: 'Enter mode under strict line breaks',
      desc: 'enter_twice: two Enters; two_space: two spaces plus Enter; mix_mode: mixed. Only effective when "Strict Line breaks Mode" is enabled.',
    },
    enhanceModA: {
      name: 'Enhance Mod+A selection in text',
      desc: 'First select the current line, second select the current text block, third select the entire text.',
    },
    collapsePersistentEnter: {
      name: 'Keep Collapsed on Enter',
      desc: 'Pressing Enter on a collapsed heading inserts a same-level heading below without expanding the fold.',
    },
  },
  noHost: 'Vsidian (onegayi.vsidian) not found in this extension host',
  // Select-current-block command title (issue #11; wording follows upstream locale commands.selectBlock)
  commandSelectBlock: 'Select current text block',
  // Behavior family names/descriptions (issue #25; examples shown in behavior management UI)
  ruleFamilies: {
    punctCollapse: {
      name: 'Double fullwidth punctuation to halfwidth',
      desc: 'Typing the same fullwidth punctuation twice converts to the halfwidth form (e.g. 。。 → .)',
      examples: ['。。 → .', '！！ → !'],
    },
    autopair: {
      name: 'Fullwidth bracket and quote auto-pairing',
      desc: 'Auto-complete the pair when typing fullwidth brackets/quotes; skip over the closing symbol when the pair already exists',
      examples: ['（ → （）', 'type 》 inside 《》 → skip over'],
    },
    symbolConvert: {
      name: 'Symbol composition conversion',
      desc: '·· to inline code, continuing · in inline code upgrades to a code block, ￥/$ compositions to formulas, line-start 》/、 to quote marker or slash',
      examples: ['·· → inline code', 'line-start 》 → > '],
    },
    punctExpand: {
      name: 'Halfwidth to fullwidth after CJK',
      desc: 'Halfwidth punctuation typed after CJK text converts to fullwidth (disabled by default upstream; rule data default off)',
      examples: ['中文, → 中文，'],
    },
    quote: {
      name: 'Quote marker conversion',
      desc: 'Typing > or 》 converts to the Markdown quote marker; a space is added after the marker',
      examples: ['line-start > → > '],
    },
  },
  // Rule error notification template (issue #25; {id} rule id, {message} engine-reported detail)
  ruleError: {
    notify: 'Input rule {id} skipped: {message}',
  },
}
