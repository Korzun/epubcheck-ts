import { describe, it, expect } from 'vitest'
import { buildEpub2, OPF2 } from '../fixtures/build.js'
import { CASES } from './cases.js'
import { diffCase, jarAvailable, runJar, runJarMessages } from './harness.js'

/**
 * Differential parity against the real EPUBCheck jar. This is a verification tool,
 * not a unit test: it needs `epubcheck` on PATH (`brew install epubcheck`) and is
 * opt-in via EPUBCHECK_DIFF=1 so CI without the jar stays green.
 *
 *   EPUBCHECK_DIFF=1 npx vitest run test/differential
 */
const enabled = process.env['EPUBCHECK_DIFF'] === '1' && jarAvailable()

describe.skipIf(!enabled)('differential parity with EPUBCheck 5.3.0', () => {
  // Pins the location-expansion in runJar. EPUBCheck aggregates a duplicate id into ONE
  // RSC-005 message carrying TWO locations; the harness must expand that into two records
  // so multiset comparison against epubcheck-ts (one Message per occurrence) is meaningful.
  // This is the single most error-prone piece of harness logic, so it is asserted directly.
  it('runJar expands one aggregated message into one record per location', () => {
    // Two manifest items sharing id="ncx" -> the jar reports one RSC-005 with two locations.
    const dup = buildEpub2({
      files: { 'EPUB/package.opf': OPF2.replace('id="content" href="content_001.xhtml"', 'id="ncx" href="content_001.xhtml"') },
    })

    const raw = runJarMessages(dup)
    const aggregated = raw.filter((m) => m.ID === 'RSC-005' && Array.isArray(m.locations) && m.locations.length === 2)
    expect(aggregated.length, 'jar should aggregate the duplicate id into one RSC-005 with two locations').toBe(1)

    const expanded = runJar(dup).filter((m) => m.id === 'RSC-005')
    expect(expanded.length, 'runJar should expand the two-location RSC-005 into two records').toBe(2)
  }, 60_000)

  for (const c of CASES) {
    it(c.name, async () => {
      const result = await diffCase(c)
      expect(result.ts.map((m) => `${m.severity} ${m.id} ${m.message}`).sort()).toEqual(
        result.jar.map((m) => `${m.severity} ${m.id} ${m.message}`).sort(),
      )
    }, 60_000)
  }
})
