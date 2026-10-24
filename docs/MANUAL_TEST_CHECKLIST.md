# BugPilot manual test checklist

Use this checklist to verify the app in a real browser. Every item has an action and an expected result. Tick each box only after you observe the result.

The checklist is written for Windows and a Chromium-based browser (Chrome or Edge). Use a **disposable browser profile** for the first-run and corrupted-storage tests. Deleting site data removes saved reports, so do not run the destructive steps in a profile that contains reports you want to keep.

Record the run:

| Item | Value |
| --- | --- |
| Date | |
| Browser and version | |
| Operating system | |
| Node.js version (`node -v`) | |
| Tester | |

## 0. Setup

- [ ] Create or switch to a disposable Chromium profile for the first-run tests.
- [ ] In a terminal, go to the project folder:
  ```bash
  cd "C:\Users\great\Music\BUGPILOT 1\bugpilot"
  ```
- [ ] Install dependencies only if `node_modules` is missing:
  ```bash
  npm install
  ```
- [ ] Start the development server on a fixed port:
  ```bash
  npm run dev -- --port 5180 --strictPort
  ```
- [ ] Open `http://localhost:5180`.
- [ ] Open DevTools and keep the Console and Network tabs available. Clear the Console before starting.
- [ ] Expected: the page title is **BugPilot — Local bug tracker**; the sidebar says **Local-only workspace** and **Reports stay in this browser. Nothing is uploaded.**
- [ ] Expected: the Console has no errors, and the Network tab has no requests to external hosts. Vite's own local WebSocket connection is expected in development.

## 1. First-run seeding

- [ ] With no saved BugPilot data for this origin, load the app.
- [ ] Expected: a notice headed **Sample workspace loaded.** explains that fictional reports are provided and can be edited or deleted.
- [ ] Expected: the Overview stat strip shows **05 Total bugs**, **02 Open**, **01 In progress**, **01 Resolved**, and **02 High and critical**.
- [ ] Open **Bug log** and expected: five rows are listed.
- [ ] In the Console, run:
  ```js
  JSON.parse(localStorage.getItem('bugpilot.bugs.v1')).bugs.length
  ```
  Expected: `5`.
- [ ] Reload the page.
- [ ] Expected: the five reports remain, and the **Sample workspace loaded.** notice is gone. (It describes the seeding event for the current session.)

## 2. Dashboard

- [ ] Open **Overview**.
- [ ] Expected: **Recent reports** lists five reports, newest first: *Checkout total shows NaN after a promo code*, *CSV export stalls on tables over 50,000 rows*, *Invitation email skipped for plus-addressed users*, *Avatar fallback flickers after refresh*, and *Search ignores hyphenated project names*.
- [ ] Click a recent report title. Expected: the matching detail page opens at `/bugs/<id>`.
- [ ] Return to **Overview** and click **View bug log**. Expected: `/bugs` opens.
- [ ] Click **Report a bug**. Expected: `/bugs/new` opens.
- [ ] Expected: the note below the recent list says a fix is only marked **Verified** when the user records it, and that BugPilot never verifies a fix on its own.

## 3. Search, filters, and sort

Start this section with the five sample reports and no extra reports. If you have already added reports, use a fresh profile or expect different counts.

- [ ] Open **Bug log**.
- [ ] Type `NaN` in **Search bugs**.
  - Expected: **Showing 1 of 5 reports**; only *Checkout total shows NaN after a promo code* is listed.
- [ ] Clear the search and expected: **Showing 5 of 5 reports**.
- [ ] Set **Filter by severity** to `Critical`.
  - Expected: 1 of 5; only the checkout report is listed.
- [ ] Click **Clear filters** and expected: the severity filter returns to **All severities**, the button disappears, and the count is 5 of 5.
- [ ] Set **Filter by status** to `Open`.
  - Expected: 2 of 5.
- [ ] Keep status `Open` and set **Filter by project** to `Northstar Checkout`.
  - Expected: 1 of 5 (the avatar report is `Closed`, so it is excluded).
