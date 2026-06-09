import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { isNewer } from './upgrade.js'
import { dataDir } from './util.js'
import { VERSION } from './version.js'

const REPO = 'maferland/relay'
const DAY = 24 * 60 * 60 * 1000

interface Cache {
  checkedAt: number
  latest: string
}

// Pure decision so the nag logic is testable without a network or a TTY.
export function shouldNag(opts: {
  current: string
  latest: string | undefined
}): boolean {
  if (opts.current === 'dev' || !opts.latest) return false
  return isNewer(opts.latest, opts.current)
}

function cachePath(): string {
  return path.join(dataDir(), '.update-check')
}

function readCache(): Cache | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as Cache
  } catch {
    return null
  }
}

// Banner from the cached latest version (zero added latency), refreshing in the
// background when stale. Humans only: skipped for non-TTY, mcp/watch, json, opt-out.
export function maybeNudge(command: string, json: boolean): void {
  if (
    process.env.RELAY_NO_UPDATE_CHECK ||
    json ||
    command === 'mcp' ||
    command === 'watch' ||
    !process.stderr.isTTY
  )
    return

  const cache = readCache()
  if (shouldNag({ current: VERSION, latest: cache?.latest })) {
    process.stderr.write(
      `\n  relay ${cache!.latest} available — run \`relay upgrade\`\n\n`
    )
  }

  const now = Date.now()
  if (!cache || now - cache.checkedAt > DAY) refresh(now)
}

function refresh(now: number): void {
  const child = execFile(
    'gh',
    ['api', `repos/${REPO}/releases/latest`, '--jq', '.tag_name'],
    { timeout: 4000 },
    (err, stdout) => {
      if (err) return
      const latest = stdout.trim().replace(/^v/, '')
      if (!latest) return
      try {
        fs.writeFileSync(
          cachePath(),
          JSON.stringify({ checkedAt: now, latest })
        )
      } catch {
        // best-effort; a failed write just means we check again next time
      }
    }
  )
  child.unref()
}
