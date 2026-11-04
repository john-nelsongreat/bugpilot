import { describe, expect, it } from 'vitest'
import { sensitiveFindings } from './sensitiveFiles'

/**
 * Every value below is assembled at run time. The repository secret scan runs on this file, so a
 * credential-shaped literal here would be served to every visitor of the site.
 */
function privateKeyBlock(): string {
  const header = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')
  const footer = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')
  return [header, 'MIIEfakebodyfakebody', footer].join('\n')
}

const NPM_TOKEN = ['npm', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8'].join('_')
const PYPI_PASSWORD = ['py', 'pi', 'NotAReal', 'Password', '42'].join('')
const WP_PASSWORD = ['word', 'press', 'NotAReal', 'Password', '7'].join('')
const SERVICE_PRIVATE_KEY = ['"private_key"', ':', '"', 'fake', 'service', 'account', '"'].join(' ')

function findingsFor(name: string, text: string | null = null) {
  return sensitiveFindings({ name, text })
}

function expectManualFix(findings: ReturnType<typeof findingsFor>): void {
  expect(findings.length).toBeGreaterThan(0)
  for (const finding of findings) {
    expect(finding.fix?.riskClass).toBe('manual-only')
    expect(finding.fix?.explanation).toMatch(/remove from the repository, add to \.gitignore, rotate the credential/i)
    expect(finding.explanation).toMatch(/does not revoke/i)
    expect(finding.evidence).toEqual([])
    expect(finding.verificationSteps.length).toBeGreaterThan(0)
  }
}

describe('sensitive file-name rules', () => {
  it('reports .env and .env.* but not the example, sample or template variants', () => {
    for (const name of ['.env', 'config/.env', '.env.local', '.env.production']) {
      const findings = findingsFor(name)
      expect(findings.map((finding) => finding.ruleId), name).toEqual(['bugpilot/sensitive/env-file'])
      expectManualFix(findings)
    }
    for (const name of ['.env.example', '.env.sample', '.env.template', 'env', 'app.env']) {
      expect(findingsFor(name), name).toEqual([])
    }
  })

  it('reports SSH private-key names without flagging the .pub companion', () => {
    for (const name of ['id_rsa', 'keys/id_dsa', 'id_ecdsa', 'id_ed25519']) {
      const findings = findingsFor(name)
      expect(findings.map((finding) => [finding.ruleId, finding.severity]), name).toEqual([
        ['bugpilot/sensitive/private-key-name', 'Critical'],
      ])
      expectManualFix(findings)
    }
    expect(findingsFor('id_rsa.pub')).toEqual([])
    expect(findingsFor('keys/id_rsa.pub')).toEqual([])
  })

  it('raises .pem and .key by name, and to Critical when a private-key block is present', () => {
    const byName = findingsFor('certs/server.pem')
    expect(byName.map((finding) => [finding.ruleId, finding.severity, finding.confidence.level])).toEqual([
      ['bugpilot/sensitive/key-file', 'High', 'medium'],
    ])
    expectManualFix(byName)

    const withBlock = findingsFor('certs/server.key', privateKeyBlock())
    expect(withBlock.map((finding) => [finding.ruleId, finding.severity, finding.confidence.level])).toEqual([
      ['bugpilot/sensitive/key-file', 'Critical', 'high'],
    ])
    expect(withBlock[0]?.range.startLine).toBe(1)
    expectManualFix(withBlock)
    expect(JSON.stringify(withBlock)).not.toContain('MIIEfakebodyfakebody')
  })

  it('reports keystores, Terraform state and credential files by name', () => {
    const names: [string, string, string][] = [
      ['certs/identity.p12', 'bugpilot/sensitive/keystore', 'High'],
      ['certs/identity.pfx', 'bugpilot/sensitive/keystore', 'High'],
      ['certs/identity.jks', 'bugpilot/sensitive/keystore', 'High'],
      ['android/release.keystore', 'bugpilot/sensitive/keystore', 'High'],
      ['vault/passwords.kdbx', 'bugpilot/sensitive/keystore', 'High'],
      ['terraform.tfstate', 'bugpilot/sensitive/terraform-state', 'High'],
      ['infra/prod.tfstate.backup', 'bugpilot/sensitive/terraform-state', 'High'],
      ['.git-credentials', 'bugpilot/sensitive/credential-file', 'High'],
      ['home/.netrc', 'bugpilot/sensitive/credential-file', 'High'],
      ['site/.htpasswd', 'bugpilot/sensitive/credential-file', 'High'],
      ['service-account-prod.json', 'bugpilot/sensitive/credentials-file', 'High'],
      ['credentials.json', 'bugpilot/sensitive/credentials-file', 'High'],
      ['.aws/credentials', 'bugpilot/sensitive/aws-credentials', 'High'],
    ]
    for (const [name, ruleId, severity] of names) {
      const findings = findingsFor(name)
      expect(findings.map((finding) => [finding.ruleId, finding.severity]), name).toEqual([[ruleId, severity]])
      expectManualFix(findings)
    }
    expect(findingsFor('credentials')).toEqual([])
    expect(findingsFor('aws/credentials')).toEqual([])
  })

  it('scans credentials.json and service-account files for a private_key entry', () => {
    const findings = findingsFor('config/credentials.json', `{\n  ${SERVICE_PRIVATE_KEY}\n}`)
    expect(findings.map((finding) => [finding.ruleId, finding.severity, finding.range.startLine])).toEqual([
      ['bugpilot/sensitive/credentials-file', 'Critical', 2],
    ])
    expectManualFix(findings)
    expect(JSON.stringify(findings)).not.toContain('fake')
  })

  it('reports .npmrc and .pypirc only when the contents hold a token or password', () => {
    expect(findingsFor('.npmrc')).toEqual([])
    expect(findingsFor('.npmrc', `registry=https://example.invalid/\n//registry.example.invalid/:_authToken=${NPM_TOKEN}\n`).map((finding) => finding.ruleId)).toEqual([
      'bugpilot/sensitive/npmrc',
    ])
    expect(findingsFor('.pypirc')).toEqual([])
    expect(findingsFor('home/.pypirc', `[pypi]\nusername = someone\npassword = ${PYPI_PASSWORD}\n`).map((finding) => finding.ruleId)).toEqual([
      'bugpilot/sensitive/pypirc',
    ])
    const json = JSON.stringify(findingsFor('.pypirc', `password = ${PYPI_PASSWORD}`))
    expect(json).not.toContain(PYPI_PASSWORD)
  })

  it('reports wp-config.php only for literal credentials', () => {
    expect(findingsFor('wp-config.php', "define('DB_NAME', 'wordpress');\n")).toEqual([])
    expect(findingsFor('wp-config.php', "define('DB_PASSWORD', 'put your unique phrase here');\n")).toEqual([])
    const findings = findingsFor('site/wp-config.php', `<?php\ndefine('DB_PASSWORD', '${WP_PASSWORD}');\n`)
    expect(findings.map((finding) => [finding.ruleId, finding.severity, finding.range.startLine])).toEqual([
      ['bugpilot/sensitive/wp-config', 'Critical', 2],
    ])
    expectManualFix(findings)
    expect(JSON.stringify(findings)).not.toContain(WP_PASSWORD)
  })

  it('never quotes file contents in any finding', () => {
    const cases = [
      findingsFor('server.pem', privateKeyBlock()),
      findingsFor('.npmrc', `_authToken=${NPM_TOKEN}`),
      findingsFor('.pypirc', `password = ${PYPI_PASSWORD}`),
      findingsFor('wp-config.php', `define('AUTH_KEY', '${WP_PASSWORD}');`),
    ]
    const serialised = JSON.stringify(cases)
    expect(serialised).not.toContain('MIIEfakebodyfakebody')
    expect(serialised).not.toContain(NPM_TOKEN)
    expect(serialised).not.toContain(PYPI_PASSWORD)
    expect(serialised).not.toContain(WP_PASSWORD)
    for (const list of cases) expectManualFix(list)
  })
})
