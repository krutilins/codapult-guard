# Python support implementation plan

**Status:** Accepted, revised after the [plan review](plan-review.md) on 2026-10-18  
**Scope:** Add Python source analysis to Codapult Guard while retaining its shared project model and policy engine.

## Objective

Support Python repositories without adding Python-specific branches throughout the existing TypeScript implementation. Python parsing and import resolution should produce the same normalized module facts that JS/TS parsing produces today. Shared policy evaluation, dependency-graph analysis, impact analysis, history, and output should continue to work across JavaScript, TypeScript, and Python.

The first release should provide reliable static import-boundary analysis for Python. It should not claim broad Python framework or runtime parity.

## Principles

1. **Keep language concerns in the parser and resolver.** File classification, parsing, import extraction, line locations, and import resolution are language-specific. Policy decisions and graph algorithms consume normalized module records.
2. **Do not execute project code.** Discovery and parsing must remain static and safe for untrusted repositories.
3. **Do not require a Python installation for core analysis.** The parser must run in-process and synchronously, because `discoverProject` is synchronous. It should not require a native compile at install time. Task 00 records the parser decision.
4. **Be conservative about resolution.** Record unresolved imports rather than inventing edges. Make resolution roots and limitations explicit.
5. **Preserve current JS/TS behavior.** Existing tests and fixture suites are regression gates. Intentional output changes, such as corrected line numbers, are listed in the changelog.
6. **Support mixed-language repositories.** Python and JS/TS modules may coexist in one project model, while import resolution stays separate per language.
7. **Version persisted data deliberately.** Model or cache shape changes must include cache invalidation/version tests and compatibility review.
8. **Never report findings Python cannot support, and never hide a skipped check.** A rule or contract kind that depends on facts the Python parser does not produce skips Python modules rather than reporting every module as a violation, and the skip is reported as not applicable rather than treated as passed.
9. **Show what the graph cannot see.** Unresolved local imports are kept apart from external packages, and users can see when a graph or an impact result is partial.

## MVP definition

The Python MVP includes:

- Discover `.py` source files and Python project roots/configuration markers, including `pyproject.toml`, `setup.cfg`, `setup.py`, and common requirements/lock files.
- Parse static `import` and `from ... import ...` statements, including aliases and relative imports, with source locations.
- Resolve common project-local modules and packages, including `__init__.py` packages, `src/` layouts, and explicitly supported namespace-package layouts. Do not attempt arbitrary interpreter `sys.path` emulation.
- Feed normalized imports, resolved module paths, and line references into the shared project model and graph.
- Define and test the behavior of every existing rule and contract kind on Python modules (see the matrix in Task 00): `forbidden-import`, `client-forbidden-import`, `import-boundary` (`mustNotImport` and `mustImport`), `required-call`, `package-boundary`, and budgets.
- Report the import line for rule and contract findings. Contract findings currently report line 1 for all languages, so this fix benefits JS/TS as well.
- Include Python in graph-based impact analysis (`analyzeProjectImpact` and changed-file scope) and in generic JSON/SARIF output through the shared graph and finding types.
- Work in Python-only and mixed JS/TS/Python repositories without requiring a Python interpreter. In mixed repositories each language has its own import graph; Guard detects no cross-language dependencies such as HTTP calls or message queues (D19).
- Classify every import as resolved, unresolved, or external (D16), and report graph completeness in `doctor` and impact output (Task 07.1).
- Report checks that could not be evaluated for some modules as not applicable (D17, Task 06.1).
- Document what `init` produces for a Python-only repository. Framework, capability, pack, proposal, and entrypoint impact-path detection depend on npm package names and Next.js conventions, so most of that output will be empty. `pyproject.toml` dependencies are not read in the MVP (C2).

The graph represents static references: imports in `TYPE_CHECKING` blocks, conditional blocks, and functions all count (C3, D5). It is a direct import graph, without implicit edges to parent `__init__.py` files (D9).

Not in the MVP: Python dynamic-import inference, framework or route inference, Python entrypoints for `insights.impactPaths`, environment-variable extraction, Python-specific security rules, Python capability and pack detection, `required-call` and `package-boundary` for Python, import context classification, cross-language dependency detection, executing Python tooling, package-manager parity, and type checking. These may be proposed after MVP validation.

## Current state

