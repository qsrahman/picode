import { lookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'

// Hard, unconditional check `web_fetch` runs before every request — separate
// from and beneath the configurable permission engine, the same way
// `fs.ts`'s confine() unconditionally bounds file tools to the workspace.
// Rejects loopback/private/link-local targets so a fetched URL can't reach
// internal services or a cloud metadata endpoint (169.254.169.254). Checks
// the literal hostname first, then every address it resolves to, so a public-
// looking hostname that answers with a private address is still blocked.
//
// Known limitation: this validates the resolved address at check time but
// doesn't pin the connection to it, so a DNS answer that changes between this
// check and Node's own connect (DNS rebinding) isn't fully closed. Accepted
// as proportionate for a local dev tool running under a human-approved
// permission policy; full pinning would need a custom fetch dispatcher.
export async function assertPublicUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported URL scheme: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname
  if (hostname === 'localhost') {
    throw new Error(`blocked: ${hostname} is not a public host`)
  }
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`blocked: ${hostname} is not a public address`)
    }
    return
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    throw new Error(`could not resolve host: ${hostname}`)
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`blocked: ${hostname} resolves to a non-public address (${address})`)
    }
  }
}

function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) return isPrivateIPv4(address)
  if (isIPv6(address)) return isPrivateIPv6(address)
  return true // unrecognized shape: fail closed
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true
  const [a, b] = parts as [number, number, number, number]
  if (a === 127) return true // loopback
  if (a === 10) return true // private
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 0) return true // "this network"
  return false
}

function isPrivateIPv6(address: string): boolean {
  const a = address.toLowerCase()
  if (a === '::1' || a === '::') return true // loopback / unspecified
  if (a.startsWith('fc') || a.startsWith('fd')) return true // unique local, fc00::/7
  if (/^fe[89ab]/.test(a)) return true // link-local, fe80::/10

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) inherits the mapped address's privacy.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return isPrivateIPv4(mapped[1]!)
  return false
}
