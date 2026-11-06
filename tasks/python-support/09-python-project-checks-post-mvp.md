# Task 09: Add optional Python project checks (post-MVP)

**Phase:** Optional follow-up  
**Priority:** Post-MVP, not a blocker  
**Estimate:** 3–7+ days after design

## Goal

Decide whether Guard should run existing Python project checks as an optional completion gate, without coupling that feature to static Python discovery.

## Work

- Gather user requirements for supported checks (for example lint, typecheck, test, build) and expected tools (ruff, mypy/pyright, pytest, tox/nox, uv, Poetry).
- Define interpreter discovery/selection, project and workspace roots, command invocation, shell safety, timeouts, environment inheritance, and missing-tool outcomes.
- Decide whether to reuse the current project-check abstraction or introduce a language-neutral project-check provider.
- Support configuration from Python metadata only where semantics are clear; do not infer arbitrary tool commands from untrusted project files.
- Add tests for absent Python, multiple interpreters, missing tools, workspace packages, failure reporting, and JS/TS regression.

## Acceptance criteria

- A separate design decision is approved before implementation begins.
- Python checks are opt-in/configurable, do not execute during static discovery, and follow documented command-safety constraints.
- Results use the existing normalized verification outcomes where possible.
- JS/TS check detection and execution remain unchanged.
