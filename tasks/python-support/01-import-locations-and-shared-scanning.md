# Task 01: Record import locations and unify policy scanning

**Phase:** Architecture  
**Priority:** Blocker  
**Estimate:** 2–3 days  
**Depends on:** Task 00 (field naming and the JS/TS file-set decision)  
**Status:** Done. File-set decision and measured effect are recorded in D15 of the [decision record](../python-support-decisions.md)

## Goal

Make policy scanning work entirely from the discovery model, so it no longer needs a TypeScript `SourceFile` or its own file list. This is the main prerequisite for scanning Python modules, and it also fixes line numbers for JS/TS contract findings.

## Work

- Add import location data to `ModuleRecord` (for example, `importLines: Record<string, number>` keyed by import spelling). Populate it in the current `parseModule` for static imports, re-exports, dynamic `import()`, and `require()`.
- Use the stored lines in `scanFile` and in every import-related finding in `scanContracts` (`import-boundary` `mustNotImport` and `package-boundary`), which currently report `line: 1`. Missing-import (`mustImport`) and `required-call` findings stay file-level.
- Remove `importLine` and the `ts-morph` `Project` created in `scanGuard`. `scanFile` no longer takes a `Project`.
- Replace `listSourceFiles`/`isSourceFile` in `src/core/guard.ts` with modules from the discovery model, so rule scanning and discovery agree on files and ignore rules. The current lister excludes test files and `.mjs/.cjs/.mts/.cts`. Keep excluding tests, and apply the Task 00 decision on the extra extensions, which changes `scannedFiles` and possibly findings.
- Bump `DISCOVERY_CACHE_VERSION` and keep the persisted model `version` check consistent with the new field.

## Acceptance criteria

- `src/core/guard.ts` no longer imports `ts-morph`.
- Existing JS/TS discovery and guard tests pass. Expected-output changes are limited to corrected contract line numbers and the documented file-set change, and both are listed in the changelog.
- Rule and contract findings on JS/TS fixtures report the correct import line, including re-exports and dynamic imports.
- A cache test proves a model written with the previous cache version is not reused.
