# Python support decision record

**Status:** Accepted. Scope options C1–C4 were confirmed with the recommended choices on 2026-10-18  
**Task:** [Task 00: Scope and parser decision](python-support/00-scope-and-parser-decision.md)  
**Plan:** [Python support implementation plan](python-support-plan.md)

This record fixes the parser choice and the behavior that later tasks implement and test. Each decision lists the evidence or reasoning behind it.

## Scope options

These decisions change what users get from the MVP. The recommended option was confirmed for each one. Changing any of them later affects Tasks 03–06.

| ID  | Decision                            | Confirmed                                                                                                                         | Alternative                                                                     |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| C1  | `required-call` contracts on Python | Skip Python modules; no call extraction in MVP (superseded by D26 for Task 12)                                                    | Extract calls in Task 04 and evaluate `required-call` (about +1–2 days, see D4) |
| C2  | `pyproject.toml` parsing            | No TOML parsing in MVP; `package-boundary` skips Python; `init` does not read Python dependencies (superseded by D25 for Task 09) | Add `smol-toml` and read `[project]` name and dependencies (about +2–3 days)    |
| C3  | `if TYPE_CHECKING:` imports         | Treat like any other import, matching how TS `import type` is handled today                                                       | Exclude them from graph edges and cycles                                        |
| C4  | Python markers in `findGuardRoot`   | Add `pyproject.toml`, `setup.cfg`, `setup.py` as root markers                                                                     | Only use them for Python resolution roots, keep `findGuardRoot` unchanged       |

## D1: Parser

**Decision:** Use `@lezer/python` (`^1.1.19`, MIT), loaded lazily and synchronously through `createRequire` only when the model contains `.py` files.

**Requirements:** in-process, synchronous (`discoverProject` is synchronous), no native compile at install, source positions, recovery from syntax errors.

**Evaluation of `@lezer/python` 1.1.19** (prototype run on 2026-10-18, Node 26, macOS arm64):

- **Accuracy:** every `.py` file in the CPython 3.13.2 standard library (1,741 files, 33.4 MB) was parsed and its imports compared with Python's own `ast` module as the oracle (module, relative level, imported names, statement line). All 1,736 files that `ast` accepts matched exactly, covering 12,415 import rows. No crashes, including on the 5 files `ast` rejects.
- **Syntax coverage:** parses `match`, PEP 695 `type` statements and type parameters, PEP 701 nested f-strings, `except*`, walrus, and async syntax.
- **Error recovery:** 142 of the 1,736 valid files (8%) contain error nodes caused by grammar gaps:
  - `with ... as (a, b)` targets
  - PEP 646 `*Ts` inside subscripts
  - some `match` patterns
  - a bare `yield` statement, which makes the rest of the file error-recovered

  Import extraction was still exact in all of those files. In targeted tests, imports placed after each kind of error, including invalid syntax such as `def f(:`, were still extracted with the correct lines.

- **Newer syntax:** Python 3.14 t-strings produce an error node, and unparenthesized `except A, B:` parses cleanly. Python 3.15 `lazy import` produces error nodes, but the import is still extracted. Imports after both remain correct.
- **Performance:** about 6–8 ms to load the module, about 1 ms for the first parse, then about 0.23 ms per typical 2 KB module (1,000 modules in 229 ms). Standard-library throughput was 8.6 MB/s.
- **Footprint:** 4 packages (`@lezer/python`, `@lezer/lr`, `@lezer/common`, `@lezer/highlight`), about 740 KB installed, all MIT, no install scripts, no transitive dependencies outside `@lezer`. Each package ships ESM and CJS builds. Maintained as part of the CodeMirror project.

**Rejected alternatives:**

- **Hand-written import tokenizer:** smallest footprint, but it has to handle strings, f-strings (including PEP 701 nesting), comments, parentheses, and line continuations correctly, and it can never provide calls or declarations. Lezer already reached exact agreement with `ast` on imports, so a custom tokenizer adds risk without a benefit.
- **`web-tree-sitter` with a Python grammar:** robust grammar, but `Parser.init()` and language loading are async, which would force `discoverProject` and every caller to become async. About 4.7 MB plus the grammar wasm.
- **Native `tree-sitter` with `tree-sitter-python`:** synchronous, but relies on `node-gyp-build` and native binaries (about 12 MB combined), which is fragile for an `npx`-distributed CLI across platforms and Node versions.

**Known limitations:**

- Lezer error nodes cannot distinguish a grammar gap from a real syntax error. See D3.
- Error recovery can extract an import from invalid code, for example an `import` line inside an unclosed parenthesis. Python would reject such a file, so this only affects files that cannot run.

## D2: Supported syntax baseline

**Decision:** Python 3.8–3.13 syntax as parsed by `@lezer/python`, verified on the 3.13 standard library. Python 3.14 and 3.15 additions are best effort: imports are extracted, but the module may report parse diagnostics. Revisit when `@lezer/python` adds them.

## D3: Syntax errors

**Decision:** Always keep imports extracted from `ImportStatement` nodes, even when the tree contains error nodes. Python modules record a bounded optional `parseDiagnostics` field (at most 5 entries, each a 1-based line) when error nodes exist. Diagnostics are informational and never produce findings.

**Reason:** 8% of valid standard-library files contain error nodes from grammar gaps while their imports are exact. Dropping imports for those files would remove real edges and hide real violations.

