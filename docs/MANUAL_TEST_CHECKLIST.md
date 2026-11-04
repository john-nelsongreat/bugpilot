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
- [ ] Expected: the browser tab title is **Overview · BugPilot** (the page label plus the product name, set by the app after it loads; the HTML shipped in `index.html` starts as **BugPilot — Local bug tracker**); the sidebar says **Local-only workspace** and **Reports stay in this browser. Nothing is uploaded.**
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

### Copy controls on a report detail

Use the seeded **CSV export stalls on tables over 50,000 rows** report, which has both an error message and a proposed fix.

- [ ] Open the report and click **Copy error message**. Paste into a text editor.
  - Expected: the pasted text exactly matches the **Error message** block, including line breaks. The page says **Error message copied to the clipboard.** and focus stays on the button.
- [ ] Click **Copy proposed fix** and paste into a text editor.
  - Expected: the pasted text exactly matches the **Proposed fix** text. The page says **Proposed fix copied to the clipboard.** and focus stays on the button.
- [ ] Reload the page and expected: no copy status is restored and the report is unchanged.
- [ ] Open a report with no proposed fix, such as *Checkout total shows NaN after a promo code*.
  - Expected: **Copy error message** is shown and **Copy proposed fix** is not.
- [ ] Open a report with neither field, such as *Avatar fallback flickers after refresh*.
  - Expected: neither copy button is shown.
- [ ] Block clipboard-write for the site (in Chrome: open the site controls, choose **Site settings**, and set **Clipboard** to **Block**), reload the report, and click **Copy error message**.
  - Expected: the page says **Could not copy automatically. Select the text and copy it manually.** The button stays focused and the report is unchanged.
- [ ] Restore clipboard permission when finished.

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

### Whole-identifier snippet evidence

- [ ] Click **Clear** and leave **Language** at `Auto — infer from the text`.
- [ ] Paste this error:
  ```text
  NameError: name 'total' is not defined
  ```
- [ ] Paste this code snippet:
  ```text
  subtotal = 10
  total = 0
  print(total)
  ```
- [ ] Click **Analyze**.
  - Expected: the heading is **Undefined name**, and the evidence shows the exception line plus **total = 0** with **Line 2**.
  - Expected: no evidence entry quotes **subtotal = 10**.

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

### Batch A Python rules

Set **Language** to `Python` for each example unless a step says otherwise. Every result below should show the evidence **Final exception line** with **Line 1**.

- [ ] Clear the form and paste:
  ```text
  ZeroDivisionError: division by zero
  ```
- [ ] Click **Analyze**.
  - Expected: **Division by zero**, **High confidence**, signature `ZeroDivisionError: division by zero`.
  - Expected: the likely cause mentions a zero or empty divisor, and the possible fix inspects the divisor and guards the zero or empty case rather than swallowing the error.

- [ ] Clear the form and paste each `ValueError` line separately. Each should return **Invalid value**, **High confidence**, and its own signature:
  | Paste this line | Expected signature |
  | --- | --- |
  | `ValueError: invalid literal for int() with base 10: 'abc'` | `ValueError: invalid literal for int() with base <base>: '<value>'` |
  | `ValueError: could not convert string to float: '1,234.5'` | `ValueError: could not convert string to float: '<value>'` |
  | `ValueError: not enough values to unpack (expected 2, got 1)` | `ValueError: not enough values to unpack (expected <expected>, got <got>)` |
  | `ValueError: too many values to unpack (expected 2)` | `ValueError: too many values to unpack (expected <expected>)` |
  | `ValueError: math domain error` | `ValueError: math domain error` |
  | `ValueError: 'apple' is not in list` | `ValueError: '<value>' is not in list` |
- [ ] Clear the form and paste `ValueError: something unusual happened`.
  - Expected: **Invalid value**, **Medium confidence**, signature `ValueError: <unclassified value error>`, and wording that the specific cause cannot be narrowed from this line. This generic result must be lower confidence than the six sub-signatures above.

- [ ] Clear the form and paste:
  ```text
  RecursionError: maximum recursion depth exceeded
  ```
- [ ] Click **Analyze**.
  - Expected: **Recursion error**, **High confidence**, signature `RecursionError: maximum recursion depth exceeded`.
  - Expected: the advice mentions finding the base case, prints the argument at each call, suggests an iterative approach when the depth is legitimately large, and warns that raising `sys.setrecursionlimit` is usually a workaround.

- [ ] Clear the form and paste:
  ```text
  UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0: invalid start byte
  ```
- [ ] Click **Analyze**.
  - Expected: **Unicode error**, **High confidence**, signature `UnicodeDecodeError: '<codec>' codec cannot decode the input`.
  - Expected: the fix mentions opening the text with an explicit encoding such as `encoding="utf-8"` and warns that `errors="ignore"` silently loses data.
- [ ] Clear the form and paste:
  ```text
  UnicodeEncodeError: 'charmap' codec can't encode character '\u2713' in position 5: character maps to <undefined>
  ```
- [ ] Click **Analyze**. Expected: **Unicode error**, **High confidence**, signature `UnicodeEncodeError: '<codec>' codec cannot encode the text`.

- [ ] Clear the form and paste:
  ```text
  json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
  ```
- [ ] Click **Analyze**.
  - Expected: **JSON decode error**, **High confidence**, signature `JSONDecodeError: <invalid JSON payload>`.
  - Expected: the fix asks you to print the raw response and status before parsing and to check for an empty body, an HTML page, or a BOM.

### Batch A lookalikes

For each line, clear the form, keep **Language** set to `Python`, and click **Analyze**. Expected every time: **Unrecognised**, **Low confidence**, **No rule matched**, and no possible fix. No cause is invented.

- [ ] `ArithmeticError: division by zero`
- [ ] `2026-10-28 12:00:00 ERROR ValueError: math domain error`
- [ ] `RuntimeError: maximum recursion depth exceeded`
- [ ] `2026-10-28 12:00:00 WARNING UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff`
- [ ] `json.decoder.JSONDecodeError: something unusual happened`

One related distinction: a `TypeError` line that repeats codec wording is not a Unicode error. The existing Python TypeError rule classifies it as **Type mismatch** at **Medium confidence**, so it does not appear in this Unrecognised list.

### Batch B1 JavaScript/Node rules

Set **Language** to `JavaScript` for each one-line example below unless a step says otherwise. Every result should show the evidence **Final exception line** with **Line 1**. These are Node.js runtime shapes; the Python rules must stay quiet.

- [ ] Clear the form and paste:
  ```text
  Error: Cannot find module 'express'
  ```
- [ ] Click **Analyze**.
  - Expected: **Missing module**, **High confidence**, signature `Error: Cannot find module '<package>'`.
  - Expected: the likely cause mentions installing the package, `package.json`, or the project folder, and the fix suggests `npm install`.
- [ ] Clear the form and paste:
  ```text
  Error: Cannot find module './missing-handler'
  ```
- [ ] Click **Analyze**. Expected: **Missing module**, **High confidence**, signature `Error: Cannot find module '<path>'`; the advice mentions the path, letter case, and missing build output.
- [ ] Clear the form and paste:
  ```text
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'date-fns' imported from /home/ana/app/src/index.mjs
  ```
- [ ] Click **Analyze**. Expected: **Missing module**, **High confidence**, signature `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<package>' imported from <path>`.
- [ ] Clear the form and paste:
  ```text
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module './utils' imported from /home/ana/app/src/index.mjs
  ```
- [ ] Click **Analyze**. Expected: **Missing module**, **High confidence**, signature `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<path>' imported from <path>`; the advice mentions adding the file extension.

- [ ] Clear the form and paste:
  ```text
  Error: listen EADDRINUSE: address already in use :::3000
  ```
- [ ] Click **Analyze**. Expected: **Port already in use**, **High confidence**, signature `Error: listen EADDRINUSE: address already in use <address>`.
  - Expected: the steps mention `netstat -ano | findstr :3000` on Windows and `lsof -i :3000` on macOS or Linux, and warn to end only a process you recognise and never end unknown system processes.

- [ ] Clear the form and paste:
  ```text
  Error: ENOENT: no such file or directory, open '/home/ana/app/config.json'
  ```
- [ ] Click **Analyze**. Expected: **Missing file**, **High confidence**, signature `Error: ENOENT: no such file or directory, <operation> '<path>'`; the advice mentions `process.cwd()` and `__dirname`.
- [ ] Clear the form and paste:
  ```text
  Error: spawn ffmpeg ENOENT
  ```
- [ ] Click **Analyze**. Expected: **Missing file**, **High confidence**, signature `Error: spawn <command> ENOENT`; the advice mentions PATH, `.cmd` or `shell: true` on Windows, and restarting the terminal.

- [ ] Clear the form and paste:
  ```text
  Error: EACCES: permission denied, open '/var/app/config.json'
  ```
- [ ] Click **Analyze**. Expected: **Permission denied**, **High confidence**, signature `Error: EACCES: permission denied, <operation> '<path>'`.
- [ ] Clear the form and paste:
  ```text
  Error: listen EACCES: permission denied 0.0.0.0:80
  ```
- [ ] Click **Analyze**. Expected: **Permission denied**, **High confidence**, signature `Error: listen EACCES: permission denied <address>`; the advice mentions ports below 1024, a higher port, or a reverse proxy.
- [ ] Clear the form and paste:
  ```text
  Error: EPERM: operation not permitted
  ```
- [ ] Click **Analyze**. Expected: **Permission denied**, **High confidence**, signature `Error: EPERM: operation not permitted`; the advice mentions a locked file on Windows.

- [ ] Clear the form and paste:
  ```text
  RangeError: Maximum call stack size exceeded
  ```
- [ ] Click **Analyze**. Expected: **Recursion error**, **High confidence**, signature `RangeError: Maximum call stack size exceeded`.
  - Expected: the advice mentions the base case, logging arguments, iteration, getters and setters, and circular data, and does not suggest increasing the stack size as a fix.

- [ ] Switch **Language** to `Auto — infer from the text`, clear the form, and paste:
  ```text
  Error: Cannot find module 'express'
  Require stack:
  - C:\Users\ana\app\server.js
      at Module._resolveFilename (node:internal/modules/cjs/loader:1228:15)
      at Object.<anonymous> (C:\Users\ana\app\server.js:1:17)
  Node.js v22.11.0
  ```
- [ ] Click **Analyze**. Expected: **Missing module**, **High confidence**, and a confidence reason that names JavaScript evidence; the evidence is the `Error:` line at **Line 1**, not a stack frame.

### Batch B1 lookalikes

For each line, clear the form, set **Language** to `JavaScript`, and click **Analyze**. Expected every time: **Unrecognised**, **Low confidence**, **No rule matched**, and no possible fix. No cause is invented.

- [ ] `2026-10-28 12:00:00 WARN Cannot find module 'express'`
- [ ] `2026-10-28 12:00:00 WARN EADDRINUSE: address already in use :::3000`
- [ ] `2026-10-28 12:00:00 WARN ENOENT: no such file or directory, open '/app/x.json'`
- [ ] `2026-10-28 12:00:00 ERROR EACCES: permission denied, open '/app/x'`
- [ ] `2026-10-28 12:00:00 WARN RangeError: Maximum call stack size exceeded`

One related distinction: a Python traceback ending in `ModuleNotFoundError: No module named 'requests'` still returns **Missing module** at **High confidence** through the Python rule, not the Node module rule.

### Batch B2 JavaScript rules

Set **Language** to `JavaScript` for each one-line example unless a step says otherwise. Every result should show the evidence **Final exception line** with **Line 1**. These are browser, network, JSON, and React shapes; the Python rules must stay quiet.

**JSON parse errors**

- [ ] Clear the form and paste each line separately. Each should return **JSON decode error** at **High confidence** with its own signature:
  | Paste this line | Expected signature |
  | --- | --- |
  | `SyntaxError: Unexpected token < in JSON at position 0` | `SyntaxError: Unexpected token '<' in JSON at position <position>` |
  | `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` | `SyntaxError: Unexpected token '<', ... is not valid JSON` |
  | `SyntaxError: Unexpected token u in JSON at position 0` | `SyntaxError: Unexpected token u in JSON at position 0` |
  | `SyntaxError: "undefined" is not valid JSON` | `SyntaxError: "undefined" is not valid JSON` |
  | `SyntaxError: Unexpected end of JSON input` | `SyntaxError: Unexpected end of JSON input` |
  | `SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data` | `SyntaxError: JSON.parse: unexpected character` |
  | `SyntaxError: JSON.parse: unexpected end of data at line 1 column 1 of the JSON data` | `SyntaxError: JSON.parse: unexpected end of data` |
  | `SyntaxError: JSON Parse error: Unrecognized token '<'` | `SyntaxError: JSON Parse error: Unrecognized token '<'` |
  | `SyntaxError: JSON Parse error: Unexpected EOF` | `SyntaxError: JSON Parse error: Unexpected EOF` |
  | `SyntaxError: Unexpected token '}', ... is not valid JSON` | `SyntaxError: <invalid JSON payload>` |
- [ ] Expected: the HTML cases mention an HTML page, `index.html`, or an error page; the empty or truncated cases mention an empty or truncated body; the `undefined` cases mention an undefined value.
- [ ] Expected: the fix asks you to print the response status, content-type, and raw text before parsing, and to check the URL, an empty response, a dev-server `index.html`, or a missing `await`.
- [ ] Clear the form and paste `SyntaxError: Unexpected token '}'`.
  - Expected: **Syntax error** at **High confidence** with signature `SyntaxError: <JavaScript parser error>`. The JSON rule must not claim an ordinary parser message.
- [ ] Clear the form and paste `2026-10-28T10:00:00Z SyntaxError: Unexpected token < in JSON at position 0`.
  - Expected: **Unrecognised** with no possible fix; a timestamped or prose mention is not treated as the final exception line.

**Bare JSON messages (no `SyntaxError:` prefix)**

These are the same distinctive browser messages pasted without the error class, which is how some console and logging tools present them. Leave **Language** on `Auto` unless a step says otherwise.

- [ ] Clear the form and paste each line separately. Expected every time: **JSON decode error**, **Medium confidence** (not High — the error class is missing), and the signature shown:
  | Paste this line | Expected signature |
  | --- | --- |
  | `JSON.parse: unexpected character at line 1 column 1 of the JSON data` | `SyntaxError: JSON.parse: unexpected character` |
  | `JSON.parse: unexpected end of data at line 1 column 1 of the JSON data` | `SyntaxError: JSON.parse: unexpected end of data` |
  | `JSON Parse error: Unrecognized token '<'` | `SyntaxError: JSON Parse error: Unrecognized token '<'` |
  | `JSON Parse error: Unexpected EOF` | `SyntaxError: JSON Parse error: Unexpected EOF` |
  | `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` | `SyntaxError: Unexpected token '<', ... is not valid JSON` |
  | `Unexpected token < in JSON at position 0` | `SyntaxError: Unexpected token '<' in JSON at position <position>` |
  | `Unexpected end of JSON input` | `SyntaxError: Unexpected end of JSON input` |
  | `"undefined" is not valid JSON` | `SyntaxError: "undefined" is not valid JSON` |
- [ ] Expected: the confidence reason says the error class was missing and the result was capped at Medium; the cause, steps, fix, and verification guidance match the prefixed form of the same message.
- [ ] Paste `Unexpected token }` alone.
  - Expected: **Unrecognised** at **Low confidence** with no possible fix. A bare generic parser message is not a JSON message, and without the `SyntaxError:` class the generic parser rule does not claim it either.
- [ ] Paste `2026-10-29T10:00:00Z JSON.parse: unexpected character at line 1 column 1 of the JSON data` and separately `The log said JSON Parse error: Unexpected EOF while loading.`
  - Expected: **Unrecognised** with no possible fix both times; a timestamped or prose mention is not treated as the final exception line.
- [ ] Set **Language** to `Python` and paste `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`.
  - Expected: **JSON decode error** at **High confidence** from the Python rule, not the Medium-capped JavaScript bare form.

**Network request failures**

