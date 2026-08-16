#!/usr/bin/env node

import { join } from 'node:path'

import { parseCli } from './cli/args.ts'
import { HELP_TEXT } from './cli/help.ts'
import { runRepl } from './cli/repl.ts'
import { resolveConfig } from './config/config.ts'
import { CliError, ConfigError, messageOf } from './errors.ts'
import { createProvider } from './agent/provider.ts'
import { MAX_TOOL_ROUNDS, runTurn } from './agent/agent.ts'
import { ToolRegistry } from './tools/registry.ts'
import { createShellTool } from './tools/shell.ts'
import type { ToolCall } from './tools/types.ts'
import { createFsTools } from './tools/fs.ts'
import { createGitTools } from './tools/git.ts'
import { createWebTools } from './tools/web.ts'
import { createAgentTool } from './tools/agent.ts'
import { TodoStore, createTodoTool } from './tools/todo.ts'
import { ApprovalCache, toolsetForModel } from './permissions/policy.ts'
import { createAuthorizer } from './permissions/prompt.ts'
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
    process.stdout.write(`picode ${VERSION}\n`)
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
    const palette = createPalette(shouldUseColor(args))
    process.stderr.write(
      `error: no API key found (${config.apiKeyEnv} is not set)\n\n` +
        `${palette.tip('Tip:')} export ${config.apiKeyEnv}=<your key> to use picode.\n`,
    )
    process.exit(1)
  }

  const provider = createProvider(config, apiKey)
  const palette = createPalette(shouldUseColor(args))

  // Constructed once, up front: run_agent needs the same instance the
  // interactive authorizer (below) uses, so a prior "always allow" answer
  // also covers matching calls made by a sub-agent.
  const approvals = new ApprovalCache()

  const registry = new ToolRegistry()
  registry.register(createShellTool({ cwd: config.root, timeout: config.toolTimeout }))
  for (const tool of createFsTools({ root: config.root, additionalDirs: config.additionalDirs })) {
    registry.register(tool)
  }
  for (const tool of createGitTools(config.root)) {
    registry.register(tool)
  }
  for (const tool of createWebTools({
    apiKey: process.env[config.braveSearchApiKeyEnv],
    timeoutMs: config.toolTimeout,
  })) {
    registry.register(tool)
  }
  registry.register(createAgentTool({ provider, registry, config, approvals }))
  const todos = new TodoStore()
  registry.register(createTodoTool({ store: todos }))
  const tools = toolsetForModel(registry, config.permission, config.mode)

  if (args.prompt) {
    // One-shot is non-interactive: the engine resolves `ask` decisions to a
    // denial (no prompt), while `allow`/`deny` follow the rules and mode.
    const base = createAuthorizer({
      rules: config.permission,
      mode: config.mode,
      approvals,
      io: { interactive: false, question: async () => 'n', print: () => {} },
    })
    // Track denials so the process exits non-zero (2) when the policy blocks a
    // tool call, distinguishing a blocked run from a clean one.
    let denied = false
    const authorize = async (call: ToolCall): Promise<boolean> => {
      const ok = await base(call)
      if (!ok) denied = true
      return ok
    }
    const result = await runTurn(provider, [], args.prompt, {
      tools,
      registry,
      onText: (delta) => {
        if (!args.noStream) process.stdout.write(delta)
      },
      authorize,
    })
    if (args.noStream && result.text) process.stdout.write(`${result.text}\n`)
    if (result.truncated) {
      process.stderr.write(`picode: tool call limit reached (${MAX_TOOL_ROUNDS} rounds)\n`)
      process.exitCode = 3
    }
    if (result.incomplete) {
      process.stderr.write('picode: response incomplete — output may be truncated\n')
    }
    if (denied) process.exitCode = 2
    return
  }

  await runRepl({
    provider,
    config,
    palette,
    historyFile: join(process.cwd(), '.picode', 'history'),
    args,
    registry,
    tools,
    approvals,
    todos,
  })
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${messageOf(err)}\n`)
  process.exit(1)
})
