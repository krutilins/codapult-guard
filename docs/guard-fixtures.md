# Guard fixture matrix

The fixture matrix is a maintainer smoke test for project shapes that are not represented by the
Codapult application itself. Clone the repositories into a sibling workspace directory named
`guard-fixtures/`; the directory is disposable and is never shipped with the CLI.

Current fixtures:

| Shape                               | Fixture                          |
| ----------------------------------- | -------------------------------- |
| Next.js App Router / pnpm workspace | `vercel/next-learn`              |
| Vite + React + TypeScript           | `simerlec/vite-react-ts-starter` |
| Hono Node.js/TypeScript package     | `honojs/node-server`             |
| pnpm monorepo                       | `changesets/changesets`          |
| JavaScript-only package             | `expressjs/express`              |

Run the smoke matrix after building the CLI:

```bash
GUARD_FIXTURES_ROOT=../guard-fixtures pnpm test:guard:fixtures
```

The script initializes only fixtures without a baseline. Existing Guard state is never forcibly
replaced. To run a subset:

```bash
GUARD_SMOKE_PROJECTS=next-learn,changesets pnpm test:guard:fixtures
```

The smoke gate checks that discovery can initialize each project, that all Guard artifacts pass
`doctor`, and that architecture-only `verify` completes without project dependencies being
installed. Dependency installation and the projects' own test/build commands remain separate
checks.

The mutation gate copies representative fixtures, injects a forbidden side-effect import, and
requires Guard to report the new violation:

```bash
pnpm test:guard:fixtures:regression
```

Local adversarial fixtures cover aliases, re-exports, dynamic imports, workspace boundaries,
package exports, and TypeScript project references:

```bash
pnpm test:guard:fixtures:adversarial
```

Local Python fixtures cover a flat layout with package re-exports and relative imports, a `src/`
layout, a monorepo with a namespace package split across project roots, a mixed TypeScript and
Python repository, and edge cases: unresolved and ambiguous imports, malformed syntax, a local
module that shadows the standard library, a file name that is not an identifier, and ignored
directories such as `.venv`. The Python gate initializes each fixture through the CLI, applies
every rule and contract kind, injects a forbidden Python import and removes it again, and checks
impact, SARIF, and `doctor` output. It needs no Python interpreter and installs nothing:

```bash
pnpm test:guard:fixtures:python
```

The unit suite checks the exact models of the same fixtures in `src/core/python-fixtures.test.ts`.
`GUARD_BENCH_LANGUAGE=python pnpm test:guard:benchmark` measures discovery on a chain of 1,000
Python packages.

For a repeatable local suite, use the suite runner. It builds Guard once and then runs the
existing scenario scripts without duplicating their checks:

```bash
pnpm test:guard:fixtures:all
GUARD_FIXTURE_SUITES=smoke,regression,adversarial,python pnpm test:guard:fixtures:all
```

`native` is opt-in because it installs upstream dependencies. `pr` is opt-in because it clones a
remote repository. Run every suite explicitly with `--all`; missing native/PR configuration is
reported as skipped, or as a failure with `--strict`:

```bash
GUARD_NATIVE_INSTALL=1 \
GUARD_PR_REPO=https://github.com/honojs/node-server \
GUARD_PR_NUMBER=148 \
pnpm test:guard:fixtures:full -- --strict
```

The suite returns a non-zero exit code for failures, so it can be called unchanged from local
scripts or CI. Set `GUARD_FIXTURE_SUITES` to select a comma-separated subset and the existing
`GUARD_KEEP_*_PROJECTS=1` variables to retain temporary projects for debugging.

Concurrent Guard state writes are also covered by a dedicated integration harness. A writer may
receive the structured, retryable `GUARD_STATE_BUSY` result, but every completed artifact must
remain valid JSON:

```bash
GUARD_CONCURRENT_WRITERS=8 pnpm test:guard:concurrent
```

Native project commands are available only through the maintainer harness. They are not part of
Guard and do not run in the normal smoke workflow:

