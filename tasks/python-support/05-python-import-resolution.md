# Task 05: Resolve Python local imports

**Phase:** Python discovery  
**Priority:** MVP  
**Estimate:** 3–5 days  
**Depends on:** Tasks 02.1, 02.2, 03, 04  
**Status:** Done. Lookup goes segment by segment with runtime package precedence (D9 refinement); statuses, canonical names, and the real-project check are in D9 and D16

## Goal

Resolve the explicitly supported subset of Python imports to project-local module files, following the rules in decision D9, and record every import's resolution status honestly.

## Work

- Run Python resolution as a separate pass over parsed Python facts on every discovery, after parsing and module reuse (D18). Cached Python records keep parse facts only, so adding a file, a package, or a resolution root never leaves stale edges.
- Build the resolution root groups from D9: the importing file's nearest Python project root and its `src/`, then the Guard root and its `src/`, then other Python project roots. Sort roots so the order never depends on file traversal.
- Resolve `a.b.c` to `R/a/b/c.py`, then `R/a/b/c/__init__.py`. Intermediate directories may lack `__init__.py` (namespace packages).
- Resolve `from X import Y` in this order: `X.Y` as a local module (adding the derived reference from D6), otherwise `X` as a local module, otherwise unresolved or external. Never try to find which module defines an arbitrary symbol.
- Create edges only for the modules named in the import (direct import graph). Parent `__init__.py` files that Python would execute are not edges. Their effect appears only through imports written in those files.
- Treat more than one candidate within a root group as ambiguous and leave it unresolved.
- A local module shadows a standard-library or installed name with the same spelling, as it does at runtime when the root is first on `sys.path`. Do not keep a standard-library name list.
- Classify unresolved imports per Task 02.1: relative imports that do not resolve, and absolute imports whose first segment names a local top-level package or module, are `unresolved`. Other non-local imports are `external`.
- Store the absolute dotted name of each relative import that can be converted, for example in an optional `canonicalImports?: Record<string, string>` field, so policy matching (D7) reads it instead of recomputing it from Python syntax.
- Keep resolution inside the Python resolver. A dotted Python import must never be interpreted as a JS/TS module, and the reverse.
- Document how imports from sibling monorepo packages are treated.

## Acceptance criteria

- Fixtures cover every row of the D9 resolution rules, plus:
  - `from app import services` (module), `from app.services import UserService` (symbol, edge to `app/services.py`), and `from app import UserService` (name in `__init__.py`, edge to `app/__init__.py`);
  - a namespace monorepo with `packages/billing/src/company/billing/service.py` and `packages/users/src/company/users/service.py`, where `company.billing.service` and `company.users.service` each resolve to one file and `company` alone produces no edge;
  - standard-library shadowing: local `json.py` and `typing.py` resolve as local modules;
  - an ambiguous module present in two roots of the same group stays unresolved;
  - external, unresolved relative, and unresolved local-looking absolute imports with the expected statuses.
- Resolved edges only point to existing in-root Python source modules and are deterministic.
- Unresolved and ambiguous imports do not create false graph edges or false policy findings.
- Resolution tests show the canonical dotted names used by policy rules.
