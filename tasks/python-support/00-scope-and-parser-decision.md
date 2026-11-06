# Task 00: Scope and parser decision

**Phase:** Decisions  
**Priority:** Blocker  
**Estimate:** 1–2 days  
**Status:** Done. C1–C4 confirmed, see the [decision record](../python-support-decisions.md)

## Goal

Turn the proposed Python MVP into explicit, testable acceptance criteria and select a Python parser implementation that fits this Node-based CLI.

## Work

- Confirm MVP scope: static `import` / `from` imports, local package/module resolution, line-accurate findings, graph-based impact participation, Python-only and mixed-language projects.
- Define out-of-scope features: runtime execution, dynamic-import inference, framework/routes inference, environment extraction, capability/pack detection, and project-tool execution.
- Choose the parser. Hard requirements: in-process, synchronous (`discoverProject` is synchronous), no native compile at install time, source line numbers, tolerance of syntax errors. Candidates to evaluate:
  - `@lezer/python`: pure JS, synchronous, error-tolerant. Verify coverage of `match`, PEP 695 `type` statements, and other syntax up to the agreed baseline.
  - A hand-written import tokenizer: smallest dependency footprint, handles strings, comments, parentheses, and line continuations, but cannot provide call extraction.
  - `web-tree-sitter` with a Python grammar: robust, but initialization is async. Reject unless making discovery async is accepted as separate work.
  - Native `tree-sitter` bindings: synchronous, but require an install-time compile. Reject for an `npx`-distributed CLI unless prebuilt binaries cover supported platforms.
- Fill in the rule/contract matrix. For each kind, record whether it applies to Python and what facts it needs:

  | Kind                                  | Needs                                 | Python MVP decision                                                                      |
  | ------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
  | `forbidden-import`                    | imports, resolved paths, import lines |                                                                                          |
  | `client-forbidden-import`             | `use client` directive                | JS-only, skip Python                                                                     |
  | `import-boundary` `mustNotImport`     | imports, resolved paths, import lines |                                                                                          |
  | `import-boundary` `mustImport`        | complete import list                  |                                                                                          |
  | `required-call`                       | `ModuleRecord.calls`                  | supported only if the parser extracts calls, otherwise skip Python                       |
  | `package-boundary`                    | package membership per file           | decide whether Python packages (`pyproject.toml` roots, uv workspaces) count as packages |
  | budgets (`lines`, `bytes`, `imports`) | file size, import count               |                                                                                          |

- Decide whether the parser extracts calls, exports, and declaration counts for Python, or leaves them empty with the matrix marking dependent kinds as skipped.
- List supported resolution cases and the expected result for each:
  - flat layout and `src/` layout;
  - `from . import x`, where `x` can be a submodule file or a name defined in `__init__.py`;
  - `import a.b.c`, which also loads `a/__init__.py` and `a/b/__init__.py` (decide whether parent packages become graph edges);
  - relative imports beyond the package root;
  - namespace packages without `__init__.py`;
  - `.pyi` stubs next to `.py` files;
  - imports under `if TYPE_CHECKING:` (decide whether they count for boundaries);
  - imports inside functions and `try/except ImportError` blocks;
  - duplicate candidates across roots (ambiguous, unresolved).
- Define dotted-name pattern semantics with fixture examples. Today `patternMatches` uses `/` as the segment boundary, so `app.db` does not match `app.db.models`, and `app.db*` matches `app.dbutils`. Decide whether patterns match the dotted spelling, the resolved path, or both, and how a segment boundary works for dots.
- Specify Python project markers and how `findGuardRoot` (which only checks `.git`, `package.json`, `tsconfig.json`, `jsconfig.json`) should treat them, including precedence in mixed and nested trees.
- Specify Python test-file conventions: `test_*.py`, `*_test.py`, `tests/` directories, `conftest.py`.
- Decide what a Python-only `init` produces and whether reading `pyproject.toml` dependencies into `model.project.dependencies` is in the MVP. Note that capability regexes match npm package names, so Python dependencies would not light up capabilities without further work.
- Set the discovery benchmark regression threshold and the supported Python syntax baseline.

## Acceptance criteria

- A short decision record is added to the implementation plan or task docs with the parser choice, rejected alternatives, license/package review, and known limitations.
- The rule/contract matrix and the resolution-case list are complete, with an expected result for every row.
- The MVP acceptance criteria are precise enough to write fixtures before implementation.
- No Python interpreter requirement and no async discovery change is introduced without an explicit decision.
- Resolution uncertainty is represented as unresolved rather than silently mapped to a wrong module.
