declare const RELAY_VERSION: string

// Baked in at compile time by scripts/build.mjs (--define). 'dev' when run from source.
export const VERSION =
  typeof RELAY_VERSION !== 'undefined' ? RELAY_VERSION : 'dev'
