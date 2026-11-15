# Tasks 17–19: implementation and validation

Completed 2026-11-15. Tasks 00–19 of the accepted plan are complete. No commit or release was created.

## Delivered

- **17:** optional top-level agent.json check commands across ecosystems; explicit commands override
  npm defaults and run once at the root. Verification reads commands from the selected policy
  snapshot, including the base revision under --policy-base. npm command/runtime selection lives
  behind provider methods. Python commands are never inferred. Existing npm script, typecheck,
  workspace, timeout, bounded-output, and shell-free execution behavior remains in place.
- **18:** Python-only adoption through an exact published npm version, isolated consumer CI,
  configuration examples, and a packaged init/verify/MCP smoke test without package.json. The CI
  version variable rejects empty values, ranges, and latest. Installs ignore checkout npm config
  and lifecycle scripts; PR and merge-group jobs execute no project commands or adapters.
- **19:** pinned Flask, FastAPI, and Django static validation; full fixture validation including
  upstream native checks; a reusable paired benchmark runner; language-extension documentation;
  a Go interface review; accurate support/limitations, adoption, and task documentation.

The runtime diagnostics packageManager field is now optional. Node still describes Guard's own
runtime. Missing executable failures now include their error code instead of empty stderr.
No discovery model or cache format change was needed, and no snapshots were updated.

## Release and regression gates

- `pnpm release:check` passed through Corepack with a temporary pnpm shim for nested script
  invocations: ESLint, Prettier, TypeScript, **398 tests in 35 files**, clean build, npm pack dry-run,
  and MCP Registry metadata validation. The machine's direct pnpm launcher selected a different
  version; no repository package-manager requirement was changed to bypass it.
- Existing npm project-check assertions remain unchanged. Added tests cover explicit command
  precedence, root/workspace nonduplication, Python-only runtime/configuration, command failure,
  missing executables, timeouts, unsafe operators, disabled checks, and base-policy selection.
- Fake ecosystem conformance exercises optional check-command and runtime-diagnostics hooks.
  Existing language conformance, parser lazy-loading, no-execution, architecture boundaries,
  complete model snapshots, policy, graph, impact, and SARIF tests remain enabled.
- Workflow tests compare shared npm/Python hardening and execute version validation and event
  command-selection blocks. PR changes cannot replace base-policy commands. Invalid versions
  fail before npm runs. PR and merge-group candidates use base policy and skip project code.
- `git diff --check` passes. All discovery snapshots are byte-for-byte unchanged from the
  pre-batch commit.

## Full fixture validation

Fresh fixtures were prepared in temporary storage through `scripts/prepare-fixture-projects.mjs`.
All eight clone revisions are pinned in `scripts/fixture-projects.mjs`. After the clean build:

```sh
GUARD_FIXTURES_ROOT=/tmp/guard19-fixtures \
GUARD_NATIVE_INSTALL=1 \
GUARD_NATIVE_CONTAINER_PROJECTS=express,node-server \
node scripts/guard-fixture-suite.mjs --all --json
```

The full-suite runner (the entrypoint used by `test:guard:fixtures:full`) passed:

| Suite                                     | Result                                              |
| ----------------------------------------- | --------------------------------------------------- |
| JS/TS smoke                               | Passed                                              |
| Mutation regression                       | Passed                                              |
| Adversarial                               | Passed                                              |
| Local Python fixtures                     | Passed                                              |
| Pinned real Python projects               | Passed                                              |
| Packaged Python-only installation and MCP | Passed                                              |
| Native upstream checks                    | Passed, all five projects                           |
| Remote PR review                          | Skipped: repository and PR number were not supplied |

Native checks covered Next Learn, Vite, Changesets, Hono node-server, and Express. Vite's harness
now uses its committed npm lockfile through npm ci. Initial host attempts exposed Hono's fixed
port 3000 conflicting with an existing Docker service and an Express upstream test incompatible
with Node 24. The optional container runner uses pristine Git archives and no published ports;
Hono passed all 435 tests on Node 24.14.0 and Express passed on Node 22.12.0. Tests run as the
non-root node user so filesystem-permission tests remain meaningful. Existing services were
not stopped. Source and tests in the pinned repositories were not patched to obtain a pass.

The installation suite packages the working build locally without publication, installs it away
from a consumer with a hostile .npmrc, initializes policy, executes an explicit check, verifies a
passing outcome, and completes MCP initialization/listTools. The consumer has no package.json.
The portable explicit check uses Node; adoption itself still requires no Python interpreter.
The smoke test validates the local tarball, not an unpublished feature through the public registry.
Replace VERSION examples with an exact feature-bearing release after publication.

