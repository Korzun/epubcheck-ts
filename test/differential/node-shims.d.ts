// Minimal ambient declarations for the Node built-ins the differential harness uses.
// The project intentionally ships without `@types/node` (nothing in src/ touches Node
// APIs), and the differential suite is test-only tooling that shells out to the
// EPUBCheck jar. Rather than pull in a dependency and churn the lockfile, we declare
// only the exact surface `harness.ts` relies on.

declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options?: { encoding?: string; stdio?: string | readonly string[]; maxBuffer?: number },
  ): string
}

declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function writeFileSync(path: string, data: Uint8Array): void
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}

declare module 'node:os' {
  export function tmpdir(): string
}

declare module 'node:path' {
  export function join(...parts: string[]): string
}

declare const process: { env: Record<string, string | undefined> }
