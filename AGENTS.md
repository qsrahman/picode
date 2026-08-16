# AGENTS.md — Developer Guide

Guidance for working on `pcode`, a model-agnostic CLI AI coding agent built on
the OpenAI Responses API. Planning and requirements live in
[`PLAN.md`](./PLAN.md); usage docs in [`README.md`](./README.md). These three
files must stay in sync with the code.

## Commands

```sh
pnpm install        # install dependencies (pnpm only, never npm/yarn)
pnpm dev            # run src/index.ts with --watch
pnpm start          # run src/index.ts
pnpm test            # vitest run
pnpm test:watch     # vitest
pnpm test:live       # end-to-end live test against the configured model
pnpm typecheck      # tsc --noEmit
pnpm format         # prettier --write .
pnpm format:check   # prettier --check . (gates CI)
```

Run `pnpm test`, `pnpm typecheck`, and `pnpm format` before committing.

## Stack constraints

- Node.js 26+ runs `.ts` directly (type stripping) — **no build step**. Entry:
  `src/index.ts` with a `#!/usr/bin/env node` shebang.
- TypeScript 7, strict, ESM (`"type": "module"`).
- Import builtins with the `node:` prefix (`node:fs`, `node:path`,
  `node:util`, `node:url`).
- Relative imports must use the `.ts` extension
  (`import { x } from './y.ts'`) — required by type stripping +
  `allowImportingTsExtensions`.
- Use `import type` for type-only imports (`verbatimModuleSyntax` is on).
- `erasableSyntaxOnly` is on: no enums, namespaces, or parameter properties.
- Runtime deps: `zod`, `ansis`, `openai`, `@modelcontextprotocol/sdk`
  (added in Phase 5). `web_search`/`web_fetch` (Phase 4) use Node's built-in
  `fetch` — no HTTP client dependency.

## Conventions

- **Code style:** no semicolons unless necessary, single quotes, trailing
  commas, 2-space indent — enforced by Prettier. `*.md` is excluded from
  formatting, so keep docs hand-formatted and tidy.
- **Comments:** explain *why*, never *what*. No line-by-line narration.
- **Commits:** one focused commit per change. Keep `PLAN.md`, `README.md`, and
  this file in sync in the same commit when a change affects features, CLI
  flags, architecture, or conventions.
- **No premature abstraction:** implement the simplest thing that satisfies the
  current phase; do not build for hypothetical future features. The designed
  exception is the `Provider` interface (isolates the OpenAI SDK from the agent
  loop so a second provider is one new file).
- **Never** use `console.log` for diagnostics. `console.log`/`process.stdout`
  is reserved for streamed model output and the REPL prompt.

## Project layout

```
src/
  index.ts          entry: parse → config → dispatch (one-shot | REPL)
  errors.ts         shared error classes + messageOf helper
  cli/              args, commands (slash), repl, history, approval
  config/           zod schema + load/merge/validate
  agent/            provider (OpenAI impl) + agent loop
  tools/            Tool interface, zod→JSON schema, registry, shell, fs, git,
                    web (search/fetch) + netGuard (SSRF guard)
  utils/            palette + streaming/status writer
tests/              mirrors src/ 1:1
```

> The following modules are planned (see PLAN.md), not yet present:
> `mcp/` client + adapter (Phase 5).

> Phase 3 is done: `tools/fs.ts` + `tools/git.ts`, and the `permissions/`
> engine (`rules.ts`, `modes.ts`, `readonly.ts`, `breaker.ts`, `policy.ts`,
> `prompt.ts`) are implemented and wired into the loop via `authorize()`.

> Phase 4 is done: `tools/web.ts` (`web_search`, `web_fetch`) +
> `tools/netGuard.ts` (SSRF guard), and the permission engine's separate
> `webSearch`/`webFetch` categories (`WebSearch(pattern)`/`WebFetch(pattern)`,
> default `ask`) are implemented.

## Testing

- Tests live in `tests/`, mirroring `src/` structure
  (e.g. `tests/cli/args.test.ts` → `src/cli/args.ts`). Vitest discovers
  `*.test.ts` under `tests/`.
- Prefer fast, deterministic unit tests (e.g. assert `parseCli` output) over
  integration tests that hit the network.
- Mock external boundaries (fetch, filesystem side effects, the `openai`
  client) rather than calling them from tests.
- For colored output, assert against `ansis.strip(...)`.
- For filesystem/git tool tests, use temporary directories (`node:os`
  `tmpdir`-style fixtures), never the repo itself.
- Test files follow the same style as `src/` (single quotes, no semicolons).
