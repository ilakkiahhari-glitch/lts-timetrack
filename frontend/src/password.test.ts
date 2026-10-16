import { describe, expect, it } from 'vitest'
import { generatePassword } from './password'

describe('generatePassword', () => {
  it('makes a password of the requested length (14 by default)', () => {
    expect(generatePassword()).toHaveLength(14)
    expect(generatePassword(20)).toHaveLength(20)
  })

  it('uses only characters that are hard to misread', () => {
    for (let i = 0; i < 50; i++) expect(generatePassword(40)).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/)
  })

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 200 }, () => generatePassword())).size).toBe(200)
  })

  it('is long enough for the backend minimum of 8', () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(8)
  })
})
