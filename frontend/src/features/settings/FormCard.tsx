import type { FormEvent, ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { FormError } from '../auth/AuthLayout'

interface FormCardProps {
  title: string
  description?: string
  submitLabel: string
  busy: boolean
  onSubmit: () => void
  /** A problem that belongs to the whole form rather than one field. */
  error?: string | null
  /** Shown after a successful save. */
  notice?: string | null
  children: ReactNode
}

/** One settings form: a heading, its fields, a Save button, and the outcome. */
export function FormCard({ title, description, submitLabel, busy, onSubmit, error, notice, children }: FormCardProps) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }
  return (
    <form aria-label={title} onSubmit={submit} noValidate className="space-y-3 border-b border-zinc-800 px-4 py-5">
      <div>
        <h3 className="text-lg font-bold">{title}</h3>
        {description && <p className="text-sm text-zinc-500">{description}</p>}
      </div>
      {children}
      <FormError message={error ?? null} />
      {notice && <p role="status" className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">{notice}</p>}
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  )
}
