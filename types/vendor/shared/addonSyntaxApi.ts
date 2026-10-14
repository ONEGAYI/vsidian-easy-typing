// vendored from ONEGAYI/vsidian@1c7c5283665f5a0b5934478d8d7e3638afab9753 — src/shared/addonSyntaxApi.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

/** 查询面（experimental.syntax 的内容；仅编辑器页提供）。方法按 views
 * 面的实例 ID 寻址（对齐 headingFold/viewIdentity 先例），pos 为全文
 * UTF-16 code unit 偏移（页面全程 LF） */
export interface AddonSyntaxFacet {
  /** 光标处行类型（块级维度；见 AddonSyntaxLineKind） */
  lineTypeAt(instanceId: string, pos: number): AddonSyntaxLineTypeResult
  /** 位置级行内标记：code（行内代码）/ formula（行内或块内公式）/
   * none（普通文本） */
  inlineAt(instanceId: string, pos: number): AddonSyntaxInlineResult
}

export type AddonSyntaxLineTypeResult =
  | ({ ok: true } & AddonSyntaxLineJudge)
  | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }

export type AddonSyntaxInlineResult =
  | ({ ok: true } & AddonSyntaxInlineJudge)
  | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }

/** 查询成功分支：kind + nodeNames 诊断载荷（光标处祖先链节点名快照，
 * 根→叶）。**非稳定**：节点名随解析器升级变化，不构成兼容承诺 */
export interface AddonSyntaxLineJudge {
  kind: AddonSyntaxLineKind
  nodeNames: readonly string[]
}

export interface AddonSyntaxInlineJudge {
  kind: AddonSyntaxInlineKind
  nodeNames: readonly string[]
}

/** 行类型枚举（块级维度；callout 一期不入枚举——live 侧无识别管线，
 * 引用块形态统一 quote，落档见 developer-guide「与 Obsidian 上游语义
 * 对照」节） */
export type AddonSyntaxLineKind =
  | 'frontmatter'
  | 'code'
  | 'formula'
  | 'table'
  | 'heading'
  | 'quote'
  | 'list'
  | 'text'

/** 行内标记枚举（位置级行内维度；none = 普通文本位置） */
export type AddonSyntaxInlineKind = 'code' | 'formula' | 'none'
