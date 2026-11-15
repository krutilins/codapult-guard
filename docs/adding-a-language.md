# Adding a language

Guard supports JavaScript, TypeScript, and Python. Backends and ecosystem providers are internal,
static registrations, not a public plugin API. Discovery stays synchronous and must never execute
project code, fetch dependencies, or invoke project tooling.

## Layers and interfaces

Policy, graph analysis, impact, receipts, and output consume normalized records. A
`LanguageBackend` owns file classification, lazy parsing, import semantics, resolution, and syntax
facts. An `EcosystemProvider` owns manifests, workspace packages, ignored directories, resolution
inputs, protected paths, project-check command selection, runtime diagnostics, and signal tables.
Languages and ecosystems are separate: JS and TS share the npm ecosystem.

The interfaces are in `src/core/languages/types.ts` and `src/core/ecosystems/types.ts`.
The corresponding `index.ts` files are the production registration points. Concrete implementations
must not be imported elsewhere outside their implementation directories. Parser dependencies stay
inside their backend and load only when that language is present.

A backend session receives the root, sorted file inventory, source-file set, workspace packages,
and resolution roots. `parseModule` emits normalized imports with locations, calls, declarations,
and opaque serializable `parseFacts`. `resolveModules` runs for fresh and reused modules and
records local targets and unresolved imports. `projectFacts` supplies entrypoints and environment
reads without exposing parser nodes to shared consumers. Facts must survive JSON cache round trips.
Declare only collected facts; use contextual facts for manifest-dependent package ownership and
`incompleteFacts` when recovered syntax cannot support a reliable absence check.

Providers read metadata as data and contribute packages. Registry order preserves primary npm
metadata in mixed projects. Framework/capability signals are provider data, including separate
package-name and import-name matching. Project commands execute only during explicit verification,
through the shared runner. Explicit `agent.json` commands override provider defaults; policy-base
verification selects that configuration from the base revision.

## Implementation checklist

- Implement classification, parsing, resolution status, reference matching, fallback targets,
  import hotspot handling, and project enrichment behind a backend. Avoid branches on language IDs
  in shared consumers. Start unsupported facts as empty and report their checks as not applicable.
- Add a provider when the ecosystem is new. Cover manifests, packages, root markers, ignored paths,
  signals, and typed protected paths. Declare content-sensitive resolution inputs and signatures so
  metadata-only changes invalidate reused resolution. Never evaluate executable manifests.
- Register each implementation once. Extension ownership must be unique. Add fixtures for flat,
  nested, workspace, malformed, unresolved, mixed-language, and cache-change cases.
- Run the backend conformance scenarios: deterministic ordering, fresh/reused parity, existing
  same-language targets, honest fact declarations, and no source execution. Extend ecosystem
  conformance to demonstrate metadata, packages, configuration freshness, checks, and diagnostics.
- Exercise the test-only fake backend and provider, including line-accurate policy findings,
  not-applicable checks, impact, and SARIF. They prove registration is enough for shared consumers.
- Run architecture-boundary tests, full snapshots, parser lazy-loading tests, release checks,
  fixture suites, and alternating cold/warm benchmarks. Document intentional model differences and
  cache changes. Update the support matrix and explain unresolved graph limitations.

## Go review (design only)

The [Go module reference](https://go.dev/ref/mod) defines a module root by `go.mod`; a Go module
contains directory-level packages. `go.work` selects workspace modules, and local replacements can
change resolution. A future Go provider would read these as data, expose module roots as workspace
ownership, and include both files and source-directory inventory in resolution inputs. It must not
invoke `go list` or download dependencies. Replacements outside the Guard root remain unresolved.

The current model has one record per file and one resolved target per import spelling. Go imports
name a package containing multiple files. Selecting a representative file would lose impact paths.
The seam therefore needs a future additive way to represent multiple targets for one import (or
first-class package nodes), with shared graph/cache/output tests, before claiming faithful Go
support. `fallbackTargets` alone cannot preserve both import location and complete package edges.
Build tags, GOOS/GOARCH, cgo, and external test packages also need an explicit completeness policy;
without build selection, package-to-all-files edges would overapproximate impact.

A synchronous parser candidate exists: the native Node Tree-sitter
[`Parser.parse` API](https://tree-sitter.github.io/node-tree-sitter/classes/Parser.html) returns a tree
synchronously, and the upstream [Go grammar](https://github.com/tree-sitter/tree-sitter-go) exists.
This supports the synchronous interface in principle. Native binary distribution and no-build-script
installation compatibility still need validation; no parser dependency or Go implementation is added
here. Asynchronous WASM initialization would require a separate API decision.

The fake backend proves the existing file-based seam, not arbitrary package-graph semantics. This
Go review records that limit explicitly rather than claiming a third language needs registration
alone in every case.
