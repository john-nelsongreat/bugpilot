import type {
  DiagnosticRule,
  PossibleFix,
  RuleNarrative,
  RuleMatch,
} from '../types'

/**
 * Rules that describe a tool rather than a programming language. Git writes
 * this output itself, so these rules are consulted in every language mode and
 * never rely on Python or JavaScript evidence.
 *
 * Every sub-signature is anchored at the start of a trimmed line and uses the
 * exact prefix Git writes (`fatal:`, `error:`, `warning:`, `remote:`,
 * `! [rejected]`, `CONFLICT (`). A line that carries a timestamp, a log level,
 * or any other prefix before those words is not Git writing its message, so it
 * is not read as one.
 */
type GitShape =
  | 'not-a-repository'
  | 'remote-exists'
  | 'push-rejected'
  | 'push-refs-failed'
  | 'unrelated-histories'
  | 'merge-conflict'
  | 'merge-aborted-summary'
  | 'local-changes'
  | 'identity'
  | 'identity-banner'
  | 'password-auth'
  | 'auth-failed'
  | 'permission-denied'
  | 'http-403'
  | 'publickey'
  | 'src-refspec'
  | 'dubious-ownership'
  | 'index-lock'
  | 'line-endings'
  | 'line-endings-short'
  | 'network'
  | 'generic-fatal'

interface GitSubSignature {
  shape: GitShape
  pattern: RegExp
  signature: string | ((parts: RegExpExecArray) => string)
  specificity: 'specific' | 'generic'
}

const FATAL_LINE = /^fatal:\s*(.+)$/

const GIT_SUB_SIGNATURES: readonly GitSubSignature[] = [
]

function gitErrorRule(): DiagnosticRule {
  return {
    id: 'tool.git-error',
    language: 'any',
    category: 'git-error',
    match(line: string): RuleMatch | null {
      for (const sub of GIT_SUB_SIGNATURES) {
        const parts = sub.pattern.exec(line)
        if (parts === null) {
          continue
        }

        const captures: Record<string, string> = {
          reason: sub.shape,
          detail: line,
        }
        for (const [key, value] of Object.entries(parts.groups ?? {})) {
          if (typeof value === 'string' && value !== '') {
            captures[key] = value
          }
        }

        return {
          signature:
            typeof sub.signature === 'function' ? sub.signature(parts) : sub.signature,
          specificity: sub.specificity,
          captures,
        }
      }

      const fatal = FATAL_LINE.exec(line)
      if (fatal === null) {
        return null
      }

      return {
        signature: 'fatal: <message Git reported>',
        specificity: 'generic',
        captures: {
          reason: 'generic-fatal',
          detail: fatal[1].trim(),
        },
      }
    },
    explain(match: RuleMatch, _context): RuleNarrative {
      const captures = match.captures
      const reported = `"${captures.detail}"`

      switch (captures.reason as GitShape) {
        case 'not-a-repository':
          return notARepository(reported)
        case 'remote-exists':
          return remoteExists(captures.name ?? 'origin', reported)
        case 'push-rejected':
          return pushRejected(reported)
        case 'push-refs-failed':
          return pushRefsFailed(reported, captures.url ?? '')
        case 'unrelated-histories':
          return unrelatedHistories(reported)
        case 'merge-conflict':
          return mergeConflict(captures.file ?? 'the conflicted file', reported)
        case 'merge-aborted-summary':
          return mergeSummary(reported)
        case 'local-changes':
          return localChanges(reported)
        case 'identity':
        case 'identity-banner':
          return identity(reported)
        case 'password-auth':
          return passwordAuth(reported)
        case 'auth-failed':
          return authFailed(reported, captures.url ?? '')
        case 'permission-denied':
          return permissionDenied(reported, captures.repo ?? '')
        case 'http-403':
          return httpDenied(reported, captures.code ?? '403')
        case 'publickey':
          return publicKeyDenied(reported)
        case 'src-refspec':
          return srcRefspec(reported, captures.branch ?? 'main')
        case 'dubious-ownership':
          return dubiousOwnership(reported, captures.path ?? '')
        case 'index-lock':
          return indexLock(reported, captures.path ?? '')
        case 'line-endings':
        case 'line-endings-short':
          return lineEndings(
            reported,
            captures.from ?? 'LF',
            captures.to ?? 'CRLF',
          )
        case 'network':
          return networkFailure(reported, captures.why ?? '')
        default:
          return genericFatal(captures.detail)
      }
    },
  }
}

const SHARED_LIMITATIONS: readonly string[] = [
  'The engine reads only the lines you pasted; it cannot see the repository, the remote, or the command that produced them.',
  'Git rewords its messages between versions, so the same problem can appear under another line.',
]

function narrative(base: {
  likelyCause: string
  debuggingSteps: string[]
  fix: PossibleFix
  verificationSteps: string[]
  limitations?: string[]
  alternativeExplanations: string[]
}): RuleNarrative {
  return {
    likelyCause: base.likelyCause,
    debuggingSteps: base.debuggingSteps,
    possibleFix: base.fix,
    verificationSteps: base.verificationSteps,
    limitations: [...(base.limitations ?? []), ...SHARED_LIMITATIONS],
    alternativeExplanations: base.alternativeExplanations,
  }
}

