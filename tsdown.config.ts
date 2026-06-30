import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  // Under "type": "module", ESM keeps the bare .js/.d.ts extension while the
  // CJS output is disambiguated to .cjs/.d.cts. This yields a stable exports
  // contract: ESM -> index.js/index.d.ts, CJS -> index.cjs/index.d.cts.
  fixedExtension: false,
})
