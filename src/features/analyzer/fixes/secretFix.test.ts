import { describe, expect, it } from 'vitest'
import type { ArchiveEntry } from '../archive/guard'
import { detectLanguage } from '../archive/classify'
import { analyzeEntries } from '../analysis/engine'
import { redactSecret } from '../rules/context'
import type { AnalyzerFinding } from '../types'
import { ROTATE_CREDENTIAL_WARNING } from './envLookup'
import { proposeFix } from './proposeFix'
import { applyEdits } from './text'

// Every credential-shaped value is assembled at run time from fragments so no test file
// contains a literal that a secret scanner could report.
const FAKE = ['Zq9', 'vT4k', 'Wm8p', 'Rc2s', 'Ld7N'].join('')
const FAKE_AWS = ['AK', 'IA', 'Q7W2', 'E4R6', 'T8Y0', 'U2I4'].join('')
const FAKE_GITHUB = ['gh', 'p_', 'K7mN2pQ9rS4tV6wX8yZ1', 'aB3cD5eF7gH9jK2mN4pQ6'].join('')
const FAKE_SLACK = ['xox', 'b-', '7Kq2', 'Lm9', 'Rt4', 'Wz8Lp'].join('')
const FAKE_STRIPE = ['sk', '_live_', '9Qm2Kp7Rt4Wz8Ln6Vb3Xc5'].join('')
const FAKE_PASSWORD = ['Hq7', 'Lm2', 'Vt9', 'Wz4', 'Rc8'].join('')

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

const FAKE_JWT = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ sub: 'user-1', iat: 1_700_000_000 }),
  'c'.repeat(24),
].join('.')

const FAKE_PRIVATE_KEY = [
  ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
  ['MIIE', 'owIBAAKCAQEA'].join(''),
  ['-----END', 'RSA PRIVATE KEY-----'].join(' '),
].join('\\n')

const CREDENTIAL_RULE = 'bugpilot/secret/credential-assignment'

function entry(name: string, text: string): ArchiveEntry {
  const detection = detectLanguage(name, text)
  return {
    name,
    text,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    bytes: text.length,
  }
}

function findingsOf(source: ArchiveEntry): AnalyzerFinding[] {
  return analyzeEntries([source]).files[0].findings
}

function findingFor(source: ArchiveEntry, ruleId: string): AnalyzerFinding {
  const finding = findingsOf(source).find((item) => item.ruleId === ruleId)
  if (!finding) throw new Error(`No ${ruleId} finding in ${source.name}`)
  return finding
}

interface LanguageCase {
  name: string
  text: string
  expression: string
  importCheck?: (fixed: string) => void
}

const LANGUAGE_CASES: LanguageCase[] = [
  {
    name: 'src/app.js',
    text: `const apiKey = "${FAKE}"\n`,
    expression: 'process.env.API_KEY',
  },
  {
    name: 'src/app.ts',
    text: `const apiKey = "${FAKE}"\n`,
    expression: 'process.env.API_KEY',
  },
  {
    name: 'app.py',
    text: `api_key = "${FAKE}"\n`,
    expression: 'os.environ["API_KEY"]',
    importCheck: (fixed) => expect(fixed.startsWith('import os\n')).toBe(true),
  },
  {
    name: 'app_with_import.py',
    text: `import os\n\napi_key = "${FAKE}"\n`,
    expression: 'os.environ["API_KEY"]',
    importCheck: (fixed) => expect(fixed.match(/^import os$/gm)).toHaveLength(1),
  },
  {
    name: 'app.rb',
    text: `api_key = "${FAKE}"\n`,
    expression: 'ENV["API_KEY"]',
  },
  {
    name: 'app.php',
    text: `<?php\n$api_key = "${FAKE}";\n`,
    expression: "getenv('API_KEY')",
  },
  {
    name: 'App.java',
    text: `class App {\n  String apiKey = "${FAKE}";\n}\n`,
    expression: 'System.getenv("API_KEY")',
  },
  {
    name: 'App.cs',
    text: `class App {\n  string apiKey = "${FAKE}";\n}\n`,
    expression: 'Environment.GetEnvironmentVariable("API_KEY")',
  },
  {
    name: 'main.go',
    text: `package main\n\nfunc main() {\n\tvar apiKey = "${FAKE}"\n}\n`,
    expression: 'os.Getenv("API_KEY")',
    importCheck: (fixed) => expect(fixed).toContain('import "os"'),
  },
  {
    name: 'main_with_import.go',
    text: `package main\n\nimport (\n\t"fmt"\n)\n\nfunc main() {\n\tvar apiKey = "${FAKE}"\n\tfmt.Println(apiKey)\n}\n`,
    expression: 'os.Getenv("API_KEY")',
    importCheck: (fixed) => expect(fixed.match(/"os"/g)).toHaveLength(1),
  },
  {
    name: 'run.sh',
    text: `apiKey="${FAKE}"\n`,
    expression: '"$API_KEY"',
  },
]

