import { z } from 'zod'
import type { Tool } from './types.ts'

export type TodoStatus = 'pending' | 'in_progress' | 'done'
export interface TodoItem {
  id: number
  content: string
  status: TodoStatus
}

// pending/in_progress/done render as [ ]/[~]/[x] so the checklist is scannable
// in the model-facing snapshot and the terminal status line.
const STATUS_MARK: Record<TodoStatus, string> = { pending: ' ', in_progress: '~', done: 'x' }
const CAP = 50

// In-memory, session-scoped: the checklist tracks the agent's current plan and
// is wiped on /reset. It never touches the workspace, which is why the
// permission engine allows it by default (like read) in every mode.
export class TodoStore {
  private items: TodoItem[] = []
  private nextId = 1

  add(content: string): TodoItem {
    if (this.items.length >= CAP) {
      throw new Error(`todo list full (max ${CAP} items); complete or delete existing items first`)
    }
    const item: TodoItem = { id: this.nextId++, content, status: 'pending' }
    this.items.push(item)
    return item
  }

  update(id: number, patch: { content?: string; status?: TodoStatus }): TodoItem {
    const item = this.find(id)
    if (patch.content !== undefined) item.content = patch.content
    if (patch.status !== undefined) item.status = patch.status
    return item
  }

  complete(id: number): TodoItem {
    return this.update(id, { status: 'done' })
  }

  remove(id: number): void {
    const i = this.items.findIndex((t) => t.id === id)
    if (i === -1) throw new Error(`unknown todo id: ${id}`)
    this.items.splice(i, 1)
  }

  list(): TodoItem[] {
    return this.items
  }

  clear(): void {
    this.items = []
    this.nextId = 1
  }

  get total(): number {
    return this.items.length
  }

  get done(): number {
    return this.items.filter((t) => t.status === 'done').length
  }

  private find(id: number): TodoItem {
    const item = this.items.find((t) => t.id === id)
    if (!item) throw new Error(`unknown todo id: ${id}`)
    return item
  }

  snapshot(): string {
    const summary = `todo: ${this.done}/${this.total} done`
    if (this.items.length === 0) return summary
    const lines = this.items.map((t) => `[${STATUS_MARK[t.status]}] #${t.id} ${t.content}`)
    return `${summary}\n${lines.join('\n')}`
  }
}

export const todoToolName = 'todo'

export interface TodoToolContext {
  store: TodoStore
}

export function createTodoTool(ctx: TodoToolContext): Tool {
  return {
    name: todoToolName,
    description:
      'Track a multi-step task as a checklist that stays in sync across tool rounds. ' +
      'Use `add` to create an item, `update` to change its content or status, `complete` to mark it ' +
      'done, `delete` to remove it, and `list` to show the current checklist. Every call returns the ' +
      'full checklist (`todo: done/total`). In-memory only — it is cleared when the conversation is reset.',
    input: z.object({
      action: z
        .enum(['add', 'update', 'complete', 'delete', 'list'])
        .describe('What to do with the checklist.'),
      content: z.string().min(1).optional().describe('Text for add, or the new text for update.'),
      id: z.number().int().positive().optional().describe('Item id for update/complete/delete.'),
      status: z
        .enum(['pending', 'in_progress', 'done'])
        .optional()
        .describe('New status for update.'),
    }),
    execute: async (args) => {
      const { action, content, id, status } = args as {
        action: 'add' | 'update' | 'complete' | 'delete' | 'list'
        content?: string
        id?: number
        status?: TodoStatus
      }
      try {
        switch (action) {
          case 'add':
            if (!content) return 'content is required for add'
            ctx.store.add(content)
            break
          case 'update':
            if (id === undefined) return 'id is required for update'
            if (content === undefined && status === undefined) {
              return 'update needs content and/or status'
            }
            ctx.store.update(id, { content, status })
            break
          case 'complete':
            if (id === undefined) return 'id is required for complete'
            ctx.store.complete(id)
            break
          case 'delete':
            if (id === undefined) return 'id is required for delete'
            ctx.store.remove(id)
            break
          case 'list':
            break
        }
        return ctx.store.snapshot()
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
  }
}
