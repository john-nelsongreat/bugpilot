export interface LongTaskProbe {
  longestMs: number
  count: number
  reset: () => void
  disconnect: () => void
}

declare global {
  interface Window {
    __bugpilotLongTasks?: LongTaskProbe
  }
}

interface ObserverScope {
  PerformanceObserver?: typeof PerformanceObserver
}

/**
 * Dev-only helper for the live checks: watches for tasks longer than 50 ms and keeps the
 * worst one so a run can be judged against the main-thread budget.
 */
export function startLongTaskProbe(scope: ObserverScope = globalThis): LongTaskProbe | null {
  const Observer = scope.PerformanceObserver
  if (typeof Observer !== 'function') return null

  const probe: LongTaskProbe = {
    longestMs: 0,
    count: 0,
    reset() {
      probe.longestMs = 0
      probe.count = 0
    },
    disconnect() {
      observer.disconnect()
    },
  }

  let observer: PerformanceObserver
  try {
    observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        probe.count += 1
        if (entry.duration > probe.longestMs) probe.longestMs = entry.duration
      }
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    return null
  }
  return probe
}