- [ ] Clear the form and paste `TypeError: Failed to fetch`.
- [ ] Click **Analyze**. Expected: **Network request failed**, **High confidence**, signature `TypeError: Failed to fetch`; the cause says browsers hide the underlying reason and lists server, URL or port, network, CORS, extension, and TLS possibilities.
- [ ] Clear the form and paste `TypeError: NetworkError when attempting to fetch resource.`
  - Expected: **Network request failed**, **High confidence**, same signature.
- [ ] Clear the form and paste `TypeError: Load failed`.
  - Expected: **Network request failed**, **Low confidence**, signature `TypeError: Load failed`; the reason says the wording is generic and the confidence is capped.
- [ ] Clear the form and paste `TypeError: fetch failed`.
  - Expected: **Network request failed**, **High confidence**, signature `TypeError: fetch failed`.
- [ ] Clear the form and paste:
  ```text
  TypeError: fetch failed
      at node:internal/deps/undici/undici:12345:11
    [cause]: Error: connect ECONNREFUSED 127.0.0.1:3000
  ```
  - Expected: **Network request failed**, **High confidence**, signature `TypeError: fetch failed`; the cause names `ECONNREFUSED`.
- [ ] Clear the form and paste each console line separately. Expected every time: **Network request failed**, **High confidence**, with the signature shown:
  | Paste this line | Expected signature |
  | --- | --- |
  | `GET http://localhost:3000/api net::ERR_CONNECTION_REFUSED` | `net::ERR_CONNECTION_REFUSED` |
  | `net::ERR_NAME_NOT_RESOLVED` | `net::ERR_NAME_NOT_RESOLVED` |
  | `net::ERR_INTERNET_DISCONNECTED` | `net::ERR_INTERNET_DISCONNECTED` |
  | `GET https://localhost:3000/api net::ERR_CERT_AUTHORITY_INVALID` | `net::ERR_CERT_<reason>` |
- [ ] Expected: the steps mention the DevTools Network tab, the server and port, DNS, the network connection, and certificate warnings where relevant.
- [ ] Clear the form and paste `TypeError: x is not a function`.
  - Expected: **Type mismatch** at **High confidence**; the network rule must not claim an ordinary TypeError.
- [ ] Clear the form and paste `net::ERR_CONNECTION_REFUSED was printed in the build log`.
  - Expected: **Unrecognised** with no possible fix; a code mentioned in prose is not a console failure line.

**CORS blocked requests**

- [ ] Clear the form and paste:
  ```text
  Access to fetch at 'http://localhost:3000/api' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  ```
- [ ] Click **Analyze**.
  - Expected: **CORS blocked request**, **High confidence**, signature `Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header`.
  - Expected: the cause names `Access-Control-Allow-Origin`; the fix says the server must send the header, the front-end cannot fix it, `mode: 'no-cors'` does not fix it, and a dev-server proxy is an option.
- [ ] Clear the form and paste:
  ```text
  Access to fetch at 'https://api.example.com/data' from origin 'https://app.example.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  ```
  - Expected: **CORS blocked request**, **High confidence**, signature `... blocked by CORS policy: preflight request does not pass access control check`; the cause and steps mention `OPTIONS` and the preflight.
- [ ] Clear the form and paste:
  ```text
  Access to fetch at 'https://api.example.com/data' from origin 'https://app.example.com' has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header has a value 'https://other.example.com' that is not equal to the supplied origin.
  ```
  - Expected: **CORS blocked request**, **High confidence**, signature `... blocked by CORS policy: 'Access-Control-Allow-Origin' does not match the supplied origin`.
- [ ] Clear the form and paste:
  ```text
  Access to fetch at 'https://api.example.com/me' from origin 'https://app.example.com' has been blocked by CORS policy: The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.
  ```
  - Expected: **CORS blocked request**, **High confidence**, signature `... blocked by CORS policy: credentials mode cannot use a wildcard origin`; the fix says to return the specific origin and never combine a wildcard with credentials.
- [ ] Clear the form and paste the first CORS example with `XMLHttpRequest` instead of `fetch`.
  - Expected: the same **missing 'Access-Control-Allow-Origin' header** signature (the placeholder `<transport>` stays in the signature), and the quoted evidence line keeps `XMLHttpRequest`.
- [ ] Clear the form and paste `2026-10-28T10:00:00Z Access to fetch at 'http://x' from origin 'http://y' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.`
  - Expected: **Unrecognised** with no possible fix.

**React errors**

- [ ] Clear the form and paste:
  ```text
  Uncaught Error: Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:
  ```
- [ ] Click **Analyze**.
  - Expected: **React error**, **High confidence**, signature `Error: Invalid hook call. Hooks can only be called inside of the body of a function component.`
  - Expected: the cause mentions the Rules of Hooks, and the steps or fix mention `npm ls react react-dom` and a duplicate or second copy of React.
- [ ] Clear the form and paste `Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.`
  - Expected: **React error**, **High confidence**; the cause mentions a state setter and `onClick` during render, and the fix shows `onClick={() => setCount(...)}`.
- [ ] Clear the form and paste `Uncaught Error: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.`
  - Expected: **React error**, **High confidence**, signature `Error: Maximum update depth exceeded.`; the advice mentions an effect, its dependency array, and an update loop.
- [ ] Clear the form and paste `Error: Objects are not valid as a React child (found: object with keys {name, age}). If you meant to render a collection of children, use an array instead.`
  - Expected: **React error**, **High confidence**, signature `Error: Objects are not valid as a React child (found: <value>)`; the advice mentions mapping objects to elements or rendering a string.
- [ ] Clear the form and paste `Warning: Invalid hook call. Hooks can only be called inside of the body of a function component.`
  - Expected: **React error**, **Medium confidence**, signature `Error: Invalid hook call. Hooks can only be called inside of the body of a function component.` The exact React sentence may carry the `Warning:` prefix; a timestamp or any other prefix is still not accepted (see the context-line section below).

**Automatic detection and precedence**

- [ ] Leave **Language** at `Auto — infer from the text`, clear the form, and paste:
  ```text
  SyntaxError: Unexpected token < in JSON at position 0
      at getData (src/api/client.js:10:5)
  ```
  - Expected: **JSON decode error**, **High confidence**, and a confidence reason that names JavaScript.
- [ ] Clear the form and paste `TypeError: Failed to fetch` with the same two-line JavaScript stack below it.
  - Expected: **Network request failed**, **High confidence**, and a confidence reason that names JavaScript.
- [ ] Clear the form and paste `Uncaught Error: Invalid hook call. Hooks can only be called inside of the body of a function component.` with the same stack below it.
  - Expected: **React error**, **High confidence**, and a confidence reason that names JavaScript.
- [ ] Clear the form and paste a CORS console line from above on its own.
  - Expected: **CORS blocked request**, **High confidence**, and a confidence reason that names JavaScript.
- [ ] Clear the form, set **Language** to `JavaScript`, and paste `SyntaxError: Unexpected token < in JSON at position 0`.
  - Expected: **JSON decode error**, not **Syntax error**. The JSON rule takes precedence over the generic parser fallback for JSON wording only.

One related distinction: a plain `SyntaxError: Unexpected token '}'` still returns **Syntax error**, and `TypeError: x is not a function` still returns **Type mismatch**; the new rules supersede the generic fallbacks only when their own message families match.

### Batch C1 TypeScript compiler rules

Set **Language** to `JavaScript` for every one-line example unless a step says otherwise; multi-line blocks are also listed with `Auto`. Every result in this section shows the category **TypeScript compiler error**. These are compiler output shapes; the Python rules must stay quiet.

**Message forms**

- [ ] Clear the form and paste each line separately. Each should return **High confidence** with the signature shown and one evidence item, **Final exception line** at **Line 1**:
  | Paste this line | Expected signature |
  | --- | --- |
  | `src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.` | `error TS2322: Type '<type>' is not assignable to type '<type>'.` |
  | `C:\Users\dev\project\src\App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.` | `error TS2322: Type '<type>' is not assignable to type '<type>'.` |
  | `src/App.tsx:12:5 - error TS2322: Type 'string' is not assignable to type 'number'.` | `error TS2322: Type '<type>' is not assignable to type '<type>'.` |
  | `src/cart.ts:88:3: error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.` | `error TS2345: Argument of type '<type>' is not assignable to parameter of type '<type>'.` |
  | `C:\Users\dev\project\src\Counter.tsx:7:10 - error TS2339: Property 'countt' does not exist on type 'Counter'.` | `error TS2339: Property '<name>' does not exist on type '<type>'.` |
- [ ] Clear the form and paste `error TS2322: Type 'string' is not assignable to type 'number'.` (no location).
  - Expected: **Medium confidence**, signature `error TS2322: Type '<type>' is not assignable to type '<type>'.`, and the confidence reason says the matched wording is generic so the confidence is capped at medium. The cause must not invent a line or column.
- [ ] Clear the form and paste `Type 'string' is not assignable to type 'number'.ts(2322)`.
  - Expected: **Low confidence**, same signature, evidence **Final exception line** at **Line 1**.

**Sub-signatures**

- [ ] Clear the form and paste each line separately. Each should return **High confidence** with its own signature, and the cause, steps, fix, verification, limitations, and alternatives should all be about that message:
  | Paste this line | Expected signature |
  | --- | --- |
  | `src/App.tsx(4,17): error TS2304: Cannot find name 'userCount'.` | `error TS2304: Cannot find name '<name>'.` |
  | `src/App.tsx(2,20): error TS2307: Cannot find module 'lodash' or its corresponding type declarations.` | `error TS2307: Cannot find module '<module>' or its corresponding type declarations.` |
  | `src/cart.ts(9,21): error TS7006: Parameter 'value' implicitly has an 'any' type.` | `error TS7006: Parameter '<name>' implicitly has an 'any' type.` |
  | `src/App.tsx(21,9): error TS2532: Object is possibly 'undefined'.` | `error TS2532: Object is possibly '<value>'.` |
  | `src/App.tsx(30,5): error TS18048: 'items' is possibly 'undefined'.` | `error TS18048: '<name>' is possibly '<value>'.` |
  | `src/App.tsx(44,3): error TS2554: Expected 1 arguments, but got 0.` | `error TS2554: Expected <count> arguments, but got <count>.` |
  | `src/App.tsx(51,18): error TS2769: No overload matches this call.` | `error TS2769: No overload matches this call.` |
- [ ] Expected: the `TS2339`, `TS2304`, and `TS2307` causes name the quoted property, name, or module and stay inside what the message says (`'countt'`, `'userCount'`, `'lodash'`); they do not mention anything else from the paste.
- [ ] Expected: `TS2532` and `TS18048` suggest narrowing with a check or optional chaining, and do **not** propose a non-null assertion (`!`) as the first option.
- [ ] Expected: every fix lists Windows PowerShell or Command Prompt commands before the macOS and Linux ones, and nothing claims the fix was verified on your project.

**An unknown code**

- [ ] Clear the form and paste `src/App.tsx(9,3): error TS2551: Property 'countt' does not exist on type 'Counter'. Did you mean 'count'?`.
  - Expected: **Medium confidence**, signature `error TS2551: <message>`, evidence **Final exception line** at **Line 1**. The result names `TS2551`, quotes the message, says plainly that this engine has no specific rule for that code, points to the TypeScript documentation for it, and tells you to read the indented lines the compiler prints after it. It must not name a cause.

**Several errors, summaries, and trailers**

- [ ] Set **Language** to `Auto` and paste:
  ```text
  src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
  src/App.tsx:5:7 - error TS2339: Property 'countt' does not exist on type 'Counter'.
  Found 1 error in src/App.tsx:5
  ```
  - Expected: **TypeScript compiler error** for `error TS2322: Type '<type>' is not assignable to type '<type>'.` at **High confidence**. The summary line is not treated as the error, and the limitations say how many TypeScript error lines the paste contains.
- [ ] Set **Language** to `JavaScript` and paste a full `tsc` run with the summary table:
  ```text
  src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
  C:\Users\dev\project\src\Counter.tsx(7,10): error TS2339: Property 'countt' does not exist on type 'Counter'.
  Found 2 errors in 2 files.

  Errors  Files
       1  src/App.tsx:12
       1  C:\Users\dev\project\src\Counter.tsx:7
  ```
  - Expected: **High confidence**, signature `error TS2322: …` — the **first** error line, not the last. Evidence shows **Final exception line** at **Line 2** (the `TS2339` line) and **Matched context line** at **Line 1** (the `TS2322` line). The `Found 2 errors in 2 files.` line, the `Errors  Files` header, and the two table rows are all skipped.
- [ ] Set **Language** to `Auto` and paste a failed build:
  ```text
  src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
  src/App.tsx(13,9): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
  npm error code ELIFECYCLE
  npm error Failed at the build script.
  ```
  - Expected: **TypeScript compiler error** with signature `error TS2322: …` at **High confidence**, evidence **Final exception line** at **Line 4** (`npm error Failed at the build script.`) and **Matched context line** at **Line 1**. The cause must not mention `ELIFECYCLE`.

**Automatic detection**

- [ ] Set **Language** to `Auto — infer from the text` and paste `error TS2322: Type 'string' is not assignable to type 'number'.` with no stack frame.
  - Expected: **TypeScript compiler error** at **Medium confidence**, with a confidence reason that names JavaScript.
- [ ] Set **Language** to `Auto` and paste the pretty `TS2322` line alone, then separately the editor `.ts(2322)` line.
  - Expected: **High** and **Low** confidence respectively, both naming JavaScript in the reason.

**Batch C1 TypeScript lookalikes**

- [ ] Clear the form and paste `2026-10-31T10:00:00Z src/App.tsx(12,5): error TS2322: Type 'a' is not assignable to type 'b'.`.
  - Expected: **Unrecognised** at **Low confidence**, no signature and no possible fix. A timestamp is not a compiler location.
- [ ] Clear the form and paste `The TS2322 error is a type mismatch in TypeScript.` and separately `// error TS2322: Type "a" is not assignable to type "b".`.
  - Expected: **Unrecognised** both times; a mention in prose or a comment is not a compiler line.
- [ ] Clear the form and paste `src/App.tsx(12): error TS2322: Type 'a' is not assignable to type 'b'.` and separately `src/App.vue(12,5): error TS2322: Type 'a' is not assignable to type 'b'.`.
  - Expected: **Unrecognised** both times; the location must carry a column, and the file must end in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, or `.cjs`.

### Batch C1 npm rules

Set **Language** to `JavaScript` unless a step says otherwise. Every result here shows the category **NPM install or run error** on the detail page (`npm-error`). Only lines starting with exactly `npm error ` (npm 9+) or `npm ERR! ` (npm 6 to 8) count; `yarn` and `pnpm` are out of scope. For the multi-line blocks, evidence shows two items: **Final exception line** (the last line of the block that the engine selects) and **Matched context line** at **Line 1** (the recognised `code …` line).

**Sub-signature blocks**

- [ ] Clear the form and paste this npm 9 `ERESOLVE` block. Expected: **High confidence**, signature `npm error code ERESOLVE`; the cause names `some-ui-lib` and `react`; the fix reads the peer requirement, suggests `npm ls`, and mentions `--legacy-peer-deps` or `--force` only as an informed last resort with its risks.
  ```text
  npm error code ERESOLVE
  npm error ERESOLVE unable to resolve dependency tree
  npm error
  npm error While resolving: bugpilot@1.0.0
  npm error Found: react@18.2.0
  npm error node_modules/react
  npm error   react@"^18.2.0" from the root project
  npm error
  npm error Could not resolve dependency:
  npm error peer react@"^17.0.0" from some-ui-lib@2.1.0
  npm error node_modules/some-ui-lib
  npm error   some-ui-lib@"^2.1.0" from the root project
  npm error
  npm error Fix the upstream dependency conflict, or retry
  npm error this command with --force, or --legacy-peer-deps
  npm error to accept an incorrect (and potentially broken) dependency resolution.
  npm error A complete log of this run can be found in:
  npm error     /home/dev/.npm/_logs/2026-10-31T10_00_00_000Z-debug-0.log
  ```
- [ ] Clear the form and paste the same conflict in npm 8 wording (`npm ERR! code ERESOLVE` first, with `npm ERR! Conflicting peer dependency: react@17.0.2` and the `_logs` line inside a Windows `AppData\Local\npm-cache` path).
  - Expected: **High confidence**, signature `npm ERR! code ERESOLVE`.
