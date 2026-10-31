import { describe, expect, it } from 'vitest'
import { diagnose } from './engine'
import { javascriptRules } from './rules/javascript'
import { neutralRules } from './rules/neutral'
import { pythonRules } from './rules/python'
import type {
  DiagnosticLanguage,
  DiagnosticResult,
  PossibleFix,
} from './types'

const MODES: readonly DiagnosticLanguage[] = ['auto', 'python', 'javascript']

const NOT_A_REPOSITORY =
  'fatal: not a git repository (or any of the parent directories): .git'

const PUSH_REJECTED = [
  'PS C:\\Users\\dev\\app> git push',
  'To https://github.com/dev/app.git',
  ' ! [rejected]        main -> main (fetch first)',
  "error: failed to push some refs to 'https://github.com/dev/app.git'",
  'hint: Updates were rejected because the remote contains work that you do not',
  'hint: have locally. This is usually caused by another repository pushing to',
  'hint: the same ref. If you want to integrate the remote changes, use',
  "hint: 'git pull' before pushing again.",
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
].join('\n')

const MERGE_CONFLICT = [
  'PS C:\\Users\\dev\\app> git merge feature/login',
  'Auto-merging src/App.tsx',
  'CONFLICT (content): Merge conflict in src/App.tsx',
  'Automatic merge failed; fix conflicts and then commit the result.',
].join('\n')

const IDENTITY = [
  'PS C:\\Users\\dev\\app> git commit -m "fix login"',
  'Author identity unknown',
  '',
  '*** Please tell me who you are.',
  '',
  'Run',
  '',
  '  git config --global user.email "<you@example.com>"',
  '  git config --global user.name "<Your Name>"',
  '',
  "to set your account's default identity.",
  'Omit --global to set the identity only in this repository.',
  '',
  "fatal: unable to auto-detect email address (got 'dev@PC.(none)')",
].join('\n')

const PASSWORD_AUTH = [
  'remote: Support for password authentication was removed on August 13, 2021.',
  "fatal: Authentication failed for 'https://github.com/dev/app.git/'",
].join('\n')

const DENIED_WITH_403 = [
  "remote: Permission to dev/app.git denied to dev.",
  'error: The requested URL returned error: 403',
  "fatal: unable to access 'https://github.com/dev/app.git/': The requested URL returned error: 403",
].join('\n')

const PUBLIC_KEY = [
  '$ git clone git@github.com:dev/app.git',
  'Cloning into app...',
  'git@github.com: Permission denied (publickey).',
  'fatal: Could not read from remote repository.',
].join('\n')

const SRC_REFSPEC = [
  'error: src refspec main does not match any',
  "error: failed to push some refs to 'https://github.com/dev/app.git'",
].join('\n')

const DUBIOUS_OWNERSHIP = [
  "fatal: detected dubious ownership in repository at 'C:/Users/dev/project'",
  'To add an exception for this directory, call:',
  '',
  '\tgit config --global --add safe.directory C:/Users/dev/project',
].join('\n')

const INDEX_LOCK = [
  "fatal: Unable to create 'C:/Users/dev/project/.git/index.lock': File exists.",
  '',
  'Another git process seems to be running in this repository, e.g.',
  'an editor opened by `git commit`, or if two `git` processes were started',
  'at the same time. If you make sure no processes are running then',
  'remove the file manually to continue.',
].join('\n')

const LINE_ENDINGS =
  "warning: in the working copy of 'src/App.tsx', LF will be replaced by CRLF the next time Git touches it"

const NETWORK =
  "fatal: unable to access 'https://github.com/dev/app.git/': Could not resolve host: github.com"

const TIMEOUT = [
  'PS C:\\Users\\dev\\app> git clone https://github.com/dev/app.git',
  "fatal: unable to access 'https://github.com/dev/app.git/': Failed to connect to github.com port 443 after 21062 ms: Could not connect to server",
].join('\n')

const UNRELATED = [
  '$ git pull origin main --rebase',
  'fatal: refusing to merge unrelated histories',
].join('\n')

const LOCAL_CHANGES = [
  'PS C:\\Users\\dev\\app> git checkout main',
  'error: Your local changes to the following files would be overwritten by checkout:',
  '\tsrc/App.tsx',
  'Please commit your changes or stash them before you switch branches.',
  'Aborting',
].join('\n')

const REMOTE_EXISTS = [
  '$ git remote add origin https://github.com/dev/app.git',
  'error: remote origin already exists.',
].join('\n')

