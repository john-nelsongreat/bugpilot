import type { EngineProbeResult } from './protocol'

export type WebAssemblyProbe = EngineProbeResult

/**
 * The smallest valid WebAssembly module: magic plus version header, no sections. It lives
 * here instead of in `assets.ts` because the probe runs on the main thread too, and nothing
 * that imports the engine asset URLs belongs in the page chunk.
 */
export const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

/**
 * Shown whenever the WebAssembly probe fails. The sentence is deliberately explicit: the
 * basic checks still ran, and the user must not read a shorter report as "no bugs found".
 */
export const ENGINES_UNAVAILABLE_MESSAGE =
  'Deep analysis engines are unavailable in this browser or blocked by its security policy; basic checks still ran'

type WebAssemblyNamespace = {
  compile?: (bytes: Uint8Array) => Promise<unknown>
  instantiate?: (source: unknown) => Promise<unknown>
}

function webAssemblyNamespace(): WebAssemblyNamespace | null {
  const holder = globalThis as unknown as { WebAssembly?: WebAssemblyNamespace }
  return holder.WebAssembly ?? null
}

/**
 * Compiles the smallest possible module. It runs inside the engine worker, because that is
 * the context whose Content-Security-Policy decides whether WebAssembly is allowed; the
 * main document stays blocked on purpose.
 */
export async function probeWebAssembly(): Promise<EngineProbeResult> {
  const namespace = webAssemblyNamespace()
  if (!namespace || typeof namespace.compile !== 'function' || typeof namespace.instantiate !== 'function') {
    return {
      ok: false,
      code: 'no-webassembly',
      message: 'This browser does not provide WebAssembly.compile.',
    }
  }

  try {
    const compiled = await namespace.compile(MINIMAL_WASM)
    await namespace.instantiate(compiled)
    return { ok: true, code: 'available', message: 'WebAssembly compiles and instantiates in this worker.' }
  } catch (error) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    const blocked = /content security policy|unsafe-eval|wasm-unsafe-eval/i.test(text)
    return {
      ok: false,
      code: blocked ? 'blocked-by-policy' : 'worker-error',
      message: text.slice(0, 240),
    }
  }
}
