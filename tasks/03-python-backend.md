# Task 03: Move Python behind its backend

**Phase:** 1, Language layer  
**Estimate:** 1–2 days  
**Depends on:** Task 02  
**Commit:** `refactor(languages): move Python analysis into its backend`  
**Status:** Done (2026-11-14). See [implementation and validation evidence](00-08-validation.md).

## Goal

Define the parse and resolve contract on the simpler implementation first, and remove the Python-named field from the shared model.

## Work

Interface additions:

```ts
export interface LanguageBackend {
  // Earlier members omitted.
  /** Creates per-discovery state lazily, so an unused language costs nothing (D22). */
  createSession(context: LanguageContext): LanguageSession;
}

export interface LanguageSession {
  parseModule(path: string): ModuleRecord | undefined;
  /** Runs on every discovery, including reused modules (D18). */
  resolveModules(modules: ModuleRecord[]): ModuleRecord[];
}
```

`LanguageContext` carries `root`, `allFiles`, and `projectFiles`.

Moved or changed:

- `python-imports.ts`, `python-resolution.ts`, their tests, `parsePythonModule`, `withPythonResolution`, and `pythonProjectRoots` move to `src/core/languages/python/`.
- `ModuleRecord.pythonImports` becomes a generic `parseFacts?: unknown` field that only the owning backend reads and narrows. `DISCOVERY_CACHE_VERSION` is bumped.
- Fingerprints and `project.json` change once because of the renamed field. The commit notes this for the changelog.
- `discoverProjectOnce` calls the registry for Python, and `buildInsights` stops testing `module.pythonImports`. The JS/TS path stays direct until Task 04.

## Acceptance criteria

- The model baseline differs only by the field rename.
- `isPythonParserLoaded` stays false on a TS-only project, and the existing test still passes.
- `src/core/discovery/` no longer imports any Python module.
- The tests moved with their code and none were dropped.
