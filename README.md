# BugPilot

BugPilot is a local-first bug tracker and debugging assistant that runs entirely in the browser. It is built for capturing a reproducible bug report, keeping a searchable triage log, recording a fix through manual states, and getting rule-based hints from pasted Python or JavaScript error text. There is no account, backend, cloud database, telemetry, or AI API: saved reports and the theme preference stay in this browser, and the assistant analyses pasted text in the page without sending or storing it.

This repository contains a working MVP, not a hosted product. See [Limitations](#limitations) for what is intentionally out of scope.

## What works today

- **Overview dashboard** with live counts for total reports, open reports, in-progress reports, resolved reports, and high/critical reports, plus the five most recent reports.
- **Bug log** with full-text search, severity/status/project filters, five sort orders, a live result count, and a clear-filters control.
- **Report workflow**: create, view, edit, and delete reports, with a permanent-delete confirmation dialog.
- **Validation**: title, project, language, and description are required; each field has a length limit; a fix status requires a proposed fix; `Verified` additionally requires verification notes.
- **Fix tracking**: `Proposed`, `Accepted`, `Rejected`, and `Verified` are manual states. BugPilot never verifies a fix automatically. A bug's workflow status (`Open`, `In Progress`, `Resolved`, `Closed`) is separate from its fix status.
- **Local persistence** in `localStorage`, including first-run sample reports and a recovery copy when stored JSON is unreadable. The original stored value is not overwritten when it cannot be read.
- **Debug Assistant** at `/assistant`, backed by a local rule engine with 11 Python rules and 3 JavaScript rules. It returns a category, confidence, evidence, debugging steps, a possible fix, verification steps, limitations, and alternatives.
- **Light and dark themes**, seeded from the system preference on first visit and saved after the user toggles.
- **Accessibility and interaction details**: skip link, labelled controls, focus-visible styling, focus-trapped delete dialog, status announcements, auto-dismissing toast, and a WCAG contrast test for the theme tokens.
- **Rotating footer joke**: one joke per page, changing every 60 seconds and after a reload or return to the page.

## Screenshots

Dashboard, light theme:

![BugPilot overview in the light theme with five seeded reports, status counts, and recent reports.](docs/screenshots/dashboard-light.png)

Dashboard, dark theme:

![BugPilot overview in the dark theme with the same counts and recent reports.](docs/screenshots/dashboard-dark.png)

Bug log, dark theme:

![BugPilot bug log in the dark theme with search, severity, status, project, and sort controls above a table of reports.](docs/screenshots/bug-log-dark.png)

Bug detail, light theme:

![BugPilot bug detail in the light theme showing a report with its error message, reproduction steps, and fix tracking.](docs/screenshots/bug-detail-light.png)

Debug Assistant with a Python result, light theme:

![BugPilot Debug Assistant in the light theme showing a high-confidence Missing module diagnosis for a Python ModuleNotFoundError.](docs/screenshots/assistant-result-light.png)

Debug Assistant with a Python result, dark theme:

![BugPilot Debug Assistant in the dark theme showing the same Missing module result and evidence.](docs/screenshots/assistant-result-dark.png)

Dashboard at 390px, dark theme:

<img src="docs/screenshots/dashboard-dark-390.png" alt="BugPilot dashboard at 390 pixels wide in the dark theme, with a compact header, stacked navigation, and a two-column stat grid." width="390" />

The screenshots show the five fictional sample reports created on a first run. They are not real user data.

## Tech stack

| Layer | Choice |
| --- | --- |
| UI | React 19.3.1 and React DOM 19.3.1 |
| Language | TypeScript 6.0.3 |
| Build tool | Vite 8.3.5 |
| Routing | React Router DOM 7.18.4 |
| Icons | Lucide React 1.61.0 |
| Fonts | Fontsource variable packages for Archivo, Instrument Sans, and JetBrains Mono |
| Styling | Hand-written CSS with custom properties; no CSS framework |
| Tests | Vitest 5.0.5, Testing Library, jsdom 30.1.3 |
| Linting | oxlint 1.88.0 |
| Storage | Browser `localStorage` and `sessionStorage` only |

## Requirements

- **Node.js** `^20.19.0` or `>=22.12.0`. That range comes from Vite 8.3.5, which this project uses.
- **npm**, included with Node.js.
- A modern Chromium-based browser (Chrome or Edge). The app has been tested on Windows with Chromium; it has not been tested in Firefox, Safari, or on physical mobile devices.

The documentation and test run reported here used Node.js `v24.21.0` and npm `11.19.0` on Windows. No API keys, accounts, databases, or external services are needed.

## Install and run

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. To use the fixed port used for the documentation checks:

```bash
npm run dev -- --port 5180 --strictPort
```

Then open `http://localhost:5180`. `--strictPort` makes the command fail instead of silently choosing another port.

`npm install` is only needed the first time, or after dependencies change. It reads the committed `package-lock.json` versions.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite development server with hot module replacement. |
| `npm run dev -- --port 5180 --strictPort` | Starts the development server on the fixed port used in this documentation. |
| `npm test` | Runs the Vitest suite once. The project is configured to run test files serially on this Windows machine; see [Windows notes](#windows-notes). |
| `npm run lint` | Runs oxlint over the project. |
| `npm run build` | Runs the TypeScript project build, then creates the production bundle in `dist/`. |
| `npm run preview` | Serves an existing `dist/` build. Run `npm run build` first. |
| `npm run preview -- --port 4173 --strictPort` | Serves the production build on the fixed preview port used in this documentation. |

All commands above, except `npm install` (dependencies were already installed) and the bare `npm run preview` (verified through the same preview server with explicit port flags), were run while preparing this README.

## Production preview

```bash
npm run build
npm run preview -- --port 4173 --strictPort
```

Open `http://localhost:4173`. A preview server is a separate browser origin from the development server, so `localhost:4173` and `localhost:5180` have separate `localStorage` data and separate sample reports. Refresh a deep route such as `/bugs` to confirm the preview server serves the single-page app for client-side routes.

## Routes

| Route | Page |
| --- | --- |
| `/` | Overview dashboard with live stats and recent reports |
| `/bugs` | Bug log with search, filters, sorting, and report links |
| `/bugs/new` | New bug report form |
| `/bugs/:bugId` | Bug detail with quick status changes, edit, and delete |
| `/bugs/:bugId/edit` | Edit form for an existing report |
| `/assistant` | Local Debug Assistant |
| `*` | Page-not-found screen with a link back to the overview |

Routes are declared in `src/App.tsx`.

## Architecture

### Source tree

```text
src/
├─ app/            Workspace context: loads state, exposes bug actions, and owns toast notifications
├─ components/     Shared layout, badges, delete dialog, toast, and rotating footer joke
├─ content/        Static joke sets for each page key
├─ diagnostics/    Diagnostic types, matching engine, rule tests
│  └─ rules/       Python and JavaScript diagnostic rules
├─ features/
│  ├─ bugs/        Bug types, samples, validation, storage, querying, and the workspace hook
│  ├─ footer/      Joke selection, 60-second rotation, and sessionStorage handling
│  └─ theme/       Theme resolution, persistence, and the WCAG contrast test
├─ pages/          Route-level pages for the dashboard, log, form, detail, assistant, and 404
├─ test/           Vitest setup and shared test factories
├─ App.tsx         Route table and optional footer-joke interval configuration
├─ App.css         Amber & Charcoal theme, layout, and component styles
├─ index.css       Theme tokens, fonts, and global base styles
└─ main.tsx        React entry point
```

Test files live beside the module they test. For example, the Python rules live in `src/diagnostics/rules/python.ts` and are tested in `src/diagnostics/python-rules.test.ts`.

### How the main pieces are organised

**Bug storage.** `src/features/bugs/storage.ts` owns the `bugpilot.bugs.v1` key. The stored value is a JSON object with a `schemaVersion` and a `bugs` array. On load, every record is validated again; invalid records are skipped. If the whole value is unreadable JSON or has the wrong shape, the app shows a "Saved data needs attention" notice, leaves the original key untouched, and writes a best-effort copy to `bugpilot.bugs.recovery.v1`. When the key is absent, five fictional sample reports are created and saved. Saves write the complete array; there is no server copy.

**Validation.** `src/features/bugs/validation.ts` is the single source of truth for field rules. It checks the four required fields, enforces per-field character limits, requires a proposed fix whenever a fix status is set, and requires verification notes for `Verified`. The form uses these errors for inline messages and a summary; storage parsing also calls the same validation so malformed saved records are not displayed.

**Fix states.** Fix status is an optional field on a bug, not a derived value. `src/pages/BugFormPage.tsx` edits it; `src/pages/BugDetailPage.tsx` displays it and allows quick changes to the separate workflow status. Marking a fix `Verified` is always a manual action, and the selected fix status is never inferred from the fix text or from the assistant. `Accepted` means the proposed fix was accepted; `Verified` means the user also recorded how it was checked.

**Themes.** `src/index.css` defines the light theme on `:root` and the dark overrides on `:root[data-theme='dark']`. `src/features/theme/theme.ts` resolves the initial theme from `bugpilot.theme.v1`, falling back to `prefers-color-scheme`. `src/features/theme/useTheme.ts` applies `data-theme` and `color-scheme` to the document root and saves later changes. `src/features/theme/contrast.test.ts` checks the text, badge, border, and focus-ring token pairs against WCAG AA contrast ratios.

**Footer jokes.** `src/content/footerJokes.ts` holds four jokes for each of six page keys. `src/features/footer/footerJoke.ts` maps a pathname to a page key, avoids choosing the same joke twice in a row when alternatives exist, and stores the last index in `sessionStorage` under `bugpilot.footerJoke.<pageKey>` (with an in-memory fallback when storage is blocked). `src/components/FooterJoke.tsx` rotates the joke every 60 seconds. `src/App.tsx` accepts an optional `VITE_FOOTER_JOKE_INTERVAL_MS` environment override for development, but the default is 60 seconds.

**Diagnostics.** `src/diagnostics/types.ts` defines the rule contract and result shape. `src/diagnostics/engine.ts` selects the final exception line, infers a language when needed, runs the registered rules, chooses the most specific match, and builds confidence, evidence, and fallback output. `src/diagnostics/rules/python.ts` and `src/diagnostics/rules/javascript.ts` contain the 14 rules and register them in the exported `pythonRules` and `javascriptRules` arrays. `src/pages/AssistantPage.tsx` is only the UI: it holds pasted text in component state and calls `diagnose()` in the browser.

## How the diagnostic engine works

### Input

The assistant calls `diagnose()` with:

| Field | Required | Purpose |
| --- | --- | --- |
| `language` | Yes | `auto`, `python`, or `javascript`. `auto` infers a runtime from traceback or stack-frame clues. |
| `errorText` | Yes | The error line or full traceback. This is the only field used to select the exception line. |
| `codeSnippet` | No | Used only to quote a related line as extra evidence. It is never executed or parsed. |
| `reproductionDetails` | No | Used as additional language clues when `language` is `auto`; not used as evidence. |

The engine looks for the last exception-shaped line in `errorText`, then falls back to the last non-empty line. A leading `Uncaught` or `Uncaught (in promise)` prefix is stripped before rule matching.

### Output

`DiagnosticResult` contains:

| Field | Meaning |
| --- | --- |
| `category` | One of the supported categories below, or `unrecognized`. |
| `matchedSignature` | The rule's human-readable signature, or `null` when nothing matched. |
| `likelyCause` | A plain-language explanation written by the matched rule. |
| `evidence` | The selected exception line with its line number, plus a matching line from the supplied code snippet when a captured value appears in it. |
| `debuggingSteps` | Ordered next steps. |
| `possibleFix` | `{ explanation, whereItMayApply, exampleCode }`, or `null` for an unrecognised input. |
| `verificationSteps` | A checklist the user can tick in the current session. The checkboxes do not verify a fix. |
| `confidence` | `{ level: 'low' \| 'medium' \| 'high', reason }`. |
| `limitations` | What the rule and engine cannot see. Every result also states that the guidance is local and rule-based. |
| `alternativeExplanations` | Other plausible causes for the same signature. |

Supported categories are `missing-module`, `import-failure`, `undefined-name`, `type-mismatch`, `missing-attribute`, `missing-key`, `index-out-of-range`, `missing-file`, `permission-denied`, `syntax-error`, and `indentation-error`.

### Matching, confidence, and evidence

- Rules use anchored regular expressions against the selected exception line. A rule returns `null` when the line is not an exact match, and returns a `signature`, a `specificity` of `specific` or `generic`, and any captured values.
- The engine evaluates rules for both languages. An explicit language wins when a rule in that language matches. With `auto`, weighted traceback and stack-frame clues choose the runtime; a more specific signature can override a weak clue, and conflicting evidence lowers confidence.
- Confidence is `high` for a specific signature with an explicit language or supporting trace evidence, `medium` for a generic signature with those clues or a specific signature without them, and `low` when the evidence conflicts or no rule matched. The exact reason is always shown next to the badge.
- For a matched result, evidence includes the selected exception line and its line number. If a code snippet is supplied, the first line containing a captured value (at least three characters, excluding free-text `detail` and `reason` fields) is added as a second evidence item. An unrecognised result has no evidence because no rule matched.
- If two matching rules have the same specificity, the earlier rule in the relevant rule array wins. New rules should therefore be specific enough to beat an existing generic fallback, or be placed deliberately.

### Unrecognised input and limits

- Empty error text is rejected by the form before analysis.
- Input longer than **20,000 characters** is not analysed. The assistant shows the current character count and an over-limit error, and the engine itself also refuses oversized input instead of truncating it.
- If no readable exception line exists, no supported signature matches, or `auto` cannot resolve a signature shared by both languages, the result is `unrecognized` with `matchedSignature: null`, no possible fix, low confidence, general debugging and verification steps, and an explicit limitation. The assistant does not invent a cause.
- Malformed direct calls to `diagnose()` are handled without throwing and return an unrecognised result.

## How to add a new diagnostic rule

The rule contract is `DiagnosticRule` in `src/diagnostics/types.ts`. A rule belongs to exactly one language (`python` or `javascript`) and one supported category.

1. **Pick the language, category, and exact signature.** The category must already exist in `SupportedDiagnosticCategory`; adding a new category means updating the type, the assistant's category labels, and any category-specific presentation.
2. **Add the rule to the correct file.** Python rules go in `src/diagnostics/rules/python.ts`; JavaScript rules go in `src/diagnostics/rules/javascript.ts`.
3. **Implement `match(line)`.** Anchor the expression so prose mentions and lookalike lines do not match. Return `null` when the line is not a match. When it matches, return a stable `signature`, the correct `specificity`, and only the captures the explanation needs.
4. **Implement `explain(match, context)`.** Return `likelyCause`, `debuggingSteps`, a complete `possibleFix` (`explanation`, `whereItMayApply`, `exampleCode`), `verificationSteps`, `limitations`, and `alternativeExplanations`. Keep the example code illustrative; the app never runs it.
5. **Register the rule.** Add the exported rule object to the `pythonRules` or `javascriptRules` array at the bottom of the file. That array is what the engine reads.
6. **Add tests beside the existing rule tests.** For Python, extend `src/diagnostics/python-rules.test.ts`; for JavaScript, extend `src/diagnostics/javascript-rules.test.ts`. Add at least:
   - a direct match test: `expect(rule.match(line)).not.toBeNull()`;
   - an engine test: `diagnose({ language: 'python', errorText: line })` returns the expected category, a non-null signature, a possible fix, and non-low confidence;
   - a **false-positive test** for a nearby but different signature and for the same words inside a prose sentence, both of which must return `null`;
   - a check that the final text is not treated as a different language when the language is explicit.
7. **Run the focused tests, then the full checks.**

```bash
npm test -- src/diagnostics/python-rules.test.ts
npm test
npm run lint
npm run build
```

### Example rule (illustrative only)

This rule is **not** part of the current app. It shows the shape of a complete, specific Python rule that would extend the existing generic `SyntaxError` fallback.

```ts
import type { DiagnosticRule, RuleMatch, RuleNarrative } from '../types'

const F_STRING_ERROR = /^SyntaxError:\s+f-string: expecting '([^']+)'/

export const pythonFStringSyntaxErrorRule: DiagnosticRule = {
  id: 'python.f-string-syntax-error',
  language: 'python',
  category: 'syntax-error',
  match(line: string): RuleMatch | null {
    const matched = F_STRING_ERROR.exec(line)
    if (!matched) {
      return null
    }

    return {
      signature: "SyntaxError: f-string: expecting '<token>'",
      specificity: 'specific',
      captures: { token: matched[1] },
    }
  },
  explain(match: RuleMatch): RuleNarrative {
    const token = match.captures.token

    return {
      likelyCause: `Python reached the end of an f-string before finding ${token}, so the string or expression is incomplete.`,
      debuggingSteps: [
        'Find the f-string on the line Python reports.',
        `Check that braces are balanced and that ${token} closes the expression.`,
        'Check nested quotes, because an early quote can end the string unexpectedly.',
      ],
      possibleFix: {
        explanation:
          'Complete the f-string expression, or move the expression into a named value before formatting it.',
        whereItMayApply:
          'Apply this to the reported f-string only; do not rewrite unrelated string formatting.',
        exampleCode: 'name = "Ada"\nprint(f"Hello, {name}")',
      },
      verificationSteps: [
        'Run the same file again with the same Python interpreter.',
        'Check that the syntax error is gone and the formatted value is correct.',
      ],
      limitations: [
        'The error can point at the opening brace rather than the missing token.',
        'This engine cannot parse the surrounding Python file.',
      ],
      alternativeExplanations: [
        'A nested quote ended the string early.',
        'A copy-paste left out part of the expression.',
      ],
    }
  },
}
```

After adding a rule like this to the `pythonRules` array, a false-positive test must prove that nearby input such as `SyntaxError: invalid syntax` and a prose sentence containing `f-string: expecting '}'` do **not** match. The generic Python `SyntaxError` rule may still handle the first line through the engine; the new rule must not claim it.

## Privacy and safety

- **Everything is local.** The app has no backend, login, cloud database, analytics, telemetry, service worker, or external AI call. Fonts and icons are bundled by the build; the app does not need a network request after the page and assets load.
- **Saved browser data.** `localStorage` uses these keys:
  - `bugpilot.bugs.v1` — the saved bug reports.
  - `bugpilot.bugs.recovery.v1` — a best-effort copy of raw stored text when the app cannot read it. It is not an automatic backup of healthy data.
  - `bugpilot.theme.v1` — the selected light or dark theme.
- **Session-only data.** Footer joke indices use `sessionStorage` keys named `bugpilot.footerJoke.<pageKey>`. They store an index, not page content.
- **Assistant text is not saved.** Pasted error text, code snippets, reproduction details, and results are held in React component state for the current tab session. They are never written to localStorage, sessionStorage, a bug report, or any server. Refreshing or closing the tab discards them.
- **No code execution.** BugPilot never executes submitted code, runs shell commands, installs packages, or modifies files on the user's computer. The diagnostic engine only pattern-matches text.
- **Suggestions are not proof.** Possible fixes, debugging steps, and verification checklists are displayed text. The app does not apply a suggested change or mark a fix as verified. The user must make and verify changes outside BugPilot and record the result manually.
- **Local does not mean encrypted.** Anyone with access to the browser profile can read the saved reports. Use a device and browser profile you trust, and do not treat this as secure storage for secrets.
- **Deletion is permanent.** Deleting a report removes it from the browser's stored array immediately; there is no undo. Export/backup is not implemented.

## Limitations

- The diagnostic engine is strict and rule-based. It recognises the documented signatures and categories only; it is not a general log parser or an AI model.
- It analyses the final exception line, with optional code-snippet evidence and language clues from reproduction details. It cannot inspect the source tree, installed packages, virtual environments, `PATH`, environment variables, browser globals, or the rest of the stack.
- There are no Node.js or `PATH`-specific diagnostic rules. JavaScript runtime errors can still match the three JavaScript rules.
- Unrecognised input is reported plainly with general steps; no cause or fix is guessed.
- Error text is capped at 20,000 characters.
- Reports live in one browser origin. Clearing site data, using a different browser profile, or switching between the dev and preview ports hides the reports saved under the other origin. There is no export, import, backup, sync, or multi-user support.
- Fixes are never verified automatically, and the app does not run the user's code to verify anything.
- No backend, authentication, cloud storage, external AI provider, deployment, or hosting is included.
- Browser testing has been done on Chromium on Windows only. Firefox, Safari, and physical mobile devices are not covered.
- Automated tests run in jsdom; they do not replace the manual browser checks in [docs/MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md).

## Windows notes

The Vitest configuration in `vite.config.ts` is tuned for this Windows machine:

```ts
test: {
  environment: 'jsdom',
  setupFiles: './src/test/setup.ts',
  restoreMocks: true,
  testTimeout: 60000,
  fileParallelism: false,
  pool: 'threads',
}
```

Forked worker processes intermittently missed the startup timeout on this machine. Using the threads pool keeps per-file isolation without spawning processes, and `fileParallelism: false` runs test files one at a time. The higher `testTimeout` gives the UI tests room on a busy machine; it does not change application behavior.

To revert to Vitest's defaults, remove `fileParallelism: false`, `pool: 'threads'`, and `testTimeout: 60000` from the `test` block (the default pool is `forks`). Re-run `npm test` and confirm that the suite still passes on the target machine before keeping the change. Do not disable tests or weaken assertions to work around a startup timeout.

## Future work (not implemented)

None of the following exists in the current app:

- JSON import/export, backup/restore, or any sync between browsers.
- Additional diagnostic rules, including Node.js and `PATH`-specific cases.
- Integration with test-runner or CI output.
- An optional external AI provider. Any such provider would need to be opt-in, clearly disclosed, and reviewed for the project's no-transmission constraint; no provider is configured now.
- Deployment, hosting, CI, authentication, multi-user use, or a database.
- A committed Playwright or cross-browser end-to-end suite.

## Manual test checklist

Use [docs/MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md) for a copy-paste, check-box pass through setup, first-run seeding, dashboard, bug CRUD, search/filter/sort, fix states, themes, the Debug Assistant, the joke footer, toast behavior, keyboard navigation, responsive layouts, corrupted storage, and the production preview.