function notARepository(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `Git stopped because it found no repository: ${reported}. The command ran in a folder that has no .git directory in it or in any folder above it, so there was nothing for Git to read or change.`,
    debuggingSteps: [
      'Run the two commands below in the folder that produced the message and compare the folder you are in with the folder that holds the repository.',
      'Look for a .git folder in that directory; a project downloaded as an archive has the files but no repository.',
      'Check whether the command was typed in a parent, sibling, or temporary copy of the project rather than inside it.',
      'If the folder was recently moved or cleaned, check whether the .git folder itself was removed with it.',
    ],
    fix: {
      explanation:
        'Move into the repository, or get a repository into this folder by cloning. Read the two commands before running them: cloning writes a new folder, so it needs a target that is not already in use.',
      whereItMayApply:
        'Run them in the folder where the command failed. Nothing here changes an existing repository.',
      exampleCode: [
        'cd C:\\Users\\dev\\project',
        'git status',
        'git rev-parse --show-toplevel',
        '',
        '# If the folder has no repository at all, get one from the remote:',
        'git clone https://github.com/dev/app.git C:\\Users\\dev\\app',
        '',
        '# On macOS or Linux, from the folder the command ran in:',
        'cd ~/project',
        'git status',
      ].join('\n'),
    },
    verificationSteps: [
      'git rev-parse --show-toplevel prints a folder path instead of an error.',
      'git status names the branch you are on rather than reporting no repository.',
      'Re-run the original command and confirm the message no longer appears.',
    ],
    limitations: [
      'The engine cannot see the file system, so it cannot tell which folder the command ran in or whether a .git folder exists.',
    ],
    alternativeExplanations: [
      'The command was run in a parent or sibling folder by mistake.',
      'The project was downloaded as an archive, which carries the files but not the history.',
      'A cleanup or a folder move removed the .git directory that held the history.',
    ],
  })
}

function remoteExists(name: string, reported: string): RuleNarrative {
  return narrative({
    likelyCause: `Git refused to add a second remote called ${name}: ${reported} The name is already configured in this repository, and Git will not silently replace it. Nothing was changed.`,
    debuggingSteps: [
      `List the remotes to see which URL ${name} already points at.`,
      'Compare that URL with the repository you meant to add; a wrong URL is the usual reason for the second add.',
      'Check whether this folder is a copy of another repository that already came with the remote.',
      'Read the output of the two commands below before deciding to change anything.',
    ],
    fix: {
      explanation:
        'Either keep the existing remote and point it at the URL you want, or remove it and add the new one. Both choices only rewrite configuration for this repository; neither deletes commits.',
      whereItMayApply:
        'Run in the repository folder. If the remote is shared with other people, tell them before you change the URL it points at.',
      exampleCode: [
        'git remote -v',
        'git remote set-url origin https://github.com/dev/app.git',
        'git remote -v',
        '',
        '# To start over with that name instead:',
        'git remote remove origin',
        'git remote add origin https://github.com/dev/app.git',
        '',
        '# The same commands work unchanged on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'git remote -v lists one URL for origin and it is the repository you expect.',
      'git fetch origin completes without a new error.',
      'git remote show origin prints the branch list of the intended repository.',
    ],
    alternativeExplanations: [
      'The repository was cloned first, so origin came with it.',
      'An earlier setup command already added the remote and the guide was followed twice.',
      'The folder was copied from another project and brought its configuration with it.',
    ],
  })
}

function pushRejected(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `Git refused the push because the remote branch holds commits that your local branch does not: ${reported}. The remote has moved on, usually because another machine or another person pushed to the same branch, and Git will not throw those commits away without being told to.`,
    debuggingSteps: [
      'Fetch the remote and look at the difference before changing anything.',
      'List the commits you have that the remote lacks, and the commits the remote has that you lack.',
      'Read the hint: lines Git printed under the refusal; they name the command it recommends.',
      'Confirm you are on the branch you meant to push, because pushing the wrong branch produces the same block.',
    ],
    fix: {
      explanation:
        'Integrate the remote work first, then push again. Pull with a rebase puts your commits on top of the remote ones; conflicts along the way are part of the merge, not a new failure. Overwriting the remote is a last resort: it can destroy work that other people have already pushed. If you must do it, use --force-with-lease, which stops when someone pushed since your last fetch, rather than a plain overwrite that never asks.',
      whereItMayApply:
        'Run in the repository folder, on the branch that was refused. If the branch is shared, talk to the people working on it before pushing at all.',
      exampleCode: [
        'git fetch origin',
        'git status --short --branch',
        'git log --oneline main..origin/main',
        'git pull --rebase origin main',
        'git push origin main',
        '',
        '# Last resort only, and only when the commits on the remote are yours',
        '# to replace: --force-with-lease refuses if anyone pushed meanwhile.',
        'git push --force-with-lease origin main',
        '',
        '# On macOS or Linux the commands are the same.',
      ].join('\n'),
    },
    verificationSteps: [
      'git status reports the branch up to date with its remote tracking branch.',
      'The push output shows a range of commits rather than a rejected marker.',
      'Open the branch on the remote and check that your latest commit is there and no other commit disappeared.',
    ],
    limitations: [
      'The engine cannot see the remote, so it cannot tell whose commits would be lost by overwriting it.',
    ],
    alternativeExplanations: [
      'You pushed the same branch from another machine and the first push is not here yet.',
      'Someone else rebased or rewrote the shared branch.',
      'The branch was renamed locally, so the push targets a ref that already has different history.',
    ],
  })
}

