import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { VERSION } from './version.js'

const REPO = 'maferland/relay'

// Map the running platform to a published release asset (relay-<os>-<arch>).
export function assetName(
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  const osPart =
    platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null
  return osPart && cpu ? `relay-${osPart}-${cpu}` : null
}

// True if version `a` is strictly newer than `b` (tolerates a leading "v").
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}

function sha256(file: string): string {
  return execFileSync('shasum', ['-a', '256', file], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0]
}

function die(msg: string): never {
  process.stderr.write(msg + '\n')
  process.exit(1)
}

// Download the latest release binary for this platform, verify its checksum, and
// swap it in over the running executable. Private repo, so it goes through gh.
export async function upgradeCommand(): Promise<void> {
  if (VERSION === 'dev')
    die('relay upgrade only works on an installed build (this is a dev build).')

  try {
    gh(['--version'])
  } catch {
    die(
      'relay upgrade needs the GitHub CLI (gh). Install gh, or re-run install.sh.'
    )
  }

  const asset = assetName()
  if (!asset) die(`Unsupported platform: ${process.platform}/${process.arch}`)

  const tag = gh(['api', `repos/${REPO}/releases/latest`, '--jq', '.tag_name'])
  if (!isNewer(tag, VERSION)) {
    process.stdout.write(`relay ${VERSION} is already the latest (${tag}).\n`)
    return
  }

  process.stdout.write(`Upgrading relay ${VERSION} -> ${tag}...\n`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-upgrade-'))
  try {
    gh([
      'release',
      'download',
      tag,
      '-R',
      REPO,
      '-p',
      asset,
      '-p',
      `${asset}.sha256`,
      '-D',
      tmp,
    ])
    const downloaded = path.join(tmp, asset)
    const expected = fs
      .readFileSync(path.join(tmp, `${asset}.sha256`), 'utf8')
      .trim()
      .split(/\s+/)[0]
    if (expected !== sha256(downloaded)) die('Checksum mismatch; aborting.')

    // Stage next to the destination so the final rename is atomic (same filesystem).
    const dest = process.execPath
    const staging = dest + '.new'
    fs.copyFileSync(downloaded, staging)
    fs.chmodSync(staging, 0o755)
    if (process.platform === 'darwin') {
      try {
        execFileSync('codesign', ['--force', '--sign', '-', staging])
      } catch {
        // unsigned still runs on most setups; the binary is the same bytes we verified
      }
    }
    fs.renameSync(staging, dest)
    process.stdout.write(`Upgraded to relay ${tag}.\n`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
