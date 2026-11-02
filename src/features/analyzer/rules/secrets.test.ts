import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../archive/classify'
import { buildLineStarts } from './context'
import { ruleById } from './registry'
import type { RuleFile } from './types'

function makeFile(path: string, text: string): RuleFile {
  const detection = detectLanguage(path, text)
  return {
    file: path,
    language: detection.language,
    languageSource: detection.source,
    encoding: 'utf-8',
    text,
    lines: text.split('\n'),
    lineStarts: buildLineStarts(text),
  }
}

function hits(ruleId: string, path: string, text: string) {
  const rule = ruleById(ruleId)
  if (!rule) throw new Error(`missing rule ${ruleId}`)
  return rule.check(makeFile(path, text))
}

// Every credential-shaped value below is assembled at run time from fragments so no
// fixture file ever contains a literal token for push protection to find.
const fakeAws = ['AKIA', 'Q7R2T9', 'MW4XZ8', 'B3N6'].join('')
const fakeGithub = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')
const fakeSlack = ['xox', 'b-', 'A1B2C3D4E5F6G7H8I9J0'].join('')
const fakeStripe = ['sk', '_live_', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('')
const fakePassword = ['S3cure', 'P4ss'].join('')
const fakeAssignment = ['Zx9Qm2Lp', '7Rt4Vb8N'].join('')

function fakeJwt(): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: '1234567890', name: 'Test User' }),
    ['Q7r2T9mW', '4xZ8b3N6v1Lp'].join(''),
  ].join('.')
}

