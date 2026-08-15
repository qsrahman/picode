#!/usr/bin/env node

import { join } from 'node:path'

import { CliError, parseCli } from './cli/args.ts'
import { HELP_TEXT } from './cli/help.ts'
import { runRepl } from './cli/repl.ts'
import { ConfigError, resolveConfig } from './config/config.ts'
import { createProvider } from './agent/provider.ts'
import { runTurn } from './agent/agent.ts'
import { ToolRegistry } from './tools/registry.ts'
import { createShellTool } from './tools/shell.ts'
import { createPalette, shouldUseColor } from './utils/palette.ts'
import { VERSION } from './version.ts'

async function main(): Promise<void> {
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

  const registry = new ToolRegistry()
  registry.register(createShellTool({ cwd: config.root, timeout: config.toolTimeout }))
  const tools = registry.descriptors()

  if (args.prompt) {
    // Non-interactive: only --yes (mode auto) approves tool calls; anything
    // else auto-denies instead of prompting.
    const result = await runTurn(provider, [], args.prompt, {
      tools,
      registry,
      onText: (delta) => {
        if (!args.noStream) process.stdout.write(delta)
      },
      requestApproval: async () => config.mode === 'auto',
    })
    if (args.noStream && result.text) process.stdout.write(`${result.text}\n`)
    return
  }

  await runRepl({
    provider,
    config,
    palette,
    historyFile: join(process.cwd(), '.pcode', 'history'),
    args,
    registry,
    tools,
  })
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
