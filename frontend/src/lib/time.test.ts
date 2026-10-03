import { timeAgo } from './time'

describe('timeAgo', () => {
  const now = new Date('2026-10-03T12:00:00Z').getTime()
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('is compact for recent times', () => {
    expect(timeAgo(ago(10_000), now)).toBe('now')
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m')
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h')
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe('2d')
  })

  it('falls back to a short date after a week', () => {
    expect(timeAgo(ago(30 * 86_400_000), now)).toMatch(/Sep/)
  })
})
