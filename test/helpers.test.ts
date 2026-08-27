import { describe, it, expect } from 'vitest'
import {
  IsIp,
  IsValidUUID,
  IsBase64,
  GetMultipleRandomElements,
  RemoveDuplicateConfigs,
  AddNumberToConfigs,
  MuddleDomain,
  ConstantTimeEqual,
  GenerateToken,
} from '../src/helpers'
import { Config } from '../src/interfaces'

describe('IsIp', () => {
  it('accepts valid IPv4 host addresses', () => {
    expect(IsIp('1.2.3.4')).toBe(true)
    expect(IsIp('8.8.8.8')).toBe(true)
  })

  it('rejects non-IP strings, invalid octets, and non-host addresses (.0/.255)', () => {
    // .0 (network address) and .255 (broadcast) are deliberately excluded — not bugs.
    expect(IsIp('not-an-ip')).toBe(false)
    expect(IsIp('')).toBe(false)
    expect(IsIp('999.1.1.1')).toBe(false)
    expect(IsIp('192.168.1.0')).toBe(false)
    expect(IsIp('255.255.255.255')).toBe(false)
  })
})

describe('IsValidUUID', () => {
  it('accepts a well-formed UUID', () => {
    expect(IsValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
  })

  it('rejects malformed UUIDs', () => {
    expect(IsValidUUID('not-a-uuid')).toBe(false)
    expect(IsValidUUID('123e4567e89b12d3a456426614174000')).toBe(false)
  })
})

describe('IsBase64', () => {
  it('accepts valid base64 strings', () => {
    expect(IsBase64(Buffer.from('hello world').toString('base64'))).toBe(true)
  })

  it('rejects strings with invalid characters', () => {
    expect(IsBase64('not base64 at all!!')).toBe(false)
  })
})

describe('GetMultipleRandomElements', () => {
  it('returns the requested number of elements from the source array', () => {
    const source = [1, 2, 3, 4, 5]
    const result = GetMultipleRandomElements(source, 3)
    expect(result).toHaveLength(3)
    for (const el of result) {
      expect(source).toContain(el)
    }
  })

  it('does not exceed the source array length', () => {
    const source = [1, 2]
    const result = GetMultipleRandomElements(source, 5)
    expect(result.length).toBeLessThanOrEqual(2)
  })
})

describe('RemoveDuplicateConfigs', () => {
  it('deduplicates configs with identical remarks/port/address/uuid', () => {
    const base: Config = {
      configType: 'vless', remarks: 'a', address: '1.1.1.1', port: 443,
      uuid: 'u1', network: 'ws', path: '/',
    }
    const dup: Config = { ...base }
    const distinct: Config = { ...base, port: 8443 }

    const result = RemoveDuplicateConfigs([base, dup, distinct])
    expect(result).toHaveLength(2)
  })
})

describe('AddNumberToConfigs', () => {
  it('prefixes each config remarks with a sequential number starting at `start`', () => {
    const configs: Array<Config> = [
      { configType: 'vless', remarks: 'first', address: 'a', port: 1, network: 'ws', path: '/' },
      { configType: 'vless', remarks: 'second', address: 'b', port: 2, network: 'ws', path: '/' },
    ]
    const result = AddNumberToConfigs(configs, 10)
    expect(result[0].remarks).toBe('10-first')
    expect(result[1].remarks).toBe('11-second')
  })
})

describe('MuddleDomain', () => {
  it('preserves the subdomain and the overall domain length while randomizing case', () => {
    const result = MuddleDomain('sub.example.com')
    expect(result.toLowerCase()).toBe('sub.example.com')
    expect(result.startsWith('sub.')).toBe(true)
  })
})

describe('ConstantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(ConstantTimeEqual('same-token-value', 'same-token-value')).toBe(true)
  })

  it('returns false for different strings, including different lengths', () => {
    expect(ConstantTimeEqual('abc', 'abd')).toBe(false)
    expect(ConstantTimeEqual('short', 'a-much-longer-string')).toBe(false)
  })

  it('returns false when compared against an empty string', () => {
    expect(ConstantTimeEqual('abc', '')).toBe(false)
  })
})

describe('GenerateToken', () => {
  it('generates a hex string of the expected length and is not trivially predictable', () => {
    const a = GenerateToken(24)
    const b = GenerateToken(24)
    expect(a).toMatch(/^[0-9a-f]+$/)
    expect(a).toHaveLength(48) // 24 bytes -> 48 hex chars
    expect(a).not.toBe(b) // extremely unlikely to collide with a real CSPRNG
  })
})
