// build-generated asset (vite → dist/ui); Bun inlines it into the --compile binary as raw text.
// Kept in its own module so `ui-server.ts` (and its tests) don't statically depend on the build.
import bundledHtml from '../dist/ui/index.html' with { type: 'text' }

export function loadUiHtml(): string {
  return bundledHtml as unknown as string
}
