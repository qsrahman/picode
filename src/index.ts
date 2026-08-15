#!/usr/bin/env node

import { join } from 'node:path'

import { CliError, parseCli } from './cli/args.ts'
import { HELP_TEXT } from './cli/help.ts'
import { runRepl } from './cli/repl.ts'
import { ConfigError, resolveConfig } from './config/config.ts'
import { loadEnvFile } from './config/env.ts'
import { createProvider } from './agent/provider.ts'
import { runTurn } from './agent/agent.ts'
import { createPalette, shouldUseColor } from './output/palette.ts'
import { VERSION } from './version.ts'

async function main(): Promise<void> {
  // Project .env feeds OPENAI_API_KEY / OPENAI_BASE_URL before config resolves.
  loadEnvFile(join(process.cwd(), '.env'))

  let args
  try {
    args = parseCli(process.argv.slice(2))
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`error: ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }

  if (args.version) {
    process.stdout.write(`pcode ${VERSION}\n`)
    return
  }
  if (args.help) {
    process.stdout.write(HELP_TEXT)
    return
  }

  let config
  try {
    config = resolveConfig(args)
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`error: ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }

  const apiKey = process.env[config.apiKeyEnv]
  if (!apiKey) {
    process.stderr.write(
      `error: no API key found (${config.apiKeyEnv} is not set)\n\n` +
        `Tip: export ${config.apiKeyEnv}=<your key> to use pcode.\n`,
    )
    process.exit(1)
  }

  const provider = createProvider(config, apiKey)
  const palette = createPalette(shouldUseColor(args))

  if (args.prompt) {
    const next = await runTurn(provider, [], args.prompt)
    const reply = next[next.length - 1]
    if (reply?.role === 'assistant') process.stdout.write(`${reply.content}\n`)
    return
  }

  await runRepl({
    provider,
    config,
    palette,
    historyFile: join(process.cwd(), '.pcode', 'history'),
  })
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