**Added in Task 04:** an individual import statement is dropped when it contains an error node itself (`from . import`, `from pkg. import y`, an unclosed `from pkg import (a, b`), or when it starts where Python does not allow a statement. Error recovery splits `from import x` into a separate `import x` that starts mid-line, which would otherwise fabricate a module named `x`. A statement may start at the beginning of a line or after `;`, `:`, or the `lazy` keyword. The file's other imports are kept. With both filters the adapter still matches `ast` on all 1,736 valid standard-library files (12,415 import rows), so no valid import is lost.

## D4: Facts extracted for Python modules

| `ModuleRecord` field                   | Python value                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imports`                              | Module spellings as written, plus derived submodule references (D6)                                                                                     |
| `importedSymbols`                      | Local binding names: alias if present, otherwise the imported name; `*` is skipped                                                                      |
| `importLines` (from Task 01)           | First line of each import spelling, 1-based                                                                                                             |
| `resolvedImports`, `resolvedImportMap` | From Task 05                                                                                                                                            |
| `exports`                              | Empty. Python has no export statements; `__all__` is not interpreted                                                                                    |
| `dynamicImports`                       | Empty. `importlib.import_module` and `__import__` are out of MVP                                                                                        |
| `calls`                                | Empty in MVP (C1)                                                                                                                                       |
| `declarations`                         | Top-level counts: `classes`, `functions` (including async), `types` (PEP 695 `type` statements), `variables` (assignment statements); `interfaces` is 0 |
| `directives`                           | Empty                                                                                                                                                   |

**Historical Task 04 representation (superseded by Tasks 03 and 12 of the architecture plan):** Python records also store `pythonImports`, one entry per imported module with its spelling, line, and for `from` imports the imported names (without `*`). `imports` keeps only spellings and `importedSymbols` keeps local bindings, so neither has the original names that Task 05 needs to add derived references (D6). Task 05 resolves from `pythonImports` on every discovery (D18). `parseDiagnostics` is present only when the tree has error nodes.

`declarations` has no consumer outside discovery today, but it is part of the persisted model, so filling it keeps Python records comparable. `importedSymbols` and `calls` feed pack assessment text matching in `src/core/analysis/packs.ts`.

**C1 detail:** calls are cheap to extract with Lezer (dotted `CallExpression` callees, the same filter TS uses). The risk is that an error-recovered region drops a call, and a missing call is exactly what `required-call` reports. If C1 changes, Python `required-call` should skip modules that have `parseDiagnostics`.

## D5: Imports inside blocks

**Decision:**

- Imports inside functions, classes, `if` blocks, and `try/except ImportError` count as ordinary imports, with their own line numbers. A lazy import still couples the modules.
- `if TYPE_CHECKING:` imports count as ordinary imports (C3). The TS path includes `import type` declarations in imports, graph edges, and cycles, and Python follows the same rule. If type-only handling is introduced later, it should apply to both languages.
- `lazy import` (Python 3.15) is extracted as a normal import, as D1 shows.

Since none of these are distinguished, the parser does not need to mark block context in the MVP.

## D6: Import spelling and derived submodule references

**Decision:**

- `import a.b.c` records `a.b.c`. `import a.b as x` records `a.b`.
- `from M import n1, n2` records the module spelling `M` as written, including leading dots for relative imports (`.`, `..pkg.mod`).
- Task 05 adds a derived reference `M.n` (relative spellings stay relative, for example `.n` for `from . import n`) for each imported name that resolves to a submodule file or package. This makes `from app.db import models` visible to a rule on `app.db.models`, and gives `from . import a, b` two separate resolved targets, which `resolvedImportMap` (one target per spelling) could not hold otherwise.
- `from M import *` records only `M`.
- Derived references count toward the `imports` budget metric, because each one is a separate module dependency.

## D7: Pattern matching for Python references

`patternMatches` currently accepts an exact match, a `pattern/` prefix, or a raw prefix when the pattern ends with `*`.

**Decision:**

- For Python references only, `.` is also a segment boundary: `app.db` matches `app.db` and `app.db.models`, and does not match `app.dbutils`.
- A trailing `*` keeps raw prefix semantics in every language: `app.db*` matches `app.dbutils`. This is documented rather than changed, to keep one meaning for `*`.
- JS/TS references keep current behavior. Applying the `.` boundary to JS would make `lodash` match the separate package `lodash.debounce`.
- A Python reference is matched against three values: the spelling as written, the absolute dotted name when a relative import can be converted (Task 05), and the resolved slash path. Patterns containing `/` effectively target paths; dotted patterns target module names.
- `importPath` in findings and fingerprints uses the spelling as written (or the derived reference), consistent with TS.

**Fixture cases for Task 06:**

| Pattern   | Reference                                                 | Match          |
| --------- | --------------------------------------------------------- | -------------- |
| `app.db`  | `app.db`                                                  | yes            |
| `app.db`  | `app.db.models`                                           | yes            |
| `app.db`  | `app.dbutils`                                             | no             |
| `app.db*` | `app.dbutils`                                             | yes            |
| `app.db`  | `from app.db import models` (derived `app.db.models`)     | yes            |
| `app.db`  | `from .db import x` in `app/views.py` (absolute `app.db`) | yes            |
| `app/db`  | resolved `app/db/models.py`                               | yes            |
| `lodash`  | JS import `lodash.debounce`                               | no (unchanged) |

**Implemented in Task 06** (`referenceMatches` in `src/core/guard.ts`):

- Policy code knows only that a module is Python, from its extension. It reads the spelling, the stored canonical name, and the resolved path, and does not interpret Python syntax.
- Resolved paths keep path semantics in every language, so `app/db` does not match a resolved `app/db.py`. Use `app.db` or `app/db.py` for a module file.
- `from app.db import models` holds two references, `app.db` as written and the derived `app.db.models` (D6). A rule on `app.db` reports both on the same line, with separate fingerprints, because each is a separate dependency and baselines and waivers stay per reference.
- Each row of the fixture table is a test in `src/core/guard.test.ts`. On Flask, a `forbidden-import` rule on `flask.sansio` reports 14 imports, all relative spellings such as `.sansio.app`, matched through their canonical names.

## D8: Rule and contract matrix

| Kind                                       | Current Python behavior                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `forbidden-import`                         | Applies. Matching per D7, finding at the import line                                            |
| `client-forbidden-import`                  | Skips Python, since it requires `use client` directives; reported as not applicable (D17)       |
| `import-boundary` `mustNotImport`          | Applies. Matching per D7, finding at the import line                                            |
| `import-boundary` `mustImport`             | Applies. All static imports count (D5); finding is file-level                                   |
| `required-call`                            | Applies to syntactic dotted calls; missing calls with incomplete facts are not applicable (D26) |
| `package-boundary`                         | Applies to manifest-backed Python projects; otherwise not applicable                            |
| Budgets `lines`, `bytes`                   | Apply unchanged (file-based)                                                                    |
| Budget `imports`                           | Applies. Counts unique references including derived ones (D6)                                   |
| `architecture-cycle` insight               | Applies through the shared graph                                                                |
| `client-server-boundary` insight           | JS-only                                                                                         |
| `undeclared-environment-reference` insight | Applies to supported literal reads; declaration matching stays shared                           |

**Tasks 09–16 (2026-11-15):** the matrix above supersedes the MVP skips from C1/C2. Python now collects calls
and environment reads; `required-call` applies with D26's incomplete-fact exception.
`package-boundary` applies to manifest-backed projects, using the nearest root per ecosystem.
Without manifests it remains not applicable. The environment insight covers supported literal
reads. Client directives remain unavailable. See `docs/guard.md` for the current matrix.

## D9: Resolution

**Resolution roots**, in order:

1. The nearest ancestor of the importing file that contains `pyproject.toml`, `setup.cfg`, or `setup.py` (its Python project root), and its `src/` directory if one exists.
2. The Guard root and its `src/` directory, if one exists.
3. Other Python project roots in the repository (and their `src/` directories), for imports between monorepo packages.

**Candidate files** for dotted name `a.b.c` under root `R`: `R/a/b/c.py`, then `R/a/b/c/__init__.py`.

**Rules:**

- Stop at the first root group that produces a candidate. Within a group, more than one candidate is ambiguous and stays unresolved. Monorepo resolution through group 3 only succeeds when exactly one package provides the module.
- Intermediate directories do not need `__init__.py` (PEP 420 namespace packages). A name that resolves only to a directory without `__init__.py` produces no edge, because there is no file to point at. Its derived submodule references (D6) still resolve.
- Relative imports resolve by path: level 1 is the importing file's directory, and each extra level goes up one directory. A target outside the Guard root is unresolved. Python's top-level package check is not modelled, since it only affects code that cannot run.
- `import a.b.c` creates an edge only to the leaf module. Parent `__init__.py` files are executed at runtime but are not graph edges, because they would add an edge from every submodule to its package and create cycles in most packages.
- `.pyi` stub files are not discovered as modules and are not resolution candidates.
- Python imports resolve only to `.py` files, and JS/TS imports never resolve to `.py` files.
- A name with no local candidate is external or unresolved (D16). A local module with the same name as a standard-library or installed package wins, as it does at runtime when the root is first on `sys.path`. No standard-library name list is kept.
- `from X import Y` resolves `X.Y` as a module first, then `X`. Guard never tries to find which module defines an arbitrary symbol.
- Roots are sorted before lookup, so results never depend on file traversal order.
- The resolver stores the absolute dotted name of each convertible relative import in the model, so policy matching (D7) never reinterprets Python syntax.
- Resolution runs on every discovery over cached parse facts (D18).

**Refined in Task 05** (implemented in `src/core/discovery/python-resolution.ts`):

- **Lookup goes one segment at a time**, as the import system does, instead of testing whole-name candidates per group. The first group with a regular package (`__init__.py`) or a module decides that segment, and the next segment is searched only inside that package. So a root-level regular package `shared/` hides `tools/shared/util.py` from `from shared import util` in a root-level file, as it does at runtime. Directories without `__init__.py` are namespace portions: they combine across groups and are used only when no group has a regular package or module for that segment. A regular package in a later group therefore wins over an earlier namespace portion, also as at runtime. More than one regular package or module within one group is ambiguous.
- **A package wins over a module file** of the same name in the same directory (`tools/__init__.py` over `tools.py`), as CPython's path finder does. The candidate order above (`c.py`, then `c/__init__.py`) is reversed accordingly. A module file has no submodules.
- **Namespace packages:** a bare `import company` that names only namespace directories creates no edge and is not unresolved. `from company import name`, where `name` is not a submodule, is unresolved, because a namespace package has no module file to define `name`.
- **Sibling monorepo packages** resolve through group 3: an import resolves into another Python project root only when the importing file's own project root and the Guard root have no regular package or module for the first segment, and exactly one other project root provides it. Two packages providing the same module stay unresolved.
- **Canonical names:** the canonical name of a relative spelling is its target's dotted path relative to the deepest resolution root that contains the importing file (for `src/app/api/views.py` with roots `.` and `src`, `..db` becomes `app.db`). A spelling that reaches the root itself or goes above it, or whose path has a segment that is not an identifier, has no canonical name.
- **Import hotspots** skip Python imports whose status is not `external`, since Python local imports have no `.` or `@/` marker. JS/TS hotspots are unchanged.
- **Real-project check (2026-10-18):** Flask (src layout, 83 modules) and the FastAPI full-stack template (`backend/` subproject, 43 modules) resolve with no unresolved imports, 185 and 79 edges. The external lists contain only third-party and standard-library packages, plus `blueprintapp`, a Flask test app that the tests add to `sys.path` at runtime. Flask's 20-module cycle is real: it comes from `TYPE_CHECKING` and function-level imports, which count under C3 and D5.

## D10: Project markers and root detection

**Decision:**

- `findGuardRoot` also stops at `pyproject.toml`, `setup.cfg`, or `setup.py` (C4). Precedence does not change: the nearest ancestor with any marker wins. This is consistent with nested `package.json` today, but it changes the root when Guard runs from inside a directory with a nested Python project, so it is called out in the changelog.
- `requirements*.txt`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, `pdm.lock`, `setup.cfg`, `pyproject.toml`, and `tox.ini` are classified as config. `fileKind` currently classifies `requirements.txt` as documentation (because of `.txt`), so the config check must run first for these names. Python files such as `noxfile.py` and `setup.py` stay source modules, because `fileKind` returns one kind and config files are not parsed into modules.
- Python ignored directories: `__pycache__`, `.venv`, `venv`, `.tox`, `.nox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.eggs`, and directories ending in `.egg-info`. `.pyc` and `.pyo` files are ignored.
- **Added in Task 03:** for `.py` files, `fileKind` applies only the test check (D11) and the `/migrations/` check, and every other `.py` file is `source`. The JS/TS name checks would classify `settings/config.py`, `app/schemas.py`, and anything under `schemas/` as `config` or `schema`, which drops them from the module list. In FastAPI, Django, and Pydantic projects these are ordinary modules that other modules import. Django and Alembic-style `migrations/` files stay `migration`, as in JS/TS.
- `pythonProjectRoots(paths)` in `discovery.ts` returns the directories that contain a marker, with `.` for the project root. It is computed from the file list, so markers inside ignored directories such as `.venv` never count, and the persisted model shape does not change. Task 05 uses it for resolution roots.

## D11: Python test files

**Decision:** for `.py` files only, a file is a test when its name matches `test_*.py` or `*_test.py`, it is `conftest.py`, or a path segment is `tests` or `test`. JS/TS classification is unchanged, because adding `tests/` for all languages would reclassify existing JS files. `layerForPath` uses the same rule for `.py` files so Python tests fall in the `tests` layer.

## D12: Python-only `init` output

With C2 as recommended, a Python-only repository gets:

- files, modules, imports, resolved edges, cycles, hotspots, dependency edges, and git information;
- path-based layers, since `layerForPath` already recognizes directories such as `models`, `services`, `db`, `api`, and `config`;
- some capabilities and packs, because `packageSignal` also matches file paths (for example `auth/`, `db/`, `billing/`) and import names (for example `import stripe` matches the payments regex). Confidence stays at medium or lower without package metadata. Proposals that depend on the `identity` and `persistence` capabilities can therefore appear.

**Changed in Tasks 09–16:** manifests now populate dependency/framework metadata, supported entrypoints populate impact paths, calls and environment reads are collected, and layer/persistence boundaries can be proposed. Console scripts remain static target metadata, not executable project checks. Client/server directives remain unavailable.

**Changed in Task 07:** `layerForPath` treated any `app` or `pages` segment as the `routes` layer, which put every module of a Python `app` package (a common layout, used by the FastAPI template) in `routes` and hid its `services`, `db`, and `models` directories. For `.py` files only `routes` and `api` now mark the `routes` layer. JS/TS layers are unchanged and identical on all five fixtures.

## D13: Benchmark thresholds

**Decision:**

- **TS-only regression:** after each of Tasks 01, 02, and 03, cold and warm medians must stay within 5% of the build before the change. Lezer is loaded only when `.py` files exist, so TS-only runs should pay nothing for the parser.
- **Method:** build the previous commit in a separate git worktree and run both builds alternately, at least 4 times each with `GUARD_BENCH_RUNS=8`. A single 3-run pass is not reliable: during Task 01 it showed a 7% warm gap that disappeared with alternating runs.
- **Baseline** (v0.9.0, 1,000 files, macOS arm64, 2026-10-18): 8,643 ms cold and 82.5 ms warm in one `pnpm test:guard:benchmark` pass; 8,650–9,071 ms cold and 87.6–89.7 ms warm across 4 alternating runs.
- **Task 01 result:** cold median +0.7% and warm median −2.5% against the v0.9.0 build in alternating runs.
- **Task 02 result:** cold median −2.2% over 10 alternating rounds against the Task 01 build. Warm runs were too noisy at 8 runs per process (86–103 ms within one build), so warm was measured separately with one cold run plus 40 warm runs per process, 6 processes per build in both orders: median of medians 87.6 ms against 85.0 ms (+3%). The warm path (cache hit) executes none of the code Task 02 changed, and the slow tail followed run position rather than the build.
- **Task 02.1 result:** cold median 9,332 ms against 9,330 ms for the Task 02 build over 3 alternating rounds; warm median of medians 91.9 ms against 92.7 ms (focused warm script, 3 processes per build).
- **Task 02.2 result:** against the Task 02 build over 3 alternating rounds, the focused warm script (cache hit) gave 81.2/83.2/85.9 ms against 80.9/83.4/86.0 ms. The cache-hit path does not compute the fingerprint, so a second script edits one of 1,000 modules before each run, which exercises the fingerprint and module reuse: medians of 648/687/672 ms against 650/686/659 ms, with 999 modules reused in both builds.
- **Task 03 result:** against the Task 02.2 build over 3 alternating rounds, cold median 9,485 ms against 9,393 ms (+1.0%); focused warm median of medians 87.4 ms against 84.7 ms (+3%, with the faster build changing between rounds); edit-warm median 658 ms against 669 ms. File kinds and file lists of the five fixtures are unchanged.
- **Task 05 result:** TS-only focused warm 83.5/83.9 ms against 83.7/84.1 ms for the Task 02.2 build. A synthetic Python project with 1,000 chained packages (2,000 files) takes 460 ms cold and 310 ms for edit-warm, which includes the resolution pass over all modules.
- **Python:** add a Python variant to `scripts/guard-benchmark.mjs` (selected by an environment variable, 1,000 chained modules) in Task 08. Its cold discovery time must not exceed the TS variant's cold time on the same machine. The parse cost measured in D1 is far below the `ts-morph` cost, so this is a sanity bound rather than a tight target.
- **Task 08 result:** `GUARD_BENCH_LANGUAGE=python` builds 1,000 chained packages (2,001 files, 2,000 modules). With 3 runs on the same machine: Python 379 ms cold and 70.5 ms warm, TypeScript 8,738 ms cold and 83.0 ms warm. The bound holds by a factor of 23. The benchmark workflow runs both variants.

## D14: Runtime requirements

**Decision:** no Python interpreter, no subprocess, and no change to the synchronous discovery API. Python tooling remains post-MVP (Task 09).

## D15: Files covered by rule scanning

**Decision:** `scanGuard` applies rules to the discovery model's modules whose file kind is `source`, instead of keeping its own file list. Contracts and budgets already used the model and are unchanged.

Effect on JS/TS compared with v0.9.0, checked on the five external fixtures (next-learn, vite-react-ts-starter, hono-node-server, changesets, express) with one broad rule and one broad contract:

- `.mjs`, `.cjs`, `.mts`, and `.cts` files are now scanned. The old list only matched `.ts/.tsx/.js/.jsx`. This added 26 rule findings in hono-node-server, all in `.mjs` files.
- Files under `__tests__/` are no longer rule-scanned, consistent with `.test.`/`.spec.` files, which were already skipped. No fixture finding was lost.
- `scannedFiles` counts source modules. The old count included files without a module record (schemas, configs, build output), whose findings were always empty, so the number drops on most projects.
- Import lines replace line 1 for contract findings (1,093 findings across the fixtures) and for `require()` references in rules (231 findings in express).

## D16: Import resolution status

**Decision:** every import has one of three statuses: `resolved` (resolves to a project file, which can be a non-module file such as a stylesheet), `unresolved` (looks local by static rules but did not resolve, listed in a new `unresolvedImports` field), or `external` (everything else). An exported helper, `importResolutionStatus`, derives the status, so consumers never reimplement it. Relative specifiers are always either resolved or listed as unresolved: when `ts-morph` does not resolve one (for example `./styles.css`), the path fallback does, and such specifiers are not added to `resolvedImportMap`, which keeps finding fingerprints unchanged. The existing `ModuleRecord` fields stay; a separate import-record entity is not introduced, because policy, packs, budgets, MCP output, and persisted state read the current fields.

`external` means "not resolved locally and not classified as local". It does not claim that the package is installed, which Guard cannot know without an environment. Local-looking rules per language are in Task 02.1 (JS/TS) and Task 05 (Python).

JS/TS local-looking rules: relative and absolute paths, path aliases with a non-empty prefix (a catch-all `*` alias would make every package local), and workspace package names with or without a subpath.

**Fixture review (Task 02.1, 2026-10-18):**

| Fixture               | Imports | Unresolved | Assessment                                                                                             |
| --------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| next-learn            | 370     | 0          |                                                                                                        |
| vite-react-ts-starter | 12      | 0          |                                                                                                        |
| hono-node-server      | 208     | 1          | Real gap: `../../../dist/index.mjs` points into ignored build output                                   |
| changesets            | 667     | 184        | Real gap: workspace packages such as `@changesets/types` resolve only through installed `node_modules` |
| express               | 391     | 0          | Was 95 before the fix below                                                                            |

**Resolver fix found by the review:** express had 95 unresolved directory requires (`require('..')`, `require('../')`, `require('../../..')`) whose targets exist. `jsTsResolutionCandidates` built `./index.js` for the project root and broken paths for a trailing slash, so these imports had no graph edge. The candidates now treat `.` and an empty base as the root, and a trailing slash as directory-only, as Node does. Effect on express: dependency edges 57 to 152, cycles unchanged, finding count and lines unchanged, and 190 of 474 findings in the broad parity scan gained a resolved path, which changes their fingerprints. Baselined or waived findings on directory requires therefore appear once more after upgrading; this goes in the changelog. No other fixture changed.

**Python statuses (Task 05):** relative imports without a target, and absolute imports whose first segment names a top-level module or directory in any resolution root, are `unresolved`; ambiguous imports are `unresolved` too. A `from X import n` spelling `X` is `resolved` when every name resolved as a submodule, since `X` itself is then not needed. Known limit: a bare import of a namespace-only package has status `external`, because there is no file to resolve to and it is not a gap.

The changesets gap means un-installed monorepos lack cross-package edges. Resolving workspace imports to package sources without `node_modules` is on the post-MVP backlog.

**Graph completeness (Task 07.1):** `summarizeImportResolution` in `discovery.ts` counts, per language, modules, unique import specifiers (static imports, re-exports, and literal dynamic imports), the three statuses, and modules with `parseDiagnostics`. The model stores it as `insights.importResolution`, which is optional because older saved models lack it, and `doctor` computes it from the saved modules in that case. `analyzeProjectImpact` returns `graph`: `complete` when no affected module has an unresolved import, otherwise `partial` with the total count and up to 20 `{ file, specifier }` entries, plus the project summary. External imports never count. CLI `impact`, the MCP impact tool, `verify`, and `doctor` show it; it never changes an exit code or outcome. Docs use the wording "complete within the supported static subset". Fixture values (2026-10-18):

| Fixture               | Modules | Imports | Resolved | Unresolved | External | Parse diagnostics |
| --------------------- | ------- | ------- | -------- | ---------- | -------- | ----------------- |
| next-learn            | 123     | 370     | 171      | 0          | 199      | 0                 |
| vite-react-ts-starter | 6       | 12      | 6        | 0          | 6        | 0                 |
| hono-node-server      | 53      | 208     | 73       | 1          | 134      | 0                 |
| changesets            | 136     | 667     | 199      | 184        | 284      | 0                 |
| express               | 140     | 391     | 152      | 0          | 239      | 0                 |

Python: Flask has 83 modules, 505 imports, 197 resolved, 0 unresolved, 308 external, and 2 modules with parse diagnostics. Both diagnostics are false positives: `tests/conftest.py` and `tests/test_logging.py` contain a bare `yield`, which `@lezer/python` marks with an error node although `ast` parses the files. Imports in both files are complete, as the D1 comparison showed. Output therefore says "parse diagnostics", not "syntax errors". The FastAPI template backend has 43 modules, 206 imports, 90 resolved, 0 unresolved, and 116 external.

## D17: Checks that cannot be evaluated

**Decision:** a skipped check is reported, never silently treated as passed. Discovery declares which facts each language collects (JS/TS: imports, calls, directives, packages; Python: imports). Each rule and contract kind declares the facts it needs. When a module in scope lacks a needed fact, the check skips it and `GuardReport.notApplicable` records the rule, the reason, and the module count. CLI, MCP, and SARIF (`toolExecutionNotifications`, level `note`) show it. Not-applicable entries never change the exit code or outcome. Policy code checks facts, not language names, which keeps the matrix in D8 valid if a third language is added. Implemented in Task 06.1.

**Implemented in Task 06.1:**

- `collectedFacts(path)` in `discovery.ts` holds the per-language table, and `REQUIRED_FACTS` in `guard.ts` maps each rule and contract kind to the fact it needs. `scanFile` and `scanContracts` skip a module when the fact is missing and record it. This replaces the interim `required-call` skip from Task 04.
- Counts follow the existing scan scopes: rules cover source modules, and contracts also cover test modules. On Flask, a `client-forbidden-import` rule reports 35 skipped modules and `required-call` and `package-boundary` contracts report 83 each.
- Each entry has a fixed reason sentence per missing fact, so entries aggregate by rule and reason.
- Output: `check` and `audit` print one line per entry; JSON output and the MCP check and context tools return them inside the report; the MCP agent-loop result adds them when it reports `ready-for-verification`; SARIF writes them as `invocations[0].toolExecutionNotifications` (level `note`, `associatedRule` set to the rule ID) and omits `invocations` when the list is empty, which keeps JS/TS-only SARIF byte-identical. The behavior is documented in `docs/guard.md`.
- Architecture insights that are JS-only under D8 (`client-server-boundary`, `undeclared-environment-reference`) are not user-configured checks and produce no entries.

## D18: Parse facts and resolution have separate lifetimes

**Decision:** a cached module record may be reused only if its import resolution is still valid.

- **JS/TS:** `ts-morph` resolves during parsing, so reuse is all-or-nothing on a resolution fingerprint stored in the persisted and in-memory caches (Task 02.2). This replaces the `git diff`-based check, which missed committed changes and projects without git. Reproduced on 2026-10-18: a committed tsconfig alias retarget left `entry.ts` resolving to the old target. The fingerprint covers:
  - the content of every `tsconfig*.json` and `jsconfig*.json` (the wider pattern covers `extends` bases such as `tsconfig.base.json`), every `package.json`, and the lockfiles of npm, pnpm, Yarn, and Bun;
  - the paths of every JS/TS and `.json` file, which are the files a specifier can resolve to. This includes files of kind `schema` and `config`, such as `db/schema.ts`, which the previous source/test shape check ignored.
- **JS/TS unresolved status:** `unresolvedImports` is recomputed on every discovery, including for reused modules, because it also depends on files outside the fingerprint (`./styles.css` becomes resolved when the stylesheet is added). Adding a Markdown file or a stylesheet therefore keeps module reuse.
- **Known limit:** installing dependencies without a lockfile change, or changing a symlinked package under `node_modules`, is not detected. The previous check had the same limit. The cache can be reset with `clearDiscoveryCache`.
- **Python:** resolution is a separate pass over cached parse facts and runs on every discovery (Task 05). It is string and set work, so recomputing it is cheap, and adding a package, a module, or a resolution root can never leave stale edges.
- **Verified in Task 07:** `DISCOVERY_CACHE_VERSION` is 8, because `insights.importResolution` changes the saved model shape. A test writes a cache record with a matching signature: at the current version it is reused as is, and at version 7 it is rejected and discovery runs again. Python root and package changes are covered by the Task 05 reuse test, which also checks that unchanged Python records are reused.

## D19: Mixed-language repositories

**Decision:** each language has its own internal import graph inside one shared model. Guard detects no cross-language dependencies: a TypeScript frontend calling a Python API over HTTP, task queues, and message brokers are invisible to static import analysis. Impact analysis in a mixed repository therefore stops at the language boundary. This limitation is part of the MVP definition and the user docs (Task 08). Documented in `docs/guard.md` under "Graph completeness and limits" in Task 07, together with the fact that `insights.impactPaths` starts only from Next.js entrypoints.

## Release review (Tasks 08 and 08.1)

**Validation (2026-10-18):** typecheck, lint, 233 unit tests, build, `npm pack --dry-run` (61 files, no fixtures), MCP metadata validation, and the fixture suite (smoke, regression, adversarial, and the new `python` gate) pass. `format:check` reports only the untracked `tasks/plan-review.md`. The broad JS/TS parity scan over the five fixtures is identical to the Task 06.1 output, and full JS/TS insights are identical to the Task 02.2 build apart from the new `importResolution` field.

**Local Python fixtures** (`fixtures/python-*`) cover a flat layout with re-exports and a `TYPE_CHECKING` cycle, a `src/` layout, a namespace package split across project roots, a mixed repository, and edge cases (unresolved, ambiguous, above-root, malformed, shadowing, non-identifier file name, `.pyi` stub, `.venv`, `__pycache__`, `.egg-info`). `src/core/python-fixtures.test.ts` checks their exact models, every D8 kind, and the mutation scenario. `scripts/guard-fixture-python.mjs` runs the CLI end to end (init, check, injected violation, SARIF, impact, doctor) and is part of the default suite and the fixtures workflow.

**Public API and persisted state:**

- New exports: `sourceLanguage`, `SourceLanguage`, `collectedFacts`, `ModuleFact`, `pythonProjectRoots`, `importResolutionStatus`, `moduleImportSpecifiers`, `summarizeImportResolution`, `ImportResolutionSummary`, `GuardNotApplicable`, and `GuardImpactGraphStatus`.
- New `ModuleRecord` fields (`unresolvedImports`, `pythonImports`, `parseDiagnostics`, `canonicalImports`) and `insights.importResolution` are optional, so models saved by 0.9.0 still load, and `doctor` derives the summary from their modules.
- `GuardReport.notApplicable` and `GuardImpactAnalysis.graph` are required output fields. Code that reads reports is unaffected; TypeScript code that constructs these objects, such as test doubles, needs the new fields.
- The discovery cache version is 8, so the first run after upgrading is cold. The cache is disposable and is rebuilt automatically.
- `CHANGELOG.md` has an `Unreleased` section with the features and every intentional JS/TS behavior change (D10 root detection, D15 scanned files and lines, D16 directory requires, D18 cache). `release-it` writes the generated entry above it, so the section is merged into that entry at release time.

**Property tests (Task 08.1):** each was checked once against a deliberate break.

| Property           | Test                                                                                                                                     | Break that makes it fail                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Determinism        | `python-resolution.test.ts`, 12 seeded shuffles of files, project roots, and module order                                                | removing the root sort in `pythonResolutionIndex` and the nearest-root sort in `rootGroups`. Removing only the first passes, because `rootGroups` sorts each group again |
| No execution       | `python-no-execution.test.ts`, marker-writing `setup.py`, `noxfile.py`, `conftest.py`, `__init__.py`, with `node:child_process` recorded | running `git` through `/usr/bin/env`                                                                                                                                     |
| Cache consistency  | `discovery.test.ts`, module to package, new `pyproject.toml`, removed `__init__.py`, new module                                          | skipping resolution for records that already have a `resolvedImportMap`                                                                                                  |
| Language isolation | `discovery.test.ts`, Python imports next to `.ts`, `.tsx`, `.js`, and `.json` files                                                      | admitting `.ts` files to the resolution index and lookup                                                                                                                 |

**Completion criteria** of `python-support-plan.md`: a Python-only or mixed repository initializes (fixtures, Flask, FastAPI template); static local imports are in the shared graph; rules and contracts follow D8 with import lines; skipped checks (D17) and graph gaps (Task 07.1) are reported; impact analysis includes Python edges; JS/TS behavior is unchanged apart from the changelog entries; limitations are documented in `docs/guard.md` and covered by the edge-case fixture and property tests.

## Plan review response

The historical plan review was checked against this record and the code on 2026-10-18.

**Adopted:**

| Review point                                           | Where                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| §2 Separate resolved, external, and unresolved imports | D16, Task 02.1                                              |
| §3.1 `from X import Y` order, direct import graph      | D9, Task 05 fixtures                                        |
| §3.3 Multiple roots, deterministic precedence          | D9 (already), Task 05 namespace-monorepo fixture, Task 08.1 |
| §3.4 Standard-library shadowing                        | D9 (already), Task 05 fixture                               |
| §4 Distinguish not-applicable from passed              | D17, Task 06.1                                              |
| §4 `mustImport` means a statically detected import     | Task 06 docs                                                |
| §5 Graph completeness                                  | Task 07.1                                                   |
| §6 Separate parse and resolution lifetimes             | D18, Task 02.2 (fixes a reproduced JS/TS bug), Task 05      |
| §8 Visibility of files with parse problems             | Task 07.1 (counts modules with `parseDiagnostics`)          |
| §9 Determinism, no execution, cache consistency        | Task 08.1, Task 02.2                                        |
| §10 No cross-language dependencies                     | D19, plan MVP definition, Task 08 docs                      |
| §12 Applicability by facts, not language names         | D17 (fact table only, no capability framework)              |

**Already covered before the review:** keeping one `ModuleRecord` and no plugin system (§1), static analysis without Python (§1.3), the `scanGuard` refactor (§1.4, done in Task 01), conditional and `TYPE_CHECKING` imports counted as static references (§3.2, C3 and D5), no `required-call` for Python (§4, C1), and the MVP scope split (§11, C1 and C2).

**Not adopted:**

- **Parser spike before Phase 1 (§7):** done as part of Task 00 (D1: the whole CPython 3.13 standard library compared with `ast`, plus error-recovery cases), and Phase 1 is complete. The review's remaining cases, PEP 695 generic functions and classes and imports in decorated nested functions, were checked on 2026-10-18 and parse without errors.
- **Python 3.10–3.14 as the syntax range (§8):** D2 keeps 3.8–3.13 as verified, with 3.14 and 3.15 best effort. Lezer produces error nodes for 3.14 t-strings, so claiming 3.14 would be inaccurate, and imports are still extracted correctly after them.
- **`client-forbidden-import` for Python (§4 table):** the rule is defined by `use client` directives, not by imports, so it has no Python meaning.
- **A full import-record entity replacing `ModuleRecord` fields (§2):** the review itself marks this as conceptual. D16 gets the same distinction through one added field and a helper.
- **Import context classification (§3.2) and a capability framework (§12):** the review marks both as optional. They are on the post-MVP backlog.

## Effect on task estimates

The confirmed C1 and C2 options narrow Tasks 03, 04, and 06: no TOML parsing, no call extraction, no block-context marking, and two contract kinds skip Python. The plan review added Tasks 02.1, 02.2, 06.1, 07.1, and 08.1 (5–7 days) and moved cache work out of Task 07. Revised estimates are in the [task index](python-support/README.md).

## How the parser evaluation was run

1. Install `@lezer/python@1.1.19` in a scratch directory.
2. Walk the CPython standard library (excluding `site-packages`), and for each file record import rows with `ast` as `line|level|module|sorted names`. One row per alias for `import`, one row per statement for `from`.
3. Produce the same rows from the Lezer tree by visiting `ImportStatement` nodes: tokens before the `import` keyword give the level and module, tokens after give names (skipping `as` aliases), and the line comes from the node start.
4. Compare row sets per file, count error nodes, and time the parse and extraction.

Task 04 should turn the targeted cases from D1 (bare `yield`, `with ... as (a, b)`, PEP 646, invalid syntax, t-strings, `lazy import`) into unit tests.

## Language and ecosystem architecture decisions (D20–D28)

Accepted for tasks 00–08. C1 and C2 describe the completed MVP and are superseded
for future feature work by D26 and D25; their runtime behavior remains until those tasks land.

| ID  | Decision                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D20 | Extract internal LanguageBackend and EcosystemProvider interfaces from the two existing implementations. Supersedes the original no-interface restriction.                                                       |
| D21 | Static internal registries only; no public plugin API or dynamic loading.                                                                                                                                        |
| D22 | Synchronous backends with lazy parser loading and per-discovery sessions.                                                                                                                                        |
| D23 | Applicability remains fact-based; checks declare required facts.                                                                                                                                                 |
| D24 | Preserve public exports, language IDs and project metadata. The accepted exception is replacing ModuleRecord.pythonImports with parseFacts, without an alias; invalidate caches and document proposal staleness. |
| D25 | Supersedes C2 in Task 09: read Python manifests as data; never interpret or execute setup.py for metadata (normal static source analysis remains enabled).                                                       |
| D26 | Supersedes C1 in Task 12: collect dotted calls; a missing required call with parse diagnostics reports not applicable.                                                                                           |
| D27 | Task 17 runs Python checks only from explicit trusted configuration, never inferred commands.                                                                                                                    |
| D28 | Preserve D19: no dependency edges across languages.                                                                                                                                                              |

Accepted defaults from PLAN.md: incomplete Python call analysis reports not applicable;
Python-only installation uses pinned npx with Node; later framework support targets
FastAPI, Flask and Django. These decisions do not enable the later features in tasks 00–08.

## D29–D32: Python features 09–16

- **D29:** manifests are data-only. Preserve npm primary metadata in mixed repositories and
  retain Python dependency declarations on packages. Preserve requirement strings and markers
  without solving them. Standard project metadata precedes Poetry and setup.cfg.
- **D30:** generated layer boundaries consider domain → infrastructure and ui → infrastructure.
  Up to two existing violating edges are allowed at low confidence; larger counts suppress
  proposals. Persistence access must be concentrated in at most three infrastructure directories.
  At most five new contracts are generated; approval and baseline changes remain explicit.
- **D31:** include basic Django URL modules and directly imported local views in this batch.
  FastAPI/Flask decorators, literal Starlette Route registrations, console scripts, and
  **main**.py are supported. Dynamic URL resolution remains outside this subset.
- **D32:** environment declarations remain root .env.example entries. Settings defaults do not
  declare variables. Backend fact availability gates environment insights.

Implementation and validation: [tasks 09–16 evidence](09-16-validation.md).

## D33–D35: Completion validation and adoption

- **D33:** explicit top-level agent.json `checks` commands apply to every ecosystem and override
  the corresponding npm fallback. Selected base policy owns the command map under --policy-base.
  Commands run once at the root through the existing shell-free runner; workspaces retain npm
  fallback only for checks missing at the root. Python tooling is never inferred.
- **D34:** Python consumers use an exact published npm version. The Python CI template reads
  CODAPULT_GUARD_VERSION, rejects ranges/latest/empty versions, and installs outside the checkout
  with user/global npm configuration isolated and lifecycle scripts disabled. Documentation uses
  VERSION placeholders because this work does not publish a new release.
- **D35:** full validation includes upstream native fixture commands, with optional temporary
  Docker runtimes for environment-sensitive projects. Source archives are read-only mounts,
  containers publish no ports, and tests run as a non-root user. Remote PR validation remains
  credential/context-dependent and is reported as skipped when no repository/number is supplied.
