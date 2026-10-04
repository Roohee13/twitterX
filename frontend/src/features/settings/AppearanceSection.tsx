import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useThemePreference, type ThemePreference } from '../../lib/theme'

const options: Array<{ value: ThemePreference; label: string; hint: string; icon: LucideIcon }> = [
  { value: 'system', label: 'Device', hint: 'Follows your device and changes with it', icon: Monitor },
  { value: 'light', label: 'Light', hint: 'Dark text on a white page', icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Light text on a black page', icon: Moon },
]

/** Light, dark, or whatever the device uses. Saved on this device only, and applied at once. */
export function AppearanceSection() {
  const [preference, setPreference] = useThemePreference()
  return (
    <section aria-label="Appearance" className="border-b border-zinc-800 px-4 py-5">
      <fieldset>
        <legend className="text-lg font-bold">Appearance</legend>
        <p className="text-sm text-zinc-500">Saved on this device.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {options.map(({ value, label, hint, icon: Icon }) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 focus-within:outline focus-within:outline-2 focus-within:outline-brand ${preference === value ? 'border-brand bg-brand/10' : 'border-zinc-700 hover:bg-hover'}`}
            >
              <input type="radio" name="theme" value={value} checked={preference === value} onChange={() => setPreference(value)} className="sr-only" />
              <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-sm text-zinc-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  )
}
