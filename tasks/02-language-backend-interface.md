# Task 02: Add the backend interface and move file classification

**Phase:** 1, Language layer  
**Estimate:** 1–2 days  
**Depends on:** Task 01  
**Commit:** `refactor(languages): add language backend registry`  
**Status:** Done (2026-11-14). See [implementation and validation evidence](00-08-validation.md).

## Goal

Introduce the seam with the smallest useful surface: which language owns a file, which facts it collects, and how its files are classified.

## Work

New folder `src/core/languages/` with `types.ts`, `index.ts` (the registry), `js-ts/index.ts`, and `python/index.ts`.

The starting interface is below. Later tasks add to it, and this sketch can change when the real code suggests something simpler.

```ts
export interface LanguageBackend {
  /** Stable public ID, written to JSON output (D24). */
  readonly id: string;
  readonly extensions: ReadonlySet<string>;
  readonly collectedFacts: readonly ModuleFact[];
  /** File kind for a path this backend owns, including its test-file convention. */
  classifyFile(path: string): ProjectFileRecord['kind'];
  /** Directory names that mark the routes layer, such as `app` for Next.js. */
  readonly routeLayerSegments: readonly string[];
}
```

Moved or changed:

- `JS_TS_SOURCE_EXTENSIONS`, `PYTHON_SOURCE_EXTENSIONS`, `pythonTestFile`, and `COLLECTED_FACTS` move into the backends.
- `SourceLanguage` becomes the union of registered IDs, and `sourceLanguage` and `collectedFacts` read the registry.
- `fileKind` asks the owning backend first and keeps its shared rules for files no backend owns.
- `layerForPath` uses `routeLayerSegments` and a backend test check, which removes its `python` branch.
- `discovery.ts` keeps re-exporting `sourceLanguage`, `collectedFacts`, `SourceLanguage`, and `ModuleFact`, because `src/index.ts` exports it with `export *` (D24).
- `PYTHON_CONFIG_NAMES` stays for now and moves in Task 08.

## Acceptance criteria

- The model baseline is unchanged.
- `fileKind` and `layerForPath` no longer contain a language name.
- Backends do not import from `discovery.ts` except for types.
- The D13 benchmark method shows TS-only cold and warm medians within 5%.
