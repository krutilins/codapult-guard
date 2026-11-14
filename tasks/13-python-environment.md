# Task 13: Support the environment insight on Python

**Phase:** 3, Python facts  
**Estimate:** 1–2 days  
**Depends on:** Task 07  
**Commit:** `feat(python): record environment variable reads`  
**Status:** Not started

## Goal

Fill `environmentReads` from the Python backend, so the `undeclared-environment-reference` insight covers Python.

## Work

Static string-literal reads only:

- `os.environ["NAME"]`
- `os.environ.get("NAME")`
- `os.getenv("NAME")`
- `environ["NAME"]` and `getenv("NAME")` when imported from `os`

Names must match the same upper-case pattern that JS/TS uses, and a computed key is ignored.

- Parse facts stored in `parseFacts`, so reuse rules stay the same as other parsed data.
- `ModuleFact` gains `environment`, with the insight declaring it as required, which replaces the current "JS-only" behavior with a fact check.
- The `declared` logic stays shared. Its file list is reviewed against common Python layouts such as `.env.example` and `settings.py` defaults.

## Out of scope

Reads through `pydantic-settings`, `django-environ`, and similar libraries are not detected, and the docs say so. Without those, a FastAPI project may show few references, so the docs should not imply that the absence of findings means full coverage.

## Acceptance criteria

- A fixture with all listed spellings reports each name once with its files.
- An undeclared Python read produces the insight finding, and a declared one does not.
- A computed key produces nothing.
- JS/TS baselines are unchanged.
