import { redactSecret } from '../rules/context'

const CREDENTIAL_SHAPED =
  /(api[_-]?key|secret|token|password|passwd|credential|authorization|bearer|access[_-]?key)|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}/i

/** Provider-shaped keys are recognisable even when the file writes them without quotes. */
const BARE_KEY_SHAPES = /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}/g

function maskSecretRuns(text: string): string {
  let changed = false
  const quoted = text.replace(/(["'])((?:[^"'\\\r\n]|\\.){8,}?)\1/g, (whole, open: string, inner: string) => {
    changed = true
    return `${open}${redactSecret(inner)}${whole.slice(-1)}`
  })
  if (changed) return quoted
  return text.replace(BARE_KEY_SHAPES, (whole) => redactSecret(whole))
}

/**
 * Engine evidence is a verbatim slice of the user's file, and a syntax error can easily
 * land on a line that holds a credential. Redacting keeps the quote useful without
 * copying a secret into the report.
 */
export function redactIfCredential(quote: string): string {
  if (!CREDENTIAL_SHAPED.test(quote)) return quote
  const masked = maskSecretRuns(quote)
  // Masking only the value keeps the rest of the line, so the evidence still reads like the
  // line the user wrote; shortening the whole line is the fallback for an unquoted secret.
  return `${masked === quote ? redactSecret(quote) : masked} [a credential-shaped value on this line was redacted]`
}

/** Short form for a value that is quoted inside a sentence: no trailing marker. */
export function redactCredentialToken(value: string): string {
  return CREDENTIAL_SHAPED.test(value) ? redactSecret(value) : value
}

/**
 * An engine writes the value it found into its own sentence (Ruff produces
 * `Possible hardcoded password: 'ghp_…'`), so the message is a second leak path. Only the
 * quoted run is masked, because the surrounding words are the finding's explanation; when
 * nothing quoted could be masked the whole text is shortened instead.
 */
export function redactCredentialInMessage(text: string): string {
  if (!CREDENTIAL_SHAPED.test(text)) return text
  const masked = maskSecretRuns(text)
  if (masked !== text) return masked
  // Sentences that merely share the word `token` or `secret` carry no value, and masking them
  // would throw away the finding's explanation for nothing.
  if (!/["'][^"']+["']|[=:]/.test(text)) return text
  return `${redactSecret(text)} [a credential-shaped value in this message was redacted]`
}