function pushRefsFailed(reported: string, url: string): RuleNarrative {
  return narrative({
    likelyCause: `A push did not complete: ${reported}${url === '' ? '' : ` The remote named in the message is ${url}.`} This line reports the outcome rather than the cause, so the lines printed just above it decide what went wrong.`,
    debuggingSteps: [
      'Read the two or three lines directly above this one; a rejected marker, a conflict, or a network line names the real cause.',
      'Run git status --short --branch to see the branch and how far it is from its remote.',
      'Re-run the push alone, without other commands in the same line, so its output is not mixed with anything else.',
      'Paste the whole block if you ask for help: this line on its own is not enough to tell why the push stopped.',
    ],
    fix: {
      explanation:
        'No single command fixes this line, because it is the summary of another failure. Work out which line above it explains the push, then follow that one; nothing here changes the repository.',
      whereItMayApply:
        'These commands only report state, so they are safe to run in the repository folder.',
      exampleCode: [
        'git status --short --branch',
        'git fetch origin',
        'git log --oneline -5 main..origin/main',
        '',
        '# The same commands work on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'The line above this one in the output names a cause you can read.',
      'git status shows the branch and whether it is ahead, behind, or both.',
      'After acting on that cause, a plain git push completes without this summary.',
    ],
    limitations: [
      'This line is a summary, so no cause and no fix can be claimed from it alone.',
    ],
    alternativeExplanations: [
      'The remote branch moved ahead and the push was refused.',
      'The connection to the remote dropped partway through.',
      'The credentials used do not allow writing to that repository.',
    ],
  })
}

function unrelatedHistories(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `Git stopped a merge because the two branches share no common commit: ${reported} Each side has its own starting point, so Git cannot work out which changes are edits of the same work and which are new. It asks you to say that the merge is intended.`,
    debuggingSteps: [
      'Check the history of each side to see whether the second one is really the branch you meant.',
      'Run git log --oneline on both the local branch and the remote branch and compare their oldest commits.',
      'Look for the case this usually is: a remote created with a first commit, and a local project with its own first commit.',
      'Decide deliberately whether the two histories belong to one project before merging them.',
    ],
    fix: {
      explanation:
        'Merging unrelated histories is possible, and it is a deliberate choice rather than a fix for a broken command. Allow it once, expect conflicts where the same files exist on both sides, and resolve them the same way as any other merge conflict.',
      whereItMayApply:
        'Run in the repository, on the branch you want to keep. If you are unsure, merge into a throwaway branch first so the original branch stays untouched.',
      exampleCode: [
        'git status --short --branch',
        'git log --oneline -5',
        'git pull origin main --allow-unrelated-histories',
        '',
        '# Conflicts are expected here; resolve them, then finish the merge.',
        '',
        '# The same commands work on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'git log --oneline shows commits from both histories in one graph.',
      'git status reports no unresolved conflicts.',
      'The files that matter still contain the work you expected to keep.',
    ],
    alternativeExplanations: [
      'The remote repository was created with a README or licence commit of its own.',
      'The local project was initialised separately and later pointed at that remote.',
      'A different remote or branch was named in the command by mistake.',
    ],
  })
}

