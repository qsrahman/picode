# picode — Project Plan & Product Requirements Document

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

`picode` is a **model-agnostic, CLI-based AI coding agent** built on the
OpenAI Responses API. It interacts with the user (one-shot and REPL), runs
local system tools (file operations, shell commands, git), streams output,
supports configurable models, and integrates MCP servers — all behind a
declarative, harness-enforced permission system.

Built in incremental phases. Every phase lands as **code + tests + docs + a
commit**.

## 2. Scope

### In scope

- Interactive REPL and one-shot (`picode "query"`) modes
- Configurable models via the OpenAI Responses SDK (any model string)
- Streaming model output and tool-call status
- Built-in tools: file read/write/list, shell, read-only git
- Declarative permission engine (allow/ask/deny) with interactive prompts
- MCP integration (stdio + streamable HTTP), governed by the same engine
- Client-side conversation history, with context trimming (stretch)
- Session persistence/resume (stretch), parallel tool execution (stretch)
- A single level of sub-agent delegation (`run_agent`), governed by the same
  permission engine, running headless (no interactive prompts, no nested
  sub-agents)

### Non-goals (for now)

- Multi-provider backends (Anthropic, Google, …). The `Provider` interface
  isolates the SDK call so a second provider is a new file, not a refactor.
- Full-screen TUI. The interface is a line-based scrollback REPL.
- Multi-agent orchestration beyond one level of delegation (no nested
  sub-agents, no concurrent/parallel sub-agents)
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
  `openai` (Responses SDK), `@modelcontextprotocol/sdk` (added in Phase 6)
- **Dev deps:** `vitest`, `typescript`, `@types/node`, `prettier`

## 4. Architecture overview

### Module map

```
src/
  index.ts              entry: parse → config → dispatch (one-shot | REPL)
  errors.ts             shared error classes (CliError, ConfigError) + messageOf helper
  cli/
    args.ts             node:util.parseArgs; flag/positional definitions
    commands.ts         slash-command registry (/help /model /mode /clear /reset /tools /version /exit)
    history.ts          loadHistory / saveHistory / HISTORY_SIZE
    repl.ts             readline session: history, multiline, keys, Ctrl+C/D;
                        wires the permission engine into the loop via authorize()
  config/
    schema.ts           zod schemas for config + CLI overrides
    config.ts           resolve & merge defaults ← user ← project ← CLI
  agent/
    provider.ts         Provider interface + OpenAI (Responses) impl
    agent.ts            runTurn(): streaming tool-calling loop (core of the agent)
  tools/
    types.ts            Tool interface
    schema.ts           minimal zod → strict JSON-Schema converter
    registry.ts         name → Tool lookup; execution
    fs.ts               read_file / write_file / edit_file / list_dir / stat
    shell.ts            run_command (timeout, cwd, capped output)
    git.ts              status / diff / log / show (read-only)
    web.ts              web_search (Brave Search) / web_fetch (HTML→text)
    netGuard.ts         SSRF guard: rejects loopback/private/link-local targets
    agent.ts            run_agent: headless sub-agent, one level of nesting only
  permissions/
    rules.ts            rule engine: deny > ask > allow, Tool(pattern)
    modes.ts            interactive / auto / plan
    readonly.ts         built-in read-only bash command set
    breaker.ts          circuit breakers (destructive/escaping commands)
    policy.ts           evaluate a call → allow | ask | deny
    prompt.ts           y/n/a prompt with rule preview
  mcp/                  (Phase 6) client.ts + adapter.ts (MCP tool → Tool)
  utils/
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
  /help /model /mode /clear /reset /tools /version /exit

runTurn (Phase 2+, streaming):
  input = [...history, {role:'user', content}]
  loop (max N iterations):
    stream = provider.stream({ input, tools: toolsetForModel(policy) })
    on function_call events: authorize(call) → execute → sendFunctionCallOutputs
    until no function calls
  return final text (also appended to client-side history)
```

> Streaming loop mechanics (SDK 7.4): there is no `sendFunctionCallOutputs`
> helper, so each round pushes the prior `response.output` plus
> `{type:'function_call_output', call_id, output}` into `input` and calls
> `stream()` again (D5). Text deltas stream live from the first request; the
> loop exits when a response contains no function calls.

### Config schema (zod-validated)

