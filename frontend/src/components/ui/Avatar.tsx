const sizes = { sm: 'h-8 w-8 text-sm', md: 'h-10 w-10 text-base', lg: 'h-16 w-16 text-2xl', xl: 'h-28 w-28 text-4xl' }

interface AvatarProps {
  src: string | null | undefined
  name: string
  size?: keyof typeof sizes
  className?: string
}

/** The user's picture, or their initial on a neutral background when they have none. */
export function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const box = `${sizes[size]} shrink-0 rounded-full ${className}`
  if (src) return <img src={src} alt="" className={`${box} bg-zinc-800 object-cover`} />
  return (
    <div aria-hidden="true" className={`${box} flex items-center justify-center bg-zinc-700 font-semibold text-zinc-200`}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  )
}