- [ ] Click **Clear filters**.
- [ ] Set **Filter by severity** to `Critical`, **Filter by status** to `Open`, and **Filter by project** to `Northstar Checkout`.
  - Expected: 1 of 5, and **Clear filters** is visible.
- [ ] Type `no-such-bug-text` in **Search bugs** while the filters are active.
  - Expected: **Showing 0 of 5 reports** and the empty state **No reports match these filters.**
- [ ] Click **Clear filters** and expected: all fields reset, the count returns to 5 of 5, and the empty state disappears.
- [ ] Set **Sort reports** to `Oldest first`.
  - Expected: *Search ignores hyphenated project names* is first.
- [ ] Set **Sort reports** to `Severity`.
  - Expected: *Checkout total shows NaN after a promo code* (Critical) is first.
- [ ] Set **Sort reports** to `Title A–Z`.
  - Expected: *Avatar fallback flickers after refresh* is first.
- [ ] Set **Sort reports** to `Newest first`.
  - Expected: *Checkout total shows NaN after a promo code* is first.
- [ ] Expected: changing only the sort makes **Clear filters** appear; clicking it restores `Newest first`.

## 4. Create, edit, and delete reports

### Create

- [ ] From **Bug log**, click **Report a bug**.
- [ ] Submit the empty form with **Create bug**.
  - Expected: the form summary **Fix the highlighted fields and try again.** appears with errors for Title, Project or application, Programming language, and Description. Focus moves to the summary, and each field is marked invalid.
- [ ] Fill in:
  - Title: `Manual check report`
  - Project or application: `QA Sandbox`
  - Programming language: `TypeScript`
  - Description: `Created by the manual checklist.`
  - Leave Severity `Medium` and Status `Open`.
- [ ] Click **Create bug**.
  - Expected: a toast says **Bug report created.**, the new detail page opens, and the report shows the values you entered.
- [ ] Open **Overview** and expected: **06 Total bugs**, **03 Open**, **01 In progress**, **01 Resolved**, and **02 High and critical**.
- [ ] Reload the detail page and expected: the report is still there (saved in `localStorage`).

### Edit

- [ ] On the new report, click **Edit report**.
- [ ] Change the title to `Manual check report (edited)` and append ` Updated during the edit test.` to the description.
- [ ] Click **Save changes**.
  - Expected: a toast says **Changes saved.** and the detail page shows the new title and description.
  - Expected: **Last updated** changes; **Reported** does not.
- [ ] Click **Edit report**, change the title, then click **Cancel**.
  - Expected: the detail page still shows the previously saved title, with no toast.

### Delete

- [ ] Create a second report with the four required fields and title `Delete me`.
  - Expected: the dashboard now shows 07 total.
- [ ] On the **Delete me** detail page, click **Delete bug report**.
  - Expected: a modal headed **Delete bug report?** explains that deletion is permanent and cannot be undone. Focus starts on **Cancel**.
- [ ] Press `Escape`.
  - Expected: the dialog closes, focus returns to **Delete bug report**, and no report is removed.
- [ ] Open the dialog again and click **Cancel**.
  - Expected: the dialog closes and the report remains.
- [ ] Open the dialog again, press `Tab` repeatedly, then `Shift+Tab`.
  - Expected: focus cycles only through the dialog's controls (Close, Cancel, Delete report).
- [ ] Click **Delete report**.
  - Expected: a toast says **Bug deleted.**, the app returns to `/bugs`, **Delete me** is gone, and the dashboard total returns to 06.
- [ ] Reload `/bugs` and expected: **Delete me** does not return.

## 5. Fix states

Use the **Manual check report (edited)** created above. This report should have no fix status yet.

- [ ] Open the report and click **Edit report**.
- [ ] Leave **Proposed fix** empty, set **Fix status** to `Proposed`, and click **Save changes**.
  - Expected: the form summary reports **Add the proposed fix before setting a fix status.** The report is not saved.
