# Python support tasks

This folder breaks down the implementation described in [Python support implementation plan](../python-support-plan.md). Decisions are in the [decision record](../python-support-decisions.md). Tasks with a decimal ID (02.1, 06.1, and so on) came from the historical plan review; the decision record lists which review points were adopted and why.

## MVP sequence

| ID   | Task                                                                                            | Depends on               | Estimate | Status |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------ | -------- | ------ |
| 00   | [Scope and parser decision](00-scope-and-parser-decision.md)                                    | None                     | 1–2 days | Done   |
| 01   | [Record import locations and unify policy scanning](01-import-locations-and-shared-scanning.md) | 00                       | 2–3 days | Done   |
| 02   | [Split extensions and resolution per language](02-language-dispatch.md)                         | 01                       | 1–2 days | Done   |
| 02.1 | [Record import resolution status](02.1-import-resolution-status.md)                             | 02                       | 1–2 days | Done   |
| 02.2 | [Make module reuse depend on resolution inputs](02.2-resolution-aware-module-reuse.md)          | 02                       | 1 day    | Done   |
| 03   | [Add Python project and source discovery](03-python-project-discovery.md)                       | 00, 02                   | 2–3 days | Done   |
| 04   | [Parse Python static imports](04-python-import-parser.md)                                       | 00 (wiring needs 02, 03) | 2–3 days | Done   |
| 05   | [Resolve Python local imports](05-python-import-resolution.md)                                  | 02.1, 02.2, 03, 04       | 3–5 days | Done   |
| 06.1 | [Report checks that could not be evaluated](06.1-not-applicable-reporting.md)                   | 04                       | 1–2 days | Done   |
| 06   | [Apply rules and contracts to Python modules](06-policy-scanning-integration.md)                | 01, 04, 05, 06.1         | 2–4 days | Done   |
| 07   | [Verify graph, cache, and output integration](07-graph-cache-output.md)                         | 05, 06                   | 1 day    | Done   |
| 07.1 | [Report graph completeness](07.1-graph-completeness.md)                                         | 02.1, 05                 | 1 day    | Done   |
| 08   | [Add fixtures, documentation, and release validation](08-fixtures-docs-validation.md)           | 03–07.1                  | 3–4 days | Done   |
| 08.1 | [Add analyzer property tests](08.1-analyzer-property-tests.md)                                  | 05, 07                   | 1 day    | Done   |

Total estimate: 22–34 working days, assuming options C1 and C2 as confirmed. Tasks 00–08.1, the MVP, are done. Task 09 is post-MVP.

Tasks 02.1 and 02.2 change JS/TS behavior only and can be done in either order before Task 03. Task 04's parser can be built and unit-tested on plain strings in parallel with them. Keep existing JS/TS tests green throughout.

## Post-MVP

- [09: Add optional Python project checks](09-python-project-checks-post-mvp.md) is deliberately separate from the MVP; it is replaced by [Task 17](../17-project-checks.md), using D27.
- Follow-up work (new task IDs are separate from the Python MVP IDs):
  - [`required-call` for Python](../12-python-calls.md) (D26);
  - [Python manifests](../09-python-manifests.md) and [`package-boundary`](../10-python-package-boundary.md) (D25);
  - classifying imports as runtime, type-only, or conditional, for both languages;
  - [Python entrypoints](../15-python-entrypoints.md) and [framework/capability signals](../14-signal-tables.md);
  - [language backends](../02-language-backend-interface.md) and [conformance tests](../07-language-conformance.md), retaining fact-based applicability;
  - resolving JS/TS workspace package imports to package sources without installed `node_modules` (184 unresolved imports in the changesets fixture, D16).

## Definition of done

The MVP is complete when Task 08 and 08.1 acceptance criteria pass, supported Python imports participate in Guard rules, contracts, and impact analysis as the D8 matrix states, skipped checks are reported, graph gaps are visible, mixed-language projects work, JS/TS behavior is unchanged apart from documented intentional fixes, and the documented limitations match tested behavior.