```jsonc
{
  "model": "gpt-5.6",                    // OPENAI_DEFAULT_MODEL env overrides
  "baseURL": "https://api.openai.com/v1",  // OPENAI_BASE_URL env overrides
  "apiKeyEnv": "OPENAI_API_KEY",          // key read from this env var
  "braveSearchApiKeyEnv": "BRAVE_SEARCH_API_KEY", // web_search key env var
  "instructions": "…coding agent system prompt…", // default: agent/systemPrompt.ts's tool-usage guidance
  "root": "/path/to/workspace",          // default: process.cwd()
  "additionalDirs": ["../sibling"],
  "mode": "interactive",                  // interactive | auto | plan
  "maxTokens": 8192,                      // response output token cap
  "maxRetries": 3,                        // OpenAI SDK request retries
  "toolTimeout": 30000,                   // default shell tool timeout (ms)
  "permission": {
    "shell":      { "allow": ["Bash(pnpm test *)"], "ask": [], "deny": ["Bash(rm -rf *)"] },
    "edit":       { "allow": ["Edit(src/**)"],  "ask": [], "deny": [] },
    "read":       { "allow": [],                "ask": [], "deny": ["Read(.env)"] },
    "webSearch":  { "allow": [],                "ask": [], "deny": [] },
    "webFetch":   { "allow": [],                "ask": [], "deny": [] },
    "agent":      { "allow": [],                "ask": [], "deny": [] }
    // mcp.<server>.<tool> rules arrive with Phase 6
  },
  "mcp": { "servers": [] }                // Phase 6
}
```

Merge order: `defaults ← ~/.config/picode/config.json ← ./picode.json ← CLI
flags`. Resolution: `--config <path>` → `./picode.json` →
`~/.config/picode/config.json`. The environment layers on top of config files
but below CLI flags: the API key is read from `apiKeyEnv` (default
`OPENAI_API_KEY`), `OPENAI_BASE_URL` overrides `baseURL`, and
`OPENAI_DEFAULT_MODEL` overrides `model`. The `pnpm start` / `pnpm dev`
scripts load a project `.env` via Node's `--env-file` flag (dotenv semantics;
existing variables win).

### CLI surface

```
picode [prompt]            one-shot when a prompt is given, REPL otherwise
  --model <id>       --mode <interactive|auto|plan>   --auto (=auto)   --plan (=plan)
  --config <path>    --no-stream   --verbose   --no-color   --version   --help
```

### Slash commands (REPL)

`/help` `/model` `/mode` `/clear` `/reset` `/tools` `/version` `/exit` —
registered incrementally as their dependencies land (Phase 1: `/help`
`/clear` `/reset` `/model` `/mode` `/exit`, with `/model` `/mode` read-only;
Phase 3: `/mode` switching and `/tools`; `/version` added later). `/clear`
clears the terminal, `/reset` wipes the
conversation.

## 5. Locked design decisions

### Foundation

