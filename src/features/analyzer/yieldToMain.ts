interface YieldScheduler {
  yield: () => Promise<void>
}

/**
 * Hands the main thread back between batches so the browser can paint and answer input while a
 * large read or result set is being received. Uses the scheduler API where it exists and a
 * MessageChannel tick elsewhere, because a `setTimeout(0)` fallback would clamp to 4 ms per
 * batch and add real seconds to a 40,000-file read.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: YieldScheduler }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(undefined)
  })
}
