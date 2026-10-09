// 纯文本粘贴命令单元测试（工单 #12 命令层）——命令定义契约（稳定 API
// 注册形状：id/mode/writes/默认键位规范序）与命令执行流（标记 → 读剪贴板
// → 合成纯文本 paste 事件）的单元化验证。上游对照 main.ts:75-83
//（Mod-Shift-v 标记 + return false 落穿宿主纯文本粘贴）。浏览器真实剪贴板
// 端到端归 #21；派发默认实现（合成 DOM 事件）的形态见
// docs/specs/smart-paste.md「平台映射」节。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  buildPlainPasteClipboardReader,
  buildPlainPasteCommandDefinition,
  CLIPBOARD_READ_TEXT_TOPIC,
  createEditorViewRegistry,
  createPlainPasteCommandHandler,
  createViewTrackerExtension,
  PLAIN_PASTE_COMMAND_ID,
  PLAIN_PASTE_DEFAULT_BINDINGS,
} from '../src/plainPasteCommand'
import { createPasteMarker } from '../src/pasteMarker'
import { ViewPlugin } from '@codemirror/view'

/** 规范修饰键序（vsidian normalizeChord 归一序：ctrl→alt→shift→meta） */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta']

/** 每个默认绑定必须已是规范序书写（避开 vsidian#417 的永不命中形态） */
function isCanonicalChord(chord: string): boolean {
  return chord.split(' ').every((step) => {
    const parts = step.split('+')
    const modifiers = parts.slice(0, -1)
    const indices = modifiers.map((m) => MODIFIER_ORDER.indexOf(m))
    return indices.every((i) => i >= 0) &&
      indices.every((i, k) => k === 0 || indices[k - 1]! < i) &&
      parts.length === modifiers.length + 1
  })
}

describe('命令定义契约（稳定 API 注册形状）', () => {
  it('id 局部无点号、mode live、writes true（写操作仅 Live 正文接管宿主绑定）', () => {
    const def = buildPlainPasteCommandDefinition('纯文本粘贴（跳过自动格式化）')
    expect(def.id).toBe(PLAIN_PASTE_COMMAND_ID)
    expect(def.id).not.toContain('.')
    expect(def.mode).toBe('live')
    expect(def.writes).toBe(true)
    expect(def.title).toBe('纯文本粘贴（跳过自动格式化）')
  })

  it('默认键位 Mod+Shift+V 且为规范序书写（ctrl+shift+v / shift+meta+v）', () => {
    expect(PLAIN_PASTE_DEFAULT_BINDINGS).toEqual(['ctrl+shift+v', 'shift+meta+v'])
    for (const chord of PLAIN_PASTE_DEFAULT_BINDINGS) {
      expect(isCanonicalChord(chord), chord).toBe(true)
    }
    // 钉住 #417 的 bug 形态不在场（meta+shift+v 非规范序永不命中）
    expect(PLAIN_PASTE_DEFAULT_BINDINGS).not.toContain('meta+shift+v')
  })
})

describe('createEditorViewRegistry + createViewTrackerExtension：视图捕获', () => {
  function fakeTrackedView(hasFocus: boolean, id: string) {
    return { id, hasFocus, state: EditorState.create({ doc: '' }) } as unknown as EditorView
  }

  it('登记顺序内活跃视图优先取聚焦者；无聚焦且唯一在场视图可兜底', () => {
    const registry = createEditorViewRegistry()
    const a = fakeTrackedView(false, 'a')
    const b = fakeTrackedView(true, 'b')
    registry.register(a)
    registry.register(b)
    expect(registry.activeView()).toBe(b)
    const registry2 = createEditorViewRegistry()
    const only = fakeTrackedView(false, 'only')
    registry2.register(only)
    expect(registry2.activeView()).toBe(only)
  })

  it('多视图无聚焦 → null（命令面板入口不误指定目标）', () => {
    const registry = createEditorViewRegistry()
    registry.register(fakeTrackedView(false, 'a'))
    registry.register(fakeTrackedView(false, 'b'))
    expect(registry.activeView()).toBeNull()
  })

  it('ViewPlugin 构造登记、销毁移除（扩展实例随视图生命周期回收）', () => {
    const registry = createEditorViewRegistry()
    const extension = createViewTrackerExtension(ViewPlugin, registry)
    expect(typeof extension).toBe('object')
    // 扩展形态本身无法在 node 下实例化视图，登记/移除语义经 registry 直测：
    // dispose 句柄移除后 activeView 不再返回该视图
    const view = fakeTrackedView(true, 'only')
    const handle = registry.register(view)
    expect(registry.activeView()).toBe(view)
    handle.dispose()
    expect(registry.activeView()).toBeNull()
  })

  it('contains：登记视图 true，未登记视图 false（审查 B-F3 嵌入视图判别面）', () => {
    const registry = createEditorViewRegistry()
    const main = fakeTrackedView(false, 'main')
    registry.register(main)
    expect(registry.contains(main)).toBe(true)
    expect(registry.contains(fakeTrackedView(true, 'embed'))).toBe(false)
  })
})

