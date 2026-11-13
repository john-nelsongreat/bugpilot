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

describe('secret rule: credential assignment identifier shapes', () => {
  const id = 'bugpilot/secret/credential-assignment'
  const secret = ['Zx9Qm2Lp', '7Rt4Vb8N'].join('')

  const shapes: Array<[string, string, string]> = [
    ['a prefixed SCREAMING snake key in Python', 'src/config.py', `LEDGER_API_KEY = "${secret}"\n`],
    ['a prefixed snake key in Python', 'src/db.py', `db_password = "${secret}"\n`],
    ['a suffixed snake key in Python', 'src/db.py', `password_db = "${secret}"\n`],
    ['a SCREAMING key in JavaScript', 'src/config.js', `const AUTH_TOKEN = "${secret}"\n`],
    ['a camelCase key in TypeScript', 'src/api.ts', `const clientSecret = "${secret}"\n`],
    ['an apiKey key in JavaScript', 'src/api.js', `const apiKey = "${secret}"\n`],
    ['an object literal key in JavaScript', 'src/api.js', `const cfg = { db_password: "${secret}" }\n`],
    ['a property assignment in TypeScript', 'src/db.ts', `this.password = "${secret}"\n`],
    ['a field in Java', 'src/Config.java', `private static final String SECRET_KEY_BASE = "${secret}";\n`],
    ['a const in C#', 'src/Config.cs', `public const string ApiKey = "${secret}";\n`],
    ['a var in Go', 'src/main.go', `var dbPassword = "${secret}"\n`],
    ['a short declaration in Go', 'src/main.go', `clientSecret := "${secret}"\n`],
    ['a constant in Ruby', 'src/config.rb', `API_KEY = "${secret}"\n`],
    ['an ivar in Ruby', 'src/config.rb', `@api_key = "${secret}"\n`],
    ['a dollar variable in PHP', 'src/config.php', `$apiKey = "${secret}";\n`],
    ['a const in PHP', 'src/config.php', `const LEDGER_API_KEY = "${secret}";\n`],
    ['a shell export', 'deploy.sh', `export API_KEY="${secret}"\n`],
    ['a quoted YAML key', 'config.yaml', `db_password: "${secret}"\n`],
    ['a quoted JSON key', 'config.json', `{ "clientSecret": "${secret}" }\n`],
    ['an unquoted .env key', '.env', `AUTH_TOKEN=${secret}\n`],
    ['a SCREAMING .env key', '.env', `LEDGER_API_KEY=${secret}\n`],
    ['a dotted properties key', 'app.properties', `db.password=${secret}\n`],
    ['a camelCase properties key', 'app.properties', `apiKey=${secret}\n`],
  ]

  for (const [label, path, text] of shapes) {
    it(`finds ${label}`, () => {
      const [hit] = hits(id, path, text)

      expect(hit).toBeDefined()
      expect(hit.message).toMatch(/credential-like name|literal secret/)
      expect(hit.evidence[0].quote).not.toContain(secret)
    })
  }
})

describe('secret rule: credential assignment false-positive guards', () => {
  const id = 'bugpilot/secret/credential-assignment'
  const secret = ['Zx9Qm2Lp', '7Rt4Vb8N'].join('')

  it('does not fire on label, limit, header or fixture names', () => {
    expect(hits(id, 'src/form.py', `password_field_label = "${secret}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/form.js', `const api_key_header_name = "${secret}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/santa.py', `secret_santa = "${secret}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/config.py', `PASSWORD_MIN_LENGTH = "${secret}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/config.js', `const SECRET_KEY_BASE_HEADER = "${secret}"\n`)).toHaveLength(0)
  })

  it('does not fire on words that merely contain a credential fragment', () => {
    expect(hits(id, 'src/office.py', `secretary = "${secret}"\n`)).toHaveLength(0)
    expect(hits(id, 'src/auth.py', `passwordless = "${secret}"\n`)).toHaveLength(0)
  })

  it('does not fire on function, class or test names', () => {
    expect(hits(id, 'src/api.py', 'def refresh_api_key():\n    return None\n')).toHaveLength(0)
    expect(hits(id, 'src/api.js', 'class ApiKeyStore {\n  constructor() {}\n}\n')).toHaveLength(0)
    expect(hits(id, 'src/api.py', 'def test_api_key_rotation():\n    assert True\n')).toHaveLength(0)
  })

  it('does not fire on docstring prose', () => {
    expect(hits(id, 'src/api.py', '"""Rotate the api_key monthly."""\n')).toHaveLength(0)
  })

  it('does not fire on environment lookups', () => {
    expect(hits(id, 'src/auth.py', 'password = os.environ.get("PASSWORD")\n')).toHaveLength(0)
    expect(hits(id, 'src/auth.js', 'const apiKey = process.env.API_KEY\n')).toHaveLength(0)
    expect(hits(id, '.env', `AUTH_TOKEN=\${AUTH_TOKEN}\n`)).toHaveLength(0)
  })

  it('does not fire on empty or placeholder values', () => {
    expect(hits(id, 'src/auth.py', 'password = ""\n')).toHaveLength(0)
    expect(hits(id, 'src/auth.py', 'password = "changeme"\n')).toHaveLength(0)
    expect(hits(id, '.env', 'PASSWORD=your-password-here\n')).toHaveLength(0)
  })

  it('does not fire on config lines that name hosts or versions', () => {
    expect(hits(id, 'app.properties', 'database.host=db.internal.example.com\n')).toHaveLength(0)
    expect(hits(id, '.env', 'BUILD_VERSION=1.2.3.4.5.6.7\n')).toHaveLength(0)
  })
})

