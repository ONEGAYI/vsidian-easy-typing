// 纯文本粘贴命令单元测试（工单 #12 命令层）——命令定义契约（稳定 API
// 注册形状：id/mode/writes/默认键位规范序）与命令执行流（标记 → 读剪贴板
// → 合成纯文本 paste 事件）的单元化验证。上游对照 main.ts:75-83
//（Mod-Shift-v 标记 + return false 落穿宿主纯文本粘贴）。浏览器真实剪贴板
// 端到端归 #21；派发默认实现（合成 DOM 事件）的形态见
// docs/specs/smart-paste.md「平台映射」节。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { AddonViewHandle } from '../types/vendor/shared/addonEditApi'
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
  function fakeTrackedView(id: string) {
    return { id, state: EditorState.create({ doc: '' }) } as unknown as EditorView
  }

  const identityOf = (view: EditorView) => (view as unknown as { id: string }).id

  it('按平台实例 ID 解析登记视图（identityOf 反查匹配）', () => {
    const registry = createEditorViewRegistry(identityOf)
    const main = fakeTrackedView('main')
    registry.register(main)
    expect(registry.viewForInstance('main')).toBe(main)
    // 未登记的实例 ID（嵌入/悬停实例——扩展槽未装配，不在登记面）→ null
    expect(registry.viewForInstance('embed:host-1')).toBeNull()
  })

  it('ViewPlugin 构造登记、销毁移除（扩展实例随视图生命周期回收）', () => {
    const registry = createEditorViewRegistry(identityOf)
    const extension = createViewTrackerExtension(ViewPlugin, registry)
    expect(typeof extension).toBe('object')
    // 扩展形态本身无法在 node 下实例化视图，登记/移除语义经 registry 直测：
    // dispose 句柄移除后按 ID 不再解析到该视图
    const view = fakeTrackedView('main')
    const handle = registry.register(view)
    expect(registry.viewForInstance('main')).toBe(view)
    handle.dispose()
    expect(registry.viewForInstance('main')).toBeNull()
  })

  it('identityOf 反查 null 的视图不可解析（非平台实例防御面）', () => {
    const registry = createEditorViewRegistry(() => null)
    registry.register(fakeTrackedView('whatever'))
    expect(registry.viewForInstance('whatever')).toBeNull()
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

describe('命令执行流：目标句柄 → 标记 → 读剪贴板 → 合成纯文本粘贴事件', () => {
  function fakeCmdView(id: string, overrides: Partial<{ compositionStarted: boolean; readOnly: boolean }> = {}) {
    const state = EditorState.create({
      doc: '- item',
      ...(overrides.readOnly ? { extensions: [EditorState.readOnly.of(true)] } : {}),
      selection: { anchor: 6 },
    })
    return {
      id,
      state,
      compositionStarted: false,
      ...overrides,
    } as unknown as EditorView
  }

  /** 平台命令回调的目标视图句柄替身（info 形状对齐 AddonViewInfo） */
  function fakeHandle(instanceId: string): AddonViewHandle {
    return {
      info: {
        instanceId,
        targetDocUri: `doc:${instanceId}`,
        mode: 'live',
        viewType: instanceId === 'main' ? 'main' : 'embed',
        editable: true,
      },
      editor: {} as AddonViewHandle['editor'],
    }
  }

  function setup(viewIds: readonly string[], text: string) {
    const marker = createPasteMarker({ now: () => 0 })
    const registry = createEditorViewRegistry((view) => (view as unknown as { id: string }).id)
    const viewsById = new Map<string, EditorView>()
    for (const id of viewIds) {
      const view = fakeCmdView(id)
      viewsById.set(id, view)
      registry.register(view)
    }
    const dispatched: Array<{ view: EditorView; text: string }> = []
    const handler = createPlainPasteCommandHandler({
      marker,
      views: registry,
      readClipboardText: async () => text,
      dispatchPlainPaste: (view, t) => {
        dispatched.push({ view, text: t })
        return true
      },
    })
    return { marker, handler, dispatched, viewsById }
  }

  it('完整流：置纯文本标记 → 读剪贴板 → 在目标视图派发（CRLF 归一）', async () => {
    const { marker, handler, dispatched, viewsById } = setup(['main'], 'aa\r\nbb')
    handler(fakeHandle('main'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.plainPasteInProgress).toBe(true)
    expect(marker.pasteDetected).toBe(true)
    expect(dispatched).toEqual([{ view: viewsById.get('main'), text: 'aa\nbb' }])
  })

  it('目标为嵌入实例句柄（扩展槽未装配、登记面外）→ 静默放弃：不标记不派发', async () => {
    // 纯文本粘贴须向在场 CM6 视图的 contentDOM 合成 paste 事件（整条粘贴
    // 链——平台过滤器/SmartPaste/多光标分配——都装配在本页视图上）；
    // 嵌入目标无本组件扩展实例即无合成载体，不误向主文档兜底派发
    const { marker, handler, dispatched } = setup(['main'], 'aa')
    handler(fakeHandle('embed:host-1'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.plainPasteInProgress).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('无活动视图（target null）→ 全链不动作（不标记不派发）', async () => {
    const { marker, handler, dispatched } = setup(['main'], 'aa')
    handler(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.pasteDetected).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('剪贴板无文本（空串）→ 不标记不派发（无文本纯文本粘贴 = 无操作）', async () => {
    const { marker, handler, dispatched } = setup(['main'], '')
    handler(fakeHandle('main'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.pasteDetected).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('读取失败 → 静默无动作（不标记不派发）', async () => {
    const marker = createPasteMarker({ now: () => 0 })
    const registry = createEditorViewRegistry((view) => (view as unknown as { id: string }).id)
    registry.register(fakeCmdView('main'))
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
    handler(fakeHandle('main'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(marker.pasteDetected).toBe(false)
    expect(dispatched).toHaveLength(0)
  })

  it('IME 组合中 / 只读视图 → 不动作（平台粘贴守卫同口径）', async () => {
    for (const overrides of [{ compositionStarted: true }, { readOnly: true }] as const) {
      const marker = createPasteMarker({ now: () => 0 })
      const registry = createEditorViewRegistry((view) => (view as unknown as { id: string }).id)
      const view = fakeCmdView('main', overrides)
      registry.register(view)
      const dispatched: unknown[] = []
      const handler = createPlainPasteCommandHandler({
        marker,
        views: registry,
        readClipboardText: async () => 'aa',
        dispatchPlainPaste: (v, t) => {
          dispatched.push({ v, t })
          return true
        },
      })
      handler(fakeHandle('main'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(marker.pasteDetected).toBe(false)
      expect(dispatched).toHaveLength(0)
    }
  })
})
