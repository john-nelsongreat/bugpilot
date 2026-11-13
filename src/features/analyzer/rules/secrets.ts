import type { DiagnosticConfidence } from '../../../diagnostics/types'
import type { RuleFile, RuleHit, AnalyzerRule } from './types'
import {
  ALL_TEXT_LANGUAGES,
  MAX_RULE_HITS,
  SECRET_LIMITATIONS,
  SECRET_VERIFICATION,
  isPlaceholderValue,
  lineEvidence,
  manualFix,
  quoteLine,
  rangeFromOffsets,
  redactSecret,
  shannonEntropy,
} from './context'

interface MatchDetails {
  message: string
  explanation: string
  confidence: DiagnosticConfidence
  quote: string
}

function hit(file: RuleFile, index: number, length: number, details: MatchDetails): RuleHit {
  const lineIndex = Math.max(0, file.lineStarts.findIndex((start, i) => start <= index && (i === file.lineStarts.length - 1 || file.lineStarts[i + 1] > index)))
  return {
    range: rangeFromOffsets(file.lineStarts, index, index + length),
    message: details.message,
    explanation: details.explanation,
    confidence: details.confidence,
    evidence: [lineEvidence(file, lineIndex, details.quote)],
    fix: manualFix(
      'Remove the credential from the file and load it from a secret manager or an environment variable outside version control.',
      'The line that holds the value; the key itself may be legitimate, the literal value is not.',
      'manual-only',
      'BugPilot never edits or rewrites a suspected secret; rotating it is a decision only the owner can make.',
    ),
    verificationSteps: SECRET_VERIFICATION,
    limitations: SECRET_LIMITATIONS,
  }
}

function vendorConfidence(vendor: string): DiagnosticConfidence {
  return {
    level: 'high',
    reason: `The value has the fixed prefix and length that ${vendor} issues for this credential type.`,
  }
}

