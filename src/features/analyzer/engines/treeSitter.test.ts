import { afterEach, describe, expect, it, vi } from 'vitest'
import { MINIMAL_WASM } from './featureProbe'
import { DownloadError, fetchWasmCapped } from './treeSitter'

/**
 * `fetchWasmCapped` is the last line of defence between a `200` response and the WebAssembly
 * loader. The deploy-skew case is measured, not hypothetical: a client naming a grammar that
 * no longer exists gets the application shell back (`200`, `text/html`), and without this
 * guard those bytes reach `Language.load` as if they were a grammar. Both delivery paths of
 * the capped fetch (streamed reader and the no-body arrayBuffer fallback) are tested, because
 * the guard must hold on both.
 */

const GRAMMAR_URL = 'https://bugpilot.example/assets/engines/tree-sitter-bash-DzPB90LK.wasm'

// First bytes of the measured application-shell response, padded to a realistic length.
const SHELL_HTML = new TextEncoder().encode(
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>BugPilot</title></head>' +
    '<body><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>',
)

interface StubChunk {
  done: boolean
  value?: Uint8Array
}

function stubFetchReturning(response: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => response))
}

function streamedResponse(chunks: Uint8Array[], ok = true, contentLength: string | null = null) {
  let index = 0
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
    body: {
      getReader: () => ({
        read: async (): Promise<StubChunk> =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
      }),
    },
  }
}

function bufferedResponse(bytes: Uint8Array, ok = true, contentLength: string | null = null) {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
    body: undefined,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWasmCapped', () => {
  it('passes through a real module delivered in network chunks', async () => {
    const whole = new Uint8Array([...MINIMAL_WASM, 0x01, 0x04, 0x00, 0x9a])
    stubFetchReturning(streamedResponse([whole.slice(0, 6), whole.slice(6)]))

    await expect(fetchWasmCapped(GRAMMAR_URL, 10_000)).resolves.toEqual(whole)
  })

  it('passes through a real module delivered without a streaming body', async () => {
    const whole = new Uint8Array([...MINIMAL_WASM, 0x01, 0x04])
    stubFetchReturning(bufferedResponse(whole))

    await expect(fetchWasmCapped(GRAMMAR_URL, 10_000)).resolves.toEqual(whole)
  })

  it('refuses the application-shell bytes with the observed prefix in the message', async () => {
    stubFetchReturning(streamedResponse([SHELL_HTML]))

    const error = await fetchWasmCapped(GRAMMAR_URL, 10_000).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(DownloadError)
    const downloadError = error as DownloadError
    expect(downloadError.code).toBe('failed')
    expect(downloadError.message).toContain(GRAMMAR_URL)
    expect(downloadError.message).toContain('not a WebAssembly module')
    expect(downloadError.message).toContain('3c 21 64 6f')
  })

  it('refuses the shell bytes on the arrayBuffer path too', async () => {
    stubFetchReturning(bufferedResponse(SHELL_HTML))

    await expect(fetchWasmCapped(GRAMMAR_URL, 10_000)).rejects.toThrow('not a WebAssembly module')
  })

  it('names the bytes it saw when the body is a truncated header', async () => {
    stubFetchReturning(streamedResponse([new Uint8Array([0x00, 0x61, 0x73, 0x6d])]))

    await expect(fetchWasmCapped(GRAMMAR_URL, 10_000)).rejects.toThrow('00 61 73 6d')
  })

  it('describes an empty body instead of printing nothing', async () => {
    stubFetchReturning(streamedResponse([]))

    await expect(fetchWasmCapped(GRAMMAR_URL, 10_000)).rejects.toThrow('starts (empty)')
  })

  it('keeps the byte ceiling ahead of the header check', async () => {
    stubFetchReturning(
      streamedResponse([new Uint8Array([...MINIMAL_WASM, 0x01])], true, String(MINIMAL_WASM.length + 1)),
    )

    const error = await fetchWasmCapped(GRAMMAR_URL, MINIMAL_WASM.length).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(DownloadError)
    expect((error as DownloadError).code).toBe('too-large')
  })

  it('reports a failed HTTP status with its code', async () => {
    stubFetchReturning(bufferedResponse(SHELL_HTML, false))

    await expect(fetchWasmCapped(GRAMMAR_URL, 10_000)).rejects.toThrow('HTTP 404')
  })
})
