import { describe, expect, it } from 'vitest'
import { createTsClient, type TsWorkerHandle } from './tsClient'

interface FakeWorker {
  handle: TsWorkerHandle
  posted: Array<{ type: string; id: number }>
  listeners: Record<string, Array<(event: unknown) => void>>
  emit: (type: string, event: unknown) => void
  terminated: boolean
}

function makeWorker(): FakeWorker {
  const fake: FakeWorker = {
    posted: [],
    listeners: {},
    terminated: false,
    emit: (type, event) => {
      for (const listener of fake.listeners[type] ?? []) listener(event)
    },
    handle: {
      postMessage: () => {},
      addEventListener: () => {},
      terminate: () => {},
    } as unknown as TsWorkerHandle,
  }
  fake.handle.postMessage = (message: unknown) => {
    fake.posted.push(message as { type: string; id: number })
  }
  fake.handle.addEventListener = (type: string, listener: (event: unknown) => void) => {
    fake.listeners[type] = [...(fake.listeners[type] ?? []), listener]
  }
  fake.handle.terminate = () => {
    fake.terminated = true
  }
  return fake
}

function respond(fake: FakeWorker, message: unknown): void {
  fake.emit('message', { data: message })
}

/** The client creates the worker through an async factory before it posts the message. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('TypeScript syntax client', () => {
  it('posts a check and resolves the findings', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const pending = client.check({ name: 'src/app.ts', text: 'const value = ;\n' })
    await settle()

    expect(fake.posted[0].type).toBe('check')
    respond(fake, { type: 'result', id: fake.posted[0].id, findings: [{ id: 'f-1' }] })
    await expect(pending).resolves.toMatchObject({ error: null, timedOut: false, cancelled: false })
    expect((await pending).findings).toHaveLength(1)
    expect(fake.terminated).toBe(false)
  })

  it('reports an error message from the worker', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const pending = client.check({ name: 'src/app.ts', text: 'x' })
    await settle()

    respond(fake, { type: 'error', id: fake.posted[0].id, message: 'compiler failed' })
    await expect(pending).resolves.toMatchObject({ error: 'compiler failed', findings: [] })
    expect(fake.terminated).toBe(true)
  })

  it('stops a check that exceeds its time budget', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const result = await client.check({ name: 'src/app.ts', text: 'x' }, { timeoutMs: 20 })

    expect(result.timedOut).toBe(true)
    expect(result.findings).toEqual([])
    expect(fake.terminated).toBe(true)
  })

  it('cancels and terminates on an abort signal', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const controller = new AbortController()
    const pending = client.check({ name: 'src/app.ts', text: 'x' }, { signal: controller.signal })
    await settle()

    controller.abort()
    await expect(pending).resolves.toMatchObject({ cancelled: true, findings: [] })
    expect(fake.terminated).toBe(true)
  })

  it('refuses an already cancelled check without creating a request', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const controller = new AbortController()
    controller.abort()

    const result = await client.check({ name: 'src/app.ts', text: 'x' }, { signal: controller.signal })
    expect(result.cancelled).toBe(true)
    expect(fake.posted).toHaveLength(0)
  })

  it('turns a worker crash into an error', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const pending = client.check({ name: 'src/app.ts', text: 'x' })
    await settle()

    fake.emit('error', { message: 'boom' })
    await expect(pending).resolves.toMatchObject({ error: expect.stringMatching(/stopped unexpectedly/) })
    expect(fake.terminated).toBe(true)
  })

  it('refuses a second concurrent check', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const first = client.check({ name: 'src/a.ts', text: 'x' })
    const second = await client.check({ name: 'src/b.ts', text: 'y' })

    expect(second.error).toMatch(/already checking/)
    await settle()
    respond(fake, { type: 'result', id: fake.posted[0].id, findings: [] })
    await first
  })

  it('reports a worker that cannot start', async () => {
    const client = createTsClient(() => Promise.reject(new Error('no worker')))
    const result = await client.check({ name: 'src/a.ts', text: 'x' })

    expect(result.error).toBe('no worker')
  })

  it('closes the worker and cancels a pending check on dispose', async () => {
    const fake = makeWorker()
    const client = createTsClient(() => fake.handle)
    const pending = client.check({ name: 'src/a.ts', text: 'x' })
    await settle()

    client.dispose()
    await expect(pending).resolves.toMatchObject({ cancelled: true })
    expect(fake.terminated).toBe(true)
  })
})
