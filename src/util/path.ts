/**
 * Resolve an href that appears inside `fromFile` to a normalized container path.
 * Strips fragment/query, decodes percent-encoding, normalizes "." and "..".
 * A leading "/" is container-root-relative.
 */
export function resolvePath(fromFile: string, href: string): string {
  const noFragment = href.split('#')[0] ?? ''
  const clean = noFragment.split('?')[0] ?? ''
  let decoded: string
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    decoded = clean
  }

  const absolute = decoded.startsWith('/')
  const target = absolute ? decoded.slice(1) : decoded
  const baseDir =
    fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
  const stack: string[] = absolute || baseDir === '' ? [] : baseDir.split('/')

  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

/** True when `href` is an absolute URL with a scheme (e.g. https://…). */
export function isRemote(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href)
}

/** True when `url` carries any scheme (https:, data:, mailto:, …). */
export function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url)
}
