# Task 02: Split extensions and resolution per language

**Phase:** Architecture  
**Priority:** Blocker  
**Estimate:** 1–2 days  
**Depends on:** Task 01  
**Status:** Done. `fileKind` still classifies only JS/TS extensions as source; Task 03 adds `.py`, so JS projects that contain stray Python scripts see no change before Python modules are parsed

## Goal

Prepare discovery for a second language without an abstract backend layer: separate source extensions and fallback resolution per language, and choose the parser by file extension.

## Work

- Split `SOURCE_EXTENSIONS` in `src/core/discovery/discovery.ts` into a JS/TS set and a Python set. `fileKind` uses the union. `resolveInternalImport` and `resolveAliasedImport` use the JS/TS set only.
- Restrict the fallback resolution in `buildModuleTargetGraph` to JS/TS modules, or route it through a per-language resolver chosen by the importing file's extension.
- Make `parseModule` choose the parser by extension. The Python branch returns `undefined` until Task 04 lands.
- Keep route-method detection, `process.env` scanning, and `createAstProject` JS/TS-only, and make sure `.py` files are never added to the `ts-morph` project.
- Derive language from the file extension. Add a persisted language field only if a consumer needs it, and bump the cache version if so.
- Do not add an abstract backend interface.

## Acceptance criteria

- TS-only fixture outputs are unchanged.
- A test proves a JS/TS import of `./foo` does not resolve to `foo.py`, and that Python-style spellings such as `.` and `..models` do not go through the JS/TS fallback.
- TS-only discovery shows no regression against the Task 00 benchmark threshold.
