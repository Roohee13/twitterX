import { Client, type StompSubscription } from '@stomp/stompjs'
import { apiBaseUrl, refreshSession } from './api'
import { tokens } from './tokens'

type Handler = (body: unknown) => void

/** `ws://host/ws` next to the API (in development the Vite proxy forwards it to the backend). */
function socketUrl() {
  const base = apiBaseUrl() || window.location.origin
  return `${base.replace(/^http/, 'ws')}/ws`
}

/**
 * One STOMP connection for the whole app, shared by everything that wants live data (notifications now, messages later).
 * Subscriptions are remembered, so they come back by themselves after a reconnect. The backend reads the access token from
 * the CONNECT frame; if it was rejected (expired), the next attempt refreshes the session first.
 */
export class LiveSocket {
  private client: Client | null = null
  private handlers = new Map<string, Set<Handler>>()
  private subscriptions = new Map<string, StompSubscription>()
  private tokenRejected = false
  private connectListeners = new Set<() => void>()

  start() {
    if (this.client) return
    const client = new Client({
      brokerURL: socketUrl(),
      reconnectDelay: 5000,
      beforeConnect: async () => {
        try {
          if (this.tokenRejected || !tokens.getAccess()) {
            this.tokenRejected = false
            await refreshSession()
          }
        } catch {
          /* the session is over or the server is unreachable: the connect below fails and is retried */
        }
        client.connectHeaders = { Authorization: `Bearer ${tokens.getAccess() ?? ''}` }
      },
      onConnect: () => {
        this.subscriptions.clear()
        for (const destination of this.handlers.keys()) this.attach(destination)
        this.connectListeners.forEach((listener) => listener())
      },
      onStompError: () => {
        this.tokenRejected = true
      },
      onWebSocketClose: () => this.subscriptions.clear(),
    })
    this.client = client
    client.activate()
  }

  stop() {
    const client = this.client
    this.client = null
    this.subscriptions.clear()
    void client?.deactivate()
  }

  /**
   * Called each time the connection is (re)established. Anything pushed while it was down or still connecting is lost,
   * so screens use this to read the current state again.
   */
  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener)
    return () => {
      this.connectListeners.delete(listener)
    }
  }

  /** Returns the function that ends this subscription. */
  subscribe(destination: string, handler: Handler): () => void {
    let set = this.handlers.get(destination)
    if (!set) {
      set = new Set()
      this.handlers.set(destination, set)
    }
    set.add(handler)
    if (this.client?.connected) this.attach(destination)
    return () => {
      set.delete(handler)
      if (set.size > 0) return
      this.handlers.delete(destination)
      this.subscriptions.get(destination)?.unsubscribe()
      this.subscriptions.delete(destination)
    }
  }

  private attach(destination: string) {
    if (!this.client || this.subscriptions.has(destination)) return
    this.subscriptions.set(
      destination,
      this.client.subscribe(destination, (message) => {
        let body: unknown
        try {
          body = JSON.parse(message.body)
        } catch {
          return
        }
        this.handlers.get(destination)?.forEach((handler) => handler(body))
      }),
    )
  }
}