function mergeConflict(file: string, reported: string): RuleNarrative {
  return narrative({
    likelyCause: `A merge started and stopped with conflicts: ${reported} Both sides changed the same part of ${file === '' ? 'a file' : file}, so Git wrote its two versions into the file with markers and left the decision to you. Nothing is lost at this point, but the merge stays unfinished until you resolve it and commit.`,
    debuggingSteps: [
      'Run git status to see every file Git marked as unmerged.',
      'Open each conflicted file and find the markers that separate the two versions.',
      'Read both sides against the reason each change was made, rather than picking the first block that looks newer.',
      'If the merge itself was a mistake, ending it returns the folder to the state before it started.',
    ],
    fix: {
      explanation:
        'Edit the file down to the lines you want, then remove every marker line: a leftover marker is a syntax error waiting to appear. Stage the resolved file and commit to finish the merge. Aborting is the reversible choice, and it throws away any edits you already made while resolving.',
      whereItMayApply:
        'Work in the repository while the merge is still in progress. The commit at the end records the resolution, so write the message as advice for the next reader.',
      exampleCode: [
        'git status',
        '# In the conflicted file, keep what you want and delete the marker',
        '# lines: <<<<<<< HEAD, =======, and >>>>>>> feature/login',
        'git add src/App.tsx',
        'git commit',
        '',
        '# To abandon the merge instead (this discards the edits you made',
        '# while resolving):',
        'git merge --abort',
        '',
        '# The same commands work on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'git status lists no files under Unmerged paths.',
      'Searching the resolved files for a marker line finds nothing.',
      'git log --oneline shows the merge commit and the tests or the app still run.',
    ],
    alternativeExplanations: [
      'Both branches edited the same lines after they split.',
      'A file was renamed on one side, so Git could not match the two versions.',
      'A previous merge was resolved and committed with the markers still in the file.',
    ],
  })
}

function mergeSummary(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `A merge stopped before it finished: ${reported} This line is Git telling you the outcome; the CONFLICT lines above it name the files that still need a decision.`,
    debuggingSteps: [
      'Run git status and read the Unmerged paths list; those are the files to open.',
      'Look for the CONFLICT lines in the output above this one, because they carry the file names.',
      'Resolve each conflicted file, then stage it.',
      'Finish with a commit so the merge is recorded.',
    ],
    fix: {
      explanation:
        'Resolve the conflicts Git marked, stage every file, and commit. Until you do, the repository stays mid-merge and other commands refuse to run.',
      whereItMayApply:
        'Run while the merge is still in progress in that repository folder.',
      exampleCode: [
        'git status',
        'git add <resolved file>',
        'git commit',
        '',
        '# To end the merge and go back to how the folder looked before it:',
        'git merge --abort',
        '',
        '# The same commands work on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'git status reports a clean working tree.',
      'No marker lines remain in the files that were conflicted.',
      'git log --oneline -1 shows the merge commit.',
    ],
    limitations: [
      'This line does not name the conflicted files, so read the lines above it.',
    ],
    alternativeExplanations: [
      'The conflicts are in files edited on both branches.',
      'A rename on one side left Git unable to match the files.',
      'An earlier interrupted merge left the repository in this state.',
    ],
  })
}

function localChanges(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `Git stopped a branch switch or a merge to protect uncommitted work: ${reported} The files listed under the message hold edits that are not in any commit yet, and the command would have replaced them. Git aborted, so nothing has changed.`,
    debuggingSteps: [
      'Run git status and read which files are modified.',
      'Open those files and decide whether the edits are still wanted.',
      'Check the size of the work: a few lines may be worth committing, while a half-finished feature usually wants a stash.',
      'Look for edits you did not make, such as generated files or formatting changes, and handle those separately.',
    ],
    fix: {
      explanation:
        'Put the edits somewhere they survive: commit them on the current branch, or stash them, switch, then bring them back. Do not throw the changes away to make the message disappear; they are the only copy of work that no commit holds yet.',
      whereItMayApply:
        'Run in the repository folder that produced the message. A stash is per repository, so switch back to the branch that stored it before popping.',
      exampleCode: [
        'git status --short',
        '# Keep the work, then switch:',
        'git stash push -m "work before switching"',
        'git checkout main',
        'git stash pop',
        '',
        '# Or commit it first, which is safer when the work is finished:',
        'git add <the files you changed>',
        'git commit -m "finish login changes"',
        'git checkout main',
        '',
        '# The same commands work on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'git stash list shows the entry you created, or git log shows the new commit.',
      'The branch switch or merge now completes without the message.',
      'git status --short lists the files you expected rather than lost work.',
    ],
    alternativeExplanations: [
      'Generated or formatted files changed when you ran a build or an editor saved.',
      'Edits were made on the wrong branch and now block the switch.',
      'A partial checkout from another branch left files modified.',
    ],
  })
}

function identity(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `Git would not create a commit because no author identity is configured: ${reported} Every commit records a name and an email, and Git refuses to guess them from the machine name. No commit was written.`,
    debuggingSteps: [
      'Check whether any identity is configured at all, globally or in this repository.',
      'Decide which email should appear on your commits; it is the address the hosting site links to your account.',
      'Note that a repository can carry its own identity that overrides the global one, which is common for work machines.',
      'Look at the last commit author to see what the folder has been using.',
    ],
    fix: {
      explanation:
        'Set the name and email once, or only for this repository. Use --global for your own machine and leave it out for a repository that needs a different address. Commits already made keep the identity they were written with; changing the configuration does not rewrite them, and rewriting history on a shared branch is not the fix for a wrong author.',
      whereItMayApply:
        'Run in the repository folder, or anywhere with --global. The values are stored in Git configuration, not in the project files.',
      exampleCode: [
        'git config --global user.email "you@example.com"',
        'git config --global user.name "Your Name"',
        'git config --global --list',
        '',
        '# For one repository only, drop --global and run inside it:',
        'git config user.email "you@work.example.com"',
        '',
        '# The same commands work on macOS and Linux.',
      ].join('\n'),
    },
    verificationSteps: [
      'git config --global user.email prints the address you set.',
      'The commit command completes and prints a new commit hash.',
      'git log -1 --format="%an <%ae>" shows the identity you chose.',
    ],
    alternativeExplanations: [
      'The machine is new, so no global configuration exists yet.',
      'A HOME or user profile change hid the configuration file.',
      'The repository was cloned from a folder whose configuration did not come with it.',
    ],
  })
}