- [ ] Clear the form and paste this `E404` block. Expected: **High confidence**, signature `npm error code E404`; the cause and fix name the package spelling, the scope, and a private registry's `.npmrc` auth.
  ```text
  npm error code E404
  npm error 404 Not Found - GET https://registry.npmjs.org/not-a-real-package-xyz - Not found
  npm error 404
  npm error 404  'not-a-real-package-xyz@*' is not in this registry.
  npm error 404
  npm error A complete log of this run can be found in:
  npm error     /home/dev/.npm/_logs/2026-10-31T10_00_00_000Z-debug-0.log
  ```
- [ ] Clear the form and paste this `ETARGET` block.
  ```text
  npm error code ETARGET
  npm error notarget No matching version found for some-ui-lib@2.9.9.
  npm error notarget In most cases you or one of your dependencies are requesting
  npm error notarget a package version that does not exist.
  ```
  - Expected: **High confidence**, signature `npm error code ETARGET`; the cause says the requested version is not published, and the fix uses `npm view` to list the versions and tags.
- [ ] Clear the form and paste this Windows `ENOENT` block. Expected: **High confidence**, signature `npm error code ENOENT`; the cause mentions `package.json` and the working directory; the fix starts with `cd` and `dir` (PowerShell) and mentions `npm init` only for a new project.
  ```text
  npm error code ENOENT
  npm error path C:\Users\dev\project\package.json
  npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open 'C:\Users\dev\project\package.json'
  ```
- [ ] Clear the form and paste this `EACCES` block. Expected: **High confidence**, signature `npm error code EACCES`; the text must not contain `sudo`, and it should mention folder ownership, a Node version manager, or a user-level prefix.
  ```text
  npm error code EACCES
  npm error syscall mkdir
  npm error path /usr/local/lib/node_modules
  npm error Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'
  ```
- [ ] Clear the form and paste this npm 8 `EPERM` block. Expected: **High confidence**, signature `npm ERR! code EPERM`; the cause names a locked file or another program holding it, and nothing suggests disabling antivirus or running as administrator.
  ```text
  npm ERR! code EPERM
  npm ERR! syscall rename
  npm ERR! path C:\Program Files\nodejs\node_modules\bugpilot
  npm ERR! dest C:\Program Files\nodejs\node_modules\.bugpilot.delete
  npm ERR! Error: EPERM: operation not permitted, rename 'C:\Program Files\nodejs\node_modules\bugpilot' -> 'C:\Program Files\nodejs\node_modules\.bugpilot.delete'
  ```
- [ ] Clear the form and paste this network block. Expected: **High confidence**, signature `npm error code <network error code>`; the text mentions the connection, a proxy, the registry setting, and retrying, and names `ENOTFOUND`.
  ```text
  npm error code ENOTFOUND
  npm error syscall getaddrinfo
  npm error errno ENOTFOUND
  npm error network request to https://registry.npmjs.org/express failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
  ```

**Single-line forms**

- [ ] Clear the form and paste each line separately; each returns **NPM install or run error** with the signature shown. With **Language** set to `JavaScript` the confidence reason says the language was selected explicitly; set it to `Auto` and the reason names the npm log line as a JavaScript clue instead:
  | Paste this line | Expected signature |
  | --- | --- |
  | `npm error ERESOLVE unable to resolve dependency tree` | `npm error ERESOLVE unable to resolve dependency tree` |
  | `npm error Could not resolve dependency:` | `npm error Could not resolve dependency:` |
  | `npm ERR! Conflicting peer dependency: react@17.0.2` | `npm ERR! Conflicting peer dependency: <package>@<version>` |
  | `npm error 404 Not Found - GET https://registry.npmjs.org/not-a-real-package-xyz - Not found` | `npm error 404 Not Found - GET <url>` |
  | `npm ERR! 404  'nope@*' is not in this registry.` | `npm ERR! 404 '<package>' is not in this registry.` |
  | `npm error notarget No matching version found for some-ui-lib@2.9.9.` | `npm error No matching version found for <package>@<version>.` |
  | `npm error network request to https://registry.npmjs.org/express failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org` | `npm error network request to <url> failed, reason: <reason>` |
  | `npm error code EAI_MEMORY` | `npm error code <error code>` at **Low confidence** — the code is named, quoted, and no specific advice is invented |

**A lifecycle failure on its own**

- [ ] Set **Language** to `Auto` and paste:
  ```text
  npm error code ELIFECYCLE
  npm error command failed
  npm error
  npm error> bugpilot@1.0.0 build
  npm error Failed at the bugpilot@1.0.0 build script.
  npm error A complete log of this run can be found in:
  npm error     /home/dev/.npm/_logs/2026-10-31T10_00_00_000Z-debug-0.log
  ```
  - Expected: **Medium confidence** (never High), signature `npm error code ELIFECYCLE`, evidence **Final exception line** at **Line 5** and **Matched context line** at **Line 1**. The cause names the `build` script, says the real error is printed above these lines, and the fix tells you to run the script on its own.
- [ ] Clear the form and paste `npm ERR! Failed at the bugpilot@1.0.0 build script.` on its own.
  - Expected: **Low or Medium confidence**, signature `npm ERR! Failed at the <script> script.`, cause names `build`.
- [ ] Clear the form and paste `npm ERR! errno 1` on its own.
  - Expected: **Low confidence**, signature `npm ERR! errno <exit code>`.

**Precedence against the existing Node.js rules**

- [ ] Clear the form and paste `Error: ENOENT: no such file or directory, open 'C:\Users\dev\project\package.json'`.
  - Expected: **Missing file** at **High confidence** from `javascript.node-file-error` — a bare Node.js error line is not routed to the npm rule, even though the npm `ENOENT` block above is.
- [ ] Clear the form and paste `Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'`.
  - Expected: **Permission denied** at **High confidence** from the Node.js permission rule.
- [ ] Clear the form and paste:
  ```text
  Error: listen EADDRINUSE: address already in use :::5173
  npm ERR! Failed at the bugpilot@1.0.0 dev script.
  ```
  - Expected: **Port already in use** at **High confidence**; the lifecycle trailer must not win.
- [ ] Clear the form and paste:
  ```text
  Error: Cannot find module 'express'
  npm error code ELIFECYCLE
  npm error Failed at the build script.
  ```
  - Expected: **Missing module** at **High confidence** from the Node.js module rule.
- [ ] Clear the form and paste the npm 8 `EACCES`-style block `Error: EACCES: permission denied, mkdir 'C:\Users\dev\project\dist'` followed by `npm ERR! Failed at the bugpilot@1.0.0 build script.` and the npm note line.
  - Expected: **Permission denied** at **High confidence** from the Node.js rule, and no mention of `ELIFECYCLE` anywhere in the result.

**Batch C1 npm lookalikes**

- [ ] Clear the form and paste `see the ERESOLVE docs`.
  - Expected: **Unrecognised** with no possible fix.
- [ ] Clear the form and paste `npm error` alone, then separately `npm ERR! 404` and `npm error code`.
  - Expected: **Unrecognised** each time; the prefix alone carries no recognised shape.
- [ ] Clear the form and paste a pnpm block:
  ```text
  Progress: resolved 214, reused 0
   ERR_PNPM_NO_MATCHING_VERSION  No matching version found for some-ui-lib@2.9.9
  Failed to create install "tree"
  ```
  - Expected: **Unrecognised**; pnpm is out of scope. Then paste `yarn add v1.22.19` with `[1/4] Resolving packages...`, `error Command failed.`, and `Exit code: 1` below it.
  - Expected: **Unrecognised**; yarn is out of scope.

One related distinction: `npm install failed with a dependency conflict` and `The build log mentioned ERESOLVE earlier.` stay **Unrecognised**, and a Python traceback that ends in `ValueError: … TS2322` still returns **Invalid value** from the Python rule — the new signals only add evidence for JavaScript, they never claim another language's exception line.

### Batch C2 Git rules

Git writes these lines itself and they belong to no programming language, so the whole batch reads the same whatever **Language** says. Set **Language** to `Auto — infer from the text` for every example below, then repeat the three examples marked **[all modes]** with `Python` and with `JavaScript` selected: the result is identical in all three modes — same category, confidence, signature, and evidence. Paste each block exactly as shown, one per analysis.

Every result in this section names the line the failing command wrote and never the words Python, JavaScript, or runtime.

**Repository, remote, and push**

- [ ] **C2-1 No repository here.** Clear the form and paste:
  ```text
  PS C:\Users\dev\project> git status
  fatal: not a git repository (or any of the parent directories): .git
  ```
  - Expected: **Git error**, **High confidence**, signature `fatal: not a git repository (or any of the parent directories): .git`.
  - Expected: one evidence item — **Final exception line** at **Line 2** quoting the `fatal:` line. The prompt line is not quoted.
  - Expected: the fix starts with a `cd` command and re-runs `git status`; the likely cause quotes the `fatal:` line. The only write the advice offers is a `git clone`, and its explanation says plainly that cloning writes a new folder, so it needs a target that is not already in use. Nothing in the result changes an existing repository.
  - Expected: the confidence reason reads **The final line is a message the failing command wrote itself, and a specific signature recognises it, so no language evidence was needed.** **[all modes]**
- [ ] **C2-2 Remote name already taken.** Clear the form and paste:
  ```text
  $ git remote add origin https://github.com/dev/app.git
  error: remote origin already exists.
  ```
  - Expected: **Git error**, **High confidence**, signature `error: remote origin already exists.` — the real `error:` prefix, not `fatal:`.
  - Expected: **Final exception line** at **Line 2**, and the fix reads `git remote -v` before `git remote set-url`.
- [ ] **C2-3 Push refused (fetch first).** Clear the form and paste the whole block:
  ```text
  PS C:\Users\dev\app> git push
  To https://github.com/dev/app.git
   ! [rejected]        main -> main (fetch first)
  error: failed to push some refs to 'https://github.com/dev/app.git'
  hint: Updates were rejected because the remote contains work that you do not
  hint: have locally. This is usually caused by another repository pushing to
  hint: the same ref. If you want to integrate the remote changes, use
  hint: 'git pull' before pushing again.
  hint: See the 'Note about fast-forwards' in 'git push --help' for details.
  ```
  - Expected: **Git error**, **High confidence**, signature `! [rejected] <ref> -> <ref> (fetch first)` — the `hint:` block and the `To …` line do not hide it.
  - Expected: evidence is **Final exception line** at **Line 4** (`error: failed to push some refs to …`) and **Matched context line** at **Line 3** (the `! [rejected]` marker). Neither `hint:` line nor the `To …` line is quoted.
  - Expected: the debugging steps tell you to read the `hint:` lines. In the fix, `git pull --rebase` appears **before** `--force-with-lease`; the bare `--force` form does not appear anywhere, and the overwriting option is labelled as a last resort that can lose other people's commits.
  - Expected: the confidence reason reads **A message the failing command wrote itself appears on line 3, and a specific signature recognises it, so no language evidence was needed.** **[all modes]**
- [ ] **C2-4 Push refused (non-fast-forward) with shell prompts.** Clear the form and paste:
  ```text
  dev@workstation:~/app$ git push
  To https://github.com/dev/app.git
   ! [rejected]        main -> main (non-fast-forward)
  error: failed to push some refs to 'https://github.com/dev/app.git'
  dev@workstation:~/app$
  ```
  - Expected: **Git error**, **High confidence**, signature `! [rejected] <ref> -> <ref> (non-fast-forward)`.
  - Expected: **Matched context line** at **Line 3**. The trailing prompt line is selected as **Final exception line** at **Line 5**, but the prompt text never appears in the signature or the likely cause.
- [ ] **C2-5 Push summary on its own.** Clear the form and paste `error: failed to push some refs to 'https://github.com/dev/app.git'`.
  - Expected: **Git error** at **Low confidence**, signature `error: failed to push some refs to '<url>'`, one evidence item at **Line 1**, and the reason **The final line is an error line from the failing command, but no specific signature covers it, so it is quoted rather than explained.** This summary is a weaker result than C2-3 above, where a specific line is present in the same paste.

**Branches and merging**

- [ ] **C2-6 Unrelated histories.** Clear the form and paste:
  ```text
  $ git pull origin main --rebase
  fatal: refusing to merge unrelated histories
  ```
  - Expected: **Git error**, **High confidence**, signature `fatal: refusing to merge unrelated histories`, **Final exception line** at **Line 2**.
  - Expected: `--allow-unrelated-histories` appears in the fix, described as a deliberate choice rather than the obvious one.
- [ ] **C2-7 Merge conflict.** Clear the form and paste:
  ```text
  PS C:\Users\dev\app> git merge feature/login
  Auto-merging src/App.tsx
  CONFLICT (content): Merge conflict in src/App.tsx
  Automatic merge failed; fix conflicts and then commit the result.
  ```
  - Expected: **Git error**, **High confidence**, signature `CONFLICT (<type>): Merge conflict in <file>`.
  - Expected: evidence is **Final exception line** at **Line 4** and **Matched context line** at **Line 3** quoting `CONFLICT (content): Merge conflict in src/App.tsx`.
  - Expected: the fix names the `<<<<<<<`, `=======`, and `>>>>>>>` marker lines, stages the resolved file with `git add` before `git commit`, and offers `git merge --abort` as the reversible exit while saying plainly that it discards the edits already made while resolving. **[all modes]**
- [ ] **C2-8 Merge summary on its own.** Clear the form and paste `Automatic merge failed; fix conflicts and then commit the result.`
  - Expected: **Git error** at **Low confidence**, signature `Automatic merge failed; fix conflicts and then commit the result.`, one evidence item at **Line 1**, and the reason **The final line is an error line from the failing command, but no specific signature covers it, so it is quoted rather than explained.** The cause points at the `CONFLICT` lines above it instead of inventing a file name.
- [ ] **C2-9 Work would be overwritten.** Clear the form and paste:
  ```text
  PS C:\Users\dev\app> git checkout main
  error: Your local changes to the following files would be overwritten by checkout:
  	src/App.tsx
  Please commit your changes or stash them before you switch branches.
  Aborting
  ```
  - Expected: **Git error**, **High confidence**, signature `error: Your local changes to the following files would be overwritten by checkout:`.
  - Expected: evidence is **Final exception line** at **Line 5** (`Aborting`) and **Matched context line** at **Line 2**.
  - Expected: the fix says Git aborted so nothing changed yet, and offers a commit or `git stash push` / `git stash pop`. The words `reset --hard` and `git clean` do not appear anywhere in the result — not in the cause, steps, fix, or limitations.

**Identity, credentials, and access**

- [ ] **C2-10 No author identity.** Clear the form and paste the full block Git prints:
  ```text
  PS C:\Users\dev\app> git commit -m "fix login"
  Author identity unknown

  *** Please tell me who you are.

  Run

    git config --global user.email "<you@example.com>"
    git config --global user.name "<Your Name>"

  to set your account's default identity.
  Omit --global to set the identity only in this repository.

  fatal: unable to auto-detect email address (got 'dev@PC.(none)')
  ```
  - Expected: **Git error**, **High confidence**, signature `fatal: unable to auto-detect email address (got '<value>')`, one evidence item — **Final exception line** at **Line 14**.
  - Expected: the fix sets `user.email` and `user.name`, and says plainly that commits already made keep the identity they were written with and that rewriting history on a shared branch is not the fix.
- [ ] **C2-11 Identity banner on its own.** Clear the form and paste `*** Please tell me who you are.`
  - Expected: **Git error** at **Low confidence**, signature `*** Please tell me who you are.` Then paste `Author identity unknown`.
  - Expected: **Git error** at **High confidence**, signature `Author identity unknown`.
- [ ] **C2-12 Password no longer accepted.** Clear the form and paste:
  ```text
  remote: Support for password authentication was removed on August 13, 2021.
  fatal: Authentication failed for 'https://github.com/dev/app.git/'
  ```
  - Expected: **Git error**, **High confidence**, signature `fatal: Authentication failed for '<url>'` — the specific `fatal:` line wins over the `remote:` line above it.
  - Expected: **Final exception line** at **Line 2** only. The fix names a token or an SSH key and says never to paste a token into a file, a commit, a chat, or a screenshot.
