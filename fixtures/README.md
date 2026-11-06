# Guard fixtures

These small projects exercise the structural cases that are easy to miss in a
real repository. They are intentionally dependency-free and are not included
in the published package. The Python fixtures are never installed or run.

| Fixture             | Case                                                  |
| ------------------- | ----------------------------------------------------- |
| `aliases`           | TypeScript path aliases and client/server boundaries  |
| `re-exports`        | barrel files and aliased exports                      |
| `dynamic-imports`   | literal dynamic imports and `require`                 |
| `symlinks`          | links must not escape the project root                |
| `deleted-renamed`   | Git state with deleted and renamed files              |
| `monorepo`          | nested workspace package boundaries                   |
| `package-exports`   | package exports and TypeScript project references     |
| `module-boundaries` | aliases, re-exports, require, and dynamic imports     |
| `python-app`        | Python flat layout, re-exports, `TYPE_CHECKING` cycle |
| `python-src-layout` | Python `src/` layout                                  |
| `python-monorepo`   | namespace package split across project roots          |
| `python-mixed`      | TypeScript frontend and Python backend                |
| `python-edge-cases` | unresolved, ambiguous, malformed, and ignored paths   |

The executable matrix in `scripts/` also runs against pinned external
repositories. These fixtures keep deterministic adversarial cases local and
fast, so a regression does not depend on GitHub availability.
