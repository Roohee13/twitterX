import { useQuery } from '@tanstack/react-query'
import { Home, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { useAuth, useCurrentUser } from '../auth/AuthContext'
import { VerificationBanner } from '../auth/VerificationBanner'
import { api } from '../../lib/api'
import type { TrendingHashtag } from '../../lib/types'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

// Entries are added here as their pages are built.
const navItems: NavItem[] = [{ to: '/', label: 'Home', icon: <Home size={26} /> }]

function NavItems({ vertical }: { vertical: boolean }) {
  return (
    <>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          aria-label={item.label}
          className={({ isActive }) =>
            `flex items-center gap-4 rounded-full p-3 text-xl hover:bg-zinc-900 ${isActive ? 'font-bold' : ''} ${vertical ? '' : 'flex-1 justify-center'}`
          }
        >
          {item.icon}
          {vertical && <span className="hidden xl:inline">{item.label}</span>}
        </NavLink>
      ))}
    </>
  )
}

function UserCard() {
  const user = useCurrentUser()
  const { logout } = useAuth()
  return (
    <div className="mt-auto flex items-center gap-3 rounded-full p-3 hover:bg-zinc-900">
      <Avatar src={user.avatarUrl} name={user.displayName} />
      <div className="hidden min-w-0 flex-1 xl:block">
        <p className="truncate font-bold">{user.displayName}</p>
        <p className="truncate text-sm text-zinc-500">@{user.username}</p>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Log out"
        title="Log out"
        className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
      >
        <LogOut size={20} />
      </button>
    </div>
  )
}

function TrendsPanel() {
  const trends = useQuery({ queryKey: ['trending'], queryFn: () => api.get<TrendingHashtag[]>('/api/trending/hashtags'), staleTime: 60_000 })
  return (
    <section aria-label="Trends" className="rounded-2xl bg-zinc-900 py-3">
      <h2 className="px-4 pb-2 text-xl font-extrabold">Trends for you</h2>
      {trends.isPending && <p className="px-4 py-2 text-zinc-500">Loading…</p>}
      {trends.isError && <p className="px-4 py-2 text-zinc-500">Trends are unavailable right now.</p>}
      {trends.data?.length === 0 && <p className="px-4 py-2 text-zinc-500">Nothing is trending yet.</p>}
      {trends.data?.map((tag) => (
        <Link key={tag.name} to={`/hashtag/${tag.name}`} className="block px-4 py-2 hover:bg-zinc-800">
          <p className="font-bold">#{tag.name}</p>
          <p className="text-sm text-zinc-500">{tag.postCount} {tag.postCount === 1 ? 'post' : 'posts'}</p>
        </Link>
      ))}
    </section>
  )
}

/** Left navigation, the page in the middle, side panels on the right; a bottom bar on phones. */
export function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1265px] justify-center">
      <header className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col px-2 py-2 sm:flex xl:w-[275px]">
        <Link to="/" aria-label="XClone home" className="mb-2 w-fit rounded-full p-3 text-3xl font-black text-white hover:bg-zinc-900">
          X
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <NavItems vertical />
        </nav>
        <UserCard />
      </header>

      <main className="min-h-screen w-full max-w-[600px] border-zinc-800 pb-16 sm:border-x sm:pb-0">
        <VerificationBanner />
        <Outlet />
      </main>

      <aside className="hidden w-[350px] shrink-0 flex-col gap-4 px-6 py-3 lg:flex">
        <TrendsPanel />
      </aside>

      <nav aria-label="Main (mobile)" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-800 bg-black sm:hidden">
        <NavItems vertical={false} />
      </nav>
    </div>
  )
}
