# Task 01: Add a model baseline for all fixtures

**Phase:** 0, Preparation  
**Estimate:** 1 day  
**Depends on:** None  
**Commit:** `test(discovery): add model baseline for all fixtures`  
**Status:** Not started

## Goal

Detect any unintended change during the refactor. Existing tests assert selected facts, while Tasks 02 to 08 need proof that the whole model and scan output stayed the same.

## Work

- A Vitest file that discovers each directory under `fixtures/` from a temporary copy and compares the result with a stored file snapshot.
- The snapshot covers `project`, `files`, `modules`, `configs`, `schemas`, `tests`, `patterns`, `capabilities`, and `insights`. `git` is excluded because it depends on the environment.
- A fixed policy run through `scanGuard` on each fixture, with one rule or contract of every kind, so `findings` and `notApplicable` are in the snapshot too.
- A test of today's behavior that a changed model makes stored proposals stale through `getGuardProposalFreshness`, since additive model changes will trigger it.
- A short comment explaining that a snapshot update needs a reason in the commit message.

## Acceptance criteria

- The baseline is deterministic across two runs and independent of file order.
- It runs inside `pnpm test` and adds no more than a few seconds.
- Editing one import in a fixture makes the test fail with a readable difference.