## Pinned Python projects

| Project                    | Revision                                   | Modules (Python / other) | Resolved Python imports | External Python imports | Unresolved Python imports | Entrypoint files | Boundary proposals | Manifest warnings |
| -------------------------- | ------------------------------------------ | -----------------------: | ----------------------: | ----------------------: | ------------------------: | ---------------: | -----------------: | ----------------: |
| Flask                      | `2c1b30d0503cfb064f1cb252e6614a06915a362a` |                   83 / 0 |                     194 |                     307 |                         0 |                8 |                  0 |                 0 |
| FastAPI full-stack backend | `aabb90126964a164e02aff39e7c385bb0598236d` |                   40 / 0 |                      90 |                     107 |                         0 |                5 |                  0 |                 0 |
| djangoproject.com          | `ac544d9de0a1099eb765f7bba4d265f1c9db1747` |                 190 / 15 |                     239 |                     686 |                         0 |               19 |                  0 |                 0 |

Frameworks are Flask/Celery, FastAPI, and Django respectively. Each run compares repeated fresh
models and checks framework detection, a representative local import edge, entrypoints, and graph
target existence. Flask includes tutorial decorators and CLI modules; FastAPI includes literal
HTTP methods; Django includes URL modules and directly referenced local views. Conservative
proposal criteria produce no graph boundaries on these revisions; layered local fixtures and
Python/TS approval tests cover actual proposal generation and enforcement. Flask and Django each
have two modules with parser diagnostics, which remain visible in import summaries.

All three Python projects were analyzed statically, without installing Python dependencies or
executing Python application source. Django's JavaScript files are analyzed by the existing
backend and do not introduce cross-language edges.

## Performance

Node 24.14.0 on macOS, using the preserved pre-task-02 compiled build from the pre-refactor
revision (`eb337a9e969175998609c0eedc1503d8d28a0f26`). Both builds use the same installed dependencies
and machine. Each language uses four alternating AB/BA pairs, 1,000 generated entries, and eight
discoveries per process. Warm values are medians of seven cache hits, followed by medians across
four processes. The final run followed release/native checks, without concurrent heavy validation.

| Variant    | Before cold | After cold | Change | Before warm | After warm | Change |
| ---------- | ----------: | ---------: | -----: | ----------: | ---------: | -----: |
| typescript |  9,957.0 ms | 9,992.5 ms | +0.36% |     97.0 ms |    99.5 ms | +2.58% |
| python     |    447.0 ms |   418.5 ms | -6.38% |     83.0 ms |    82.5 ms | -0.60% |

The JS/TS cold and warm 5% gates pass. Python cold discovery remains below TypeScript.

typescript process medians:

- before: cold [9870, 10044, 10497, 9867]; warm [97, 96, 99, 97].
- after: cold [9728, 10134, 10368, 9851]; warm [101, 100, 99, 98].

python process medians:

- before: cold [467, 447, 435, 447]; warm [86, 88, 80, 79].
- after: cold [413, 458, 389, 424]; warm [86, 83, 82, 81].

An initial trial overlapped Docker downloads/native tests and showed a 6.22% TS warm difference;
its cold difference was 0.15%. That trial is retained as investigation evidence, not substituted
for the final uncontended measurement.

## Completion criteria and remaining work

- Python-only and mixed repositories: metadata, packages, frameworks, entrypoints, pending
  proposals, calls, environment facts, and configured checks are covered by feature, verification,
  snapshot, and fixture tests; unsupported fact checks remain explicitly not applicable.
- Architecture isolation: the production boundary test and parser lazy-loading tests pass.
- Extension seam: the fake backend/provider tests pass without concrete imports in consumers;
  the extension guide follows those tests and the actual interfaces.
- JS/TS compatibility: snapshots remain unchanged; all five native and shared Guard fixture gates
  pass. Intentional command configuration and diagnostics changes are in the changelog.
- Extension docs and Go review: docs/adding-a-language.md documents the synchronous native parser
  candidate and the multi-file package-target limitation. Go support is not claimed or added.

Package and MCP descriptions accurately name JS/TS and Python; glama.json has maintainers only
and needs no description edit. Trusted attestation templates build Guard in an isolated directory;
their pnpm/package.json references belong to Guard, so no consumer Node manifest is required.
Generated install-agent instructions use MCP tool names and contain no pnpm requirement.

Deferred backlog: dynamic/indirect routing, import context classification, distribution/import
mappings, settings-library environment reads, JS workspace resolution without node_modules,
Go package-level graph representation, PyPI packaging, and standalone binaries. Remote PR review
still needs explicit repository/PR context; local policy-base and workflow regressions pass.
