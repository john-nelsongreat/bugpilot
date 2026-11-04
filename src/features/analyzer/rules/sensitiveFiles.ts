import type { DiagnosticConfidence } from '../../../diagnostics/types'
import type { Severity } from '../../bugs/types'
import type { AnalyzerFinding } from '../types'
import { makeFinding } from '../analysis/finding'
import { isPlaceholderValue, manualFix } from './context'

/**
 * Files whose name alone marks them as a credential store. The rules run on the name and, for the
 * few cases the brief names, on a marker inside the file. They never quote the file: a report or a
 * screenshot must not become a second copy of the secret. These findings are also produced for
 * files another rule skipped, because a generated folder can still hold a live key.
 */

export interface SensitiveTarget {
  name: string
  /** Null or absent when only the name is known (the file was skipped before it was read). */
  text?: string | null
}

const REVOKE =
  'Removing the file from the project does not revoke credentials that have already been exposed; rotate anything it held.'

const FIX = manualFix(
  'Remove from the repository, add to .gitignore, rotate the credential.',
  'The whole file. Deleting one line from it does not make the committed copy safe.',
  'manual-only',
  'Deleting the file does not revoke a credential that was already copied elsewhere; only rotation does.',
)

const VERIFICATION = [
  'Check the provider that issued the credential, then rotate or revoke it.',
  'Remove the file from version control and add its name to .gitignore.',
  'Search the repository history so the old value is not recoverable from an earlier commit.',
]

const LIMITATIONS = [
  'BugPilot reports the file name and a rule, not the file contents; nothing from this file is quoted.',
  'A name match is not proof that the value is live, and deleting the file does not make an exposed credential safe.',
]

interface SensitiveMatch {
  ruleId: string
  severity: Severity
  confidence: DiagnosticConfidence
  message: string
  explanation: string
  /** 1-based line of the marker, when one inside the file was read. */
  line?: number
}

export const SENSITIVE_RULE_IDS = [
  'bugpilot/sensitive/env-file',
  'bugpilot/sensitive/private-key-name',
  'bugpilot/sensitive/key-file',
  'bugpilot/sensitive/keystore',
  'bugpilot/sensitive/terraform-state',
  'bugpilot/sensitive/credential-file',
  'bugpilot/sensitive/credentials-file',
  'bugpilot/sensitive/aws-credentials',
  'bugpilot/sensitive/npmrc',
  'bugpilot/sensitive/pypirc',
  'bugpilot/sensitive/wp-config',
] as const

export function isSensitiveRuleId(ruleId: string): boolean {
  return (SENSITIVE_RULE_IDS as readonly string[]).includes(ruleId)
}

function basename(name: string): string {
  const parts = name.split('/')
  return (parts[parts.length - 1] ?? name).toLowerCase()
}

function extensionOf(name: string): string {
  const base = basename(name)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let at = 0; at < index && at < text.length; at += 1) {
    if (text.charCodeAt(at) === 10) line += 1
  }
  return line
}