describe('secret rule: credential assignment typed declaration', () => {
  const id = 'bugpilot/secret/credential-assignment'

  it('finds a Kotlin typed declaration', () => {
    const [hit] = hits(id, 'Ledger.kt', `private val LEDGER_API_KEY: String = "${fakeAssignment}"\n`)
    expect(hit).toBeDefined()
    expect(hit.message).toMatch(/credential-like name/)
    expect(hit.evidence[0].quote).not.toContain(fakeAssignment)
  })

  it('finds a Rust typed declaration whose type begins with an ampersand', () => {
    const [hit] = hits(id, 'ledger.rs', `pub const ACCESS_TOKEN: &str = "${fakeAssignment}"\n`)
    expect(hit).toBeDefined()
    expect(hit.message).toMatch(/credential-like name/)
    expect(hit.evidence[0].quote).not.toContain(fakeAssignment)
  })

  it('does not fire on a typed numeric limit', () => {
    expect(hits(id, 'Ledger.kt', 'private val PASSWORD_MIN_LENGTH: Int = 12\n')).toHaveLength(0)
  })

  it('does not fire on a typed variable whose name carries a disqualified segment', () => {
    expect(hits(id, 'Ledger.kt', `val apiKeyName: String = "service-account"\n`)).toHaveLength(0)
  })

  it('reports a typed declaration and a plain assignment identically', () => {
    const quoted = hits(id, 'Ledger.kt', `API_KEY = "${fakeAssignment}"`)[0]
    const typed = hits(id, 'Ledger.kt', `val API_KEY: String = "${fakeAssignment}"`)[0]
    expect(typed).toBeDefined()
    expect(typed?.message).toBe(quoted?.message)
    expect(typed?.explanation).toBe(quoted?.explanation)
    expect(typed?.fix?.explanation).toBe(quoted?.fix?.explanation)
    expect(typed?.confidence.level).toBe(quoted?.confidence.level)
  })
})

describe('secret rule: credential assignment Dockerfile ENV and location names', () => {
  const id = 'bugpilot/secret/credential-assignment'

  it('finds a Dockerfile ENV whose value is a literal credential', () => {
    const [hit] = hits(id, 'Dockerfile', `ENV LEDGER_API_KEY=${fakeAssignment}\n`)
    expect(hit).toBeDefined()
    expect(hit.evidence[0].quote).not.toContain(fakeAssignment)
  })

  it('does not fire on a Dockerfile ENV whose name ends in a location word', () => {
    expect(hits(id, 'Dockerfile', 'ENV API_KEY_FILE=/etc/ssl/ledger.pem\n')).toHaveLength(0)
  })

  it('does not fire on a typed assignment whose name ends in _FILE', () => {
    expect(
      hits(id, 'Ledger.kt', `private val LEDGER_API_KEY_FILE: String = "${fakeAssignment}"\n`),
    ).toHaveLength(0)
  })

  it('still fires on a typed assignment whose name has no disqualified segment', () => {
    expect(
      hits(id, 'Ledger.kt', `private val LEDGER_API_KEY_TEXT: String = "${fakeAssignment}"\n`),
    ).toHaveLength(1)
  })
})

