import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'es2022',
  // Emit .js/.d.ts (not .mjs/.d.mts) so the package "exports" contract is
  // stable; valid ESM because the package is "type": "module".
  fixedExtension: false,
})