function passwordAuth(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `The remote rejected an account password: ${reported} Hosting sites stopped accepting passwords over HTTPS, so an HTTPS remote now needs a token or a credential helper rather than the sign-in password.`,
    debuggingSteps: [
      'Check which remote URL you are using, because HTTPS and SSH authenticate differently.',
      'Look for a credential helper in the configuration; when it holds an old password it keeps sending it.',
      'Confirm the account you are signing in as, since a second account is a frequent cause of a refusal.',
      'Decide between a token, a credential helper, and an SSH key before changing anything.',
    ],
    fix: {
      explanation:
        'Authenticate with something revocable instead of a password: either a personal access token saved in a credential helper, or an SSH key added to the account. A token is a secret. Never paste a token into a file, a commit, an issue, a chat, or a screenshot, and do not put it in a remote URL; give it to the credential helper once so it is stored rather than repeated. Create the smallest-scope token you can and revoke it if it ever leaves your machine.',
      whereItMayApply:
        'Set the helper once per machine, then retry the command that failed. Switching a remote from HTTPS to SSH changes the URL, so note the old one first.',
      exampleCode: [
        'git remote -v',
        'git config --global credential.helper manager',
        '# Next HTTPS push asks once; choose the account in the sign-in window.',
        '',
        '# Or switch this repository to SSH and add a key to the account:',
        'ssh-keygen -t ed25519 -C "you@example.com"',
        'cat $env:USERPROFILE\\.ssh\\id_ed25519.pub',
        'git remote set-url origin git@github.com:dev/app.git',
        'ssh -T git@github.com',
        '',
        '# On macOS or Linux the key path is ~/.ssh/id_ed25519.pub,',
        '# and the helper is usually osxkeychain or libsecret.',
      ].join('\n'),
    },
    verificationSteps: [
      'The command that failed completes without an authentication message.',
      'ssh -T git@github.com prints a greeting naming your account, for an SSH remote.',
      'git remote -v still shows the repository you intended.',
    ],
    limitations: [
      'The engine cannot see the credentials configured on the machine, only the lines you pasted.',
    ],
    alternativeExplanations: [
      'A stored old password keeps being sent by the credential helper.',
      'The remote URL belongs to an account that has no access to that repository.',
      'The site asks for two-step verification, which a stored password cannot satisfy.',
    ],
  })
}

function authFailed(reported: string, url: string): RuleNarrative {
  return narrative({
    likelyCause: `Git could not authenticate to the remote${url === '' ? '' : ` at ${url}`}: ${reported} The credentials offered were missing, expired, or not accepted for that repository. The push or fetch did not change the remote, and local commits are safe.`,
    debuggingSteps: [
      'Confirm which remote URL the command used, because HTTPS and SSH need different credentials.',
      'Check the credential helper configuration to see what Git is able to offer.',
      'Verify the account you are signed in as has access to that repository.',
      'Look for a stored old password; helpers keep offering them until they are cleared.',
    ],
    fix: {
      explanation:
        'Give Git a credential it can use: a personal access token or the Git Credential Manager for HTTPS, or an SSH key added to the account for an SSH remote. A token is a secret. Never paste a token into a file, a commit, a chat, or a screenshot, and do not embed it in the remote URL; let the helper store it once. Use the narrowest scope that works and revoke the token if it has been shown anywhere.',
      whereItMayApply:
        'Configure per machine, then re-run the command that failed. Clearing a stored credential makes the next command prompt again.',
      exampleCode: [
        'git remote -v',
        'git config --global credential.helper manager',
        'git push',
        '',
        '# For an SSH remote instead:',
        'ssh -T git@github.com',
        'git remote set-url origin git@github.com:dev/app.git',
        '',
        '# On macOS or Linux the helper is usually osxkeychain or libsecret,',
        '# and the ssh -T check is the same.',
      ].join('\n'),
    },
    verificationSteps: [
      'The retried command completes and shows a commit range rather than a refusal.',
      'ssh -T git@github.com greets you by account name for an SSH remote.',
      'The commit you expected appears on the repository page.',
    ],
    alternativeExplanations: [
      'The token or key expired or was revoked.',
      'The sign-in account does not have write access to that repository.',
      'A proxy or a VPN intercepted the connection and the credentials never arrived.',
    ],
  })
}

function permissionDenied(reported: string, repo: string): RuleNarrative {
  return narrative({
    likelyCause: `The remote refused this account for ${repo === '' ? 'the repository' : repo}: ${reported} You authenticated successfully, but the account has no permission for that repository or that branch. Nothing was written to the remote.`,
    debuggingSteps: [
      'Find which account Git actually used, since a machine often holds more than one.',
      'Check your role on that repository and whether the branch is protected.',
      'Confirm the repository name; a fork or a renamed project produces the same refusal.',
      'Ask for access rather than trying to work around the refusal.',
    ],
    fix: {
      explanation:
        'Use the account that has access, or request access. Switching credentials is a configuration change, not a repair of the repository. A token is a secret: never paste a token into a file, a chat, or a commit, and do not put one in a remote URL.',
      whereItMayApply:
        'Run in the repository folder. Sign out of the stored credential first if Git keeps offering the wrong account.',
      exampleCode: [
        'git remote -v',
        'git config --global credential.helper manager',
        '# Clear the stored credential, then let the next command prompt:',
        'git credential-manager github logout',
        'git push',
        '',
        '# Or point the repository at a fork you do own:',
        'git remote set-url origin git@github.com:you/app.git',
        '',
        '# On macOS or Linux the commands match; logout differs per helper.',
      ].join('\n'),
    },
    verificationSteps: [
      'The prompt names the account you expected.',
      'git push completes and reports a commit range.',
      'The branch on the repository page shows your commit.',
    ],
    alternativeExplanations: [
      'Git used a second account stored on this machine.',
      'The branch is protected and only certain roles may push to it.',
      'The remote is a repository you can read but not write.',
    ],
  })
}

