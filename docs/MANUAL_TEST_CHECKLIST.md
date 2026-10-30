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

## 15. Accessibility walkthrough

Section 10 covers keyboard behaviour during the normal flow. This section is the dedicated pass: automated tests prove the DOM is well-formed, and only a human can judge whether the app is actually usable without sight, without a mouse, at small widths, and at high zoom. Run it on the production preview (section 14) or on `npm run dev`, in a disposable profile, in **both themes**.

### Keyboard-only pass

Put the mouse aside — or unplug it — and complete the whole session with the keyboard.

- [ ] On each of `/`, `/bugs`, `/bugs/new`, a report detail, `/bugs/<id>/edit`, `/assistant`, and a missing path: press `Tab` from the top of the page to the bottom, then `Shift+Tab` back.
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

Resize the window to 320 CSS px wide (Device Toolbar is acceptable; a narrow real window is better) and check each of the seven routes in both themes.

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

## 16. Security headers

These checks apply to the deployed Vercel site. The headers are defined in `vercel.json`; neither `npm run dev` nor `npm run preview` (including section 14) reads that file, so a local preview will not show them. **Until the commit that adds the policy has been deployed and this section has been run, do not assume the live site sends it.** This section was added before the production response was inspected.

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
- [ ] Repeat the command for the root `https://bugpilot-lac.vercel.app/`, for `https://bugpilot-lac.vercel.app/assistant`, and for a missing path such as `https://bugpilot-lac.vercel.app/missing-page`. Expected: all return the same CSP; deep links and the SPA fallback load the app instead of a 404.
- [ ] Compare the policy with the block in **README → Deployment → Content Security Policy**. Expected: no `'unsafe-inline'` in `script-src`, no `'unsafe-eval'`, and no external hosts. Whitespace after semicolons is not significant.
- [ ] If the header is missing, first confirm the deployment is actually the commit that changed `vercel.json`, and that Vercel marks it **Ready** as the current production deployment. Wait for the deployment to settle, hard-reload, and repeat. Do not conclude that the header works from the local preview or from the source file alone.
- [ ] Locally, run `npm test -- src/csp.test.ts`. Expected: **1 test passed**. This checks the committed configuration, not the live response.

### Browser console check on every page

- [ ] Open the live site in a fresh Chromium profile. Open DevTools, select the Console, enable **Preserve log**, clear it, and reload.
- [ ] Visit each route directly by typing the URL: `/`, `/bugs`, `/bugs/new`, a bug detail URL, that report's `/edit` URL, `/assistant`, and `/missing-page`.
  - Expected: every page renders; **no** console error mentions `Content Security Policy`, `Refused to`, or a blocked resource; the fonts, icons, and favicon render.
  - In the Network tab, select the document request and inspect its response headers. Expected: `content-security-policy` is present and matches the value above.
- [ ] Repeat the console check in Firefox and in Safari, or in Playwright WebKit when Safari is unavailable (Playwright WebKit approximates Safari; physical Safari was not tested).
  - Expected in Chromium and Firefox: no CSP message on any route or during the flows below.
  - Expected in WebKit/Safari: each `<select>` created by JavaScript produces one `style-src-attr` message (4 on `/bugs`, 3 on `/bugs/new`, 1 on a report detail and on `/assistant`). A minimal page that only calls `document.createElement('select')` reproduces this, so it is WebKit's own form-control handling, not an inline style written by the app. Treat any other CSP message — especially `style-src-elem`, or one whose source points to an element the app styled — as a real finding. Confirm that `<html>` has no `style` attribute after toggling the theme.
- [ ] In both themes, repeat the main flows on the live site: create, edit, delete with confirmation, search/filter/sort, fix states, Python and JavaScript analyses plus **Copy code**, export download, import preview and merge, toast, joke rotation, keyboard focus, and both dialogs.
  - Expected: behaviour matches the local build; the Console still has no CSP errors, and Network still shows only the site's own origin.
- [ ] If a violation appears, copy the complete console message (directive, blocked URL, and source file) before changing anything. Do not add `'unsafe-inline'`, `'unsafe-eval'`, or a broad external host as the first response. Identify the resource, add only the narrowest source or remove the dependency, then repeat the local checks and this section.
