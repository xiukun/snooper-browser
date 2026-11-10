/** Immutable request provenance and per-lesson pending drain, shared by audio and frames. */
import type { SourceRef } from '../../lib/knowledge-types'
export interface SourceBinding { sourceRef: SourceRef; pending: number }
export interface SourceEpochOwner {
  tabId: number
  generation: number
  sourceEpoch?: string
  sourceBindings?: Record<string, SourceBinding>
}
export function beginSourceRequest(session: SourceEpochOwner): string | undefined {
  const epoch = session.sourceEpoch
  if (epoch && session.sourceBindings?.[epoch]) session.sourceBindings[epoch]!.pending++
  return epoch
}
export async function drainSourceIfReady(session: SourceEpochOwner, epoch: string | undefined): Promise<void> {
  if (!epoch || epoch === session.sourceEpoch || !session.sourceBindings?.[epoch] || session.sourceBindings[epoch]!.pending) return
  const reply = await chrome.runtime.sendMessage({ type: 'CAPTURE_SOURCE_DRAINED', tabId: session.tabId, generation: session.generation, sourceEpoch: epoch }).catch(() => null)
  if (reply?.ok) delete session.sourceBindings[epoch]
}
export async function endSourceRequest(session: SourceEpochOwner, epoch: string | undefined): Promise<void> {
  if (epoch && session.sourceBindings?.[epoch]) session.sourceBindings[epoch]!.pending--
  await drainSourceIfReady(session, epoch)
}