describe('secret rule: credential assignment mapping operator', () => {
  // The corpus's 44 `.rb` files use symbol keys (`:api_key => 'v'`), which the narrow
  // quoted-key form deliberately does not reach. The Ruby row below is therefore
  // synthetic — it exercises real Ruby syntax, not a Ruby finding the scan can see today.
  const id = 'bugpilot/secret/credential-assignment'

  it('finds a PHP association array literal', () => {
    const [hit] = hits(id, 'config.php', `<?php\n$config = ['api_key' => '${fakeAssignment}'];\n`)
    expect(hit).toBeDefined()
    expect(hit.message).toMatch(/credential-like name/)
    expect(hit.evidence[0].quote).not.toContain(fakeAssignment)
  })

  it('finds a Ruby hash rocket with a double-quoted key', () => {
    const [hit] = hits(id, 'ledger.rb', `CREDENTIALS = { "access_token" => "${fakeAssignment}" }\n`)
    expect(hit).toBeDefined()
    expect(hit.evidence[0].quote).not.toContain(fakeAssignment)
  })

  it('reports a mapping and a plain assignment identically', () => {
    const plain = hits(id, 'Ledger.kt', `API_KEY = "${fakeAssignment}"`)[0]
    const mapped = hits(id, 'ledger.php', `<?php\n$x = ['api_key' => '${fakeAssignment}'];\n`)[0]
    expect(plain).toBeDefined()
    expect(mapped).toBeDefined()
    expect(mapped?.message).toBe(plain?.message)
    expect(mapped?.explanation).toBe(plain?.explanation)
    expect(mapped?.fix?.explanation).toBe(plain?.fix?.explanation)
    expect(mapped?.confidence.level).toBe(plain?.confidence.level)
  })

  it('reports a JSON key only once, not twice', () => {
    expect(hits(id, 'ledger.json', `{"api_key": "${fakeAssignment}"}\n`)).toHaveLength(1)
  })

  it('does not fire on a JS arrow function whose parameter is credential-shaped', () => {
    expect(
      hits(id, 'ledger.js', 'const mask = (apiKey) => "redacted-value"\n'),
    ).toHaveLength(0)
  })

  it('does not fire on a TS single-parameter arrow body', () => {
    expect(
      hits(id, 'ledger.ts', `const f = secret => "${fakeAssignment}"\n`),
    ).toHaveLength(0)
  })

  it('does not fire on a mapping whose value is a known placeholder', () => {
    expect(hits(id, 'config.php', `<?php\n$x = ['api_key' => 'your-key-here'];\n`)).toHaveLength(0)
  })

  it('does not fire on a mapping whose key carries a disqualified segment', () => {
    expect(
      hits(id, 'config.php', `<?php\n$x = ['password_field_label' => '${fakeAssignment}'];\n`),
    ).toHaveLength(0)
  })

  it('does not fire on a mapping whose value is shorter than 8 characters', () => {
    expect(hits(id, 'config.php', `<?php\n$x = ['api_key' => 'short'];\n`)).toHaveLength(0)
  })

  it('does not fire on a Scala hash literal (the arrow is ->, not =>)', () => {
    expect(
      hits(id, 'ledger.scala', `val m = Map("client_secret" -> "${fakeAssignment}")\n`),
    ).toHaveLength(0)
  })

  it('does not fire on a Rust match arm (no key quotes)', () => {
    expect(
      hits(id, 'ledger.rs', 'match state { Secret => "aaaaaaaaaaaaaaaa", _ => "" }\n'),
    ).toHaveLength(0)
  })
})

describe('secret rules on template dialects', () => {
  // Re-labelling a template as `template` must not cost it the pattern tier: the file is
  // reported as syntax-unchecked, and that is the only change. Both directions are tested,
  // so a rule list that drops `template` fails here instead of silently losing coverage.
  const awsId = ['AKIA', 'Q7R2T9', 'MW4XZ8', 'B3N6'].join('')
  const secret = ['Zx9Qm2Lp', '7Rt4Vb8N'].join('')

  it('still finds a credential shape on the face of a .ejs file', () => {
    const found = hits('bugpilot/secret/aws-access-key', 'views/keys.ejs', `<p>Your key is ${awsId}</p>\n`)
    expect(found).toHaveLength(1)
    expect(found[0].evidence[0].lineNumber).toBe(1)
  })

  it('still finds an assignment inside a template directive', () => {
    const body = `<% const api_key = "${secret}" %>\n`
    expect(hits('bugpilot/secret/credential-assignment', 'views/setup.ejs', body)).toHaveLength(1)
    expect(hits('bugpilot/secret/credential-assignment', 'views/setup.twig', body)).toHaveLength(1)
    expect(hits('bugpilot/secret/credential-assignment', 'views/setup.hbs', body)).toHaveLength(1)
  })

  it('finds the same credential in a .html file that carries a directive', () => {
    // The name stays .html, the content makes it a template; either way the rule runs.
    expect(hits('bugpilot/secret/aws-access-key', 'public/home.html', `<p>${awsId}</p>\n<%= x %>\n`)).toHaveLength(
      1,
    )
  })

  it('does not invent a finding on a clean template', () => {
    const clean = '<!doctype html>\n<html><body><%= user.name %></body></html>\n'
    expect(hits('bugpilot/secret/aws-access-key', 'views/index.ejs', clean)).toHaveLength(0)
    expect(hits('bugpilot/secret/credential-assignment', 'views/index.ejs', clean)).toHaveLength(0)
  })

  it('keeps .html without a directive in the same tier', () => {
    expect(hits('bugpilot/secret/aws-access-key', 'public/index.html', `<p>${awsId}</p>\n`)).toHaveLength(1)
  })
})
