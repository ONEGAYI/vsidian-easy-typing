// 纯文本粘贴命令（工单 #12 命令层）——上游 main.ts:75-83 的 Mod-Shift-v
// 分支（markPaste(true) + return false 落穿宿主纯文本粘贴）在 vsidian 的
// 稳定 API 形态：sdk.commands.register 注册命令（统一快捷键管理 + 命令面
// 板），命中后**置纯文本标记 + 合成纯文本 paste 事件**交既有粘贴链
//（SmartPaste 续接、CM6 多光标行分配、平台过滤器全保留）——合成形态对齐
// 平台 clipboardPaste.ts 的 dispatchClipboardPaste(plain=true)。
//
// 默认键位 Mod+Shift+V 以**规范修饰键序**书写（ctrl→alt→shift→meta）：
// vsidian#417——平台 pastePlain 默认 mac 形态 'meta+shift+v' 非规范序、真实
// 按下永不命中；本命令避开该 bug 形态（'shift+meta+v'）。与平台命令同弦
// 并存的路由序（内置操作先于运行期命令）见规格「平台粘贴冲突核对」节。
//
// 联动缝（#26 格式化管线）：命令置 plainPasteInProgress（500ms 窗口一次性
// 消费），合成事件同步重入粘贴链时标记仍在窗内——#26 观察到该插入事务时
// consumePlainPaste() 跳过自动格式化。平台自身 pastePlain 抢先命中（默认
// 键位在 Windows/Linux）时本命令不运行、标记不置，属已知边界（规格
//「已知边界」节 + 给平台提示）。
import type { Extension } from '@codemirror/state'
import type { EditorView, ViewPlugin } from '@codemirror/view'
import type { AddonChannelOutcome } from '../types/vendor/shared/addonPage'
import type { AddonCommandDefinition } from '../types/vendor/shared/addonCommands'
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
import type { PasteMarker } from './pasteMarker'
import { normalizeClipboardText } from './smartPasteAlgorithm'

/** 命令局部 ID（平台注入命名空间前缀成完整命令 ID） */
export const PLAIN_PASTE_COMMAND_ID = 'paste-plain'

/**
 * 默认绑定（规范修饰键序 ctrl→alt→shift→meta）：mac 形态写作
 * 'shift+meta+v'——'meta+shift+v' 是 vsidian#417 的永不命中形态。
 */
export const PLAIN_PASTE_DEFAULT_BINDINGS: readonly string[] = ['ctrl+shift+v', 'shift+meta+v']

/** 宿主剪贴板读取通道 topic（enable scope；vscode.env.clipboard 回退） */
export const CLIPBOARD_READ_TEXT_TOPIC = 'easyTyping.clipboard.readText'

/** 命令定义（title 经 i18n 字典注入） */
export function buildPlainPasteCommandDefinition(title: string): AddonCommandDefinition {
  return {
    id: PLAIN_PASTE_COMMAND_ID,
    title,
    mode: 'live',
    writes: true,
    defaultBindings: PLAIN_PASTE_DEFAULT_BINDINGS,
  }
}

// ---- 视图捕获：命令回调携带目标句柄（views 面对象），CM6 视图经登记表解析 ----

/** 在场编辑器视图登记表（当前平台附加组件扩展槽仅挂主正文 Live 实例，
 *  嵌入视图不经此登记——登记面以平台装配事实为准）。命令回调的 target
 *  句柄经 viewForInstance 反查解析出本页 CM6 视图（合成 paste 事件的
 *  载体）；登记面外的目标（嵌入/悬停实例）解析为 null。 */
export interface EditorViewRegistry {
  /** 登记视图，返回注销句柄 */
  register(view: EditorView): { dispose(): void }
  /** 按平台实例 ID 解析登记视图：登记视图逐一经 identityOf 反查匹配；
   *  无匹配（ID 非平台实例或未登记）返回 null */
  viewForInstance(instanceId: string): EditorView | null
}

/** 构造视图登记表（identityOf = experimental.viewIdentity 的 instanceIdOf
 *  反查面，page-editor 经箭头包装注入） */
export function createEditorViewRegistry(
  identityOf: (view: EditorView) => string | null,
): EditorViewRegistry {
  const views = new Set<EditorView>()
  return {
    register(view: EditorView) {
      views.add(view)
      return {
        dispose() {
          views.delete(view)
        },
      }
    },
    viewForInstance(instanceId: string) {
      for (const view of views) {
        if (identityOf(view) === instanceId) return view
      }
      return null
    },
  }
}

/**
 * 视图捕获扩展：ViewPlugin 构造/销毁时向登记表登记/移除在场编辑器实例
 *（ViewPlugin 构造器经实验 cm6 运行时注入——src 禁止 @codemirror/* 值导入）。
 */
