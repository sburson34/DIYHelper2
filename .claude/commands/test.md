---
description: Run all automated tests (lint + frontend + backend)
argument-hint: "[target]  e.g. fast, fe, be, fe:coverage, help"
allowed-tools: Bash(bash scripts/test.sh:*)
---

Run the repo's canonical test suite via `scripts/test.sh`.

If the user passed an argument in `$ARGUMENTS`, use it as the target.
Otherwise default to `all` (lint + full frontend + full backend).

Targets available: `all`, `fast`, `fe`, `fe:unit`, `fe:nav`, `fe:smoke`,
`fe:coverage`, `be`, `be:unit`, `be:integration`, `be:coverage`, `lint`,
`build-verify`, `e2e`, `help`.

Execute:

!`bash scripts/test.sh ${ARGUMENTS:-all}`

After the run, summarize:
- total tests passed / failed per suite
- any failing test names (not full stack traces)
- one-line next step if anything failed, otherwise just confirm green