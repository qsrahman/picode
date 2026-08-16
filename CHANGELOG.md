# Changelog

All notable changes to `pcode` are documented in this file. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) (pre-1.0: minor bumps track
completed [`PLAN.md`](./PLAN.md) phases, patch bumps are fixes/polish within a
phase).

## [Unreleased]

## [0.4.0] - 2026-08-16

### Added

- `web_search` / `web_fetch` tools backed by the Brave Search API, with a hard
  SSRF guard (`tools/netGuard.ts`) that rejects loopback/private/link-local
  targets (including the cloud metadata address) before any request is made.
- `webSearch` / `webFetch` as separate permission categories with their own
  `WebSearch(pattern)` / `WebFetch(pattern)` rule syntax, so one can be
  allowed without also opening the other.
- `edit_file` tool for surgical `old_string` → `new_string` patches, so the
  model can make a targeted change without rewriting an entire file.
- A default system prompt (`agent/systemPrompt.ts`, `DEFAULT_INSTRUCTIONS`)
  teaching the model correct tool usage, notably to prefer `edit_file` over a
  full `write_file` overwrite for existing files.
- Readable status-line summaries for filesystem tool calls (`edit_file`,
  `read_file`, `list_dir`, `stat`) instead of raw JSON args.
- `pnpm test:live` (`scripts/live-e2e.py`): a PTY-based end-to-end harness
  that drives the real CLI against a configured model and asserts the
  streamed output, tool status lines, and permission prompts render cleanly.

### Fixed

- The permission engine classifying a compound shell command (`a && b`) by
  only its first subcommand instead of every subcommand.
- The REPL duplicating a tool's status line after an approval prompt was
  answered.
- The provider degrading ungracefully on a malformed final streaming
  response, instead of surfacing an incomplete-response notice.

## [0.3.0] - 2026-08-16

### Added

- Declarative permission engine (`permissions/`): `allow` / `ask` / `deny`
  rules with `deny > ask > allow` precedence, Claude-Code-style
  `Tool(pattern)` syntax (`Bash(...)`, `Edit(...)`, `Read(...)`), and
  `interactive` / `auto` / `plan` modes.
- Circuit breakers that force an `ask` even in `auto` mode for destructive or
  shell-escaping commands, and a read-only shell-command allowlist that skips
  prompting entirely.
- Interactive `y` / `n` / `a` approval prompt, with a session-only cache for
  "always allow" answers.
- File tools (`read_file`, `write_file`, `list_dir`, `stat`) and read-only
  git tools (`git_status`, `git_diff`, `git_log`, `git_show`), all confined
  to the workspace root plus `config.additionalDirs`.
- `/tools` REPL command listing every tool with its effective permission in
  the current mode; `/mode` to inspect or switch modes.
- Semantic one-shot exit codes: `2` for a policy-denied tool call, `3` for
  hitting the tool-call round limit.

## [0.2.0] - 2026-08-15

### Added

- Core tool infrastructure: the `Tool` interface, a zod → JSON-Schema
  converter, and `ToolRegistry`.
- Streaming function-calling loop (`agent/agent.ts`'s `runTurn`): executes
  `function_call` items via the registry behind an `authorize` hook and
  re-streams, up to `MAX_TOOL_ROUNDS` per turn.
- `run_command` shell tool, an in-place status-line writer for streamed
  tool/model output, and the first approval UX.

### Changed

- `src/output` renamed to `src/utils`.

## [0.1.0] - 2026-08-15

### Added

- Project scaffold: `package.json`, TypeScript config, Prettier, Vitest.
- CLI argument parsing, layered config resolution (defaults → user config →
  project `pcode.json` → CLI flags → env), and plain (non-tool) chat via the
  OpenAI Responses API.
- REPL with `/help`, `/clear`, `/reset` commands and a two-line prompt.
- `.env` support for `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and
  `OPENAI_DEFAULT_MODEL`.