- [ ] Enter a proposed fix, for example `Guard the optional discount amount before calculating the total.`, and set **Fix status** to `Accepted`.
- [ ] Click **Save changes**.
  - Expected: the detail page shows a **Proposed** fix text and an **Accepted** fix badge, and the fact panel says **Fix status: Accepted**. The verification-notes section says **No verification has been recorded.**
- [ ] Reload the page and expected: **Accepted** remains.
- [ ] Click **Edit report**, set **Fix status** to `Verified`, leave **Verification notes** empty, and click **Save changes**.
  - Expected: the summary reports **Record how the fix was verified before marking it verified.** The report is not saved.
- [ ] Enter verification notes, for example `Ran the checklist scenario, reloaded the page, and confirmed the report still shows the corrected title.`, and click **Save changes**.
  - Expected: the fix badge changes from **Accepted** to **Verified**, and the verification notes are shown in the detail page.
  - Expected: **Accepted** and **Verified** are visibly different states.
- [ ] Reload and expected: the **Verified** state and notes persist.
- [ ] In the detail page, change **Update status** to `Resolved`.
  - Expected: a toast says **Status changed to Resolved.**, the workflow-status badge becomes **Resolved**, the fix badge remains **Verified**, and **Fix status** in the fact panel is still `Verified`.
- [ ] Open **Overview** and expected: the counts reflect the status change (**02 Open**, **02 Resolved**); the fix status is not changed by the quick status control.
- [ ] Expected: no control, assistant result, or reload automatically marks a fix **Verified**.

## 6. Themes and persistence

- [ ] On any page, find the theme button in the sidebar or header.
- [ ] If the app is light, its accessible name is **Switch to dark theme**. If it is dark, the name is **Switch to light theme**.
- [ ] Click **Switch to dark theme**.
  - Expected: the whole app changes to the dark theme immediately; the button label becomes **Switch to light theme**.
  - Expected: `localStorage.getItem('bugpilot.theme.v1')` is `"dark"`.
- [ ] Reload the page and expected: the app stays dark.
- [ ] Open the same URL in another tab of the same profile and expected: the app starts dark.
- [ ] Navigate to **Overview**, **Bug log**, a report detail, **Report a bug**, **Assistant**, and a missing URL.
  - Expected: every page uses the dark theme consistently.
- [ ] Toggle back to light, reload, and expected: light persists and `bugpilot.theme.v1` is `"light"`.
- [ ] In both themes, check body text, secondary text, buttons, input borders, badges, and the focus ring. Expected: all remain legible; no text blends into its background.
- [ ] Optional system-preference check: remove only `bugpilot.theme.v1` in DevTools, set the OS/browser to a dark color scheme, and reload. Expected: the first render follows the system preference. A saved valid preference takes priority.

## 7. Debug Assistant

Perform these checks on a fresh assistant form unless a step says otherwise.

### Python result

- [ ] Open **Assistant**.
- [ ] Expected initial state: the result panel says **No analysis yet**, Language is **Auto — infer from the text**, and the required error field shows a `0 / 20,000 characters` counter.
- [ ] Set **Language** to `Python` and paste:
  ```text
  ModuleNotFoundError: No module named 'requests'
  ```
- [ ] Click **Analyze**.
  - Expected: the result heading is **Missing module**, the confidence badge is **High confidence**, and the matched signature is `ModuleNotFoundError: No module named '<module>'`.
  - Expected: the likely cause names `requests`, and the evidence list shows the pasted line with `Line 1`.
  - Expected: debugging steps, a possible fix, example code, verification steps, limitations, and alternative explanations are present.
- [ ] Expected: focus moves to the result heading after the analysis.

### JavaScript result

- [ ] Click **Clear**.
- [ ] Set **Language** to `JavaScript` and paste:
  ```text
  ReferenceError: userCount is not defined
  ```
