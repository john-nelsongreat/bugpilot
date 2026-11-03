import { describe, expect, it } from 'vitest'
import { redactCredentialInMessage, redactCredentialToken, redactIfCredential } from './redact'

/**
 * Every fixture here is assembled at runtime from fragments: the repository must never hold a
 * literal credential-shaped string, and these tests would be the first place one appeared.
 */
const KEY = ['gh', 'p_', 'K7mN2pQ9rS4tV6wX8yZ1', 'aB3cD5eF7gH9jK2mN4pQ6'].join('')
const AWS = ['AK', 'IA', '3TEXAMPLE7XK2Q94'].join('')
const SLACK = ['xox', 'b-', '4815162342abcdef'].join('')

describe('engine evidence redaction', () => {
  it('leaves ordinary code exactly as the file has it', () => {
    const quote = '    } catch (err) {'
    expect(redactIfCredential(quote)).toBe(quote)
    expect(redactCredentialToken('unreachable')).toBe('unreachable')
    expect(redactCredentialInMessage('Found 1 unused import')).toBe('Found 1 unused import')
  })

  it('masks a key=value line and says the quote was shortened', () => {
    const masked = redactIfCredential(`api_key = "${KEY}"`)
    expect(masked).not.toContain(KEY)
    expect(masked).toContain('a credential-shaped value on this line was redacted')
    expect(masked).toContain('api_key')
  })

  it('recognises the shapes by themselves, not only the word token', () => {
    for (const value of [KEY, AWS, SLACK]) {
      expect(redactIfCredential(`x = ${value}`)).not.toContain(value)
    }
    expect(redactIfCredential('password = hunter22')).toContain('redacted')
  })

  it('keeps the rest of the line when only the quoted value is a secret', () => {
    const masked = redactIfCredential(`AWS_ACCESS_KEY_ID = "${AWS}"`)
    expect(masked).not.toContain(AWS)
    expect(masked).toContain('AWS_ACCESS_KEY_ID')
  })

  it('masks a token without the sentence marker, for messages that quote it', () => {
    const masked = redactCredentialToken(KEY)
    expect(masked).not.toContain(KEY)
    expect(masked).not.toContain('redacted')
    expect(masked.length).toBeLessThan(KEY.length)
  })

  it('masks only the quoted value inside an engine sentence', () => {
    const text = `Possible hardcoded password: "${KEY}"`
    const masked = redactCredentialInMessage(text)
    expect(masked).not.toContain(KEY)
    expect(masked).toContain('Possible hardcoded password')
    expect(masked.startsWith('Possible')).toBe(true)
  })

  it('keeps short quoted words and masks the whole sentence instead when nothing is quotable', () => {
    const short = 'secret is set to "on"'
    expect(redactCredentialInMessage(short)).toContain('[a credential-shaped value in this message was redacted]')
    expect(redactCredentialInMessage(short)).not.toContain('secret is set to')
  })

  it('does not touch a sentence that merely mentions a secret-shaped word without a value', () => {
    const text = 'Move this token check out of the loop'
    expect(redactCredentialInMessage(text)).toBe(text)
  })
})
