# pcode

A model-agnostic, CLI-based AI coding agent built on the OpenAI Responses API.
Interacts with you one-shot or in a REPL, runs local tools (files, shell, git),
streams output, and integrates MCP servers — all behind a declarative
permission system.

> **Status:** early development. Phase 0 (scaffold) is done. The agent loop is
> not functional yet; `--version`/`--help` are the only wired behavior.

## Requirements

- **Node.js 26+** (runs TypeScript directly via type stripping — no build step)
- **pnpm** (never `npm` or `yarn`)
- An OpenAI API key (default env var: `OPENAI_API_KEY`)

## Install

```sh
pnpm install
pnpm start            # run the CLI from this repo
pnpm link             # optional: exposes the global `pcode` command
```

## Usage

```sh
pcode "explain this repo"     # one-shot
pcode                         # interactive REPL
```

The model is selected with `--model` or the config file.

### Options

| Flag | Description |
| --- | --- |
| `--model <id>` | Model to use (overrides config) |
| `--mode <mode>` | Permission mode: `interactive` \| `auto` \| `plan` (default: `interactive`) |
| `--yes` | Alias for `--mode auto` |
| `--plan` | Alias for `--mode plan` |
| `--config <path>` | Config file to load |
| `--no-stream` | Buffer the full response instead of streaming |
| `--verbose` | Show full tool input/output |
| `--no-color` | Disable ANSI colors (`NO_COLOR` is also honored) |
| `--version` | Print version |
| `--help` | Show help |

### REPL commands

`/help` `/model` `/mode` `/clear` `/tools` `/exit`
(`/help` `/clear` `/exit` land with Phase 1; `/mode` `/tools` with Phase 3.)

## Configuration

Config is merged in this order (later wins):

1. Built-in defaults
2. `~/.config/pcode/config.json` (user-level)
3. `./pcode.json` (project-level, checked in to share with your team)
4. CLI flags

```jsonc
{
  "model": "gpt-5.6",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY",
  "instructions": "You are pcode, a coding agent.",
  "root": "/path/to/workspace",        // default: current directory
  "additionalDirs": ["../sibling"],
  "mode": "interactive",               // interactive | auto | plan
  "permission": {
    "shell": { "allow": ["Bash(pnpm test *)"], "ask": [], "deny": ["Bash(rm -rf *)"] },
    "edit":  { "allow": ["Edit(src/**)"],  "ask": [], "deny": [] },
    "read":  { "allow": [],                "ask": [], "deny": ["Read(.env)"] }
  }
}
```

## Permission model

`pcode` gates every tool call through a rule engine with `allow` / `ask` /
`deny` buckets, evaluated **deny > ask > allow**. Rules use `Tool(pattern)`
syntax (`Bash(pnpm test *)`, `Edit(src/**)`, `Read(.env)`). When a call needs
approval you answer:

- `y` — allow once
- `n` — deny
- `a` — always allow (records the exact pattern, session-only for now)

### Modes

- **interactive** (default): prompts for anything not allowed by a rule
- **auto** (`--yes`): auto-approves anything not explicitly denied
- **plan**: read-only — file writes and non-read-only shell commands are denied

Built-in read-only shell commands (`ls`, `cat`, `grep`, `git status`, …) run
without prompting. Destructive/escaping commands still prompt even in `auto`.

## Roadmap

See [`PLAN.md`](./PLAN.md) — the single source of truth for planning. Status:

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Scaffold + docs | 🟢 done |
| 1 | CLI parsing, config, plain chat | ⚪ not started |
| 2 | Streaming + tools + function-calling loop | ⚪ not started |
| 3 | Built-in tools + permission engine | ⚪ not started |
| 4 | MCP integration | ⚪ not started |
| 5 | Session persistence, context trimming, parallelism | ⚪ not started |

## Development

```sh
pnpm dev             # run with --watch
pnpm test            # run tests once
pnpm test:watch      # run tests in watch mode
pnpm typecheck       # tsc --noEmit
pnpm format          # prettier --write
pnpm format:check    # prettier --check (gates CI)
```

Developer guide: [`AGENTS.md`](./AGENTS.md)