- [ ] **C2-13 Credential refused, HTTPS 403.** Clear the form and paste:
  ```text
  remote: Permission to dev/app.git denied to dev.
  error: The requested URL returned error: 403
  fatal: unable to access 'https://github.com/dev/app.git/': The requested URL returned error: 403
  ```
  - Expected: **Git error**, **High confidence**, signature `error: The requested URL returned error: 403`.
  - Expected: evidence is **Final exception line** at **Line 3** and **Matched context line** at **Line 2**. The result still says a token is a secret and must never be pasted anywhere.
- [ ] **C2-14 Account lacks access, one line.** Clear the form and paste `remote: Permission to dev/app.git denied to dev.`
  - Expected: **Git error**, **High confidence**, signature `remote: Permission to <owner>/<repo>.git denied to <user>.`, one evidence item at **Line 1**. The advice is to switch account or ask for access, not to change the code.
- [ ] **C2-15 SSH key refused.** Clear the form and paste:
  ```text
  $ git clone git@github.com:dev/app.git
  Cloning into app...
  git@github.com: Permission denied (publickey).
  fatal: Could not read from remote repository.
  ```
  - Expected: **Git error**, **High confidence**, signature `Permission denied (publickey).`
  - Expected: evidence is **Final exception line** at **Line 4** and **Matched context line** at **Line 3**, and the result mentions an SSH key or `ssh -T`.
- [ ] **C2-16 Branch does not exist locally.** Clear the form and paste:
  ```text
  error: src refspec main does not match any
  error: failed to push some refs to 'https://github.com/dev/app.git'
  ```
  - Expected: **Git error**, **High confidence**, signature `error: src refspec <branch> does not match any` — the specific line at **Line 1** beats the generic push summary at **Line 2**, which is selected as **Final exception line**.
  - Expected: the fix lists branches and makes the first commit before `git push -u origin <branch>`.

**Ownership, locks, and the network**

- [ ] **C2-17 Doubtful folder ownership.** Clear the form and paste:
  ```text
  fatal: detected dubious ownership in repository at 'C:/Users/dev/project'
  To add an exception for this directory, call:

  	git config --global --add safe.directory C:/Users/dev/project
  ```
  - Expected: **Git error**, **High confidence**, signature `fatal: detected dubious ownership in repository at '<path>'`.
  - Expected: evidence is **Final exception line** at **Line 4** (the command Git suggests) and **Matched context line** at **Line 1**.
  - Expected: the fix shows `git config --global --add safe.directory` for this one path, says plainly that it must not be used for untrusted, downloaded, or mounted folders, and warns that `*` turns the check off everywhere.
- [ ] **C2-18 Index lock held.** Clear the form and paste:
  ```text
  fatal: Unable to create 'C:/Users/dev/project/.git/index.lock': File exists.

  Another git process seems to be running in this repository, e.g.
  an editor opened by `git commit`, or if two `git` processes were started
  at the same time. If you make sure no processes are running then
  remove the file manually to continue.
  ```
  - Expected: **Git error**, **High confidence**, signature `fatal: Unable to create '<path>': File exists.`
  - Expected: evidence is **Final exception line** at **Line 6** and **Matched context line** at **Line 1**; the likely cause quotes the whole `fatal:` line and names `index.lock`.
  - Expected: the fix closes the other Git processes and retries first, says to delete the lock only when no Git process is running, and warns that removing it mid-write can damage the index. The Windows `del` command is listed **before** the macOS and Linux `rm` command.
- [ ] **C2-19 Line-ending notice.** Clear the form and paste:
  ```text
  warning: in the working copy of 'src/App.tsx', LF will be replaced by CRLF the next time Git touches it
  ```
  - Expected: **Git error**, **High confidence**, signature `warning: in the working copy of '<file>', LF will be replaced by CRLF the next time Git touches it`, one evidence item at **Line 1**.
  - Expected: the cause says nothing is broken, and the fix offers `core.autocrlf` or a `.gitattributes` with `* text=auto` as the choice that applies to every clone. Then paste the older short form `warning: LF will be replaced by CRLF in src/App.tsx.`
  - Expected: **Git error**, **High confidence**, signature `warning: LF will be replaced by CRLF in <file>.`
- [ ] **C2-20 Remote unreachable.** Clear the form and paste `fatal: unable to access 'https://github.com/dev/app.git/': Could not resolve host: github.com`
  - Expected: **Git error**, **High confidence**, signature `fatal: unable to access '<url>': <network detail>`, one evidence item at **Line 1**, and the likely cause quotes `Could not resolve host: github.com`.
  - Expected: nothing suggests the code or the repository is at fault. Then paste:
  ```text
  PS C:\Users\dev\app> git clone https://github.com/dev/app.git
  fatal: unable to access 'https://github.com/dev/app.git/': Failed to connect to github.com port 443 after 21062 ms: Could not connect to server
  ```
  - Expected: the same category and signature at **High confidence**, **Final exception line** at **Line 2**, and the cause names `Failed to connect to github.com`.

**Any other `fatal:` line**

- [ ] **C2-21 Generic fallback.** Clear the form and paste `fatal: bad object 0123456789abcdef`.
  - Expected: **Git error** at **Low confidence**, signature `fatal: <message Git reported>`, one evidence item at **Line 1**, and the reason **The final line is an error line from the failing command, but no specific signature covers it, so it is quoted rather than explained.**
  - Expected: the possible-fix panel opens by saying no fix is offered, because no sub-signature recognises that wording, and the commands it lists are read-only (`git status`). The result quotes the line, states that no sub-signature covers that wording, and claims no cause.
- [ ] **C2-22 Generic fallback under a trailer-heavy paste.** Clear the form and paste:
  ```text
  PS C:\Users\dev\app> git fetch
  To https://github.com/dev/app.git
  hint: some explanatory hint
  fatal: bad object 0123456789abcdef
  hint: another explanatory hint
  PS C:\Users\dev\app>
  ```
  - Expected: **Git error** at **Low confidence**, signature `fatal: <message Git reported>`.
  - Expected: evidence is **Final exception line** at **Line 6** and **Matched context line** at **Line 4**. Neither `hint:` line nor the `To …` line is quoted, and a paste this long still resolves to the `fatal:` line.
  - Expected: the confidence reason reads **An error line from the failing command appears on line 4, but no specific signature covers it, so it is quoted rather than explained.**

**Batch C2 lookalikes**

For each line below, clear the form and click **Analyze** in **Auto — infer from the text**. Expected every time: **Unrecognised**, **Low confidence**, **No rule matched**, and no possible fix. A line that carries a timestamp or any other prefix before `fatal:`, `error:`, `warning:`, `remote:`, or `hint:` is not Git writing its own message, so it is not read as one.

- [ ] `2026-10-31T10:00:00Z fatal: not a git repository (or any of the parent directories): .git`
- [ ] `[2026-10-31 10:00:00] error: remote origin already exists.`
- [ ] `In my notes I wrote that the remote origin already exists in my repo.`
- [ ] `run git push to publish your branch`
- [ ] `It was fatal that the deployment script removed the whole folder.`
- [ ] `remote:  ! [rejected] main -> main (fetch first) reported by the mirror`
- [ ] ` ! [rejected]        main -> main (stale info)` — an unlisted rejection reason is not claimed.
- [ ] `hint: Updates were rejected because the remote contains work` — a `hint:` line alone.
- [ ] `To https://github.com/dev/app.git` — the `To …` line alone.
- [ ] `PS C:\Users\dev\app> git status` — a prompt with its command alone.
- [ ] `warning: too many files; consider using a sparse checkout`
- [ ] `Merge made by the ort strategy.`
- [ ] `ERROR: Permission to "dev/app.git" denied to "dev".` — the uppercase form another tool writes is not claimed.

**Batch C2 against the existing rules**

- [ ] Clear the form, set **Language** to `Auto — infer from the text`, and paste:
  ```text
  Traceback (most recent call last):
    File "app.py", line 4, in load
  fatal: not a git repository (or any of the parent directories): .git
  ModuleNotFoundError: No module named 'requests'
  ```
  - Expected: **Missing module** at **High confidence** from `python.module-not-found`, evidence **Final exception line** at **Line 4**. The Git line is in the paste but the Python rule keeps its own exception line.
- [ ] Clear the form and paste the same traceback without the `ModuleNotFoundError` line:
  ```text
  Traceback (most recent call last):
    File "app.py", line 4, in load
  fatal: not a git repository (or any of the parent directories): .git
  ```
  - Expected: **Git error** at **High confidence**, signature `fatal: not a git repository (or any of the parent directories): .git`, **Final exception line** at **Line 3**. A traceback header alone is not an exception line, so the neutral rule reads it.
- [ ] Clear the form and paste:
  ```text
  PS C:\Users\dev\app> git push
  error: failed to push some refs to 'https://github.com/dev/app.git'
  TypeError: Cannot read properties of undefined (reading 'name')
  ```
  - Expected: **Type mismatch** at **Medium confidence** from `javascript.type-error`. The generic Git summary must not outscore a specific JavaScript match.
- [ ] **Category label on the result.** Go to `/assistant?bugId=sample-checkout-nan`, clear the prefilled **Error message**, paste the C2-1 block, and click **Analyze**.
  - Expected: the completion status line and the result card both read **Git error**. The raw id `git-error` never appears in the interface.
- [ ] **Category label in a saved diagnosis.** On the same result, with the **Loaded from bug: Checkout total shows NaN after a promo code** chip still attached, click **Save diagnosis to this bug**.
  - Expected: the dialog's Category row reads **Git error**, and the preview shows the matched Git signature and **High confidence**. Save it and click **View bug**.
  - Expected: the detail's **Saved diagnosis** section reads **Git error**, and **Fix tracking** shows **Proposed**. When you finish, click **Remove saved diagnosis** — that keeps the composed proposed fix and the **Proposed** state, so run this check on a fresh profile or expect the checkout report to keep that fix.
- [ ] Expected throughout this section: the Console stays free of errors, the Network tab shows no request to any host (the analysis is local text), and no Git command was run by the app.

### Context lines and React trailers

Set **Language** to `Auto — infer from the text` for every example in this section. Paste each block exactly as shown, one per analysis.

- [ ] **B1 Chrome CORS triple.** Clear the form and paste:
  ```text
  Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  GET https://api.example.com/data net::ERR_FAILED 200 (OK)
  Uncaught (in promise) TypeError: Failed to fetch
  ```
  - Expected: **CORS blocked request**, **High confidence**, signature `Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: missing 'Access-Control-Allow-Origin' header`.
  - Expected: the evidence shows **Final exception line** at **Line 3** and **Matched context line** at **Line 1** quoting the CORS message. The result is not **Network request failed**.
- [ ] **B2 CORS preflight.** Clear the form and paste:
  ```text
  Access to fetch at 'https://api.example.com/v1/items' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  TypeError: Failed to fetch
  ```
  - Expected: **CORS blocked request**, **High confidence**, signature `Access to <transport> at '<url>' from origin '<origin>' blocked by CORS policy: preflight request does not pass access control check`; the cause mentions the preflight request.
- [ ] **B3 Plain network failure.** Clear the form and paste:
  ```text
  GET http://localhost:9999/api/users net::ERR_CONNECTION_REFUSED
  Uncaught (in promise) TypeError: Failed to fetch
  ```
  - Expected: **Network request failed**, **High confidence**, signature `TypeError: Failed to fetch`; the likely cause names `net::ERR_CONNECTION_REFUSED`. The result is not **CORS blocked request**.
- [ ] **B4 React hooks warning with the resulting error.** Clear the form and paste:
  ```text
  Warning: Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons: 1. You might have mismatching versions of React and the renderer (such as React DOM) 2. You might be breaking the Rules of Hooks 3. You might have more than one copy of React in the same app
  Uncaught TypeError: Cannot read properties of null (reading 'useState')
  ```
  - Expected: **React error**, **Medium confidence**, signature `Error: Invalid hook call. Hooks can only be called inside of the body of a function component.`
  - Expected: the evidence shows **Final exception line** at **Line 2** and **Matched context line** at **Line 1** quoting the warning. The result is not a bare **Type mismatch** about `null`.
- [ ] **B5 Lone warning line.** Clear the form and paste:
  ```text
  Warning: Invalid hook call. Hooks can only be called inside of the body of a function component.
  ```
  - Expected: **React error**, **Medium confidence**, the same signature. Only this exact React sentence may carry the `Warning:` prefix, anchored at the start of the line.
- [ ] **B6 React render error with the component trailer.** Clear the form and paste:
  ```text
  Uncaught Error: Objects are not valid as a React child (found: object with keys {id, name}). If you meant to render a collection of children, use an array instead.
      at throwOnInvalidObjectType (react-dom.development.js:3500:13)
  The above error occurred in the <App> component:
      at App (App.jsx:5:3)
  Consider adding an error boundary to your tree to customize error handling behavior.
  ```
  - Expected: **React error**, **High confidence**, signature `Error: Objects are not valid as a React child (found: <value>)`. The trailer lines do not hide the render error.
- [ ] **B7 React too many re-renders with the same trailer.** Clear the form and paste:
  ```text
  Uncaught Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.
      at App (App.jsx:5:3)
  The above error occurred in the <App> component:
      at App (App.jsx:5:3)
  Consider adding an error boundary to your tree to customize error handling behavior.
  ```
  - Expected: **React error**, **High confidence**, signature `Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.`
- [ ] **B8 Prose mentions.** Clear the form and paste `TODO: fix the CORS error before release`, then in a separate analysis paste `see the docs about Invalid hook call`.
  - Expected each time: **Unrecognised**, **Low confidence**, **No rule matched**, and no possible fix. No cause is invented.
- [ ] **B9 Timestamped CORS copy.** Clear the form and paste:
  ```text
  2026-10-28T10:00:00Z Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:5173' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  ```
  - Expected: **Unrecognised**. A timestamp before the message prevents the match.

### JavaScript TypeError sub-signatures

Set **Language** to `JavaScript` for each one-line example. Every result should show **Type mismatch**, **High confidence**, the evidence **Final exception line** with **Line 1**, and the signature printed below. These shapes share one rule and one category; only the signature and the guidance change.

| Paste this line | Expected signature |
| --- | --- |
| `TypeError: Cannot read properties of undefined (reading 'amount')` | `TypeError: Cannot read properties of undefined (reading 'amount')` |
| `TypeError: Cannot read properties of null (reading 'length')` | `TypeError: Cannot read properties of null (reading 'length')` |
| `TypeError: Cannot read property 'amount' of undefined` | `TypeError: Cannot read property 'amount' of undefined` |
| `TypeError: Cannot read property 'length' of null` | `TypeError: Cannot read property 'length' of null` |
| `TypeError: Cannot set properties of undefined (setting 'value')` | `TypeError: Cannot set properties of undefined (setting 'value')` |
| `TypeError: Cannot set properties of null (setting 'checked')` | `TypeError: Cannot set properties of null (setting 'checked')` |
| `TypeError: items.map is not a function` | `TypeError: items.map is not a function` |
| `TypeError: items is not iterable` | `TypeError: items is not iterable` |
| `TypeError: object null is not iterable` | `TypeError: object null is not iterable` |
| `TypeError: Assignment to constant variable.` | `TypeError: Assignment to constant variable.` |
| `TypeError: Cart is not a constructor` | `TypeError: Cart is not a constructor` |
| `TypeError: can't access property "name", user is undefined` | `TypeError: can't access property "name", user is undefined` |
| `TypeError: can't access property "length", items is null` | `TypeError: can't access property "length", items is null` |

- [ ] Check the guidance for the read cases: the cause mentions the object that should have provided the value, and the example guards a property read.
- [ ] Check the modern write cases: the cause says the target was never created or was cleared, and the fix says to initialise the object.
- [ ] Check the function case: the cause mentions a value that is not callable, and the example uses `typeof`.
- [ ] Check the iterable cases: the cause mentions spread, destructuring, `Array.from`, or `for...of`, and the example uses `Array.isArray`.
- [ ] Check the constant case: the example declares with `let` and does not suggest mutating an object to silence the error.
- [ ] Check the constructor case: the fix and steps mention default versus named exports, and the example constructs `new Cart()`.
- [ ] Check the Firefox cases: the cause names Firefox and the same property-read explanation.
- [ ] Clear the form and paste `TypeError: Cannot use 'in' operator to search for 'name' in undefined`.
  - Expected: **Type mismatch**, signature `TypeError: <JavaScript type mismatch>`; this shape is outside the sub-signatures.