- [ ] Click **Analyze**.
  - Expected: the heading is **Undefined name**, confidence is **High**, and the signature is `ReferenceError: <name> is not defined`.
  - Expected: the possible-fix example refers to `userCount`.

### Automatic language detection

- [ ] Click **Clear** and leave **Language** at `Auto — infer from the text`.
- [ ] Paste a Python traceback:
  ```text
  Traceback (most recent call last):
    File "app.py", line 4, in <module>
      main()
  ModuleNotFoundError: No module named 'requests'
  ```
- [ ] Click **Analyze**. Expected: **Missing module**, high confidence, and Python-specific guidance.
- [ ] Click **Clear** and paste a JavaScript error:
  ```text
  TypeError: Cannot read properties of undefined (reading 'name')
      at showUser (src/user.js:10:5)
  ```
- [ ] Click **Analyze**. Expected: **Type mismatch**, high confidence, and JavaScript-specific guidance.

### Unrecognised input

- [ ] Click **Clear** and paste:
  ```text
  The widget exploded.
  ```
- [ ] Click **Analyze**.
  - Expected: the heading is **Unrecognised**, confidence is **Low**, and the matched signature is **No rule matched**.
  - Expected: no possible fix is offered; the panel says it cannot suggest a fix because no supported rule matched.
  - Expected: general debugging steps, limitations, and the local-guidance disclaimer are still shown. No cause is invented.

### Empty input

- [ ] Click **Clear**, leave the error field empty, and click **Analyze**.
  - Expected: the error field shows **Enter an error message or traceback to analyze.**, receives focus, and no result is produced.

### Over-limit input

- [ ] In the DevTools Console, run this to put 20,001 characters on the clipboard:
  ```js
  copy('x'.repeat(20001))
  ```
- [ ] Paste into the error field.
  - Expected: the counter reads **20,001 / 20,000 characters** in the danger style, and the field shows **This input is 20,001 characters. Shorten it to 20,000 characters or fewer.**
- [ ] Click **Analyze**. Expected: the same error remains, focus returns to the error field, and no result is produced.
- [ ] Clear the field.

### Clear, copy, and checklist

- [ ] Analyze the Python `ModuleNotFoundError` example again.
- [ ] Click **Copy code**.
  - Expected: the status says **Code copied to the clipboard.** Paste into a text editor and compare it with the displayed example. Line endings may differ.
  - Expected if the browser denies clipboard access: an error says it could not copy automatically and tells you to select and copy the example manually.
- [ ] Tick two boxes in **Verification checklist**.
  - Expected: both stay ticked. The hint says checks are session-only and that checking a box does not verify the fix.
  - Expected: the bug report's fix status and verification notes do not change.
- [ ] Change any input, for example append a space to the error text.
  - Expected: the result and the ticked checklist disappear; a new analysis starts with no boxes ticked.
- [ ] Click **Clear**.
  - Expected: Language returns to **Auto**, all text areas are empty, the result panel returns to **No analysis yet**, and focus moves to the error field.

### Assistant privacy check

- [ ] Before analyzing, record the current storage in the Console:
  ```js
  ({ local: { ...localStorage }, session: { ...sessionStorage } })
  ```
- [ ] Analyze the Python `ModuleNotFoundError` example, then run:
  ```js
  const needle = "No module named 'requests'";
  [...Object.entries(localStorage), ...Object.entries(sessionStorage)]
    .filter(([, value]) => value.includes(needle)).length
  ```
  - Expected: `0`. The pasted error text is not stored.
- [ ] Run `Object.keys(localStorage)`.
  - Expected: only BugPilot's keys appear: `bugpilot.bugs.v1`, possibly `bugpilot.theme.v1`, and `bugpilot.bugs.recovery.v1` only if a storage problem occurred. After an import, `bugpilot.bugs.preimport.v1` may also appear. No assistant text appears in any key.
- [ ] Run `Object.keys(sessionStorage).filter((key) => key.startsWith('bugpilot.footerJoke.'))`.
  - Expected: only footer joke index keys are present; no assistant text or result.
