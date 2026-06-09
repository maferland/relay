import { STATES } from './types.js'

const COMMANDS: [string, string][] = [
  ['add', 'log a task'],
  ['list', 'list tasks'],
  ['show', 'show one task with its history'],
  ['update', 'change fields and/or state'],
  ['claim', 'assign to self and move to doing'],
  ['comment', 'add a note to the thread'],
  ['link', 'link a remote PR to a task'],
  ['sync', 'pull remote status onto a task'],
  ['watch', 'block until a task changes'],
  ['escalate', 'flag as needing a human'],
  ['resolve', 'clear the needs-human flag'],
  ['ui', 'open the local web UI'],
  ['mcp', 'run the stdio MCP server'],
  ['upgrade', 'update relay to the latest release'],
  ['completion', 'print a shell completion script'],
]

export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const
export type CompletionShell = (typeof COMPLETION_SHELLS)[number]

export function isCompletionShell(s: string): s is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(s)
}

// Emit a completion script for the given shell. Flags come from the CLI so the
// two never drift; subcommands and state values are baked here.
export function completionScript(
  shell: CompletionShell,
  flags: string[]
): string {
  const cmds = COMMANDS.map(([c]) => c)
  const states = [...STATES]
  if (shell === 'bash') return bash(cmds, flags, states)
  if (shell === 'zsh') return zsh(cmds, flags, states)
  return fish(states, flags)
}

function bash(cmds: string[], flags: string[], states: string[]): string {
  return `_relay() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$prev" = "--state" ]; then
    COMPREPLY=( $(compgen -W "${states.join(' ')}" -- "$cur") ); return
  fi
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${cmds.join(' ')}" -- "$cur") ); return
  fi
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${flags.map((f) => '--' + f).join(' ')}" -- "$cur") ); return
  fi
}
complete -F _relay relay
`
}

function zsh(cmds: string[], flags: string[], states: string[]): string {
  return `#compdef relay
_relay() {
  if [[ $CURRENT -eq 2 ]]; then
    compadd -- ${cmds.join(' ')}
    return
  fi
  if [[ \${words[CURRENT-1]} == "--state" ]]; then
    compadd -- ${states.join(' ')}
    return
  fi
  if [[ \${words[CURRENT]} == -* ]]; then
    compadd -- ${flags.map((f) => '--' + f).join(' ')}
  fi
}
compdef _relay relay
`
}

function fish(states: string[], flags: string[]): string {
  const cmdLines = COMMANDS.map(
    ([c, d]) => `complete -c relay -n __fish_use_subcommand -a ${c} -d '${d}'`
  )
  const flagLines = flags.map((f) =>
    f === 'state'
      ? `complete -c relay -l state -x -a '${states.join(' ')}'`
      : `complete -c relay -l ${f}`
  )
  return ['complete -c relay -f', ...cmdLines, ...flagLines].join('\n') + '\n'
}
