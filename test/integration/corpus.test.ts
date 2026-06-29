import { describe, it, expect } from 'vitest'
import { validateEpub, type Severity } from '../../src/index.js'
import { CORPUS, type Expected } from '../fixtures/corpus.js'
import { IMPLEMENTED_IDS } from '../fixtures/implemented.js'

const key = (m: { id: string; severity: Severity }): string => `${m.severity} ${m.id}`

describe('fixture corpus', () => {
  for (const fixture of CORPUS) {
    it(`${fixture.area}: ${fixture.name}`, async () => {
      // Guard: expected only references implemented ids.
      for (const e of fixture.expected) {
        expect(IMPLEMENTED_IDS.has(e.id), `expected id ${e.id} is not implemented`).toBe(true)
      }

      const report = await validateEpub(fixture.epub)
      const actual = report.messages.map(key).sort()
      const want = fixture.expected.map(key).sort()
      expect(actual).toEqual(want)

      const hasError = fixture.expected.some((e: Expected) => e.severity === 'FATAL' || e.severity === 'ERROR')
      expect(report.valid).toBe(!hasError)
    })
  }
})
