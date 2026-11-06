# Task 08: Add fixtures, documentation, and release validation

**Phase:** Validation and release  
**Priority:** MVP  
**Estimate:** 3–4 days  
**Depends on:** Tasks 03–07.1  
**Status:** Done. Results are in the release review section of the decision record

## Goal

Validate the supported Python subset independently and in mixed projects, document boundaries, and prove no regression in JS/TS.

## Work

- Add compact local fixtures for Python-only, mixed-language, `src/` layout, monorepo/package boundaries, relative imports, `__init__.py` re-exports, unresolved imports, malformed syntax, and adversarial path cases.
- Add fixtures for each rule and contract kind in the Task 00 matrix, including skipped kinds.
- Add Python scenarios to the existing fixture matrix or a focused Python harness without requiring dependency installation.
- Add policy-mutation tests proving an injected forbidden Python import is detected and removing it restores clean status.
- Document what `init` produces for a Python-only repository and which parts of the output (capabilities, packs, proposals, entrypoint impact paths) are JS/TS-only.
- Document the graph semantics: it contains static references, including `TYPE_CHECKING`, conditional, and function-level imports (C3, D5); it is a direct import graph without implicit parent `__init__.py` edges (D9); it has no cross-language edges (D19); "external" does not mean the package is installed (D16); and skipped checks appear as not applicable (D17).
- Update user-facing scope, root detection, discovery, policy, and limitations docs, the fixture matrix, and the product descriptions that say "JavaScript and TypeScript" or "JS/TS": `package.json` description and keywords, `src/cli/index.ts`, `server.json`, and `README.md`.
- Add changelog entries for the intentional JS/TS changes from Task 01 (contract line numbers, scanned file set).
- Run typecheck, lint, unit tests, format checks, build, existing fixture gates, Python fixture gates, and the discovery benchmark.
- Review public API/model compatibility and release notes for persisted state/cache behavior.

## Acceptance criteria

- Python fixtures exercise initialization, discovery, rules, contracts, graph/impact, cache, and generic output.
- All existing JS/TS tests and fixture gates remain green.
- Python test coverage does not rely on installing or executing fixture project code.
- Docs clearly state which import forms, layouts, and rule kinds are supported and which Python capabilities are not implemented.
- The completion criteria in `tasks/python-support-plan.md` are met and benchmark results satisfy Task 00's agreed threshold.
