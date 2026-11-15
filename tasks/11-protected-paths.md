# Task 11: Move protected paths into ecosystems

**Phase:** 2, Ecosystem layer  
**Estimate:** 1 day  
**Depends on:** Task 08  
**Commit:** `feat(verification): declare protected paths per ecosystem`  
**Status:** Done (2026-11-15). See [implementation and validation evidence](09-16-validation.md).

## Goal

Make protected paths data owned by each ecosystem, finish the Python list, and replace the substring guessing that assigns each path's `kind`.

## Work

- `EcosystemProvider` gains `protectedPaths: { pattern: string; kind: string }[]`.
- `DEFAULT_PROTECTED_PATHS` in `verify.ts` splits into a shared list (CI workflows, CODEOWNERS, Guard policy, generic ignore files) and an npm list.
- The classifier chain in `getPolicySurface` is removed, and every entry states its kind. The npm kinds must equal what the classifier produces today, so receipts stay the same.
- New Python entries at any depth:
  - `dependency-input`: `requirements*.txt`, `uv.lock`, `poetry.lock`, `pdm.lock`, `Pipfile`, `Pipfile.lock`;
  - `tool-config`: `ruff.toml`, `.ruff.toml`, `mypy.ini`, `.mypy.ini`, `pyrightconfig.json`, `pytest.ini`, `tox.ini`, `noxfile.py`, `conftest.py`, `.coveragerc`, `.python-version`;
  - `pyproject.toml`, `setup.cfg`, and `setup.py` move from `tool-config` to `dependency-input`, since they now declare dependencies after Task 09.
- `SOURCE_EXTENSIONS` for suppression scanning stays shared, because markers such as `# noqa` can be anywhere. It gets a comment explaining why it differs from language extensions.

## Acceptance criteria

- A snapshot of every npm pattern and kind matches the output from before this task.
- A test covers each new Python entry at the project root and in a nested directory.
- `--fail-on-protected-changes` fails on a `uv.lock` change, and the changelog lists the addition as a behavior change.
- `docs/guard.md` describes the Python paths.
