import { connect } from 'cloudflare:sockets'
import { proxiesUri } from './variables'
import { Env } from './interfaces'

// KV key the health-check cron writes to, and the retry logic reads from.
const HEALTH_KEY: string = 'ProxyHealthCache'
// How many proxy IPs to test concurrently per batch (keep modest; Workers cap concurrent sockets).
const TEST_CONCURRENCY: number = 8
// How long to wait for a TCP handshake before treating an IP as dead.
const TEST_TIMEOUT_MS: number = 3000
// If the cron hasn't run in this long, treat the cache as stale and fall back to the raw list.
const MAX_CACHE_AGE_MS: number = 1000 * 60 * 60 * 12 // 12 hours
// When picking a proxy, bias toward this top slice of the latency-sorted list instead of
// always taking the single fastest one (spreads load, avoids hammering one IP).
const TOP_POOL_FRACTION: number = 0.25
const TOP_POOL_MIN: number = 5

export interface ProxyHealthEntry {
  ip: string
  country: string
  latencyMs: number
}

interface ProxyHealthCache {
  updatedAt: number
  proxies: Array<ProxyHealthEntry>
}

/**
 * Opens a raw TCP connection to ip:port and measures how long the handshake takes.
 * Returns latency in ms, or null if the IP is unreachable/times out.
 */
export async function TestProxyIP(ip: string, port: number = 443, timeoutMs: number = TEST_TIMEOUT_MS): Promise<number | null> {
  const start: number = Date.now()
  let socket: Socket | null = null
  try {
    socket = connect({ hostname: ip, port })
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => setTimeout(() => reject(new Error('proxy-test-timeout')), timeoutMs)),
    ])
    return Date.now() - start
  } catch {
    return null
  } finally {
    try { await socket?.close() } catch { }
  }
}

/**
 * Fetches the raw candidate list (upstream file + any user-added IPs stored in KV under
 * "ExtraProxyIPs"), tests each one's TCP latency, and writes a sorted, working-only list
 * to KV. Meant to be called from the Worker's `scheduled` handler on a Cron Trigger.
 */
export async function RefreshProxyHealthCache(env: Env): Promise<ProxyHealthCache> {
  const raw: string = await fetch(proxiesUri).then(r => r.text())
  const fromFile: Array<{ ip: string, country: string }> = raw
    .trim()
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ip, country] = line.split(',')
      return { ip: ip.trim(), country: (country || '').trim() }
    })

  // Reuses the "Proxies" KV setting (already read by helpers.ts's getProxies(), which
  // wasn't wired into anything before this) so users can pin their own trusted IPs
  // alongside the community list.
  const extraRaw: string = (await env.settings.get('Proxies')) || ''
  const fromExtra: Array<{ ip: string, country: string }> = extraRaw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ip, country] = line.split(',')
      return { ip: ip.trim(), country: (country || 'N/A').trim() }
    })

  const seen = new Set<string>()
  const candidates = [...fromFile, ...fromExtra].filter(c => {
    if (seen.has(c.ip)) return false
    seen.add(c.ip)
    return true
  })

  const results: Array<ProxyHealthEntry> = []
  for (let i = 0; i < candidates.length; i += TEST_CONCURRENCY) {
    const batch = candidates.slice(i, i + TEST_CONCURRENCY)
    const tested = await Promise.all(batch.map(async candidate => {
      const latencyMs = await TestProxyIP(candidate.ip)
      return latencyMs !== null ? { ip: candidate.ip, country: candidate.country, latencyMs } : null
    }))
    for (const entry of tested) {
      if (entry) results.push(entry)
    }
  }

  results.sort((a, b) => a.latencyMs - b.latencyMs)

  const cache: ProxyHealthCache = {
    updatedAt: Date.now(),
    proxies: results,
  }

  // TTL as a safety net: if the cron ever stops firing (e.g. plan change, misconfigured
  // trigger), the stale cache expires on its own instead of serving dead IPs forever.
  await env.settings.put(HEALTH_KEY, JSON.stringify(cache), { expirationTtl: 60 * 60 * 24 * 2 })

  return cache
}

/**
 * Picks a proxy IP to use for an outbound connection. Prefers the health-checked cache
 * (fast + known-working), optionally filtered by country, and falls back to the old
 * "fetch the raw list and pick randomly" behavior if the cache is missing, stale, or empty.
 */
export async function PickProxyIP(env: Env, countries: Array<string> = []): Promise<string | null> {
  try {
    const cachedRaw: string | null = await env.settings.get(HEALTH_KEY)
    if (cachedRaw) {
      const cache: ProxyHealthCache = JSON.parse(cachedRaw)
      const isFresh: boolean = Date.now() - cache.updatedAt < MAX_CACHE_AGE_MS
      let pool: Array<ProxyHealthEntry> = cache.proxies || []
      if (countries.length > 0) {
        pool = pool.filter(p => countries.includes(p.country))
      }
      if (isFresh && pool.length > 0) {
        const topCount: number = Math.max(TOP_POOL_MIN, Math.ceil(pool.length * TOP_POOL_FRACTION))
        const topPool: Array<ProxyHealthEntry> = pool.slice(0, Math.min(topCount, pool.length))
        return topPool[Math.floor(Math.random() * topPool.length)].ip
      }
    }
  } catch { }

  // Fallback: cache missing/stale/empty -> old behavior (raw list, no health data).
  try {
    let list: Array<string> = await fetch(proxiesUri)
      .then(r => r.text())
      .then(t => t.trim().split('\n').filter(t => t.trim().length > 0))

    if (countries.length > 0) {
      list = list.filter(t => {
        const arr = t.split(',')
        return arr.length > 0 && countries.includes(arr[1])
      })
    }
    list = list.map(ip => ip.split(',')[0])
    if (list.length > 0) {
      return list[Math.floor(Math.random() * list.length)]
    }
  } catch { }

  return null
}
