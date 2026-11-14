# Tasks 00–08: implementation and validation

Completed on 2026-11-14. Tasks 09–19 remain open. No commits were created.

## Delivered

- D20–D28 and the plan defaults are accepted. C1/C2 retain their historical MVP meaning and are superseded for later feature work. Broken historical review links are removed.
- Static language and ecosystem registries own classification, conventions, parsing, resolution, enrichment, metadata, and cache inputs. Concrete implementations are imported only by their registries or their own implementation directories.
- Python parsing and resolution and their original tests moved intact. `ModuleRecord.pythonImports` became backend-owned `parseFacts` without a deprecated alias. Cache version 9 rejects version-8 data, even when its signature matches. Language IDs, public discovery exports, and project metadata shape remain unchanged.
- JS/TS parsing, aliases, fallback resolution, routes, directives, barrels, and environment reads moved behind a lazy session. Fresh-process tests prove that each single-language project leaves the other parser unloaded.
- Shared policy delegates import-name semantics to backends; resolved paths retain shared matching. Applicability remains fact-based. Only directive/package not-applicable explanations changed.
- npm owns manifest metadata, workspaces, and project-check metadata reads. The Python provider declares existing markers and conventions without reading dependencies. Project-check command selection and execution are unchanged; Task 17 owns that extraction and Python checks.

## Regression and architecture evidence

- Thirteen local fixtures have full model and policy snapshots, excluding Git. Tests compare repeat runs and reversed file creation order. An import edit changes the baseline and makes saved proposals stale. The snapshot suite takes approximately six seconds locally.
- Snapshot changes from the original implementation are limited to the accepted field rename (including snapshot key sorting) and the two generalized not-applicable explanations. JS/TS snapshots are unchanged.
- JS/TS, Python, and a fake language with `use "a::b"` syntax run the same conformance suite: deterministic output, reused/fresh parity, valid same-language targets, declared facts, and no source execution. The fake language also reaches discovery, line-accurate policy, impact, SARIF, and not-applicable output through a test registry only.
- A fake ecosystem supplies metadata, a package, markers, ignores, and cache inputs without changes outside its test. Primary metadata precedence and package merging are tested.
- Architecture tests scan production source for parser leakage, concrete implementation imports, language-ID comparisons, and manifest reads outside ecosystems. Deliberate violation examples are rejected.
- Existing committed-config/cache, resolution-order, mixed-language isolation, malformed-source, and no-execution tests remain enabled. An additional test explicitly rebuilds a version-8 Python cache with legacy parser fields.

## Gates

All constituent release checks passed using the installed executables:

- `node_modules/.bin/eslint .`
- `node_modules/.bin/prettier --check .`
- `node_modules/.bin/tsc --noEmit`
- `node_modules/.bin/vitest run`: **359 tests in 33 files**, approximately 14 seconds.
- `node scripts/clean-dist.mjs` and `node_modules/.bin/tsc -p tsconfig.build.json`
- `npm pack --dry-run --json --cache /tmp/codapult-guard-npm-cache`: 105 files; no source, tests, or snapshots included.
- `node scripts/mcp-registry.mjs validate`
- `node scripts/guard-fixture-suite.mjs`: smoke, regression, adversarial, and Python suites passed.

The native `pnpm` executable did not return even for `--version`, so the release-check constituents were invoked directly. Fixture checks used clean temporary copies of existing clones, excluding generated Guard state and installed/build artifacts. The available `hono-node-server` checkout supplied the harness's `node-server` directory. No remote fixtures were refreshed and no fixture project commands were installed or run. The initial existing-clone run failed on stale policy state and the missing directory; the clean-copy run passed all four suites.

## Performance

Node 24.14.0 on macOS. The pre-refactor compiled build was preserved with its package metadata and the same installed dependencies. Four pairs of runs alternated before/after and after/before, with 1,000 generated entries and eight discoveries per process. Warm numbers are the median of each process's seven cache hits, then the median of those four medians. Benchmark comparisons were performed separately from test/build execution.

| Variant    | Before cold median | After cold median | Cold change | Before warm median | After warm median | Warm change |
| ---------- | ------------------ | ----------------- | ----------- | ------------------ | ----------------- | ----------- |
| TypeScript | 9,091.5 ms         | 9,138.5 ms        | +0.52%      | 91.5 ms            | 91.0 ms           | −0.55%      |
| Python     | 389.0 ms           | 354.0 ms          | −9.00%      | 76.5 ms            | 74.5 ms           | −2.61%      |

TS cold medians per process: before 8,914 / 9,200 / 9,197 / 8,986 ms; after 9,160 / 9,117 / 9,670 / 9,115 ms. TS warm medians: before 89 / 133 / 91 / 92 ms; after 91 / 92 / 91 / 90 ms. Python cold medians: before 399 / 380 / 390 / 388 ms; after 348 / 346 / 360 / 366 ms. Python warm medians: before 80 / 76 / 72 / 77 ms; after 75 / 74 / 73 / 75 ms.

The TS-only 5% gate holds. Python remains substantially faster than the TS variant. Tasks 02–08 were implemented as one working-tree refactor, so these measurements cover the combined extraction against the original build rather than separate per-commit checkpoints.
