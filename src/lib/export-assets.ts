/**
 * Shared export payload helpers: binary asset decoding and a minimal
 * store-only ZIP writer (no runtime dependencies).
 *
 * Everything here is pure or browser-primitive only, so both the content
 * script and the side panel can bundle it, and script tests can exercise it
 * under Node.
 */

import type { NoteDocument } from './types'

export interface ExportAsset {
  /** Stable id used to reference the asset from Markdown text. */
  entryId: string
  fileName: string
  /** Image MIME type, or `image/svg+xml` for raw SVG. */
  mimeType: string
  /** Data URL for raster images (`data:<mime>;base64,<payload>`). */
  dataUrl?: string
  /** Raw SVG markup when mimeType is `image/svg+xml`. */
  svgText?: string
}

export interface ExportFile {
  name: string
  bytes: Uint8Array
}

export interface AssetDecodeResult {
  file: ExportFile
}

/** Decode one asset into raw bytes. Returns null when it cannot be materialized. */
export function decodeExportAsset(asset: ExportAsset): AssetDecodeResult | null {
  if (asset.mimeType === 'image/svg+xml' && asset.svgText) {
    return { file: { name: asset.fileName, bytes: new TextEncoder().encode(asset.svgText) } }
  }
  const dataUrl = asset.dataUrl || ''
  const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  const mime = match[1] || 'image/png'
  if (mime !== asset.mimeType) return null
  try {
    const binary = atob(match[2] || '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { file: { name: asset.fileName, bytes } }
  } catch {
    return null
  }
}

/* ===== Minimal store-only ZIP ===== */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  nameBytes: Uint8Array
  crc: number
  size: number
  offset: number
  bytes: Uint8Array
}

/**
 * Build a store-only (no compression) ZIP from UTF-8 text and binary entries.
 * A ZIP this simple is deterministic and observable: the test asserts real
 * member names, sizes, and round-trip CRCs instead of trusting the writer.
 */
export function buildZip(files: ExportFile[]): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const entries: ZipEntry[] = []
  let offset = 0

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes)
    offset += bytes.length
  }

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.bytes)
    const size = file.bytes.length
    const header = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true) // local file header
    view.setUint16(4, 20, true) // version needed
    view.setUint16(6, 0x0800, true) // UTF-8 names
    view.setUint16(8, 0, true) // store
    view.setUint16(10, 0, true) // time
    view.setUint16(12, 0x21, true) // date (1980-01-01)
    view.setUint32(14, crc, true)
    view.setUint32(18, size, true)
    view.setUint32(22, size, true)
    view.setUint16(26, nameBytes.length, true)
    view.setUint16(28, 0, true)
    header.set(nameBytes, 30)
    push(header)
    push(file.bytes)
    entries.push({ nameBytes, crc, size, offset: offset - size, bytes: file.bytes })
  }

  const centralStart = offset
  for (const entry of entries) {
    const central = new Uint8Array(46 + entry.nameBytes.length)
    const view = new DataView(central.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0x21, true)
    view.setUint32(16, entry.crc, true)
    view.setUint32(20, entry.size, true)
    view.setUint32(24, entry.size, true)
    view.setUint16(28, entry.nameBytes.length, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 0, true)
    view.setUint32(38, 0, true)
    view.setUint32(42, entry.offset, true)
    central.set(entry.nameBytes, 46)
    push(central)
  }

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, offset - centralStart, true)
  endView.setUint32(16, centralStart, true)
  push(end)

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let position = 0
  for (const chunk of chunks) {
    out.set(chunk, position)
    position += chunk.length
  }
  return out
}

/* ===== Asset collection (notes + chat images) ===== */

export interface CollectOptions {
  /** Files already collected, keyed by name, when merging several sources. */
  existingNames?: Set<string>
}

/**
 * Collect image assets from notes and chat messages. Shared by the page
 * transcript export, the side-panel note export, and the Obsidian bridge so
 * every path uses identical naming and MIME rules.
 */
export function collectAssets(
  notes: NoteDocument[],
  messages: Array<{ images?: string[] }>,
  options: CollectOptions = {},
): ExportAsset[] {
  const assets: ExportAsset[] = []
  const used = options.existingNames || new Set<string>()
  const stamp = Date.now()
  const uniqueName = (base: string, ext: string): string => {
    let index = assets.length + 1
    let name = `${base}-${stamp}-${index}.${ext}`
    while (used.has(name)) {
      index += 1
      name = `${base}-${stamp}-${index}.${ext}`
    }
    used.add(name)
    return name
  }
  const extFor = (mime: string): string =>
    mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : mime.includes('svg') ? 'svg' : 'png'

  notes.forEach((note) => note.entries.forEach((entry) => {
    const entryId = `note:${note.id}:${entry.id}`
    if ((entry.type === 'image' || entry.type === 'screenshot') && entry.imageUrl?.startsWith('data:')) {
      const mime = /^data:([^;,]+)/.exec(entry.imageUrl)?.[1] || 'image/png'
      assets.push({
        entryId,
        fileName: uniqueName('snooper', extFor(mime)),
        mimeType: mime,
        dataUrl: entry.imageUrl,
      })
    } else if (entry.type === 'svg' && entry.svg) {
      assets.push({
        entryId,
        fileName: uniqueName('snooper', 'svg'),
        mimeType: 'image/svg+xml',
        svgText: entry.svg,
      })
    }
  }))
  messages.forEach((message, messageIndex) => (message.images || []).forEach((image, imageIndex) => {
    if (!image.startsWith('data:')) return
    const mime = /^data:([^;,]+)/.exec(image)?.[1] || 'image/png'
    assets.push({
      entryId: `chat:${messageIndex}:${imageIndex}`,
      fileName: uniqueName('snooper-chat', extFor(mime)),
      mimeType: mime,
      dataUrl: image,
    })
  }))
  return assets
}

/** Format bytes for a human-facing toast. */
export function formatBytes(total: number): string {
  if (total >= 1024 * 1024) return `${(total / (1024 * 1024)).toFixed(1)} MB`
  if (total >= 1024) return `${Math.round(total / 1024)} KB`
  return `${total} B`
}
