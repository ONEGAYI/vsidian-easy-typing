// 三产物构建入口：node build.mjs（= npm run build）。
// - dist/editor.js   编辑器页面 IIFE（chrome114，经 SDK 构建桥）
// - dist/settings.js 设置页面 IIFE（chrome114，经 SDK 构建桥）
// - dist/extension.js 宿主 CJS（node18，external vscode）
// 每个产物构建完成即静态扫描（CM6 运行时标记 / vsidian 内部路径 /
// 裸 require）——构建通过即双防线通过。逻辑在 tools/buildLib.mjs。
import { buildAddon } from './tools/buildLib.mjs'

await buildAddon({
  pages: [
    { entry: 'src/page-editor.ts', out: 'dist/editor.js' },
    { entry: 'src/page-settings.ts', out: 'dist/settings.js' },
  ],
  host: 'src/extension.ts',
})
console.log('[build] 三产物构建完成：dist/editor.js + dist/settings.js + dist/extension.js')