function fixOf(result: DiagnosticResult): PossibleFix {
  expect(result.possibleFix).not.toBeNull()
  return result.possibleFix as PossibleFix
}

interface GitCase {
  name: string
  errorText: string
  signature: string
  check?: (result: DiagnosticResult) => void
}

const GIT_CASES: GitCase[] = [
  {
    name: 'not a repository',
    errorText: `PS C:\\Users\\dev\\project> git status\n${NOT_A_REPOSITORY}`,
    signature: NOT_A_REPOSITORY,
    check(result) {
      const fix = fixOf(result)
      expect(fix.exampleCode).toMatch(/^cd /)
      expect(fix.exampleCode).toContain('git status')
      expect(result.likelyCause).toContain(NOT_A_REPOSITORY)
    },
  },
  {
    name: 'remote already exists',
    errorText: REMOTE_EXISTS,
    signature: 'error: remote origin already exists.',
    check(result) {
      const fix = fixOf(result)
      expect(fix.exampleCode).toContain('git remote -v')
      expect(fix.exampleCode).toContain('git remote set-url')
    },
  },
  {
    name: 'push rejected',
    errorText: PUSH_REJECTED,
    signature: '! [rejected] <ref> -> <ref> (fetch first)',
    check(result) {
      const code = fixOf(result).exampleCode

      expect(result.evidence.map((entry) => entry.quote)).toContain(
        '! [rejected]        main -> main (fetch first)',
      )
      expect(code.indexOf('git pull --rebase')).toBeLessThan(
        code.indexOf('--force-with-lease'),
      )
      expect(code).toContain('--force-with-lease')
      expect(code).not.toMatch(/--force(?!-with-lease)/)
      expect(`${fixOf(result).explanation}\n${code}`).toMatch(/last resort/)
      expect(`${fixOf(result).explanation}\n${code}`).toMatch(
        /lose|overwrite|destroy/,
      )
      expect(result.debuggingSteps.join('\n')).toMatch(/hint/)
    },
  },
  {
    name: 'unrelated histories',
    errorText: UNRELATED,
    signature: 'fatal: refusing to merge unrelated histories',
    check(result) {
      const fix = fixOf(result)
      expect(fix.exampleCode).toContain('--allow-unrelated-histories')
      expect(`${fix.explanation}\n${fix.exampleCode}`).toMatch(/deliberate/)
    },
  },
  {
    name: 'merge conflict',
    errorText: MERGE_CONFLICT,
    signature: 'CONFLICT (<type>): Merge conflict in <file>',
    check(result) {
      const fix = fixOf(result)
      expect(fix.exampleCode).toMatch(/<<<<<<<|>>>>>>>/)
      expect(fix.exampleCode).toContain('git add')
      expect(fix.exampleCode).toContain('git commit')
      expect(result.evidence.map((entry) => entry.quote)).toContain(
        'CONFLICT (content): Merge conflict in src/App.tsx',
      )
    },
  },
  {
    name: 'local changes would be overwritten',
    errorText: LOCAL_CHANGES,
    signature:
      'error: Your local changes to the following files would be overwritten by checkout:',
    check(result) {
      expect(fixOf(result).exampleCode).toContain('git stash')
      expect(JSON.stringify(result)).not.toMatch(/reset --hard|git clean/)
    },
  },
  {
    name: 'identity unknown',
    errorText: IDENTITY,
    signature: "fatal: unable to auto-detect email address (got '<value>')",
    check(result) {
      const fix = fixOf(result)
      expect(fix.exampleCode).toContain('git config --global user.email')
      expect(fix.exampleCode).toContain('git config --global user.name')
    },
  },
  {
    name: 'password authentication removed',
    errorText: PASSWORD_AUTH,
    signature: "fatal: Authentication failed for '<url>'",
    check(result) {
      const fix = fixOf(result)
      expect(`${fix.explanation}\n${fix.exampleCode}`).toMatch(
        /token|credential manager|ssh key/i,
      )
      expect(JSON.stringify(result)).toMatch(/never paste/i)
    },
  },
  {
    name: 'repository access denied',
    errorText: DENIED_WITH_403,
    signature: 'error: The requested URL returned error: 403',
    check(result) {
      expect(JSON.stringify(result)).toMatch(/never paste/i)
      expect(result.evidence.map((entry) => entry.quote)).toContain(
        'error: The requested URL returned error: 403',
      )
    },
  },
  {
    name: 'ssh key refused',
    errorText: PUBLIC_KEY,
    signature: 'Permission denied (publickey).',
    check(result) {
      expect(JSON.stringify(result)).toMatch(/ssh -T|SSH key|ssh key/i)
    },
  },
  {
    name: 'src refspec does not match',
    errorText: SRC_REFSPEC,
    signature: 'error: src refspec <branch> does not match any',
    check(result) {
      expect(fixOf(result).exampleCode).toContain('git branch')
    },
  },
  {
    name: 'dubious ownership',
    errorText: DUBIOUS_OWNERSHIP,
    signature: "fatal: detected dubious ownership in repository at '<path>'",
    check(result) {
      expect(fixOf(result).exampleCode).toContain(
        'git config --global --add safe.directory',
      )
      expect(JSON.stringify(result)).toMatch(/untrusted/)
    },
  },
  {
    name: 'index.lock exists',
    errorText: INDEX_LOCK,
    signature: "fatal: Unable to create '<path>': File exists.",
    check(result) {
      const code = fixOf(result).exampleCode
      expect(code).toMatch(/del /)
      expect(code).toMatch(/rm /)
      expect(code.indexOf('del ')).toBeLessThan(code.indexOf('rm '))
      expect(JSON.stringify(result)).toMatch(/no Git process is running/)
    },
  },
  {
    name: 'line ending warning',
    errorText: LINE_ENDINGS,
    signature:
      "warning: in the working copy of '<file>', LF will be replaced by CRLF the next time Git touches it",
    check(result) {
      expect(result.likelyCause).toMatch(/nothing is broken/)
      expect(JSON.stringify(result)).toMatch(/core\.autocrlf|\.gitattributes/)
    },
  },
  {
    name: 'host cannot be resolved',
    errorText: NETWORK,
    signature: "fatal: unable to access '<url>': <network detail>",
    check(result) {
      expect(result.likelyCause).toContain('Could not resolve host: github.com')
    },
  },
  {
    name: 'connection refused on the port',
    errorText: TIMEOUT,
    signature: "fatal: unable to access '<url>': <network detail>",
    check(result) {
      expect(result.likelyCause).toContain('Failed to connect to github.com')
    },
  },
]

