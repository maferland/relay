import fs from 'fs'
import os from 'os'
import path from 'path'

export interface RelayConfig {
  name?: string
}

// Operator config lives under XDG_CONFIG_HOME, separate from the data dir.
export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  return path.join(base, 'relay', 'config.json')
}

export function readConfig(): RelayConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as RelayConfig
  } catch {
    return {}
  }
}

export function writeConfig(config: RelayConfig): void {
  const file = configPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
}

// The operator's chosen display name, if they've set one.
export function operatorName(): string | undefined {
  return readConfig().name || undefined
}
