import { describe, expect, it } from 'vitest'

import { TodoStore, createTodoTool, todoToolName } from '../../src/tools/todo.ts'

function tool(store = new TodoStore()) {
  return createTodoTool({ store })
}

describe('TodoStore', () => {
  it('assigns monotonic ids that are never reused', () => {
    const s = new TodoStore()
    const a = s.add('first')
    const b = s.add('second')
    expect(a.id).toBe(1)
    expect(b.id).toBe(2)
    s.remove(a.id)
    expect(s.add('third').id).toBe(3)
  })

  it('tracks done/total and renders a scannable snapshot', () => {
    const s = new TodoStore()
    s.add('write parser')
    s.add('write tests')
    s.complete(1)
    expect(s.done).toBe(1)
    expect(s.total).toBe(2)
    expect(s.snapshot()).toBe(
      ['todo: 1/2 done', '[x] #1 write parser', '[ ] #2 write tests'].join('\n'),
    )
  })

  it('uses in_progress marker for the middle status', () => {
    const s = new TodoStore()
    s.add('task')
    s.update(1, { status: 'in_progress' })
    expect(s.snapshot()).toContain('[~] #1 task')
  })

  it('updates content without changing status', () => {
    const s = new TodoStore()
    s.add('old text')
    s.update(1, { content: 'new text' })
    expect(s.list()[0]).toMatchObject({ content: 'new text', status: 'pending' })
  })

  it('rejects an unknown id', () => {
    const s = new TodoStore()
    expect(() => s.complete(42)).toThrow(/unknown todo id/)
    expect(() => s.remove(42)).toThrow(/unknown todo id/)
  })

  it('rejects additions past the cap', () => {
    const s = new TodoStore()
    for (let i = 0; i < 50; i++) s.add(`t${i}`)
    expect(() => s.add('overflow')).toThrow(/todo list full/)
  })

  it('clear resets items and the id counter', () => {
    const s = new TodoStore()
    s.add('a')
    s.clear()
    expect(s.total).toBe(0)
    expect(s.add('b').id).toBe(1)
  })
})

describe('createTodoTool', () => {
  it('is named todo', () => {
    expect(tool().name).toBe(todoToolName)
  })

  it('add returns the full snapshot', async () => {
    const out = await tool().execute({ action: 'add', content: 'write parser' })
    expect(out).toBe(['todo: 0/1 done', '[ ] #1 write parser'].join('\n'))
  })

  it('add without content returns an error string, not a throw', async () => {
    const out = await tool().execute({ action: 'add' })
    expect(out).toContain('content is required')
  })

  it('update needs an id and content or status', async () => {
    const store = new TodoStore()
    store.add('task')
    expect(await tool(store).execute({ action: 'update' })).toContain('id is required')
    expect(await tool(store).execute({ action: 'update', id: 1 })).toContain('update needs')
    expect(await tool(store).execute({ action: 'update', id: 1, status: 'done' })).toContain(
      '[x] #1 task',
    )
  })

  it('complete and delete mutate the store', async () => {
    const store = new TodoStore()
    store.add('a')
    store.add('b')
    expect(await tool(store).execute({ action: 'complete', id: 1 })).toContain('todo: 1/2 done')
    expect(await tool(store).execute({ action: 'delete', id: 2 })).toContain('todo: 1/1 done')
  })

  it('reports an unknown id without throwing', async () => {
    const out = await tool().execute({ action: 'complete', id: 99 })
    expect(out).toContain('unknown todo id')
  })

  it('list returns the snapshot for an empty checklist', async () => {
    expect(await tool().execute({ action: 'list' })).toBe('todo: 0/0 done')
  })
})
