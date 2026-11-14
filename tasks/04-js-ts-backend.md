# Task 04: Move JS/TS parsing and resolution behind its backend

**Phase:** 1, Language layer  
**Estimate:** 2–3 days, the largest refactor in this phase  
**Depends on:** Task 02  
**Commit:** `refactor(languages): move JS/TS parsing into its backend`  
**Status:** Not started

## Goal

Make JS/TS use the same session contract as Python, so `parseModule` in discovery becomes a registry lookup.

## Work

- `parseJsTsModule`, `pathAliases` and the alias helpers, `resolveInternalImport`, `jsTsResolutionCandidates`, `unresolvedJsTsImports`, and `createAstProject` move to `src/core/languages/js-ts/`.
- `withImportStatus` becomes part of the JS/TS `resolveModules`, which keeps its requirement to run on every discovery, including reused modules.
- `LanguageContext` gains whatever JS/TS needs, such as workspace names. Anything specific to npm moves to the ecosystem layer in Task 08, so a temporary field is acceptable here.
- A new backend member covers the resolution inputs that gate module reuse, replacing `RESOLUTION_CONFIG_NAME`. `resolutionFingerprint` combines the inputs of all backends.
- `buildModuleTargetGraph` keeps its fallback through a backend method, such as `fallbackTargets(module, projectFiles)`, which returns nothing for Python.
- `ts-morph` loads lazily, and `createSession` builds the `Project` only when the repository has JS/TS files. Python-only repositories no longer create it.

## Notes

If this commit is too large to review, it can split into parsing first and then resolution, with the baseline as the gate for each.

`ts-morph` at the top of the module is loaded on every run today, so lazy loading may improve Python-only cold starts. Any measured gain goes in the commit message.

## Acceptance criteria

- The model baseline is unchanged.
- `pnpm test:guard:fixtures:all` passes, including the adversarial alias and re-export fixtures.
- `ts-morph` remains imported in `discovery.ts` only for the enrichment that Task 05 moves.
- The D13 benchmark method shows TS-only cold and warm medians within 5%.
