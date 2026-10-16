import { describe, expect, it } from 'vitest'
import { formatDuration, typeLabel } from './format'

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

describe('typeLabel', () => {
  it('turns codes into readable labels', () => {
    expect(typeLabel('TEACHER')).toBe('Teacher')
    expect(typeLabel('VOLUNTEER_HELPER')).toBe('Volunteer helper')
  })
})
