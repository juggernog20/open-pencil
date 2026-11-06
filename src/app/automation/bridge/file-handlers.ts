import { dirname } from '@tauri-apps/api/path'
import { mkdir } from '@tauri-apps/plugin-fs'
import * as v from 'valibot'

import { parseToolArgs } from '@open-pencil/core/tools'

import {
  resolveAutomationTarget,
  responseWithTarget,
  type AutomationTarget
} from '@/app/automation/bridge/target'
import { resolveBrowserFileURL } from '@/app/document/io/browser'
import type { EditorStore } from '@/app/editor/active-store'
import { createDeferred } from '@/app/runtime/deferred'
import { openBrowserFileFromURL } from '@/app/shell/menu/files'
import { openFileFromPath } from '@/app/shell/menu/use'
import { closeTab, createTab, getActiveStore, getTabById, type OpenFileOptions } from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'

/** Where a browser app reads and writes the paths the file tools name: the MCP server's `/files/`. */
export interface AutomationFiles {
  url: (path: string) => URL
  headers: Record<string, string>
}

const saveArgsSchema = v.object({ path: v.optional(v.string()) })

/**
 * Opens a file and settles once its first page is in place, with the store it opened into, or
 * once the open itself settles. Opening waits for the canvas to show the page, and a window
 * nobody shows draws nothing, so an agent would wait until someone brings the app forward.
 * Past that point the open goes on, and a failure shows in its tab as it does for a person.
 */
async function openUntilReady(
  open: (options: OpenFileOptions) => Promise<void>
): Promise<EditorStore | undefined> {
  const ready = createDeferred<EditorStore>()
  let isReady = false
  const opening = open({
    onReady: (store) => {
      isReady = true
      ready.resolve(store)
    }
  })
  void opening.catch((error: unknown) => {
    if (isReady) console.warn('[Automation] An opened file failed to show', error)
  })
  return Promise.race([ready.promise, opening.then(() => undefined)])
}

const closeArgsSchema = v.object({
  path: v.optional(v.string()),
  unsaved: v.optional(v.picklist(['error', 'save', 'discard']), 'error')
})

export async function ensureTauriParentDirectory(path: string): Promise<void> {
  if (!isTauri()) return
  const dir = await dirname(path)
  if (dir === path) return
  await mkdir(dir, { recursive: true })
}

/**
 * The file commands. `files` is the MCP server a browser app reads and writes paths through;
 * without one, as in-process on the landing page, a browser path is a URL beside the page.
 */
export function createFileHandlers(files?: AutomationFiles) {
  /**
   * A browser cannot write the path, so the MCP server writes a copy there, and the document
   * counts as saved as after a download.
   */
  async function writeThroughServer(
    server: AutomationFiles,
    path: string,
    data: Uint8Array
  ): Promise<void> {
    const response = await fetch(server.url(path), {
      method: 'PUT',
      headers: { ...server.headers, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(data)
    })
    if (!response.ok) throw new Error(`Could not write ${path}: ${await response.text()}`)
  }

  // Automation never opens the Save dialog: nobody may be there to answer it.
  async function saveWithoutPrompt(store: AutomationTarget['store'], path?: string): Promise<void> {
    const name = store.state.documentName
    if (!path && !store.hasWritableSource()) {
      throw new Error(`"${name}" has not been saved to a file yet; pass a path to save it`)
    }
    if (path && files && !isTauri()) {
      await store.saveFigFileCopy((data) => writeThroughServer(files, path, data))
      return
    }
    if (path) await ensureTauriParentDirectory(path)
    // A failed save to a new path leaves the document with the source it had.
    const saved = path ? await store.saveFigFileToPath(path) : await store.saveFigFile()
    if (!saved) throw new Error(`Could not save "${name}"`)
  }

  async function handleSaveFile(target: AutomationTarget, args: unknown): Promise<unknown> {
    const { path } = parseToolArgs('save_file', saveArgsSchema, args)
    await saveWithoutPrompt(target.store, path)
    return { ok: true, result: { saved: true } }
  }

  async function handleCloseFile(target: AutomationTarget, args: unknown): Promise<unknown> {
    const { path, unsaved } = parseToolArgs('close_file', closeArgsSchema, args)
    const store = target.store
    if (store.hasUnsavedChanges()) {
      if (unsaved === 'error') {
        throw new Error(
          `"${store.state.documentName}" has unsaved changes. ` +
            'Save or discard them: CLI --save or --discard, MCP unsaved "save" or "discard"'
        )
      }
      if (unsaved === 'save') await saveWithoutPrompt(store, path)
    }
    await closeTab(target.documentId, unsaved === 'discard' ? 'discard' : 'save')
    return { ok: true, result: { closed: getTabById(target.documentId) === undefined } }
  }

  async function handleNewDocument(_target: AutomationTarget, args: unknown): Promise<unknown> {
    const { path } = parseToolArgs('new_document', saveArgsSchema, args)
    const tab = createTab()
    if (path) {
      try {
        await saveWithoutPrompt(tab.store, path)
      } catch (error) {
        await closeTab(tab.id, 'discard')
        throw error
      }
    }
    const target = resolveAutomationTarget(tab.store, { document_id: tab.id })
    return responseWithTarget({ ok: true, result: { created: true } }, target)
  }

  async function handleOpenFile(_target: AutomationTarget, args: unknown): Promise<unknown> {
    const path = (args as { path?: string }).path
    if (!path) throw new Error('Missing "path" in args')
    const opened = await openUntilReady((options) => {
      if (isTauri()) return openFileFromPath(path, options)
      // The browser cannot read the path, so it fetches it from the MCP server, with the same
      // cap and format check as every other browser open.
      if (files) return openBrowserFileFromURL(files.url(path), { headers: files.headers }, options)
      return openBrowserFileFromURL(resolveBrowserFileURL(path), undefined, options)
    })
    const target = resolveAutomationTarget(opened ?? getActiveStore(), undefined)
    return responseWithTarget({ ok: true, result: { opened: true } }, target)
  }

  return { handleSaveFile, handleCloseFile, handleNewDocument, handleOpenFile }
}