const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g
const SLACK_TOKEN = /\bxox[abposr]-[A-Za-z0-9-]{10,250}\b/g
const STRIPE_LIVE_KEY = /\b(?:sk|rk)_live_[A-Za-z0-9]{20,250}\b/g
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----/g
const CONNECTION_STRING =
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|rediss|amqp|amqps|mssql):\/\/([^\s:/@]+):([^\s@/]{3,})@([^\s"'<>)]+)/gi

const CREDENTIAL_KEY = '(?:password|passwd|pwd|secret|api[ _-]?key|apikey|access[ _-]?token|auth[ _-]?token|client[ _-]?secret)'
const CREDENTIAL_KEY_RE = new RegExp(`\\b${CREDENTIAL_KEY}\\b`, 'i')

// A key may sit inside a longer identifier (LEDGER_API_KEY, db_password, clientSecret,
// SECRET_KEY_BASE), so boundaries cannot be word boundaries. The identifier is captured
// whole and checked below: it must contain a credential key word and must not be a
// label-like name (password_field_label, PASSWORD_MIN_LENGTH, secret_santa, header names).
const QUOTED_ASSIGNMENT =
  new RegExp(`(?:^|[^A-Za-z0-9_$])(["']?)([A-Za-z_$][A-Za-z0-9_$]*)(["']?)[ \\t]*[:=][= \\t]*(["'])([^"'\\n]{8,})\\4`, 'gi')
// `NAME: Type = "value"` — typed declarations put a type between the credential name and the
// operator, so the identifier cannot sit next to it. Same guards apply. The `&*'` in the type's
// first character class is not decoration: without it Rust's `&str` opens the type with `&` and
// the whole match silently fails, while Kotlin, Swift, Scala and Python annotations still pass.
const TYPED_ASSIGNMENT =
  new RegExp(`(?:^|[^A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)[ \\t]*:[ \\t]*[A-Za-z0-9_&*'][A-Za-z0-9_&*'.<>,?\\[\\] ]{0,40}?[ \\t]*=[ \\t]*(["'])([^"'\\n]{8,})\\2`, 'gi')
// `'key' => 'value'` — PHP and Ruby association syntax. The key quotes are required, not
// optional: that is what keeps JS/TS arrow bodies (`apiKey => "…"`) out of a Critical rule. The two
// quote groups are passed to insideStringContext exactly as QUOTED_ASSIGNMENT does, so a quoted key is
// treated as data, not as prose.
const MAPPING_ASSIGNMENT =
  new RegExp(`(?:^|[^A-Za-z0-9_$])(["'])([A-Za-z_$][A-Za-z0-9_$]*)(["'])[ \\t]*=>[ \\t]*(["'])([^"'\\n]{8,})\\4`, 'gi')
const ENV_ASSIGNMENT =
  new RegExp(`^[ \\t]*(?:(?:export|ENV|ARG)[ \\t]+)?([A-Za-z_$][A-Za-z0-9_$.]*)[ \\t]*=[ \\t]*([A-Za-z0-9_./+=:@-]{12,})[ \\t]*$`, 'gim')

// Segments that turn a credential-shaped name into a label, a limit, a fixture name or a location.
const NON_CREDENTIAL_SEGMENTS = new Set([
  'field', 'label', 'header', 'name', 'santa', 'length', 'min', 'max', 'test',
  'demo', 'example', 'sample', 'dummy', 'placeholder', 'default', 'schema',
  'pattern', 'format', 'prefix', 'suffix', 'expected', 'file', 'path',
])

function identifierSegments(name: string): string[] {
  return name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((part) => part.toLowerCase())
    .filter(Boolean)
}

function isCredentialIdentifier(name: string): boolean {
  const segments = identifierSegments(name)
  // Word boundaries treat '_' as a word character, so LEDGER_API_KEY needs the
  // segment-joined view; camelCase names like apiKey need the raw view.
  if (!CREDENTIAL_KEY_RE.test(name) && !CREDENTIAL_KEY_RE.test(segments.join(' '))) return false
  return !segments.some((segment) => NON_CREDENTIAL_SEGMENTS.has(segment))
}

// A match that sits inside a string literal or template literal is prose, not an
// assignment. JSON-style keys ("api_key": "value") are the one quoted shape allowed.
function insideStringContext(text: string, identifierAt: number, quoteBefore: string, quoteAfter: string): boolean {
  if (quoteBefore && quoteAfter) return false
  const lineStart = text.lastIndexOf('\n', identifierAt - 1) + 1
  const prefix = text.slice(lineStart, identifierAt)
  const quoteCount = (prefix.match(/["']/g) ?? []).length + (quoteBefore ? 1 : 0)
  const backtickCount = (prefix.match(/`/g) ?? []).length
  return quoteCount % 2 === 1 || backtickCount % 2 === 1
}

function isConfigLike(file: RuleFile): boolean {
  return (
    file.language === 'text' ||
    file.language === 'yaml' ||
    file.language === 'toml' ||
    file.language === 'unknown' ||
    /(?:^|\/)\.env(?:\.|$)/i.test(file.file) ||
    /\.(?:env|ini|conf|cfg)$/i.test(file.file)
  )
}

function decodeBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return atob(padded)
  } catch {
    return null
  }
}

function looksLikeJwt(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3 || token.length < 60) return false
  const headerText = decodeBase64Url(parts[0])
  const payloadText = decodeBase64Url(parts[1])
  if (!headerText || !payloadText) return false
  try {
    const header = JSON.parse(headerText) as { alg?: unknown; typ?: unknown }
    const payload = JSON.parse(payloadText) as unknown
    return typeof header.alg === 'string' && typeof payload === 'object' && payload !== null
  } catch {
    return false
  }
}

function lineIndexOf(file: RuleFile, offset: number): number {
  return file.lineStarts.findIndex(
    (start, i) => start <= offset && (i === file.lineStarts.length - 1 || file.lineStarts[i + 1] > offset),
  )
}

function scanLiteral(file: RuleFile, pattern: RegExp, details: (value: string) => MatchDetails | null): RuleHit[] {
  const hits: RuleHit[] = []
  pattern.lastIndex = 0
  for (const match of file.text.matchAll(pattern)) {
    if (hits.length >= MAX_RULE_HITS) break
    const value = match[0]
    if (isPlaceholderValue(value)) continue
    const built = details(value)
    if (!built) continue
    hits.push(hit(file, match.index ?? 0, value.length, built))
  }
  return hits
}

const awsRule: AnalyzerRule = {
  id: 'bugpilot/secret/aws-access-key',
  title: 'Possible AWS access key',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds the prefix and length combination AWS uses for access key ids.',
  check: (file) =>
    scanLiteral(file, AWS_ACCESS_KEY, (value) => ({
      message: 'Possible AWS access key id.',
      explanation:
        'The value matches the shape of an AWS access key id. An access key id alone does not grant access, but it identifies the account and is normally paired with a secret key that does.',
      confidence: vendorConfidence('AWS'),
      quote: redactSecret(value),
    })),
}

const githubRule: AnalyzerRule = {
  id: 'bugpilot/secret/github-token',
  title: 'Possible GitHub token',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds GitHub personal access, OAuth, user, server and refresh tokens.',
  check: (file) =>
    scanLiteral(file, GITHUB_TOKEN, (value) => ({
      message: 'Possible GitHub token.',
      explanation:
        'The value matches a GitHub token prefix. Tokens can act with the scopes of the account or app that created them, so a leaked token may read or change repositories.',
      confidence: vendorConfidence('GitHub'),
      quote: redactSecret(value),
    })),
}

const slackRule: AnalyzerRule = {
  id: 'bugpilot/secret/slack-token',
  title: 'Possible Slack token',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds Slack bot, app, user, workspace and refresh token prefixes.',
  check: (file) =>
    scanLiteral(file, SLACK_TOKEN, (value) => ({
      message: 'Possible Slack token.',
      explanation:
        'The value matches a Slack token prefix. A leaked bot or user token can read messages and post to workspaces the app was installed in.',
      confidence: vendorConfidence('Slack'),
      quote: redactSecret(value),
    })),
}

const stripeRule: AnalyzerRule = {
  id: 'bugpilot/secret/stripe-live-key',
  title: 'Possible Stripe live key',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds Stripe secret or restricted keys marked live.',
  check: (file) =>
    scanLiteral(file, STRIPE_LIVE_KEY, (value) => ({
      message: 'Possible Stripe live secret key.',
      explanation:
        'The value matches a Stripe live-mode secret or restricted key. Such a key can move real money or read customer data in the live account.',
      confidence: vendorConfidence('Stripe'),
      quote: redactSecret(value),
    })),
}

const privateKeyRule: AnalyzerRule = {
  id: 'bugpilot/secret/private-key-block',
  title: 'Private key block',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds PEM private-key headers, including OpenSSH, RSA and EC keys.',
  check: (file) => {
    const hits: RuleHit[] = []
    PRIVATE_KEY_HEADER.lastIndex = 0
    for (const match of file.text.matchAll(PRIVATE_KEY_HEADER)) {
      if (hits.length >= MAX_RULE_HITS) break
      const value = match[0]
      const index = match.index ?? 0
      hits.push({
        ...hit(file, index, value.length, {
          message: 'Private key block in this file.',
          explanation:
            'The file contains the header of a PEM private key. A private key authenticates its holder, so it must never be committed to source control.',
          confidence: {
            level: 'high',
            reason: 'The header text is a fixed PEM marker; a key body normally follows it.',
          },
          quote: quoteLine(value),
        }),
      })
    }
    return hits
  },
}

const jwtRule: AnalyzerRule = {
  id: 'bugpilot/secret/jwt',
  title: 'Possible JSON Web Token',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds three-part JWT-shaped values whose header and payload decode as JSON.',
  check: (file) =>
    scanLiteral(file, JWT_TOKEN, (value) => {
      if (!looksLikeJwt(value)) return null
      return {
        message: 'Possible hard-coded JSON Web Token.',
        explanation:
          'The value is a JWT with a decodable header and payload. A JWT pasted into source usually carries a live session or service credential.',
        confidence: {
          level: 'medium',
          reason: 'The token shape and both decoded JSON segments match a JWT, but BugPilot cannot tell whether it is still valid.',
        },
        quote: redactSecret(value),
      }
    }),
}

const connectionStringRule: AnalyzerRule = {
  id: 'bugpilot/secret/connection-string',
  title: 'Connection string with a password',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description: 'Finds database and message-broker URLs that embed a password.',
  check: (file) => {
    const hits: RuleHit[] = []
    CONNECTION_STRING.lastIndex = 0
    for (const match of file.text.matchAll(CONNECTION_STRING)) {
      if (hits.length >= MAX_RULE_HITS) break
      const full = match[0]
      const password = match[2]
      if (isPlaceholderValue(password)) continue
      const index = match.index ?? 0
      const passwordAt = full.indexOf(`:${password}@`)
      const redacted =
        passwordAt === -1
          ? redactSecret(full)
          : `${full.slice(0, passwordAt + 1)}${redactSecret(password)}${full.slice(passwordAt + 1 + password.length)}`
      const lineIndex = lineIndexOf(file, index)
      hits.push({
        range: rangeFromOffsets(file.lineStarts, index, index + full.length),
        message: 'Connection string contains an embedded password.',
        explanation:
          'The URL carries a username and password before the host. Connection strings in source are copied into logs, tickets and backups far more often than secrets in a vault.',
        confidence: {
          level: 'high',
          reason: 'The URL scheme is a database or broker scheme and the user-info section contains a literal password.',
        },
        evidence: [lineEvidence(file, lineIndex, quoteLine(redacted))],
        fix: manualFix(
          'Move the password into an environment variable or secret manager and build the connection string at run time.',
          'The connection string. The host and user name can stay; the password cannot.',
          'manual-only',
          'Changing a connection string can change which database the app reaches, so the owner must apply it deliberately.',
        ),
        verificationSteps: SECRET_VERIFICATION,
        limitations: SECRET_LIMITATIONS,
      })
    }
    return hits
  },
}

const assignmentRule: AnalyzerRule = {
  id: 'bugpilot/secret/credential-assignment',
  title: 'Hard-coded credential assignment',
  tier: 'pattern',
  severity: 'Critical',
  languages: ALL_TEXT_LANGUAGES,
  description:
    'Finds password, secret, token and API-key assignments whose value is a literal string, including typed declarations (`KEY: String = "…"`) and Dockerfile `ENV`/`ARG` lines and PHP/Ruby `=>` associations with a quoted key. A name ending in a location word such as `_FILE` or `_PATH` is treated as a location, not a secret.',
  check: (file) => {
    const hits: RuleHit[] = []

    QUOTED_ASSIGNMENT.lastIndex = 0
    for (const match of file.text.matchAll(QUOTED_ASSIGNMENT)) {
      if (hits.length >= MAX_RULE_HITS) break
      const name = match[2]
      const value = match[5]
      if (value.length < 8 || isPlaceholderValue(value)) continue
      if (!isCredentialIdentifier(name)) continue
      const full = match[0]
      const identifierAt = (match.index ?? 0) + full.indexOf(name)
      if (insideStringContext(file.text, identifierAt, match[1], match[3])) continue
      const entropy = shannonEntropy(value)
      if (entropy < 3) continue
      const index = identifierAt
      const valueAt = full.lastIndexOf(value)
      const redacted = `${full.slice(0, valueAt)}${redactSecret(value)}${full.slice(valueAt + value.length)}`
      const lineIndex = lineIndexOf(file, index)
      hits.push({
        range: rangeFromOffsets(file.lineStarts, index, index + full.length - full.indexOf(name)),
        message: 'A credential-like name is assigned a literal value.',
        explanation:
          'The assignment gives a password, secret, token or API key a quoted literal value. Values like this end up in source control, screenshots and build logs. A lookup such as an environment variable or a vault read is not reported.',
        confidence: {
          level: entropy >= 3.5 && value.length >= 16 ? 'high' : 'medium',
          reason: `The literal is ${value.length} characters with ${entropy.toFixed(1)} bits of entropy per character and is not a known placeholder.`,
        },
        evidence: [lineEvidence(file, lineIndex, quoteLine(redacted))],
        fix: manualFix(
          'Replace the literal with an environment lookup or a secret-manager read, then rotate the value.',
          'The assignment on this line. Renaming the key is not enough; the value must stop being tracked.',
          'manual-only',
          'BugPilot cannot know whether the value is still valid or where it is deployed, so it never edits it.',
        ),
        verificationSteps: SECRET_VERIFICATION,
        limitations: SECRET_LIMITATIONS,
      })
    }

    // Twin of the QUOTED_ASSIGNMENT loop: same four guards, same order, same inline hit
    // literal, so a typed hit is indistinguishable from a quoted one except in the line it
    // quotes. `insideStringContext` receives two empty quotes because the typed form is
    // always an unquoted identifier — passing `match[1]`/`match[3]` here (which are the
    // name and the secret, not the two quote characters) would flip the guard's early
    // return and silently disable prose detection.
    TYPED_ASSIGNMENT.lastIndex = 0
    for (const match of file.text.matchAll(TYPED_ASSIGNMENT)) {
      if (hits.length >= MAX_RULE_HITS) break
      const name = match[1]
      const value = match[3]
      if (value.length < 8 || isPlaceholderValue(value)) continue
      if (!isCredentialIdentifier(name)) continue
      const full = match[0]
      const identifierAt = (match.index ?? 0) + full.indexOf(name)
      if (insideStringContext(file.text, identifierAt, '', '')) continue
      const entropy = shannonEntropy(value)
      if (entropy < 3) continue
      const index = identifierAt
      const valueAt = full.lastIndexOf(value)
      const redacted = `${full.slice(0, valueAt)}${redactSecret(value)}${full.slice(valueAt + value.length)}`
      const lineIndex = lineIndexOf(file, index)
      hits.push({
        range: rangeFromOffsets(file.lineStarts, index, index + full.length - full.indexOf(name)),
        message: 'A credential-like name is assigned a literal value.',
        explanation:
          'The assignment gives a password, secret, token or API key a quoted literal value. Values like this end up in source control, screenshots and build logs. A lookup such as an environment variable or a vault read is not reported.',
        confidence: {
          level: entropy >= 3.5 && value.length >= 16 ? 'high' : 'medium',
          reason: `The literal is ${value.length} characters with ${entropy.toFixed(1)} bits of entropy per character and is not a known placeholder.`,
        },
        evidence: [lineEvidence(file, lineIndex, quoteLine(redacted))],
        fix: manualFix(
          'Replace the literal with an environment lookup or a secret-manager read, then rotate the value.',
          'The assignment on this line. Renaming the key is not enough; the value must stop being tracked.',
          'manual-only',
          'BugPilot cannot know whether the value is still valid or where it is deployed, so it never edits it.',
        ),
        verificationSteps: SECRET_VERIFICATION,
        limitations: SECRET_LIMITATIONS,
      })
    }

    // Twin of the QUOTED_ASSIGNMENT loop for PHP/Ruby `=>` associations. Same four guards,
    // same order, same inline hit literal, so a mapping hit is indistinguishable from a
    // quoted hit except in the line it quotes. Group numbering trap: in this regex the
    // groups are open-quote / name / close-quote / value-quote / value, so `match[2]` is
    // the identifier and `match[5]` is the secret. Copying `match[1]`/`match[3]` from the
    // typed loop (where they are the identifier and the secret) would instead pass the two
    // key-quote characters. `insideStringContext` here receives the real two quotes, exactly
    // as the QUOTED_ASSIGNMENT loop does, so a quoted key is treated as data.
    MAPPING_ASSIGNMENT.lastIndex = 0
    for (const match of file.text.matchAll(MAPPING_ASSIGNMENT)) {
      if (hits.length >= MAX_RULE_HITS) break
      const name = match[2]
      const value = match[5]
      if (value.length < 8 || isPlaceholderValue(value)) continue
      if (!isCredentialIdentifier(name)) continue
      const full = match[0]
      const identifierAt = (match.index ?? 0) + full.indexOf(name)
      if (insideStringContext(file.text, identifierAt, match[1], match[3])) continue
      const entropy = shannonEntropy(value)
      if (entropy < 3) continue
      const index = identifierAt
      const valueAt = full.lastIndexOf(value)
      const redacted = `${full.slice(0, valueAt)}${redactSecret(value)}${full.slice(valueAt + value.length)}`
      const lineIndex = lineIndexOf(file, index)
      hits.push({
        range: rangeFromOffsets(file.lineStarts, index, index + full.length - full.indexOf(name)),
        message: 'A credential-like name is assigned a literal value.',
        explanation:
          'The assignment gives a password, secret, token or API key a quoted literal value. Values like this end up in source control, screenshots and build logs. A lookup such as an environment variable or a vault read is not reported.',
        confidence: {
          level: entropy >= 3.5 && value.length >= 16 ? 'high' : 'medium',
          reason: `The literal is ${value.length} characters with ${entropy.toFixed(1)} bits of entropy per character and is not a known placeholder.`,
        },
        evidence: [lineEvidence(file, lineIndex, quoteLine(redacted))],
        fix: manualFix(
          'Replace the literal with an environment lookup or a secret-manager read, then rotate the value.',
          'The assignment on this line. Renaming the key is not enough; the value must stop being tracked.',
          'manual-only',
          'BugPilot cannot know whether the value is still valid or where it is deployed, so it never edits it.',
        ),
        verificationSteps: SECRET_VERIFICATION,
        limitations: SECRET_LIMITATIONS,
      })
    }

    if (isConfigLike(file)) {
      ENV_ASSIGNMENT.lastIndex = 0
      for (const match of file.text.matchAll(ENV_ASSIGNMENT)) {
        if (hits.length >= MAX_RULE_HITS) break
        const name = match[1]
        const value = match[2]
        if (value.length < 12 || isPlaceholderValue(value)) continue
        if (!isCredentialIdentifier(name)) continue
        const entropy = shannonEntropy(value)
        if (entropy < 3.2) continue
        const full = match[0]
        const index = (match.index ?? 0) + full.indexOf(name)
        const valueAt = full.lastIndexOf(value)
        const redacted = `${full.slice(0, valueAt)}${redactSecret(value)}${full.slice(valueAt + value.length)}`
        const lineIndex = lineIndexOf(file, index)
        hits.push({
          range: rangeFromOffsets(file.lineStarts, index, index + full.length - full.indexOf(name)),
          message: 'A config value with a credential-like name is a literal secret.',
          explanation:
            'A .env-style line assigns a long literal to a password, secret, token or API key. Environment files are frequently committed by accident.',
          confidence: {
            level: 'medium',
            reason: `The unquoted literal is ${value.length} characters with ${entropy.toFixed(1)} bits of entropy per character.`,
          },
          evidence: [lineEvidence(file, lineIndex, quoteLine(redacted))],
          fix: manualFix(
            'Keep the value out of version control, load it from the deployment environment, and rotate it.',
            'The environment or config line that holds the value.',
            'manual-only',
            'The file may be a local-only override; only the owner knows whether it is deployed.',
          ),
          verificationSteps: SECRET_VERIFICATION,
          limitations: SECRET_LIMITATIONS,
        })
      }
    }

    return hits
  },
}

export const secretRules: readonly AnalyzerRule[] = [
  awsRule,
  githubRule,
  slackRule,
  stripeRule,
  privateKeyRule,
  jwtRule,
  connectionStringRule,
  assignmentRule,
]