- [ ] Reload the Assistant page. Expected: the form is empty and no previous pasted text or result is restored.

## 8. Joke footer

- [ ] Scroll to the bottom of **Overview**. Expected: the footer contains **BugPilot**, **Local bug log · no account, no network**, and one joke.
- [ ] Reload the page. Expected: a different joke from the Overview set appears (rotation avoids the current joke when alternatives exist).
- [ ] Visit **Bug log**, a report detail, **Report a bug**, **Assistant**, and a missing URL. Expected: each page shows one joke from its own page set.
- [ ] In the Console, run:
  ```js
  Object.keys(sessionStorage).filter((key) => key.startsWith('bugpilot.footerJoke.'))
  ```
  - Expected: one key per page you have visited, for example `bugpilot.footerJoke.overview`; no page content is stored.
- [ ] Stay on one page for 60 seconds. Expected: the joke changes without a reload.
- [ ] At 390px wide, scroll to the footer. Expected: the joke wraps and remains readable, with no horizontal overflow or overlap with the toast.

## 9. Toast

The current app emits info toasts for successful actions. Error-tone toast persistence is covered by the component test suite; normal UI flows do not require forcing a storage failure.

- [ ] Open a report, click **Edit report**, and click **Save changes** without changing anything.
  - Expected: a toast appears with **Changes saved.**
- [ ] At desktop width, expected: the toast is near the bottom-right and does not cover the form's primary action.
- [ ] Wait about 6 seconds without interacting. Expected: the toast dismisses automatically.
- [ ] Trigger the toast again and move the pointer over it for more than 6 seconds. Expected: it stays while hovered. Move away. Expected: it dismisses within about 6 seconds.
- [ ] Trigger the toast again, focus its **Dismiss notification** button with the keyboard, and wait. Expected: it stays while focus is inside the toast. Press `Tab` to leave, and expected: it dismisses within about 6 seconds.
- [ ] Trigger the toast again and click **Dismiss notification**. Expected: it disappears immediately.
- [ ] Trigger two messages in a row, for example save then quickly change the status.
  - Expected: only one toast is shown at a time; the newest message replaces the previous one.
- [ ] At 390px wide, trigger a toast. Expected: it appears at the top of the viewport, not over the footer.

## 10. Keyboard navigation and focus

- [ ] Reload a page and press `Tab` as the first action.
  - Expected: **Skip to main content** becomes visible at the top. Press `Enter`.
  - Expected: focus moves into the main content (the URL gains `#main-content`).
- [ ] Continue pressing `Tab` through the brand, theme button, **Overview**, **Bug log**, **Assistant**, and **Report a bug**.
  - Expected: every stop shows a visible focus ring; the active navigation item is clear.
- [ ] On the report form, operate every input and select with the keyboard.
  - Expected: labels are associated, arrow keys change select values, and the error summary links jump to invalid fields.
- [ ] On a report detail page, focus **Delete bug report** and press `Enter`.
  - Expected: the dialog opens with focus on **Cancel**.
- [ ] Press `Tab` and `Shift+Tab`.
  - Expected: focus stays inside the dialog (Close, Cancel, Delete report) and wraps.
- [ ] Press `Escape`.
  - Expected: the dialog closes and focus returns to **Delete bug report**.
- [ ] On **Assistant**, analyze the Python example.
  - Expected: focus moves to the result heading, and pressing `Tab` continues through the result actions (including **Copy code**).
- [ ] In both themes, check that the focus ring is clearly visible against the page, panels, and buttons.

## 11. Responsive checks

Use the browser's device/resize controls. Check 390 × 844 and 1440 × 900.

### 390 × 844

- [ ] The sidebar becomes a compact top header: brand and theme button on the first row, three navigation links on the second. The sidebar-only **Report a bug** button is hidden, but the page-level **Report a bug** button remains.
- [ ] In the Console, run:
  ```js
  document.documentElement.scrollWidth <= window.innerWidth
  ```
  Expected: `true` on Overview, Bug log, a detail, the form, Assistant, and a missing URL.
