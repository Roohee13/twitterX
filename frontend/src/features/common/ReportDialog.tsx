import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

export type ReportReason = 'SPAM' | 'HARASSMENT' | 'HATE_SPEECH' | 'VIOLENCE' | 'SEXUAL_CONTENT' | 'MISINFORMATION' | 'OTHER'

const reasons: Array<{ value: ReportReason; label: string }> = [
  { value: 'SPAM', label: "It's spam" },
  { value: 'HARASSMENT', label: "It's abusive or harassing" },
  { value: 'HATE_SPEECH', label: 'It contains hate speech' },
  { value: 'VIOLENCE', label: 'It promotes violence' },
  { value: 'SEXUAL_CONTENT', label: 'It contains sexual content' },
  { value: 'MISINFORMATION', label: "It's misleading" },
  { value: 'OTHER', label: 'Something else' },
]

interface ReportDialogProps {
  title: string
  /** Sends the report; resolves true when it went through (the dialog then closes). */
  onReport: (reason: ReportReason) => Promise<boolean>
  onClose: () => void
}

/** Pick a reason and send a report: used for both posts and accounts. */
export function ReportDialog({ title, onReport, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [sending, setSending] = useState(false)

  async function send() {
    if (!reason) return
    setSending(true)
    const done = await onReport(reason)
    setSending(false)
    if (done) onClose()
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <fieldset className="space-y-1">
        <legend className="mb-2 text-zinc-400">What's wrong?</legend>
        {reasons.map((r) => (
          <label key={r.value} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-zinc-900">
            <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex justify-end"><Button onClick={() => void send()} loading={sending} disabled={!reason}>Report</Button></div>
    </Modal>
  )
}
