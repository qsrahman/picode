import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { assertPublicUrl } from '../../src/tools/netGuard.ts'

describe('assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/scheme/)
  })

  it('rejects an invalid URL', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/invalid URL/)
  })

  it('rejects localhost without a DNS lookup', async () => {
    await expect(assertPublicUrl('http://localhost:11434/')).rejects.toThrow(/not a public host/)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a literal private/loopback/link-local IP without a DNS lookup', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow(/not a public address/)
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toThrow(/not a public address/)
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /not a public address/,
    )
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a hostname that resolves to a private address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.168.1.5', family: 4 }] as never)
    await expect(assertPublicUrl('http://sneaky.example.com/')).rejects.toThrow(
      /resolves to a non-public address/,
    )
  })

  it('allows a hostname that resolves to a public address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    await expect(assertPublicUrl('https://example.com/')).resolves.toBeUndefined()
  })

  it('rejects when every resolved address is private, even mixed with none public', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '10.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ] as never)
    await expect(assertPublicUrl('http://multi.example.com/')).rejects.toThrow()
  })

  it('fails closed when DNS resolution fails', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertPublicUrl('http://nowhere.invalid/')).rejects.toThrow(/could not resolve/)
  })
})
