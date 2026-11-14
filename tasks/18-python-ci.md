# Task 18: Support Python-only installs and CI

**Phase:** 5, Verification and release  
**Estimate:** 1–2 days  
**Depends on:** Task 17  
**Commit:** `feat(ci): add setup for projects without a Node toolchain`  
**Status:** Not started

## Goal

A Python team should be able to adopt Guard without adding `package.json` to its repository. `init` already works without one, but the documented install and the CI templates assume a Node project.

## Work

- **Install path.** A pinned command, `npx @codapult/guard@<version> init`, documented alongside the existing instructions. The version stays pinned, since an unpinned command would run whatever is latest in CI.
- **CI template.** A new `docs/guard-ci-python.yml`, or a mode of `docs/guard-ci.yml` if the two can share most steps without losing readability. It sets up Node, runs the pinned command, and keeps these from the current template: base-ref policy, the SARIF upload, action SHAs, and no PR-owned scripts.
- The dependency-input check in `docs/guard-ci.yml`, which stops when Guard's runtime inputs change, doesn't apply if Guard isn't installed from the project. The pinned version in the workflow takes that role, and the template comments explain it.
- **Trusted templates.** `guard-trusted-pr-attestation.yml` and `guard-trusted-merge-group.yml` are reviewed for assumptions about pnpm and `package.json`. Any gap is either fixed or recorded as a documented limit.
- **Agent setup.** `install-agent` output and MCP configuration examples are reviewed, so they don't tell a Python team to run `pnpm exec`.
- `docs/github-setup-presets.md` gains a short section for projects without Node.

PyPI packaging and standalone binaries stay out of scope (open question 2 in `PLAN.md`).

## Acceptance criteria

- `src/core/verification/consumer-workflow.test.ts` covers the new template with the same hardening checks as the existing one.
- A Python fixture with no `package.json` completes `init` and `verify` using only the documented commands.
- The MCP server starts through the documented command in a repository with no `package.json`.
