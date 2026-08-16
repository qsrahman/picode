export const HELP_TEXT = `picode — model-agnostic AI coding agent

Usage:
  picode [prompt]           one-shot when a prompt is given, interactive REPL otherwise

Options:
  --model <id>             model to use (overrides config)
  --mode <mode>            permission mode: interactive | auto | plan (default: interactive)
  --yes                    alias for --mode auto
  --plan                   alias for --mode plan
  --config <path>          config file to load
  --no-stream              buffer the full response instead of streaming
  --verbose                show full tool input/output
  --no-color               disable ANSI colors
  --version                print version
  --help                   show this help
`
