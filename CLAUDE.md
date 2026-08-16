# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`pcode` — a model-agnostic, CLI-based AI coding agent built on the OpenAI
Responses API. See [`README.md`](./README.md) for usage/config and
[`PLAN.md`](./PLAN.md) for the phased roadmap (source of truth for planning).

**The full developer guide lives in [`AGENTS.md`](./AGENTS.md)** — read it
first. It covers stack constraints (Node 26 type-stripping, no build step,
`.ts` import extensions, ESM), code style, and project layout. Keep
`PLAN.md`, `README.md`, and `AGENTS.md` in sync with the code in the same
commit when a change affects features, CLI flags, architecture, or
conventions.

## Commands

```sh
pnpm install        # pnpm only, never npm/yarn
pnpm dev            # run src/index.ts with --watch
pnpm start          # run src/index.ts
pnpm test           # vitest run (all tests)
pnpm test:watch     # vitest
pnpm typecheck      # tsc --noEmit
pnpm format         # prettier --write .
pnpm format:check   # prettier --check . (gates CI)
```

Run a single test file: `pnpm vitest run tests/cli/args.test.ts`
Run `pnpm test`, `pnpm typecheck`, and `pnpm format` before committing.

## Architecture

Request flow: `src/index.ts` parses CLI args (`cli/args.ts`), resolves config
(`config/config.ts`, defaults → user config → project `pcode.json` → CLI flags
→ env), builds a `Provider` (`agent/provider.ts`, wraps the OpenAI SDK) and a
`ToolRegistry` (`tools/registry.ts`) with shell/fs/git tools registered, then
dispatches to either a one-shot `runTurn` call or the interactive REPL
(`cli/repl.ts`).

- **`agent/agent.ts`** — `runTurn` is the core loop: streams a model turn,
  extracts `function_call` items from the response, executes each via the
  registry behind an `authorize` hook, appends `function_call_output` items,
  and re-streams — up to `MAX_TOOL_ROUNDS` (8) per turn. No `authorize` hook
  or registry means tool calls are a no-op, not an error.
- **`permissions/`** — the tool-approval engine (replaces the old
  `cli/approval.ts`). `policy.ts` classifies each `ToolCall` into a category
  (`shell`/`edit`/`read`) via `TOOL_META`, builds match patterns (e.g.
  `Bash(pnpm test *)`), and evaluates them against `rules.ts` allow/ask/deny
  patterns plus mode (`modes.ts`); `readonly.ts` and `breaker.ts` special-case
  read-only shell commands and destructive/`sudo` commands; `prompt.ts`
  (`createAuthorizer`) wires the resolved decision to an interactive y/n/a
  prompt, backed by a session-only `ApprovalCache` for "always allow"
  answers. One-shot (`--prompt`) runs are forced non-interactive, so an `ask`
  decision resolves to denial rather than prompting; a denial sets exit code
  2. `toolsetForModel()` filters the registry down to what's exposed to the
  model for the current permission/mode — everything else stays invisible to
  the model, while `authorize()` in the loop is the actual enforcement point.
- **`tools/registry.ts`** — `ToolRegistry` maps tool name → `Tool` (zod input
  schema + `execute`). `descriptors()` converts zod schemas to the JSON
  schema shape the Responses API expects (`tools/schema.ts`). `execute()`
  never throws — validation and execution failures both come back as an
  output string so the model can react.
- **`agent/provider.ts`** — isolates the OpenAI SDK behind a `Provider`
  interface; the one intentional abstraction ahead of need, so a second
  provider is one new file (see AGENTS.md "No premature abstraction").
- **`config/schema.ts`** — zod schema for config; `config/config.ts` merges
  the layered sources and validates.

Tests mirror `src/` 1:1 under `tests/` (e.g. `tests/cli/args.test.ts` ↔
`src/cli/args.ts`); Vitest discovers `*.test.ts`.
