# Task 17: Add project checks per ecosystem

**Phase:** 5, Verification and release  
**Estimate:** 3–5 days  
**Depends on:** Task 08  
**Commit:** `feat(verification): run project checks through ecosystems`  
**Status:** Not started  
**Decision:** D27, which answers the open question in Python Task 09

## Goal

Let `verify` run a Python project's lint, typecheck, test, and build commands, while keeping the safety model main introduced for untrusted pull requests.

This task may split into two commits: the extraction first, then the Python commands.

## Work

**Extraction, with no behavior change.** `src/adapters/project-checks.ts` is npm-specific. Its command resolution moves behind a provider method:

```ts
export interface EcosystemProvider {
  // Earlier members omitted.
  projectCheckCommand?(check: ProjectCheck, context: EcosystemContext): string | undefined;
  runtimeDiagnostics?(context: EcosystemContext): RuntimeDiagnostics | undefined;
}
```

**A bug this fixes.** `packageManager` in `project-checks.ts` returns `pnpm` when nothing is detected, so `inspectProjectRuntime` reports pnpm on a Python-only project. A repository with no matching ecosystem should report no package manager, and verification output should stop implying one.

**Python commands (D27).** Commands come from explicit configuration in `.codapult/guard/agent.json`, such as:

```json
{ "checks": { "lint": "ruff check .", "typecheck": "mypy src", "test": "pytest -q" } }
```

- Guard never infers a command from `pyproject.toml`, `tox.ini`, or the presence of a tool. `doctor` may suggest a configuration as text, based on the detected tools.
- Configuration is read from the policy base under `--policy-base`, so a pull request can't change its own commands, consistent with how main treats the completion gate. This is checked against `verify.ts` and existing tests before implementing.
- In pull request mode, the consumer workflow skips project checks as it does today.
- Interpreter selection is left to the user's command and environment. A missing tool produces the existing failed outcome, with its output.
- Timeouts, output limits, and execution go through `runProjectCommand`, unchanged.
- Whether JS/TS should also accept this configuration is checked during design, since it would give both ecosystems one mechanism.

## Acceptance criteria

- All JS/TS project-check tests pass without edits, and npm results stay identical.
- A Python fixture with configured commands runs them and reports normalized outcomes.
- A Python project without configuration reports `not-configured`, not a failure.
- A pull request that changes `agent.json` can't change the commands that run under `--policy-base`.
- Python Task 09 is marked as replaced by this task.
