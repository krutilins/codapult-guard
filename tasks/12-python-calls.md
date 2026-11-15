# Task 12: Support `required-call` on Python

**Phase:** 3, Python facts  
**Estimate:** 2–3 days  
**Depends on:** Task 07  
**Commit:** `feat(python): extract calls for required-call contracts`  
**Status:** Done (2026-11-15). See [implementation and validation evidence](09-16-validation.md).

**Decision:** D26, which reverses C1

## Goal

Evaluate `required-call` contracts on Python, with a clear statement of what a syntactic match means.

## Work

- `python-imports.ts` collects dotted callee names from `CallExpression` nodes into `ModuleRecord.calls`, with the same filter as JS/TS (`validate`, `self.validate`, `client.auth.check`). A callee such as `get_client().check()` is dropped, as it is for JS/TS today.
- Decorator names go in a separate list or in `parseFacts`, because Task 15 uses them. A decorator is not counted as a call unless a test shows that contracts need it.
- Python `collectedFacts` gains `calls`.
- D26 implemented in `scanContracts`: a Python module that lacks the call and has `parseDiagnostics` is counted as not applicable with a specific reason, and it produces no finding. A call that is present passes as usual.
- This rule should be expressed through a generic fact, for example a `module.factsComplete` check, instead of a language name. A JS/TS module keeps today's behavior because its parser never sets diagnostics.
- `DISCOVERY_CACHE_VERSION` is bumped, since cached Python modules have empty `calls`.

## Check before finishing

D4 notes that `calls` and `importedSymbols` feed the text matching in `src/core/analysis/packs.ts`. Filling `calls` will change Python pack assessments, so the change needs a review on the Python fixtures and a real project.

## Limits to document

The match is syntactic. `self.validate()` matches the contract `self.validate`, not a method defined elsewhere, and an alias is not followed. This is the same guarantee as JS/TS.

## Acceptance criteria

- A contract scoped to a Python directory reports only the modules that lack the call.
- A file with a syntax error in the scope reports not applicable, not a finding.
- The not-applicable output for `required-call` on valid Python disappears, and the `D8` matrix and docs are updated.
- Discovery time for the Python benchmark variant stays under the TS variant, per D13.
