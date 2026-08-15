# pcode — Project Plan & Product Requirements Document

> **Status legend**
> - `[ ]` pending
> - `[x]` done
> - Phase headers carry a status line: `🟢 done` · `🟡 in progress` · `⚪ not started`
>
> This document is the **single source of truth** for project planning and
> execution. Update it whenever a code change affects features, CLI flags,
> architecture, or conventions — in the same commit as the change.

---

## 1. Product vision

`pcode` is a **model-agnostic, CLI-based AI coding agent** built on the
OpenAI Responses API. It interacts with the user (one-shot and REPL), runs
local system tools (file operations, shell commands, git), streams output,
supports configurable models, and integrates MCP servers — all behind a
declarative, harness-enforced permission system.

Built in incremental phases. Every phase lands as **code + tests + docs + a
commit**.

## 2. Scope

### In scope

- Interactive REPL and one-shot (`pcode "query"`) modes
- Configurable models via the OpenAI Responses SDK (any model string)
- Streaming model output and tool-call status
- Built-in tools: file read/write/list, shell, read-only git
- Declarative permission engine (allow/ask/deny) with interactive prompts
- MCP integration (stdio + streamable HTTP), governed by the same engine
- Client-side conversation history, with context trimming (stretch)
- Session persistence/resume (stretch), parallel tool execution (stretch)

### Non-goals (for now)

- Multi-provider backends (Anthropic, Google, …). The `Provider` interface
  isolates the SDK call so a second provider is a new file, not a refactor.
- Full-screen TUI. The interface is a line-based scrollback REPL.
- Subagents / multi-agent orchestration
- Web UI, sandboxing/OS-level process isolation
- A full markdown renderer (model output prints as plain text)

## 3. Stack & constraints

- **Runtime:** Node.js 26+. Runs `.ts` directly via type stripping — **no
  build step**. Entry point `src/index.ts`.
- **Language:** TypeScript 7 (strict, ESM, `"type": "module"`)
- **Package manager:** pnpm only — never `npm` or `yarn`
- **Imports:** builtins prefixed `node:`; relative imports carry the `.ts`
  extension; `import type` for type-only imports (`verbatimModuleSyntax`)
- **Runtime deps:** `zod` (validation), `ansis` (terminal color),
  `openai` (Responses SDK), `@modelcontextprotocol/sdk` (added in Phase 4)
- **Dev deps:** `vitest`, `typescript`, `@types/node`, `prettier`

## 4. Architecture overview

### Module map

```
src/
  index.ts              entry: parse → config → dispatch (one-shot | REPL)
  cli/
    args.ts             node:util.parseArgs; flag/positional definitions
    commands.ts         slash-command registry (/help /model /mode /clear /tools /exit)
    repl.ts             readline session: history, multiline, keys, Ctrl+C/D
  config/
    schema.ts           zod schemas for config + CLI overrides
    config.ts           resolve & merge defaults ← user ← project ← CLI
    env.ts              project .env loader (OPENAI_API_KEY / OPENAI_BASE_URL)
  agent/
    provider.ts         Provider interface + OpenAI (Responses) impl
    agent.ts            runTurn(): streaming tool-calling loop (core of the agent)
  tools/
    types.ts            Tool interface
    schema.ts           minimal zod → strict JSON-Schema converter
    registry.ts         name → Tool lookup; toolset filtering; execution
    fs.ts               read_file / write_file / list_dir / stat
    shell.ts            run_command (timeout, cwd, capped output)
    git.ts              status / diff / log / show (read-only)
  permissions/
    rules.ts            rule engine: deny > ask > allow, Tool(pattern)
    modes.ts            interactive / auto / plan
    readonly.ts         built-in read-only bash command set
    breaker.ts          circuit breakers (destructive/escaping commands)
    policy.ts           evaluate a call → allow | ask | deny
    prompt.ts           y/n/a prompt with rule preview
  mcp/                  (Phase 4) client.ts + adapter.ts (MCP tool → Tool)
  output/
    palette.ts          fixed palette, NO_COLOR / --no-color
    stream.ts           live text writer + inline status-line manager
tests/                  mirrors src/ 1:1 (tests/<module>/<file>.test.ts)
```