| # | Decision | Choice |
|---|----------|--------|
| D1 | Model scope | OpenAI Responses only; configurable `model` behind a thin `Provider` interface |
| D2 | MCP client | Official `@modelcontextprotocol/sdk` (Client + Stdio/StreamableHTTP transports) |
| D3 | zod→JSON Schema | Minimal in-house converter emitting strict-mode schemas (`additionalProperties:false`, all-required) |
| D4 | Git tools | Read-only always; mutating git ops gated (none implemented yet) |
| D5 | History | Client-side accumulation (`input.push(...response.output)` + `function_call_output` items); `store:false` |
| D6 | Streaming | Phase 2 streams via `client.responses.stream()`. SDK 7.4 has no `sendFunctionCallOutputs`, so each tool round re-creates the request from D5's accumulated items — no later rework |
| D7 | Security | Workspace-root confined (path traversal blocked, shell `cwd`=workspace); `additionalDirs` extends it |
| D8 | Tool calls | Sequential execution; parallelism is a Phase 8 enhancement of the same loop |
| D9 | Output | Plain text + ansis; no markdown renderer |
| D10 | Network security | `web_fetch` is confined the network-native way D7 confines the filesystem: a hard, non-configurable guard (`tools/netGuard.ts`) rejects loopback/private/link-local resolved addresses before every request, independent of the (configurable) permission engine |
| D11 | Sub-agents | One level of delegation only (`run_agent` can't call itself); headless — no interactive prompts, so an unresolved `ask` for its inner tool calls auto-denies instead of hanging or nesting a prompt inside a prompt |

### Permission model (Phase 3)

- **Rule engine:** declarative `permission` config — `allow`/`ask`/`deny`
  arrays per tool, checked before every call; prompts are only the runtime
  fallback for `ask`.
- **Precedence:** `deny > ask > allow`, independent of rule specificity.
- **Patterns:** Claude-Code-style `Tool(pattern)` — `Bash(pnpm test *)`,
  `Edit(src/**)`, `Read(./.env)`, `WebSearch(*)`,
  `WebFetch(https://internal.corp/**)`, `mcp.<server>.<tool>`; `*`/`?`
  wildcards, `**` for paths (`Bash`/`WebSearch`/`WebFetch` operands use
  crossSlash glob matching instead, since they aren't nested paths — a bare
  `*` already spans `/`). `web_search` and `web_fetch` are deliberately
  separate categories rather than one shared `web` bucket, so a rule can
  target one without also matching the other (a query string and a URL have
  different risk profiles). `Agent(description)` follows the same crossSlash
  convention.
- **Modes:** `interactive` (default) · `auto` (auto-approve non-denied) ·
  `plan` (read-only, but `webSearch`/`webFetch` calls are non-mutating so
  they're allowed through like reads — see Phase 4; `agent` is *not*
  non-mutating, so `plan` mode denies it alongside `edit` — see Phase 5).
  CLI: `--mode`, aliases `--auto`/`--plan`.
- **Defaults:** read = allow, write = ask, shell = ask, webSearch = ask,
  webFetch = ask, agent = ask (no readonly-style auto-allow list — every
  `web_search`/`web_fetch`/`run_agent` call needs a config rule or a live
  approval); `.env*` reads blocked.
- **Read-only bash set:** built-in, non-configurable (`ls`, `cat`, `grep`,
  `git status`, …) runs unprompted.
- **Compound commands:** split on `&&`/`||`/`;`/`|` and match each subcommand;
  strip wrappers (`timeout`, `nohup`, env assignments).
- **Circuit breakers:** destructive/escaping commands (workspace root, home,
  absolute-path escapes) always prompt, even in `auto`.
- **Tool visibility:** denied tools filtered from the model's toolset and
  hard-blocked at call time.
- **Prompt UX:** `y` / `n` / `a`; `a` previews the exact pattern recorded
  (e.g. `Bash(pnpm test *)`); approvals session-only until Phase 8.
- **MCP tools:** same engine, namespaced rules, default `ask`.
- **Network tools (Phase 4):** `web_search`/`web_fetch` get their own
  `webSearch`/`webFetch` categories rather than folding into `read` (or into
  one shared `web` bucket) — network egress to an arbitrary host has a
  different risk profile than a workspace-confined file read (SSRF, context
  exfiltration), and a query string and a URL are different enough operands
  that a rule allowing one shouldn't silently allow the other. Both default to
  `ask` with no auto-allow list. A hard, unconditional guard (D10) sits
  beneath the configurable policy.
- **Sub-agent tool (Phase 5):** `run_agent` gets its own `agent` category
  rather than reusing `edit` — it's `ask` by default like the other
  non-readonly categories, but unlike `read`/`webSearch`/`webFetch` it's also
  denied outright in `plan` mode, since a sub-agent's own inner tool calls
  can write files or run shell commands. It runs headless (D11): its inner
  calls are gated non-interactively, so anything not already allowed is
  silently refused rather than popping a nested prompt.
- **Todo tool (Phase 7):** `todo` gets its own `todo` category
  (`Todo(pattern)`) rather than reusing `edit`. It **defaults to `allow`** in
  every mode — like `read`/`webSearch`/`webFetch` it only mutates session
  state, never the workspace, so it isn't a write to gate. A `deny` (or
  `ask`) rule can still target it (`Todo(*)`, `Todo(delete)`). It runs
  unprompted in `plan` mode, and `/reset` clears the in-memory checklist.

### CLI UI/UX

- Line-based scrollback REPL (readline + ansis, zero extra deps); inline
  updates via `cursorTo`/`clearLine`.
- Model text streams live; each tool call starts a dim status line
  `› shell: pnpm test` with an in-place elapsed timer, which settles into one
  permanent scrollback line when done (the running state never pollutes
  scrollback).
- Output rhythm (one blank line between each block):

  ```
  Ask anything, /help for commands
  > run ls -F

  › shell: ls -F ✓ done (0.0s)

  <agent output…>

  Ask anything, /help for commands
  >
  ```
- Approval (Phase 2, before the rule engine): a two-line prompt that pauses the
  REPL —

  ```
  › shell: pnpm test
    Run? (y/n/a)
  ```

  `y` runs once, `n` denies, `a` allows for the session (approvals are
  session-only until Phase 8). The prompt is an injected hook owned by the
  agent loop — never the tool — so Phase 3 swaps it for the rule engine
  without touching `shell.ts`. Non-interactive runs (one-shot, piped stdin)
  auto-deny instead of prompting; `--auto` bypasses.
- Success: `✓ done (2.1s)` appended to the settled line. No output is shown by
  default — it is model-facing only; `--verbose` prints full stdout/stderr.
- Failure: `✗ failed (exit 1, 2.1s)` in red plus a short dim stderr/stdout
  excerpt; the full error is also returned to the model to self-correct.
