# Task 14: Turn framework and capability signals into data

**Phase:** 4, Signals and proposals  
**Estimate:** 2–3 days  
**Depends on:** Task 09  
**Commit:** `feat(signals): declare framework and capability signals per ecosystem`  
**Status:** Not started

## Goal

Move framework and capability recognition out of code and into per-ecosystem tables, then add Python tables. This is the part a future language contributor should be able to do without reading discovery.

## Work

Providers gain a data member:

```ts
export interface EcosystemSignals {
  frameworks: { dependency: string; name: string }[];
  capabilities: Record<string, { packages: RegExp; imports: RegExp; evidence: string }>;
}
```

- `inferFrameworks` becomes a loop over the tables. The `vite` and `next` exception stays expressible, either as data or as a small provider hook.
- `detectCapabilities` keeps its `packageSignal` logic and combines each capability's patterns across ecosystems. File patterns such as `auth/` and `billing/` stay shared, because directory names are not tied to a language.
- `runtime` and any capability based on `use client` directives read neutral facts from Task 05.
- `isPersistenceImport` in `buildGeneratedGuardConfig` reads the same persistence table instead of its own copy of the ORM list.

Initial Python table:

| Capability or framework | Examples                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| Frameworks              | Django, FastAPI, Flask, Starlette, Celery, SQLAlchemy                           |
| `persistence`           | `sqlalchemy`, `django.db`, `psycopg`, `asyncpg`, `alembic`, `peewee`, `pymongo` |
| `identity`              | `authlib`, `django.contrib.auth`, `flask_login`, `fastapi_users`, `jwt`         |
| `payments`              | `stripe`, `paddle`, `braintree`                                                 |
| Remaining capabilities  | Reviewed one by one, and added only with clear package names                    |

Python import names and PyPI names differ, so the table lists each separately where needed.

## Acceptance criteria

- JS/TS baselines are unchanged, shown by a test that the table reproduces today's output for every fixture.
- A FastAPI fixture reports its framework and its `persistence` capability at high confidence, because both a dependency and an import match.
- Without a manifest, confidence stays at medium or lower, as D12 describes.
- A fake ecosystem can add a framework through data only.
