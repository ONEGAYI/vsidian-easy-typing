// vendored from ONEGAYI/vsidian@9107e2f0554d8b5c1637d16e1d1b375543b01c1c — src/shared/addonStorage.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 拒绝码：invalid-path = 越界/非法相对路径；too-large = 单文件超限；
 * error = IO 失败（不存在/权限等，detail 归因） */
export type AddonStorageRejection = 'invalid-path' | 'too-large' | 'error'

export type AddonStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AddonStorageRejection; detail?: string }

export interface AddonStorageEntryInfo {
  /** 相对组件数据目录的路径（正斜杠） */
  path: string
  kind: 'file' | 'directory'
}

export type AddonStorageListResult =
  | { ok: true; entries: AddonStorageEntryInfo[] }
  | { ok: false; reason: AddonStorageRejection; detail?: string }

export interface AddonStorageWatchHandle {
  dispose(): void
}

/** 组件数据目录面（宿主侧 setup/enable 上下文同形状；组件页面侧经
 * channel 桥接宿主消费）。全部相对路径先过 isSafeAddonStoragePath，
 * 越界形态明确拒绝（普通 API 拒绝，不算组件故障）。 */
export interface AddonStorageFacet {
  /** 本组件数据目录的 URI（显示与同步工具配置用） */
  uri(): string
  /** 读 UTF-8 文本文件 */
  readFile(relativePath: string): Promise<AddonStorageResult<string>>
  /** 覆盖写 UTF-8 文本文件（父目录按需创建；content 超单文件上限拒绝） */
  writeFile(relativePath: string, content: string): Promise<AddonStorageResult<null>>
  /** 列目录（相对路径缺省根；recursive 缺省 false 只列一层） */
  list(relativePath?: string, recursive?: boolean): Promise<AddonStorageListResult>
  /** 删文件（不删目录——目录生命周期归卸载策略） */
  deleteFile(relativePath: string): Promise<AddonStorageResult<null>>
  /** 订阅目录内文件变化（外部同步工具改写/新建文件后自动重载的支撑面）；
   * 回调回相对路径与变化类型（change = 改写或新建，delete = 删除）；
   * 返回取消函数；组件停用/故障/代次终结时平台统一注销 watcher */
  onDidChangeFile(callback: (relativePath: string, kind: 'change' | 'delete') => void): AddonStorageWatchHandle
}
