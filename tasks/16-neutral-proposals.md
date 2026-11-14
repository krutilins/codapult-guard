# Task 16: Generate language-neutral proposals

**Phase:** 4, Signals and proposals  
**Estimate:** 2–3 days  
**Depends on:** Task 14  
**Commit:** `feat(proposals): propose import boundaries from observed layers`  
**Status:** Not started

## Goal

Give every project useful proposed policy after `init`, in any language. `buildGeneratedGuardConfig` only proposes one rule, for client components that import persistence modules, so most JS/TS projects and all Python projects get no generated rules.

## Work

New proposals derived from graph facts that exist for every language: `insights.layers`, `layerEdges`, and `importResolution`.

- **Layer direction.** When the graph has `domain` and `infrastructure` layers and no edge from `domain` to `infrastructure`, propose an `import-boundary` contract with `mustNotImport` that keeps it so. The same applies to other pairs from a short, documented list, such as `ui` to `infrastructure`.
- **Persistence access.** When a persistence capability exists and imports of it come from a small set of directories, propose that the remaining code stays out. The evidence lists those directories.
- **Existing violations.** A pair with a few existing edges can still be proposed, with lower confidence and with evidence that lists them, since the baseline can accept them. A pair with many edges is not proposed.

Rules for every proposal:

- Stays `proposed` until approved, as today.
- States its evidence and confidence.
- Has a stable ID derived from its content, so re-running `propose` does not create duplicates.
- Stays capped in number, so `init` remains readable.
- Mentions no language name in shared code, and patterns are resolved paths or directories.

`buildGuardProposals` should reuse the same evidence for its `persistence-boundary` contract, instead of adding a parallel path.

## Behavior change

JS/TS projects will see new pending proposals after upgrading, so this goes in the changelog. Pending proposals never affect exit codes.

## Acceptance criteria

- `init` on `fixtures/python-app` and on a JS/TS layered fixture each produce at least one proposed boundary.
- After approval, the same proposal catches a newly added violating import in both languages.
- A project without recognizable layers produces no new proposals.
- Running `propose` twice produces identical IDs and content fingerprints.
- The `docs/guard.md` section on Python-only `init` output is updated.
