# Task 09: Read Python manifests

**Phase:** 2, Ecosystem layer  
**Estimate:** 2–3 days  
**Depends on:** Task 08  
**Commit:** `feat(python): read project metadata from manifests`  
**Status:** Not started  
**Decision:** D25, which reverses C2

## Goal

Fill the empty `project` section for Python repositories without running anything.

## Work

- `smol-toml` added as a dependency, loaded lazily through the same pattern as `@lezer/python`.
- `pyproject.toml`: `[project]` name, `dependencies`, and `optional-dependencies`, `[dependency-groups]`, and `[tool.poetry]` dependencies. `[project.scripts]` is kept for Task 15.
- `setup.cfg`: `[metadata] name` and `[options] install_requires`.
- `requirements*.txt`: package names and version specifiers. `-r` includes are followed only inside the project. URLs and editable installs are recorded by name when one is stated, and skipped otherwise. No URL is fetched.
- `setup.py` is never read as code (D25).
- Dependency names normalized per PEP 503, with the written form kept for display.
- Package manager from lockfiles: `uv.lock`, `poetry.lock`, `pdm.lock`, `Pipfile.lock`, and pip when only requirements files exist.
- `requirements-dev.txt`, `[dependency-groups]`, and similar names go in `devDependencies`.
- Nested Python projects become entries in `workspacePackages`, with a new optional `ecosystem` field. Root `dependencies` follow the merging rule from Task 08.
- Manifests added to the resolution inputs and to `discoverySignature`, so edits invalidate the cache.

## Safety

- Parsing is bounded by the existing `maxFileBytes`.
- A malformed manifest produces a `doctor` warning and no crash, and the rest of discovery continues.
- `python-no-execution.test.ts` is extended so a `setup.py` with a side effect stays untouched.

## Acceptance criteria

- `fixtures/python-app` shows its dependencies in `project.json`.
- `doctor` reports a broken `pyproject.toml` as a warning.
- JS/TS-only baselines are unchanged. Python and mixed baselines change as intended.
- The changelog notes that this reverses C2, and that the `docs/guard.md` "Not implemented" list has been updated.