- [ ] Overview stats form two columns, with **High and critical** spanning the full row.
- [ ] The bug-log table scrolls horizontally inside its own container if needed; the whole page does not shift sideways.
- [ ] The report form and Assistant form are single-column; buttons and text are not clipped.
- [ ] Trigger a toast. Expected: it appears at the top and does not overlap the footer.
- [ ] Scroll to the footer. Expected: the joke wraps and is readable.
- [ ] Theme toggle, navigation, and all actions remain usable.

### 1440 × 900

- [ ] The sidebar is visible on the left and the content column fills the rest of the window.
- [ ] Overview stats form five columns.
- [ ] Bug-log filters sit in one row when space allows; the table is readable without page-level horizontal scrolling.
- [ ] Assistant shows the input and result panels side by side (or stacks only when the window is narrow).
- [ ] Toast appears bottom-right; the footer is readable.
- [ ] In the Console, `document.documentElement.scrollWidth <= window.innerWidth` returns `true`.

## 12. Corrupted-storage recovery

Do this in the disposable profile. If the profile contains reports you care about, back up the raw value first.

- [ ] In the Console, copy the current stored value to a temporary session key and then corrupt the real key:
  ```js
  sessionStorage.setItem('bugpilot.testBackup', localStorage.getItem('bugpilot.bugs.v1'))
  localStorage.setItem('bugpilot.bugs.v1', '{bad json')
  ```
- [ ] Reload the page.
  - Expected: the app still renders. A **Saved data needs attention** alert appears with a message that stored bug data could not be read, the original entry was left untouched, and a copy was kept in a recovery key.
  - Expected: no reports are shown; Overview counts are `00` and the recent list shows **No reports yet.**
  - Expected: the app does not reseed sample reports while the unreadable key exists.
- [ ] In the Console, run:
  ```js
  localStorage.getItem('bugpilot.bugs.v1')
  ```
  Expected: exactly `{bad json`.
- [ ] Run:
  ```js
  localStorage.getItem('bugpilot.bugs.recovery.v1')
  ```
  Expected: exactly `{bad json`.
- [ ] Navigate between pages and expected: no crash and no uncaught Console error.
- [ ] Restore the saved data:
  ```js
  localStorage.setItem('bugpilot.bugs.v1', sessionStorage.getItem('bugpilot.testBackup'))
  sessionStorage.removeItem('bugpilot.testBackup')
  localStorage.removeItem('bugpilot.bugs.recovery.v1')
  ```
- [ ] Reload and expected: your reports return (six reports if you followed sections 1–7 in order on a fresh profile: the five seeded reports plus **Manual check report (edited)**), and the alert is gone.
- [ ] Optional partial-record check: instead of invalid JSON, remove one field from one record in the saved array and reload. Expected: the readable reports are shown, the skipped count is reported, and the original raw value is copied to the recovery key.

## 13. Export and import

Use a disposable profile with the five sample reports. Do not run the replace or empty-log steps in a profile that contains reports you want to keep. Export a copy first if you are unsure.

### Export

- [ ] Open **Bug log**. Expected: **Export reports** and **Import reports** are visible in the page actions on desktop and at 390px.
- [ ] Click **Export reports**.
  - Expected: a file named `bugpilot-export-YYYY-MM-DD.json` downloads, where the date matches the UTC date in the file's `exportedAt` value. The page does not change and no toast appears.
  - Expected: in DevTools, no network request is made for the export.
- [ ] Open the downloaded file in a text editor.
  - Expected: it is pretty-printed JSON with `app` set to `bugpilot`, `schemaVersion` set to `1`, an ISO `exportedAt`, and a `bugs` array of five reports.
  - Expected: each report has `id`, `title`, `description`, `projectName`, `language`, `errorMessage`, `stepsToReproduce`, `expectedBehavior`, `actualBehavior`, `severity`, `status`, `notes`, `proposedFix`, `fixStatus`, `verificationNotes`, `createdAt`, and `updatedAt`.
  - Expected: there are no theme, assistant, or footer keys and no other storage data.