```bash
GUARD_NATIVE_INSTALL=1 pnpm test:guard:fixtures:native
```

Use Node versions supported by each fixture. `GUARD_NATIVE_PROJECTS=changesets,express` limits the
run. The harness preserves upstream manifests; it does not rewrite `engines` to make an unsupported
runtime appear valid.

If a native fixture check fails because of Node, use a version supported by that fixture instead of
weakening Guard's runtime check or rewriting the upstream project's `engines` field. Guard reports
the active and declared Node versions in its runtime diagnostics.

Discovery also records nested workspace package boundaries in `project.json` under
`project.workspacePackages`. During `verify`, root scripts remain authoritative; checks missing
at the root are run in workspace packages that declare them, without duplicating root orchestration.

For a full local audit after installing fixture dependencies, run the native project commands from
each fixture. The current matrix covers Next.js lint/Prettier, Vite tests, Hono Node/TypeScript tests, and the
full Changesets `check-all` (build, tests, typecheck, lint, Oxfmt). The Hono fixture replaces
the former Node starter because that project had an obsolete `jws`/`buffer-equal-constant-time`
dependency chain incompatible with current Node runtimes.

## Performance benchmark

Guard includes a generated large-monorepo benchmark. It does not install dependencies or modify
the repository:

```bash
GUARD_BENCH_FILES=1000 GUARD_BENCH_RUNS=3 pnpm test:guard:benchmark
```

Set `GUARD_BENCH_MAX_MS` to turn the cold discovery time into a regression gate. The JSON output
contains cold and warm timings, cache reuse, and discovered file/module counts.

## Real pull requests

Guard can review a real GitHub PR in an isolated temporary clone. It does not
modify the upstream repository or add fixture files:

```bash
GUARD_PR_REPO=https://github.com/honojs/node-server \
GUARD_PR_NUMBER=148 \
pnpm test:guard:pr
```

The harness fetches the PR head and the repository default branch, initializes
Guard in the temporary checkout, and runs `codapult-guard review --base ...`.
Set `GUARD_PR_BASE` when the PR targets a non-default branch. Use
`GUARD_KEEP_PR_PROJECT=1` to retain the checkout for investigation.

## Python completion validation

`test:guard:prepare-fixtures` includes pinned Flask, FastAPI full-stack, and Django project clones.
`test:guard:fixtures:python-real` checks deterministic static discovery, framework signals, local
import edges, and supported entrypoints without installing or executing Python source. Set
`GUARD_PYTHON_REAL_RESULTS` to save the complete summary (including proposals and diagnostics).

`test:guard:fixtures:python-install` packs the current build, installs it away from the consumer
checkout, and checks init, explicit verification commands, and an MCP handshake in a repository
without package.json. It downloads Guard runtime dependencies, never publishes, and uses the shared
`GUARD_NPM_CACHE` directory when supplied. Its explicit test command uses Node so Guard adoption
does not require a Python interpreter. Both suites are included in default and full fixture runs.
Native suites remain opt-in through `GUARD_NATIVE_INSTALL=1`; the remote PR suite requires
`GUARD_PR_REPO` and `GUARD_PR_NUMBER`. Skipped stages are reported separately from passing stages.

For fixture projects requiring an isolated runtime, set
`GUARD_NATIVE_CONTAINER_PROJECTS=express,node-server`. Each selected fixture runs from a read-only
Git source archive in a temporary Docker container, with no host ports published. Express uses
Node 22.12.0 for compatibility with its pinned upstream tests; Hono uses Node 24.14.0 and can bind
its own port 3000. This requires Docker and `GUARD_NATIVE_INSTALL=1` and does not stop host services.
Vite uses its committed npm lockfile through `npm ci`.

For the final performance gate, build both revisions and run
`GUARD_BENCH_BASELINE=/path/to/baseline node scripts/guard-benchmark-compare.mjs` with heavy checks
stopped. `GUARD_BENCH_RESULTS` saves raw measurements and medians. The script runs four alternating
pairs per language, eight discoveries per process, and enforces the D13 thresholds.
