import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { ScanResponse } from '../api/types'
import { COOLDOWN_MS, DISPLAY_MS, IN_VIEW_GAP_MS, useScanFlow } from './useScanFlow'

const scanMock = vi.hoisted(() => vi.fn())
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  scan: scanMock,
}))

const entry: ScanResponse = {
  result: 'ENTRY', person: 'A. Rivera', person_type: 'TEACHER', message: 'ok', time: '2026-10-16T13:00:00Z', duration_seconds: null,
}

function setup() {
  const onRecorded = vi.fn()
  const hook = renderHook(() => useScanFlow('dk_key', onRecorded))
  const submit = (token: string) => act(async () => { await hook.result.current.submit(token) })
  return { ...hook, onRecorded, submit }
}

beforeEach(() => {
  // Fake only the clock: faking microtasks too would stop React from rendering.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  scanMock.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('useScanFlow', () => {
  it('shows the result, refreshes the list, then returns to ready', async () => {
    scanMock.mockResolvedValue(entry)
    const { result, submit, onRecorded } = setup()
    await submit('tt_abc')
    expect(scanMock).toHaveBeenCalledWith('tt_abc', 'dk_key')
    expect(result.current.panel).toEqual({ kind: 'result', data: entry })
    expect(onRecorded).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(DISPLAY_MS) })
    expect(result.current.panel).toBeNull()
  })

  it('ignores blank input and trims the code', async () => {
    scanMock.mockResolvedValue(entry)
    const { submit } = setup()
    await submit('   ')
    expect(scanMock).not.toHaveBeenCalled()
    await submit('  tt_abc \n')
    expect(scanMock).toHaveBeenCalledWith('tt_abc', 'dk_key')
  })

  it('ignores a code typed twice in a row, then accepts it after the cooldown', async () => {
    scanMock.mockResolvedValue(entry)
    const { submit } = setup()
    await submit('tt_abc')
    await submit('tt_abc')
    expect(scanMock).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(COOLDOWN_MS + IN_VIEW_GAP_MS) })
    await submit('tt_abc')
    expect(scanMock).toHaveBeenCalledTimes(2)
  })

  it('treats a badge held in front of the camera as one scan, however long it stays', async () => {
    scanMock.mockResolvedValue(entry)
    const { submit } = setup()
    await submit('tt_abc') // first frame that decodes it
    for (let second = 1; second <= 90; second++) { // still in view for 90 seconds, reported every second
      act(() => { vi.advanceTimersByTime(1000) })
      await submit('tt_abc')
    }
    expect(scanMock).toHaveBeenCalledOnce() // never flipped to EXIT
  })

  it('accepts the same badge again once it has left the camera view', async () => {
    scanMock.mockResolvedValue(entry)
    const { submit } = setup()
    await submit('tt_abc')
    act(() => { vi.advanceTimersByTime(IN_VIEW_GAP_MS + 500) }) // gone for a while, cooldown long over
    act(() => { vi.advanceTimersByTime(COOLDOWN_MS) })
    await submit('tt_abc')
    expect(scanMock).toHaveBeenCalledTimes(2)
  })

  it('accepts a different code straight away, replacing the banner', async () => {
    scanMock.mockResolvedValueOnce(entry).mockResolvedValueOnce({ ...entry, person: 'B. Chen' })
    const { result, submit } = setup()
    await submit('tt_one')
    await submit('tt_two')
    expect(scanMock).toHaveBeenCalledTimes(2)
    expect(result.current.panel).toMatchObject({ data: { person: 'B. Chen' } })
  })

  it('does not send a second request while one is in flight', async () => {
    let finish!: (value: ScanResponse) => void
    scanMock.mockReturnValue(new Promise<ScanResponse>((resolve) => { finish = resolve }))
    const { result, submit } = setup()
    let first!: Promise<void>
    act(() => { first = result.current.submit('tt_one') }) // starts the request; busy is set synchronously
    expect(result.current.busy).toBe(true)
    await submit('tt_two')
    expect(scanMock).toHaveBeenCalledOnce()
    await act(async () => { finish(entry); await first })
    expect(result.current.busy).toBe(false)
  })

  it.each([
    [new ApiError(422, 'Invalid QR code'), 'QR code not recognised'],
    [new ApiError(429, 'Too many requests', 12), 'Too many scans'],
    [new ApiError(0, 'Cannot reach the server'), 'No connection'],
    [new ApiError(500, 'Boom'), 'Scan failed'],
    [new Error('unexpected'), 'Scan failed'],
  ])('shows a clear error for %o', async (error, title) => {
    scanMock.mockRejectedValue(error)
    const { result, submit } = setup()
    await submit('tt_bad')
    expect(result.current.panel).toMatchObject({ kind: 'error', title })
    act(() => { vi.advanceTimersByTime(DISPLAY_MS) })
    expect(result.current.panel).toBeNull()
  })

  it('tells the person how long to wait after a 429', async () => {
    scanMock.mockRejectedValue(new ApiError(429, 'Too many requests', 12))
    const { result, submit } = setup()
    await submit('tt_bad')
    expect(result.current.panel).toMatchObject({ detail: expect.stringContaining('12 seconds') })
  })

  it('keeps a rejected device key on screen until someone acts', async () => {
    scanMock.mockRejectedValue(new ApiError(401, 'Invalid device key'))
    const { result, submit, onRecorded } = setup()
    await submit('tt_abc')
    expect(result.current.panel).toMatchObject({ kind: 'error', deviceKeyRejected: true })
    act(() => { vi.advanceTimersByTime(DISPLAY_MS * 5) })
    expect(result.current.panel).not.toBeNull()
    expect(onRecorded).not.toHaveBeenCalled()
  })
})
