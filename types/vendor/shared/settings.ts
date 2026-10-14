// vendored from ONEGAYI/vsidian@1c7c5283665f5a0b5934478d8d7e3638afab9753 — src/shared/settings.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/**
 * #423「阅读宽松换行」开关：阅读视图（含嵌入卡片/悬停浮层的 Markdown
 * 内容）段内单换行是否渲染为 <br>（markdown-it breaks 选项）。关闭
 * （默认）维持 CommonMark 严格软换行——单换行拼回同段，可见换行需行尾
 * 双空格或空行分段；开启后与 Live 按源文行的呈现一致（宽松形态，对齐
 * VSCode markdown.preview.breaks 开启档与 Obsidian 默认行为）。**仅辖
 * 阅读渲染**：Live 编辑按源文行呈现、不随本开关变化。键与消费方
 * （syncController 的 applyReadingBreaksSetting → readingBlocks 的
 * applyReadingRendererBreaks）成对导出，避免字面量漂移。
 */
export const READING_BREAKS_KEY = 'editor.readingBreaks'
