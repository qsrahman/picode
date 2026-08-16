import { z } from 'zod'
import type { Tool } from './types.ts'
import { assertPublicUrl } from './netGuard.ts'
import { messageOf } from '../errors.ts'
import { VERSION } from '../version.ts'

export interface WebToolContext {
  apiKey: string | undefined
  timeoutMs: number
}

// Output cap the model sees, matching tools/shell.ts's OUTPUT_CAP so long
// results/pages don't blow up the context.
const OUTPUT_CAP = 6000
// Raw response bytes read from web_fetch before stripping/capping. exec()
// gets a buffer cap for free from Node's default maxBuffer; fetch() doesn't,
// so this is read with an explicit streaming cap to bound memory.
const MAX_FETCH_BYTES = 2 * 1024 * 1024

function cap(text: string): string {
  if (text.length <= OUTPUT_CAP) return text
  return `${text.slice(0, OUTPUT_CAP)}\n…[output truncated: ${text.length} chars]`
}

interface BraveResult {
  title: string
  url: string
  description: string
}

function extractResults(data: unknown): BraveResult[] {
  if (typeof data !== 'object' || data === null) return []
  const web = (data as Record<string, unknown>).web
  if (typeof web !== 'object' || web === null) return []
  const results = (web as Record<string, unknown>).results
  if (!Array.isArray(results)) return []
  return results
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : '',
      url: typeof r.url === 'string' ? r.url : '',
      description: typeof r.description === 'string' ? r.description : '',
    }))
    .filter((r) => r.url !== '')
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code =
        ent[1]?.toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isNaN(code) ? whole : String.fromCodePoint(code)
    }
    return ENTITIES[ent.toLowerCase()] ?? whole
  })
}

// Intentionally lossy: strips structure (tables/lists) along with markup.
// Good enough for "read this page for context," not a faithful rendering.
function htmlToText(html: string): string {
  const withoutBlocks = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
  const withoutTags = withoutBlocks.replace(/<[^>]+>/g, ' ')
  const decoded = decodeEntities(withoutTags)
  return decoded
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: await response.text(), truncated: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      const keep = value.byteLength - (received - maxBytes)
      if (keep > 0) text += decoder.decode(value.subarray(0, keep), { stream: true })
      truncated = true
      await reader.cancel()
      break
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return { text, truncated }
}

export function createWebTools(ctx: WebToolContext): Tool[] {
  return [
    {
      name: 'web_search',
      description: 'Search the web (Brave Search) and return ranked results with titles/URLs.',
      input: z.object({
        query: z.string().min(1),
        count: z.number().int().min(1).max(10).optional(),
      }),
      execute: async (args) => {
        const { query, count } = args as { query: string; count?: number }
        if (!ctx.apiKey) return 'web_search unavailable: BRAVE_SEARCH_API_KEY not set'

        const url = new URL('https://api.search.brave.com/res/v1/web/search')
        url.searchParams.set('q', query)
        url.searchParams.set('count', String(count ?? 5))

        let response: Response
        try {
          response = await fetch(url, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': ctx.apiKey },
            signal: AbortSignal.timeout(ctx.timeoutMs),
          })
        } catch (err) {
          return `web_search failed: ${messageOf(err)}`
        }
        if (!response.ok) {
          return `web_search failed: ${response.status} ${response.statusText}`
        }
        let data: unknown
        try {
          data = await response.json()
        } catch {
          return 'web_search failed: invalid response from search API'
        }
        const results = extractResults(data)
        if (results.length === 0) return 'no results'
        const formatted = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`)
          .join('\n\n')
        return cap(formatted)
      },
    },
    {
      name: 'web_fetch',
      description:
        'Fetch a URL and return its readable text content (HTML is stripped to plain text).',
      input: z.object({ url: z.string().min(1) }),
      execute: async (args) => {
        const { url } = args as { url: string }
        try {
          await assertPublicUrl(url)
        } catch (err) {
          return `web_fetch blocked: ${messageOf(err)}`
        }

        let response: Response
        try {
          response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(ctx.timeoutMs),
            headers: { 'User-Agent': `picode/${VERSION} (+web_fetch tool)` },
          })
        } catch (err) {
          return `web_fetch failed: ${messageOf(err)}`
        }
        if (!response.ok) {
          return `web_fetch failed: ${response.status} ${response.statusText}`
        }

        const contentType = response.headers.get('content-type') ?? ''
        const { text, truncated } = await readCapped(response, MAX_FETCH_BYTES)
        const body = contentType.includes('html') ? htmlToText(text) : text
        const prefix = truncated
          ? `[note: response exceeded the ${MAX_FETCH_BYTES}-byte fetch cap and was truncated]\n\n`
          : ''
        return cap(prefix + body)
      },
    },
  ]
}
