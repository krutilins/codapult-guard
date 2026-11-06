# Task 06: Apply rules and contracts to Python modules

**Phase:** Policy integration  
**Priority:** MVP  
**Estimate:** 2–4 days  
**Depends on:** Tasks 01, 04, 05, 06.1  
**Status:** Done. A `from` import reports the written module and each derived submodule as separate findings (D7 addition)

## Goal

Apply every existing rule and contract kind to Python modules as the Task 00 matrix specifies, with correct source locations and no false findings from unsupported kinds.

## Work

- Implement decision D7 in `patternMatches`: for Python references only, `.` is an additional segment boundary. A trailing `*` keeps raw prefix semantics, and JS/TS matching is unchanged. File, scope, and budget-scope helpers keep path semantics.
- Match each Python reference against its spelling, the canonical dotted name stored by Task 05, and its resolved path (D7). Policy code does not interpret Python syntax.
- `forbidden-import` and `import-boundary` `mustNotImport`: report the import line from Task 01.
- `import-boundary` `mustImport`: all static imports count (D5, D8). The check means "a statically detected import is present", not proof of a runtime dependency. State this in the contract docs.
- `required-call`, `package-boundary`, and `client-forbidden-import`: skipped for Python modules through the fact checks and reported as not applicable by Task 06.1 (D8, D17, C1, C2). The `client-server-boundary` insight finding stays JS-only, because it depends on `use client`.
- Budgets: confirm `imports` counts Python imports and `lines`/`bytes` work unchanged.
- Preserve finding fingerprints, baseline behavior, waiver behavior, and deterministic diagnostics.
- Review policy schema documentation and validation messages for language-neutral wording where warranted.

## Acceptance criteria

- Each row of the D8 matrix has Python tests for allowed and disallowed cases, including aliases, relative imports, and path scopes.
- Every row of the D7 fixture table is a test, including the unchanged JS case.
- A test proves skipped kinds (`required-call`, `package-boundary`, `client-forbidden-import`) produce no findings on Python modules and appear in `notApplicable` (Task 06.1).
- Findings identify the correct file and import line and remain stable across repeat scans.
- Baseline and waiver behavior works with Python finding fingerprints.
- Existing TS/JS rule and contract behavior remains unchanged.
