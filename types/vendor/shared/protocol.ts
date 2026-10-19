// vendored from ONEGAYI/vsidian@29880ba926a2f3b3e65319f67bd8ff5c16434630 — src/shared/protocol.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 一次变更：把全文 [offset, offset+length) 替换为 text（与 contentChanges 同构） */
export interface SerChange {
  offset: number
  length: number
  text: string
}

/** 悬停预览失败原因（#218 错误分态，就地 i18n 呈现；#219 增锚点缺失）：
 *  unsupported=目标形态非法/外部网页不接入；no-workspace=来源不在工作区；
 *  escape=目标越出所属根；not-found=目标文件不存在；non-markdown=目标非
 *  Markdown（本扩展暂未接入的类型分派）；read-failed=打开/读取目标失败；
 *  anchor-missing=目标文件在但标题/块锚点不存在（不以全文替代，附锚点
 *  原文）；anchor-invalid=非 Markdown 目标的锚点语法非法（#337 PDF
 *  #page=0/非数字/未知键/重复键等——不静默回落第一页，附锚点原文，
 *  修正后可重试）。
 *  #340（P3-08）text 通道准入与锚点分态：binary-file=二进制（头部探测
 *  含 NUL，不读完整无界内容）；invalid-encoding=严格 UTF-8 探测失败
 *  （编码以宿主打开文档的解码结果为准——探测只拦宿主解码必然无意义的
 *  形态）；file-too-large=超单文件准入上限；line-too-long=单行超上限
 *  （不悄悄截断）；text 锚点段非法细分见 anchor-detail，附锚点原文。
 *  #556（T3）短名补查分态：ambiguous=根内多个同名候选（不归任一候选，
 *  提示补路径）；pending=清单未就绪且只发现一个候选（不声明唯一，显示
 *  更新中状态）。两态不冒充 not-found。
 *  #534（T04）anchor-conflict=普通链接同时带冒号行号与非空 fragment 的
 *  混合定位（整次语法非法，附定位冲突原文）。
 *  失败均提供原生打开入口继续 */
export type HoverPreviewFailReason =
  | 'unsupported' | 'no-workspace' | 'escape' | 'not-found' | 'non-markdown' | 'read-failed' | 'anchor-missing' | 'anchor-invalid'
  | 'source-expired' | 'cycle' | 'depth' | 'budget'
  // #340（P3-08）text 通道准入分态（见上方注释）
  | 'binary-file' | 'invalid-encoding' | 'file-too-large' | 'line-too-long'
  // #342（P3-10）外链卡片失败分态族：真实网络失败如实呈现（就地 i18n），
  // 不伪装成文件缺失；语义与矩阵见 shared/webLink 的 WebLinkFailReason
  | 'web-disabled' | 'web-invalid-address' | 'web-timeout' | 'web-too-large' | 'web-not-html' | 'web-redirects' | 'web-unreachable'
  // #556（T3）短名补查分态（见上方注释）
  | 'ambiguous' | 'pending'
  // #534（T04）普通链接混合定位分态（行号 + fragment，见上方注释）
  | 'anchor-conflict'