function httpDenied(reported: string, code: string): RuleNarrative {
  return narrative({
    likelyCause: `The HTTP request Git made was refused with ${code}: ${reported} The remote understood who asked but would not allow it, which is an access problem rather than a network failure.`,
    debuggingSteps: [
      'Identify the account Git authenticated as, because a wrong account is the usual cause.',
      'Check the role on that repository and whether the branch you pushed is protected.',
      'Confirm the URL points at the repository you intend, not a fork or an old name.',
      'Read the remote: lines above this one; they often name the account that was refused.',
    ],
    fix: {
      explanation:
        'Switch to the account that has access, or ask for access on the repository. A token is a secret: never paste a token into a file, a chat, or a commit; store it in the credential helper so it is not repeated. If the repository is one you own and the error persists, check whether the site requires a token with wider scope than the one stored.',
      whereItMayApply:
        'Run in the repository folder. Changing the helper or the URL affects this machine or this repository only.',
      exampleCode: [
        'git remote -v',
        'git config --global credential.helper manager',
        'git push',
        '',
        '# To use a fork you do have access to:',
        'git remote set-url origin https://github.com/you/app.git',
        '',
        '# On macOS or Linux the helper is osxkeychain or libsecret instead.',
      ].join('\n'),
    },
    verificationSteps: [
      'The push output shows a commit range rather than an error code.',
      'git log -1 --oneline matches the commit visible on the remote.',
      'A fetch of the same remote completes without a refusal.',
    ],
    alternativeExplanations: [
      'A stored credential belongs to a different account.',
      'The branch is protected against direct pushes.',
      'The token lacks the scope that write access requires.',
    ],
  })
}

function publicKeyDenied(reported: string): RuleNarrative {
  return narrative({
    likelyCause: `The SSH server refused the key offered for this connection: ${reported} Either no key the server knows was offered, or the key is not registered on the account that owns the repository.`,
    debuggingSteps: [
      'Ask SSH to show which keys it offers and why the server refuses them.',
      'Check whether a key exists on this machine at all.',
      'Confirm the key is added to the account that has access to the repository.',
      'Test the connection on its own, separately from the git command.',
    ],
    fix: {
      explanation:
        'Create a key if none exists, add the public half to the account, and keep the private half on the machine. The public file is the one meant to be shared; never paste a token, and never share the private key file either. If an agent is running, load the key into it so SSH offers it first.',
      whereItMayApply:
        'Run in a normal terminal on the machine that failed. Adding a public key to an account is a setting change on the hosting site, not a change to the repository.',
      exampleCode: [
        'ssh -T git@github.com',
        'ssh -vT git@github.com',
        'dir $env:USERPROFILE\\.ssh',
        '',
        '# If there is no key yet:',
        'ssh-keygen -t ed25519 -C "you@example.com"',
        'cat $env:USERPROFILE\\.ssh\\id_ed25519.pub',
        '# Add that public key to the account, then test again:',
        'ssh -T git@github.com',
        '',
        '# On macOS or Linux list with ls ~/.ssh and read the key from',
        '# ~/.ssh/id_ed25519.pub instead.',
      ].join('\n'),
    },
    verificationSteps: [
      'ssh -T git@github.com greets you by account name.',
      'The git command that failed now completes.',
      'git remote -v still names the repository you intended.',
    ],
    alternativeExplanations: [
      'The key was generated for another machine or another account.',
      'The SSH agent offers no key, or offers the wrong one first.',
      'A proxy or firewall blocks port 22 and the connection never reaches the server.',
    ],
  })
}

function srcRefspec(reported: string, branch: string): RuleNarrative {
  return narrative({
    likelyCause: `Git looked for a local ref called ${branch} and found none: ${reported} The name after src refspec is a branch you asked to push that does not exist here, most often because nothing has been committed yet or the branch has a different name.`,
    debuggingSteps: [
      'List the local branches to see what actually exists.',
      'Check whether the repository has any commit at all, since an empty one has no branch to push.',
      'Compare the name in the command with the name you are on, including capitalisation.',
      'Look at the working tree for files that were never staged.',
    ],
    fix: {
      explanation:
        'Either commit something first, since a branch exists only once a commit points at it, or push the branch you are really on. Setting the upstream with -u means later pushes need no arguments.',
      whereItMayApply: 'Run in the repository folder that produced the message.',
      exampleCode: [
        'git branch --show-current',
        'git branch',
        'git status --short',
        '',
        '# Empty repository: make the first commit, then push it.',
        'git add <the files you want>',
        'git commit -m "first working version"',
        'git push -u origin main',
        '',
        '# On macOS or Linux the commands are the same.',
      ].join('\n'),
    },
    verificationSteps: [
      'git branch lists the branch you meant to push.',
      'git log --oneline -1 prints a commit rather than an unknown revision.',
      'The push completes and prints a new branch on the remote.',
    ],
    alternativeExplanations: [
      'The command named a branch that was never created or was renamed.',
      'A fresh repository has no commits, so no branch exists yet.',
      'The command ran in a different folder than the project you meant.',
    ],
  })
}

