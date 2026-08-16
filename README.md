# picode

A model-agnostic, CLI-based AI coding agent built on the OpenAI Responses API.
Interacts with you one-shot or in a REPL, runs local tools (files, shell, git),
streams output, and integrates MCP servers — all behind a declarative
permission system.

> **Status:** Phases 0–5 are done. Today `picode` holds one-shot and REPL
> conversations, streams output, and runs a full local tool suite — file
> read/write/edit/list/stat, a `run_command` shell, read-only git, web
> search/fetch, and a headless `run_agent` sub-agent tool — behind a
> declarative `allow`/`ask`/`deny` permission engine with interactive prompts
> and `interactive` / `auto` / `plan` modes. MCP integration lands in Phase 6.

## Requirements

- **Node.js 26+** (runs TypeScript directly via type stripping — no build step)
- **pnpm** (never `npm` or `yarn`)
- An OpenAI API key (default env var: `OPENAI_API_KEY`)

## Install

```sh
pnpm install
pnpm start            # run the CLI from this repo
pnpm link             # optional: exposes the global `picode` command
```

## Usage

```sh
picode "explain this repo"     # one-shot
picode                         # interactive REPL
```

The model is selected with `--model` or the config file.

### Tools

The agent can call local tools, all confined to the workspace (`config.root`
plus `config.additionalDirs`); path traversal outside is blocked.

- `run_command` — runs a shell command via `/bin/sh` in the workspace root,
  with a timeout (`config.toolTimeout`, default 30s) and capped output. Returns
  a blob starting with `exit <code>` followed by truncated stdout/stderr; a
  timeout reports `exit 124`.
- `read_file` / `write_file` / `list_dir` / `stat` — file operations.
  `write_file` creates parent directories and overwrites existing files.
- `edit_file` — surgical patch: replaces `old_string` with `new_string`
  inside a file without rewriting the rest of it. `old_string` must match
  exactly once (whitespace/indentation included) unless `replace_all` is
  set; an ambiguous or missing match reports back instead of guessing.
- `git_status` / `git_diff` / `git_log` / `git_show` — read-only git, run in
  the workspace root.