### Data flow

```
index.ts
  → parseArgs → CLI args
  → loadConfig(args) → Config
  → buildProvider(config) → Provider
  → REPL or one-shot

REPL loop: read input → runTurn(userMsg) → print output
  /help /model /mode /clear /tools /exit

runTurn (Phase 2+, streaming):
  input = [...history, {role:'user', content}]
  loop (max N iterations):
    stream = provider.stream({ input, tools: toolsetForModel(policy) })
    on function_call events: policy.check(call) → execute → sendFunctionCallOutputs
    until no function calls
  return final text (also appended to client-side history)
```

### Config schema (zod-validated)

```jsonc
{
  "model": "gpt-5.6",                    // OPENAI_DEFAULT_MODEL env overrides
  "baseURL": "https://api.openai.com/v1",  // OPENAI_BASE_URL env overrides
  "apiKeyEnv": "OPENAI_API_KEY",          // key read from this env var
  "instructions": "…coding agent system prompt…",
  "root": "/path/to/workspace",          // default: process.cwd()
  "additionalDirs": ["../sibling"],
  "mode": "interactive",                  // interactive | auto | plan
  "maxTokens": 8192,                      // response output token cap
  "maxRetries": 3,                        // OpenAI SDK request retries
  "toolTimeout": 30000,                   // default shell tool timeout (ms)
  "permission": {
    "shell": { "allow": ["Bash(pnpm test *)"], "ask": [], "deny": ["Bash(rm -rf *)"] },
    "edit":  { "allow": ["Edit(src/**)"],  "ask": [], "deny": [] },
    "read":  { "allow": [],                "ask": [], "deny": ["Read(.env)"] }
    // mcp.<server>.<tool> rules arrive with Phase 4
  },
  "mcp": { "servers": [] }                // Phase 4
}
```

Merge order: `defaults ← ~/.config/pcode/config.json ← ./pcode.json ← CLI
flags`. Resolution: `--config <path>` → `./pcode.json` →
`~/.config/pcode/config.json`. The environment layers on top of config files
but below CLI flags: the API key is read from `apiKeyEnv` (default
`OPENAI_API_KEY`), `OPENAI_BASE_URL` overrides `baseURL`, and
`OPENAI_DEFAULT_MODEL` overrides `model`. A `.env` file in the working
directory is loaded at startup (dotenv semantics: comments, quotes, `export`;
existing variables win).

### CLI surface

```
pcode [prompt]            one-shot when a prompt is given, REPL otherwise
  --model <id>       --mode <interactive|auto|plan>   --yes (=auto)   --plan (=plan)
  --config <path>    --no-stream   --verbose   --no-color   --version   --help
```

### Slash commands (REPL)

`/help` `/model` `/mode` `/clear` `/tools` `/exit` — registered incrementally
as their dependencies land (Phase 1: `/help` `/clear` `/model` `/mode`
`/exit`, with `/model` `/mode` read-only; Phase 3: `/mode` switching and
`/tools`).

## 5. Locked design decisions

### Foundation

| # | Decision | Choice |
|---|----------|--------|
| D1 | Model scope | OpenAI Responses only; configurable `model` behind a thin `Provider` interface |
| D2 | MCP client | Official `@modelcontextprotocol/sdk` (Client + Stdio/StreamableHTTP transports) |
| D3 | zod→JSON Schema | Minimal in-house converter emitting strict-mode schemas (`additionalProperties:false`, all-required) |
| D4 | Git tools | Read-only always; mutating git ops gated (none implemented yet) |
| D5 | History | Client-side accumulation (`input.push(...response.output)` + `function_call_output` items); `store:false` |
| D6 | Streaming | Introduced in Phase 2 around `client.responses.stream()` / `sendFunctionCallOutputs`; no later rework |
| D7 | Security | Workspace-root confined (path traversal blocked, shell `cwd`=workspace); `additionalDirs` extends it |
| D8 | Tool calls | Sequential execution; parallelism is a Phase 5 enhancement of the same loop |
| D9 | Output | Plain text + ansis; no markdown renderer |