- [ ] Clear the form and paste `TypeError: Cannot convert undefined or null to object`.
  - Expected: **Type mismatch**, signature `TypeError: <JavaScript value type problem>`; this existing partial shape is unchanged.
- [ ] Clear the form and paste `TypeError: Cannot read property 'name' of object`.
  - Expected: signature `TypeError: <JavaScript type mismatch>`; the target is not `undefined` or `null`, so no sub-signature is claimed.
- [ ] Clear the form and paste `TypeError: can't access property "name", user is defined`.
  - Expected: signature `TypeError: <JavaScript type mismatch>`; the receiver is not `undefined` or `null`.
- [ ] Clear the form and paste `Error: items.map is not a function`.
  - Expected: **Unrecognised** with no possible fix; a plain `Error:` line is not a `TypeError`.
- [ ] Clear the form and paste `TypeError: unsupported operand type(s) for +: 'int' and 'str'`.
  - Expected: **Unrecognised** with no possible fix; Python type wording is not claimed by the JavaScript rule.
- [ ] Clear the form and paste `The page threw TypeError: Cannot read properties of undefined (reading 'name') yesterday`.
  - Expected: **Unrecognised** with no possible fix; a prose mention is not the exception line.

**Automatic detection without a stack**

- [ ] Leave **Language** at `Auto — infer from the text` and paste `TypeError: can't access property "name", user is undefined` on its own.
  - Expected: **Type mismatch**, the same specific signature, **Medium confidence**, and a reason that no traceback or explicit language confirms the runtime.
- [ ] Clear the form and paste `TypeError: Assignment to constant variable.` on its own.
  - Expected: **Type mismatch**, **Medium confidence**, and the specific signature.

Older saved diagnoses keep the signature they were saved with. A diagnosis stored as `TypeError: <JavaScript value type problem>` still loads, displays that exact signature in the detail page, and exports unchanged.

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

Run this before saving any diagnosis. Once a diagnosis is saved, the evidence items you keep are stored in the report, as the next section checks.

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

### Saved diagnosis: analyse, save, verify, and remove

Run this on a fresh profile with the five sample reports. *Checkout total shows NaN after a promo code* starts with no proposed fix and no diagnosis.

**Prefill and context**

- [ ] Open *Checkout total shows NaN after a promo code* and expected: **Analyse with Assistant** sits with **Copy error message** in the error-message section.
- [ ] Click **Analyse with Assistant**.
  - Expected: the URL is `/assistant?bugId=sample-checkout-nan`.
  - Expected: a **Loaded from bug: Checkout total shows NaN after a promo code** chip appears, Language is `JavaScript`, the error field contains the report's error, Reproduction details contains `Steps to reproduce:` and `Actual behavior:`, and the result panel still says **No analysis yet**. Nothing has run automatically.
- [ ] Type `keep this text` into **Code snippet**, then click **Remove** on the chip.
  - Expected: the chip and the `bugId` query disappear, the typed text stays, and no analysis runs.
- [ ] Navigate to `/assistant?bugId=missing-report`.
  - Expected: the notice **No saved report matches this link. Paste an error to continue.** appears, there is no chip, and the form is usable.
- [ ] Navigate back to `/assistant?bugId=sample-checkout-nan` and click **Analyze**.
  - Expected: **Type mismatch**, **High confidence**, the evidence **Final exception line**, and **Save diagnosis to this bug**.
- [ ] Click **Remove** on the chip while the result is visible.
  - Expected: **Save diagnosis to this bug** disappears, the result stays, and storage does not change. Reopen the link and analyze again to continue.

**Preview and save**

- [ ] Click **Save diagnosis to this bug**.
  - Expected: the dialog **Save diagnosis to this bug?** shows Category `Type mismatch`, the matched signature, **High confidence**, the evidence item checked, and a **Proposed fix** preview containing the explanation, a blank line, `Example code:`, and the example code.
  - Expected: it says this bug has no proposed fix, so saving stores one and sets the fix state to **Proposed**.
  - Expected: it says nothing is marked as verified, and focus starts on **Cancel**.
- [ ] Press `Tab` and `Shift+Tab` repeatedly. Expected: focus cycles through the dialog's close button, the evidence checkbox, the keyboard-focusable **Proposed fix** preview, **Cancel**, and **Save diagnosis** only. Focus the preview and use the arrow keys to scroll it. Press `Escape`.
  - Expected: the dialog closes, focus returns to **Save diagnosis to this bug**, and no report changes.
- [ ] Reopen the preview, untick the evidence checkbox, and click **Cancel**.
  - Expected: no diagnosis is saved, and focus returns to the trigger. In the Console, this returns `undefined`:
    ```js
    JSON.parse(localStorage.getItem('bugpilot.bugs.v1')).bugs.find(b => b.id === 'sample-checkout-nan').diagnosis
    ```
- [ ] Reopen the preview and expected: the evidence is checked again by default. Untick it, then click **Save diagnosis**.
  - Expected: a toast says **Diagnosis saved to this bug.** with a **View bug** link, focus returns to the trigger, and the link opens `/bugs/sample-checkout-nan`.
- [ ] Expected: the detail shows a **Saved diagnosis** section with `Type mismatch`, **High confidence**, the signature, and the saved date. **Saved evidence** says **No evidence was saved with this diagnosis.**
  - Expected: **Fix tracking** shows **Proposed**, the composed proposed fix is present, the fact panel says **Fix status: Proposed**, the workflow status is still `Open`, and the verification notes are unchanged.
- [ ] Reload the detail. Expected: the diagnosis, composed fix, and `Proposed` state persist.

**Existing fix, Verified state, and replacement**

- [ ] Click **Edit report**, set **Fix status** to `Verified`, enter `Checked during the saved-diagnosis test.` in **Verification notes**, and click **Save changes**.
  - Expected: the saved diagnosis is still shown once, and **Fix tracking** changes to **Verified** with the notes.
- [ ] Click **Analyse with Assistant** again, click **Analyze**, then **Save diagnosis to this bug**.
  - Expected: the dialog says the existing proposed fix will be **KEPT** and only the diagnosis is saved, shows an unticked **Replace the existing proposed fix with this one** checkbox, says **Fix state stays Verified.**, and names the existing saved-diagnosis date.
- [ ] Save without ticking replace, then click **View bug**. Expected: the diagnosis is replaced with a new saved date, **Saved evidence** now shows **Final exception line**, the proposed fix text is unchanged, and **Fix status** is still `Verified` with the same notes.
- [ ] Edit the report, change **Proposed fix** to `Existing fix kept during the diagnosis test.`, keep **Fix status** `Verified` and the notes, and save.
- [ ] Click **Analyse with Assistant** again, click **Analyze**, click **Save diagnosis to this bug**, tick **Replace the existing proposed fix with this one**, and save. Click **View bug** in the toast.
  - Expected: the proposed fix becomes the composed explanation plus example code, while **Fix status** stays `Verified` and the verification notes are unchanged.
- [ ] Reload the detail and expected: exactly one saved diagnosis, `Verified`, and the notes remain.
- [ ] In the Console, inspect what the save wrote:
  ```js
  (() => {
    const saved = JSON.parse(localStorage.getItem('bugpilot.bugs.v1')).bugs.find(b => b.id === 'sample-checkout-nan');
    return {
      diagnosisKeys: Object.keys(saved.diagnosis).sort(),
      evidence: saved.diagnosis.evidence,
      diagnosisHasRawStack: JSON.stringify(saved.diagnosis).includes('applyDiscount'),
      diagnosisHasSteps: JSON.stringify(saved.diagnosis).includes('SAVE10'),
      fixHasRawStack: saved.proposedFix.includes('applyDiscount'),
      fixStatus: saved.fixStatus,
    };
  })()
  ```
  - Expected: the keys are `category`, `confidence`, `evidence`, `matchedSignature`, and `savedAt`; evidence is exactly the ticked **Final exception line** `{ label, quote }`; the three raw-text checks are `false`; and `fixStatus` is `Verified`.
  - Expected: the full pasted error text, stack frames, reproduction details, and any unticked evidence are not in the diagnosis or the composed fix.

**Remove**

- [ ] Click **Remove saved diagnosis**.
  - Expected: the dialog **Remove saved diagnosis?** explains that only the diagnosis is removed and the proposed fix, fix state, status, and verification notes are kept, and that this cannot be undone. Focus starts on **Cancel**.
- [ ] Press `Escape`. Expected: the dialog closes, focus returns to **Remove saved diagnosis**, and the diagnosis remains.
- [ ] Reopen and click **Cancel**. Expected: the same.
- [ ] Reopen, press `Tab` and `Shift+Tab` repeatedly. Expected: focus cycles only through the close button, **Cancel**, and **Remove diagnosis**.
- [ ] Click **Remove diagnosis**.
  - Expected: a toast says **Saved diagnosis removed.**, the **Saved diagnosis** section disappears, and the proposed fix, `Verified` state, verification notes, and workflow status remain.
- [ ] Reload. Expected: the diagnosis stays removed and the fix fields are unchanged.
- [ ] In the Console, expected: the report has no `diagnosis` key, and `proposedFix`, `fixStatus`, and `verificationNotes` still hold their values.

**Limits and layout**

- [ ] With no `bugId` context, analyze the Python `ModuleNotFoundError` example. Expected: no **Save diagnosis to this bug** button appears.
- [ ] Analyze `The widget exploded.` with no context. Expected: the result is **Unrecognised** and there is no save button.
- [ ] The 20,000-character composition limits and the storage-failure path are covered by the automated tests; do not paste a multi-megabyte fixture or force a quota failure by hand.
- [ ] At 390 × 844 in both themes, open the preview from the checkout report. Expected: the dialog fits the viewport with internal scrolling, its actions are reachable, and the page does not scroll sideways.
- [ ] At 1440 × 900 in both themes, expected: the preview is centered and every field is readable.

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
- [ ] Continue pressing `Tab` through the brand, theme button, **Overview**, **Bug log**, **Assistant**, **Analyze code**, and **Report a bug**.
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

- [ ] The sidebar becomes a compact top header: brand and theme button on the first row, the four navigation links in two columns below it. The sidebar-only **Report a bug** button is hidden, but the page-level **Report a bug** button remains.
- [ ] In the Console, run:
  ```js
  document.documentElement.scrollWidth <= window.innerWidth
  ```
  Expected: `true` on Overview, Bug log, a detail, the form, Assistant, Analyze code, and a missing URL.
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

### Saved diagnosis export and import

Run this after the saved-diagnosis flow above. Save a diagnosis again if the earlier import steps replaced or restored the log, or if you followed the saved-diagnosis flow through its remove step.

- [ ] On **Bug log**, click **Export reports** and open the downloaded file.
  - Expected: the diagnosed report contains a `diagnosis` object after `updatedAt`, with `category`, `matchedSignature`, `confidence`, `evidence`, and `savedAt`.
  - Expected: the report's ordinary `proposedFix`, `fixStatus`, and `verificationNotes` are exported too. The diagnosis contains only the selected evidence `label`/`quote` pairs, not the full pasted error text, the code snippet, or the reproduction details.
- [ ] Import that export into a fresh profile (or the other local origin), using **Replace all reports** and its acknowledgement so the same sample ids are not skipped. Expected: the preview counts it as valid, and after import the detail shows the same category, signature, confidence, evidence quote, saved date, proposed fix, `Verified` state, and verification notes.
- [ ] Import an older export whose report has no `diagnosis` field. Expected: it remains valid, imports normally, and the detail shows no **Saved diagnosis** section and no `diagnosis: null` key.
- [ ] Create a JSON file **outside the project folder** with one otherwise valid report whose diagnosis has an invalid confidence or a bad `savedAt`, then import it. Expected: the preview lists that position with a reason starting **The saved diagnosis is invalid**, no record is repaired, and nothing is saved when it is the only report.
- [ ] In the Console, inspect the imported reports:
  ```js
  JSON.parse(localStorage.getItem('bugpilot.bugs.v1')).bugs.map(b => ({ id: b.id, diagnosis: b.diagnosis, keys: Object.keys(b) }))
  ```
  Expected: each diagnosed report has one `diagnosis` key; a report without one has no `diagnosis` key at all.

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

## 14. Code analysis

Use a disposable profile and keep DevTools open. Create every sample file and archive in a scratch folder **outside this repository**. The page never executes uploaded code, and no sample needs to be committed.

### Sample folder, loose files, and archives

Create a folder named `analyze-sample` with these files. Invent the fake key yourself; never paste a real credential.

- `app.js` containing `const total = ;` — a JavaScript syntax error.
- `main.ts` containing `function add(a: number) { return a + }` — a TypeScript syntax error.
- `secret.py` containing `AWS_ACCESS_KEY = "AKIA"` followed by sixteen invented uppercase letters and digits — a Python assignment to a made-up AWS-style key.
- `tabs.py` with mixed indentation: a function whose first body line starts with a tab and whose later lines use spaces.
- `broken.json` containing `{ "name": "demo", }` — a trailing comma, so JSON parsing fails.
- `conflict.js` containing a merge conflict: `<<<<<<< HEAD`, `const value = 1`, `=======`, `const value = 2`, `>>>>>>> other`.
- `empty-catch.py` containing `except ValueError: pass` under a `try` block.
- `notes.txt` containing `See http://insecure-demo.dev/docs and TODO: replace this.` (the `http://` rule deliberately ignores local and documentation hosts, so do not use `example.test`).
- `image.png` — any small real PNG.
- `node_modules/skip-me.js` — any JavaScript file.
- `big.log` — more than 2 MiB of text (for the per-file skip check).

Zip the folder as `analyze-sample.zip`. From the scratch folder, also build the other supported containers from the same files (Git Bash supplies `tar` and `gzip`):

```bash
tar -cf analyze-sample.tar analyze-sample
tar -czf analyze-sample.tar.gz analyze-sample
gzip -c analyze-sample/notes.txt > notes.txt.gz
cp analyze-sample.tar.gz mislabeled.zip
```

`notes.txt.gz` is one lone gzip stream, not a tar. `mislabeled.zip` is a gzip file whose name claims zip — the reader must decide from the bytes and report the disagreement.

- [ ] Open **Analyze code** in the sidebar.
  - Expected: `/analyze`; tab title **Analyze code · BugPilot**; headings **Analyze code** and **Upload code to check**; the **Local analysis only.** statement; the limits list; **No files checked yet**.
- [ ] Click **Choose a folder** and select `analyze-sample`.
  - Expected: progress announces **Reading the upload**, then **Running BugPilot rules**, then **Checking TypeScript syntax**, with **Cancel** available. No dialog asks for permission to upload anything.
  - Expected: focus moves to **Results for N files**; the summary shows findings, files analysed, files skipped, and critical/high counts.
  - Expected findings include: JavaScript and TypeScript syntax errors (High), a Critical secret finding, JSON syntax (High), merge-conflict markers (High), empty `except` (Low), insecure `http://` URL (Low), and TODO marker (Low).
  - Expected: the secret's evidence is redacted to its first two and last two characters. The full fake key never appears on the page.
  - Expected: the coverage list names every file under `analyze-sample/`. `analyze-sample/image.png` is **Skipped** as binary, `analyze-sample/node_modules/skip-me.js` is **Skipped** as a vendored folder, and `analyze-sample/big.log` is **Skipped** with the per-file ceiling reason. Analysed files list their language and the syntax/pattern tiers that ran or were unavailable.
  - Expected: **No findings does not mean no bugs** lists the checks that were not performed for each analysed language.
- [ ] Change **Severity** and **File**, then click **Reset filters**.
  - Expected: the **Showing X of Y findings** status and the visible groups follow the filters; reset restores all groups.