describe('Git error rule sub-signatures', () => {
  it.each(GIT_CASES)(
    'recognises $name identically in Auto, Python, and JavaScript',
    ({ errorText, signature, check }) => {
      const results = MODES.map((language) =>
        diagnose({ language, errorText }),
      )
      const first = results[0]

      expect(first.category).toBe('git-error')
      expect(first.matchedSignature).toBe(signature)
      expect(first.confidence.level).toBe('high')

      for (const result of results) {
        expect(result).toEqual(first)
      }

      expect(JSON.stringify(first)).not.toMatch(/Python|JavaScript|runtime/)

      check?.(first)
    },
  )

  it('reports the most specific recognised Git line, not a summary line', () => {
    const result = diagnose({ language: 'auto', errorText: SRC_REFSPEC })

    expect(result.matchedSignature).toBe(
      'error: src refspec <branch> does not match any',
    )
    expect(result.evidence[0].quote).toBe(
      "error: failed to push some refs to 'https://github.com/dev/app.git'",
    )
    expect(result.evidence[1]).toMatchObject({
      label: 'Matched context line',
      quote: 'error: src refspec main does not match any',
      lineNumber: 1,
    })
  })

  it('does not let a hint trailer or the remote line hide the earlier error', () => {
    const result = diagnose({ language: 'auto', errorText: PUSH_REJECTED })
    const quotes = result.evidence.map((entry) => entry.quote)

    expect(quotes.some((quote) => quote.startsWith('hint:'))).toBe(false)
    expect(quotes).not.toContain('To https://github.com/dev/app.git')
    expect(result.confidence.level).toBe('high')
    expect(result.likelyCause).toContain('fetch first')
  })

  it('ignores terminal prompts and command echoes', () => {
    const result = diagnose({
      language: 'python',
      errorText: [
        'dev@workstation:~/app$ git push',
        'To https://github.com/dev/app.git',
        ' ! [rejected]        main -> main (non-fast-forward)',
        "error: failed to push some refs to 'https://github.com/dev/app.git'",
        'dev@workstation:~/app$',
      ].join('\n'),
    })

    expect(result.category).toBe('git-error')
    expect(result.matchedSignature).toBe(
      '! [rejected] <ref> -> <ref> (non-fast-forward)',
    )

    const matched = result.evidence.filter(
      (entry) => entry.label === 'Matched context line',
    )

    expect(matched.map((entry) => entry.quote)).toEqual([
      '! [rejected]        main -> main (non-fast-forward)',
    ])
    expect(`${result.likelyCause} ${result.matchedSignature}`).not.toContain(
      'dev@workstation',
    )
  })

  it('quotes the recognised Git line even when the paste ends in prose', () => {
    const result = diagnose({ language: 'auto', errorText: INDEX_LOCK })
    const lockLine =
      "fatal: Unable to create 'C:/Users/dev/project/.git/index.lock': File exists."
    const quoted = result.evidence.find((entry) => entry.quote === lockLine)

    expect(quoted?.label).toBe('Matched context line')
    expect(quoted?.lineNumber).toBe(1)
    expect(result.likelyCause).toContain(lockLine)
    expect(result.likelyCause).toContain('index.lock')
  })

  it('reads a lone remote permission line as its own sub-signature', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'remote: Permission to dev/app.git denied to dev.',
    })

    expect(result.category).toBe('git-error')
    expect(result.matchedSignature).toBe(
      'remote: Permission to <owner>/<repo>.git denied to <user>.',
    )
    expect(result.confidence.level).toBe('high')
  })

  it('names Git in the cause and never invents a runtime', () => {
    for (const { errorText } of GIT_CASES) {
      const result = diagnose({ language: 'auto', errorText })

      expect(result.likelyCause).toMatch(/git/i)
      expect(result.limitations.length).toBeGreaterThan(1)
    }
  })

  it('keeps the rule count of every array explicit', () => {
    expect(pythonRules).toHaveLength(16)
    expect(javascriptRules).toHaveLength(14)
    expect(neutralRules).toHaveLength(1)
  })
})

