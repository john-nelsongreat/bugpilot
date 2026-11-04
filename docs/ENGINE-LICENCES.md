# Engine licences and provenance

Every WebAssembly file the deep analysis engines load is a build-time copy of a file from
`node_modules`, and the copy is made by `vite.config.ts` from three npm packages. Nothing is
fetched at run time from any registry. This page records what each binary actually is, which
licence it carries, and how that was checked, so a reviewer can re-do the check without
trusting this table.

Verified 2026-11-04. All 18 shipped `.wasm` binaries are MIT (16 grammars plus the tree-sitter
runtime and the Ruff linter; the two JavaScript files in the same directory are BugPilot's own
code). No GPL, LGPL, MPL or CC-licensed
component is shipped, and no grammar was excluded for licence reasons because none needed
exclusion.

## The three npm packages

| Package | Version | Licence (`package.json` + `LICENSE` in the tarball) | What BugPilot takes from it |
| --- | --- | --- | --- |
| `web-tree-sitter` | 0.27.1 | MIT, © 2018 Max Brunsfeld — the tarball contains `LICENSE` | `web-tree-sitter.wasm`, the tree-sitter runtime every grammar needs |
| `tree-sitter-wasm` | 2.0.4 | MIT, © 2026 Crysthamus — the pack has exactly **one** `LICENSE`, its own | `out/<grammar>/tree-sitter-<grammar>.wasm`, 16 grammar binaries |
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

## The 16 grammars

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
| `tree-sitter-php` | `git+https://github.com/tree-sitter/tree-sitter-php.git#92b5271b60bec77fb65b5e5bc41561e8dac81299` | github.com/tree-sitter/tree-sitter-php | MIT | `…/tree-sitter/tree-sitter-php/master/LICENSE` (two copyright holders) |
| `tree-sitter-python` | `tree-sitter-python ^0.25.0` | github.com/tree-sitter/tree-sitter-python | MIT | `…/tree-sitter/tree-sitter-python/master/LICENSE` |
| `tree-sitter-ruby` | `tree-sitter-ruby ^0.23.1` | github.com/tree-sitter/tree-sitter-ruby | MIT | `…/tree-sitter/tree-sitter-ruby/master/LICENSE` |
| `tree-sitter-rust` | `tree-sitter-rust ^0.24.0` | github.com/tree-sitter/tree-sitter-rust | MIT | `…/tree-sitter/tree-sitter-rust/master/LICENSE` |
| `tree-sitter-sql` | `@derekstride/tree-sitter-sql ^0.3.11` | github.com/derekstride/tree-sitter-sql | MIT | `…/derekstride/tree-sitter-sql/main/LICENSE` (© Derek Stride) |
| `tree-sitter-swift` | `tree-sitter-swift ^0.7.1` | github.com/alex-pinkus/tree-sitter-swift (not the tree-sitter org) | MIT | `…/alex-pinkus/tree-sitter-swift/main/LICENSE` |
| `tree-sitter-yaml` | `git+https://github.com/tree-sitter-grammars/tree-sitter-yaml.git#a1c4812a73ec5e089de8e441fdea3a921e8d5079` | github.com/tree-sitter-grammars/tree-sitter-yaml | MIT | `…/tree-sitter-grammars/tree-sitter-yaml/master/LICENSE` (untitled Expat/MIT text, two copyright holders) |

MIT is in the allowed set (MIT, Apache-2.0, BSD, ISC, Unlicense), so all 16 ship. None is
dual-licensed, and no `Apache-2.0`, `BSD`, `ISC`, `Unlicense`, `GPL`, `LGPL`, `MPL` or `CC`
string appears in any of the 16 `LICENSE` files.

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
"all copies or substantial portions of the Software". BugPilot distributes the 18 `.wasm`
binaries as part of a static build, so:

- `web-tree-sitter` (© Max Brunsfeld) and `ruff_wasm_bg.wasm` (© Charles Marsh, with the 13
  third-party notices embedded in that same `LICENSE` file: autoflake, autotyping, Flake8,
  flake8-eradicate, flake8-pyi, flake8-simplify, isort, pygrep-hooks, pycodestyle,
  pydocstyle, Pyflakes, Pyright, pyupgrade, RustPython) are covered by the notices inside
  their own published tarballs.
- The 16 grammars have **no** notice inside the pack — the pack ships one root `LICENSE` for
  its own glue only. This document is the attribution BugPilot carries for them, with the
  repository and `LICENSE` URL of each one named above.

## How to re-verify

```bash
# The pack's own licence, and the proof it carries no per-grammar licence:
sed -n '1,3p' node_modules/tree-sitter-wasm/LICENSE
find node_modules/tree-sitter-wasm -iname '*license*'
ls node_modules/tree-sitter-wasm/out/python/

# The pins that name each upstream repository:
node -e "console.log(require('tree-sitter-wasm/package.json').devDependencies)"

# What the build actually published:
ls dist/assets/engines/
```

Then fetch each `LICENSE` URL in the table. The `.wasm` files themselves contain no upstream
URL and no licence text — each holds only the `tree_sitter_<lang>` export symbol and the
string `clang_23.1.0-wasi-sdk`, so the binaries cannot be used as provenance evidence.
