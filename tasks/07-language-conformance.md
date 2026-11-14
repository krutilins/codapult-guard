# Task 07: Add the conformance suite and boundary test

**Phase:** 1, Language layer  
**Estimate:** 1 day  
**Depends on:** Task 06  
**Commit:** `test(languages): add backend conformance suite and boundary test`  
**Status:** Done (2026-11-14). See [implementation and validation evidence](00-08-validation.md).

## Goal

Prove the seam works and keep it from eroding. This task closes Phase 1.

## Work

**Conformance suite.** A reusable function, `describeLanguageBackend(backend, cases)`, that each backend runs. It covers:

- deterministic results, independent of file order;
- reused modules matching fresh ones (D18);
- imports never resolving to another language's file;
- every resolved target existing in the project;
- `collectedFacts` matching the fields the backend actually fills;
- no project code executed, based on the existing `python-no-execution` test.

**Fake language.** A test-only backend for a `.fake` file extension, with deliberately different semantics: a `use "a::b"` import syntax, `::` as a segment separator, and only the `imports` fact. It is registered through a test-only registry parameter, not in production.

End-to-end test on the fake language: discovery, a graph edge, a `forbidden-import` finding at the right line, `impact` output, a SARIF result, and a not-applicable entry for `required-call`.

**Boundary test.** A test that scans `src/` and fails when:

- anything outside `core/languages/` imports `ts-morph` or `@lezer/python`;
- anything other than a registry imports a concrete backend;
- a language ID is compared outside `core/languages/`.

## Acceptance criteria

- JS/TS, Python, and the fake backend all pass the same suite.
- The fake language needs no change outside its test file. Any edit it would need is treated as a bug in the interface and fixed in this task.
- Adding a deliberate `ts-morph` import to `guard.ts` makes the boundary test fail.
