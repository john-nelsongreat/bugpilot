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

export function createBlobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(start, end, signal) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      checkRange(blob.size, start, end)
      if (end === start) return new Uint8Array(0)
      const buffer = await blob.slice(start, end).arrayBuffer()
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return new Uint8Array(buffer)
    },
  }
}
