# Engine licences and provenance

Every WebAssembly file the deep analysis engines load is a build-time copy of a file from
`node_modules`, and the copy is made by `vite.config.ts` from three npm packages. Nothing is
fetched at run time from any registry. This page records what each binary actually is, which
licence it carries, and how that was checked, so a reviewer can re-do the check without
trusting this table.

Verified 2026-11-04, re-verified 2026-11-17 for the three grammars LOOP2-L5 added. All 21 shipped `.wasm`
binaries are MIT or Apache-2.0 (19 grammars plus the tree-sitter
runtime and the Ruff linter; the two JavaScript files in the same directory are BugPilot's own
code). No GPL, LGPL, MPL or CC-licensed
component is shipped, and no grammar was excluded for licence reasons because none needed
exclusion.

## The three npm packages

| Package | Version | Licence (`package.json` + `LICENSE` in the tarball) | What BugPilot takes from it |
| --- | --- | --- | --- |
| `web-tree-sitter` | 0.27.1 | MIT, © 2018 Max Brunsfeld — the tarball contains `LICENSE` | `web-tree-sitter.wasm`, the tree-sitter runtime every grammar needs |
| `tree-sitter-wasm` | 2.0.4 | MIT, © 2026 Crysthamus — the pack has exactly **one** `LICENSE`, its own | `out/<grammar>/tree-sitter-<grammar>.wasm`, 19 grammar binaries |
| `@astral-sh/ruff-wasm-web` | 0.17.3 | MIT, © 2022 Charles Marsh, plus 13 embedded third-party notices — the tarball contains `LICENSE` | `ruff_wasm_bg.wasm`, the Python linter |

`tree-sitter-wasm@2.0.4`'s own `README.md` states that the licences of the generated `.wasm`
files "belong to their respective upstream grammar authors and can be found on their Github
repos", and only the pack's own code is MIT. So the pack's root `LICENSE` does **not** cover
the grammars. Each grammar's licence was read from its own upstream repository instead, which
is the table below.

Install command used (no lifecycle scripts ran):

```bash
npm install --ignore-scripts web-tree-sitter@0.27.1 tree-sitter-wasm@2.0.4 @astral-sh/ruff-wasm-web@0.17.3
```

## The 19 grammars

Upstream identity comes from `node_modules/tree-sitter-wasm/package.json` →
`devDependencies`, which pins each grammar by npm package or by `git+https` URL with a commit;
the pack's `build.js` names `out/<dir>` after that dependency. Each licence row is the
`LICENSE` file of the repository named in that pin.

