import type { ReportReason, ReportStatus } from '../../lib/types'

export const reasonLabel: Record<ReportReason, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Harassment',
  HATE_SPEECH: 'Hate speech',
  VIOLENCE: 'Violence',
  SEXUAL_CONTENT: 'Sexual content',
  MISINFORMATION: 'Misinformation',
  OTHER: 'Something else',
}

export const accountStatusLabel = { ACTIVE: 'Active', DEACTIVATED: 'Deactivated', SUSPENDED: 'Suspended', DELETED: 'Removed' } as const

export const statusLabel: Record<ReportStatus, string> = { OPEN: 'Open', DISMISSED: 'Dismissed', RESOLVED: 'Resolved' }