### Permission model (Phase 3)

- **Rule engine:** declarative `permission` config — `allow`/`ask`/`deny`
  arrays per tool, checked before every call; prompts are only the runtime
  fallback for `ask`.
- **Precedence:** `deny > ask > allow`, independent of rule specificity.
- **Patterns:** Claude-Code-style `Tool(pattern)` — `Bash(pnpm test *)`,
  `Edit(src/**)`, `Read(./.env)`, `mcp.<server>.<tool>`; `*`/`?` wildcards,
  `**` for paths.
- **Modes:** `interactive` (default) · `auto` (auto-approve non-denied) ·
  `plan` (read-only). CLI: `--mode`, aliases `--yes`/`--plan`.
- **Defaults:** read = allow, write = ask, shell = ask; `.env*` reads blocked.
- **Read-only bash set:** built-in, non-configurable (`ls`, `cat`, `grep`,
  `git status`, …) runs unprompted.
- **Compound commands:** split on `&&`/`||`/`;`/`|` and match each subcommand;
  strip wrappers (`timeout`, `nohup`, env assignments).
- **Circuit breakers:** destructive/escaping commands (workspace root, home,
  absolute-path escapes) always prompt, even in `auto`.
- **Tool visibility:** denied tools filtered from the model's toolset and
  hard-blocked at call time.
- **Prompt UX:** `y` / `n` / `a`; `a` previews the exact pattern recorded
  (e.g. `Bash(pnpm test *)`); approvals session-only until Phase 5.
- **MCP tools:** same engine, namespaced rules, default `ask`.

### CLI UI/UX

- Line-based scrollback REPL (readline + ansis, zero extra deps); inline
  updates via `cursorTo`/`clearLine`.
- Model text streams live; tool calls render `› shell: pnpm test` →
  `✓ done (2.1s)` with summarized args (`--verbose` expands).
