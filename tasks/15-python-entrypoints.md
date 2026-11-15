# Task 15: Add entrypoints for Python impact paths

**Phase:** 4, Signals and proposals  
**Estimate:** 2–4 days, with high uncertainty  
**Depends on:** Tasks 12 and 14  
**Commit:** `feat(python): detect entrypoints and route handlers`  
**Status:** Done (2026-11-15). See [implementation and validation evidence](09-16-validation.md).

## Goal

Make `insights.impactPaths` useful on Python, so a changed module shows which routes and commands reach it.

## Work

The Python backend fills `routeHandlers` and `routeDetails` from the `projectFacts` method added in Task 05. Detection depends on the frameworks found in Task 14, to avoid matching unrelated decorators.

| Source                   | Detection                                                                                        | Methods                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| FastAPI, Starlette       | Decorators such as `@app.get`, `@router.post`, where the receiver's module imports the framework | From decorator name                                          |
| Flask                    | `@app.route`, `@bp.route`, `@app.get`                                                            | From `methods=` when it is a literal list, otherwise unknown |
| Django                   | `urls.py` modules as entrypoints, plus their directly imported view modules                      | Unknown                                                      |
| Command-line entrypoints | `[project.scripts]` targets and `__main__.py`                                                    | None                                                         |

- The parser records decorators with their literal arguments, extending what Task 12 stored.
- `patterns.routeHandlers` and `routeDetails` keep their shape. Unknown HTTP methods are an empty list.
- The docs drop the statement that impact paths start only from Next.js.

## Open point

Django `urls.py` often uses `path("x/", views.handler)`, where the view module is imported directly but string-based and class-based includes are not. This task starts with the import-based form, and it records what real projects show. If it gives poor results, Django support can ship as a smaller follow-up without blocking the others.

## Acceptance criteria

- On a FastAPI fixture, changing a repository module shows the affected route file in the impact path.
- A decorator named `route` in a project without Flask or FastAPI does not create an entrypoint.
- The FastAPI full-stack template and Flask real-project checks from Python Task 08 give plausible results, written down in the commit message or decision record.
- JS/TS baselines are unchanged.
