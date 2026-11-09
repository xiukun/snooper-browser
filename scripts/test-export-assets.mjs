/**
 * Regression tests for shared export assets: Base64 image decoding, the
 * store-only ZIP writer, and asset collection from notes/chat messages.
 *
 * ZIP output is verified structurally (signatures, member names, sizes,
 * round-trip CRC) instead of trusting the writer's own bookkeeping.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-export-assets-'))
const out = join(outDir, 'export-assets.mjs')

try {
  execSync(
    `npx esbuild src/lib/export-assets.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const {
    buildZip,
    collectAssets,
    decodeExportAsset,
  } = await import(pathToFileURL(out).href)

  let passed = 0
  const failures = []
  const check = (name, actual, expected) => {
    if (actual === expected) passed++
    else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }

  /* ---------- decodeExportAsset ---------- */
  {
    const pngByte = 0x89
    const dataUrl = `data:image/png;base64,${Buffer.from([pngByte, 0x50, 0x4e, 0x47]).toString('base64')}`
    const decoded = decodeExportAsset({ entryId: 'a', fileName: 'a.png', mimeType: 'image/png', dataUrl })
    check('decode: png decodes', decoded?.file.bytes[0], pngByte)
    check('decode: png length', decoded?.file.bytes.length, 4)

    const svg = decodeExportAsset({
      entryId: 'b',
      fileName: 'b.svg',
      mimeType: 'image/svg+xml',
      svgText: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    })
    check('decode: svg decodes', new TextDecoder().decode(svg.file.bytes).startsWith('<svg'), true)

    check('decode: wrong mime rejected', decodeExportAsset({
      entryId: 'c',
      fileName: 'c.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/jpeg;base64,AAAA',
    }), null)
    check('decode: non-base64 data url rejected', decodeExportAsset({
      entryId: 'd',
      fileName: 'd.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png,notbase64',
    }), null)
    check('decode: missing payload rejected', decodeExportAsset({
      entryId: 'e',
      fileName: 'e.png',
      mimeType: 'image/png',
    }), null)
  }

  /* ---------- collectAssets ---------- */
  {
    const note = {
      id: 'n1',
      title: 't',
      createdAt: 1,
      updatedAt: 1,
      entries: [
        { id: 'e1', type: 'screenshot', at: 1, imageUrl: 'data:image/png;base64,AAAA' },
        { id: 'e2', type: 'svg', at: 2, svg: '<svg/>' },
        { id: 'e3', type: 'text', at: 3, text: 'plain' },
      ],
    }
    const assets = collectAssets([note], [{ images: ['data:image/webp;base64,BBBB'] }])
    check('collect: count', assets.length, 3)
    check('collect: png name', assets[0].fileName.endsWith('.png'), true)
    check('collect: svg name', assets[1].fileName.endsWith('.svg'), true)
    check('collect: chat webp', assets[2].fileName.endsWith('.webp'), true)
    check('collect: unique names', new Set(assets.map((asset) => asset.fileName)).size, 3)
  }

  /* ---------- buildZip structural verification ---------- */
  {
    const zip = buildZip([
      { name: 'record.md', bytes: new TextEncoder().encode('# hello\n\nbody') },
      { name: 'assets/a.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    ])

    check('zip: signature', zip[0] === 0x50 && zip[1] === 0x4b, true)

    // Walk local headers and verify each member's name, size, and CRC.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    let offset = 0
    const members = []
    while (view.getUint32(offset, true) === 0x04034b50) {
      const nameLen = view.getUint16(offset + 26, true)
      const size = view.getUint32(offset + 18, true)
      const crc = view.getUint32(offset + 14, true)
      const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLen))
      const data = zip.subarray(offset + 30 + nameLen, offset + 30 + nameLen + size)
      members.push({ name, size, data })
      check(`zip: ${name} crc round-trip`, crc, crc32Of(data))
      offset += 30 + nameLen + size
    }
    check('zip: member count', members.length, 2)
    check('zip: markdown member', members[0].name, 'record.md')
    check('zip: markdown content', new TextDecoder().decode(members[0].data), '# hello\n\nbody')
    check('zip: asset member path', members[1].name, 'assets/a.png')
    check('zip: asset bytes length', members[1].data.length, 8)
    check('zip: asset bytes preserved', Array.from(members[1].data).join(','), '137,80,78,71,13,10,26,10')

    // Central directory + EOCD
    check('zip: central signature', view.getUint32(offset, true), 0x02014b50)
    const eocdOffset = zip.length - 22
    check('zip: eocd signature', view.getUint32(eocdOffset, true), 0x06054b50)
    check('zip: eocd entry count', view.getUint16(eocdOffset + 10, true), 2)
  }

  function crc32Of(bytes) {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i]
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    return (c ^ 0xffffffff) >>> 0
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`export-asset tests passed (${passed} checks)`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
