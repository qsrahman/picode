import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'

import { modeSchema, modes, type Mode } from '../config/schema.ts'
import { CliError, messageOf } from '../errors.ts'

export interface CliOptions {
  model?: string
  mode?: Mode
  config?: string
  noStream: boolean
  verbose: boolean
  noColor: boolean
  version: boolean
  help: boolean
  prompt: string
}

const CLI_OPTIONS = {
  model: { type: 'string' },
  mode: { type: 'string' },
  yes: { type: 'boolean' },
  plan: { type: 'boolean' },
  config: { type: 'string' },
  'no-stream': { type: 'boolean' },
  verbose: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean' },
} as const satisfies ParseArgsOptionsConfig

interface ParsedValues {
  model?: string
  mode?: string
  yes?: boolean
  plan?: boolean
  config?: string
  'no-stream'?: boolean
  verbose?: boolean
  'no-color'?: boolean
  version?: boolean
  help?: boolean
}

// parseArgs throws raw errors for unknown flags; surface them as CliError so
// the entry point can print a one-line message instead of a stack trace.
export function parseCli(argv: string[]): CliOptions {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: CLI_OPTIONS, allowPositionals: true })
  } catch (err) {
    throw new CliError(messageOf(err))
  }
  const values: ParsedValues = parsed.values
  const positionals = parsed.positionals

  let mode: Mode | undefined
  if (values.mode !== undefined) {
    const parsed = modeSchema.safeParse(values.mode)
    if (!parsed.success) {
      throw new CliError(
        `invalid --mode ${JSON.stringify(values.mode)}: expected ${modes.join(' | ')}`,
      )
    }
    mode = parsed.data
  } else if (values.yes) {
    mode = 'auto'
  } else if (values.plan) {
    mode = 'plan'
  }

  return {
    model: values.model,
    mode,
    config: values.config,
    noStream: values['no-stream'] ?? false,
    verbose: values.verbose ?? false,
    noColor: values['no-color'] ?? false,
    version: values.version ?? false,
    help: values.help ?? false,
    prompt: positionals.join(' '),
  }
}
