# Task 04: Parse Python static imports

**Phase:** Python parsing  
**Priority:** MVP  
**Estimate:** 2–3 days  
**Depends on:** Task 00 (parser choice). Wiring into discovery needs Tasks 02 and 03, but the parser itself can be built and tested on plain strings in parallel with Task 01.  
**Status:** Done. Records also store `pythonImports` (D4 addition), malformed statements are dropped (D3 addition), and `required-call` skips Python modules until Task 06.1

## Goal

Extract reliable, source-located Python import references without executing project code.

## Work

- Add `@lezer/python` as a dependency (D1) and load it lazily with `createRequire` the first time a `.py` file is parsed, so TS-only runs do not load it.
- Implement a synchronous adapter over `ImportStatement` nodes. It takes source text and returns plain data: import spelling, imported names and aliases, relative level, and 1-based line. The extraction method in the decision record already matched `ast` exactly on the CPython 3.13 standard library.
- Extract `import package`, `import package.module as alias`, `from package import name`, parenthesized multiline `from` imports, `from M import *`, and relative `from .` / `from ..module import name` forms, including `...` tokens for level 3.
- Treat imports in every block (functions, `if TYPE_CHECKING:`, `try/except`) as ordinary imports (D5). No block-context marking is needed.
- Fill the `ModuleRecord` fields per D4: `imports`, `importedSymbols`, the import-line field from Task 01, and top-level `declarations` counts. Leave `exports`, `dynamicImports`, `calls`, and `directives` empty (C1).
- Keep imports from trees with error nodes and record up to 5 error lines in an optional `parseDiagnostics` field (D3). Do not fail whole-project discovery for one malformed module.
- Keep import syntax distinct from calls such as `importlib.import_module()` and `__import__()`. Dynamic import inference is out of MVP unless Task 00 adds it.

## Acceptance criteria

- Unit tests cover supported import forms, aliases, multiline imports, comments and strings that contain the word `import`, relative levels, `TYPE_CHECKING` blocks, nested imports, syntax errors, and correct line numbers.
- Unit tests cover the recovery cases from D1: imports after a bare `yield`, `with ... as (a, b)`, PEP 646 `*Ts`, invalid syntax such as `def f(:`, t-strings, and `lazy import`, plus PEP 695 generic functions and classes and imports inside decorated nested functions (verified to parse without errors during the plan review).
- A test proves the parser module is not loaded during discovery of a TS-only project.
- The parser is synchronous and does not import or execute analyzed project modules.
- The parser handles the agreed Python syntax baseline and returns deterministic normalized facts.
- Parse failures do not produce fabricated import edges.
