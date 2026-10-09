// vendored from ONEGAYI/vsidian@9107e2f0554d8b5c1637d16e1d1b375543b01c1c — src/shared/officialAddons.ts
// 类型快照：由 scripts/vendorSdkTypes.mjs 自动生成——仅保留类型声明与被
// 类型引用的常量，值级导出（校验函数、运行时数据）已剥离。不要手改；
// re-vendor：npm run vendor:sdk（升级锚定提交改脚本 DEFAULT_COMMIT 后重跑）。

// #354 T05 官方（核心）附加组件登记表——可维护形态的事实源。
//
// 形态约定（ADR-0012「侧栏结构」：官方归属的具体识别方式尚待设计，本票
// 落地为「主仓库维护的明确扩展 ID 清单」的可维护结构）：
// - 登记 official 组件**只改本表**：每条一个官方扩展 ID（publisher.name，
//   与 VSCode Extension.id 同形）+ 可选备注（用途/发布仓线索，不参与判定）。
// - 官方归属判定唯一入口是 isOfficialAddon（addonIdentity.ts 再导出消费）：
//   只查本表，不读组件自称（keywords、displayName、身份声明内无官方字段
//   ——第三方不能自行声明「核心」，ADR-0012 已确认）。
// - 清单随主仓库一起审查与发布；addon 清单为空时设置页「核心组件」组
//   呈现空态（分组结构在场，不因空清单消失）。
// - 本表不是已发布 API：登记内容变化不构成兼容性承诺（第三方不得依据
//   「曾在表内/表外」主张任何契约）。

/** 官方附加组件登记条目（extensionId 是判定键；label 备注不参与判定） */
export interface OfficialAddonEntry {
  /** 官方组件的 VSCode 扩展 ID（publisher.name） */
  readonly extensionId: string
  /** 维护备注（用途或发布仓线索；仅文档性质） */
  readonly label?: string
}