| Shipped asset | Pinned dependency (verbatim from the pack) | Upstream repository | SPDX | Licence evidence |
| --- | --- | --- | --- | --- |
| `tree-sitter-bash` | `tree-sitter-bash ^0.25.1` | github.com/tree-sitter/tree-sitter-bash | MIT | `raw.githubusercontent.com/tree-sitter/tree-sitter-bash/master/LICENSE` |
| `tree-sitter-c` | `tree-sitter-c ^0.24.1` | github.com/tree-sitter/tree-sitter-c | MIT | `…/tree-sitter/tree-sitter-c/master/LICENSE` |
| `tree-sitter-c_sharp` | `tree-sitter-c-sharp ^0.23.5` | github.com/tree-sitter/tree-sitter-c-sharp | MIT | `…/tree-sitter/tree-sitter-c-sharp/master/LICENSE` |
| `tree-sitter-cpp` | `tree-sitter-cpp ^0.23.4` | github.com/tree-sitter/tree-sitter-cpp | MIT | `…/tree-sitter/tree-sitter-cpp/master/LICENSE` |
| `tree-sitter-css` | `tree-sitter-css ^0.25.0` | github.com/tree-sitter/tree-sitter-css | MIT | `…/tree-sitter/tree-sitter-css/master/LICENSE` |
| `tree-sitter-go` | `tree-sitter-go ^0.25.0` | github.com/tree-sitter/tree-sitter-go | MIT | `…/tree-sitter/tree-sitter-go/master/LICENSE` |
| `tree-sitter-html` | `tree-sitter-html ^0.23.2` | github.com/tree-sitter/tree-sitter-html | MIT | `…/tree-sitter/tree-sitter-html/master/LICENSE` |
| `tree-sitter-java` | `tree-sitter-java ^0.23.5` | github.com/tree-sitter/tree-sitter-java | MIT | `…/tree-sitter/tree-sitter-java/master/LICENSE` |
| `tree-sitter-kotlin` | `tree-sitter-kotlin ^0.3.8` | github.com/fwcd/tree-sitter-kotlin (not the tree-sitter org) | MIT | `…/fwcd/tree-sitter-kotlin/main/LICENSE` |
| `tree-sitter-lua` | `@tree-sitter-grammars/tree-sitter-lua ^0.4.1` | github.com/tree-sitter-grammars/tree-sitter-lua | MIT | the installed tarball's `LICENSE.md` (© 2021 Munif Tanjim) |
| `tree-sitter-php` | `git+https://github.com/tree-sitter/tree-sitter-php.git#92b5271b60bec77fb65b5e5bc41561e8dac81299` | github.com/tree-sitter/tree-sitter-php | MIT | `…/tree-sitter/tree-sitter-php/master/LICENSE` (two copyright holders) |
| `tree-sitter-python` | `tree-sitter-python ^0.25.0` | github.com/tree-sitter/tree-sitter-python | MIT | `…/tree-sitter/tree-sitter-python/master/LICENSE` |
| `tree-sitter-r` | `@eagleoutice/tree-sitter-r ^1.1.2` | github.com/r-lib/tree-sitter-r — `@eagleoutice` is a publisher scope with **no** repository of that name, and the upstream package calls itself `@davisvaughan/tree-sitter-r`; three names stand between the shipped binary and its author | MIT | the installed tarball's `LICENSE` (© 2024 "tree-sitter-r authors", a collective: no natural person is named, so attribution names the repository) |
| `tree-sitter-ruby` | `tree-sitter-ruby ^0.23.1` | github.com/tree-sitter/tree-sitter-ruby | MIT | `…/tree-sitter/tree-sitter-ruby/master/LICENSE` |
| `tree-sitter-rust` | `tree-sitter-rust ^0.24.0` | github.com/tree-sitter/tree-sitter-rust | MIT | `…/tree-sitter/tree-sitter-rust/master/LICENSE` |
| `tree-sitter-sql` | `@derekstride/tree-sitter-sql ^0.3.11` | github.com/derekstride/tree-sitter-sql | MIT | `…/derekstride/tree-sitter-sql/main/LICENSE` (© Derek Stride) |
| `tree-sitter-swift` | `tree-sitter-swift ^0.7.1` | github.com/alex-pinkus/tree-sitter-swift (not the tree-sitter org) | MIT | `…/alex-pinkus/tree-sitter-swift/main/LICENSE` |
| `tree-sitter-terraform` | `@tree-sitter-grammars/tree-sitter-hcl git+https://github.com/Crysthamus/tree-sitter-hcl.git#eaa20bc01e886864e128f1c60a06b41ca2f38ffc` | github.com/Crysthamus/tree-sitter-hcl (the Crysthamus fork, pinned by URL; the fork's own `package.json` still declares the org repository the package name points at) | Apache-2.0 | that commit's `LICENSE`, and the same SPDX in its `tree-sitter.json` → `metadata.license` and its `grammar.js` `@license` header. One `LICENSE` covers both grammars generated in that tree (`hcl` and `dialects/terraform`); BugPilot ships only the terraform one |
| `tree-sitter-yaml` | `git+https://github.com/tree-sitter-grammars/tree-sitter-yaml.git#a1c4812a73ec5e089de8e441fdea3a921e8d5079` | github.com/tree-sitter-grammars/tree-sitter-yaml | MIT | `…/tree-sitter-grammars/tree-sitter-yaml/master/LICENSE` (untitled Expat/MIT text, two copyright holders) |

MIT and Apache-2.0 are both in the allowed set (MIT, Apache-2.0, BSD, ISC, Unlicense), so all 19 are
shippable. None is dual-licensed. Eighteen of the 19 `LICENSE` files are MIT text; the nineteenth,
`tree-sitter-terraform`, is Apache-2.0 — which is why its pin names a fork rather than an org, why the
licence text ships at `public/licenses/Apache-2.0-tree-sitter-hcl.txt`, and why the upstream repository
carries no `NOTICE` file (checked at the pinned commit: 404). No `BSD`, `ISC`, `Unlicense`, `GPL`,
`LGPL`, `MPL` or `CC` string appears in any of the 19 `LICENSE` files.

## Two things this table does not cover

- **The `.scm` query files.** The pack also ships `folds.scm`, `highlights.scm` and similar
  next to each grammar, and its `build.js` backfills missing queries from
  `nvim-treesitter`, whose `LICENSE` is **Apache-2.0** — a different licence from the grammar
  MIT. BugPilot ships **none** of them: `vite.config.ts` copies `.wasm` files only, the query
  text in `src/features/analyzer/engines/astQueries.ts` is written for this project, and the
  built `dist/assets/engines/` directory contains `.wasm`, two `.js` chunks and
  `manifest.json`. This was confirmed against the build output, not assumed.
- **The SQL grammar's ancestor.** `derekstride/tree-sitter-sql` is a continuation of
  `MikeRav/tree-sitter-sql`. The shipped build comes from the derekstride repository (MIT,
  © Derek Stride); the ancestor repository's licence file was not re-fetched, so it is
  recorded as unverified rather than guessed. Nothing in BugPilot's use depends on it: the
  binary is MIT and the tree-sitter CLI that produced it is MIT.

## Attribution obligations

The MIT licence requires the copyright notice and the licence text to be retained in
"all copies or substantial portions of the Software". BugPilot distributes the 21 `.wasm`
binaries as part of a static build, so:

- `web-tree-sitter` (© Max Brunsfeld) and `ruff_wasm_bg.wasm` (© Charles Marsh, with the 13
  third-party notices embedded in that same `LICENSE` file: autoflake, autotyping, Flake8,
  flake8-eradicate, flake8-pyi, flake8-simplify, isort, pygrep-hooks, pycodestyle,
  pydocstyle, Pyflakes, Pyright, pyupgrade, RustPython) are covered by the notices inside
  their own published tarballs.
- The 19 grammars have **no** notice inside the pack — the pack ships one root `LICENSE` for
  its own glue only. This document is the attribution BugPilot carries for the eighteen MIT
  grammars of that 19, each named above with its repository and `LICENSE` URL. It is not the
  attribution for the whole 21-binary set: `web-tree-sitter` and `ruff_wasm_bg.wasm` are covered
  inside their own tarballs (bullet above) and `tree-sitter-terraform` is Apache-2.0 (bullets below).
- Apache-2.0 §4 asks for the licence text to accompany the redistributed work, not merely a notice,
  so `tree-sitter-terraform` ships its own copy at
  `public/licenses/Apache-2.0-tree-sitter-hcl.txt`: the pinned commit's `LICENSE`, byte for byte
  (11,357 bytes LF-normalised, sha256
  `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`).
  `engines/grammarLicences.test.ts` re-computes that digest from the shipped file on every run.
- Apache-2.0 §4(d) also asks that any `NOTICE` file accompanying the upstream work be retained. There
  is none to retain: a full-tree filename search at the pinned commit finds no `NOTICE`, `THIRD-PARTY`
  or `COPYING`, and the only `hashicorp` mentions in that tree are a README link to the HCL *language
  spec* and test-corpus samples under `example/real_world_stuff`, which are not compiled into the
  shipped `.wasm`. Recorded because the absence is an obligation checked, not skipped. Apache-2.0 also
  grants a patent licence that MIT does not, which is the other reason this row is not a footnote.
- One `LICENSE` at that commit covers both grammars generated in the tree (`hcl` and
  `dialects/terraform`); BugPilot ships the terraform one. Its appendix carries the **unfilled**
  `Copyright [yyyy] [name of copyright owner]` template, so it names no holder — attribution here is
  the repository and commit pin in the table, stated rather than invented.

## How to re-verify

```bash
# The pack's own licence, and the proof it carries no per-grammar licence:
sed -n '1,3p' node_modules/tree-sitter-wasm/LICENSE
find node_modules/tree-sitter-wasm -iname '*license*'
ls node_modules/tree-sitter-wasm/out/python/

# The pins that name each upstream repository. `require('tree-sitter-wasm/package.json')` throws
# MODULE_NOT_FOUND — the pack's `exports` map has no `./package.json` entry — so read the file:
node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync('node_modules/tree-sitter-wasm/package.json','utf8')).devDependencies)"

# The three grammars LOOP2-L5 added, from their own sources:
curl -sL https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-lua/-/tree-sitter-lua-0.4.1.tgz | tar -xzO --wildcards '*/LICENSE.md' | sha256sum
curl -sL https://registry.npmjs.org/@eagleoutice/tree-sitter-r/-/tree-sitter-r-1.1.2.tgz | tar -xzO --wildcards '*/LICENSE' | sha256sum
curl -s https://raw.githubusercontent.com/Crysthamus/tree-sitter-hcl/eaa20bc01e886864e128f1c60a06b41ca2f38ffc/LICENSE | sha256sum

# What the build actually published:
ls dist/assets/engines/
```

Then fetch each `LICENSE` URL in the table. The `.wasm` files themselves contain no upstream
URL and no licence text — each holds only the `tree_sitter_<lang>` export symbol and the
string `clang_23.1.0-wasi-sdk`, so the binaries cannot be used as provenance evidence.
