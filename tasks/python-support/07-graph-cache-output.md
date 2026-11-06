# Task 07: Verify graph, cache, and output integration

**Phase:** Shared analysis integration  
**Priority:** MVP  
**Estimate:** 1 day  
**Depends on:** Tasks 05, 06  
**Status:** Done. `app` and `pages` no longer mark Python modules as the `routes` layer (D12 change), and the cache version is 8 (D18)

## Goal

Ensure Python module facts flow through the shared dependency graph and persisted-state pipeline correctly.

## Work

- Verify cycles, hotspots, layer edges, `analyzeProjectImpact`, and changed-file impact scope include Python modules.
- Document that `insights.impactPaths` starts only from Next.js route handlers and server actions, so Python modules appear there only when reachable from a JS/TS entrypoint. Python entrypoints are post-MVP.
- Confirm that Python resolution is recomputed on every discovery (D18, Task 05), so adding or removing `pyproject.toml`, `setup.cfg`, `setup.py`, or `__init__.py` files never leaves stale edges. JS/TS reuse is covered by the fingerprint from Task 02.2.
- Document that the graph has no cross-language edges. A TypeScript frontend calling a Python API over HTTP, or services connected through a message broker, are not dependencies Guard can see (D19).
- Confirm generic JSON and SARIF findings need no Python-specific duplication.
- Test cache cold/warm behavior and mixed-language model round trips.

## Acceptance criteria

- A Python import chain appears in the graph and in `analyzeProjectImpact` output, including changed-file impact.
- Mixed-language modules coexist and graph resolution remains language-correct.
- Changing Python resolution roots updates edges on the next discovery. Old-version or incompatible cache records are rejected, and unchanged Python parse facts are reused safely.
- Generic output includes valid paths and finding locations for Python without breaking existing consumers.
