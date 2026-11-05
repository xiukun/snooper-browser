/**
 * Capture preflight checks and user-facing error hints for mic / tab audio.
 * Mirrors the browser sandbox reality: getUserMedia / getDisplayMedia are
 * gated behind user gestures, permissions, OS-level loopback, and HTTPS.
 */

export type CaptureSupportCode =
  | 'ok'
  | 'unsupported'
  | 'denied'
  | 'loopback'
  | 'unknown'

export interface CaptureSupportResult {
  ok: boolean
  code: CaptureSupportCode
  hint?: string
}

export interface CaptureHint {
  title: string
  detail: string
}

/**
 * Lightweight preflight before calling getUserMedia / getDisplayMedia.
 * Never mutates DOM or triggers permission dialogs by itself.
 */
export async function checkCaptureSupport(): Promise<CaptureSupportResult> {
  try {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return {
        ok: false,
        code: 'unsupported',
        hint: '当前环境不支持媒体采集。请使用 Chromium 内核浏览器并在 HTTPS 或 localhost 访问。',
      }
    }

    const md = navigator.mediaDevices
    if (!(md as MediaDevices & { getUserMedia?: unknown }).getUserMedia) {
      return {
        ok: false,
        code: 'unsupported',
        hint: '当前浏览器不支持麦克风采集（getUserMedia 不可用）。',
      }
    }
    if (!(md as MediaDevices & { getDisplayMedia?: unknown }).getDisplayMedia) {
      return {
        ok: false,
        code: 'unsupported',
        hint: '当前浏览器不支持标签页音频共享（getDisplayMedia 不可用）。',
      }
    }

    if (navigator.permissions?.query) {
      try {
        const micStatus = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        })
        if (micStatus.state === 'denied') {
          return {
            ok: false,
            code: 'denied',
            hint: '麦克风权限已被拒绝。请在浏览器地址栏左侧的权限图标中允许麦克风后重试。',
          }
        }
      } catch {
        /* permission query may fail on some browsers; continue */
      }
    }

    return { ok: true, code: 'ok' }
  } catch {
    return {
      ok: false,
      code: 'unknown',
      hint: '无法确认捕获能力，请稍后重试。',
    }
  }
}

/**
 * Maps a capture-layer exception to a Chinese, action-oriented hint.
 * `kind` selects microphone vs tab wording.
 */
export function mapCaptureErrorToHint(
  err: unknown,
  kind: 'microphone' | 'tab',
): string {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err ?? '')

  if (name === 'NotAllowedError' || /denied|not allowed|permission/i.test(message)) {
    return kind === 'microphone'
      ? '麦克风权限被拒绝。请在浏览器地址栏左侧允许麦克风后重试。'
      : '已取消标签页共享授权。请重新共享并在弹窗中允许访问。'
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return kind === 'microphone'
      ? '未检测到可用麦克风设备，或当前设备被其他应用占用。'
      : '没有可用的共享目标。请检查标签页音频源，或改用麦克风模式。'
  }

  if (name === 'NotReadableError') {
    return '麦克风正被其他程序占用（如通话软件），请先释放后再试。'
  }

  if (name === 'SecurityError' || /loopback|system audio|tab audio/i.test(message)) {
    return '系统音频不可用。macOS 需要虚拟声卡 Loopback（BlackHole/Soundflower），且在屏幕共享设置中勾选「系统声音」。Windows 需在录制设置中启用立体声混音。'
  }

  if (name === 'AbortError') {
    return '已取消本次共享。'
  }

  // tab-audio-missing is detected by the caller when getDisplayMedia returns
  // no audio track; kept as a friendly fallback here.
  if (kind === 'tab') {
    return `无法共享音频：${message || '未知原因'}`
  }

  return message ? `无法访问麦克风：${message}` : '无法访问麦克风'
}

export function tabAudioMissingHint(): string {
  return '已检测到屏幕共享但无音频轨道。请在共享弹窗中勾选「共享标签页音频」，或改用麦克风模式。'
}
