import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENGINES_UNAVAILABLE_MESSAGE, MINIMAL_WASM, hasWasmHeader, probeWebAssembly } from './featureProbe'

/**
 * The degradation sentence is the whole of Part 0 for a user on a blocked browser, so both the
 * message and the reason code are pinned here. `WebAssembly` is replaced per case; nothing else
 * in the module reads the environment.
 */

const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, 'WebAssembly')

function stubWebAssembly(value: unknown): void {
  Object.defineProperty(globalThis, 'WebAssembly', {
    configurable: true,
    writable: true,
    value,
  })
}

afterEach(() => {
  if (descriptor) Object.defineProperty(globalThis, 'WebAssembly', descriptor)
})

describe('WebAssembly feature probe', () => {
  it('compiles a module that is valid and does nothing', async () => {
    const compile = vi.fn(async (_bytes: Uint8Array) => ({ compiled: true }))
    const instantiate = vi.fn(async () => ({ instance: {} }))
    stubWebAssembly({ compile, instantiate })

    const result = await probeWebAssembly()
    expect(result.ok).toBe(true)
    expect(result.code).toBe('available')
    expect(compile.mock.calls[0][0]).toBe(MINIMAL_WASM)
    expect(instantiate).toHaveBeenCalledTimes(1)
  })

  it('says no-webassembly when the browser has no WebAssembly at all', async () => {
    stubWebAssembly({})
    const result = await probeWebAssembly()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no-webassembly')
    expect(result.message).toContain('does not provide WebAssembly.compile')
  })

  it('says no-webassembly when the global itself is missing', async () => {
    stubWebAssembly(undefined)
    const result = await probeWebAssembly()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('no-webassembly')
  })

  it('calls a CSP refusal blocked-by-policy, because that is what the user can act on', async () => {
    stubWebAssembly({
      compile: async () => {
        throw new TypeError('WebAssembly.compile(): Content Security Policy disallows use of wasm-unsafe-eval')
      },
      instantiate: async () => ({}),
    })
    const result = await probeWebAssembly()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('blocked-by-policy')
    expect(result.message).toContain('Content Security Policy')
  })

  it('separates a failing instantiate from a policy refusal', async () => {
    class InstantiateError extends Error {
      // Real WebAssembly error subclasses set `name`; the probe prints it because it is the
      // only part of the failure a user can paste into a bug report.
      override name = 'InstantiateError'
    }
    stubWebAssembly({
      compile: async () => ({}),
      instantiate: async () => {
        throw new InstantiateError('boom')
      },
    })
    const result = await probeWebAssembly()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('worker-error')
    expect(result.message).toContain('InstantiateError')
    expect(result.message.length).toBeLessThanOrEqual(240)
  })

  it('keeps the exact sentence the page shows when the engines did not run', () => {
    expect(ENGINES_UNAVAILABLE_MESSAGE).toBe(
      'Deep analysis engines are unavailable in this browser or blocked by its security policy; basic checks still ran',
    )
    // A shorter report must not read as "no bugs found".
    expect(ENGINES_UNAVAILABLE_MESSAGE).toContain('basic checks still ran')
  })
})

describe('hasWasmHeader', () => {
  it('accepts the minimal module itself', () => {
    expect(hasWasmHeader(MINIMAL_WASM)).toBe(true)
  })

  it('accepts a module with a section after the header', () => {
    expect(hasWasmHeader(new Uint8Array([...MINIMAL_WASM, 0x01, 0x04]))).toBe(true)
  })

  it('refuses the application-shell bytes the SPA rewrite serves for a missing engine file', () => {
    // First four bytes of the measured 696-byte deploy-skew response (2026-11-18): `<!do`.
    const shell = new Uint8Array([0x3c, 0x21, 0x64, 0x6f])
    expect(hasWasmHeader(shell)).toBe(false)
  })

  it('refuses a bare four-byte magic with no version header', () => {
    expect(hasWasmHeader(new Uint8Array([0x00, 0x61, 0x73, 0x6d]))).toBe(false)
  })

  it('refuses the empty body a cancelled or empty response can produce', () => {
    expect(hasWasmHeader(new Uint8Array())).toBe(false)
  })
})
