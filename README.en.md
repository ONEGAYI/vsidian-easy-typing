# vsidian-easy-typing

English | **[中文](README.md)**

> An input-experience add-on for Vsidian — a full port of [easy-typing-obsidian](https://github.com/Yaozhuwa/easy-typing-obsidian), doubling as the **reference template for Vsidian Plugins**.

Optimizes typing for mixed Chinese/English and Markdown-heavy writing: smart punctuation and pair-symbol conversion, automatic spacing between CJK and Latin text, editing enhancements for code blocks and lists, and a customizable text-transform rule engine. Everything integrates as a native Vsidian add-on — rule hits go through the platform behavior chain (working natively with the undo stack and behavior conflict management), settings render in the platform's add-on settings page, and the UI follows your VSCode display language (English/Chinese).

## Status

The bulk of the first-release functionality is implemented (20+ of 28 tickets merged, all unit tests green); finishing touches are in progress — the command family ([#28](https://github.com/ONEGAYI/vsidian-easy-typing/issues/28)), packaging & release ([#24](https://github.com/ONEGAYI/vsidian-easy-typing/issues/24)), the template walkthrough ([#20](https://github.com/ONEGAYI/vsidian-easy-typing/issues/20)), and manual verification ([#21](https://github.com/ONEGAYI/vsidian-easy-typing/issues/21)).

- Five milestones (M0 engineering groundwork → M4 polish): [Issues](https://github.com/ONEGAYI/vsidian-easy-typing/issues)
- Platform capability gaps are tracked in the vsidian host repository at [#399–#407](https://github.com/ONEGAYI/vsidian/issues/399), cross-linked with this project's tickets
- Per-feature implementation specs: [docs/specs/](docs/specs/README.md) (Chinese); user guides: [docs/guides/](docs/guides/) (Chinese with English terms kept inline)

## Feature overview

### Input rules (rule engine)

| Feature | Description |
| --- | --- |
| 20 built-in rules | Double fullwidth punctuation to halfwidth (`。。` → `.`), fullwidth bracket/quote auto-pairing and skip-over, `··` to inline code, `￥￥` to formula, line-start `》` to quote marker, linked deletion of paired structures (`$|$`, `==|==`, empty code blocks, wikilinks), selection wrapping by trigger key (`·` → inline code, `【` → `[]`, etc.) |
| Custom rules | Three types (input / delete / selection-replace), regex matching (`i`/`m`/`u` flags), capture-group references (`[[n]]` / `[[Rn]]`), tabstop placeholders (`$0`, `$1`, `${1:text}` with Tab navigation), scope restriction (text/formula/code + fence language), priority, and Tab trigger mode |
| Function replacements | Replacement logic can be a function (10 pre-registered functions power the built-in rules); custom functions join via a component fork — no dynamic code execution (CSP-safe) |
| Rule management page | Visual edit form with live single-rule testing, drag-to-reorder, JSON import/export (file compatible with upstream `easy-typing-user-rules.json`), built-in rule disable/restore/reset |
| Rule storage | `builtin-rules.json` / `user-rules.json` in the Vsidian add-on data directory; external sync tools can edit them directly and open editors reload automatically |

Full syntax reference: [custom rules guide](docs/guides/custom-rules.md) (Chinese).

### Auto formatting

| Feature | Description |
| --- | --- |
| CJK–Latin spacing | Automatic spaces at Chinese↔English, Chinese↔digit, digit↔English boundaries (`你好world` → `你好 world`) |
| Prefix dictionary | Known words suppress spacing inside and while being typed (e.g. `n8n`); the boundary space is inserted once you move past the word |
| Sentence capitalization | Auto-capitalize the first letter of English sentences (off by default) |
| Inline element spacing | Configurable spacing between text and inline code / inline formulas / wikilinks & Markdown links — none / soft / strict per element; optional smart spacing that treats links as whole tokens |
| Custom regex protection zones | Regex-declared atomic blocks are never reformatted, with independent left/right spacing (Templater expressions, HTML tags, URLs, emails, tags preconfigured) |

Details: [auto formatting guide](docs/guides/auto-formatting.md) (Chinese).

### Editing enhancements

| Feature | Description |
| --- | --- |
| Tab out | Press Tab inside a paired symbol to jump past the closing one — 22 pairs supported (`【】`, `（）`, `$$`, `**`, `[[]]`, etc.) |
| Smart backspace | Backspace clears empty list markers / quote prefixes; ordered-list items renumber on backspace |
| Progressive selection | `Ctrl/Cmd+A` selects the current line → text block → whole document (off by default); plus a "select current text block" command |
| Smart paste | Pasting in lists/quote blocks continues prefixes and indentation; a "paste as plain text" command skips auto formatting |
| New line below | `Ctrl/Cmd+Enter` inserts a line below and continues list/quote prefixes (ordered auto-increment, tasks reset) |
| Enter on collapsed headings | Pressing Enter on a folded heading adds a same-level heading below without expanding |
| Comment toggle | `Ctrl/Cmd+/` toggles line comments — per-language markers in code fences, `%%` in Markdown body |

Details and platform differences: [editing enhancements guide](docs/guides/edit-enhancements.md) (Chinese).

### Settings & UI

- 23 settings render in Vsidian's add-on settings page, defaults aligned with upstream;
- UI copy is bilingual, following the VSCode display language (`vscode.env.language`);
- Per-rule switches and behavior-chain ordering are managed centrally by the platform's behavior conflict management;
- Codeblock editing enhancements (upstream BetterCodeEdit) are not yet implemented ([#10](https://github.com/ONEGAYI/vsidian-easy-typing/issues/10), platform dependency); the strict line-break enter mode awaits a product decision ([ADR-0002](docs/adr/0002-strict-line-break-mapping.md), Chinese).

Not ported: MS-IME fixes and the macOS context-menu fix (Obsidian/Electron-specific patches).

## Installation & dependencies

Requires the host extension [Vsidian](https://github.com/ONEGAYI/vsidian) (`onegayi.vsidian`, VSCode 1.82+): install and enable Vsidian first, then enable this extension. Distributed as a VSIX — CI builds one per run (GitHub Actions artifact); for local builds see the development section below.

## Development

```bash
npm install        # Install devDependencies (pinned versions, no runtime deps)
npm run compile    # Three-artifact build (host CJS + editor/settings pages as chrome114 IIFE) + tsc type check
npm run test       # vitest unit tests (algorithm matrices, pipelines, jsdom end-to-end, structural contracts)
npm run vendor:check  # Verify the vendored SDK type snapshot has not drifted
```

Engineering details (build-bridge double guard, vendored type snapshots, manifest red lines): see [AGENTS.md](AGENTS.md) (Chinese) and [ADR-0001](docs/adr/0001-scaffold-build-bridge-and-vendor.md) (Chinese).

## Credits & license

Upstream [easy-typing](https://github.com/Yaozhuwa/easy-typing-obsidian) (MIT, by Yaozhuwa) — five years of continuous polish — is the starting point of this project; its documentation and source are the source of truth for behavior semantics. This project is likewise MIT and retains the upstream copyright notice.

## Related

- Host extension: [vsidian](https://github.com/ONEGAYI/vsidian) (an Obsidian-like dual-view Markdown editor)
- Add-on development guide: `docs/addons/developer-guide.md` in the vsidian repository
