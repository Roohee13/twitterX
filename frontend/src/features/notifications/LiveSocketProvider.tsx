import { useEffect, useState, type ReactNode } from 'react'
import { LiveSocket } from '../../lib/socket'
import { LiveSocketContext } from './liveSocketContext'

/** Opens the live connection while the user is signed in (mount this inside the signed-in part of the app). */
export function LiveSocketProvider({ children }: { children: ReactNode }) {
  const [socket] = useState(() => new LiveSocket())
  useEffect(() => {
    socket.start()
    return () => socket.stop()
  }, [socket])
  return <LiveSocketContext.Provider value={socket}>{children}</LiveSocketContext.Provider>
}
