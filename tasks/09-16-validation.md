# Tasks 09–16: implementation and validation

Completed 2026-11-15. Tasks 17–19 remain open. No release or repository commit was created.

## Delivered

- **09:** lazy `smol-toml` metadata parsing; standard and Poetry dependencies, extras/groups,
  setup.cfg, local requirements/includes, normalized names and original declaration evidence,
  lockfile hints, nested packages, static console targets, cache inputs, and doctor diagnostics.
  Root npm metadata retains precedence. This supersedes MVP decision C2.
- **10:** nearest manifest-root package ownership per ecosystem, normalized declared external
  package matching, and contextual package facts. No-manifest Python remains not applicable.
- **11:** ecosystem-owned typed protected paths. All 52 npm patterns/classifications match
  the pre-task implementation. Python manifests, locks, requirements, and tool configuration
  are protected at root and nested paths; uv.lock failure behavior is tested.
- **12:** dotted syntactic calls and separate decorators, backend-owned reusable parse facts,
  generic incomplete-fact metadata, and D26's missing-call not-applicable behavior. This
  supersedes MVP decision C1. Cache version 10 rejects versions 8 and 9.
- **13:** literal os environment reads and explicit import aliases, shared .env.example
  declarations, deduplication, computed-key exclusion, write-only exclusion, and environment facts.
- **14:** npm/Python framework and capability tables, runtime signals, fake-provider framework
  conformance, mixed/nested Python dependency evidence, and shared persistence proposal matching.
  Real-project review added SQLModel as an explicit Python persistence integration.
- **15:** FastAPI/Flask decorators, literal Starlette Route registrations, Django URL modules
  and directly referenced imported local views, console scripts, and **main**.py impact entrypoints.
  Tests are excluded from production entrypoint enrichment.
- **16:** shared deterministic layer/persistence proposal evidence, directory scopes, stable IDs,
  pending status, a five-contract cap, and low confidence for up to two existing violating edges.
  Tests approve proposals in both languages and catch imports in newly added source files.

## Automated validation

Passed:

- **381 tests across 34 files**, including parser/TOML lazy-loading, architecture boundaries,
  fake-provider conformance, no-execution checks, cache freshness/reuse, policy findings,
  Django/framework/CLI impact, proposal determinism, and protected-path verification.
- Eight existing JS/TS fixture snapshots are byte-for-byte unchanged; five Python/mixed
  snapshots were deliberately updated for the new metadata and facts.
- ESLint, Prettier, TypeScript typecheck, clean build, and `git diff --check`.
- npm package dry-run and MCP Registry validation.
- Default fixture suites: **smoke, regression, adversarial, and Python**.

Release-check constituent commands were invoked directly. Dependencies and pnpm-lock.yaml were
updated with pnpm. Fixture suites used clean temporary copies of the available JS/TS clones,
excluding prior Guard state, node_modules, and build outputs; hono-node-server supplied the
harness's node-server directory. An initial existing-checkout attempt encountered stale policy
state. The Python CLI harness was updated from its historical skipped-call expectation to a
finding/SARIF/fix scenario. The final four-suite run passed.

Native dependency-install/project-command suites and live PR checks were not run; those are
outside this batch. Fixture source was never installed or executed.

## Pinned real-project checks

| Project                             | Revision                                   | Modules | Dotted calls | Entrypoint files | New graph-boundary proposals |
| ----------------------------------- | ------------------------------------------ | ------: | -----------: | ---------------: | ---------------------------: |
| Flask 3.1.2                         | `2c1b30d0503cfb064f1cb252e6614a06915a362a` |      83 |        1,468 |                8 |                            0 |
| FastAPI full-stack template backend | `aabb90126964a164e02aff39e7c385bb0598236d` |      40 |          289 |                5 |                            0 |

Both source checkouts were analyzed statically, without Python or dependency installation.
Import-resolution summaries are identical before and after. Neither produced manifest warnings.
Flask and Celery are recognized from Flask's root/example metadata; its entrypoints cover example
applications and Flask CLI modules. FastAPI's five route files expose the expected literal verbs;
SQLModel, Alembic, and psycopg provide high-confidence persistence evidence.

Pack review compared complete before/after assessments. Flask's pack check statuses and evidence
remain unchanged. FastAPI gains the auth pack from declared identity metadata; existing database,
security, deployment, and observability check statuses remain unchanged. Collecting calls did not
flip existing pack check statuses on these revisions. Zero generated graph boundaries is expected:
these projects do not meet the conservative layer/concentrated-access conditions. The local
Python app does produce a pending persistence boundary, and layered Python/TS tests cover approval.

## Performance

Node 24.14.0 on macOS, same installed dependencies. The pre-task compiled build was preserved
before implementation. Four alternating pairs (AB then BA), 1,000 generated entries, and eight
discoveries per process. Warm measurements are medians of seven cache hits, then medians across
four processes. Benchmarks ran after the fixture suite, separately from heavy checks.

| Variant    | Before cold | After cold | Change | Before warm | After warm |  Change |
| ---------- | ----------: | ---------: | -----: | ----------: | ---------: | ------: |
| typescript |  9,737.0 ms | 9,469.0 ms | -2.75% |     96.0 ms |    96.5 ms |  +0.52% |
| python     |    407.0 ms |   388.5 ms | -4.55% |     90.5 ms |    79.5 ms | -12.15% |

The JS/TS 5% gate passes for cold and warm medians. Python cold discovery remains below the
corresponding TypeScript variant. Measurements cover the combined working-tree feature batch,
not separate per-task commits.

## Supported limits

Distribution/import mappings (PIL/pillow), dependency resolution/marker evaluation, runtime
imports, flow-sensitive alias/shadowing analysis, settings-library environment reads, dynamic
routing, indirect Django includes, and Python tool execution remain outside this implementation.
`setup.py` is never interpreted for metadata. Missing settings-library findings do not imply
complete environment coverage. Unknown HTTP methods stay empty; route details remain file-based.

typescript cold process medians: before [9105, 9826, 9648, 10041], after [8971, 9892, 9387, 9551]. Warm process medians: before [94, 101, 94, 98], after [97, 96, 93, 99].

python cold process medians: before [391, 412, 454, 402], after [396, 377, 385, 392]. Warm process medians: before [77, 90, 91, 91], after [80, 78, 79, 81].
