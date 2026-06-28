import { getResource, type EpubContainer } from '../io/zip.js'
import { msg, type Message } from '../messages/format.js'

const MIMETYPE = 'mimetype'
const EPUB_MEDIA_TYPE = 'application/epub+zip'
const CONTAINER_PATH = 'META-INF/container.xml'

export function validateOcf(container: EpubContainer): Message[] {
  const messages: Message[] = []

  // --- mimetype rules ---
  const firstKey = container.resources.keys().next().value
  const mimetype = getResource(container, MIMETYPE)
  if (firstKey !== MIMETYPE || !mimetype) {
    messages.push(msg('PKG-006', { path: MIMETYPE }))
  }
  if (mimetype) {
    if (mimetype.compression !== 'stored') {
      messages.push(msg('PKG-005', { path: MIMETYPE }))
    }
    const value = new TextDecoder('utf-8').decode(mimetype.bytes)
    if (value !== EPUB_MEDIA_TYPE) {
      messages.push(msg('PKG-007', { path: MIMETYPE }))
    }
  }

  // --- container.xml + rootfile rules ---
  const containerXml = getResource(container, CONTAINER_PATH)
  if (!containerXml) {
    messages.push(msg('RSC-002', { path: CONTAINER_PATH }))
  } else if (container.rootfiles.length === 0) {
    messages.push(msg('RSC-003', { path: CONTAINER_PATH }))
  }

  return messages
}