- Tool args are summarized by default; `--verbose` expands.
- Ctrl+C cancels the turn → returns to prompt; Ctrl+C at prompt exits; Ctrl+D
  exits; multi-line continuation (`\` or open `{`); persisted per-project
  history.
- Prompt: two lines — plain `Ask anything, /help for commands` hint above a
  green `>` input line; `[plan]`/`[auto]` indicator on the hint line when not
  interactive.
- Colors: fixed palette (assistant text default, tool lines dim, errors red,
  prompt green); `--no-color` + `NO_COLOR` honored.
- No banner; errors styled, recoverable ones get a one-line `Tip:`.

## 6. Phases

---

### Phase 0 — Scaffold & docs 🟢 done

**Goal:** working toolchain (Node 26 type stripping, Vitest, Prettier) and
authoritative project docs.

- [x] `package.json`: ESM, `bin: { picode: "src/index.ts" }`, `engines.node >= 26`, scripts
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

**Goal:** `picode` holds a tool-free conversation with a configurable model —
one-shot and interactive REPL.

- [x] `cli/args.ts`: `node:util.parseArgs`; all flags + positionals
- [x] `config/schema.ts`: zod config schema
- [x] `config/config.ts`: load/merge/validate (defaults ← user ← project ← CLI)
- [x] `agent/provider.ts`: `Provider` interface + OpenAI Responses impl
      (non-streaming `responses.create`)
- [x] `agent/agent.ts`: `runTurn` text-only; client-side history accumulation
- [x] `utils/palette.ts`: fixed palette + `NO_COLOR`/`--no-color`
- [x] `cli/commands.ts` + `cli/repl.ts`: readline session — persisted
      per-project history, multi-line continuation, Ctrl+C cancels the turn /
      exits at the prompt, Ctrl+D exits; `/help` `/clear` `/reset` `/model`
      `/mode` (read-only) `/exit`
- [x] `index.ts` dispatch: `--version` / `--help` / one-shot / REPL
- **Tests:** `cli/args`, `config/*` (merge order, validation),
  `agent/agent` with a fake provider (no network), `utils/palette`
  (`ansis.strip`), `cli/commands`, `cli/repl` (`needsContinuation`) — 50
  tests passing
- **Docs:** updated this file + `README.md` (CLI usage); `AGENTS.md`
  unchanged (module map and conventions already matched)
- **Acceptance:** `picode "hi"` prints a model reply; REPL supports multi-turn
  conversation; flags override config; `--version`/`--help` correct. Verified
  end-to-end against a local mock of the Responses API.
- **Commit:** `feat: Phase 1 — CLI parsing, config, plain chat`

---

### Phase 2 — Streaming + tools + function-calling loop 🟢 done

**Goal:** the agent can call tools; all output streams live.

- [x] `tools/types.ts`: `Tool` interface (name, description, zod input schema,
      execute)
- [x] `tools/schema.ts`: minimal zod → strict JSON-Schema converter
- [x] `tools/registry.ts`: registration, lookup, sequential execution
- [x] `tools/shell.ts`: `run_command` — timeout from `toolTimeout` config,
      `cwd`=workspace, capped output (`exit <code>` + truncated stdout/stderr).
      Pure execution: confirmation is the agent loop's job (injected
      `requestApproval` hook), so Phase 3 swaps the prompt for the rule engine
      without touching the tool.
- [x] `agent/agent.ts`: stream-based tool loop — each round streams via
      `provider.stream`, extracts `function_call` items from `response.output`,
      executes through the registry behind an injected `requestApproval` hook
      (auto-deny when not interactive), then pushes `function_call_output`
      items and re-creates the request (D5); `MAX_TOOL_ROUNDS` guard; tool
      errors returned as strings to the model
- [x] `agent/provider.ts`: streaming path via `client.responses.stream()` —
      `ProviderItem`/`ProviderEvent`/`ProviderStream`; SDK types kept out of
      the agent loop
- [x] `utils/stream.ts`: live text writer + tool status lines (one settled
      line per call: `› shell: …` → `✓ done` / `✗ failed` + excerpt); tool
      output hidden by default (model-facing); `--no-stream` buffering;
      `--verbose` full detail
- [x] **UX: truncation notice** — when `TurnResult.truncated` is true (hit
      `MAX_TOOL_ROUNDS`), display error notice in REPL and stderr in one-shot
- [x] **Cleanup: consolidate errors** — shared `CliError`, `ConfigError`,
      `messageOf` helper in `errors.ts` (eliminated 5 duplication sites)
- [x] **Cleanup: extract REPL logic** — `cli/history.ts` (load/save/HISTORY_SIZE),
      `cli/approval.ts` (approvalKey/summaryOf/applyApprovalAnswer) for
      improved testability
- [x] **Cleanup: remove dead code** — palette.assistant (test-only),
      `registry.filter()` (Phase 3 premature abstraction)
- **Tests:** `tools/registry`, `tools/schema` (strict shape) ✓;
      `agent/agent` with a fake stream (multi-step, errors, iteration
      exhaustion, approval, `onToolResult`) ✓; `tools/shell` (exit codes,
      timeout, output cap) ✓; `utils/stream` (text, status settle, pause/
      resume, `enabled:false`) ✓; `cli/history` (round-trip, cap, mkdir) ✓;
      `cli/approval` (keying, truncation, answer logic) ✓ — 108 tests passing
- **Docs:** updated this file + `README.md` (tools + approval UX)
- **Acceptance:** multi-step tool runs complete correctly; text streams live;
  status lines settle to one line per call; the approval prompt pauses until
  answered and honors `y`/`n`/`a`; non-interactive tool calls auto-deny;
  failures show `✗` + snippet; truncation at round 8 surfaces notice;
  `--no-stream`/`--verbose` behave. Verified end-to-end against local Ollama
  (multi-step math, success, failure, and deny flows, plus the interactive
  approval path on a PTY).
- **Commits:** Phase 2 core (1 commit) + cleanup pass (1 commit; removed
  duplication, extracted modules, surfaced truncated UX, eliminated dead code);
  both green on their own.

---

### Phase 3 — Built-in tools + permission engine + workspace 🟢 done

**Goal:** real coding-agent capabilities with the full safety model.

#### Core features

- [x] `tools/fs.ts`: `read_file` / `write_file` / `list_dir` / `stat`;
       workspace-root confined with traversal guard (`edit_file` — exact
       `old_string`→`new_string` surgical patch, ambiguous/missing match
       reported rather than guessed — added post-Phase-4, same category/key
       as `write_file` so no permission-engine change was needed)
- [x] `tools/git.ts`: `status` / `diff` / `log` / `show` (read-only)
- [x] `permissions/rules.ts`: `Tool(pattern)` engine — `deny > ask > allow`,
       wildcards, path globs, command prefixes, compound split + wrapper strip
- [x] `permissions/modes.ts`: interactive / auto / plan
- [x] `permissions/readonly.ts`: built-in read-only bash command set
- [x] `permissions/breaker.ts`: circuit breakers (destructive/escaping)
- [x] `permissions/policy.ts`: evaluate call → allow | ask | deny
       (rules + mode + breakers)
- [x] `permissions/prompt.ts`: y/n/a prompt with rule preview; session-only
       approvals
- [x] Toolset filtering via policy (denied tools hidden + hard-blocked)
- [x] Workspace `additionalDirs` support
- [x] CLI: `--mode` wired; plan/auto indicators; `/mode` `/tools`

#### Usability enhancements (high-impact, low-effort)

- [x] **Rule feedback on denial:** when denying a tool call, show matching rule
       name + reason (e.g., `✗ denied (rule Bash(rm -rf *))`);
       `permissions/policy.ts` exposes `denyReason`
- [x] **Tool discovery command:** `/tools` lists available tools with
       descriptions and current allow/ask/deny status per mode
- [x] **Semantic exit codes:** one-shot exits 0 on success, 2 when a tool call
       is denied by policy; `index.ts` maps the turn result to the code

- **Tests:** fs round-trip + traversal in tmp dirs;
   git on a temp repo; rule engine (precedence, patterns, compound, wrappers);
   modes; breakers; prompt decisions; policy integration; exit code mapping
- **Docs:** updated this file + `README.md` (tools, modes, `/tools`, exit codes)
- **Acceptance:** the agent edits files, runs shell, and queries git safely,
   honoring rules and modes; denied tools show the blocking rule; `/tools`
   displays available tools with status; exit codes reflect the outcome
   (success/denied).
- **Commit:** Phase 3 landed as slices A–J, each green on `pnpm typecheck` /
   `pnpm test` / `pnpm format:check`.

---

### Phase 4 — Web tools 🟢 done

**Goal:** the agent can search the web and fetch a page's content, gated by
the permission engine and a hard SSRF guard, with zero new runtime
dependencies.

#### Core features

- [x] `tools/web.ts`: `web_search` (Brave Search API — title/url/description
      results, capped like `tools/shell.ts`'s output) and `web_fetch` (fetch a
      URL, stream-cap the response, strip HTML to text via an in-house
      minimal stripper, cap the output)
- [x] `tools/netGuard.ts`: `assertPublicUrl` — hard, non-configurable check
      (D10) run before every `web_fetch` request; rejects loopback/private/
      link-local literal hosts and resolved DNS addresses (covers the cloud
      metadata endpoint `169.254.169.254`), independent of the permission
      engine, mirroring D7's workspace confinement for the filesystem
- [x] `config/schema.ts` + `config.ts`: `braveSearchApiKeyEnv` (default
      `BRAVE_SEARCH_API_KEY`) — env var *name*, same pattern as `apiKeyEnv`;
      missing key degrades `web_search` to a clear in-band message rather than
      failing startup or hiding the tool
- [x] `permissions/rules.ts` + `policy.ts`: separate `webSearch`/`webFetch`
      categories — `WebSearch(pattern)`/`WebFetch(pattern)` syntax (not one
      shared `web` bucket, so a rule can target one without also matching the
      other), crossSlash glob matching (like `Bash`, not path-glob like
      `Edit`/`Read`), `TOOL_META` entries for `web_search`/`web_fetch`,
      default decision `ask` for both (no readonly-style auto-allow list);
      plan mode allows them through like `read` (all non-mutating); `auto`
      mode auto-approves them like every other non-breaker category
- [x] `permissions/prompt.ts`: `summaryOf` shows `web_search: <query>` /
      `web_fetch: <url>` instead of the generic fallback
- [x] `index.ts`: tools registered unconditionally alongside shell/fs/git

- **Tests:** `tools/netGuard.test.ts` (literal + DNS-resolved rejection,
   mocked `node:dns/promises`); `tools/web.test.ts` (mocked global `fetch` —
   missing-key message, result formatting, non-2xx, HTML stripping, non-HTML
   passthrough, output capping, SSRF short-circuit before `fetch` runs);
   `permissions/rules.test.ts` + `policy.test.ts` (`WebSearch(...)`/
   `WebFetch(...)` pattern parsing and matching, category independence,
   defaults and mode behavior); `config/config.test.ts` (`permission.webSearch`/
   `permission.webFetch` merge, `braveSearchApiKeyEnv`)
- **Docs:** updated this file + `README.md` (tools, config example, `.env`,
   permission model, roadmap) + `AGENTS.md` (module map)
- **Acceptance:** `web_search`/`web_fetch` show up in `/tools`; both default
   to prompting for approval; the SSRF guard rejects `http://169.254.169.254/`
   and `http://localhost:11434/` before any request is made; a missing
   `BRAVE_SEARCH_API_KEY` produces a clear message instead of an error;
   verified live via a PTY session against a real Brave API key and a real
   fetch — status-line rendering during the approval prompt is correct (reuses
   the `pauseStatus`/`promptForDecision` fix, no regression).
- **Commit:** when green.

---

### Phase 5 — Sub-agent delegation tool 🟢 done

**Goal:** the agent can delegate a well-scoped, self-contained subtask to a
fresh instance of the same tool-calling loop, gated by the permission engine,
without opening the door to nested/runaway multi-agent orchestration.

#### Core features

- [x] `tools/agent.ts`: `run_agent` (`{ description, prompt }`) reuses
      `agent/agent.ts`'s `runTurn` directly — a fresh, isolated conversation
      (no access to the parent's history), the same `Provider` and
      `ToolRegistry` as the parent. Headless: its inner tool calls are gated
      via `permissions/prompt.ts`'s `createAuthorizer` with a non-interactive
      IO (same helper the one-shot CLI uses), so an unresolved `ask` silently
      auto-denies instead of popping a prompt — only what's already covered
      by an allow rule, the read-only shell default, or `auto`/`plan` mode
      goes through. One level of nesting only: its own toolset excludes
      `run_agent` (filtered out of `toolsetForModel`'s result), backed by a
      closure-scoped recursion guard as a hard backstop. Output capped like
      `tools/shell.ts`/`tools/web.ts`'s `OUTPUT_CAP`.
- [x] `permissions/rules.ts` + `policy.ts`: new `agent` category —
      `Agent(description)` syntax, crossSlash glob matching (like
      `Bash`/`WebSearch`/`WebFetch`), `TOOL_META` entry for `run_agent`,
      default decision `ask`. Unlike `read`/`webSearch`/`webFetch`, `agent`
      joins `edit` in `plan` mode's deny branch — a sub-agent can perform
      arbitrary writes/shell commands through its own inner tool calls, so it
      isn't non-mutating like a read.
- [x] `permissions/prompt.ts`: `summaryOf` shows `agent: <description>`
      instead of the generic fallback.
- [x] `index.ts` + `cli/repl.ts`: `ApprovalCache` construction hoisted to
      `index.ts`'s `main()` (was built separately inside the one-shot branch
      and inside `runRepl()`) so `run_agent` shares the same session
      "always allow" cache as the interactive authorizer; threaded into
      `runRepl()` via a new `ReplOptions.approvals` field.
- [x] `agent/systemPrompt.ts`: `DEFAULT_INSTRUCTIONS` tells the model when to
      delegate to `run_agent` and that it can't request approval mid-task or
      spawn further sub-agents.
- [x] **Follow-up (landed with Phase 7's `todo` tool):** `run_agent` builds a
      sub-registry rather than reusing the parent's directly — every
      workspace/network tool is still shared (same filesystem, shell, git
      repo), but `todo` is session state, not workspace state, so a fresh
      `TodoStore` is swapped in when the parent has one. A sub-agent can plan
      its own delegated task with its own checklist but never sees or
      mutates the parent's.

- **Tests:** `tools/agent.test.ts` (isolated conversation, recursion guard,
   inner-call denial without prompting, inner-call allow-rule reuse, output
   capping, input validation, todo-list isolation from the parent);
   `permissions/rules.test.ts` + `policy.test.ts`
   (`Agent(...)` pattern parsing, default `ask`, plan-mode denial,
   `denyReason`); `config/config.test.ts` (`permission.agent` merge);
   `agent/systemPrompt.test.ts` (tool named, delegation guidance present).
- **Docs:** updated this file + `README.md` (tools, permission model, config
   example) + `AGENTS.md` (module map).
- **Acceptance:** `run_agent` shows up in `/tools`, defaults to prompting for
   approval, and is denied outright in `--mode plan`; a sub-agent's inner
   tool call matching an existing allow rule succeeds without prompting,
   while anything else is silently refused; nesting (`run_agent` calling
   `run_agent`) is refused with a clear message; the parent conversation
   shows exactly one status line for the whole sub-run, not the sub-agent's
   intermediate tool calls.
- **Commit:** when green.

---

### Phase 6 — MCP integration ⚪ not started

**Goal:** connect external MCP servers (stdio + streamable HTTP); tools flow
through the same permission engine.

#### Core features

- [ ] Add `@modelcontextprotocol/sdk` runtime dep
- [ ] `config/schema.ts`: `mcp.servers[]` (name, command/args/env | url/headers)
- [ ] `mcp/client.ts`: connect / listTools / callTool over both transports
- [ ] `mcp/adapter.ts`: MCP tool → `Tool`; namespaced `mcp.<server>.<tool>`;
      default `ask`
- [ ] Startup connection + tool registration; one failing server must not kill
      the session

#### Usability enhancements (high-impact, low-effort)

- [ ] **Token usage tracking:** collect token counts from provider (input +
      output per turn), display cumulative total + estimated cost at end of
      each turn; update `provider.ts` to surface token data, add to
      `TurnResult`; update `utils/stream.ts` to display; optional
      `--budget N` config to warn when approaching threshold; ~60 LOC

- **Tests:** adapter against a mocked Client; namespaced rule matching; config
  validation; token accumulation and budget warnings
- **Docs:** update as needed; add token usage and cost estimation to README
- **Acceptance:** a configured MCP server's tools appear in `/tools`, are
  callable, and honor permission rules; cumulative token count and estimated
  cost displayed after each turn; optional budget threshold warnings work.
- **Commit** when green.

---

### Phase 7 — Todo tracking tool 🟢 done (core)

**Goal:** the agent can plan complex work into tracked subtasks and keep them
synchronized across tool rounds.

#### Todo tool (task planning & tracking) — done

- [x] `tools/todo.ts`: `TodoItem { id, content, status }` (`pending` |
      `in_progress` | `done`), `TodoStore` (session-scoped; add/update/
      complete/delete/list; monotonic ids never reused; snapshot rendering)
- [x] `createTodoTool({ store })`: single `todo` tool, granular actions —
      `add`/`update`/`complete`/`delete`/`list`; semantic validation per
      action in `execute` (schema.ts supports no unions)
- [x] Every action returns the full snapshot (`todo: <done>/<total> done` +
      `[x] #<id> <content>` lines); the loop's `function_call_output`
      threading keeps the model synchronized — no `agent.ts` changes
- [x] Wiring: store created per session in `index.ts`, injected by closure
      (shell pattern); `/reset` clears it; ~50-item cap
- [x] REPL: settle `› todo: N/M done` status line per change; `--verbose`
      prints the full list
- [x] Approval: same `requestApproval` path as every tool; `todo` gets its own
      permission category (`Todo(pattern)`) that **defaults to `allow`** in
      every mode (it only mutates session state, never the workspace), tunable
      via a `deny`/`ask` rule
- [x] `tools/agent.ts` (Phase 5's `run_agent`) updated in the same effort: a
      sub-agent now gets its own isolated `TodoStore` instead of sharing (or
      being excluded from) the parent's — see Phase 5's follow-up note.

#### Usability enhancements (high-impact, low-effort) — deferred to Phase 8

- [ ] **Session tagging & metadata:** support `--session=<name>` flag to
      organize related work; store session name + created/modified timestamps
      in history directory naming/metadata; allow filtering history by tag;
      update `cli/history.ts` to support tagged sessions; ~40 LOC
- [ ] **Persistent todo state (session-scoped):** todo store survives across
      REPL sessions with the same `--session` tag; serialize/restore state
      alongside conversation history; ~30 LOC. **Deferred to Phase 8** — it
      overlaps that phase's session-persistence/`--resume` work, so landing it
      there avoids reworking the same serialization code now.

- **Tests:** store ops (id reuse, cap); per-action validation; snapshot
  format; permission/policy wiring; config merge; system-prompt reference —
  all green. (Session tagging/restore tests land with Phase 8.)
- **Docs:** updated this file + `README.md` (tool list, UX, permission model,
  roadmap) + `AGENTS.md` (module map, phase note).
- **Acceptance (core):** the agent breaks a multi-step prompt into subtasks,
  updates progress as it works, and the `› todo: N/M done` status line stays in
  sync; the snapshot survives across REPL turns; `/reset` clears it; `todo`
  runs unprompted in every mode; a `Todo(*)` deny rule blocks it.
- **Commit** when green.

---

### Phase 8 — Session persistence, context trimming, parallelism ⚪ not started

**Goal:** long-running sessions survive restarts; token growth is bounded;
tool calls can execute in parallel when safe.

#### Session persistence & context trimming

- [ ] Session persistence / `--resume` (distinct from readline history); the
      todo store rides along
- [ ] Context trimming: token-budget compaction of client-side history
      (sliding window or summarization strategy TBD)
- [ ] Persist `always` approvals to config (allowlist)

#### Parallel tool execution

- [ ] Agent loop: detect tool call independence (heuristic: separate
      arguments), execute with `Promise.all` instead of sequential
- [ ] Status lines: one per tool, settle independently
- [ ] Ordering: respect model-suggested order in output

#### Usability enhancements (high-impact, low-effort)

- [ ] **Audit trail & session summary:** at end of session, display summary
      showing all tool calls made, approvals given, and denials encountered;
      optional export to markdown for review/sharing; ~80 LOC
- [ ] **Debug mode:** `--debug` flag to show rule evaluation decisions and
      tool call reasoning in output; update `permissions/policy.ts` to emit
      trace info; ~100 LOC

- **Tests:** history serialize/restore, trim behavior, parallel execution,
  allowlist round-trip, audit trail generation, debug output format
- **Docs:** update this file, `README.md`, and `AGENTS.md`; add debug mode
  reference
- **Acceptance:** long sessions don't grow unbounded; client can resume with
  `/resume` (history + todos + conversation intact); independent tool calls
  execute in parallel with clean status-line settle order; `--debug` shows
  rule decisions and reasoning; session summary displays all tool activity
   before exit.
- **Commit:** when all green.

---

### Phase 9 — Polish, automation, and advanced features ⚪ future

**Goal:** deferred enhancements for usability, automation, and extensibility.

#### Deferred high-impact features

- [ ] **Dry-run mode:** `--dry-run` flag to show what tool calls would be made
      without executing; useful for validation and testing agent decisions;
      update agent loop to skip execution when flag is set; ~120 LOC
- [ ] **Session export:** save conversation + todos + metadata to markdown;
      reproducible snapshots for sharing, documentation, and recovery;
      write to user-specified file or auto-generate; ~70 LOC
- [ ] **JSON output mode:** `--json` flag for machine-readable results; emit
      tool calls, approvals, and final output as structured JSON; useful for
      CI/CD integration and automation; ~80 LOC
- [ ] **Multi-session branching:** fork conversation at checkpoints; explore
      alternatives without losing work; restore point creation and switching;
      ~200 LOC
- [ ] **Smart error recovery:** parse common tool failures (file not found,
      permission denied) and suggest fixes; integrate with LLM to propose
      corrective actions; ~120 LOC
- [ ] **Plugin hooks & extensibility:** allow custom validators/filters on
      tool calls; load plugins from config; enable third-party integrations;
      ~150 LOC

#### Lower-priority enhancements (consider for later phases)

- **History search:** `/search <keyword>` to find past queries within project
- **Example flows:** store common patterns (analyze code, write tests, debug)
- **Interactive help:** context-aware tips per mode/phase
- **Model benchmarking:** `--bench` mode to compare models on a task
- **Rate limiting:** max N tool calls per minute, per type
- **Workspace isolation:** `--workspace` flag to sandbox work
- **Call budgets:** enforce max tool calls per session
- **Streaming output:** `--stream-json` for live event stream
- **Provider auto-detect:** if OpenAI fails, try fallback provider
- **Tool-specific models:** allow expensive ops to use different models
- **Response time display:** show latency per turn
- **Colorized status badge:** show session state at prompt

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

- **Token growth in client-side history** — mitigated by Phase 8 context
  trimming; watch for long REPL sessions in the interim.
- **Shell rule matching is heuristic** — compound-command splitting and wrapper
  stripping are best-effort; circuit breakers are the backstop, not perfect
  parsing.
- **`Provider` interface stability** — D1 keeps it minimal; avoid leaking SDK
  types into the agent loop so a second provider stays a new file.
- **Rule persistence is deferred to Phase 8** — `always` approvals are
  session-only until then.
- **Strict tool schemas** (`additionalProperties: false`, all-required) shape
  the zod converter; optional fields become nullable unions.
- **`netGuard`'s SSRF check doesn't pin the connection** — `assertPublicUrl`
  validates the resolved address at check time, not at connect time, so a
  DNS answer that changes between the check and Node's own connect (DNS
  rebinding) isn't fully closed. Accepted as proportionate for a local dev
  tool running under a human-approved permission policy; full pinning would
  need a custom `fetch` dispatcher.
