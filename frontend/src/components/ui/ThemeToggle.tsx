import { Moon, Sun } from 'lucide-react'
import { setThemePreference, useTheme } from '../../lib/theme'

/** One tap between light and dark. (Settings also offers "Use my device setting".) */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 ${className}`}
    >
      {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  )
}
