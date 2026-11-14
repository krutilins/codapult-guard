# Task 00: Record decisions and clean up references

**Phase:** 0, Preparation  
**Estimate:** 0.5 day  
**Depends on:** None  
**Commit:** `docs(tasks): record language-agnostic decisions`  
**Status:** Done (2026-11-14). See [implementation and validation evidence](00-08-validation.md).

## Goal

Make the accepted decisions in [PLAN.md](../PLAN.md) the record that later tasks cite, and leave no contradiction with the Python documents.

## Work

- D20 to D28 added to `tasks/python-support-decisions.md`, with C1 and C2 marked as reversed by D26 and D25.
- A note in `tasks/python-support-plan.md` beside "Do not introduce an abstract backend interface" that points to D20.
- Links to `plan-review.md` fixed. That file no longer exists, but `python-support-plan.md`, `python-support-decisions.md`, and `python-support/README.md` still link to it. The links become plain text, or the file is restored if it should be kept.
- Python backlog items in `python-support/README.md` that this plan now covers point to the new tasks.

## Acceptance criteria

- Every open question in `PLAN.md` has an accepted answer or an accepted default.
- A search for `plan-review.md` finds no broken link.
- No source files change.
