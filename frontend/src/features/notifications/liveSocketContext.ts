import { createContext, useContext, useEffect } from 'react'
import type { LiveSocket } from '../../lib/socket'

export const LiveSocketContext = createContext<LiveSocket | null>(null)

/** Calls `listener` each time the live connection is (re)established, e.g. to catch up on what was missed while it was down. */
export function useLiveConnect(listener: () => void) {
  const socket = useContext(LiveSocketContext)
  useEffect(() => socket?.onConnect(listener), [socket, listener])
}

/** Calls `handler` with each message pushed to `destination`, for as long as the component is mounted. */
export function useLiveSubscription(destination: string, handler: (body: unknown) => void) {
  const socket = useContext(LiveSocketContext)
  useEffect(() => socket?.subscribe(destination, handler), [socket, destination, handler])
}
