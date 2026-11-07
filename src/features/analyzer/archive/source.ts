/**
 * A file the reader can seek in. A zip is read backwards from its index and then entry by
 * entry, so the whole archive never needs to be in memory: a Blob slice reads the bytes that
 * are actually used. The memory source keeps the old entry point for tests and for callers
 * that already hold bytes.
 */
export interface ByteSource {
  readonly size: number
  /** Returns bytes in `[start, end)`; the caller must keep the range inside the source. */
  read(start: number, end: number, signal?: AbortSignal): Promise<Uint8Array>
}

function checkRange(size: number, start: number, end: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > size
  ) {
    throw new RangeError(`read range ${start}..${end} is outside a source of ${size} bytes`)
  }
}

export function createMemorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    async read(start, end, signal) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      checkRange(bytes.length, start, end)
      return bytes.subarray(start, end)
    },
  }
}

/**
 * How much one Blob read fetches beyond the range asked for. A zip is walked entry by entry in
 * file order, and each entry costs three or four small reads (local header, name, data,
 * descriptor). One slice call per read makes a many-entry archive pay minutes of per-call
 * latency for kilobytes of real data — a 512 KiB window answers thousands of neighbouring
 * reads from one fetch while keeping the worker's memory bounded.
 */
const BLOB_WINDOW_BYTES = 512 * 1024

export function createBlobSource(blob: Blob): ByteSource {
  let windowStart = 0
  let windowEnd = 0
  let windowData: Uint8Array | null = null
  return {
    size: blob.size,
    async read(start, end, signal) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      checkRange(blob.size, start, end)
      if (end === start) return new Uint8Array(0)
      if (windowData && start >= windowStart && end <= windowEnd) {
        return windowData.subarray(start - windowStart, end - windowStart)
      }
      if (end - start >= BLOB_WINDOW_BYTES) {
        const buffer = await blob.slice(start, end).arrayBuffer()
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        return new Uint8Array(buffer)
      }
      const fetchEnd = Math.min(blob.size, start + BLOB_WINDOW_BYTES)
      const buffer = await blob.slice(start, fetchEnd).arrayBuffer()
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      windowStart = start
      windowEnd = fetchEnd
      windowData = new Uint8Array(buffer)
      return windowData.subarray(0, end - start)
    },
  }
}