- [ ] Note one report's `createdAt` and `updatedAt` values for the import round-trip check below.
- [ ] In the Console, set an empty log and reload:
  ```js
  localStorage.setItem('bugpilot.bugs.v1', JSON.stringify({ schemaVersion: 1, bugs: [] }))
  location.reload()
  ```
- [ ] On the now-empty **Bug log**, click **Export reports**.
  - Expected: a toast says **There are no reports to export yet.** and no file downloads.

### Import preview, merge, and backup

- [ ] With the log still empty, click **Import reports**.
  - Expected: the dialog heading is **Import bug reports** and explains that nothing is saved until confirmation.
  - Expected: focus starts in the file input; the hint says JSON only, up to 5 MB and 5,000 reports.
  - Expected: **Export current reports first** is disabled because the log is empty.
- [ ] Press `Escape`.
  - Expected: the dialog closes, focus returns to **Import reports**, and the log is still empty.
- [ ] Reopen the dialog and choose the exported file.
  - Expected: **Preview** shows the filename, **Valid reports: 5**, **Invalid reports: 0**, and **Already in your log: 0**.
  - Expected: the default mode is **Add new reports only**, with the outcome **5 new reports will be added. 0 matching existing reports and 0 invalid reports will be skipped.**
- [ ] Click **Add reports**.
  - Expected: a toast says **Import complete. Added 5, skipped 0, replaced 0.** The dialog closes, focus returns to **Import reports**, and the log shows five rows.
  - Expected: the **Sample workspace loaded.** notice does not appear, including after a reload.
  - Expected: the noted `createdAt`/`updatedAt` values are unchanged.
  - Expected: in the Console, `localStorage.getItem('bugpilot.bugs.preimport.v1')` is exactly `{"schemaVersion":1,"bugs":[]}`.
  - Expected: the theme and footer behave as before, and `bugpilot.theme.v1` is unchanged.
- [ ] Import the same file again.
  - Expected: the preview shows **Already in your log: 5** and **0 new reports will be added. 5 matching existing reports and 0 invalid reports will be skipped.**
  - Expected: **Add reports** produces **Import complete. Added 0, skipped 5, replaced 0.** and the log still has five reports.

### Replace mode and invalid files

- [ ] Create one extra report so the log has six reports, then open **Import reports** and choose the five-report export again.
- [ ] Select **Replace all reports**.
  - Expected: a warning says **All 6 current reports will be deleted and replaced by 5 imported reports.**
  - Expected: **Replace all reports** is disabled until **I understand this replaces all 6 current reports.** is checked.
- [ ] Check the acknowledgement and click **Replace all reports**.
  - Expected: **Import complete. Added 5, skipped 0, replaced 6.** The log has exactly the five imported reports, and the extra report is gone.
- [ ] In the Console, copy the current log to a test backup, then empty the log for the invalid-file checks:
  ```js
  sessionStorage.setItem('bugpilot.testImportBackup', localStorage.getItem('bugpilot.bugs.v1'))
  localStorage.setItem('bugpilot.bugs.v1', JSON.stringify({ schemaVersion: 1, bugs: [] }))
  location.reload()
  ```
- [ ] On the empty **Bug log**, create `bad.json` in a text editor containing `{bad json`, then import it.
  - Expected: **This file is not valid JSON. Choose a BugPilot JSON export.** is announced as an alert, and **Add reports** is disabled.
- [ ] Import a file containing:
  ```json
  { "app": "another-app", "schemaVersion": 1, "bugs": [] }
  ```
  - Expected: **This file is not a BugPilot export.** and no report is changed.
