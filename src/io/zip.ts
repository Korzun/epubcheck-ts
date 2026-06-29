import { unzipSync } from 'fflate'
import { parseXml, findDescendants } from './xml.js'

export interface Resource {
  path: string
  bytes: Uint8Array
  compression: 'stored' | 'deflate'
  mediaType?: string
}

export interface EpubContainer {
  resources: Map<string, Resource>
  rootfiles: string[]
  hasEncryption: boolean
}

async function toBytes(
  input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  // web ReadableStream<Uint8Array>
  const reader = input.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Walk the ZIP central directory to recover entry order and compression method.
 * Returns names in directory order with method (0 = stored, 8 = deflate).
 */
function readCentralDirectory(bytes: Uint8Array): Array<{ name: string; method: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Locate End Of Central Directory record (signature 0x06054b50), scanning backward.
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: missing end-of-central-directory record')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true) // central directory offset
  const decoder = new TextDecoder('utf-8')
  const entries: Array<{ name: string; method: number }> = []

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break // central file header signature
    const method = view.getUint16(p + 10, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.push({ name, method })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export async function openEpub(
  input: Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>,
): Promise<EpubContainer> {
  const bytes = await toBytes(input)
  const order = readCentralDirectory(bytes) // throws if not a ZIP
  const content = unzipSync(bytes)

  const resources = new Map<string, Resource>()
  for (const { name, method } of order) {
    if (name.endsWith('/')) continue // ZIP directory entry — never a resource
    const data = content[name]
    if (!data) continue // unsupported or missing entry; skip
    resources.set(name, {
      path: name,
      bytes: data,
      compression: method === 0 ? 'stored' : 'deflate',
    })
  }

  const rootfiles = extractRootfiles(resources)
  return {
    resources,
    rootfiles,
    hasEncryption: resources.has('META-INF/encryption.xml'),
  }
}

function extractRootfiles(resources: Map<string, Resource>): string[] {
  const container = resources.get('META-INF/container.xml')
  if (!container) return []
  const { root } = parseXml(container.bytes, 'META-INF/container.xml')
  if (!root) return []
  return findDescendants(root, 'rootfile')
    .filter((rf) => rf.attrs?.['media-type'] === 'application/oebps-package+xml')
    .map((rf) => rf.attrs?.['full-path'])
    .filter((path): path is string => typeof path === 'string')
}

export function getResource(container: EpubContainer, path: string): Resource | undefined {
  return container.resources.get(path)
}
