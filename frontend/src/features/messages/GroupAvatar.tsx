import { Users } from 'lucide-react'

const sizes = { sm: 'h-8 w-8', md: 'h-10 w-10' }

/** The picture of a group: a neutral circle with a people icon (the same size as an Avatar). */
export function GroupAvatar({ size = 'md' }: { size?: keyof typeof sizes }) {
  return (
    <div aria-hidden="true" className={`${sizes[size]} flex shrink-0 items-center justify-center rounded-full bg-zinc-700 text-zinc-200`}>
      <Users size={size === 'sm' ? 16 : 20} />
    </div>
  )
}
