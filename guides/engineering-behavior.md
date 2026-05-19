# Engineering Behavior

Use this with `agent-bootstrap.md` for implementation and review work. These
rules adapt general coding-agent hygiene into the RDC work-item contract.

## Before Editing

- State material assumptions in the work-item report; ask or block when the
  ambiguity changes architecture, data shape, security, or user-visible scope.
- Prefer the smallest change that satisfies the assigned checklist rows.
- Do not add features, abstractions, configurability, or fallback behavior that
  is not required by the work item.
- If a simpler path exists than the apparent request, report the tradeoff before
  widening the implementation.

## While Editing

- Stay inside the assigned files, package, route, or work-item boundary.
- Match the local style and contracts already in the touched files.
- Do not reformat, rename, or refactor adjacent code unless the checklist row
  explicitly requires it.
- Clean up only the unused imports, variables, files, or branches created by
  your own change.
- If existing code looks dead or wrong but is outside scope, list it as a
  blocker or follow-up. Do not remove it.

## Verification

- Every completed row needs evidence: test output, route probe, SQL result,
  screenshot artifact, type-check output, CLI transcript, or reviewer citation.
- Finding an existing file is not evidence. Verify the required behavior.
- Tick each `decomp-*` and `test-*` checklist item immediately after proving
  that exact behavior. Do not batch ticks at the end.
- Record assumptions, deviations, uncertainty, blockers, files changed, and
  verification in `submit_implementation_report()` before moving to `review`.

## Escalation

- Stop and report `BLOCKED` when the fix requires files outside scope, a broader
  architectural choice, a missing credential, or a second repeated failure.
- In unattended mode, choose the most conservative valid path only when the
  acceptance criteria remain unchanged; otherwise escalate through the advisor
  path required by the active skill.
