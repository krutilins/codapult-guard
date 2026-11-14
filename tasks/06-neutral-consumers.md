# Task 06: Remove language branches from shared code

**Phase:** 1, Language layer  
**Estimate:** 1–2 days  
**Depends on:** Tasks 03 and 05  
**Commit:** `refactor(policy): read import semantics from language backends`  
**Status:** Not started

## Goal

Layers above the backends make no decision based on a language name.

## Work

- `importResolutionStatus` delegates its language-specific part to a backend method, `importStatus(module, specifier)`. The shared checks of `resolvedImportMap` and `unresolvedImports` stay.
- `moduleImportReferences` and `referenceMatches` in `guard.ts` lose the `python` flag. The backend supplies `referenceMatches(reference, pattern)`, and the dotted-name logic in `pythonNameMatches` moves to the Python backend.
- The importing of external package names for `importHotspots` in `buildInsights` uses `importResolutionStatus` for every language, if the baseline shows identical results. If it differs, the difference goes behind a backend method.
- `MISSING_FACT_REASONS` in `guard.ts` loses its `package.json` and `"use client"` wording, or takes it from the backend, so messages stay accurate for any language.
- `summarizeImportResolution` keeps its output, reading language IDs through the registry.
- `src/mcp/` and `src/cli/` are checked for language-specific text that describes supported behavior.

## Acceptance criteria

- A search for `'python'`, `'js-ts'`, and `sourceLanguage(...) ===` outside `src/core/languages/` finds nothing except tests and the registry.
- The model baseline is unchanged, with one permitted exception: not-applicable reason text, if wording changed. D17 output stays otherwise identical.
- D7 pattern matching tests for Python pass without edits.