describe('Git lookalikes', () => {
  const LOOKALIKES: [string, string][] = [
    ['a timestamp-prefixed fatal line', `2026-10-31T10:00:00Z ${NOT_A_REPOSITORY}`],
    [
      'a log-level prefixed error line',
      '[2026-10-31 10:00:00] error: remote origin already exists.',
    ],
    [
      'prose that repeats the message',
      'In my notes I wrote that the remote origin already exists in my repo.',
    ],
    ['prose about pushing', 'run git push to publish your branch'],
    [
      'fatal inside a sentence',
      'It was fatal that the deployment script removed the whole folder.',
    ],
    [
      'a Python error that mentions git',
      "subprocess.CalledProcessError: Command 'git push' returned non-zero exit status 1.",
    ],
    [
      'a JavaScript error that mentions git',
      'Error: Command failed: git push origin main, read the git docs',
    ],
    [
      'an uppercase GitHub shell message',
      'ERROR: Permission to "dev/app.git" denied to "dev".',
    ],
    [
      'an unanchored rejected marker',
      'remote:  ! [rejected] main -> main (fetch first) reported by the mirror',
    ],
    [
      'a hint line on its own',
      'hint: Updates were rejected because the remote contains work',
    ],
    ['a remote line on its own', 'To https://github.com/dev/app.git'],
    ['a prompt line on its own', 'PS C:\\Users\\dev\\app> git status'],
    [
      'an unrelated warning line',
      'warning: too many files; consider using a sparse checkout',
    ],
    ['a merge summary line', 'Merge made by the ort strategy.'],
    [
      'a rejected marker for another reason',
      ' ! [rejected]        main -> main (stale info)',
    ],
  ]

  it.each(LOOKALIKES)('does not report a Git sub-signature for %s', (_label, errorText) => {
    for (const language of MODES) {
      const result = diagnose({ language, errorText })

      expect(result.category).toBe('unrecognized')
      expect(result.matchedSignature).toBeNull()
    }
  })

  it('still reports a fatal line it has no sub-signature for', () => {
    const result = diagnose({
      language: 'auto',
      errorText: 'fatal: The remote end hung up unexpectedly',
    })

    expect(result.category).toBe('git-error')
    expect(result.confidence.level).toBe('low')
    expect(result.matchedSignature).toBe('fatal: <message Git reported>')
  })

  it('keeps the Auto unrecognised wording for a timestamped Git-shaped line', () => {
    const result = diagnose({
      language: 'auto',
      errorText: `2026-10-31T10:00:00Z ${NOT_A_REPOSITORY}`,
    })

    expect(result.likelyCause).toContain(
      'No supported exception signature was found',
    )
  })
})
