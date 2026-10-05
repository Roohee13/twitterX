import { Avatar } from '../../components/ui/Avatar'

/** What opening the profile of a deactivated account shows: the name "XClone user" and nothing else (no banner, handle, bio, date, counts, buttons or posts). */
export function UnavailableProfile() {
  return (
    <section aria-label="Unavailable account">
      <div className="h-32 bg-zinc-800 sm:h-48" aria-hidden="true" />
      <div className="px-4 pb-8">
        <Avatar src={null} name="XClone user" size="xl" className="-mt-14 border-4 border-black" />
        <h2 className="mt-2 text-xl font-extrabold">XClone user</h2>
        <p className="mt-6 text-center text-zinc-500">This account is unavailable.</p>
      </div>
    </section>
  )
}
