import { z } from 'zod'
import type { Tool } from './types.ts'
import type { ToolRegistry } from './registry.ts'
import type { Provider } from '../agent/provider.ts'
import type { Config } from '../config/schema.ts'
import { runTurn } from '../agent/agent.ts'
import type { ApprovalCache } from '../permissions/policy.ts'
import { toolsetForModel } from '../permissions/policy.ts'
import { createAuthorizer } from '../permissions/prompt.ts'

export const runAgentToolName = 'run_agent'

export interface AgentToolContext {
  provider: Provider
  registry: ToolRegistry
  config: Config
  approvals: ApprovalCache
}

// Output cap the model sees, matching tools/shell.ts's and tools/web.ts's
// OUTPUT_CAP so a verbose sub-agent report doesn't blow up the parent's
// context.
const OUTPUT_CAP = 6000

function cap(text: string): string {
  if (text.length <= OUTPUT_CAP) return text
  return `${text.slice(0, OUTPUT_CAP)}\n…[output truncated: ${text.length} chars]`
}

// Registered once per process, so a plain closure variable is enough to stop
// a sub-agent from re-entering run_agent — the toolset it's given already
// excludes the tool, but a model can still hallucinate a call, so this is
// the hard backstop.
export function createAgentTool(ctx: AgentToolContext): Tool {
  let depth = 0

  return {
    name: runAgentToolName,
    description:
      'Delegate a well-scoped, self-contained subtask to a fresh sub-agent that runs its ' +
      'own tool-calling loop and reports back its final answer. The sub-agent has no access ' +
      'to this conversation — give it everything it needs in `prompt`. It cannot ask for ' +
      'approval mid-task (anything not already allowed by policy is silently refused) and ' +
      'cannot spawn further sub-agents.',
    input: z.object({
      description: z.string().min(1).describe('Short label for the task (shown to the user).'),
      prompt: z.string().min(1).describe('Full, self-contained instructions for the sub-agent.'),
    }),
    execute: async (args) => {
      const { description, prompt } = args as { description: string; prompt: string }
      if (depth > 0) {
        return `${runAgentToolName} cannot be called from within a sub-agent task (nesting is not supported)`
      }

      const subTools = toolsetForModel(ctx.registry, ctx.config.permission, ctx.config.mode).filter(
        (t) => t.name !== runAgentToolName,
      )

      // Headless: a sub-agent can't pop an interactive prompt, so an
      // unresolved `ask` decision auto-denies (same non-interactive IO the
      // one-shot CLI uses) rather than hanging. Anything already covered by
      // an allow rule, the read-only shell default, or auto/plan mode still
      // goes through.
      const authorize = createAuthorizer({
        rules: ctx.config.permission,
        mode: ctx.config.mode,
        approvals: ctx.approvals,
        io: { interactive: false, question: async () => 'n', print: () => {} },
      })

      depth++
      try {
        const result = await runTurn(ctx.provider, [], prompt, {
          tools: subTools,
          registry: ctx.registry,
          authorize,
        })
        if (result.truncated) {
          return `${description}: sub-agent hit its tool-call limit before finishing.\n\n${cap(result.text)}`
        }
        if (result.incomplete) {
          return `${description}: sub-agent response was incomplete.\n\n${cap(result.text)}`
        }
        return cap(result.text || '(sub-agent produced no output)')
      } finally {
        depth--
      }
    },
  }
}