- Active status rewrites in place, settles to a permanent line.
- Ctrl+C cancels the turn → returns to prompt; Ctrl+C at prompt exits; Ctrl+D
  exits; multi-line continuation (`\` or open `{`); persisted per-project
  history.
- Prompt: minimal `›` + muted model badge; dim `[plan]`/`[auto]` indicator when
  not interactive.
- Colors: fixed palette (assistant text default, tool lines dim, errors red,
  prompt green); `--no-color` + `NO_COLOR` honored.
- No banner; errors styled, recoverable ones get a one-line `Tip:`.

## 6. Phases

---

### Phase 0 — Scaffold & docs 🟢 done

**Goal:** working toolchain (Node 26 type stripping, Vitest, Prettier) and
authoritative project docs.

- [x] `package.json`: ESM, `bin: { pcode: "src/index.ts" }`, `engines.node >= 26`, scripts
- [x] `tsconfig.json`: `erasableSyntaxOnly`, `allowImportingTsExtensions`,
      `verbatimModuleSyntax`, `module: nodenext`, `noEmit`, `strict`
- [x] `.prettierrc` / `.prettierignore` (`*.md` excluded) / `.gitignore`
- [x] `vitest.config.ts`
- [x] `src/index.ts` smoke entry (shebang; `--version`/help output)
- [x] `src/version.ts` (version read from `package.json`)
- [x] `src/cli/help.ts` (documents the full CLI surface)
- [x] `tests/`: `version.test.ts`, `cli/help.test.ts`
- [x] Docs: `PLAN.md`, `README.md`, `AGENTS.md`
- [x] Commit: `chore: scaffold Phase 0`

**Acceptance:** `pnpm install`, `pnpm typecheck`, `pnpm test`,
`pnpm format:check` all pass; `node src/index.ts --version` prints the version.

---

### Phase 1 — CLI parsing, config, plain chat 🟢 done

**Goal:** `pcode` holds a tool-free conversation with a configurable model —
one-shot and interactive REPL.

- [x] `cli/args.ts`: `node:util.parseArgs`; all flags + positionals
- [x] `config/schema.ts`: zod config schema
- [x] `config/config.ts`: load/merge/validate (defaults ← user ← project ← CLI)
- [x] `agent/provider.ts`: `Provider` interface + OpenAI Responses impl
      (non-streaming `responses.create`)
- [x] `agent/agent.ts`: `runTurn` text-only; client-side history accumulation
- [x] `output/palette.ts`: fixed palette + `NO_COLOR`/`--no-color`
- [x] `cli/commands.ts` + `cli/repl.ts`: readline session — persisted
      per-project history, multi-line continuation, Ctrl+C cancels the turn /
      exits at the prompt, Ctrl+D exits; `/help` `/clear` `/model` `/mode`
      (read-only) `/exit`
- [x] `index.ts` dispatch: `--version` / `--help` / one-shot / REPL
- **Tests:** `cli/args`, `config/*` (merge order, validation),
  `agent/agent` with a fake provider (no network), `output/palette`
  (`ansis.strip`), `cli/commands`, `cli/repl` (`needsContinuation`) — 50
  tests passing
- **Docs:** updated this file + `README.md` (CLI usage); `AGENTS.md`
  unchanged (module map and conventions already matched)
- **Acceptance:** `pcode "hi"` prints a model reply; REPL supports multi-turn
  conversation; flags override config; `--version`/`--help` correct. Verified
  end-to-end against a local mock of the Responses API.
- **Commit:** `feat: Phase 1 — CLI parsing, config, plain chat`

---

### Phase 2 — Streaming + tools + function-calling loop ⚪ not started

**Goal:** the agent can call tools; all output streams live.

- [ ] `tools/types.ts`: `Tool` interface (name, description, zod input schema,
      execute)
- [ ] `tools/schema.ts`: minimal zod → strict JSON-Schema converter
- [ ] `tools/registry.ts`: registration, lookup, toolset filtering, sequential
      execution
- [ ] `tools/shell.ts`: `run_command` — timeout from `toolTimeout` config,
      `cwd`=workspace, capped output. Until the permission engine lands
      (Phase 3), the shell tool prompts for confirmation before running.
- [ ] `agent/agent.ts`: stream-based loop via `client.responses.stream()`;
      `function_call` events → execute → `sendFunctionCallOutputs`;
      max-iterations guard; tool errors returned as strings to the model
- [ ] `agent/provider.ts`: streaming path (`responses.create({ stream: true })`)
- [ ] `output/stream.ts`: live text writer + tool status lines (name +
      summarized args); `--no-stream` buffering; `--verbose` full detail
- **Tests:** `tools/registry`, `tools/schema` (strict shape),
  `tools/shell` (exit codes, timeout, output cap),
  `agent/agent` with a fake stream (multi-step, errors, iteration exhaustion),
  `output/stream` (`ansis.strip`)
- **Docs:** update as needed
- **Acceptance:** multi-step tool runs complete correctly; text streams live;
  status lines render; `--no-stream`/`--verbose` behave.
- **Commit** when green.

---

### Phase 3 — Built-in tools + permission engine + workspace ⚪ not started

**Goal:** real coding-agent capabilities with the full safety model.

- [ ] `tools/fs.ts`: `read_file` / `write_file` / `list_dir` / `stat`;
      workspace-root confined with traversal guard
- [ ] `tools/git.ts`: `status` / `diff` / `log` / `show` (read-only)
- [ ] `permissions/rules.ts`: `Tool(pattern)` engine — `deny > ask > allow`,
      wildcards, path globs, command prefixes, compound split + wrapper strip
- [ ] `permissions/modes.ts`: interactive / auto / plan
- [ ] `permissions/readonly.ts`: built-in read-only bash command set
- [ ] `permissions/breaker.ts`: circuit breakers (destructive/escaping)
- [ ] `permissions/policy.ts`: evaluate call → allow | ask | deny
      (rules + mode + breakers)
- [ ] `permissions/prompt.ts`: y/n/a prompt with rule preview; session-only
      approvals
- [ ] Toolset filtering via policy (denied tools hidden + hard-blocked)
- [ ] Workspace `additionalDirs` support
- [ ] CLI: `--mode` wired; plan/auto indicators; `/mode` `/tools`
- **Tests:** fs round-trip + traversal in tmp dirs;
  git on a temp repo; rule engine (precedence, patterns, compound, wrappers);
  modes; breakers; prompt decisions; policy integration
- **Docs:** update as needed
- **Acceptance:** the agent edits files, runs shell, and queries git safely,
  honoring rules and modes.
- **Commit** when green.

---

### Phase 4 — MCP integration ⚪ not started

**Goal:** connect external MCP servers (stdio + streamable HTTP); tools flow
through the same permission engine.

- [ ] Add `@modelcontextprotocol/sdk` runtime dep
- [ ] `config/schema.ts`: `mcp.servers[]` (name, command/args/env | url/headers)
- [ ] `mcp/client.ts`: connect / listTools / callTool over both transports
- [ ] `mcp/adapter.ts`: MCP tool → `Tool`; namespaced `mcp.<server>.<tool>`;
      default `ask`
- [ ] Startup connection + tool registration; one failing server must not kill
      the session
- **Tests:** adapter against a mocked Client; namespaced rule matching; config
  validation
- **Docs:** update as needed
- **Acceptance:** a configured MCP server's tools appear in `/tools`, are
  callable, and honor permission rules.
- **Commit** when green.

---

### Phase 5 — Stretch: persistence, context, parallelism ⚪ not started

**Goal:** long-running, ergonomic sessions.

- [ ] Session persistence / `--resume` (distinct from readline history)
- [ ] Context trimming: token-budget compaction of client-side history
- [ ] Parallel tool execution (`Promise.all`) in the agent loop
- [ ] Persist `always` approvals to config (allowlist)
- **Tests:** history serialize/restore, trim behavior, parallel execution,
  allowlist round-trip
- **Docs:** update as needed
- **Commit** when green.

---

## 7. Engineering practices

- **One focused commit per change.** Never mix unrelated work.
- **Docs in sync, same commit.** A change to features, CLI flags, architecture,
  or conventions updates `PLAN.md`, `README.md`, and `AGENTS.md`.
- **No premature abstraction.** Implement the simplest thing that satisfies the
  current phase. Don't build for hypothetical features (the one designed-for
  exception is the `Provider` interface).
- **Comments explain *why*, never *what*.** No line-by-line narration.
- **`console.log`/`process.stdout` is reserved** for streamed model output and
  the REPL prompt — never for diagnostics.
- **Tests:** `tests/` mirrors `src/`. Prefer fast deterministic unit tests;
  mock external boundaries (fetch, fs, openai client). Assert colors via
  `ansis.strip`.

## 8. Risks & open items

- **Token growth in client-side history** — mitigated by Phase 5 context
  trimming; watch for long REPL sessions in the interim.
- **Shell rule matching is heuristic** — compound-command splitting and wrapper
  stripping are best-effort; circuit breakers are the backstop, not perfect
  parsing.
- **`Provider` interface stability** — D1 keeps it minimal; avoid leaking SDK
  types into the agent loop so a second provider stays a new file.
- **Rule persistence is deferred to Phase 5** — `always` approvals are
  session-only until then.
- **Strict tool schemas** (`additionalProperties: false`, all-required) shape
  the zod converter; optional fields become nullable unions.