const ENV_EXCEPTIONS = new Set(['.env.example', '.env.sample', '.env.template'])
const KEYSTORE_EXTENSIONS = new Set(['p12', 'pfx', 'jks', 'keystore', 'kdbx'])
const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/
const PRIVATE_KEY_IN_JSON = /["']?private_key["']?\s*:/i
const NPM_SECRET = /^[ \t]*(?:\/\/[^\n=]*:)?(?:_authToken|_auth|password|token)[ \t]*=[ \t]*(\S[^\n]*)$/im
const PYPI_SECRET = /^[ \t]*(?:password|token|api_token)[ \t]*=[ \t]*(\S[^\n]*)$/im
const WP_LITERAL =
  /define\s*\(\s*['"](?:DB_PASSWORD|AUTH_KEY|SECURE_AUTH_KEY|LOGGED_IN_KEY|NONCE_KEY|SECURE_AUTH_SALT|LOGGED_IN_SALT|NONCE_SALT)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i

function usableSecret(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && !isPlaceholderValue(trimmed) && !/put your unique phrase here/i.test(trimmed)
}

function nameMatch(name: string, text: string | null): SensitiveMatch | null {
  const base = basename(name)
  const extension = extensionOf(name)
  const segments = name.toLowerCase().split('/')

  if ((base === '.env' || base.startsWith('.env.')) && !ENV_EXCEPTIONS.has(base)) {
    return {
      ruleId: 'bugpilot/sensitive/env-file',
      severity: 'High',
      confidence: {
        level: 'high',
        reason: 'The file name is a dotenv name, which is where environment secrets are normally kept.',
      },
      message: 'Environment file in this upload.',
      explanation:
        'Dotenv files hold environment variables, often including database passwords, API keys and tokens. Committing one publishes every value in it.',
    }
  }

  if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(base)) {
    return {
      ruleId: 'bugpilot/sensitive/private-key-name',
      severity: 'Critical',
      confidence: {
        level: 'medium',
        reason: 'The name is the conventional private half of an SSH key pair; a .pub suffix would be the public half.',
      },
      message: 'SSH private key file by name.',
      explanation:
        'A file named id_rsa (or the DSA, ECDSA or Ed25519 equivalent) is the conventional location for an SSH private key. A private key authenticates its holder and must never be committed.',
    }
  }

  if (extension === 'pem' || extension === 'key') {
    const header = text === null ? null : PRIVATE_KEY_HEADER.exec(text)
    if (header) {
      return {
        ruleId: 'bugpilot/sensitive/key-file',
        severity: 'Critical',
        confidence: {
          level: 'high',
          reason: 'The file contains a fixed PEM private-key header; a key body normally follows it.',
        },
        message: 'Private key block in a key file.',
        explanation:
          'The file carries .pem or .key in its name and contains the header of a PEM private key. A private key authenticates its holder and must never be committed.',
        line: lineAt(text ?? '', header.index),
      }
    }
    return {
      ruleId: 'bugpilot/sensitive/key-file',
      severity: 'High',
      confidence: {
        level: 'medium',
        reason: 'The extension commonly holds a private key or certificate material, but BugPilot did not need to read the contents.',
      },
      message: 'Key file by name.',
      explanation:
        'The file name ends in .pem or .key, which commonly holds a private key or certificate material. BugPilot did not quote the contents.',
    }
  }

  if (KEYSTORE_EXTENSIONS.has(extension)) {
    return {
      ruleId: 'bugpilot/sensitive/keystore',
      severity: 'High',
      confidence: {
        level: 'medium',
        reason: 'The extension belongs to a keystore or password-database format; its contents are not read.',
      },
      message: 'Keystore or password database by name.',
      explanation:
        'PKCS#12, PFX, JKS, keystore and KDBX files bundle private keys, certificates or passwords. The file is reported by name only and its contents are never printed.',
    }
  }

  if (base === 'terraform.tfstate' || base.endsWith('.tfstate.backup')) {
    return {
      ruleId: 'bugpilot/sensitive/terraform-state',
      severity: 'High',
      confidence: {
        level: 'high',
        reason: 'The name is the default Terraform state or its backup, which records resource attributes including sensitive values.',
      },
      message: 'Terraform state file by name.',
      explanation:
        'Terraform state records resource attributes, including values marked sensitive, such as passwords, connection strings and keys. State belongs in a protected backend, not in source control.',
    }
  }

  if (base === '.git-credentials' || base === '.netrc' || base === '.htpasswd') {
    return {
      ruleId: 'bugpilot/sensitive/credential-file',
      severity: 'High',
      confidence: {
        level: 'high',
        reason: 'The name is exactly a credential store used by Git, curl or HTTP basic authentication.',
      },
      message: 'Credential store by name.',
      explanation:
        'This file stores credentials in plain text: .git-credentials for Git, .netrc for curl-style tools, or .htpasswd for HTTP password hashes.',
    }
  }

  if (segments.includes('.aws') && base === 'credentials') {
    return {
      ruleId: 'bugpilot/sensitive/aws-credentials',
      severity: 'High',
      confidence: {
        level: 'high',
        reason: 'The path is the AWS CLI credential file inside a .aws folder.',
      },
      message: 'AWS credential file by name.',
      explanation:
        'The AWS CLI stores access key ids and secret access keys in .aws/credentials. Committing the file publishes both halves of the credential.',
    }
  }

  if (base === 'credentials.json' || /^service-account.*\.json$/.test(base)) {
    const marker = text === null ? null : PRIVATE_KEY_IN_JSON.exec(text)
    if (marker) {
      return {
        ruleId: 'bugpilot/sensitive/credentials-file',
        severity: 'Critical',
        confidence: {
          level: 'high',
          reason: 'The file is a credentials or service-account JSON document and contains a private_key field.',
        },
        message: 'Credentials file contains a private key.',
        explanation:
          'The JSON document holds a private_key entry, which is the shape of a service-account key. Such a key authenticates as the service account and must never be committed.',
        line: lineAt(text ?? '', marker.index),
      }
    }
    return {
      ruleId: 'bugpilot/sensitive/credentials-file',
      severity: 'High',
      confidence: {
        level: 'medium',
        reason: 'The name is a credentials or service-account JSON file; no private_key field was found.',
      },
      message: 'Credentials file by name.',
      explanation:
        'Files called credentials.json or service-account*.json usually hold service-account keys or API credentials. BugPilot scanned for a private_key field and did not quote any value.',
    }
  }

  if (base === '.npmrc' && text !== null) {
    const token = NPM_SECRET.exec(text)
    if (token && usableSecret(token[1] ?? '')) {
      return {
        ruleId: 'bugpilot/sensitive/npmrc',
        severity: 'High',
        confidence: {
          level: 'medium',
          reason: 'The .npmrc file assigns a non-placeholder value to a registry token or password key.',
        },
        message: 'npm registry token or password in .npmrc.',
        explanation:
          'An .npmrc file in an upload assigns a token or password for a package registry. That value can publish packages under the associated account.',
        line: lineAt(text, token.index),
      }
    }
  }

  if (base === '.pypirc' && text !== null) {
    const secret = PYPI_SECRET.exec(text)
    if (secret && usableSecret(secret[1] ?? '')) {
      return {
        ruleId: 'bugpilot/sensitive/pypirc',
        severity: 'High',
        confidence: {
          level: 'medium',
          reason: 'The .pypirc file assigns a non-placeholder value to a password or token key.',
        },
        message: 'Repository password or token in .pypirc.',
        explanation:
          'A .pypirc file in an upload assigns a password or token for a Python package repository. The value can publish packages under the associated account.',
        line: lineAt(text, secret.index),
      }
    }
  }

  if (base === 'wp-config.php' && text !== null) {
    const literal = WP_LITERAL.exec(text)
    if (literal && usableSecret(literal[1] ?? '')) {
      return {
        ruleId: 'bugpilot/sensitive/wp-config',
        severity: 'Critical',
        confidence: {
          level: 'high',
          reason: 'wp-config.php defines a database password or authentication key with a literal value.',
        },
        message: 'WordPress configuration holds a literal credential.',
        explanation:
          'wp-config.php defines the WordPress database password or an authentication key with a literal string. The file is also a map of the site’s database host and user.',
        line: lineAt(text, literal.index),
      }
    }
  }

  return null
}

/**
 * Every sensitive-file finding for one name, with content checks only when the text is available.
 * One file produces at most one sensitive-name finding; ordinary secret rules still run separately
 * on any file that was analysed.
 */
export function sensitiveFindings(target: SensitiveTarget): AnalyzerFinding[] {
  const match = nameMatch(target.name, target.text ?? null)
  if (!match) return []
  const line = match.line ?? 1
  return [
    makeFinding({
      ruleId: match.ruleId,
      analyzer: 'bugpilot-rules',
      tier: 'pattern',
      severity: match.severity,
      confidence: match.confidence,
      file: target.name,
      range: { startLine: line, startColumn: 1, endLine: line, endColumn: 1 },
      evidence: [],
      message: match.message,
      explanation: `${match.explanation} ${REVOKE}`,
      fix: FIX,
      verificationSteps: VERIFICATION,
      limitations: LIMITATIONS,
    }),
  ]
}