- `web_search` — searches the web via the [Brave Search API](https://brave.com/search/api/)
  and returns ranked title/URL/description results. Needs an API key (env var
  named by `braveSearchApiKeyEnv`, default `BRAVE_SEARCH_API_KEY`); without
  one, the tool reports that plainly instead of failing to register.
- `web_fetch` — fetches a URL and returns its readable text (HTML is stripped
  to plain text; other content types pass through as-is). Every request is
  checked against a hard, non-configurable guard that rejects loopback,
  private, and link-local targets (including the cloud metadata address
  `169.254.169.254`) before it's made — this runs regardless of permission
  rules, the same way file tools are unconditionally confined to the
  workspace.
- `run_agent` — delegates a well-scoped, self-contained subtask
  (`{ description, prompt }`) to a fresh sub-agent that runs its own
  `runTurn` loop with the same provider and toolset, then reports back its
  final text. It's isolated (no access to the parent conversation) and
  headless: it can't pop an interactive approval prompt, so anything not
  already allowed by policy is silently refused instead of asking — only
  what an allow rule, the read-only shell default, or `auto`/`plan` mode
  already covers goes through. One level of nesting only — it can't call
  `run_agent` itself.

Every tool call is gated by the [permission engine](#permission-model). Denied
tools are hidden from the model's toolset; calls that are denied only for
specific arguments are hard-blocked at run time (the denial status line names
the blocking rule or `plan mode`).

The default `instructions` (`src/agent/systemPrompt.ts`) tells the model how
to use this toolset correctly — notably to prefer `edit_file` over
`write_file` for changes to an existing file, since a full rewrite discards
anything the edit didn't intend to touch, and when to delegate to
`run_agent`. Setting `instructions` in a config file replaces this default
wholesale rather than appending to it.

Planned (Phase 7): a `todo` tool that lets the agent break a complex task into
tracked subtasks (`pending` / `in_progress` / `done`) and keep them in sync
across tool rounds.

### Tool approval

Before a tool call runs, the agent loop evaluates it through the permission
engine:

- **`allow`** (by rule, read-only default, or `auto` mode): runs without asking
- **`ask`**: prompts at an interactive terminal — `y` runs once, `n` denies,
  `a` always allows (records the exact pattern, session-only for now)
- **`deny`** (by rule or `plan` mode): blocked; status line shows the reason
- **non-interactive** (one-shot prompt, piped stdin): an unresolved `ask`
  resolves to a denial — no prompt

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

`/help` `/model` `/mode` `/clear` `/reset` `/tools` `/exit`

- `/mode` — show the current mode, or switch: `/mode auto` / `/mode plan` /
  `/mode interactive`
- `/tools` — list every tool with its effective permission (`allow` / `ask` /
  `deny`) in the current mode
- `/clear` clears the terminal; `/reset` wipes the current conversation

## Configuration

Config is merged in this order (later wins):

1. Built-in defaults
2. `~/.config/picode/config.json` (user-level)
3. `./picode.json` (project-level, checked in to share with your team)
4. CLI flags
5. Environment: `OPENAI_BASE_URL` overrides `baseURL`; `OPENAI_DEFAULT_MODEL` overrides `model` (CLI flags still win); the API key is read from `apiKeyEnv` (default `OPENAI_API_KEY`)

```jsonc
{
  "model": "gpt-5.6",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY",
  "braveSearchApiKeyEnv": "BRAVE_SEARCH_API_KEY",
  "instructions": "You are picode, a coding agent.", // overrides the built-in default wholesale
  "root": "/path/to/workspace",        // default: current directory
  "additionalDirs": ["../sibling"],
  "mode": "interactive",               // interactive | auto | plan
  "maxTokens": 8192,                   // response output token cap
  "maxRetries": 3,                     // OpenAI SDK request retries
  "toolTimeout": 30000,                // default shell tool timeout (ms)
  "permission": {
    "shell":      { "allow": ["Bash(pnpm test *)"], "ask": [], "deny": ["Bash(rm -rf *)"] },
    "edit":       { "allow": ["Edit(src/**)"],  "ask": [], "deny": [] },
    "read":       { "allow": [],                "ask": [], "deny": ["Read(.env)"] },
    "webSearch":  { "allow": ["WebSearch(*)"],  "ask": [], "deny": [] },
    "webFetch":   { "allow": [],                "ask": [], "deny": ["WebFetch(https://internal.corp/**)"] },
    "agent":      { "allow": [],                "ask": [], "deny": [] }
  }
}

```

### `.env`

The `pnpm start` / `pnpm dev` scripts load `.env` from the project root via
Node's `--env-file` flag, so you can keep credentials out of your shell (see
`.env.example`):

```
OPENAI_API_KEY=sk-...
# OPENAI_DEFAULT_MODEL=gemma4:cloud     # optional: model used when --model is not given
# OPENAI_BASE_URL=http://localhost:11434/v1   # optional: override the endpoint
# BRAVE_SEARCH_API_KEY=...              # optional: enables the web_search tool
```

Variables already exported in your shell take precedence over `.env`, and an
explicit `--model` flag beats `OPENAI_DEFAULT_MODEL`.

## Permission model

`picode` gates every tool call through a rule engine with `allow` / `ask` /
`deny` buckets, evaluated **deny > ask > allow**. Rules use `Tool(pattern)`
syntax (`Bash(pnpm test *)`, `Edit(src/**)`, `Read(.env)`,
`WebSearch(*)`, `WebFetch(https://internal.corp/**)`, `Agent(fix the tests)`)
— `web_search` and `web_fetch` are separate `webSearch`/`webFetch`
categories, not one shared `web` bucket, so a rule can target one without
also matching the other; `run_agent` gets its own `agent` category for the
same reason. When a call needs approval you answer:

- `y` — allow once
- `n` — deny
- `a` — always allow (records the exact pattern, session-only for now)

**Phase 3 — live.** The rule engine replaces the mode-only prompt hook; the
loop's `authorize()` is composed from `evaluateCall` + `promptForDecision`,
so tools stay untouched. Rules use Claude-Code-style `Tool(pattern)` syntax
(`Bash(pnpm test *)`, `Edit(src/**)`, `Read(.env)`, `mcp.<server>.<tool>`),
resolved `deny > ask > allow`.

### Modes

- **interactive** (default): prompts for anything not allowed by a rule
- **auto** (`--yes`): auto-approves anything not explicitly denied
- **plan**: read-only — file writes, shell commands, and `run_agent` are all
  denied (read-only shell, file reads, and `web_search`/`web_fetch` are
  allowed, since they're non-mutating — `run_agent` isn't, since a sub-agent
  could write files or run shell commands through its own tool calls)

Built-in read-only shell commands (`ls`, `cat`, `grep`, `git status`, …) run
without prompting. Destructive/escaping commands still prompt even in `auto`.

### Exit codes (one-shot)

| Code | Meaning |
| --- | --- |
| `0` | success |
| `1` | runtime/uncaught error |
| `2` | a tool call was denied by policy |
| `3` | tool-call limit reached (`MAX_TOOL_ROUNDS`) |

## Roadmap

See [`PLAN.md`](./PLAN.md) — the single source of truth for planning. Status:

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Scaffold + docs | 🟢 done |
| 1 | CLI parsing, config, plain chat | 🟢 done |
| 2 | Streaming + tools + function-calling loop | 🟢 done |
| 3 | Built-in tools + permission engine | 🟢 done |
| 4 | Web tools (`web_search`, `web_fetch`) | 🟢 done |
| 5 | Sub-agent delegation tool (`run_agent`) | 🟢 done |
| 6 | MCP integration | ⚪ not started |
| 7 | Todo tracking tool | ⚪ not started |
| 8 | Session persistence, context trimming, parallelism | ⚪ not started |
| 9 | Polish, automation, and advanced features | ⚪ future |

## Development

```sh
pnpm dev             # run with --watch
pnpm test            # run tests once
pnpm test:watch      # run tests in watch mode
pnpm test:live       # end-to-end live test against the configured model
pnpm typecheck       # tsc --noEmit
pnpm format          # prettier --write
pnpm format:check    # prettier --check (gates CI)
```

`pnpm test:live` (`scripts/live-e2e.py`) drives the real CLI against the
configured model (`.env` key + `picode.json` model/base URL) and asserts the
CLI output — tool status lines, streamed text, and permission prompts — stays
clean (no clobbering) and that exit codes track policy. It runs model-dependent
REPL flows under a pseudo-terminal via `script`; use `--quick` to skip them and
`--keep` to retain the captured transcripts in `.live/`.

Developer guide: [`AGENTS.md`](./AGENTS.md)
