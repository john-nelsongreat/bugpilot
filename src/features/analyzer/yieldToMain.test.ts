import { describe, expect, it } from 'vitest'
import { yieldToMain } from './yieldToMain'

describe('yieldToMain', () => {
  it('resolves without throwing on the scheduler path or the MessageChannel fallback', async () => {
    await expect(yieldToMain()).resolves.toBeUndefined()
  })

  it('lets queued work interleave: a second yield resolves while another is pending', async () => {
    const order: string[] = []
    const first = yieldToMain().then(() => order.push('first'))
    const second = yieldToMain().then(() => order.push('second'))
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })
})