describe('secret rule: AWS access key', () => {
  const id = 'bugpilot/secret/aws-access-key'

  it('finds a prefix-and-length match with redacted evidence', () => {
    const [hit] = hits(id, 'src/config.js', `const awsId = "${fakeAws}"\n`)

    expect(hit.message).toMatch(/AWS access key/)
    expect(hit.severity ?? 'Critical').toBe('Critical')
    expect(hit.evidence[0].quote).not.toContain(fakeAws)
    expect(hit.evidence[0].quote).toContain('…')
    expect(hit.range.startLine).toBe(1)
  })

  it('does not fire on a lookalike with the wrong alphabet or length', () => {
    expect(hits(id, 'src/config.js', `const awsId = "AKIA${'q7r2t9mw4xz8b3n6'}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/config.js', `const awsId = "AKIA${'Q7R2T9MW4XZ8B3N'}"\n`)).toHaveLength(0)
  })

  it('does not fire on prose about AWS key ids', () => {
    const prose = 'AWS access key ids begin with a fixed prefix followed by sixteen characters.\n'
    expect(hits(id, 'README.md', prose)).toHaveLength(0)
  })

  it('does not fire on the published example value', () => {
    const example = ['AKIA', 'EXAMPLE'.repeat(2), 'CD'].join('')
    expect(example).toHaveLength(20)
    expect(hits(id, 'src/config.js', `const awsId = "${example}"\n`)).toHaveLength(0)
  })
})

describe('secret rule: GitHub token', () => {
  const id = 'bugpilot/secret/github-token'

  it('finds a token-shaped value and redacts it', () => {
    const [hit] = hits(id, 'src/api.js', `const token = "${fakeGithub}"\n`)

    expect(hit.message).toMatch(/GitHub token/)
    expect(hit.evidence[0].quote).not.toContain(fakeGithub)
  })

  it('does not fire on a short or wrong-prefix value', () => {
    expect(hits(id, 'src/api.js', `const token = "ghp_${'A1b2C3d4'}${'E5f6G7h8'}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/api.js', `const token = "ghx_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}"\n`)).toHaveLength(0)
  })

  it('does not fire on prose about GitHub tokens', () => {
    const prose = 'Create a GitHub token with the minimum scopes; never paste it into source.\n'
    expect(hits(id, 'README.md', prose)).toHaveLength(0)
  })
})

describe('secret rule: Slack token', () => {
  const id = 'bugpilot/secret/slack-token'

  it('finds a bot token and redacts it', () => {
    const [hit] = hits(id, 'src/notify.js', `const slack = "${fakeSlack}"\n`)

    expect(hit.message).toMatch(/Slack token/)
    expect(hit.evidence[0].quote).not.toContain(fakeSlack)
  })

  it('does not fire on an unknown workspace prefix or a short value', () => {
    expect(hits(id, 'src/notify.js', `const slack = "xoxz-${'A1B2C3D4E5F6'}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/notify.js', `const slack = "xoxb-${'A1B2'}"\n`)).toHaveLength(0)
  })

  it('does not fire on prose about Slack tokens', () => {
    expect(hits(id, 'README.md', 'Slack tokens are installed per workspace and can post messages.\n')).toHaveLength(0)
  })
})

describe('secret rule: Stripe live key', () => {
  const id = 'bugpilot/secret/stripe-live-key'

  it('finds a live secret key and redacts it', () => {
    const [hit] = hits(id, 'src/pay.js', `const stripe = "${fakeStripe}"\n`)

    expect(hit.message).toMatch(/Stripe live/)
    expect(hit.evidence[0].quote).not.toContain(fakeStripe)
  })

  it('does not fire on a test-mode key', () => {
    const testKey = ['sk', '_test_', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('')
    expect(hits(id, 'src/pay.js', `const stripe = "${testKey}"\n`)).toHaveLength(0)
  })

  it('does not fire on prose about live keys', () => {
    expect(hits(id, 'README.md', 'Use the live secret key only on the server.\n')).toHaveLength(0)
  })
})

describe('secret rule: private key block', () => {
  const id = 'bugpilot/secret/private-key-block'
  const header = ['-----BEGIN ', 'RSA ', 'PRIVATE KEY-----'].join('')

  it('finds a private key header', () => {
    const [hit] = hits(id, 'keys/server.pem', `${header}\nMIIEredacted\n`)

    expect(hit.message).toMatch(/Private key/)
    expect(hit.evidence[0].quote).toContain('PRIVATE KEY')
  })

  it('does not fire on a public key header', () => {
    const publicHeader = ['-----BEGIN ', 'PUBLIC ', 'KEY-----'].join('')
    expect(hits(id, 'keys/server.pub', `${publicHeader}\nMIIB\n`)).toHaveLength(0)
  })

  it('does not fire on prose about private keys', () => {
    expect(hits(id, 'README.md', 'The private key stays in the secret manager.\n')).toHaveLength(0)
  })
})

describe('secret rule: JWT', () => {
  const id = 'bugpilot/secret/jwt'

  it('finds a token whose header and payload decode as JSON', () => {
    const token = fakeJwt()
    const [hit] = hits(id, 'src/session.js', `const session = "${token}"\n`)

    expect(hit.message).toMatch(/JSON Web Token/)
    expect(hit.confidence.level).toBe('medium')
    expect(hit.evidence[0].quote).not.toContain(token)
  })

  it('does not fire on three-part lookalikes whose payload is not JSON', () => {
    const token = [['eyJhbGci', 'OiJIUzI1NiJ9'].join(''), 'not-json-payload', 'signature123'].join('.')
    expect(hits(id, 'src/session.js', `const session = "${token}"\n`)).toHaveLength(0)
  })

  it('does not fire on prose about JWTs', () => {
    expect(hits(id, 'README.md', 'A JSON Web Token has three dot-separated parts.\n')).toHaveLength(0)
  })
})

describe('secret rule: connection string', () => {
  const id = 'bugpilot/secret/connection-string'
  const connection = ['postgres', '://', 'app_user', ':', fakePassword, '@', 'db.internal:5432/app'].join('')

  it('finds a database URL with an embedded password and redacts the password', () => {
    const [hit] = hits(id, 'src/db.js', `const url = "${connection}"\n`)

    expect(hit.message).toMatch(/embedded password/)
    expect(hit.evidence[0].quote).toContain('db.internal')
    expect(hit.evidence[0].quote).not.toContain(fakePassword)
  })

  it('does not fire when the password is an environment placeholder', () => {
    const placeholder = ['postgres', '://', 'app_user', ':', '${DB_PASSWORD}', '@', 'db.internal/app'].join('')
    expect(hits(id, 'src/db.js', `const url = "${placeholder}"\n`)).toHaveLength(0)
  })

  it('does not fire on a non-database URL or on prose', () => {
    const web = ['https', '://', 'user', ':', fakePassword, '@', 'example.com'].join('')
    expect(hits(id, 'src/db.js', `const url = "${web}"\n`)).toHaveLength(0)
    expect(hits(id, 'README.md', 'The connection string reads its password from the environment.\n')).toHaveLength(0)
  })
})

describe('secret rule: credential assignment', () => {
  const id = 'bugpilot/secret/credential-assignment'

  it('finds a literal assigned to a credential-like name and redacts it', () => {
    const [hit] = hits(id, 'src/auth.js', `const apiKey = "${fakeAssignment}"\n`)

    expect(hit.message).toMatch(/credential-like name/)
    expect(hit.evidence[0].quote).not.toContain(fakeAssignment)
    expect(hit.fix?.riskClass).toBe('manual-only')
  })

  it('reports how many characters and how much entropy the literal has', () => {
    const [hit] = hits(id, 'src/auth.js', `const client_secret = "${fakeAssignment}"\n`)
    expect(hit.confidence.reason).toContain(String(fakeAssignment.length))
    expect(hit.confidence.reason).toMatch(/entropy/)
  })

  it('does not fire on placeholders, environment lookups, short values or low entropy', () => {
    expect(hits(id, 'src/auth.js', 'const apiKey = "changeme"\n')).toHaveLength(0)
    expect(hits(id, 'src/auth.js', 'const apiKey = "your-api-key-here"\n')).toHaveLength(0)
    expect(hits(id, 'src/auth.js', 'const apiKey = process.env.API_KEY\n')).toHaveLength(0)
    expect(hits(id, 'src/auth.js', 'const token = "short"\n')).toHaveLength(0)
    expect(hits(id, 'src/auth.js', `const token = "${'a'.repeat(24)}"\n`)).toHaveLength(0)
  })

  it('does not fire on prose that uses the words without assigning a value', () => {
    const prose = 'Never hard-code a password or API key; read it from the environment.\n'
    expect(hits(id, 'README.md', prose)).toHaveLength(0)
  })

  it('does not treat a comparison as an assignment', () => {
    expect(hits(id, 'src/auth.js', 'if (password === expected) { return true }\n')).toHaveLength(0)
  })
})
