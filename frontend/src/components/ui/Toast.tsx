import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setRateLimitHandler } from '../../lib/api'

type Kind = 'info' | 'error'
interface ToastItem {
  id: number
  message: string
  kind: Kind
}

const ToastContext = createContext<(message: string, kind?: Kind) => void>(() => undefined)

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((current) => [...current, { id, message, kind }])
    setTimeout(() => setItems((current) => current.filter((t) => t.id !== id)), 4500)
  }, [])

  // Any request answered with 429 shows this, whichever screen made it.
  useEffect(() => {
    setRateLimitHandler((seconds) => toast(`You're doing that too much. Try again in ${seconds} seconds.`, 'error'))
    return () => setRateLimitHandler(undefined)
  }, [toast])

  const value = useMemo(() => toast, [toast])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 sm:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-brand text-white'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
