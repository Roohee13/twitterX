/** "now", "5m", "3h", "2d", then a short date; compact like the timelines it is used in. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined })
}

/** Full date and time for tooltips and post detail pages. */
export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
}