function dubiousOwnership(reported: string, path: string): RuleNarrative {
  return narrative({
    likelyCause: `Git refused to work on the folder because its owner differs from the user running the command: ${reported} This check protects you from opening a repository that someone else placed where you would run commands in it. It is common when a folder was created by another account, by an administrator prompt, or by a different system that shares the disk.`,
    debuggingSteps: [
      'Check who owns the folder and who you are running as.',
      'Ask whether this is a folder you created and trust, such as your own project on your own machine.',
      'Look for the usual cause: an editor or a build tool that ran as a different user.',
      'Decide whether the folder is genuinely yours before telling Git to accept it.',
    ],
    fix: {
      explanation: `For a folder you own and trust, add ${path === '' ? 'that one path' : path} with git config --global --add safe.directory. Use the exact path, not a wildcard: safe.directory * turns the check off for every folder on the machine, so an untrusted repository would be accepted as well. Never use it for a folder you did not create, a download, or a mounted or shared directory; the check exists to stop those cases, and repairing the ownership is the better fix when the folder is simply owned by the wrong account.`,
      whereItMayApply:
        'Run once per machine for each folder you trust. The setting lives in your global Git configuration, not in the project.',
      exampleCode: [
        'git config --global --add safe.directory C:/Users/dev/project',
        'git status',
        '',
        '# Preferable when the ownership is simply wrong: take the folder back.',
        '# Run from an elevated prompt, and only for a folder you own:',
        'takeown /f C:\\Users\\dev\\project /r /d y',
        '',
        '# On macOS or Linux the exception is the same command with the POSIX',
        '# path, and ownership is repaired with sudo chown -R "$USER" instead.',
      ].join('\n'),
    },
    verificationSteps: [
      'git status runs in that folder without the ownership message.',
      'git config --global --get-all safe.directory lists only the paths you chose.',
      'The commands you meant to run now complete normally.',
    ],
    limitations: [
      'The engine cannot see the folder owner, so it cannot confirm the repository is yours.',
    ],
    alternativeExplanations: [
      'An administrator or another account created the folder.',
      'The project sits on a mounted volume or a shared drive that reports another owner.',
      'A container or a second system on the same disk wrote the files.',
    ],
  })
}

function indexLock(reported: string, path: string): RuleNarrative {
  return narrative({
    likelyCause: `Git could not start because the index lock file is already there: ${reported} One Git command takes this lock while it rewrites the index, and a second command refuses to run beside it. It usually means another process is working in the repository right now, or an earlier command was killed and left the file behind.`,
    debuggingSteps: [
      'Look for other Git activity first: an editor, a GUI client, an IDE indexing the project, or a terminal running a long command.',
      'Wait for that command to finish and try again; the lock goes away by itself when it does.',
      'Check whether a Git process is still running before touching the file.',
      'Confirm the file is still there after you close the other programs.',
    ],
    fix: {
      explanation:
        `Close the other Git processes first and re-run your command; that resolves most cases with no risk. Delete ${path === '' ? 'the lock file' : path} only when you are sure no Git process is running, because removing it while a command is mid-write can leave the index broken. Deleting the lock does not delete commits or file contents; it only removes the flag.`,
      whereItMayApply:
        'Run in the repository folder. If a command is genuinely still running, wait instead of deleting.',
      exampleCode: [
        'tasklist | findstr /i git',
        'dir .git\\index.lock',
        '',
        '# Only when the two commands above show no Git process is running:',
        'del .git\\index.lock',
        '',
        '# PowerShell instead of cmd:',
        'Remove-Item .git\\index.lock',
        '',
        '# On macOS or Linux, after checking with ps aux | grep git:',
        'rm .git/index.lock',
      ].join('\n'),
    },
    verificationSteps: [
      'The original command completes without mentioning index.lock.',
      'git status runs normally and lists the expected files.',
      'The lock file is gone from the .git folder and does not reappear immediately.',
    ],
    limitations: [
      'The engine cannot see running processes, so it cannot tell whether a Git command still holds the lock.',
    ],
    alternativeExplanations: [
      'An editor or GUI client is running a Git operation in the background.',
      'A previous command was interrupted by a crash or a forced stop.',
      'Two terminals in the same project started commands at the same moment.',
    ],
  })
}