The existing `ModuleRecord` in `src/core/discovery/discovery.ts` already acts as the normalized boundary. Graph construction, cycles, impact analysis, budgets, baselines, waivers, and SARIF consume its string fields and do not use `ts-morph`. Direct `ts-morph` use is limited to:

- `parseModule`, route-method detection, `process.env` scanning in `buildInsights`, and `createAstProject` in `src/core/discovery/discovery.ts`;
- `importLine`, `scanFile`, and a second `Project` created by `scanGuard` in `src/core/guard.ts`.

Other JS/TS assumptions that affect Python:

- `scanGuard` lists files with its own `listSourceFiles`/`isSourceFile`, which only match `.ts/.tsx/.js/.jsx` and use a different ignore list from discovery. Python files would never be rule-scanned through this path.
- `SOURCE_EXTENSIONS` drives both file classification and the fallback resolver `resolveInternalImport`, which `buildModuleTargetGraph` runs on every import of every module.
- Module reuse in the discovery cache is only blocked when `git diff HEAD` shows a `tsconfig.json`/`jsconfig.json` change. Committed changes and projects without git reuse stale resolution today (D18, fixed by Task 02.2).
- An import with no resolved target can be an external package or a broken local import; the model does not tell them apart (D16, Task 02.1).
- `findGuardRoot` only recognizes `.git`, `package.json`, `tsconfig.json`, and `jsconfig.json`.
- `patternMatches` treats `/` as the segment boundary.
- `required-call` contracts read `ModuleRecord.calls`. `package-boundary` contracts read workspaces from `package.json` only.

## Target architecture

The architecture change is small and concrete:

1. Record import locations on `ModuleRecord` so rule and contract findings no longer need a TypeScript `SourceFile`.
2. Remove the second `ts-morph` project and the separate file lister from `guard.ts`. Policy scanning iterates the discovery model.
3. Select a parser by file extension inside discovery: the existing TS path for JS/TS extensions and a Python parser for `.py`.
4. Give each language its own source extension set and fallback resolver. Adding `.py` to the shared `SOURCE_EXTENSIONS` set would let a TS import of `./foo` resolve to `foo.py`, and would treat Python spellings such as `.` and `..` as file paths.
5. Derive language from the file extension. Persist a language field only if a consumer needs it.
6. Record each import's resolution status, and for Python the canonical dotted name of relative imports, so downstream code never reinterprets language syntax.
7. Keep parse facts and resolution results on separate lifetimes: JS/TS reuse is gated by a resolution-input fingerprint, and Python resolution reruns on every discovery.
8. Decide rule applicability from the facts a language collects, through one table in discovery, not from language names in policy code.

Do not introduce an abstract backend interface or plugin system. If a third language is added later, extract an interface from the two concrete implementations at that point.

## Proposed phases and sequencing

### Phase 0: Decisions and acceptance criteria

Set the MVP boundary, choose the parser, fill in the rule/contract matrix, define dotted-name pattern semantics, and list supported Python layouts and resolution cases. This prevents parser and resolution choices from leaking into policy code.

### Phase 1: Shared import facts and language dispatch

Record import locations in the model, move policy scanning onto the discovery model, split extension sets and fallback resolution per language, and dispatch parsing by extension (done in Tasks 01 and 02). Then record import resolution status and gate module reuse on resolution inputs (Tasks 02.1 and 02.2). Prove TS behavior is unchanged apart from intentional, documented fixes.

### Phase 2: Python discovery, parsing, and resolution

Recognize Python project roots and files, parse static imports, resolve supported local packages/modules, and represent unresolved external or dynamic references honestly. Build graph edges only for confident local resolutions. The parser can be built against plain strings in parallel with Phase 1.

### Phase 3: Policy and analysis integration

Apply the rule/contract matrix to Python modules and report skipped checks as not applicable. Ensure policy patterns behave predictably for both slash-separated paths and dotted module names, findings point to the correct source lines, impact/SARIF/history consume Python edges without language-specific duplication, and graph gaps are visible.

### Phase 4: Compatibility and evidence

Add Python-only, mixed-language, monorepo, and adversarial fixtures. Run the full existing JS/TS suite, benchmark discovery overhead, review persisted state/cache behavior, and document the supported subset and limitations.

### Phase 5: Optional ecosystem checks (post-MVP)