- [ ] Make a copy of the valid export, empty the `title` of the second report, and also clear the `verificationNotes` of the report whose `fixStatus` is `Verified`.
  - Expected: the preview reports **Valid reports: 3** and **Invalid reports: 2**, lists **Report 2: Enter a title.** and **Report 3: Record how the fix was verified before marking it verified.** (positions follow the array order), and **Add reports** imports only the three valid reports.
  - Expected: **Import complete. Added 3, skipped 2, replaced 0.**, the failed records are not repaired, and the log shows only the three valid reports.
- [ ] In the Console, restore the saved log:
  ```js
  localStorage.setItem('bugpilot.bugs.v1', sessionStorage.getItem('bugpilot.testImportBackup'))
  sessionStorage.removeItem('bugpilot.testImportBackup')
  location.reload()
  ```
  - Expected: the five imported reports return.

### Dialog focus, access, and responsive behavior

- [ ] With at least one report present, open **Import reports** and press `Tab` and `Shift+Tab` repeatedly.
  - Expected: focus stays inside the dialog and cycles through its controls; the file input receives focus first.
- [ ] Trigger an invalid-file error, then move through the dialog with the keyboard.
  - Expected: the error is exposed as an alert; **Cancel** closes the dialog without changing storage.
- [ ] With no file selected, click outside the dialog or the close button.
  - Expected: the dialog closes, focus returns to **Import reports**, and no storage key changes.
- [ ] At 390 × 844 in both themes, open the dialog.
  - Expected: it fits the viewport, its actions are visible, the page does not scroll sideways, and the file picker, mode radios, preview, and acknowledgement can be operated without clipping.
- [ ] At 1440 × 900 in both themes, repeat the preview and confirm the dialog is centered and readable.
- [ ] Confirm the 5 MB, 5,000-report, newer-schema, and zero-valid-report paths in the automated tests; do not create multi-megabyte fixtures by hand.

## 14. Production preview

- [ ] Stop the development server with `Ctrl+C`.
- [ ] Build the production bundle:
  ```bash
  npm run build
  ```
  Expected: the command finishes without TypeScript or Vite errors and creates `dist/`.
- [ ] Start the preview:
  ```bash
  npm run preview -- --port 4173 --strictPort
  ```
- [ ] Open `http://localhost:4173`.
  - Expected: the app loads. This port is a separate origin, so it has its own storage; the sample workspace seeds here even if the development origin had data.
  - Expected: the app looks and behaves the same as the development build in light and dark themes.
- [ ] Visit and reload each route directly:
  - `/`
  - `/bugs`
  - `/bugs/new`
  - `/bugs/sample-checkout-nan`
  - `/bugs/sample-checkout-nan/edit`
  - `/assistant`
  - a missing path such as `/missing-page`
  Expected: every route loads; `/missing-page` shows **Page not found**, and reloading a client-side route does not return a server error.
- [ ] Toggle the theme, navigate away and back, and reload. Expected: the theme persists for `localhost:4173`.
- [ ] Analyze the Python `ModuleNotFoundError` example and the JavaScript `ReferenceError: userCount is not defined` example. Expected: both results render, with the same categories and confidence as in development.
- [ ] On **Bug log**, click **Export reports** and confirm the production build downloads a valid `bugpilot-export-YYYY-MM-DD.json` file. Open **Import reports**, choose that file, and expected: the preview matches the five sample reports and **Already in your log: 5**. Click **Add reports** and expected: **Import complete. Added 0, skipped 5, replaced 0.**, with no sample notice and no external request.
- [ ] Scroll to the footer and expected: a page-specific joke is present.
- [ ] Check the Console. Expected: no errors during load or navigation.
- [ ] In the Network tab, reload with **All** selected. Expected: requests go only to `localhost:4173` (HTML, JS, CSS, fonts, favicon). There are no requests to font CDNs, analytics, APIs, or other external hosts.
- [ ] At 390 × 844 and 1440 × 900, repeat the layout checks from section 11. Expected: parity with the development build.
- [ ] Stop the preview server with `Ctrl+C`.
- [ ] Optional cleanup: clear the `localhost:4173` site data if you do not want the preview's sample workspace to remain in the profile.
