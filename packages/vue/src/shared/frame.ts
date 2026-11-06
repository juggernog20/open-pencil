import { useDocumentVisibility } from '@vueuse/core'
import { watch, type Ref } from 'vue'

/** Whether the browser shows the page; shared by every wait. */
const documentVisibility = useDocumentVisibility()

type Visibility = Readonly<Ref<DocumentVisibilityState>>

/**
 * How long `nextFrame` waits for a frame on a page that says it is shown. WebKitGTK reports a
 * window under other windows as visible yet draws it no frames, so a wait for one would last
 * until someone brings the window forward.
 */
const FRAME_WAIT_LIMIT_MS = 250

interface FrameWaitOptions {
  /** Whether the browser shows the page; the document's own by default. */
  visibility?: Visibility
}

export interface NextFrameOptions extends FrameWaitOptions {
  /** How long to wait for the frame before going on without it. */
  limitMs?: number
}

export interface NextShownFrameOptions extends FrameWaitOptions {
  /** Stops waiting, rejecting with the signal's reason, when the work it is for is cancelled. */
  signal?: AbortSignal
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

/**
 * True once a frame runs while the page is shown; false if the page is hidden first, or if
 * `limitMs` passes without a frame.
 */
function frameWhileShown(
  visibility: Visibility,
  signal?: AbortSignal,
  limitMs?: number
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }
    let frame = 0
    let limit: ReturnType<typeof setTimeout> | undefined
    const stop = watch(visibility, (state) => {
      if (state === 'hidden') finish(false)
    })
    const abort = () => {
      cleanup()
      if (signal) reject(abortReason(signal))
    }
    function cleanup() {
      cancelAnimationFrame(frame)
      clearTimeout(limit)
      stop()
      signal?.removeEventListener('abort', abort)
    }
    function finish(drawn: boolean) {
      cleanup()
      resolve(drawn)
    }
    signal?.addEventListener('abort', abort, { once: true })
    // The limit starts first, so a frame callback that runs at once also clears it.
    if (limitMs !== undefined) limit = setTimeout(() => finish(false), limitMs)
    frame = requestAnimationFrame(() => finish(true))
  })
}

/** Resolves once the page is shown. */
function shown(visibility: Visibility, signal?: AbortSignal): Promise<undefined> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }
    if (visibility.value !== 'hidden') {
      resolve(undefined)
      return
    }
    const stop = watch(visibility, (state) => {
      if (state === 'hidden') return
      cleanup()
      resolve(undefined)
    })
    const abort = () => {
      cleanup()
      if (signal) reject(abortReason(signal))
    }
    function cleanup() {
      stop()
      signal?.removeEventListener('abort', abort)
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Lets the page lay out and draw before going on: resolves on the next animation frame. A
 * hidden tab draws no frames and shows nothing, so work started in a background tab, such as
 * opening a file or starting the canvas, goes on at once rather than waiting until the tab is
 * shown again, and a tab hidden while waiting stops waiting. A page that says it is shown but
 * draws no frame within `limitMs` goes on as a hidden one does.
 */
export async function nextFrame(options: NextFrameOptions = {}): Promise<void> {
  const visibility = options.visibility ?? documentVisibility
  if (visibility.value === 'hidden') return
  await frameWhileShown(visibility, undefined, options.limitMs ?? FRAME_WAIT_LIMIT_MS)
}

/**
 * Waits for a frame drawn while the page is shown, by which the canvas has reported its size:
 * a hidden tab reports none. Placing the view, such as fitting a page, waits for this so it
 * uses the canvas's own size, while work before it goes on in a background tab. A tab hidden
 * before its frame waits to be shown again. This wait has no time limit, unlike `nextFrame`: a
 * page that says it is shown but draws no frame, as WebKitGTK does for a covered window, waits
 * until the window is shown, since the view needs the canvas's real size. Opening a file for
 * an agent replies before this wait, through `onReady`.
 */
export async function nextShownFrame(options: NextShownFrameOptions = {}): Promise<void> {
  const visibility = options.visibility ?? documentVisibility
  const { signal } = options
  for (;;) {
    await shown(visibility, signal)
    if (await frameWhileShown(visibility, signal)) return
  }
}
