export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex justify-center p-6">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-brand" />
    </div>
  )
}
