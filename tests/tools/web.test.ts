import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/tools/netGuard.ts', () => ({
  assertPublicUrl: vi.fn(),
}))

import { assertPublicUrl } from '../../src/tools/netGuard.ts'
import { createWebTools } from '../../src/tools/web.ts'

function tools(apiKey: string | undefined) {
  const created = createWebTools({ apiKey, timeoutMs: 5000 })
  return {
    search: created.find((t) => t.name === 'web_search')!,
    fetchTool: created.find((t) => t.name === 'web_fetch')!,
  }
}

// Most tests exercise the "configured" path; the missing-key test below
// covers apiKey: undefined explicitly.
const KEY = 'test-key'

beforeEach(() => {
  vi.mocked(assertPublicUrl).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('web_search', () => {
  it('reports when no API key is configured, without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { search } = tools(undefined)
    const out = await search.execute({ query: 'x' })
    expect(out).toContain('BRAVE_SEARCH_API_KEY not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('formats results from the Brave API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          web: {
            results: [{ title: 'Example', url: 'https://example.com', description: 'desc' }],
          },
        }),
      }),
    )
    const { search } = tools(KEY)
    const out = await search.execute({ query: 'example' })
    expect(out).toContain('1. Example')
    expect(out).toContain('https://example.com')
    expect(out).toContain('desc')
  })

  it('reports a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }),
    )
    const { search } = tools(KEY)
    expect(await search.execute({ query: 'x' })).toContain('401')
  })

  it('reports no results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ web: { results: [] } }),
      }),
    )
    const { search } = tools(KEY)
    expect(await search.execute({ query: 'x' })).toBe('no results')
  })
})

describe('web_fetch', () => {
  it('is blocked before fetch runs when the SSRF guard rejects the URL', async () => {
    vi.mocked(assertPublicUrl).mockRejectedValue(new Error('blocked: nope'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { fetchTool } = tools(KEY)
    const out = await fetchTool.execute({ url: 'http://127.0.0.1/' })
    expect(out).toContain('web_fetch blocked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('strips HTML to readable text', async () => {
    const html =
      '<html><head><style>.a{color:red}</style></head><body>' +
      '<h1>Hi &amp; welcome</h1><script>evil()</script><p>Hello there.</p>' +
      '</body></html>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        body: null,
        text: async () => html,
      }),
    )
    const { fetchTool } = tools(KEY)
    const out = await fetchTool.execute({ url: 'https://example.com' })
    expect(out).toContain('Hi & welcome')
    expect(out).toContain('Hello there.')
    expect(out).not.toContain('evil()')
    expect(out).not.toContain('<h1>')
  })

  it('passes non-HTML content through unmodified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: null,
        text: async () => '{"key":"value"}',
      }),
    )
    const { fetchTool } = tools(KEY)
    expect(await fetchTool.execute({ url: 'https://example.com/data.json' })).toBe(
      '{"key":"value"}',
    )
  })

  it('caps very long output', async () => {
    const long = 'a'.repeat(7000)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/plain' }),
        body: null,
        text: async () => long,
      }),
    )
    const { fetchTool } = tools(KEY)
    const out = await fetchTool.execute({ url: 'https://example.com/big.txt' })
    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain('output truncated')
  })

  it('reports a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    )
    const { fetchTool } = tools(KEY)
    expect(await fetchTool.execute({ url: 'https://example.com/missing' })).toContain('404')
  })
})
