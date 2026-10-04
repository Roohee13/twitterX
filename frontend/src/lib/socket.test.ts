import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from './api'
import { tokens } from './tokens'

// A fake STOMP client that records what the app asks of it and lets the test play the server's part.
interface Config {
  brokerURL: string
  beforeConnect: () => Promise<void>
  onConnect: () => void
  onStompError: () => void
  onWebSocketClose: () => void
}
const fake = vi.hoisted(() => ({ instances: [] as unknown[] }))
vi.mock('@stomp/stompjs', () => ({
  Client: class {
    connected = false
    connectHeaders: Record<string, string> = {}
    subscriptions: Array<{ destination: string; callback: (m: { body: string }) => void; unsubscribed: boolean }> = []
    activated = false
    deactivated = false
    config: Config
    constructor(config: Config) {
      this.config = config
      fake.instances.push(this)
    }
    activate() {
      this.activated = true
    }
    deactivate() {
      this.deactivated = true
      return Promise.resolve()
    }
    subscribe(destination: string, callback: (m: { body: string }) => void) {
      const sub = { destination, callback, unsubscribed: false }
      this.subscriptions.push(sub)
      return { id: String(this.subscriptions.length), unsubscribe: () => (sub.unsubscribed = true) }
    }
  },
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), refreshSession: vi.fn(async () => tokens.set('fresh-access', 'fresh-refresh')) }))

import { refreshSession } from './api'
import { LiveSocket } from './socket'

type FakeClient = {
  config: Config
  connected: boolean
  connectHeaders: Record<string, string>
  subscriptions: Array<{ destination: string; callback: (m: { body: string }) => void; unsubscribed: boolean }>
  activated: boolean
  deactivated: boolean
}
const last = () => fake.instances.at(-1) as FakeClient
const connect = (client: FakeClient) => {
  client.connected = true
  client.config.onConnect()
}

beforeEach(() => {
  fake.instances.length = 0
  vi.mocked(refreshSession).mockClear()
  tokens.clear()
  configureApi({ baseUrl: 'https://api.example.com' })
})

describe('LiveSocket', () => {
  it('connects to /ws on the API host, using wss for https', () => {
    new LiveSocket().start()
    expect(last().config.brokerURL).toBe('wss://api.example.com/ws')
    expect(last().activated).toBe(true)
  })

  it('sends the current access token in the CONNECT frame', async () => {
    tokens.set('access-1', 'refresh-1')
    new LiveSocket().start()
    await last().config.beforeConnect()
    expect(last().connectHeaders).toEqual({ Authorization: 'Bearer access-1' })
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('gets an access token first when there is none (after a page reload)', async () => {
    new LiveSocket().start()
    await last().config.beforeConnect()
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(last().connectHeaders).toEqual({ Authorization: 'Bearer fresh-access' })
  })

  it('refreshes before the next attempt when the server rejected the token', async () => {
    tokens.set('old', 'refresh-1')
    new LiveSocket().start()
    last().config.onStompError()
    await last().config.beforeConnect()
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(last().connectHeaders.Authorization).toBe('Bearer fresh-access')
    await last().config.beforeConnect() // only once per rejection
    expect(refreshSession).toHaveBeenCalledOnce()
  })

  it('subscribes once connected, hands parsed messages to every handler, and ignores malformed ones', () => {
    const socket = new LiveSocket()
    const a = vi.fn()
    const b = vi.fn()
    socket.subscribe('/user/queue/x', a)
    socket.subscribe('/user/queue/x', b)
    socket.start()
    expect(last().subscriptions).toEqual([]) // not connected yet
    connect(last())
    expect(last().subscriptions).toHaveLength(1) // one STOMP subscription for the destination

    last().subscriptions[0].callback({ body: '{"id":1}' })
    last().subscriptions[0].callback({ body: 'not json' })

    expect(a).toHaveBeenCalledExactlyOnceWith({ id: 1 })
    expect(b).toHaveBeenCalledExactlyOnceWith({ id: 1 })
  })

  it('subscribes straight away when already connected, and stops delivering after unsubscribe', () => {
    const socket = new LiveSocket()
    socket.start()
    connect(last())
    const handler = vi.fn()
    const unsubscribe = socket.subscribe('/user/queue/y', handler)
    expect(last().subscriptions).toHaveLength(1)

    unsubscribe()

    expect(last().subscriptions[0].unsubscribed).toBe(true)
  })

  it('keeps one handler working when another one on the same destination goes away', () => {
    const socket = new LiveSocket()
    socket.start()
    connect(last())
    const a = vi.fn()
    const b = vi.fn()
    const offA = socket.subscribe('/user/queue/z', a)
    socket.subscribe('/user/queue/z', b)
    offA()

    expect(last().subscriptions[0].unsubscribed).toBe(false)
    last().subscriptions[0].callback({ body: '1' })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith(1)
  })

  it('subscribes again after a reconnect', () => {
    const socket = new LiveSocket()
    socket.subscribe('/user/queue/x', vi.fn())
    socket.start()
    connect(last())
    last().connected = false
    last().config.onWebSocketClose()
    connect(last())
    expect(last().subscriptions).toHaveLength(2)
    expect(last().subscriptions[1].unsubscribed).toBe(false)
  })

  it('tells listeners each time the connection is established, until they stop listening', () => {
    const socket = new LiveSocket()
    const listener = vi.fn()
    const stopListening = socket.onConnect(listener)
    socket.start()
    connect(last())
    connect(last()) // a reconnect
    expect(listener).toHaveBeenCalledTimes(2)
    stopListening()
    connect(last())
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('starts only once and stop closes the connection', () => {
    const socket = new LiveSocket()
    socket.start()
    socket.start()
    expect(fake.instances).toHaveLength(1)
    socket.stop()
    expect(last().deactivated).toBe(true)
  })
})
