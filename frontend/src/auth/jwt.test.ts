import { describe, expect, it } from 'vitest'
import { fakeJwt } from '../test/fakeApi'
import { roleFromToken } from './jwt'

describe('roleFromToken', () => {
  it('reads the role claim', () => {
    expect(roleFromToken(fakeJwt('ADMIN'))).toBe('ADMIN')
    expect(roleFromToken(fakeJwt('VOLUNTEER'))).toBe('VOLUNTEER')
  })

  it.each(['', 'not-a-token', 'a.b.c', 'a..c'])('returns null for %j', (token) => {
    expect(roleFromToken(token)).toBeNull()
  })

  it('ignores a role it does not know', () => {
    const payload = btoa(JSON.stringify({ role: 'SUPERUSER' }))
    expect(roleFromToken(`x.${payload}.y`)).toBeNull()
  })
})