export function createViewTrackerExtension(
  viewPlugin: typeof ViewPlugin,
  registry: EditorViewRegistry,
): Extension {
  return viewPlugin.fromClass(
    class {
      private readonly handle: { dispose(): void }
      constructor(view: EditorView) {
        this.handle = registry.register(view)
      }
      destroy() {
        this.handle.dispose()
      }
    },
  )
}

// ---- 剪贴板读取：web 优先、宿主通道回退（平台 readClipboardSnapshot 同款双级） ----

/** 剪贴板读取依赖（web 与宿主两级均可注入替换） */
export interface PlainPasteClipboardReaderDeps {
  /** web 剪贴板 text/plain 读取（navigator.clipboard.readText；不可用/受限抛错） */
  readonly webReadText: () => Promise<string>
  /** 宿主通道请求（enable scope 的 CLIPBOARD_READ_TEXT_TOPIC；vscode.env.clipboard） */
  readonly channelRequest: (topic: string) => Promise<AddonChannelOutcome>
}

/**
 * 构造剪贴板文本读取器：navigator.clipboard.readText 优先，缺失或权限
 * 受限时经组件通道回退宿主 vscode.env.clipboard.readText（对齐平台
 * 「权限受限时仅回退宿主 text/plain」口径）；两级都失败返回空串（静默）。
 */
export function buildPlainPasteClipboardReader(deps: PlainPasteClipboardReaderDeps): () => Promise<string> {
  return async () => {
    try {
      return await deps.webReadText()
    } catch {
      // web 级不可用 → 宿主回退
    }
    const outcome = await deps.channelRequest(CLIPBOARD_READ_TEXT_TOPIC)
    return outcome.ok && typeof outcome.result === 'string' ? outcome.result : ''
  }
}

/** 浏览器默认 web 读取器（页面装配注入；node 测试注入替身） */
export function defaultWebReadText(): () => Promise<string> {
  return () => {
    const clipboard: Clipboard | undefined =
      typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      return Promise.reject(new Error('navigator.clipboard.readText unavailable'))
    }
    return clipboard.readText()
  }
}

// ---- 派发：合成纯文本 paste 事件交既有粘贴链 ----

/**
 * 在目标视图上派发纯文本粘贴事件：合成 paste 事件（clipboardData 仅
 * text/plain，不带 html/图片）冒泡到 contentDOM，交既有粘贴处理链
 *（平台富文本/图片处理器自然放行 → SmartPaste 续接 → CM6 doPaste 多光标
 * 行分配）——形态对齐平台 clipboardPaste.ts dispatchClipboardPaste(plain)。
 * 返回事件是否被消费（defaultPrevented）。
 */
export function dispatchPlainPasteEvent(view: EditorView, text: string): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
      types: ['text/plain'],
      files: [],
      items: [],
    },
  })
  view.contentDOM.dispatchEvent(event)
  view.focus()
  return event.defaultPrevented
}

// ---- 命令执行流 ----

/** 命令依赖（全部可注入；页面装配接生产实现，测试接替身） */
export interface PlainPasteCommandDeps {
  readonly marker: PasteMarker
  readonly views: EditorViewRegistry
  readonly readClipboardText: () => Promise<string>
  readonly dispatchPlainPaste: (view: EditorView, text: string) => boolean
}

/**
 * 产出命令回调（target = 平台解析的目标视图句柄，PR #432 起命令回调
 * 携带）：句柄实例 ID 经登记表解析本页 CM6 视图 → 读剪贴板 text/plain
 * → 置纯文本标记 → 合成纯文本粘贴事件（同步重入粘贴链，标记在窗内被
 * #26 观察）。无活动视图（target null）/目标实例不在登记面（嵌入/悬停
 * ——扩展槽未装配，无本页视图可合成事件）/无文本/组合中/只读一律静默
 * 无动作（不标记不派发）。
 */
export function createPlainPasteCommandHandler(
  deps: PlainPasteCommandDeps,
): (target: AddonViewHandle | null) => void {
  return (target) => {
    if (target === null) return
    const view = deps.views.viewForInstance(target.info.instanceId)
    if (view === null) return
    if (view.compositionStarted || view.state.readOnly) return
    void deps
      .readClipboardText()
      .then((text) => {
        const normalized = normalizeClipboardText(text)
        if (normalized.length === 0) return
        // 先置标记再派发：合成事件同步重入粘贴链，事务发生时标记在窗内
        deps.marker.markPaste(true)
        deps.dispatchPlainPaste(view, normalized)
      })
      .catch(() => {
        // 剪贴板不可读：静默放弃（无用户可行动的提示面）
      })
  }
}
