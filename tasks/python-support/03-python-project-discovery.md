# Task 03: Add Python project and source discovery

**Phase:** Python discovery  
**Priority:** MVP  
**Estimate:** 2–3 days  
**Depends on:** Tasks 00, 02  
**Status:** Done. `.py` files named like configs or schemas stay source modules (D10 addition); Python files are classified but produce no module records until Task 04

## Goal

Recognize Python files and Python project roots while preserving the existing root and ignore behavior for JS/TS.

## Work

- Classify `.py` files as source through the Python extension set from Task 02.
- Classify Python test files per decision D11, for `.py` files only: `test_*.py`, `*_test.py`, `conftest.py`, or a `tests`/`test` path segment. Apply the same rule in `layerForPath`. JS/TS classification stays unchanged.
- Add the Python ignored directories and compiled-file extensions listed in D10 to `IGNORED_DIRECTORIES` and `ignoredFile`. `*.egg-info` needs a suffix check, since the set matches exact names.
- Extend `findGuardRoot` with `pyproject.toml`, `setup.cfg`, and `setup.py` (D10, C4), keeping nearest-ancestor precedence.
- Classify the Python manifests and lockfiles in D10 as config. The check must run before the documentation check, because `requirements.txt` is currently classified as documentation.
- Do not parse TOML in the MVP (C2). Python project roots are found by marker file presence only.
- Expose the list of Python project roots (directories with a marker) for the resolver in Task 05 (D9).
- Respect existing symlink, ignored-directory, max-file, max-size, and project containment safeguards.

## Acceptance criteria

- Python-only repositories initialize with a model, even when they have no `package.json` or TS config.
- Python files are discovered once, test files are classified correctly, and virtual environments and caches are excluded.
- A mixed project retains both Python and JS/TS source files.
- Nested project-root and monorepo tests cover the chosen marker precedence and containment behavior.
