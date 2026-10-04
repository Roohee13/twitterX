import { act } from 'react'
import type { LiveSocket } from '../lib/socket'

/** Stands in for the live connection: the test calls `push` the way the server would, and `connect` when it comes up. */
export function fakeSocket() {
  const handlers = new Map<string, Array<(body: unknown) => void>>()
  const connectListeners: Array<() => void> = []
  const socket = {
    onConnect(listener: () => void) {
      connectListeners.push(listener)
      return () => undefined
    },
    subscribe(destination: string, handler: (body: unknown) => void) {
      handlers.set(destination, [...(handlers.get(destination) ?? []), handler])
      return () => handlers.set(destination, (handlers.get(destination) ?? []).filter((h) => h !== handler))
    },
  } as unknown as LiveSocket
  return {
    socket,
    connect: () => act(() => connectListeners.forEach((l) => l())),
    push: (destination: string, body: unknown) => act(() => handlers.get(destination)?.forEach((h) => h(body))),
    subscribed: (destination: string) => handlers.get(destination)?.length ?? 0,
  }
}
