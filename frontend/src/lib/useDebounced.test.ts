import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebounced } from './useDebounced'

describe('useDebounced', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps the old value until the input has been quiet for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 300), { initialProps: { value: 'a' } })

    rerender({ value: 'ab' })
    act(() => void vi.advanceTimersByTime(200))
    rerender({ value: 'abc' }) // typing again restarts the wait
    act(() => void vi.advanceTimersByTime(200))
    expect(result.current).toBe('a')

    act(() => void vi.advanceTimersByTime(150))
    expect(result.current).toBe('abc')
  })
})