- [ ] Click **Download report.json** with the snippet box still unticked, open the downloaded file, then repeat with the box ticked.
  - Expected filename: `bugpilot-analysis-<timestamp>.json`, where `<timestamp>` is the report's ISO time with `:` and `.` replaced by `-`.
  - Expected: unticked → `"includeSnippets": false`, every `evidence` array is empty, and the limitations include the snippet-exclusion note; ticked → `"includeSnippets": true` and evidence quotes are present (the secret stays redacted).
- [ ] Download `report.md` both ways and open the file.
  - Expected: the same filename stem ends in `.md`; the report notes **Code snippets in this export: no/yes**; findings, explanations, coverage, skipped entries, and limitations are present; evidence is absent unless ticked.
  - Expected: the export status line under the buttons confirms whether quotes were left out. Both downloads are built in the tab; DevTools shows no upload, no external request, and no request carrying file contents.
- [ ] Click **Clear results**.
  - Expected: findings, coverage, filters, and both download buttons disappear; **No files checked yet** returns; saved reports in **Bug log** are unchanged.
- [ ] Upload `analyze-sample.zip` with **Choose files** (not the folder picker).
  - Expected: the same findings and skipped reasons, with entries named inside the zip.
- [ ] Repeat with `analyze-sample.tar` and `analyze-sample.tar.gz`.
  - Expected: the same findings and skipped reasons as the zip. Entry names carry the archive's own paths (a `tar` built from the folder shows `analyze-sample/app.js`), and every analysed file is still listed with its own language and tiers. The coverage panel names the container as tar or gzip.
- [ ] Upload `notes.txt.gz`.
  - Expected: one analysed file named `notes.txt`, with the insecure-http URL (Low) and TODO marker (Low). The coverage panel says the upload was a gzip and shows one file. The file's text is read after inflating, never shown as an archive.
- [ ] Upload `mislabeled.zip`, then download `report.md` and `report.json`.
  - Expected: the analysis still runs, because the signature decides. No refusal. The downloaded `report.md` (under **Limitations**) and `report.json` (`limitations`) include a sentence saying the file is named `.zip` but its contents are a gzip archive, and that BugPilot works out the format from the contents, not the name.
- [ ] Upload `analyze-sample.tar` renamed to `analyze-sample.gz` (or the gzip renamed to `.tar`), then download a report.
  - Expected: the reader opens the format its bytes really are and adds the same kind of naming note to the downloaded report's limitations; nothing is refused just because the suffix is wrong.
- [ ] Drag a loose `.js` file and then the whole folder onto the drop area.
  - Expected: both start the same analysis; the drag highlight clears when the pointer leaves.
- [ ] Start a large folder or zip, then click **Cancel**.
  - Expected: **Analysis cancelled** says nothing was kept; no results panel appears; no report downloads are offered.

### Paste, notebooks, sensitive names, generated files, and multiple uploads

Use a third scratch folder outside the repository for these samples. Invent every fake value yourself.

- [ ] Switch to the **Paste code** tab, choose **Python**, leave the virtual name empty, and paste:
  ```python
  api_key = "<type your own made-up value here>"
  # TODO: move this key out of the source
  ```
  Replace the bracketed placeholder with a made-up random string of at least 24 mixed-case
  letters and digits, typed by you; never use a real key. A placeholder word such as `example`
  is deliberately ignored by the rule, so the value has to look random.
  - Expected: the run completes for one file named `pasted/snippet.py`. The findings include the credential rule with a redacted quote and the TODO marker; the full string never appears on the page, and the reviewed diff masks it. The paste never becomes a real file and no picker opens.
- [ ] Paste the same text with the virtual name `../../keys.py`.
  - Expected: the report names it `snippet.py` or `keys.py` — never `../../` — because only the last segment of the virtual name is kept.
- [ ] Paste an empty box. Expected: **Nothing was pasted, so there is no text to check.** Paste more than 1 MiB of text. Expected: an **Upload refused** message quoting the byte count and the 1 MiB paste ceiling, with **Nothing was analysed and nothing was kept.**
- [ ] Create `analysis.ipynb` as a small real notebook with three cells: a Python code cell containing `See http://insecure-demo.dev/docs`, a second code cell whose saved `stream` output contains a made-up credential-shaped string, and a Markdown cell. Upload it with **Choose files**.
  - Expected: the coverage panel lists `analysis.ipynb#cell-1` and `analysis.ipynb#cell-2`, and the stored output as its own row (`analysis.ipynb#cell-2.output-1`). The Markdown cell is not analysed.
  - Expected: the output row produces only credential findings, with the message **A credential-shaped value appears in this cell’s stored output.**, empty evidence, no fix checkbox, and the limitation that stored output is never quoted or kept. Neither the stored text nor any part of it appears anywhere on the page or in either export.
  - Expected: a code-cell finding that would normally offer a fix has no checkbox and says the change must be made in Jupyter; the clean export contains no notebook cell.
- [ ] Upload a broken notebook: the same JSON with a missing comma. Expected: one JSON syntax finding, no quoted text, and a note saying BugPilot read the notebook as JSON only and never edits it.
- [ ] Create a folder `sensitive-sample` containing a `.env` file with an invented password, an `id_rsa` file (contents can be any text), a `server.p12` file (any bytes), `package-lock.json` (valid JSON), `bundle.min.js` (one file with a long minified line), `node_modules/.env` with another invented value, and `src/app.js` with `const total = ;`.
  - Expected: `.env` produces the High `bugpilot/sensitive/env-file` finding, `id_rsa` the Critical `bugpilot/sensitive/private-key-name` finding, and `server.p12` the High `bugpilot/sensitive/keystore` finding. None of them quotes the file, and all carry a manual-only "remove, add to .gitignore, rotate" direction.
  - Expected: `package-lock.json` and `bundle.min.js` are **Skipped** with a generated-file reason naming the lockfile and the minified bundle. `node_modules/.env` is **Skipped** as a vendored folder yet still produces its High sensitive-name finding, because a name scan runs on skipped files too.
  - Expected: `src/app.js` still produces its JavaScript syntax finding.
- [ ] Tick **Include generated and vendored files** and upload the same folder again.
  - Expected: `package-lock.json` and `bundle.min.js` are now analysed, subject to the same size limits, and appear in the findings/coverage instead of the skipped list. A `.git` folder is still never read at any setting, and its reason says so.
- [ ] Create two folders, `multi-a` and `multi-b`, each with a different `src/app.js` (one with a syntax error, one with an insecure `http://` URL). Choose folder `multi-a`, then click **Add another upload to this run** and choose `multi-b`.
  - Expected: one run covers both, files are named `upload-1/multi-a/src/app.js` and `upload-2/multi-b/src/app.js` (the picked folder name is part of each path), and both findings appear. Neither file overwrites the other.
- [ ] With those files already picked, try to add `analyze-sample.zip` through **Add another upload to this run**.
  - Expected: the archive is not merged into the run; the message says BugPilot opens one archive per run, so Clear and pick the archive on its own, or add loose files and folders here.

### Deep analysis engines (WebAssembly)

The deep pass is a second run over the same upload. Keep DevTools open with the Network tab cleared after the page loads, and create this second scratch folder **outside this repository**, named `deep-sample`. The syntax-error files are meant to be broken; do not repair them.

- `app.py` — `def load(:` on the first line, so Python cannot parse it at all.
- `imports.py` — an unused `import` at the top and a variable assigned and never read.
- `pw.py` — `password = ` followed by a value **you make up on the spot** (mix letters and digits, at least ten characters). Do not reuse any real credential, and do not put this folder under version control.
- `Service.java` — a `try`/`catch` whose handler has an empty block.
- `main.go` — a `return` followed by a statement it can never reach.
- `api.php` — a SQL string built with `.` concatenation from a `$_GET` value, passed straight into `$conn->query(...)`.
- `queries.py` — the same shape in Python: `cursor.execute("SELECT ... " + user_id)`, where the AST rule and Ruff's S608 both have an opinion.
- `cond.c` — `if (x = 0)` (an assignment inside a condition).
- `build.sh` — a script with a missing quote at the end.
- `page.html` — an `<a>` whose `href="` quote is never closed, which the HTML grammar marks as an error. (A page whose only mistake is *unclosed tags* is legal to that grammar and produces no finding; the README says so rather than pretending otherwise.)
- `theme.css` — a declaration missing its closing brace.
- `config.yaml` — a sequence whose indentation is inconsistent. This one is a deliberate negative: the YAML grammar is on the "cannot be trusted to be error-free for valid files" list, so BugPilot records it as missing coverage instead of as a bug.
- `notes.md` and `data.json` — files with no deep engine, to confirm they are left out of the plan.

- [ ] Upload `deep-sample` with **Choose a folder** and wait for the built-in pass to finish.
  - Expected: the summary heading **Results for N files** appears, and only then does the panel **Deep analysis engines** appear under the eyebrow **Optional second pass**.
  - Expected in Network: the only engine-related request so far is `/assets/engines/manifest.json`. No `.wasm` file and no engine script has been requested — nothing heavy loads before the button is pressed.
  - Expected: the panel's prose says the built-in pattern rules have already run, that the engines run as WebAssembly inside the tab, and that "your code is still not uploaded, not stored, and not executed".
- [ ] Read the file list in the panel.
  - Expected: one row per file this upload needs — **Worker loader script**, **Analysis worker script**, **tree-sitter runtime**, one row per grammar (`Bash grammar`, `C grammar`, `CSS grammar`, `Go grammar`, `HTML grammar`, `Java grammar`, `PHP grammar`, `Python grammar`, `YAML grammar`), and **Ruff (Python linter)** — each with `… compressed` after a size.
  - Expected: markdown and JSON have no grammar row, because no engine reads them.
  - Expected: the total line reads **About 4.2 MiB in total, compressed, served by this site.** for this folder. Compare each quoted size with `dist/assets/engines/manifest.json` (`node -e "console.table(require('./dist/assets/engines/manifest.json').files)"` from the `bugpilot` folder): the numbers are the build's own, not a hand-written table.
- [ ] Click **Cancel, keep the pattern-rule report**.
  - Expected: the panel disappears, the built-in findings and both downloads stay, and no `.wasm` request is made at any point.
  - Expected: in the coverage panel the syntax tier of every engine language now reads `not available: The deep engines were not used for this upload; only the built-in rules ran.`
- [ ] Upload `deep-sample` again and click **Run deep analysis**.
  - Expected in Network: the engine scripts and exactly the quoted `.wasm` files are fetched from this origin, with `Content-Type: application/wasm` and the engine security headers (section 17); then the run proceeds.
  - Expected progress: **Running deep analysis engines** with **Deep engines: probing WebAssembly support.** first, then **Deep engines: checking <file>.** and a file counter; **Cancel** stays available during the pass.
  - Expected: the results are replaced by the deep report — the built-in findings are still there, plus engine findings.
- [ ] Check the findings per language.
  - `app.py`: a High syntax finding whose message starts **Syntax error:**; the tier row for `app.py` shows the syntax tier ran.
  - `imports.py`: pattern-tier findings that name the Ruff codes, e.g. `(F401)` for the unused import and `(F841)` for the unread assignment.
  - `pw.py`: a Critical finding for a possible hardcoded password. Expected: neither the message nor the evidence quote contains the value you typed.
  - `Service.java`: the empty-catch finding; `main.go`: the unreachable-code finding; `api.php`: the SQL-concatenation finding; `cond.c`: the assignment-in-condition finding. Each names its `bugpilot/ast/…` rule and its tier.
  - `queries.py`: the same SQL-concatenation rule, and where Ruff reports the same line the two are merged into one finding. The `Service.java` row also carries the line "1 pattern match(es) on this file were replaced by the syntax-tree result for the same line." — that is the de-duplication note, not an error.
  - `build.sh`, `page.html`, `theme.css`: a syntax finding each, at the line the grammar points at. Spot-check one: the line number in the finding matches the broken line in the file, and the evidence is that line.
  - `config.yaml`: **no** syntax finding, and an explicit note in the coverage panel instead — "The yaml grammar reported N construct(s) it could not match, starting at line 2 … recorded as missing coverage instead of as a bug." A grammar that also rejects valid files must not be allowed to raise a bug report.
  - Expected: no engine finding carries a checkbox. Ruff's WebAssembly build offers no fixes, so Python rows are text-only and their risk class is `manual-only`.
- [ ] Open the coverage panel (**What was and was not checked**).
  - Expected: `— ran` for both tiers on every engine language, `Syntax — not available: No Markdown syntax engine is bundled.` on `notes.md`, and the YAML note above on `config.yaml`.
  - Expected in the **exported** `report.json` (and the markdown export) under `limitations`: "No type checking or data-flow analysis ran. A linter is used only where the file coverage says so, and it reads one file at a time." Each Python finding also carries its own limitation naming the Ruff code and saying it does not follow values.
  - Expected: `notes.md` and `data.json` are listed as pattern-rule-only or skipped, never as "checked by the deep engines".
- [ ] In the page Console (top frame, not the worker) run:
  ```js
  await WebAssembly.compile(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0]))
  ```
  - Expected: **refused** by `script-src` with a CSP error mentioning `wasm-unsafe-eval`. That refusal is the proof that the main document keeps the unscoped policy while the engine worker is allowed to compile. Do not "fix" it by adding `'wasm-unsafe-eval'` to the main policy.
- [ ] Simulate a browser that cannot compile WebAssembly. Serve the same `dist/` from the temporary header server used in section 17, but edit **only the engine rule's** `script-src` in that server's copy of the configuration, removing `'wasm-unsafe-eval'`. The engine worker then starts under a policy that refuses `WebAssembly.compile`, which is exactly what an unsupported or hardened browser does.
  - Expected: the report still renders with every built-in finding, and an alert appears whose heading is **Deep engines did not run** and whose sentence is verbatim: **Deep analysis engines are unavailable in this browser or blocked by its security policy; basic checks still ran** — followed by **The findings above come from the pattern rules and cover all N analysed file(s). Syntax-tree and linter checks were not possible here.**
  - Expected: the same sentence is in the report limitations, so it reaches `report.json` and `report.md`. Restore the configuration afterwards.
  - Expected: the deep pass offers no second **Run deep analysis** button — the gate is not shown again for a result that came from a deep run — while **Clear results** still works, so the reader can start over.
  - Measured here on 2026-11-03 (same build, header server on port 4188 with `'wasm-unsafe-eval'` removed from the engine rule only): the alert appeared with the verbatim sentence, `report.json` carried it in `limitations`, **no** `.wasm` file was requested after the probe failed, findings stayed at 7 before and after, and every engine file read `Syntax — not run: WebAssembly was refused by this browser or its security policy, so no deep engine ran on this file.`
- [ ] Second degradation path, for completeness: block the URL pattern `assets/engines/*` in DevTools → Network → **Request blocking**, reload `/analyze`, upload `deep-sample` and press **Run deep analysis**.
  - Expected: the built-in findings and both downloads still work and nothing is stored. The wording is **not** the sentence above, and that is deliberate: nothing was refused by the policy, the engine script simply never arrived, so each engine file reads `Syntax — not run: The deep-engine worker could not start (Failed to fetch dynamically imported module: <the engine client URL>).` and there is **no** page-level **Deep engines did not run** alert. `report.json` keeps only the standard limitation list and claims no engine finding.
  - Measured here on 2026-11-03 (harness aborts `/assets/engines/**` after the manifest and the client script both fail): findings 7 → 7, no page-level alert, 2 failed requests logged in the Console as `net::ERR_FAILED`, and the same per-file message as above. Two browser console errors in this run are the harness's own blocked requests, not a defect.
- [ ] Run a deep pass on the slice A `analyze-sample` folder and then a **Build clean export**.
  - Expected: the patch, zip, changelog and both reports contain only the built-in safe fixes; no Ruff or tree-sitter finding is proposed as a change, and the engine findings do not appear as fixes.
- [ ] While the deep pass runs, upload nothing else and watch Storage.
  - Expected: `localStorage.getItem('bugpilot.bugs.v1')` is unchanged, no new key or IndexedDB database appears, and DevTools Network shows only requests to this origin — no request carries a file name or file contents.

### Fix selection, defaults, and the diff review

