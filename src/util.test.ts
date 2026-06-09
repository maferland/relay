import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { detectProject, gitContext, resolveActor } from './util.js'

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('git project detection', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-git-')))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("returns 'global' outside a git repo", () => {
    expect(detectProject(dir)).toBe('global')
    expect(gitContext(dir).worktree).toBeUndefined()
  })

  it('detects the repo name and current branch inside a repo', () => {
    const repo = path.join(dir, 'myrepo')
    fs.mkdirSync(repo)
    git(['init', '-b', 'main'], repo)
    git(['config', 'user.email', 't@t.dev'], repo)
    git(['config', 'user.name', 't'], repo)
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x')
    git(['add', '.'], repo)
    git(['commit', '-m', 'init'], repo)

    expect(detectProject(repo)).toBe('myrepo')
    const ctx = gitContext(repo)
    expect(ctx.branch).toBe('main')
    expect(fs.realpathSync(ctx.worktree!)).toBe(repo)
  })

  it('keeps the project stable across linked worktrees', () => {
    const repo = path.join(dir, 'myrepo')
    fs.mkdirSync(repo)
    git(['init', '-b', 'main'], repo)
    git(['config', 'user.email', 't@t.dev'], repo)
    git(['config', 'user.name', 't'], repo)
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x')
    git(['add', '.'], repo)
    git(['commit', '-m', 'init'], repo)

    const wt = path.join(repo, '.worktrees', 'feat')
    git(['worktree', 'add', '-b', 'feat', wt], repo)

    // The worktree dir is named "feat" but the project must stay "myrepo".
    expect(detectProject(wt)).toBe('myrepo')
    expect(gitContext(wt).branch).toBe('feat')
  })
})

describe('resolveActor', () => {
  const saved = { actor: process.env.RELAY_ACTOR, user: process.env.USER }
  afterEach(() => {
    process.env.RELAY_ACTOR = saved.actor
    process.env.USER = saved.user
  })

  it('prefers an explicit flag, then RELAY_ACTOR, then $USER, then unknown', () => {
    process.env.RELAY_ACTOR = 'env-actor'
    process.env.USER = 'login-user'
    expect(resolveActor('flag-actor')).toBe('flag-actor')

    delete process.env.RELAY_ACTOR
    expect(resolveActor()).toBe('login-user')

    delete process.env.USER
    expect(resolveActor()).toBe('unknown')
  })
})