Only after the static-analysis MVP is stable, decide whether to add Python project checks. This requires explicit choices for interpreter selection, tool detection/configuration, workspace package behavior, and command safety. It should not be coupled to the core Python parser rollout.

## Work breakdown

The actionable task files and dependencies are indexed in [python-support/README.md](python-support/README.md). Parser choice, the rule/contract matrix, resolution rules, and benchmark thresholds are recorded in [python-support-decisions.md](python-support-decisions.md). Tasks 00–08.1, including the decimal tasks added after the plan review, deliver the MVP. Task 09 is a post-MVP option and is not a release blocker.

## Validation gates

- Existing unit tests, typecheck, lint, formatting checks, and JS/TS fixture gates remain green.
- JS/TS parity tests cover imports, dynamic imports, aliases, re-exports, and source locations after the Phase 1 refactor.
- A test proves a JS/TS import never resolves to a `.py` file and a Python import never resolves to a JS/TS file.
- Python fixtures verify static import parsing, relative import resolution, package boundaries, unresolved imports, line-accurate findings, and impact propagation.
- Every rule and contract kind has a Python test that matches the D8 matrix, including a test that unsupported kinds produce no findings on Python modules and are reported as not applicable.
- Mixed-language fixtures prove graph edges and findings coexist without cross-language false resolution.
- Cache tests prove stale records are not reused after schema changes, committed config changes, or Python resolution-root changes, and that cached results equal clean results.
- Property tests prove resolution is independent of input order and that discovery never executes project code.
- Benchmark at representative repository size. Python support should not regress TS-only discovery beyond the threshold set in Task 00.
- Documentation distinguishes supported static analysis from deferred Python framework/runtime support.

## Estimate

The task estimates sum to **22–34 working days, about 4.5–7 engineer-weeks** for one engineer familiar with the codebase, of which 18–27 days remain after Tasks 00–02. The plan review added 5–7 days (Tasks 02.1, 02.2, 06.1, 07.1, 08.1). The largest items are import resolution (Task 05), policy integration (Task 06), and fixtures/docs (Task 08). Python capability detection, framework inference, Python entrypoints, and project checks add roughly **2–4+ weeks** depending on breadth. These are planning estimates, not commitments. Task 05 carries the most uncertainty, so the estimate should be revisited after it.

## Key risks

- Python import resolution is affected by package roots, `src/` layouts, relative imports, namespace packages, interpreter paths, and monorepo layouts. The MVP must state which of these it supports and avoid pretending to emulate runtime resolution completely.
- The parser must be synchronous. `web-tree-sitter` needs async initialization, which would force `discoverProject` and its callers to become async. Native `tree-sitter` bindings need an install-time compile.
- Contract kinds that rely on facts the Python parser does not produce, such as `required-call` without call extraction, would flag every Python module in scope.
- The shared fallback resolver and `SOURCE_EXTENSIONS` set can create cross-language edges if `.py` is added to them.
- Python module names are dotted while Guard scopes and patterns are slash-based. `app.db` does not currently match `app.db.models`, and `app.db*` matches `app.dbutils`.
- Moving rule scanning onto the discovery model changes which files are scanned, because the current lister excludes `.mjs/.cjs/.mts/.cts`. The JS/TS outcome must be decided and documented.
- Persisted project models and discovery caches may outlive the process version. Schema/cache changes need deliberate invalidation and compatibility handling.
- A Python-only `init` will produce little beyond the import graph. Users may judge the feature by that output.
- Skipped checks reported only as counts may still be overlooked in CI. Not-applicable output must be visible in the default CLI summary, not only in JSON.
- An incomplete graph weakens impact analysis without any error. Graph completeness must be reported wherever impact results are shown.
- Users of mixed repositories may expect impact analysis across the frontend/backend boundary. D19 must be stated in the docs and in impact output for mixed projects.
- Project-check orchestration is npm-oriented. Python commands must remain deferred unless interpreter/tool-selection behavior is specified independently.

## Completion criteria

The MVP is complete when a Python-only or mixed repository can be initialized, its supported static local imports are represented in the shared graph, configured rules and contracts behave as the D8 matrix states with correct source locations, skipped checks and graph gaps are reported, graph-based impact analysis includes Python edges, existing JS/TS behavior is unchanged apart from documented intentional fixes, and limitations are documented and tested.
