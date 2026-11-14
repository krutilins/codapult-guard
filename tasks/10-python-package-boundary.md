# Task 10: Support `package-boundary` on Python

**Phase:** 2, Ecosystem layer  
**Estimate:** 1–2 days  
**Depends on:** Task 09  
**Commit:** `feat(python): evaluate package-boundary contracts`  
**Status:** Not started

## Goal

Make `package-boundary` work on Python using the packages from Task 09, and remove it from the Python not-applicable list.

## Work

- A package means one Python project root with a manifest, which is the explicit-root option from the Python backlog. A directory with `__init__.py` is not a package for this purpose.
- `packageForFile` in `guard.ts` loses its `package.json` condition, which moves into data provided by the ecosystem.
- `packageForImport` matches resolved local paths first, then the declared package names of the project. The name match works on the PEP 503 form, and it also tries the common case where the import name equals the distribution name.
- Python `collectedFacts` adds `packages` only when the project has at least one manifest. A module in a repository with no manifest stays not applicable, so the fact becomes conditional. This may need a small interface change, such as a method that takes the project context.
- The `D8` matrix in the decision record and the table in `docs/guard.md` are updated.

## Limits to document

An import whose name differs from its distribution name, such as `PIL` from `pillow`, can't be matched without a mapping table. It counts as an external import with no package. A contract that names `pillow` as forbidden won't fire on `import PIL`, so a `forbidden-import` rule on the import name is the documented alternative.

## Acceptance criteria

- A monorepo fixture with two Python packages reports a boundary violation at the import line.
- A repository without manifests still reports not applicable.
- Mixed repositories keep JS/TS and Python packages apart.
- JS/TS `package-boundary` tests pass without edits.