Upload the sample folder in a fresh state and wait for **Step 2 · Automatic fixes**.

- [ ] Expected defaults: the trailing-comma change in `broken.json` is the only safe change and is ticked; the credential lookup in `secret.py`, the `http://` → `https://` change in `notes.txt`, and the indentation change in `tabs.py` are `needs-review` and unticked; the syntax errors, merge conflict, empty catch and TODO have no checkbox and keep their manual-only text.
- [ ] Expected summary: **1 change selected in 1 file** and **Review changes** is enabled. Untick the safe change → **0 changes selected in 0 files**, the button is disabled, and the note reads **Select at least one change to open the review.** Tick it again.
- [ ] Tick the credential change. Expected: the card shows the rotate sentence verbatim, and the summary updates to **2 changes selected in 2 files**. Tick the `tabs.py` and `notes.txt` changes too for a multi-file diff.
- [ ] Click **Review changes**. Expected: focus moves to **Diff of N proposed changes in M files**; unified and side-by-side controls are present; files are collapsible sections listing their causing findings; rows carry line numbers and `+`/`-` glyphs plus visually hidden *added*/*removed* text.
- [ ] Click **Side by side** at a wide window, then **Unified**. Narrow the window below 720 px: **Side by side** becomes disabled with the width explanation and the unified diff stays.
- [ ] Use **Previous change** and **Next change**, then repeat with `Tab` to the same buttons and `Enter` or `Space`. Expected: the counter moves, the matching row receives focus, and `Tab` order follows the sections.
- [ ] Search the page for the full fake key (`Ctrl+F`). Expected: it is not found. Removed credential lines show first character, an ellipsis, and the last character, with no reveal control.
- [ ] While the review is open, run `document.querySelectorAll('[style]').length` in the Console. Expected: `0`, with no inline-style CSP violation.

### Clean export and the patch round trip

- [ ] In **Step 3 · Clean export**, confirm all four outputs are ticked and the warning says **changes.patch contains your original lines** and that it may contain the original credential. Untick every output: the button is disabled and says **Tick at least one output to build.** Tick all four again.
- [ ] Click **Build clean export**. Expected: five download buttons appear (changes.patch, clean.zip, CHANGELOG.md, report.md, report.json) and the count names the files and fixed files.
- [ ] Download all five. Expected: each button works with the mouse and, after repeating the flow, with the keyboard. A polite status names the file just downloaded.
- [ ] Open `CHANGELOG.md`, `report.md`, `report.json`, and `MANIFEST.md` inside the zip and search for the full fake key. Expected: never present. The changelog lists finding id, rule id, file, line range, risk class, description, behaviour warnings and the rotate warning. The report has an **Included fixes** section. The manifest says the zip is not a full project copy and recommends `changes.patch`.
- [ ] Open `changes.patch`. Expected: per-file `--- a/...` and `+++ b/...` sections; it **does** quote the original credential line, which is why the warning exists. Do not share it.
- [ ] Copy `analyze-sample` to a scratch Git repository, commit it, then apply the downloaded patch:
  ```bash
  git init
  git add -A
  git commit -m "sample before BugPilot"
  git apply --check changes.patch
  git apply changes.patch
  git status --short
  ```
  Expected: `--check` exits 0; after applying, `broken.json` parses, `secret.py` reads the environment instead of the invented key, `notes.txt` uses `https://`, and `tabs.py` has one indentation style. All changed files are listed as modified.
- [ ] Unzip `clean.zip` in a separate folder and compare its text files byte for byte with the applied repository (`git diff --no-index <folder> <folder>` or `cmp`). Expected: identical for the analysed text files; the zip has no `image.png`, `node_modules`, or `big.log`.
- [ ] Run `git apply -R changes.patch` and then `git status --short`. Expected: no output — the originals are restored byte for byte.
- [ ] Guard-failure check: reload `/analyze`, select at least one change, and before clicking **Build clean export** run this in the Console to make the re-verification analyzer unavailable:
  ```js
  window.Worker = class { constructor() { throw new Error('guard test: worker blocked') } }
  ```
  Click **Build clean export**. Expected: **Clean export blocked** with a message that the change **did not verify again**, names the worker failure, says the export was blocked, and offers **Download report only**. No patch, zip or changelog download button appears. Reload the page afterwards to restore `Worker`.

### Hostile archives and the declared limits

These archives are generated locally and never committed. Save this script as `bugpilot\hostile-archives.mjs` temporarily, run `node hostile-archives.mjs` from the `bugpilot` folder, then delete the script. It writes the samples to `%TEMP%\bugpilot-hostile` and uses the already-installed `fflate`.

```js
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomFillSync } from 'node:crypto'
import { gzipSync, zipSync, strToU8 } from 'fflate'

const out = join(tmpdir(), 'bugpilot-hostile')
mkdirSync(out, { recursive: true })
const write = (name, data) => writeFileSync(join(out, name), data)
const concat = (...parts) => {
  const joined = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) { joined.set(part, at); at += part.length }
  return joined
}
const tarHeader = (name, size) => {
  const header = new Uint8Array(512)
  header.set(strToU8(name), 0)
  header.set(strToU8('0000644'), 100)
  header.set(strToU8('0000000'), 108)
  header.set(strToU8('0000000'), 116)
  header.set(strToU8(size.toString(8).padStart(11, '0')), 124)
  header.set(strToU8('00000000000'), 136)
  header.fill(0x20, 148, 156)
  header[156] = 0x30
  header.set(strToU8('ustar'), 257)
  header.set(strToU8('00'), 263)
  let sum = 0
  for (const byte of header) sum += byte
  header.set(strToU8(sum.toString(8).padStart(6, '0') + '\u0000 '), 148)
  return header
}
const tarOf = (name, text) => {
  const body = strToU8(text)
  return concat(tarHeader(name, body.length), body, new Uint8Array((512 - (body.length % 512)) % 512), new Uint8Array(1024))
}

write('hostile-traversal.zip', zipSync({ '../escape.txt': strToU8('x') }))
write('hostile-nested.zip', zipSync({ 'inner.zip': strToU8('not really a zip') }))
const many = {}
for (let i = 0; i < 6000; i += 1) many[`f${i}.txt`] = strToU8('x')
write('hostile-many.zip', zipSync(many))
write('hostile-bomb.zip', zipSync({ 'bomb.txt': new Uint8Array(8 * 1024 * 1024) }))
write('hostile-7z.zip', concat(new Uint8Array([0x37, 0x7b, 0xa3, 0xab, 0x27, 0x1c]), new Uint8Array(64)))
write('hostile-rar.zip', concat(new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]), new Uint8Array(64)))
write('hostile-bidi.zip', zipSync({
  ['src/invoice\u202Egnp.js']: strToU8('See http://insecure-demo.dev/docs\n'),
  ['src/hidden\u200Bpart.js']: strToU8('// TODO: hidden name\n'),
  ['<img src=x onerror=alert(1)>.js']: strToU8('const value = ;\n'),
  ['src/[click](x)*.js']: strToU8('See http://insecure-demo.dev/docs\n'),
  [`deep/${'x'.repeat(300)}.js`]: strToU8('const value = ;\n'),
}))
write('hostile-newline.zip', zipSync({ ['src/a\nb.js']: strToU8('See http://insecure-demo.dev/docs\n') }))
write('hostile-traversal.tar', tarOf('../escape.txt', 'x'))
write('hostile-truncated.tar', tarOf('cut.txt', 'x'.repeat(2048)).slice(0, 700))
write('hostile-truncated.tar.gz', gzipSync(tarOf('cut.txt', 'x'.repeat(2048))).slice(0, 60))
write('hostile-members.tar.gz', concat(gzipSync(tarOf('a.txt', 'a')), gzipSync(tarOf('b.txt', 'b'))))
write('gzip-bomb.txt.gz', gzipSync(new Uint8Array(8 * 1024 * 1024)))
const line = strToU8('plain sample text for the archive size check\n')
const raw = new Uint8Array(6 * 1024 * 1024)
for (let at = 0; at < raw.length; at += line.length) raw.set(line.subarray(0, Math.min(line.length, raw.length - at)), at)
const big = {}
for (let i = 0; i < 4; i += 1) big[`big-${i}.txt`] = raw.subarray(i * 1572864, (i + 1) * 1572864)
write('large-ok.zip', zipSync(big))
write('hostile-huge.zip', zipSync({ 'padding.bin': randomFillSync(new Uint8Array(26 * 1024 * 1024)) }))
console.log(out)
```

Run each upload in a fresh tab state (click **Clear results** between attempts) and watch the Console and the page for freezing.

- [ ] `hostile-bomb.zip`: expected **Upload refused**, with **An entry claims to expand far more than a normal text file does, so BugPilot refused it before unpacking anything.** and **Nothing was analysed and nothing was kept.**
- [ ] `gzip-bomb.txt.gz`: expected **Upload refused**, saying an entry expanded far more than its own header admitted while it was being unpacked. The refusal happens before the 8 MiB is held.
- [ ] `hostile-traversal.zip` and `hostile-traversal.tar`: expected **Upload refused**, with a message saying a name points out of the archive with `..`.
- [ ] `hostile-nested.zip`: expected **Upload refused**, with **The entry "inner.zip" is itself an archive. BugPilot does not open archives inside archives, so the upload is refused.**
- [ ] `hostile-many.zip`: expected **Upload refused**, saying the archive holds more than 5000 entries and that reading stopped at that count. Confirm the page stayed responsive while counting.
- [ ] `hostile-truncated.tar`: expected **Upload refused**, saying the archive is cut off inside `cut.txt` and that nothing was read from it.
- [ ] `hostile-truncated.tar.gz`: expected **Upload refused**, saying the compressed data is damaged or incomplete and that nothing was unpacked.
- [ ] `hostile-members.tar.gz`: expected **Upload refused**, saying it is two or more gzip streams joined into one file and that BugPilot reads a single gzip stream.
- [ ] `hostile-7z.zip` and `hostile-rar.zip`: expected **Upload refused**. Each file is named `.zip` but carries a `.7z` or `.rar` signature, so the refusal names the family, says BugPilot does not decode `.7z`/`.rar` in the browser, and advises re-archiving as `.zip` or `.tar.gz`. A naming note before the refusal says the format comes from the contents, not the name.
- [ ] Upload `hostile-huge.zip` (26 MiB, over the 25 MiB archive ceiling). Expected: **Upload refused** with the archive byte-ceiling message, before analysis starts.
- [ ] While each refusal is processed, the page stays responsive: the theme toggle still responds, the progress/limit text does not freeze, and no browser tab warning about an unresponsive page appears. Memory in DevTools does not keep climbing after the refusal.
- [ ] Upload `hostile-bidi.zip` and open the results.
  - Expected: every hostile name is shown literally, never interpreted: `src/invoice\u202Egnp.js`, `src/hidden\u200Bpart.js`, the `<img …>` name as text rather than an element, `src/[click](x)*.js`, and the long `deep/…` name shortened to at most 72 characters, ending in `…`. Hovering a shortened name shows the full name in the browser tooltip.
  - Expected: the Markdown report escapes the HTML and bracket characters (`&lt;img …&gt;`, `\[click\]`), contains the full long name, and contains no raw U+202E or U+200B character. `report.json` stays valid JSON and keeps the original names. No name is rendered as markup anywhere.
- [ ] Still in `hostile-bidi.zip`, tick only the `http://` → `https://` change for `src/[click](x)*.js`, open the review, and build the clean export.
  - Expected: the export builds, and `changes.patch` uses the original path (raw brackets), while the changelog and report escape the name. `git apply --check` on a scratch repository accepts the patch, as in the clean-export section.
- [ ] Tick the `http://` → `https://` change for `src/invoice\u202Egnp.js` as well and build the clean export again.
  - Expected: **Clean export blocked** before any file is offered, because the path contains an invisible character. The message names `src/invoice\u202Egnp.js`, says Git cannot apply a patch with that path safely, and offers **Download report only**. No patch, zip or changelog is produced.
- [ ] Upload `hostile-newline.zip`, tick the `http://` → `https://` change, open the review, and build the clean export.
  - Expected: **Clean export blocked** before any file is offered, because the path contains a line break. The message names `src/a\u000Ab.js`, says Git cannot apply a patch with that path safely, and offers **Download report only**. No patch, zip or changelog is produced.
- [ ] Upload `large-ok.zip` (about 19 KB on disk; four files of 1.5 MiB each, 6 MiB in total).
  - Expected: the run completes; all four files are analysed (none is skipped for size), each gets a Low large-file finding, and there is no refusal.
- [ ] Extract `large-ok.zip` into a scratch folder, add an extra `.txt` file over 2 MiB, and upload that folder.
  - Expected: the extra file is skipped with the per-file ceiling reason; the four 1.5 MiB files are analysed; the run does not stop.

### Privacy and data retention

- [ ] Before uploading, with `/analyze` fully loaded, run this in the Console:
  ```js
  const snapshot = async () => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
    databases: await indexedDB.databases(),
  })
  await snapshot()
  ```
  Copy the result. Do not toggle the theme and do not navigate during the check. The footer rotates a session-only joke index every 60 seconds, so finish within a minute or repeat behind a clock; that footer key is the only thing allowed to change.
- [ ] Run an analysis, use both filters, download both reports (with and without snippets), tick fixes, open the review, build the clean export, download every output, run a paste and a notebook upload, add a second upload to a run, and click **Clear results**.
- [ ] Run `await snapshot()` again and compare.
  - Expected: identical strings; `databases` is still empty. `localStorage.getItem('bugpilot.bugs.v1')` is byte-for-byte unchanged.
- [ ] With DevTools Network open, clear the log after the page has loaded, then upload a small file, select a fix, open the review, and build the clean export.
  - Expected: the only requests are same-origin JavaScript module requests for the site's own analyzer, review, export and worker chunks, shown as coming from this origin. There is no request to another host, no POST, and no request whose URL or body contains uploaded file names or contents. The diff review, downloads, filters, and **Clear results** add no request.
- [ ] Open **Bug log** and the seeded checkout report. Expected: the same reports and saved diagnosis as before; code analysis did not change them. Run one Assistant example and expected: unchanged behaviour.
- [ ] Navigate away from `/analyze` and back, and reload the page.
  - Expected: the result does not return; no report is stored.

### Keyboard, themes, and narrow screens

- [ ] With the keyboard only, tab to **Analyze code** in the primary navigation and press `Enter`.
- [ ] Tab to **Choose files** and press `Enter`; choose a small file in the operating-system picker.
  - Expected: the flow completes; focus moves to the results heading; `Tab` reaches both filters, the snippet checkbox, both download buttons, every fix checkbox, **Review changes**, the diff toolbar, **Previous/Next change**, **Build clean export**, each download button, **Clear results**, and the coverage `<details>` summary. Every stop has a visible focus ring.
- [ ] Open the coverage summary with `Enter` and close it with `Enter`.
- [ ] At 1440 × 900 in the light theme, upload the sample folder and open the review. Expected: no control is clipped; the page looks consistent with the rest of the app.
- [ ] At 320 CSS px in the dark theme, upload the sample folder, open the review, and run:
  ```js
  ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })
  ```
  Expected: `scrollWidth <= clientWidth`; findings, fix cards, filters, export controls, review toolbar, and coverage stack without horizontal page scroll or clipped buttons. Long diff lines wrap inside their row or scroll inside `.fix-diff-scroll`, never the page.
- [ ] In both themes, confirm severity and confidence are not conveyed by colour alone — each badge also has its text — and that the redacted secret remains readable.

## 15. Production preview

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
  - `/analyze`
  - a missing path such as `/missing-page`
  Expected: every route loads; `/missing-page` shows **Page not found**, and reloading a client-side route does not return a server error.
- [ ] Toggle the theme, navigate away and back, and reload. Expected: the theme persists for `localhost:4173`.
- [ ] Analyze the Python `ModuleNotFoundError` example and the JavaScript `ReferenceError: userCount is not defined` example. Expected: both results render, with the same categories and confidence as in development.
- [ ] On **Analyze code**, upload the small sample folder from section 14 and download both report formats. Expected: the same findings and exports as in development, with no CSP message about the analyzer, TypeScript, or worker chunks, and no request to another origin.
- [ ] On the preview, upload `deep-sample` and press **Run deep analysis**. Expected: the pass completes and engine findings appear. The preview server does **not** read `vercel.json`, so it sends no CSP at all — this run proves only that the built engine chunks and `.wasm` files resolve and load from `dist/`; the policy itself is section 17's job. Watch Network anyway: every engine request is same-origin. Transfer sizes here are the raw ones, because the preview server does not compress; section 17 covers the gzip figures the gate quotes.
- [ ] On **Bug log**, click **Export reports** and confirm the production build downloads a valid `bugpilot-export-YYYY-MM-DD.json` file. Open **Import reports**, choose that file, and expected: the preview matches the five sample reports and **Already in your log: 5**. Click **Add reports** and expected: **Import complete. Added 0, skipped 5, replaced 0.**, with no sample notice and no external request.
- [ ] Scroll to the footer and expected: a page-specific joke is present.
- [ ] Check the Console. Expected: no errors during load or navigation.
- [ ] In the Network tab, reload with **All** selected. Expected: requests go only to `localhost:4173` (HTML, JS, CSS, fonts, favicon). There are no requests to font CDNs, analytics, APIs, or other external hosts.
- [ ] At 390 × 844 and 1440 × 900, repeat the layout checks from section 11. Expected: parity with the development build.
- [ ] Stop the preview server with `Ctrl+C`.
- [ ] Optional cleanup: clear the `localhost:4173` site data if you do not want the preview's sample workspace to remain in the profile.

## 16. Accessibility walkthrough

Section 10 covers keyboard behaviour during the normal flow. This section is the dedicated pass: automated tests prove the DOM is well-formed, and only a human can judge whether the app is actually usable without sight, without a mouse, at small widths, and at high zoom. Run it on the production preview (section 15) or on `npm run dev`, in a disposable profile, in **both themes**.

### Keyboard-only pass

Put the mouse aside — or unplug it — and complete the whole session with the keyboard.

- [ ] On each of `/`, `/bugs`, `/bugs/new`, a report detail, `/bugs/<id>/edit`, `/assistant`, `/analyze`, and a missing path: press `Tab` from the top of the page to the bottom, then `Shift+Tab` back.
  - Expected: the order matches the visual order; nothing is skipped; the focus ring is visible on **every** stop, including against cards, tables, badges, and both themes.
  - Expected: no stop is unreachable and no stop traps you — `Tab` eventually reaches the browser UI or wraps inside a dialog on purpose.
- [ ] Use the skip link on each page.
  - Expected: it is the first stop, becomes visible on focus, and `Enter` lands inside `<main>` with the next `Tab` going to the first page control, not back to the sidebar.
- [ ] Open the delete dialog and the import dialog with `Enter`, press `Tab`/`Shift+Tab` around each, then press `Escape`.
  - Expected: focus stays inside the dialog while open and returns to the exact button that opened it.
- [ ] Complete the flows without a pointer: create a report, fix a validation error through the error-summary links, change a status, set a fix state to `Verified` with notes, edit, delete, search and filter, sort, clear filters, toggle the theme, run an Assistant analysis, tick checklist boxes, export, and import.
  - Expected: every action is reachable and operable; every select responds to arrow keys; no control needs a hover state to be found.
- [ ] Watch the toast while it is focused or hovered.
  - Expected: `Tab` reaches **Dismiss notification**, and the toast does not disappear while focus is inside it.

### 320 CSS px reflow (WCAG 1.4.10)

Resize the window to 320 CSS px wide (Device Toolbar is acceptable; a narrow real window is better) and check each of the eight routes in both themes.

- [ ] In the Console, run:
  ```js
  ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })
  ```
  - Expected: `scrollWidth <= clientWidth`, and no horizontal page scrollbar. Compare against `clientWidth`, not `window.innerWidth`: `innerWidth` includes the vertical scrollbar, so it can hide the problem this check exists to find.
  - Then prove the page cannot actually be dragged sideways:
    ```js
    (window.scrollTo(9999, 0), window.scrollX)
    ```
    Expected: `0`.
  - Measured on the 2026-10-25 production build over 14 states × 2 themes × 6 widths (320 × 568, 360 × 640, 390 × 844, 768 × 1024, 1024 × 768, 1440 × 900): `scrollWidth` equalled or undershot `clientWidth` in every one of the 168 rows, and `scrollX` stayed `0`. Earlier builds carried `min-width: 320px` on `html` and `body`, which pinned the layout box at 320 px against a `clientWidth` of 305 px once the 15 px classic scrollbar was subtracted, so every route scrolled sideways by 15 px. The floors are removed. If this box reports `scrollWidth > clientWidth` again, something has taken on a fixed width — track that element down instead of re-adding a `min-width` to `html` or `body`.
- [ ] The bug-log table is still expected to scroll **inside** its own container: at 320 × 568 `.table-wrap` measures `scrollWidth` 720 against a `clientWidth` of 271. Wide content scrolling in a container is fine; the page itself must not move.
- [ ] Confirm nothing is clipped at 320 px: the sidebar/header, stat cards, table, form fields and their error text, the Assistant panels, both dialogs, and the footer joke.

### 200% zoom

Set the browser zoom to 200% (or emulate a 720 × 450 CSS px viewport at a device scale factor of 2) and repeat the reflow check on every route.

- [ ] Expected: content reflows to the narrower width instead of being cut off; text does not overlap other text; no button, badge, dialog action, or table cell is unreachable without scrolling **vertically**.
- [ ] Expected: the focus ring, the toast, and both dialogs stay fully on screen at this zoom.

### Motion

- [ ] Turn on reduce motion at the OS level, or emulate `prefers-reduced-motion: reduce` in DevTools, and reload.
  - Expected: the toast, dialog, and backdrop animations no longer slide or fade; nothing animates repeatedly; the footer joke still changes on its 60-second schedule (a content change, not motion).

### Screen reader (smoke test)

**Not tested by the assistant.** No screen reader was run while preparing this project — NVDA, Narrator, JAWS, and VoiceOver are all untested, and nothing in the automated suite or the browser audit substitutes for them. If you have one available:

- [ ] Start NVDA (Windows, free) or Narrator (`Win` + `Ctrl` + `Enter`) and open **Overview** in browse mode.
  - Expected: the document announces the page, the **`Overview · BugPilot`** tab title matches the spoken heading, headings and landmarks are announced, and the stat values read as label plus number rather than as loose digits.
  - Expected: the **Sample workspace loaded.** status is announced on arrival, and the **Saved data needs attention** alert is announced when storage is unreadable (section 12).
- [ ] Navigate by heading and by landmark.
  - Expected: one `main`, one navigation, one content information region, one `h1` per page, and no skipped heading level.
- [ ] Tab to a form control and read its label; then submit the empty form.
  - Expected: each control speaks its own label and any hint, invalid fields are announced as invalid, and the error summary is read with working links.
- [ ] Open the delete dialog and the import dialog.
  - Expected: the dialog is announced as a dialog, its description is read, and returning focus to the trigger is audible.
- [ ] Listen for the route announcement. The layout carries one visually hidden `role="status"` `aria-live="polite"` region (`src/components/AppLayout.tsx`) that receives the same text as the tab title, `<page label> · BugPilot`.
  - Expected: clicking **Overview**, **Bug log**, **Assistant**, the brand, or a report row announces the new page name once, without moving focus; the browser **Back** and **Forward** buttons announce the same way.
  - Expected: nothing is announced when the page first loads, when a filter or the theme toggle re-renders the page you are already on, or when a dialog opens and closes.
  - Expected: the announcement is not visible on screen at any width, and does not interrupt what the screen reader is already reading more than a polite region normally does.
  - **Not tested by the assistant.** The region's text is verified in `src/components/AppLayout.announcement.test.tsx` and by watching the live DOM in Chromium, but no screen reader has confirmed how or whether it is spoken.
- [ ] Run the Python `ModuleNotFoundError` example in **Assistant**.
  - Expected: the result, its confidence badge, evidence, and the disclaimer are all read in a sensible order, and the "focus moved to the result heading" behaviour is announced rather than silently happening.

### What this pass adds over the automated suite

`npm test` already checks axe violations, token contrast, labels, roles, names, and the route announcement in jsdom, and the 2026-10-25 browser audit checked 14 states × 2 themes × 3 viewports plus the same 14 states × 2 themes × 6 widths for page-level sideways scroll. Those tools cannot judge whether a focus ring is *visible*, whether reading order makes sense, or whether a page sounds right — so the boxes above are the part that stays manual. See **Accessibility** in `README.md` for what is covered automatically and for the open items.

## 17. Security headers

These checks apply to the deployed Vercel site. The headers are defined in `vercel.json`; neither `npm run dev` nor `npm run preview` (including section 15) reads that file, so a local preview will not show them. **Until the commit that changed the policy has been deployed and this section has been run, do not assume the live site sends it.** To check the policy before deploying, serve `dist/` from a temporary Node server that reads `vercel.json` and applies its rules literally; that proves the policy fits the build, not that the host is sending it.

### Two policies, one path each

`vercel.json` now has two header rules, distinguished only by their `source`:

- `/((?!assets/engines/).*)` — every path **except** the engine folder. `script-src 'self'`, no WebAssembly allowance, so the main document cannot compile one.
- `/assets/engines/(.*)` — the engine scripts, worker entry and `.wasm` files only. Identical apart from `script-src 'self' 'wasm-unsafe-eval'`.

Both rules carry the same `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`. Browsers intersect repeated `Content-Security-Policy` headers, so a path that matched both rules would lose WebAssembly entirely; **no path may be claimed by two rules**, and `scripts/check-live.mjs` fails if one is.

### Header response

- [ ] In PowerShell, run exactly:

  ```powershell
  (Invoke-WebRequest -Uri https://bugpilot-lac.vercel.app/bugs -Method Head -UseBasicParsing).Headers
  ```

  - Expected: the request succeeds. Header names may print in any case. Check these values:
    - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
    - `X-Content-Type-Options`: `nosniff`
    - `Referrer-Policy`: `strict-origin-when-cross-origin`
    - `X-Frame-Options`: `DENY`
    - `Permissions-Policy`: `camera=(), microphone=(), geolocation=()`
  - If `-Method Head` is rejected with a 405, repeat with `-Method Get` and read only `.Headers`; do not save the response body.
- [ ] Repeat the command for the root `https://bugpilot-lac.vercel.app/`, for `https://bugpilot-lac.vercel.app/assistant`, for `https://bugpilot-lac.vercel.app/analyze`, and for a missing path such as `https://bugpilot-lac.vercel.app/missing-page`. Expected: all return the same CSP; deep links and the SPA fallback load the app instead of a 404.
- [ ] Take one engine asset from the build and request its own URL (list `dist/assets/engines/`, then ask the live site for one script and one `.wasm` file):

  ```powershell
  (Invoke-WebRequest -Uri https://bugpilot-lac.vercel.app/assets/engines/manifest.json -Method Head -UseBasicParsing).Headers
  ```

  - Expected: `Content-Security-Policy` for this path differs from the app routes in exactly one place — `script-src 'self' 'wasm-unsafe-eval'` — and the other four headers match them.
  - Expected: the `.wasm` response carries `Content-Type: application/wasm` and `X-Content-Type-Options: nosniff`.
  - Expected: `manifest.json` returns JSON listing every engine file with `path`, `kind`, `language`, `rawBytes` and `gzipBytes`, and every `path` in it starts with `/assets/engines/` (or `assets/engines/`).
- [ ] Confirm the two rules do not overlap. Expected: the app-route response above contains **no** second `Content-Security-Policy` header, and the engine response contains exactly one. Two intersected policies on one path is a finding: the deep pass silently loses `'wasm-unsafe-eval'`.
- [ ] Compare both policies with the blocks in **README → Deployment → Content Security Policy**. Expected: no `'unsafe-inline'` in `script-src` anywhere, no `'unsafe-eval'` anywhere, and `'wasm-unsafe-eval'` on the engine paths only. `connect-src`, `object-src`, `base-uri`, `form-action` and `frame-ancestors` are identical in both. Whitespace after semicolons is not significant.
- [ ] If the header is missing or the engine policy lacks `'wasm-unsafe-eval'`, first confirm the deployment is actually the commit that changed `vercel.json`, and that Vercel marks it **Ready** as the current production deployment. Wait for the deployment to settle, hard-reload, and repeat. Do not conclude that the header works from the local preview or from the source file alone.
- [ ] Locally, run `npm test -- src/csp.test.ts`. Expected: that one test file passes with no failures. It asserts both policy strings and both `source` patterns character-for-character, plus that no unsafe source appears — this checks the committed configuration, not the live response.
- [ ] Run `node scripts/check-live.mjs` (optionally `LIVE_URL=http://127.0.0.1:<port> node scripts/check-live.mjs` against the temporary header server). Expected: the **Engine manifest** and **Engine headers** checks pass, every engine asset is same-origin with the engine policy, and the script exits `0`.

### Browser console check on every page

- [ ] Open the live site in a fresh Chromium profile. Open DevTools, select the Console, enable **Preserve log**, clear it, and reload.
- [ ] Visit each route directly by typing the URL: `/`, `/bugs`, `/bugs/new`, a bug detail URL, that report's `/edit` URL, `/assistant`, `/analyze`, and `/missing-page`.
  - Expected: every page renders; **no** console error mentions `Content Security Policy`, `Refused to`, or a blocked resource; the fonts, icons, and favicon render.
  - In the Network tab, select the document request and inspect its response headers. Expected: `content-security-policy` is present and matches the value above.
- [ ] Repeat the console check in Firefox and in Safari, or in Playwright WebKit when Safari is unavailable (Playwright WebKit approximates Safari; physical Safari was not tested).
  - Expected in Chromium and Firefox: no CSP message on any route or during the flows below.
  - Expected in WebKit/Safari: each `<select>` created by JavaScript produces one `style-src-attr` message (4 on `/bugs`, 3 on `/bugs/new`, 1 on a report detail and on `/assistant`). A minimal page that only calls `document.createElement('select')` reproduces this, so it is WebKit's own form-control handling, not an inline style written by the app. Treat any other CSP message — especially `style-src-elem`, or one whose source points to an element the app styled — as a real finding. Confirm that `<html>` has no `style` attribute after toggling the theme.
- [ ] In both themes, repeat the main flows on the live site: create, edit, delete with confirmation, search/filter/sort, fix states, Python and JavaScript analyses plus **Copy code**, code analysis upload and both report downloads, export download, import preview and merge, toast, joke rotation, keyboard focus, and both dialogs.
  - Expected: behaviour matches the local build; the Console still has no CSP errors, and Network still shows only the site's own origin.
- [ ] On the live site, run the deep pass from section 14 on `deep-sample` in a fresh Chromium profile with the Console set to **Preserve log**.
  - Expected: **0** CSP violations. The engine worker compiles WebAssembly under its own policy, the `.wasm` files load as `application/wasm`, and the report shows engine findings.
  - Expected: the page Console's own `WebAssembly.compile` call is still refused — that single refusal is the scoping working, and it is not a violation to "fix". A violation that says `wasm-unsafe-eval` **inside the deep pass** means the engine rule is not being applied to that path; check the `source` patterns before touching the policy.
  - Repeat in Firefox and in Playwright WebKit (approximates Safari; physical Safari is untested). Expected: the same 0 violations on the deep pass; WebKit's per-`<select>` `style-src-attr` noise is unrelated to the engines and unchanged in count.
- [ ] Compare the bytes actually moved with the gate's numbers. The gate quotes **build-time gzip sizes** (from `manifest.json`), so a local server that does not compress sends the raw bytes — for the same nine-language upload that is about **14.2 MiB transferred against 4.2 MiB quoted**, and Vercel serves the compressed figure. Expected: on the live site the `Content-Encoding` of an engine asset is `gzip` (or `br`), and the quoted total is the honest download size for a visitor.
- [ ] If a violation appears, copy the complete console message (directive, blocked URL, and source file) before changing anything. Do not add `'unsafe-inline'`, `'unsafe-eval'`, or a broad external host as the first response. Identify the resource, add only the narrowest source or remove the dependency, then repeat the local checks and this section.
