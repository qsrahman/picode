import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { Mode } from './schema.ts'
import { configSchema, type Config } from './schema.ts'

export const DEFAULT_CONFIG: Omit<Config, 'root'> = {
  model: 'gpt-5.6',
  baseURL: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  instructions: '',
  additionalDirs: [],
  mode: 'interactive',
  maxTokens: 8192,
  maxRetries: 3,
  toolTimeout: 30000,
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface ResolveConfigOptions {
  cwd?: string
  userConfigPath?: string
  projectConfigPath?: string
}

export interface ConfigOverrides {
  model?: string
  mode?: Mode
  config?: string
}

interface ConfigFile {
  path: string
  data: Record<string, unknown>
}

function readConfigFile(path: string, required: boolean): ConfigFile | null {
  if (!existsSync(path)) {
    if (required) {
      throw new ConfigError(`Failed to read config <${path}>: file does not exist`)
    }
    return null
  }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new ConfigError(
      `Failed to read config <${path}>: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ConfigError(`Failed to read config <${path}>: invalid JSON`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ConfigError(`Invalid config <${path}>: expected a JSON object`)
  }
  return { path, data: data as Record<string, unknown> }
}

// Merge order: defaults <- user config <- project config (or --config) <- CLI
// flags. Each layer is validated with the partial schema so a bad value in any
// file is reported against the file that introduced it.
export function resolveConfig(args: ConfigOverrides, opts: ResolveConfigOptions = {}): Config {
  const cwd = opts.cwd ?? process.cwd()
  const userPath = opts.userConfigPath ?? join(homedir(), '.config', 'pcode', 'config.json')
  const projectPath = opts.projectConfigPath ?? join(cwd, 'pcode.json')

  const sources = [
    readConfigFile(userPath, false),
    readConfigFile(
      args.config ? resolve(cwd, args.config) : projectPath,
      args.config !== undefined,
    ),
  ]

  let merged: Partial<Config> = { ...DEFAULT_CONFIG }
  for (const source of sources) {
    if (source === null) continue
    const parsed = configSchema.partial().safeParse(source.data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ConfigError(
        `Invalid config <${source.path}>: ${issue ? issue.message : 'unknown error'}`,
      )
    }
    merged = { ...merged, ...parsed.data }
  }

  if (args.model !== undefined) merged.model = args.model
  if (args.mode !== undefined) merged.mode = args.mode

  merged.root = resolve(cwd, merged.root ?? cwd)
  merged.additionalDirs = (merged.additionalDirs ?? []).map((dir) => resolve(cwd, dir))

  const parsed = configSchema.safeParse(merged)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ConfigError(`Invalid configuration: ${issue ? issue.message : 'unknown error'}`)
  }
  return parsed.data
}
