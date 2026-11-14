# Task 19: Validate on real projects and publish docs

**Phase:** 5, Verification and release  
**Estimate:** 2–3 days  
**Depends on:** Tasks 10 to 18  
**Commit:** `docs: document language architecture and Python support`  
**Status:** Not started

## Goal

Check the finished work against real repositories, and test the claim that a new language would be cheap to add.

## Work

- **Real projects.** Pinned Python repositories added to `scripts/prepare-fixture-projects.mjs` and to a fixture script: Flask, the FastAPI full-stack template (both already used for checks in Python Task 08), and a Django project. Results recorded per project: modules, resolved imports, frameworks, entrypoints, and proposals.
- **Go review on paper.** A written walk through the interfaces for Go, without any code: modules and package-level imports, `go.mod` as the manifest, `go.work` for workspaces, and whether a synchronous parser exists. Any interface problem it finds is either fixed or written down. Go is chosen because its directory-level packages differ from both current languages.
- **Docs.**
  - `docs/adding-a-language.md`: the layers, both interfaces, the conformance suite, signal tables, and a checklist.
  - `docs/guard.md`: the Python section and the rule matrix updated, and "Not implemented" reduced to what remains.
  - `README.md`: the Python support note updated to what now works.
  - `package.json`, `server.json`, and `glama.json`: descriptions checked for accuracy.
- **Status.** `PLAN.md` marked as done, and any deferred items moved to a backlog list.
- **Benchmarks.** Final JS/TS and Python numbers recorded against the build before Task 02, as the D13 method describes.

## Acceptance criteria

- `pnpm release:check` passes.
- `pnpm test:guard:fixtures:full` passes on pinned clones refreshed with `pnpm test:guard:prepare-fixtures`.
- Every completion criterion in `PLAN.md` is checked and marked with evidence.
- The checklist in `docs/adding-a-language.md` matches what the fake language in Task 07 needed.
