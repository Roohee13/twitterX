import type { ButtonHTMLAttributes } from 'react'

const variants = {
  primary: 'bg-brand-solid text-white hover:bg-brand-solid-hover disabled:opacity-50',
  secondary: 'border border-zinc-600 text-zinc-100 hover:bg-zinc-900 disabled:opacity-50',
  ghost: 'text-zinc-300 hover:bg-zinc-900 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  loading?: boolean
  size?: 'sm' | 'md'
}

export function Button({ variant = 'primary', loading = false, size = 'md', className = '', children, disabled, ...rest }: ButtonProps) {
  const pad = size === 'sm' ? 'px-3 py-1 text-sm' : 'px-5 py-2'
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors ${pad} ${variants[variant]} ${className}`}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  )
}
