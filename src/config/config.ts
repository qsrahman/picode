import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { Mode } from './schema.ts'
import { configSchema, defaultPermission, fileConfigSchema, type Config } from './schema.ts'
import { ConfigError, messageOf } from '../errors.ts'

export const DEFAULT_CONFIG: Omit<Config, 'root'> = {
  model: 'gpt-5.6',
  baseURL: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  braveSearchApiKeyEnv: 'BRAVE_SEARCH_API_KEY',
  instructions: '',
  additionalDirs: [],
  mode: 'interactive',
  permission: defaultPermission,
  maxTokens: 8192,
  maxRetries: 3,
  toolTimeout: 30000,
}

export interface ResolveConfigOptions {
  cwd?: string
  userConfigPath?: string
  projectConfigPath?: string
  env?: NodeJS.ProcessEnv
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

// File rules override defaults per list, so a config that sets only `allow`
// keeps the default `ask`/`deny`.
function mergeToolRules(
  base: { allow: string[]; ask: string[]; deny: string[] },
  override?: Partial<{ allow: string[]; ask: string[]; deny: string[] }>,
): { allow: string[]; ask: string[]; deny: string[] } {
  return {
    allow: override?.allow ?? base.allow,
    ask: override?.ask ?? base.ask,
    deny: override?.deny ?? base.deny,
  }
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
    throw new ConfigError(`Failed to read config <${path}>: ${messageOf(err)}`)
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
  const env = opts.env ?? process.env
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
    const parsed = fileConfigSchema.safeParse(source.data)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new ConfigError(
        `Invalid config <${source.path}>: ${issue ? issue.message : 'unknown error'}`,
      )
    }
    const prevPermission = merged.permission!
    const { permission: filePerm, ...fileRest } = parsed.data
    merged = { ...merged, ...fileRest }
    // Permission is the only nested config block, so a file may set a single
    // category or even a single rule list without wiping the rest of the
    // defaults.
    if (filePerm) {
      merged.permission = {
        shell: mergeToolRules(prevPermission.shell, filePerm.shell),
        edit: mergeToolRules(prevPermission.edit, filePerm.edit),
        read: mergeToolRules(prevPermission.read, filePerm.read),
        webSearch: mergeToolRules(prevPermission.webSearch, filePerm.webSearch),
        webFetch: mergeToolRules(prevPermission.webFetch, filePerm.webFetch),
      }
    }
  }

  // Environment overrides beat config files but yield to explicit CLI flags.
  // The API key already follows apiKeyEnv (default OPENAI_API_KEY).
  if (env.OPENAI_BASE_URL) merged.baseURL = env.OPENAI_BASE_URL
  if (env.OPENAI_DEFAULT_MODEL) merged.model = env.OPENAI_DEFAULT_MODEL
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
