import { describe, expect, it } from 'vitest'
import { startLongTaskProbe } from './longTasks'

interface FakeEntry {
  duration: number
}

class FakeObserver {
  static instances: FakeObserver[] = []
  static lastOptions: unknown = null
  static failObserve = false

  callback: (list: { getEntries: () => FakeEntry[] }) => void
  disconnected = false

  constructor(callback: (list: { getEntries: () => FakeEntry[] }) => void) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }

  observe(options: unknown): void {
    FakeObserver.lastOptions = options
    if (FakeObserver.failObserve) throw new Error('longtask is not supported here')
  }

  disconnect(): void {
    this.disconnected = true
  }
}

function asScope(observer: unknown): { PerformanceObserver?: typeof PerformanceObserver } {
  return { PerformanceObserver: observer as typeof PerformanceObserver }
}

describe('long task probe', () => {
  it('returns null when the browser has no PerformanceObserver', () => {
    expect(startLongTaskProbe({})).toBeNull()
  })

  it('returns null when observing long tasks is rejected', () => {
    FakeObserver.instances = []
    FakeObserver.failObserve = true
    expect(startLongTaskProbe(asScope(FakeObserver))).toBeNull()
    FakeObserver.failObserve = false
  })

  it('asks for buffered long-task entries', () => {
    FakeObserver.instances = []
    const probe = startLongTaskProbe(asScope(FakeObserver))
    expect(probe).not.toBeNull()
    expect(FakeObserver.lastOptions).toEqual({ type: 'longtask', buffered: true })
    probe?.disconnect()
    expect(FakeObserver.instances[0].disconnected).toBe(true)
  })

  it('keeps the longest task and the total count, and resets both', () => {
    FakeObserver.instances = []
    const probe = startLongTaskProbe(asScope(FakeObserver))
    const observer = FakeObserver.instances[0]

    observer.callback({ getEntries: () => [{ duration: 32 }, { duration: 88 }] })
    observer.callback({ getEntries: () => [{ duration: 45 }] })

    expect(probe?.count).toBe(3)
    expect(probe?.longestMs).toBe(88)

    probe?.reset()
    expect(probe?.count).toBe(0)
    expect(probe?.longestMs).toBe(0)
    probe?.disconnect()
  })
})