describe('secret fix proposals', () => {
  for (const item of LANGUAGE_CASES) {
    it(`replaces a literal with an environment lookup in ${item.name}`, () => {
      const source = entry(item.name, item.text)
      const finding = findingFor(source, CREDENTIAL_RULE)
      const candidate = proposeFix(finding, source)

      expect(candidate).not.toBeNull()
      expect(candidate?.riskClass).toBe('needs-review')
      expect(candidate?.behaviourChange).toBe(true)
      expect(candidate?.warnings).toContain(ROTATE_CREDENTIAL_WARNING)

      const fixed = applyEdits(source.text, candidate?.edits ?? [])
      expect(fixed).toContain(item.expression)
      expect(fixed).not.toContain(FAKE)
      item.importCheck?.(fixed)

      const remaining = findingsOf(entry(item.name, fixed)).filter((hit) => hit.ruleId === CREDENTIAL_RULE)
      expect(remaining).toHaveLength(0)
    })
  }

  it('names the environment variable after the assignment, never after the value', () => {
    const source = entry('src/app.js', `const clientSecret = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    expect(proposeFix(finding, source)?.edits[0].newText).toBe('process.env.CLIENT_SECRET')
  })

  it('keeps config files manual-only', () => {
    const source = entry('.env', `API_KEY=${FAKE}\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    expect(proposeFix(finding, source)).toBeNull()
  })

  it('keeps languages without an environment lookup manual-only', () => {
    const source = entry('src/App.kt', `val apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    expect(proposeFix(finding, source)).toBeNull()
  })

  it('refuses a shell self-reference', () => {
    const source = entry('run.sh', `API_KEY="${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    expect(proposeFix(finding, source)).toBeNull()
  })

  it('refuses a Go file with no package line to anchor the import', () => {
    const source = entry('main.go', `var apiKey = "${FAKE}"\n`)
    const finding = findingFor(source, CREDENTIAL_RULE)
    expect(proposeFix(finding, source)).toBeNull()
  })

  it('does not propose anything for an existing lookup or a placeholder', () => {
    const lookup = entry('src/app.js', 'const apiKey = process.env.API_KEY\n')
    expect(findingsOf(lookup)).toHaveLength(0)
    const placeholder = entry('src/app.js', 'const apiKey = "change-me-now"\n')
    expect(findingsOf(placeholder).filter((hit) => hit.ruleId === CREDENTIAL_RULE)).toHaveLength(0)
  })
})

describe('vendor secret shapes', () => {
  const vendorCases = [
    { ruleId: 'bugpilot/secret/aws-access-key', token: FAKE_AWS },
    { ruleId: 'bugpilot/secret/github-token', token: FAKE_GITHUB },
    { ruleId: 'bugpilot/secret/slack-token', token: FAKE_SLACK },
    { ruleId: 'bugpilot/secret/stripe-live-key', token: FAKE_STRIPE },
  ]

  for (const item of vendorCases) {
    it(`replaces ${item.ruleId} with an environment lookup and masks the value`, () => {
      const source = entry('src/config.js', `const apiKey = "${item.token}"\n`)
      const finding = findingFor(source, item.ruleId)
      const candidate = proposeFix(finding, source)

      expect(candidate?.edits[0].newText).toBe('process.env.API_KEY')
      expect(candidate?.warnings).toContain(ROTATE_CREDENTIAL_WARNING)
      const masked = candidate?.maskedSpans[0]
      expect(masked).toBeDefined()
      expect(source.text.slice(masked?.startOffset, masked?.endOffset)).toBe(item.token)
      expect(masked?.maskedText).not.toBe(item.token)

      const fixed = applyEdits(source.text, candidate?.edits ?? [])
      expect(findingsOf(entry('src/config.js', fixed)).filter((hit) => hit.ruleId === item.ruleId)).toHaveLength(0)
    })
  }

  it('replaces a one-line private-key literal', () => {
    const source = entry('src/key.js', `const apiKey = "${FAKE_PRIVATE_KEY}"\n`)
    const finding = findingFor(source, 'bugpilot/secret/private-key-block')
    const candidate = proposeFix(finding, source)
    expect(candidate?.warnings).toContain(ROTATE_CREDENTIAL_WARNING)
    const fixed = applyEdits(source.text, candidate?.edits ?? [])
    expect(fixed).toContain('process.env.API_KEY')
    expect(fixed).not.toContain('BEGIN RSA')
  })

  it('replaces a JWT assigned to a variable', () => {
    const source = entry('src/token.js', `const signedToken = "${FAKE_JWT}"\n`)
    const finding = findingFor(source, 'bugpilot/secret/jwt')
    const candidate = proposeFix(finding, source)
    expect(candidate?.edits[0].newText).toBe('process.env.SIGNED_TOKEN')
    expect(candidate?.warnings).toContain(ROTATE_CREDENTIAL_WARNING)
  })

  it('keeps a JWT with no assignment manual-only', () => {
    const source = entry('src/log.js', `log("${FAKE_JWT}")\n`)
    const finding = findingFor(source, 'bugpilot/secret/jwt')
    expect(proposeFix(finding, source)).toBeNull()
  })

  it('replaces a connection string and masks only the password', () => {
    const url = `postgres://app_user:${FAKE_PASSWORD}@db.internal:5432/app`
    const source = entry('src/db.js', `const databaseUrl = "${url}"\n`)
    const finding = findingFor(source, 'bugpilot/secret/connection-string')
    const candidate = proposeFix(finding, source)

    expect(candidate?.edits[0].newText).toBe('process.env.DATABASE_URL')
    const masked = candidate?.maskedSpans[0]
    expect(source.text.slice(masked?.startOffset, masked?.endOffset)).toBe(FAKE_PASSWORD)
    expect(masked?.maskedText).toBe(redactSecret(FAKE_PASSWORD))
    expect(JSON.stringify(candidate?.maskedSpans)).not.toContain(FAKE_PASSWORD)
  })

  it('does not fire on a connection string split by concatenation', () => {
    const source = entry(
      'src/db.js',
      `const url = "postgres://app_user:" + "${FAKE_PASSWORD}" + "@db.internal/app"\n`,
    )
    expect(findingsOf(source).filter((hit) => hit.ruleId === 'bugpilot/secret/connection-string')).toHaveLength(0)
  })
})

describe('idempotence', () => {
  it('proposes nothing again once the fixed text has been analysed', () => {
    const source = entry('src/config.js', `const apiKey = "${FAKE_AWS}"\n`)
    const finding = findingFor(source, 'bugpilot/secret/aws-access-key')
    const candidate = proposeFix(finding, source)
    const fixedEntry = entry(source.name, applyEdits(source.text, candidate?.edits ?? []))
    const after = findingsOf(fixedEntry)
    expect(after.filter((hit) => hit.ruleId === 'bugpilot/secret/aws-access-key')).toHaveLength(0)
    expect(after.flatMap((hit) => (proposeFix(hit, fixedEntry) ? [hit.ruleId] : []))).toHaveLength(0)
  })
})
