// vendored from ONEGAYI/vsidian@9107e2f0554d8b5c1637d16e1d1b375543b01c1c — src/host/addons/addonPageRegistry.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 组件登记的页面入口（setup 的 settings.registerPage / enable 的
 *  pages.registerEditor 输入）：全部为**安装目录内相对路径** */
export interface AddonPageEntryInput {
  /** 入口脚本相对路径（如 dist/page.js） */
  entry: string
  /** 样式表相对路径列表（如 ['dist/page.css']） */
  css?: readonly string[]
  /** 资源子目录相对路径列表（如 ['dist/assets']；首个作为 resourceUri 基址） */
  resources?: readonly string[]
}
