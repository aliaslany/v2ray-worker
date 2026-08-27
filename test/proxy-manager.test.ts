import { describe, it, expect, vi, beforeEach } from 'vitest'

// `cloudflare:sockets` only exists inside the Workers runtime. Mock it so these tests
// can run under plain Node against the pure selection/parsing logic.
vi.mock('cloudflare:sockets', () => ({
  connect: vi.fn(() => ({
    opened: Promise.resolve(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { PickProxyIP, TestProxyIP } from '../src/proxy-manager'
import { Env } from '../src/interfaces'

// Minimal in-memory stand-in for the KVNamespace binding.
function makeFakeKV(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    delete: vi.fn(async (key: string) => { store.delete(key) }),
    _store: store,
  }
}

function makeEnv(kv: ReturnType<typeof makeFakeKV>): Env {
  return { settings: kv as any }
}

describe('PickProxyIP', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers IPs from a fresh, populated health cache over the raw list', async () => {
    const cache = {
      updatedAt: Date.now(),
      proxies: [
        { ip: '10.0.0.1', country: 'USA', latencyMs: 50 },
        { ip: '10.0.0.2', country: 'USA', latencyMs: 80 },
      ],
    }
    const kv = makeFakeKV({ ProxyHealthCache: JSON.stringify(cache) })
    const env = makeEnv(kv)

    const picked = await PickProxyIP(env)
    expect(['10.0.0.1', '10.0.0.2']).toContain(picked)
  })

  it('filters the health cache by country when countries are provided', async () => {
    const cache = {
      updatedAt: Date.now(),
      proxies: [
        { ip: '10.0.0.1', country: 'USA', latencyMs: 50 },
        { ip: '10.0.0.2', country: 'NLD', latencyMs: 60 },
      ],
    }
    const kv = makeFakeKV({ ProxyHealthCache: JSON.stringify(cache) })
    const env = makeEnv(kv)

    const picked = await PickProxyIP(env, ['NLD'])
    expect(picked).toBe('10.0.0.2')
  })

  it('falls back to the raw remote list when the cache is stale', async () => {
    const staleCache = {
      updatedAt: Date.now() - 1000 * 60 * 60 * 24, // 24h old, older than MAX_CACHE_AGE_MS
      proxies: [{ ip: '10.0.0.1', country: 'USA', latencyMs: 50 }],
    }
    const kv = makeFakeKV({ ProxyHealthCache: JSON.stringify(staleCache) })
    const env = makeEnv(kv)

    global.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve('99.99.99.99,USA\n'),
    }) as any

    const picked = await PickProxyIP(env)
    expect(picked).toBe('99.99.99.99')
  })

  it('falls back to the raw remote list when the cache is empty/missing', async () => {
    const kv = makeFakeKV()
    const env = makeEnv(kv)

    global.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve('88.88.88.88,GBR\n77.77.77.77,GBR\n'),
    }) as any

    const picked = await PickProxyIP(env)
    expect(['88.88.88.88', '77.77.77.77']).toContain(picked)
  })

  it('returns null when neither the cache nor the raw list yield anything', async () => {
    const kv = makeFakeKV()
    const env = makeEnv(kv)

    global.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(''),
    }) as any

    const picked = await PickProxyIP(env)
    expect(picked).toBeNull()
  })
})

describe('TestProxyIP', () => {
  it('returns a non-negative latency in ms when the connection opens successfully', async () => {
    const latency = await TestProxyIP('10.0.0.1', 443)
    expect(latency).not.toBeNull()
    expect(latency).toBeGreaterThanOrEqual(0)
  })

  it('returns null when the socket rejects (simulated dead proxy)', async () => {
    const sockets = await import('cloudflare:sockets')
    vi.mocked(sockets.connect).mockReturnValueOnce({
      opened: Promise.reject(new Error('connection refused')),
      close: vi.fn().mockResolvedValue(undefined),
    } as any)

    const latency = await TestProxyIP('10.0.0.2', 443)
    expect(latency).toBeNull()
  })
})