function lineEndings(reported: string, from: string, to: string): RuleNarrative {
  return narrative({
    likelyCause: `Git is only reporting how it will normalise line endings: ${reported} ${from} and ${to} are the two ways a line break is written, and Git stores one of them and checks files out in the other. The file is not damaged, nothing is broken, and the change you staged is still the change you made.`,
    debuggingSteps: [
      'Read the file name in the message; the warning applies to that file only.',
      'Check the setting that produced the behaviour.',
      'Look at the diff before committing to confirm only the content changed.',
      'Decide whether the project should pin line endings for everyone.',
    ],
    fix: {
      explanation:
        'Nothing needs fixing, so the first option is to ignore the warning. If it is noise for your team, set core.autocrlf on your machine or commit a .gitattributes file, which is the better choice because it applies to everyone who clones. Be aware that a renormalisation pass rewrites files across the project, so make it its own commit and tell the people working with you.',
      whereItMayApply:
        'The local setting applies to your machine. The attributes file applies to the repository, so it is a change other people will see.',
      exampleCode: [
        'git config --global core.autocrlf true',
        '',
        '# Or pin it in the repository so every clone behaves the same.',
        '# Create .gitattributes with this line, then commit it:',
        '* text=auto',
        'git add .gitattributes',
        'git commit -m "normalise line endings"',
        '',
        '# On macOS or Linux use core.autocrlf input instead of true.',
      ].join('\n'),
    },
    verificationSteps: [
      'The commit completes and git status is clean.',
      'The file still opens and runs as before.',
      'git config --global core.autocrlf prints the value you chose.',
    ],
    alternativeExplanations: [
      'The project has no attributes file, so Git falls back to your machine setting.',
      'Files were created on another system with the other line ending.',
      'An editor is configured to write the opposite style from the repository default.',
    ],
  })
}

function networkFailure(reported: string, detail: string): RuleNarrative {
  return narrative({
    likelyCause: `Git could not reach the remote: ${reported} The part that matters is ${detail}: the connection to the server did not complete, so nothing was sent and no commit changed.`,
    debuggingSteps: [
      'Check that the machine has an internet connection at all, in a browser or with the name lookup below.',
      'Look for a VPN, a proxy, or a firewall that blocks outbound connections.',
      'Confirm the remote URL is the host you expect.',
      'Retry once after a short wait; a transient failure clears on its own.',
    ],
    fix: {
      explanation:
        'Restore the path to the server rather than changing the repository. If a proxy is required on your network, tell Git about it; if the network is fine and the failure repeats, try the other transport, since SSH and HTTPS use different ports and a block on one often leaves the other open.',
      whereItMayApply:
        'The proxy setting is per machine. Removing it later returns Git to a direct connection.',
      exampleCode: [
        'nslookup github.com',
        'ping github.com',
        'git remote -v',
        '',
        '# When your network requires a proxy:',
        'git config --global http.proxy http://127.0.0.1:8080',
        '',
        '# To undo it again:',
        'git config --global --unset http.proxy',
        '',
        '# On macOS or Linux use host github.com or dig instead of nslookup.',
      ].join('\n'),
    },
    verificationSteps: [
      'nslookup or host prints an address for the remote.',
      'The retried command reaches the server and completes.',
      'git remote -v still names the repository you expected.',
    ],
    alternativeExplanations: [
      'The machine is offline or the network is still reconnecting.',
      'A VPN or corporate proxy is intercepting the connection.',
      'DNS on this network cannot resolve the hosting site.',
    ],
  })
}

function genericFatal(detail: string): RuleNarrative {
  const reported = `"${detail}"`

  return {
    likelyCause: `Git stopped with ${reported}, and no specific rule covers that wording yet. The line names what Git could not do, not why, so this report quotes it instead of claiming a cause.`,
    debuggingSteps: [
      `Read the lines directly above and below ${reported}: Git usually prints a remote: or hint: line that says what it tried to do.`,
      'Run git status in the same folder to see the branch you are on and what the index and working tree hold.',
      'Note the exact command you ran, because the same fatal line means different things after a clone, a push, or a rebase.',
      'Re-run the command once and paste the whole block, including any hint: lines, so the diagnosis can follow a line a rule covers.',
    ],
    possibleFix: {
      explanation: `No fix is offered, because no sub-signature recognises ${reported} and the message alone does not say what Git was trying to do. Narrow the cause before changing anything: run git status to see where you are, then read the hint: lines Git printed under the error, which name the command it suggests.`,
      whereItMayApply:
        'Run both commands in the same folder and with the same command you ran when the error appeared; nothing here changes the repository.',
      exampleCode: [
        'cd C:\\Users\\dev\\project',
        'git status',
        'git status --short --branch',
        '',
        '# On macOS or Linux, from the folder the command ran in:',
        'cd ~/project',
        'git status',
      ].join('\n'),
    },
    verificationSteps: [
      'Re-run the same command and check whether the identical fatal line appears.',
      'If Git now reports a different line, paste that one: the report follows whichever line it can read.',
      'Confirm git status is clean before trying the original command again.',
    ],
    limitations: [
      'No sub-signature covers this message, so the engine does not claim a cause or suggest a fix.',
      'Git rewords its messages between versions, so the same problem can appear under another fatal line.',
    ],
    alternativeExplanations: [
      'The command was run in a folder that is not the repository the command expects.',
      'An earlier command left the repository half-finished, such as an interrupted merge or rebase.',
      'The remote, a file, or an object the command needed is missing or unreadable.',
    ],
  }
}

export const neutralRules: readonly DiagnosticRule[] = [gitErrorRule()]
