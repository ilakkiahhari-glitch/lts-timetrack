import { describe, expect, it } from 'vitest'
import { formatDuration, timeAgo, typeLabel } from './format'

describe('formatDuration', () => {
  it.each([
    [0, 'under 1 min'],
    [59, 'under 1 min'],
    [60, '1 min'],
    [45 * 60, '45 min'],
    [3600, '1 h'],
    [27329, '7 h 35 min'], // the example in the design document
    [-5, 'under 1 min'],
  ])('%i seconds -> %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})

describe('timeAgo', () => {
  const now = new Date('2026-10-16T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  it.each([
    [10 * 1000, 'just now'],
    [5 * 60 * 1000, '5 min ago'],
    [59 * 60 * 1000, '59 min ago'],
    [3 * 3600 * 1000, '3 h ago'],
  ])('%i ms ago -> %s', (ms, expected) => {
    expect(timeAgo(ago(ms), now)).toBe(expected)
  })

  it('switches to a date after a day', () => {
    expect(timeAgo(ago(3 * 24 * 3600 * 1000), now)).toMatch(/2026/)
  })
})

describe('typeLabel', () => {
  it('turns codes into readable labels', () => {
    expect(typeLabel('TEACHER')).toBe('Teacher')
    expect(typeLabel('VOLUNTEER_HELPER')).toBe('Volunteer helper')
  })
})
