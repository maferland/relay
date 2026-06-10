import { exec, execFileSync } from 'child_process'
import os from 'os'
import path from 'path'

export function openBrowser(url: string): void {
  if (process.env.RELAY_NO_OPEN === '1') return
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  exec(`${cmd} "${url}"`)
}

export function generateId(): string {
  return 'task-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

export function dataDir(): string {
  const base =
    process.env.RELAY_DIR ??
    process.env.XDG_DATA_HOME ??
    path.join(os.homedir(), '.local', 'share')
  return process.env.RELAY_DIR ?? path.join(base, 'relay')
}

export function resolveActor(flag?: string): string {
  return flag ?? process.env.RELAY_ACTOR ?? process.env.USER ?? 'unknown'
}

export interface GitContext {
  project: string
  branch?: string
  worktree?: string
}

function git(args: string[], cwd: string): string | undefined {
  try {
    const out = execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    return out || undefined
  } catch {
    return undefined
  }
}

// Project = main repo name, stable across worktrees (common-dir is shared); "global" off-repo.
export function detectProject(cwd: string = process.cwd()): string {
  const commonDir = git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    cwd
  )
  return commonDir ? path.basename(path.dirname(commonDir)) : 'global'
}

// Where work happens: the specific worktree dir and its branch (for claim/handoff).
export function gitContext(cwd: string = process.cwd()): GitContext {
  return {
    project: detectProject(cwd),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    worktree: git(['rev-parse', '--show-toplevel'], cwd),
  }
}
