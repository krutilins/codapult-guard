# Python support tasks

This folder breaks down the implementation described in [Python support implementation plan](../python-support-plan.md). Decisions from Task 00 are in the [decision record](../python-support-decisions.md).

## MVP sequence

| ID  | Task                                                                                            | Depends on               | Estimate |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| 00  | [Scope and parser decision](00-scope-and-parser-decision.md)                                    | None                     | 1–2 days |
| 01  | [Record import locations and unify policy scanning](01-import-locations-and-shared-scanning.md) | 00                       | 2–3 days |
| 02  | [Split extensions and resolution per language](02-language-dispatch.md)                         | 01                       | 1–2 days |
| 03  | [Add Python project and source discovery](03-python-project-discovery.md)                       | 00, 02                   | 2–3 days |
| 04  | [Parse Python static imports](04-python-import-parser.md)                                       | 00 (wiring needs 02, 03) | 2–3 days |
| 05  | [Resolve Python local imports](05-python-import-resolution.md)                                  | 03, 04                   | 3–5 days |
| 06  | [Apply rules and contracts to Python modules](06-policy-scanning-integration.md)                | 01, 04, 05               | 2–4 days |
| 07  | [Verify graph, cache, and output integration](07-graph-cache-output.md)                         | 05, 06                   | 1–2 days |
| 08  | [Add fixtures, documentation, and release validation](08-fixtures-docs-validation.md)           | 03–07                    | 3–4 days |

Total: 17–28 working days, about 3.5–5.5 engineer-weeks for one engineer, assuming the recommended options C1 and C2 in the decision record.

Task 04's parser can be built and unit-tested on plain strings in parallel with Tasks 01 and 02. Only its integration into discovery waits for Tasks 02 and 03. Keep existing JS/TS tests green throughout.

## Post-MVP

- [09: Add optional Python project checks](09-python-project-checks-post-mvp.md) is deliberately separate and is not required for the static-analysis MVP.

## Definition of done

The MVP is complete when Task 08 acceptance criteria pass, supported Python imports participate in Guard rules, contracts, and impact analysis as the Task 00 matrix states, mixed-language projects work, JS/TS behavior is unchanged apart from documented intentional fixes, and the documented limitations match tested behavior.