describe('buildPlainPasteClipboardReader：剪贴板读取与宿主回退', () => {
  it('web clipboard 可用 → readText 直取', async () => {
    const reader = buildPlainPasteClipboardReader({
      webReadText: async () => 'web text',
      channelRequest: async () => {
        throw new Error('不应回退')
      },
    })
    expect(await reader()).toBe('web text')
  })

  it('web clipboard 不可用或权限受限 → 宿主通道回退（CLIPBOARD_READ_TEXT_TOPIC）', async () => {
    const reader = buildPlainPasteClipboardReader({
      webReadText: async () => {
        throw new Error('permission denied')
      },
      channelRequest: async (topic) => {
        expect(topic).toBe(CLIPBOARD_READ_TEXT_TOPIC)
        return { ok: true, result: 'host text' }
      },
    })
    expect(await reader()).toBe('host text')
  })

  it('两级都失败 → 空串（静默，不抛错）', async () => {
    const reader = buildPlainPasteClipboardReader({
      webReadText: async () => {
        throw new Error('permission denied')
      },
      channelRequest: async () => ({ ok: false, reason: 'rejected' }),
    })
    expect(await reader()).toBe('')
  })
})

describe('命令执行流：标记 → 读剪贴板 → 合成纯文本粘贴事件', () => {
  function fakeCmdView(overrides: Partial<{ compositionStarted: boolean; readOnly: boolean }> = {}) {
    const state = EditorState.create({
      doc: '- item',
      ...(overrides.readOnly ? { extensions: [EditorState.readOnly.of(true)] } : {}),
      selection: { anchor: 6 },
    })
    return {
      state,
      compositionStarted: false,
      ...overrides,
    } as unknown as EditorView
  }

  function setup(views: EditorView[], text: string, options: Partial<{ getFocusedView: () => EditorView | null }> = {}) {
    const marker = createPasteMarker({ now: () => 0 })
    const registry = createEditorViewRegistry()
    for (const view of views) registry.register(view)
    const dispatched: Array<{ view: EditorView; text: string }> = []
    const handler = createPlainPasteCommandHandler({
      marker,
      views: registry,
      ...(options.getFocusedView !== undefined ? { getFocusedView: options.getFocusedView } : {}),
      readClipboardText: async () => text,
      dispatchPlainPaste: (view, t) => {
        dispatched.push({ view, text: t })
        return true
      },
    })
    return { marker, handler, dispatched }
  }

  it('完整流：置纯文本标记 → 读剪贴板 → 在聚焦视图派发（CRLF 归一）', async () => {
    const view = fakeCmdView()
    const { marker, handler, dispatched } = setup([view], 'aa\r\nbb')
    handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.plainPasteInProgress).toBe(true)
    expect(marker.pasteDetected).toBe(true)
    expect(dispatched).toEqual([{ view, text: 'aa\nbb' }])
  })

  it('聚焦视图不在登记表（嵌入 Live 视图）→ 拒绝执行：不标记不派发、不误写主文档兜底（审查 B-F3）', async () => {
    // 平台事实：附加组件扩展槽仅挂主正文 Live 实例，嵌入视图不经
    // viewRegistry 登记——焦点在嵌入视图时用户意图是嵌入文档，唯一在场
    // 视图兜底会把命令写到主文档（误目标），拒绝执行并留痕
    const main = fakeCmdView()
    const embed = fakeCmdView()
    const { marker, handler, dispatched } = setup([main], 'aa', {
      getFocusedView: () => embed,
    })
    handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.plainPasteInProgress).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('无在场视图 → 全链不动作（不标记不派发）', async () => {
    const { marker, handler, dispatched } = setup([], 'aa')
    handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.pasteDetected).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('剪贴板无文本（空串）→ 不标记不派发（无文本纯文本粘贴 = 无操作）', async () => {
    const view = fakeCmdView()
    const { marker, handler, dispatched } = setup([view], '')
    handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.pasteDetected).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('读取失败 → 静默无动作（不标记不派发）', async () => {
    const view = fakeCmdView()
    const marker = createPasteMarker({ now: () => 0 })
    const registry = createEditorViewRegistry()
    registry.register(view)
    const dispatched: unknown[] = []
    const handler = createPlainPasteCommandHandler({
      marker,
      views: registry,
      readClipboardText: async () => {
        throw new Error('clipboard unavailable')
      },
      dispatchPlainPaste: (v, t) => {
        dispatched.push({ v, t })
        return true
      },
    })
    handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.pasteDetected).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('IME 组合中 / 只读视图 → 不动作（平台粘贴守卫同口径）', async () => {
    for (const overrides of [{ compositionStarted: true }, { readOnly: true }] as const) {
      const view = fakeCmdView(overrides)
      const { marker, handler, dispatched } = setup([view], 'aa')
      handler()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(marker.pasteDetected).toBe(false)
      expect(dispatched).toHaveLength(0)
    }
  })
})
