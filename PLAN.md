# Language-agnostic architecture plan

**Status:** In progress. Tasks 00–08 completed on 2026-11-14; tasks 09–19 remain.

**Starting point:** the Python MVP is complete and merged with main (see [tasks/python-support-plan.md](tasks/python-support-plan.md))  
**Tasks:** one file per commit in [tasks/](tasks/), indexed under [Work breakdown](#work-breakdown)

Tasks 00–08 implementation and validation are recorded in [the foundation report](tasks/00-08-validation.md). The original starting-state inventory below is retained as context.

## Goal

Guard should treat a language as a replaceable component. JavaScript, TypeScript, and Python are the supported languages for now, and Python should be useful beyond import checks. Adding a future language should mean adding one backend and one ecosystem provider, without edits to policy, graph, or output code.

Three outcomes define success:

1. **Python parity where the concept applies.** A Python team gets dependencies, frameworks, package boundaries, `required-call` contracts, entrypoint impact paths, and project checks.
2. **An extension seam that is proven.** A test-only fake language passes the same conformance suite as the real backends, and it needs only a registration.
3. **No regression for JS/TS users.** Refactoring tasks leave the JS/TS model unchanged on all fixtures, and the only Python model change is one field rename in Task 03. The few intended JS/TS behavior changes are listed in the changelog.

## What language-agnostic means here

The architecture is language-agnostic, while the product states which languages it supports. Not every check applies to every language. `client-forbidden-import` depends on `"use client"`, which has no Python meaning, so it stays reported as not applicable (D17). Guard should keep saying "JavaScript, TypeScript, and Python" in its public description, because that claim can be verified.

## Why this differs from the Python plan

The Python plan said: "Do not introduce an abstract backend interface or plugin system. If a third language is added later, extract an interface from the two concrete implementations at that point." That was correct while there was one implementation. There are now two, so the interface can be derived from real behavior instead of guessed (D20).

Doing this first matters for cost. Every remaining Python feature would otherwise add more language branches to `discovery.ts` and `guard.ts`, which would then need to be moved later.

## Starting state (before tasks 00–08)

The Python MVP keeps most language logic in `python-imports.ts` and `python-resolution.ts`, and policy applicability already uses the fact table. These places still depend on language or ecosystem:

| Area                | Where                                                                 | Dependency                                                                       |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Language list       | `SourceLanguage`, `COLLECTED_FACTS`, `parseModule` in `discovery.ts`  | Fixed union and direct dispatch                                                  |
| Module record       | `pythonImports` on `ModuleRecord`                                     | A language-named field in the shared model                                       |
| Shared helpers      | `fileKind`, `layerForPath`, `importResolutionStatus`, `buildInsights` | `python` branches and Next.js directory names                                    |
| Policy matching     | `moduleImportReferences` and `referenceMatches` in `guard.ts`         | A `python` flag on each reference                                                |
| AST leakage         | `routeDetails` and `envReferences` in `discovery.ts`                  | `ts-morph` used directly outside parsing, and a `Project` created for every repo |
| Project metadata    | `discoverProjectOnce`, `workspacePackages`, `packageForFile`          | `package.json` only                                                              |
| Frameworks, signals | `inferFrameworks`, `detectCapabilities`                               | npm package names in code                                                        |
| Entrypoints         | `buildImpactPaths` callers                                            | Next.js routes and server actions only                                           |
| Generated rules     | `buildGeneratedGuardConfig`                                           | One client-component rule, so most JS projects also get none                     |
| Project checks      | `project-checks.ts`                                                   | npm scripts, and `packageManager` falls back to `pnpm` even without Node         |
| Protected paths     | `DEFAULT_PROTECTED_PATHS` in `verify.ts`                              | Mostly JS tooling, with `kind` guessed from substrings                           |

## Target architecture

Five layers, with dependencies pointing in one direction:

| Layer                  | Location                                              | Responsibility                                                                                                   | May depend on       |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1. Policy and analysis | `core/guard.ts`, `analysis`, `output`, `verification` | Rules, contracts, budgets, graph, impact, SARIF, receipts. Reads normalized facts only.                          | Layer 2, registries |
| 2. Normalized model    | `core/discovery/discovery.ts` types                   | `ModuleRecord`, `ProjectModel`, `ModuleFact`. No language names.                                                 | Nothing             |
| 3. Language backends   | `core/languages/{js-ts,python}/`                      | Per-file concerns: extensions, file classification, parsing, import resolution, reference matching, entrypoints. | Layer 2             |
| 4. Ecosystem providers | `core/ecosystems/{npm,python}/`                       | Per-project concerns: manifests, dependencies, packages, package manager, checks, protected paths, root markers. | Layer 2             |
| 5. Signal tables       | Data files beside each provider                       | Framework and capability signals as plain data.                                                                  | Nothing             |

**Language and ecosystem are separate on purpose.** A language describes how one source file is parsed and how its imports resolve. An ecosystem describes how a project declares its metadata. TypeScript and JavaScript share one backend and the npm ecosystem, while Java and Kotlin would be two backends sharing Maven or Gradle. A single "language plugin" would have to split later.

**Registries are the only join points.** `core/languages/index.ts` and `core/ecosystems/index.ts` are static lists and the only files that import concrete implementations. Tasks 07 and 08 enforce this with a test.

Adding a future language then means:

1. A new folder under `core/languages/` that passes the conformance suite.
2. A new folder under `core/ecosystems/`, if the ecosystem is new.
3. One line in each registry.
4. Fixtures.

## Decisions

These continue the numbering of [the Python decision record](tasks/python-support-decisions.md). Task 00 records them there once accepted.

| ID  | Decision                                                                                                                                                                                                       | Reason                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D20 | Extract internal `LanguageBackend` and `EcosystemProvider` interfaces. This supersedes the "no abstract backend" line of the Python plan.                                                                      | Two real implementations now exist to derive the interface from.                                                                                                           |
| D21 | No public plugin API or dynamic loading. Registries are static.                                                                                                                                                | Loading third-party code would conflict with the rule that Guard never executes untrusted code during analysis. Revisit on real demand.                                    |
| D22 | Backends stay synchronous and load their parser lazily.                                                                                                                                                        | `discoverProject` is synchronous (D1), and D13 requires TS-only runs to pay nothing for other parsers. An async parser for a future language would be a separate decision. |
| D23 | Applicability stays fact-based. Backends declare the facts they collect, and checks declare the facts they need (extends D17).                                                                                 | Policy code never needs a language name, and the fake language tests this.                                                                                                 |
| D24 | Model changes are additive except the accepted `pythonImports` → `parseFacts` replacement in Task 03. Language IDs `js-ts` and `python` stay stable, and `src/index.ts` keeps its current exports.             | These appear in JSON output, and `discovery.ts` is exported publicly through `export *`.                                                                                   |
| D25 | Reverses C2: add `smol-toml` and read `pyproject.toml`, `setup.cfg`, and `requirements*.txt` as data. `setup.py` is never parsed or executed.                                                                  | Dependencies and package boundaries both need it. The no-execution rule stays.                                                                                             |
| D26 | Reverses C1: extract Python calls, using the same dotted-callee filter as JS/TS. When a module has parse diagnostics and a required call is missing, it is reported as not applicable instead of as a finding. | A missing call in an error-recovered region would otherwise be a false positive.                                                                                           |
| D27 | Python project checks run only from explicit configuration. Guard never infers commands from project files.                                                                                                    | Answers the open question in Python Task 09, and matches the trusted-CI model from main.                                                                                   |
| D28 | Keeps D19: no dependency edges across languages.                                                                                                                                                               | HTTP and queue links can't be derived from imports without guessing.                                                                                                       |

## Phases

| Phase | Name                     | Result                                                                              | Tasks  | Estimate  | JS/TS behavior             |
| ----- | ------------------------ | ----------------------------------------------------------------------------------- | ------ | --------- | -------------------------- |
| 0     | Preparation              | Decisions recorded, and a model baseline that detects unintended changes            | 00, 01 | 1.5 days  | Unchanged                  |
| 1     | Language layer           | All per-file language logic behind `LanguageBackend`, enforced by tests             | 02–07  | 7–12 days | Unchanged                  |
| 2     | Ecosystem layer          | All project metadata behind `EcosystemProvider`, with Python manifests and packages | 08–11  | 6–9 days  | Unchanged, additive output |
| 3     | Python facts             | `required-call` and the environment insight work on Python                          | 12, 13 | 3–5 days  | Unchanged                  |
| 4     | Signals and proposals    | Frameworks, entrypoints, and generated proposals for both languages                 | 14–16  | 6–10 days | New proposals, documented  |
| 5     | Verification and release | Project checks, CI without a Node project, real-project validation, docs            | 17–19  | 6–10 days | Unchanged                  |

The total is about 30–48 working days. These are planning estimates. Task 04 and Task 15 carry the most uncertainty, so the total should be revisited after each.

**Why this order.** Phases 1 and 2 change no behavior, so they can be reviewed against the baseline and stopped at any point with a working product. Phases 3 to 5 then land new features inside the layers instead of in shared code. Phases 3, 4, and 5 are mostly independent, so they can be reordered if user demand favors one. If early user-visible value matters more, Tasks 09, 12, 14, and 16 give the most visible results, and they can go first once Phase 1 and Task 08 are done.

## Work breakdown

Each task is one commit that keeps all gates green. Python task IDs in `tasks/python-support/` are separate and are written as "Python Task NN".

| ID  | Task                                                                                             | Depends on | Estimate | Status      |
| --- | ------------------------------------------------------------------------------------------------ | ---------- | -------- | ----------- |
| 00  | [Record decisions and clean up references](tasks/00-record-decisions.md)                         | None       | 0.5 day  | Done        |
| 01  | [Add a model baseline for all fixtures](tasks/01-model-baseline.md)                              | None       | 1 day    | Done        |
| 02  | [Add the backend interface and move file classification](tasks/02-language-backend-interface.md) | 01         | 1–2 days | Done        |
| 03  | [Move Python behind its backend](tasks/03-python-backend.md)                                     | 02         | 1–2 days | Done        |
| 04  | [Move JS/TS parsing and resolution behind its backend](tasks/04-js-ts-backend.md)                | 02         | 2–3 days | Done        |
| 05  | [Move JS/TS AST enrichment behind its backend](tasks/05-js-ts-enrichment.md)                     | 04         | 1–2 days | Done        |
| 06  | [Remove language branches from shared code](tasks/06-neutral-consumers.md)                       | 03, 05     | 1–2 days | Done        |
| 07  | [Add the conformance suite and boundary test](tasks/07-language-conformance.md)                  | 06         | 1 day    | Done        |
| 08  | [Add the ecosystem interface and extract npm](tasks/08-ecosystem-provider.md)                    | 07         | 2–3 days | Done        |
| 09  | [Read Python manifests](tasks/09-python-manifests.md)                                            | 08         | 2–3 days | Not started |
| 10  | [Support `package-boundary` on Python](tasks/10-python-package-boundary.md)                      | 09         | 1–2 days | Not started |
| 11  | [Move protected paths into ecosystems](tasks/11-protected-paths.md)                              | 08         | 1 day    | Not started |
| 12  | [Support `required-call` on Python](tasks/12-python-calls.md)                                    | 07         | 2–3 days | Not started |
| 13  | [Support the environment insight on Python](tasks/13-python-environment.md)                      | 07         | 1–2 days | Not started |
| 14  | [Turn framework and capability signals into data](tasks/14-signal-tables.md)                     | 09         | 2–3 days | Not started |
| 15  | [Add entrypoints for Python impact paths](tasks/15-python-entrypoints.md)                        | 12, 14     | 2–4 days | Not started |
| 16  | [Generate language-neutral proposals](tasks/16-neutral-proposals.md)                             | 14         | 2–3 days | Not started |
| 17  | [Add project checks per ecosystem](tasks/17-project-checks.md)                                   | 08         | 3–5 days | Not started |
| 18  | [Support Python-only installs and CI](tasks/18-python-ci.md)                                     | 17         | 1–2 days | Not started |
| 19  | [Validate on real projects and publish docs](tasks/19-validation-and-docs.md)                    | 10–18      | 2–3 days | Not started |

## Gates for every commit

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm test` pass.
- The model baseline from Task 01 is unchanged, or the commit explains each intended difference and updates it.
- Tasks 02 to 08 follow the D13 method: alternating benchmark runs against the previous build, with cold and warm medians within 5%.
- Tasks that touch discovery also run `pnpm test:guard:fixtures:all`.
- A commit that changes the shape of persisted cache data bumps `DISCOVERY_CACHE_VERSION`.

## Key risks

| Risk                                                                                                    | Response                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The refactor changes JS/TS results without any test failing                                             | The Task 01 baseline compares the full model and scan results on every fixture.                                             |
| Any model change makes stored proposals stale, because `fingerprintProjectModel` hashes the whole model | Additive changes are grouped where possible, and the changelog notes the one-time stale state. Task 01 tests this behavior. |
| The interface fits two languages but not a third                                                        | Task 07 adds a fake language with deliberately different semantics. Task 19 includes a paper review against Go.             |
| Reading `pyproject.toml` expands the input attack surface                                               | Parsing stays data-only with size limits, and failures are non-fatal. The no-execution test is extended in Task 09.         |
| Import names differ from Python distribution names, such as `PIL` and `pillow`                          | Dependency matching stays labelled as best effort in Tasks 09 and 14, and it never produces findings by itself.             |
| Python framework detection produces misleading results                                                  | Signals stay evidence with a confidence level, and proposals still need approval.                                           |
| New proposals annoy existing JS/TS users                                                                | Task 16 only adds pending proposals, which never block anything, and the changelog says so.                                 |

## Not in scope

- A public plugin API or dynamically loaded backends (D21).
- Dependency edges across languages (D28).
- Type inference, or precise resolution of method calls.
- Executing project code during discovery.
- Actually adding a third language. Task 19 only checks that the seam would support one.

Backlog items from the Python plan that stay deferred: classifying imports as runtime, type-only, or conditional, and resolving JS/TS workspace imports without `node_modules`.

## Accepted defaults

The defaults below are accepted in D20–D28; none remains open.

1. **Parse diagnostics and `required-call` (D26).** The default reports not applicable. The stricter option reports a finding and accepts false positives on files the parser can't fully read.
2. **Distribution for Python teams (Task 18).** The default is a pinned `npx` command in CI with Node set up by the workflow. A PyPI wrapper or a standalone binary would remove the Node step, at a real maintenance cost, so both are deferred until users ask.
3. **Scope of framework support (Tasks 14 and 15).** The default covers FastAPI, Flask, and Django, because the existing real-project checks already use Flask and the FastAPI template.

## Completion criteria

- Python-only and mixed repositories get dependencies, packages, frameworks, entrypoints, proposals, and the matching checks, or an explicit not-applicable entry.
- No file outside `core/languages/` or `core/ecosystems/` imports `ts-morph` or `@lezer/python`, or contains a language ID as a branch condition. A test enforces this.
- A fake language passes the conformance suite and needs only registry entries.
- All JS/TS fixture gates pass, and every intended behavior change is in the changelog.
- `docs/adding-a-language.md` exists and matches the code.
